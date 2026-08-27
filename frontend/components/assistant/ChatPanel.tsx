'use client'

import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { MessageCircle, X, Send, Loader2, Bot, User, Wrench, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { API_URL } from '@/lib/config'
import api from '@/lib/api'
import ActionConfirmCard, { ActionData } from './ActionConfirmCard'

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

function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

interface ToolPartView {
  key: string
  toolName: string
  running: boolean
}

function actionParts(message: UIMessage): ActionData[] {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: `data-${string}` }> =>
      p.type === 'data-action',
    )
    .map((p) => (p as { data: ActionData }).data)
    .filter((d): d is ActionData => Boolean(d?.id))
}

function savedMessageId(message: UIMessage): string | null {
  const part = message.parts.find((p) => p.type === 'data-message-saved') as
    | { data?: { messageId?: string } }
    | undefined
  return part?.data?.messageId ?? null
}

function FeedbackRow({
  conversationId,
  messageId,
}: {
  conversationId: string
  messageId: string
}) {
  const t = useTranslations('assistant.feedback')
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [thanked, setThanked] = useState(false)

  const send = async (r: 'up' | 'down', c?: string) => {
    setRating(r)
    try {
      await api.post(
        `/v1/conversations/${conversationId}/messages/${messageId}/feedback`,
        { rating: r, comment: c || undefined },
      )
      setThanked(true)
    } catch {
      // non-critical
    }
  }

  if (thanked && !showComment) {
    return <p className="text-[10px] text-slate-400 mt-1">{t('thanks')}</p>
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <button
          onClick={() => send('up')}
          className={`p-1 rounded transition-colors ${
            rating === 'up'
              ? 'text-green-500'
              : 'text-slate-400 hover:text-green-500'
          }`}
          aria-label={t('up')}
        >
          <ThumbsUp className="w-3 h-3" />
        </button>
        <button
          onClick={() => {
            setRating('down')
            setShowComment(true)
          }}
          className={`p-1 rounded transition-colors ${
            rating === 'down'
              ? 'text-red-500'
              : 'text-slate-400 hover:text-red-500'
          }`}
          aria-label={t('down')}
        >
          <ThumbsDown className="w-3 h-3" />
        </button>
      </div>
      {showComment && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setShowComment(false)
            send('down', comment)
          }}
          className="flex items-center gap-1 mt-1"
        >
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('commentPlaceholder')}
            className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
            maxLength={1000}
          />
          <button
            type="submit"
            className="text-xs text-violet-500 hover:text-violet-400 font-medium"
          >
            {t('send')}
          </button>
        </form>
      )}
    </div>
  )
}

function toolParts(message: UIMessage): ToolPartView[] {
  const views: ToolPartView[] = []
  for (const part of message.parts) {
    if (part.type === 'dynamic-tool') {
      views.push({
        key: part.toolCallId,
        toolName: part.toolName,
        running: part.state !== 'output-available' && part.state !== 'output-error',
      })
    } else if (part.type.startsWith('tool-')) {
      const p = part as { type: string; toolCallId: string; state: string }
      views.push({
        key: p.toolCallId,
        toolName: part.type.slice('tool-'.length),
        running: p.state !== 'output-available' && p.state !== 'output-error',
      })
    }
  }
  return views
}

export default function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // The transport is built once and its request callback runs long after that
  // render, so it reads the id through a ref. Rendering needs the same id as
  // state: read from the ref, the feedback control below only appeared once
  // something unrelated re-rendered the panel.
  const conversationIdRef = useRef<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const t = useTranslations('assistant')

  const [transport] = useState(
    // The ref below is read when a message is sent, not while rendering — the
    // transport instance is built once and outlives this render.
    // eslint-disable-next-line react-hooks/refs
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${API_URL}/v1/assistant/chat`,
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages[messages.length - 1]
          const text = last
            ? last.parts
                .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
                .map((p) => p.text)
                .join('')
            : ''
          return {
            body: {
              message: text,
              conversationId: conversationIdRef.current ?? undefined,
            },
          }
        },
      })
  )

  const { messages, sendMessage, status, error } = useChat<UIMessage>({
    transport,
    onData: (dataPart) => {
      if (dataPart.type === 'data-conversation') {
        const data = dataPart.data as { conversationId?: string }
        if (data?.conversationId) {
          conversationIdRef.current = data.conversationId
          setConversationId(data.conversationId)
        }
      }
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    const text = input
    setInput('')
    await sendMessage({ text })
  }

  const lastMessage = messages[messages.length - 1]
  const runningTool =
    lastMessage?.role === 'assistant'
      ? toolParts(lastMessage).find((tp) => tp.running)
      : undefined

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
              const content = messageText(message)
              const actions =
                message.role === 'assistant' ? actionParts(message) : []
              if (!content && actions.length === 0 && message.role === 'assistant')
                return null
              const dbMessageId =
                message.role === 'assistant' ? savedMessageId(message) : null

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
                  <div className="max-w-[85%] min-w-0">
                    {(content || message.role === 'user') && (
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm ${
                          message.role === 'user'
                            ? 'bg-violet-500 text-white rounded-tr-sm'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-tl-sm'
                        }`}
                      >
                        {message.role === 'assistant' ? (
                          renderMarkdown(content)
                        ) : (
                          <p className="whitespace-pre-wrap">{content}</p>
                        )}
                      </div>
                    )}
                    {actions.map((action) => (
                      <ActionConfirmCard key={action.id} action={action} />
                    ))}
                    {dbMessageId && conversationId && !isLoading && (
                      <FeedbackRow
                        conversationId={conversationId}
                        messageId={dbMessageId}
                      />
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
            {runningTool && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Wrench className="w-3 h-3" />
                    {runningTool.toolName.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {isLoading && !runningTool && (
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
