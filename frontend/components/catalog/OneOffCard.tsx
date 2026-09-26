'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import type { Price, Product } from '@/lib/types'
import { description, formatMoney, oneOffPricesFor } from '@/lib/catalog'

/**
 * A one-off purchase. Most have one price in the currency shown; a credit
 * pack has several, each carrying its `credits`, and the customer picks one.
 */
export function OneOffCard({
  product,
  currency,
  busy,
  onBuy,
}: {
  product: Product
  currency: string
  busy: boolean
  onBuy: (product: Product, price: Price) => void
}) {
  const t = useTranslations('catalog')
  const locale = useLocale()
  const prices = oneOffPricesFor(product, currency)
  const [picked, setPicked] = useState<string | null>(null)
  const price = prices.find((p) => p.id === picked) ?? prices[0]
  if (!price) return null

  const creditsOf = (p: Price) => {
    const c = p.metadata?.credits
    return typeof c === 'number' ? c : typeof c === 'string' && Number.isFinite(Number(c)) ? Number(c) : null
  }
  const text = description(product, locale)

  return (
    <article className="plan">
      <h3 className="text-[22px] leading-tight">{product.name}</h3>
      {text && <p className="mt-2 text-sm leading-relaxed text-[color:var(--dim)]">{text}</p>}

      {prices.length > 1 ? (
        <fieldset className="mt-5 flex-1">
          <legend className="eyebrow mb-2.5">{t('pack')}</legend>
          <div className="space-y-2">
            {prices.map((p) => {
              const credits = creditsOf(p)
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={p.id === price.id}
                  onClick={() => setPicked(p.id)}
                  className="opt !py-2.5"
                >
                  <span className="radio" aria-hidden />
                  <span className="ui flex-1 text-sm">
                    {credits !== null ? t('creditsPack', { count: credits }) : formatMoney(p.amount, p.currency, locale)}
                  </span>
                  <span className="mono text-[13px]">{formatMoney(p.amount, p.currency, locale)}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ) : (
        <div className="mt-5 flex-1">
          <span className="amount">{formatMoney(price.amount, price.currency, locale)}</span>
          {creditsOf(price) !== null && (
            <p className="mono mt-2 text-[12px] text-[color:var(--dim)]">{t('creditsPack', { count: creditsOf(price)! })}</p>
          )}
        </div>
      )}

      <button type="button" onClick={() => onBuy(product, price)} disabled={busy} className="btn ghost block mt-6">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : prices.length > 1 ? (
          `${t('buy')} · ${formatMoney(price.amount, price.currency, locale)}`
        ) : (
          t('buy')
        )}
      </button>
    </article>
  )
}
