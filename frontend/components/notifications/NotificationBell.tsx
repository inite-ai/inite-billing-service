'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import api from '@/lib/api'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

export default function NotificationBell({
  direction = 'up',
}: {
  direction?: 'up' | 'down'
}) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const t = useTranslations('notifications')

  const fetchUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/v1/notifications/me/unread-count')
      setUnreadCount(data.unreadCount ?? 0)
    } catch {
      // silent — bell is non-critical
    }
  }, [])

  useEffect(() => {
    fetchUnread()
    const interval = setInterval(fetchUnread, 60_000)
    const onFocus = () => fetchUnread()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchUnread])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const toggleOpen = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      try {
        const { data } = await api.get('/v1/notifications/me', {
          params: { limit: 10 },
        })
        setItems(data.items ?? [])
        const unreadIds = (data.items ?? [])
          .filter((n: NotificationItem) => !n.readAt)
          .map((n: NotificationItem) => n.id)
        if (unreadIds.length > 0) {
          await api.post('/v1/notifications/me/read', { ids: unreadIds })
          fetchUnread()
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleOpen}
        className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
        aria-label={t('title')}
      >
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute w-80 max-h-96 overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl z-50 ${
            direction === 'up'
              ? 'bottom-full left-0 mb-2'
              : 'top-full right-0 mt-2'
          }`}
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('title')}
            </span>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-violet-500 hover:text-violet-400"
            >
              {t('viewAll')}
            </Link>
          </div>

          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              {t('empty')}
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {n.title}
                      </p>
                      <p className="text-xs text-slate-500 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {n.readAt && (
                      <Check className="w-3 h-3 text-slate-400 shrink-0 mt-1" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
