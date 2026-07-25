import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/brand'

/**
 * Only the marketing landing is public + indexable; every other route is
 * auth-gated (see robots). i18n is cookie-based (no [lang] path segment), so
 * EN and RU are served from the same URL — no per-language sitemap entries.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
  ]
}
