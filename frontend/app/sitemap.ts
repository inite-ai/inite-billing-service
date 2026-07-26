import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/brand'
import { DOCS_PAGES } from '@/lib/docs-nav'
import { getAllPosts } from '@/lib/blog'

/**
 * Public + indexable routes: the marketing landing and the docs. Everything
 * else is auth-gated (see robots). i18n is cookie-based (no [lang] path), so
 * EN and RU share one URL — no per-language sitemap entries.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${SITE_URL}/docs`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    ...DOCS_PAGES.map((p) => ({
      url: `${SITE_URL}/docs/${p.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    { url: `${SITE_URL}/blog`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.8 },
    ...getAllPosts().map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: new Date(p.frontmatter.dateModified ?? p.frontmatter.date),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]
}
