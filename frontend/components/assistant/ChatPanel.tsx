'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, Loader2, Bot, User, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { API_URL } from '@/lib/config'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Parse inline markdown into React elements (no dangerouslySetInnerHTML).
 * Only supports: **bold**, `code`, [link](url)
 */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Regex: bold, inline code, markdown links
  const pattern = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      // Bold
      nodes.push(<strong key={`${keyPrefix}-b${idx++}`}>{match[2]}</strong>)
    } else if (match[4]) {
      // Inline code
      nodes.push(
        <code key={`${keyPrefix}-c${idx++}`} className="bg-gray-700/50 px-1 py-0.5 rounded text-sm">
          {match[4]}
        </code>
      )
    } else if (match[6] && match[7]) {
      // Link — block javascript: and data: URLs
      const url = match[7]
      const label = match[6]
      if (/^(https?:\/\/)/i.test(url)) {
        nodes.push(
          <a
            key={`${keyPrefix}-a${idx++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 underline hover:text-violet-300"
          >
            {label}
          </a>
        )
      } else {
        nodes.push(label)
      }
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}

function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Unordered list items
    const ulMatch = line.match(/^[-*]\s(.*)/)
    if (ulMatch) {
      elements.push(
        <li key={i} className="ml-4 list-disc">
          {parseInline(ulMatch[1], `li${i}`)}
        </li>
      )
      continue
    }

    // Ordered list items
    const olMatch = line.match(/^\d+\.\s(.*)/)
    if (olMatch) {
      elements.push(
        <li key={i} className="ml-4 list-decimal">
          {parseInline(olMatch[1], `ol${i}`)}
        </li>
      )
      continue
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<br key={i} />)
      continue
    }

    elements.push(
      <p key={i}>{parseInline(line, `p${i}`)}</p>
    )
  }

  return <div className="space-y-1">{elements}</div>
}

export default function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [toolIndicator, setToolIndicator] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const t = useTranslations('assistant')

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const sendMessage = useCallback(async (message: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setError(null)
    setToolIndicator(null)

    try {
      const res = await fetch(`${API_URL}/v1/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          conversationId: conversationId || undefined,
        }),
      })

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let assistantText = ''
      let buffer = ''
      const assistantMsgId = `assistant-${Date.now()}`

      // Add placeholder assistant message
      setMessages(prev => [
        ...prev,
        { id: assistantMsgId, role: 'assistant', content: '' },
      ])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          if (!block.trim()) continue
          const eventMatch = block.match(/^event: (\w+)\ndata: (.+)$/s)
          if (!eventMatch) continue
          const [, eventType, data] = eventMatch

          try {
            const parsed = JSON.parse(data)

            if (eventType === 'text_delta') {
              assistantText += parsed.text
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, content: assistantText }
                    : m
                )
              )
              setToolIndicator(null)
            } else if (eventType === 'tool_call') {
              setToolIndicator(parsed.toolName)
            } else if (eventType === 'conversation') {
              setConversationId(parsed.conversationId)
            } else if (eventType === 'done') {
              setToolIndicator(null)
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      // If assistant didn't produce any text, remove the placeholder
      if (!assistantText) {
        setMessages(prev => prev.filter(m => m.id !== assistantMsgId))
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setIsLoading(false)
      setToolIndicator(null)
    }
  }, [conversationId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    const text = input
    setInput('')
    await sendMessage(text)
  }

  return (
    <>
      {/* Toggle button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
          aria-label={t('title')}
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[500px] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-violet-600 to-purple-600 text-white">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              <span className="font-semibold text-sm">{t('title')}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg hover:bg-white/20 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {t('welcome')}
                  </p>
                </div>
              </div>
            )}

            {messages.map((message) => {
              if (!message.content && message.role === 'assistant') return null

              return (
                <div
                  key={message.id}
                  className={`flex gap-2 ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 max-w-[85%] text-sm ${
                      message.role === 'user'
                        ? 'bg-violet-500 text-white rounded-tr-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-tl-sm'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      renderMarkdown(message.content)
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                      <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </div>
                  )}
                </div>
              )
            })}

            {/* Tool indicator */}
            {toolIndicator && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Wrench className="w-3 h-3" />
                    {toolIndicator.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {isLoading && !toolIndicator && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t('thinking')}
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-center">
                <p className="text-xs text-red-500">{t('error')}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t('placeholder')}
                  className="w-full px-4 py-2.5 pr-10 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/30 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
