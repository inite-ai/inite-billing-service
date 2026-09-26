'use client'

import { useLocale, useTranslations } from 'next-intl'
import { formatMoney } from './catalog'

const RAIL_NAMES: Record<string, string> = {
  LAVA: 'lava.top',
  STRIPE: 'Stripe',
  ONE: 'ONE',
  APPLE_IAP: 'App Store',
  GOOGLE_PLAY: 'Google Play',
}

/**
 * Money, dates and the billing words a customer reads, in the interface
 * language: `79 $/мес` rather than `79.0000 USD/month`, `22 сент. 2026`
 * rather than the browser's `9/22/2026`, "Подписка" rather than
 * `SUBSCRIPTION`.
 */
export function useFormat() {
  const locale = useLocale()
  const t = useTranslations('common.billing')
  const tag = locale === 'ru' ? 'ru-RU' : 'en-US'

  const money = (amount: string | number | null | undefined, currency: string | null | undefined) =>
    amount === null || amount === undefined || !currency ? '—' : formatMoney(amount, currency, locale)

  const per = (interval: string | null | undefined) =>
    interval === 'month' ? t('perMonth') : interval === 'year' ? t('perYear') : ''

  return {
    money,
    /** `79 $/мес` — a price with its billing period, if it has one. */
    price: (amount: string | number | null | undefined, currency: string | null | undefined, interval?: string | null) =>
      `${money(amount, currency)}${per(interval)}`,
    num: (value: number | string | null | undefined) =>
      value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString(tag),
    date: (value: string | Date | null | undefined) =>
      value ? new Date(value).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
    dateTime: (value: string | Date | null | undefined) =>
      value
        ? new Date(value).toLocaleString(tag, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—',
    interval: (interval: string | null | undefined) =>
      interval === 'month' ? t('monthly') : interval === 'year' ? t('yearly') : t('oneTime'),
    mode: (mode: string | null | undefined) => (mode === 'SUBSCRIPTION' ? t('modeSubscription') : t('modePayment')),
    rail: (rail: string | null | undefined) =>
      !rail ? '—' : rail === 'CRYPTO' ? t('railCrypto') : RAIL_NAMES[rail] ?? rail,
    method: (method: string | null | undefined) =>
      method === 'CARD' ? t('methodCard') : method === 'SBP' ? t('methodSbp') : method === 'PAYPAL' ? 'PayPal' : method ?? '',
    /** Sums per currency, never across them: `79 $ · 1 999 ₽`. */
    totals: (rows: { amount: string | number; currency: string }[]) => {
      const byCurrency = new Map<string, number>()
      for (const r of rows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + Number(r.amount))
      return [...byCurrency.entries()].map(([c, v]) => formatMoney(v, c, locale)).join(' · ')
    },
  }
}
