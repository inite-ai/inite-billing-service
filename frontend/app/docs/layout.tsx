'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { DOCS_GROUPS, DOCS_PAGES, adjacentDocs } from '@/lib/docs-nav'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const currentSlug = pathname?.replace(/^\/docs\/?/, '').split('/')[0] ?? ''
  const currentPage = DOCS_PAGES.find((p) => p.slug === currentSlug)
  const { prev, next } = adjacentDocs(currentSlug)

  return (
    <div className="docs min-h-screen">
      {/* top bar */}
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
            <span className="ml-1 text-[var(--d-faint)] font-mono text-xs uppercase tracking-widest">Docs</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-[var(--d-muted)]">
            <Link href="/" className="hover:text-[var(--d-text)]">
              Home
            </Link>
            <a
              href="https://github.com/inite-ai/inite-billing-service"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--d-text)]"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 md:grid md:grid-cols-[13rem_1fr] lg:grid-cols-[15rem_1fr] md:gap-10">
        {/* sidebar */}
        <aside className="hidden md:block sticky top-14 self-start py-9 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <nav aria-label="Documentation">
            {DOCS_GROUPS.map((group) => (
              <div key={group.heading} className="mb-6">
                <p className="text-[10px] font-semibold tracking-[0.12em] text-[var(--d-faint)] uppercase mb-2 font-mono">
                  {group.heading}
                </p>
                <ul className="space-y-0.5">
                  {group.pages.map((page) => {
                    const active = currentSlug === page.slug
                    return (
                      <li key={page.slug}>
                        <Link
                          href={`/docs/${page.slug}`}
                          aria-current={active ? 'page' : undefined}
                          className={`block px-2.5 py-1.5 text-sm rounded-md transition-colors ${
                            active
                              ? 'bg-[var(--d-overlay)] text-[var(--d-text)]'
                              : 'text-[var(--d-muted)] hover:text-[var(--d-text)] hover:bg-[var(--d-overlay)]'
                          }`}
                        >
                          {page.title}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* content */}
        <main className="py-9 max-w-3xl min-w-0">
          {currentPage && (
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1.5 text-xs text-[var(--d-faint)] mb-5 font-mono"
            >
              <Link href="/docs" className="hover:text-[var(--d-muted)]">
                Docs
              </Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--d-muted)]">{currentPage.title}</span>
            </nav>
          )}

          <article className="docs-content">{children}</article>

          {(prev || next) && (
            <div className="mt-16 pt-6 border-t border-[var(--d-border)] grid grid-cols-2 gap-4">
              {prev ? (
                <Link
                  href={`/docs/${prev.slug}`}
                  className="p-3.5 rounded-lg border border-[var(--d-border)] bg-[var(--d-elevated)] hover:border-[var(--d-border-strong)] transition-colors"
                >
                  <span className="block text-[11px] text-[var(--d-faint)] font-mono">← Previous</span>
                  <span className="block text-sm font-medium text-[var(--d-text)] mt-0.5">{prev.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/docs/${next.slug}`}
                  className="p-3.5 rounded-lg border border-[var(--d-border)] bg-[var(--d-elevated)] hover:border-[var(--d-border-strong)] transition-colors text-right"
                >
                  <span className="block text-[11px] text-[var(--d-faint)] font-mono">Next →</span>
                  <span className="block text-sm font-medium text-[var(--d-text)] mt-0.5">{next.title}</span>
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
