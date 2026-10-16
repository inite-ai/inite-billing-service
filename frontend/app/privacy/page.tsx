import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import { MDXRemote } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import { mdxComponents } from '@/mdx-components'
import { SITE_URL } from '@/lib/brand'
import { getLegalDoc } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Privacy Policy — INITE Billing',
  description:
    'What the hosted INITE Billing service at billing.inite.ai stores, who processes it, how long it is kept and how to have it deleted.',
  alternates: { canonical: '/privacy' },
  openGraph: { type: 'article', title: 'INITE Billing Privacy Policy', url: `${SITE_URL}/privacy` },
}

const NOTICE: Record<string, string> = {
  ru: 'Это перевод. При расхождении действует английская версия.',
}

/**
 * The privacy policy for the hosted service, at /privacy. Language follows the
 * cookie-based interface locale (no /en, /ru path); English is binding, Russian
 * is a translation, and Portuguese and Spanish readers get the English text.
 */
export default async function PrivacyPage() {
  const { locale, body } = getLegalDoc('privacy', await getLocale())
  const notice = NOTICE[locale]

  return (
    <div className="docs min-h-screen">
      <nav className="sticky top-0 z-20 border-b border-[var(--d-border)] bg-[var(--d-bg)]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <span
              className="w-7 h-7 rounded-lg grid place-items-center text-[13px] font-bold"
              style={{ background: 'var(--d-accent)', color: 'var(--d-bg)', transform: 'rotate(-4deg)' }}
            >
              IN
            </span>
            INITE <span className="text-[var(--d-faint)] font-medium">Billing</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-[var(--d-muted)]">
            <Link href="/docs" className="hover:text-[var(--d-text)]">
              Docs
            </Link>
            <Link href="/" className="hover:text-[var(--d-text)]">
              Home
            </Link>
          </div>
        </div>
      </nav>
      <article className="max-w-3xl mx-auto px-4 py-12" lang={locale}>
        {notice && <p className="mb-6 font-mono text-xs text-[var(--d-faint)]">{notice}</p>}
        <MDXRemote
          source={body}
          components={mdxComponents}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </article>
    </div>
  )
}
