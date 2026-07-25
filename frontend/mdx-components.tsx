import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import { ReactNode } from 'react'

/**
 * Typography for MDX docs pages (app/docs/<slug>/page.mdx). Next resolves this
 * file at the project root and applies it to every .mdx page — no `prose`
 * wrapper needed. All colors are CSS variables set on the `.docs` scope
 * (globals.css), so the docs adopt the Ledger palette automatically.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => (
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--d-text)] mt-2 mb-4" {...props} />
    ),
    h2: (props) => (
      <h2
        className="text-xl font-semibold tracking-tight text-[var(--d-text)] mt-10 mb-3 pb-1 border-b border-[var(--d-border)] scroll-mt-20"
        {...props}
      />
    ),
    h3: (props) => (
      <h3 className="text-base font-semibold tracking-tight text-[var(--d-text)] mt-6 mb-2 scroll-mt-20" {...props} />
    ),
    p: (props) => <p className="text-[15px] leading-relaxed text-[var(--d-muted)] my-3" {...props} />,
    ul: (props) => (
      <ul className="text-[15px] leading-relaxed text-[var(--d-muted)] my-3 ml-5 list-disc space-y-1" {...props} />
    ),
    ol: (props) => (
      <ol className="text-[15px] leading-relaxed text-[var(--d-muted)] my-3 ml-5 list-decimal space-y-1" {...props} />
    ),
    li: (props) => <li className="leading-relaxed" {...props} />,
    a: ({ href = '', children, ...rest }) => {
      const isInternal = href.startsWith('/') || href.startsWith('#')
      const cls =
        'text-[var(--d-accent)] hover:text-[var(--d-accent-hover)] underline decoration-[var(--d-accent)]/30 underline-offset-2'
      if (isInternal) {
        return (
          <Link href={href} className={cls}>
            {children}
          </Link>
        )
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
          {children}
        </a>
      )
    },
    code: (props) => (
      <code
        className="px-1 py-0.5 rounded bg-[var(--d-overlay)] border border-[var(--d-border)] text-[13px] font-mono text-[var(--d-accent)]"
        {...props}
      />
    ),
    pre: ({ children }: { children?: ReactNode }) => (
      <pre className="my-4 p-4 rounded-md border border-[var(--d-border)] bg-[var(--d-elevated)] overflow-x-auto text-[13px] leading-relaxed font-mono text-[var(--d-text)]">
        {children}
      </pre>
    ),
    blockquote: (props) => (
      <blockquote className="my-4 pl-3 border-l-2 border-[var(--d-accent)] text-[var(--d-muted)]" {...props} />
    ),
    hr: () => <hr className="my-8 border-[var(--d-border)]" />,
    table: (props) => (
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse" {...props} />
      </div>
    ),
    th: (props) => (
      <th
        className="text-left text-xs font-semibold text-[var(--d-muted)] px-3 py-2 border-b border-[var(--d-border)] uppercase tracking-wide"
        {...props}
      />
    ),
    td: (props) => (
      <td className="px-3 py-2 border-b border-[var(--d-border)] text-[var(--d-text)] align-top" {...props} />
    ),
    ...components,
  }
}
