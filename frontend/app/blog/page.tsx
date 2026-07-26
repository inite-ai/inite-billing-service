import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllPosts } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Notes on billing infrastructure — payments, subscriptions, metering, referrals and AI — from the INITE Billing team.',
  alternates: { canonical: '/blog' },
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d))

export default function BlogIndex() {
  const posts = getAllPosts()
  return (
    <div className="py-12">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--d-accent)]">Journal</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--d-text)]">
        Notes on billing infrastructure
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--d-muted)] max-w-xl">
        Payments, subscriptions, metered credits, referrals, and the AI that runs the busywork — how
        INITE Billing is built and how to build on it.
      </p>

      <div className="mt-10 space-y-3">
        {posts.length === 0 && <p className="text-[var(--d-muted)]">No posts yet.</p>}
        {posts.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="group block p-5 rounded-xl border border-[var(--d-border)] bg-[var(--d-elevated)] hover:border-[var(--d-border-strong)] transition-colors"
          >
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-[var(--d-faint)]">
              <span className="text-[var(--d-accent)]">{p.frontmatter.category}</span>
              <span>·</span>
              <span>{fmtDate(p.frontmatter.date)}</span>
              <span>·</span>
              <span>{p.readingMinutes} min read</span>
            </div>
            <h2 className="mt-2 text-lg font-semibold text-[var(--d-text)] group-hover:text-white">
              {p.frontmatter.title}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--d-muted)] line-clamp-2">
              {p.frontmatter.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
