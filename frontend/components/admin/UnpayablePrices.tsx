'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import api from '@/lib/api'

interface UnpayablePrice {
  code: string
  currency: string
  amount: string
  state: 'nobody' | 'crypto_only'
  reasons: Record<string, string>
}

/** Active prices no active payment provider can charge; nothing is shown when there are none. */
export function UnpayablePrices() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [prices, setPrices] = useState<UnpayablePrice[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    api
      .get('/v1/admin/payable-prices')
      .then((res) => live && setPrices(res.data.prices))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  if (failed) return <p role="alert" className="mb-6 text-sm text-red-600">{t('prices.unpayableTitle')}: {tc('error')}</p>
  if (prices.length === 0) return null
  return (
    <Card className="mb-6">
      <h2 className="font-semibold text-slate-900 dark:text-white">
        {t('prices.unpayableTitle')} ({prices.length})
      </h2>
      <p className="mt-1 text-sm text-slate-500">{t('prices.unpayableHint')}</p>
      <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto text-sm">
        {prices.map((p) => (
          <li key={p.code} className="flex flex-wrap gap-x-3">
            <span className="font-mono">{p.code}</span>
            <span>{p.amount} {p.currency}</span>
            <span>{t(p.state === 'nobody' ? 'prices.unpayableNobody' : 'prices.unpayableCrypto')}</span>
            <span className="text-slate-500">
              {Object.entries(p.reasons).map(([rail, why]) => `${rail}: ${why}`).join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
