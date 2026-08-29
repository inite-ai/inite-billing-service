'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Bot, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import api from '@/lib/api'
import { getErrorMessage } from '@/lib/api-error'
import { useNow } from '@/hooks/useNow'

interface InsightResponse {
  content: string
  generatedAt: string
  cached: boolean
  model: string
}

export default function AiInsightsCard({ serviceId }: { serviceId?: string }) {
  const t = useTranslations('admin.funnel.insights')
  const locale = useLocale()
  const [insight, setInsight] = useState<InsightResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyze = async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/v1/admin/insights/funnel', {
        serviceId: serviceId || undefined,
        locale,
        force,
      })
      setInsight(data)
    } catch (err) {
      setError(getErrorMessage(err, t('error')))
    } finally {
      setLoading(false)
    }
  }

  const now = useNow(60 * 60 * 1000)

  const timeAgo = (iso: string) => {
    const hours = Math.round((now - new Date(iso).getTime()) / 3_600_000)
    return hours < 1 ? t('justNow') : t('hoursAgo', { hours })
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Bot className="w-4 h-4 text-violet-500" />
          {t('title')}
        </h2>
        <div className="flex items-center gap-2">
          {insight && (
            <span className="text-xs text-slate-400">
              {insight.cached ? `${t('cached')} · ` : ''}
              {timeAgo(insight.generatedAt)}
              <button
                onClick={() => analyze(true)}
                className="ml-2 text-violet-500 hover:text-violet-400 inline-flex items-center gap-0.5"
                disabled={loading}
              >
                <RefreshCw className="w-3 h-3" />
                {t('regenerate')}
              </button>
            </span>
          )}
          {!insight && (
            <button
              onClick={() => analyze(false)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {t('analyze')}
            </button>
          )}
        </div>
      </div>

      {loading && insight === null && (
        <p className="text-xs text-slate-500 mt-3">{t('analyzing')}</p>
      )}
      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
      {insight && (
        <div className="mt-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('analyzing')}
            </span>
          ) : (
            insight.content
          )}
        </div>
      )}
    </Card>
  )
}
