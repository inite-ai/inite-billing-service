'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ClientLayout } from '@/components/layout/ClientLayout'
import { Card } from '@/components/ui/Card'
import { Bell, Check, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

interface PreferenceRow {
  id: string
  category: string
  emailEnabled: boolean
  inAppEnabled: boolean
}

const PREF_CATEGORIES = [
  'abandoned_checkout',
  'dunning',
  'winback',
  'trial_ending',
  'quota_warning',
]

export default function NotificationsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations('notifications')

  const [items, setItems] = useState<NotificationItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [prefs, setPrefs] = useState<PreferenceRow[]>([])
  const [savingPref, setSavingPref] = useState<string | null>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const [listRes, prefRes] = await Promise.all([
        api.get('/v1/notifications/me', { params: { page: p, limit: 20 } }),
        api.get('/v1/notifications/me/preferences'),
      ])
      setItems(listRes.data.items ?? [])
      setTotalPages(listRes.data.totalPages || 1)
      setPrefs(prefRes.data.preferences ?? [])
    } catch {
      // handled by api interceptor
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login')
      return
    }
    load(page)
  }, [authLoading, user, router, page, load])

  const markAllRead = async () => {
    await api.post('/v1/notifications/me/read', { all: true })
    load(page)
  }

  const prefFor = (category: string): PreferenceRow | undefined =>
    prefs.find((p) => p.category === category)

  const togglePref = async (
    category: string,
    field: 'emailEnabled' | 'inAppEnabled',
  ) => {
    const current = prefFor(category)
    const next = current ? !current[field] : false
    setSavingPref(category)
    try {
      await api.put('/v1/notifications/me/preferences', {
        category,
        [field]: next,
      })
      const { data } = await api.get('/v1/notifications/me/preferences')
      setPrefs(data.preferences ?? [])
    } finally {
      setSavingPref(null)
    }
  }

  return (
    <ClientLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-violet-500" />
            {t('title')}
          </h1>
          <button
            onClick={markAllRead}
            className="text-sm text-violet-500 hover:text-violet-400 flex items-center gap-1"
          >
            <Check className="w-4 h-4" />
            {t('markAllRead')}
          </button>
        </div>

        <Card>
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-slate-500">{t('empty')}</div>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {items.map((n) => (
                <li key={n.id} className="py-3 flex items-start gap-3">
                  {!n.readAt && (
                    <span className="mt-2 w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                  )}
                  <div className={n.readAt ? 'opacity-70' : ''}>
                    <p className="font-medium">{n.title}</p>
                    <p className="text-sm text-slate-500 whitespace-pre-wrap">
                      {n.body}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="pt-4 flex items-center justify-center gap-3 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
              >
                ←
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
              >
                →
              </button>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">{t('preferencesTitle')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">{t('category')}</th>
                  <th className="py-2 pr-4">{t('channelEmail')}</th>
                  <th className="py-2">{t('channelInApp')}</th>
                </tr>
              </thead>
              <tbody>
                {PREF_CATEGORIES.map((category) => {
                  const row = prefFor(category)
                  const emailOn = row ? row.emailEnabled : true
                  const inAppOn = row ? row.inAppEnabled : true
                  return (
                    <tr
                      key={category}
                      className="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td className="py-2 pr-4">{t(`categories.${category}`)}</td>
                      {(['emailEnabled', 'inAppEnabled'] as const).map((field) => {
                        const on = field === 'emailEnabled' ? emailOn : inAppOn
                        return (
                          <td key={field} className="py-2 pr-4">
                            <button
                              disabled={savingPref === category}
                              onClick={() => togglePref(category, field)}
                              className={`w-10 h-5 rounded-full transition-colors relative ${
                                on ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-700'
                              } disabled:opacity-50`}
                              aria-label={`${category} ${field}`}
                            >
                              <span
                                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                  on ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </ClientLayout>
  )
}
