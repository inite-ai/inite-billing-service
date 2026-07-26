import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MDXRemote } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import { getPost, getAllSlugs, getRelated, postJsonLd, postOgUrl } from '@/lib/blog'
import { mdxComponents } from '@/mdx-components'
import { SITE_URL } from '@/lib/brand'

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }))
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d))

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return { title: 'Not found' }
  const fm = post.frontmatter
  const og = postOgUrl(post)
  return {
    title: fm.title,
    description: (fm.directAnswer ?? fm.description).slice(0, 160),
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: 'article',
      title: fm.title,
      description: fm.description,
      url: `${SITE_URL}/blog/${slug}`,
      publishedTime: fm.date,
      modifiedTime: fm.dateModified ?? fm.date,
      authors: [fm.author],
      tags: fm.tags,
      images: [{ url: og, width: 1200, height: 630, alt: fm.title }],
    },
    twitter: { card: 'summary_large_image', title: fm.title, description: fm.description, images: [og] },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()
  const fm = post.frontmatter
  const related = getRelated(post)

  return (
    <article className="py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(postJsonLd(post)).replace(/</g, '\\u003c') }}
      />

      <Link href="/blog" className="font-mono text-xs text-[var(--d-faint)] hover:text-[var(--d-muted)]">
        ← Blog
      </Link>

      <div className="mt-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-[var(--d-faint)]">
        <span className="text-[var(--d-accent)]">{fm.category}</span>
        <span>·</span>
        <span>{fmtDate(fm.date)}</span>
        <span>·</span>
        <span>{post.readingMinutes} min read</span>
      </div>

      <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-[var(--d-text)] leading-tight">
        {fm.title}
      </h1>
      <p className="mt-4 text-[17px] leading-relaxed text-[var(--d-muted)]">{fm.description}</p>
      <p className="mt-4 font-mono text-xs text-[var(--d-faint)]">By {fm.author}</p>

      {fm.directAnswer && (
        <aside className="aeo-direct-answer mt-8 p-4 rounded-xl border border-[var(--d-accent)]/30 bg-[rgba(204,255,0,0.05)] text-[15px] leading-relaxed text-[var(--d-text)]">
          {fm.directAnswer}
        </aside>
      )}

      <div className="mt-8 blog-body">
        <MDXRemote
          source={post.body}
          components={mdxComponents}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </div>

      {fm.faqs && fm.faqs.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-semibold text-[var(--d-text)] mb-4">FAQ</h2>
          <div className="space-y-2">
            {fm.faqs.map((f, i) => (
              <details
                key={i}
                className="rounded-lg border border-[var(--d-border)] bg-[var(--d-elevated)] px-4 py-3"
              >
                <summary className="cursor-pointer text-[15px] font-medium text-[var(--d-text)]">
                  {f.question}
                </summary>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--d-muted)]">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-16 pt-8 border-t border-[var(--d-border)]">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--d-faint)] mb-4">Related</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/blog/${r.slug}`}
                className="block p-4 rounded-lg border border-[var(--d-border)] bg-[var(--d-elevated)] hover:border-[var(--d-border-strong)] transition-colors"
              >
                <p className="text-sm font-medium text-[var(--d-text)]">{r.frontmatter.title}</p>
                <p className="mt-1 text-[13px] text-[var(--d-muted)] line-clamp-2">{r.frontmatter.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
