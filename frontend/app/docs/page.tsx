import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { DOCS_GROUPS } from '@/lib/docs-nav'

export const metadata: Metadata = {
  title: 'Docs',
  description:
    'Integrate INITE Billing — setup, architecture, REST API, AI features, and operations.',
  alternates: { canonical: '/docs' },
}

export default function DocsIndex() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--d-text)]">Documentation</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--d-muted)] max-w-2xl">
        Everything to integrate INITE Billing — a payment-rail-agnostic, AI-first billing gateway.
        Start with setup, then the architecture and REST API; the AI and operations guides cover the
        assistant, metering, and running it in production.
      </p>

      <div className="mt-10 space-y-10">
        {DOCS_GROUPS.map((group) => (
          <section key={group.heading}>
            <h2 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--d-faint)] uppercase mb-3 font-mono">
              {group.heading}
            </h2>
            <ul className="grid gap-2">
              {group.pages.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`/docs/${page.slug}`}
                    className="group flex items-start gap-3 p-4 rounded-lg border border-[var(--d-border)] bg-[var(--d-elevated)] hover:border-[var(--d-border-strong)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--d-text)]">{page.title}</p>
                      <p className="mt-0.5 text-[13px] text-[var(--d-muted)] leading-relaxed">
                        {page.description}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[var(--d-faint)] mt-0.5 group-hover:text-[var(--d-accent)] transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
