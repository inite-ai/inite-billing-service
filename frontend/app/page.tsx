import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import LandingClient from '@/components/landing/LandingClient'
import { buildLandingMetadata, buildLandingJsonLd, normLocale } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  return buildLandingMetadata(normLocale(await getLocale()))
}

export default async function Page() {
  const jsonLd = buildLandingJsonLd(normLocale(await getLocale()))
  return (
    <>
      <script
        type="application/ld+json"
        // Landing structured data (Organization + WebSite + SoftwareApplication + FAQPage).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <LandingClient />
    </>
  )
}
