/**
 * SEO / OpenGraph / AEO helpers for the marketing landing.
 * Mirrors the parent initeai conventions (localized metadata, dynamic OG via
 * an /api/og URL, JSON-LD @graph) adapted to billing's cookie-based i18n
 * (no [lang] path segment → og:locale + alternateLocale instead of URL hreflang).
 */
import type { Metadata } from 'next'
import { SITE_URL, BRAND, ORG, META } from './brand'

export type Locale = 'en' | 'ru'

export const normLocale = (l: string): Locale => (l === 'ru' ? 'ru' : 'en')

/** URL of the dynamic OG image, with the localized headline baked into query. */
export function buildOgImageUrl(locale: Locale): string {
  const m = META[locale]
  const q = new URLSearchParams({ locale, title: m.ogTitle, subtitle: m.description })
  return `${SITE_URL}/api/og?${q.toString()}`
}

/** Full Next Metadata for the marketing landing, localized. */
export function buildLandingMetadata(locale: Locale): Metadata {
  const m = META[locale]
  const ogLocale = locale === 'ru' ? 'ru_RU' : 'en_US'
  const altLocale = locale === 'ru' ? 'en_US' : 'ru_RU'
  const ogImage = buildOgImageUrl(locale)

  return {
    metadataBase: new URL(SITE_URL),
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    applicationName: BRAND.name,
    authors: [{ name: ORG.name, url: ORG.url }],
    creator: ORG.name,
    publisher: ORG.name,
    category: 'technology',
    alternates: {
      canonical: '/',
      types: { 'text/llms+txt': `${SITE_URL}/llms.txt` },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: 'website',
      siteName: BRAND.name,
      url: SITE_URL,
      locale: ogLocale,
      alternateLocale: [altLocale],
      title: m.ogTitle,
      description: m.description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: m.ogTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title: m.ogTitle,
      description: m.description,
      images: [ogImage],
    },
  }
}

/** Curated FAQ for the FAQPage schema (AEO — answer-engine friendly). */
const FAQ: Record<Locale, Array<{ q: string; a: string }>> = {
  en: [
    {
      q: 'What is INITE Billing?',
      a: 'INITE Billing is a payment-rail-agnostic, AI-first billing gateway: one backend for subscriptions, usage-metered credits, entitlements and multi-level referrals, with an embedded AI operator for the busywork.',
    },
    {
      q: 'Which payment methods does INITE Billing support?',
      a: 'Six rails behind one adapter interface: Stripe, native multi-chain crypto (ETH/SOL/TON/TRON), Apple IAP, Google Play, Lava, and ONE. Adding a rail does not change your integration code.',
    },
    {
      q: 'How much does INITE Billing cost?',
      a: 'The platform is free to integrate — INITE takes no cut of your revenue. You only pay the standard processing fees charged by your payment provider.',
    },
    {
      q: 'What can the AI assistant do?',
      a: 'It has 19 tools over your billing data — 14 read-only, plus 5 write actions (cancel a subscription, adjust credits, propose a refund) that require confirmation in the UI before they run.',
    },
  ],
  ru: [
    {
      q: 'Что такое INITE Billing?',
      a: 'INITE Billing — платёжный бэкенд без привязки к способу оплаты: подписки, кредиты с тарификацией, доступы и многоуровневые рефералы за единым интерфейсом, со встроенным AI, который ведёт рутину.',
    },
    {
      q: 'Какие способы оплаты поддерживает INITE Billing?',
      a: 'Шесть способов за единым интерфейсом адаптера: Stripe, нативная мультичейн-крипта (ETH/SOL/TON/TRON), Apple IAP, Google Play, Lava и ONE. Добавление нового способа не меняет код интеграции.',
    },
    {
      q: 'Сколько стоит INITE Billing?',
      a: 'Платформа бесплатна для интеграции — INITE не берёт долю с вашего дохода. Вы платите только стандартную комиссию своего платёжного провайдера.',
    },
    {
      q: 'Что умеет AI-ассистент?',
      a: 'У него 19 инструментов поверх ваших биллинг-данных — 14 на чтение и 5 действий (отмена подписки, корректировка кредитов, предложение возврата), которые выполняются только после подтверждения в интерфейсе.',
    },
  ],
}

const featureList = [
  'Payment-rail-agnostic checkout (Stripe, crypto, Apple/Google IAP, Lava, ONE)',
  'Subscription lifecycle with trials, renewals and grace periods',
  'Usage-metered credits with per-tier rates and quotas',
  'Multi-level referral engine with automatic payouts',
  'Embedded AI assistant with confirm-before-execute actions',
  'AI retention: dunning, win-back and abandoned-checkout outreach',
]

/** JSON-LD @graph for the landing: Organization + WebSite + SoftwareApplication + FAQPage. */
export function buildLandingJsonLd(locale: Locale) {
  const m = META[locale]
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${ORG.url}/#organization`,
        name: ORG.name,
        legalName: ORG.legalName,
        url: ORG.url,
        logo: { '@type': 'ImageObject', url: ORG.logo, width: 512, height: 512 },
        sameAs: ORG.sameAs,
        founder: { '@type': 'Person', name: ORG.founder.name, jobTitle: ORG.founder.jobTitle },
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: BRAND.name,
        url: SITE_URL,
        inLanguage: ['en', 'ru'],
        publisher: { '@id': `${ORG.url}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#app`,
        name: BRAND.name,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: SITE_URL,
        description: m.description,
        image: `${SITE_URL}/api/og`,
        featureList,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          description:
            locale === 'ru'
              ? 'Бесплатная интеграция — вы платите только комиссию платёжного провайдера'
              : 'Free to integrate — you only pay your payment provider fees',
        },
        publisher: { '@id': `${ORG.url}/#organization` },
        provider: { '@id': `${ORG.url}/#organization` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: FAQ[locale].map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  }
}
