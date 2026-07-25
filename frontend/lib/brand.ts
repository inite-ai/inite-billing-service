/**
 * Canonical brand / entity facts for INITE Billing.
 *
 * Kept consistent with the parent site's `lib/brand-canonical.ts` (INITE AI):
 * same organization identity, socials (`sameAs`), founder and logo — so the
 * billing product resolves as a sub-brand of the same entity across the web
 * and to AI answer engines. Product-specific facts (name, tagline, features)
 * are billing's own. Single source of truth for metadata, JSON-LD and llms.txt.
 */

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://billing.inite.ai'
).replace(/\/$/, '')

/** The parent organization — mirrored from the initeai brand-canonical. */
export const ORG = {
  name: 'INITE AI',
  legalName: 'inite LLC',
  url: 'https://inite.ai',
  logo: 'https://inite.ai/android-chrome-512x512.png',
  founder: { name: 'Mikhail Savchenko', jobTitle: 'Founder and CEO' },
  sameAs: [
    'https://www.linkedin.com/company/inite-ai/',
    'https://www.instagram.com/inite.ai',
    'https://t.me/initeai',
    'https://github.com/inite-ai',
  ],
} as const

/** The billing product entity. */
export const BRAND = {
  name: 'INITE Billing',
  shortName: 'INITE Billing',
  domain: SITE_URL,
  repo: 'https://github.com/inite-ai/inite-billing-service',
  docs: 'https://github.com/inite-ai/inite-billing-service/blob/main/docs/api.md',
  contactEmail: 'support@inite.ai',
  // Ordered by SERP authority, shared with the parent org.
  sameAs: [...ORG.sameAs, 'https://github.com/inite-ai/inite-billing-service'],
  // Verifiable product facts (kept true to the codebase).
  facts: {
    paymentMethods: 6, // ONE, crypto (ETH/SOL/TON/TRON), Lava, Stripe, Apple IAP, Google Play
    assistantTools: 19, // 14 read-only + 5 confirm-gated actions
    assistantReadTools: 14,
    assistantActions: 5,
    referralLevels: 'N', // configurable depth
  },
  rails: ['Stripe', 'Crypto (ETH/SOL/TON/TRON)', 'Apple IAP', 'Google Play', 'Lava', 'ONE'],
} as const

/** Per-locale marketing metadata copy (title ≤ ~60, description ≤ ~160). */
export const META: Record<'en' | 'ru', { title: string; ogTitle: string; description: string; keywords: string[] }> = {
  en: {
    title: 'INITE Billing — AI-first billing gateway',
    ogTitle: 'One backend for your money.',
    description:
      'Payment-rail-agnostic billing: subscriptions, usage-metered credits, entitlements and multi-level referrals behind one interface — Stripe, crypto, Apple/Google IAP — with an embedded AI operator.',
    keywords: [
      'billing gateway',
      'subscription billing',
      'usage-based billing',
      'metered credits',
      'payment orchestration',
      'multi-level referrals',
      'AI billing',
      'Stripe alternative',
      'crypto payments',
      'in-app purchase billing',
    ],
  },
  ru: {
    title: 'INITE Billing — AI-first платёжный бэкенд',
    ogTitle: 'Один бэкенд для ваших денег.',
    description:
      'Платёжный бэкенд без привязки к способу оплаты: подписки, кредиты с тарификацией, доступы и многоуровневые рефералы за единым интерфейсом — Stripe, крипта, Apple/Google IAP — со встроенным AI.',
    keywords: [
      'биллинг',
      'платёжный шлюз',
      'подписки',
      'тарификация по потреблению',
      'кредиты',
      'реферальная программа',
      'приём платежей',
      'Stripe',
      'крипта',
      'AI биллинг',
    ],
  },
}
