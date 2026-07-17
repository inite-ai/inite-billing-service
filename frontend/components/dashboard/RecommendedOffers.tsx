'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Sparkles, Loader2 } from 'lucide-react'
import api from '@/lib/api'

interface Offer {
  productId: string
  code: string
  name: string
  serviceName: string | null
  priceCode: string | null
  amount: string | null
  currency: string | null
  interval: string | null
  reason: string
  explanation?: string
}

export default function RecommendedOffers({
  sessionId,
  compact = false,
}: {
  sessionId?: string
  compact?: boolean
}) {
  const t = useTranslations('dashboard.recommendations')
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)

  useEffect(() => {
    const url = sessionId
      ? `/v1/recommendations/checkout/${sessionId}`
      : '/v1/recommendations/me'
    api
      .get(url, { params: { limit: compact ? 3 : 3 } })
      .then(({ data }) => setOffers(data ?? []))
      .catch(() => setOffers([]))
      .finally(() => setLoading(false))
  }, [sessionId, compact])

  const buy = async (offer: Offer) => {
    if (!offer.priceCode) return
    setBuying(offer.productId)
    try {
      const { data } = await api.post('/v1/checkout/sessions', {
        priceCode: offer.priceCode,
        mode: offer.interval ? 'SUBSCRIPTION' : 'PAYMENT',
      })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else if (data.sessionId) {
        router.push(`/checkout/${data.sessionId}`)
      }
    } finally {
      setBuying(null)
    }
  }

  if (loading) {
    return compact ? null : (
      <div className="py-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
      </div>
    )
  }
  if (offers.length === 0) return null

  return (
    <div className={compact ? 'mt-6' : ''}>
      <h2 className="text-sm font-semibold text-slate-500 flex items-center gap-1.5 mb-3">
        <Sparkles className="w-4 h-4 text-violet-500" />
        {compact ? t('compactTitle') : t('title')}
      </h2>
      <div
        className={
          compact
            ? 'flex gap-3 overflow-x-auto pb-1'
            : 'grid sm:grid-cols-2 lg:grid-cols-3 gap-4'
        }
      >
        {offers.map((offer) => (
          <div
            key={offer.productId}
            className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 ${
              compact ? 'min-w-[220px]' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{offer.name}</p>
                {offer.serviceName && (
                  <p className="text-xs text-slate-500">{offer.serviceName}</p>
                )}
              </div>
              <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300">
                {t(`reasons.${offer.reason}`)}
              </span>
            </div>
            {offer.explanation && (
              <p className="text-xs text-slate-500 mt-2">{offer.explanation}</p>
            )}
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm font-semibold">
                {offer.amount
                  ? `${offer.amount} ${offer.currency ?? ''}${
                      offer.interval ? ` / ${offer.interval}` : ''
                    }`
                  : ''}
              </span>
              {offer.priceCode && (
                <button
                  onClick={() => buy(offer)}
                  disabled={buying === offer.productId}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {buying === offer.productId ? '…' : t('cta')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
