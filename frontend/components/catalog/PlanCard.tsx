'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import type { Price, Product } from '@/lib/types'
import { useFeatureLabel } from './useFeatureLabel'
import {
  description,
  features,
  formatMoney,
  meta,
  numberMeta,
  priceFor,
  yearlySaving,
  type Interval,
} from '@/lib/catalog'

const VISIBLE_FEATURES = 7

/**
 * What a plan includes, in words a customer reads: the limits a module sets
 * in metadata first (users, vehicles, queue), then the features — a machine
 * key (`custom-domain`) through the dictionary or spelled out, a sentence as
 * written, and `*` as "everything".
 */
function usePlanLines(product: Product, price: Price) {
  const t = useTranslations('catalog')
  const featureLabel = useFeatureLabel()
  const lines: { text: string; limit?: boolean }[] = []

  const limit = (key: string, upTo: 'usersUpTo' | 'vehiclesUpTo', unlimited: 'usersUnlimited' | 'vehiclesUnlimited') => {
    const n = numberMeta(product, key)
    if (n === undefined) return
    if (n === null || n < 0) lines.push({ text: t(unlimited), limit: true })
    else lines.push({ text: t(upTo, { count: n }), limit: true })
  }
  limit('maxUsers', 'usersUpTo', 'usersUnlimited')
  limit('maxVehicles', 'vehiclesUpTo', 'vehiclesUnlimited')
  const queue = numberMeta(product, 'queueLimit')
  if (typeof queue === 'number' && queue > 0) lines.push({ text: t('queueLimit', { count: queue }), limit: true })
  if (meta(product).onPremise === true) lines.push({ text: t('onPremise'), limit: true })
  if (meta(product).dedicatedManager === true) lines.push({ text: t('dedicatedManager'), limit: true })

  const list = features(product)
  const credits = numberMeta(product, 'creditsPerPeriod')
  // Content plans already say "500 credits/month" among their features.
  if (typeof credits === 'number' && credits > 0 && !list.some((f) => /credit|кредит/i.test(f))) {
    const yearly = price.interval === 'year'
    lines.push({
      text: t(yearly ? 'creditsYearlyTotal' : 'creditsMonthly', {
        count: (yearly ? credits * 12 : credits).toLocaleString(),
      }),
      limit: true,
    })
  }

  for (const f of list) lines.push({ text: featureLabel(f) })
  return lines
}

export function PlanCard({
  product,
  currency,
  interval,
  mine,
  busy,
  onBuy,
  addonOf,
}: {
  product: Product
  currency: string
  interval: Interval
  mine: boolean
  busy: boolean
  onBuy: (product: Product, price: Price) => void
  /** Set for an add-on: the service whose plans it extends. */
  addonOf?: string
}) {
  const t = useTranslations('catalog')
  const locale = useLocale()
  const [expanded, setExpanded] = useState(false)

  // The interval asked for, or the one the product has.
  const price = priceFor(product, currency, interval) ?? priceFor(product, currency, interval === 'year' ? 'month' : 'year')
  const lines = usePlanLines(product, price ?? ({} as Price))
  if (!price) return null

  const amount = Number(price.amount)
  const yearly = price.interval === 'year'
  const saving = yearly ? yearlySaving(product, currency) : 0
  const highlighted = !mine && (meta(product).highlighted === true || meta(product).highlighted === 'true')
  const shown = expanded ? lines : lines.slice(0, VISIBLE_FEATURES)
  const hidden = lines.length - shown.length
  const text = description(product, locale)

  return (
    <article className={`plan ${highlighted ? 'hl' : ''} ${mine ? 'mine' : ''}`}>
      {mine ? <span className="flag mine">{t('yourPlan')}</span> : highlighted && <span className="flag">{t('popular')}</span>}

      <h3 className="text-[24px] leading-tight">{product.name}</h3>
      {addonOf && <p className="mono mt-1.5 text-[11.5px] text-[color:var(--dim-2)]">{t('addonHint', { service: addonOf })}</p>}
      {text && <p className="mt-2 text-sm leading-relaxed text-[color:var(--dim)]">{text}</p>}

      <div className="mt-6">
        <div className="flex items-baseline gap-1.5">
          <span className="amount">
            {formatMoney(yearly && amount / 12 >= 10 ? Math.round(amount / 12) : yearly ? amount / 12 : amount, price.currency, locale)}
          </span>
          <span className="mono text-[13px] text-[color:var(--dim)]">{t('perMonthShort')}</span>
        </div>
        <div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-2">
          {yearly && (
            <span className="mono text-[12px] text-[color:var(--dim)]">
              {t('billedYearly', { amount: formatMoney(amount, price.currency, locale) })}
            </span>
          )}
          {saving > 0 && <span className="chip-acc">−{saving}%</span>}
          {!!price.trialDays && price.trialDays > 0 && <span className="chip-acc">{t('trial', { days: price.trialDays })}</span>}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="mt-6 flex-1 border-t border-dashed border-[color:var(--line)] pt-5">
          <ul className="ticks">
            {shown.map((line, i) => (
              <li key={i} className={line.limit ? 'lim' : ''}>
                {line.text}
              </li>
            ))}
          </ul>
          {lines.length > VISIBLE_FEATURES && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mono mt-3 text-[12px] text-[color:var(--dim)] transition-colors hover:text-[color:var(--ink)]"
              aria-expanded={expanded}
            >
              {expanded ? t('lessFeatures') : t('moreFeatures', { count: hidden })}
            </button>
          )}
        </div>
      )}
      {lines.length === 0 && <div className="flex-1" />}

      <button
        type="button"
        onClick={() => onBuy(product, price)}
        disabled={mine || busy}
        className={`btn block mt-7 ${highlighted ? 'acc' : 'ghost'}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mine ? t('currentPlan') : t('subscribeCta')}
      </button>
    </article>
  )
}
