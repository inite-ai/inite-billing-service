import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/brand'

// Cite-yes / train-no policy, mirrored from the parent inite.ai robots.
const CITATION_GRADE = [
  'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot',
  'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'MistralAI-User',
  'Kagibot', 'Brave-SearchBot', 'xAI-Bot', 'YouBot',
]
const BLOCKED = [
  'GPTBot', 'ClaudeBot', 'bingbot-Extended', 'anthropic-ai', 'Bytespider',
  'Meta-ExternalAgent', 'FacebookBot', 'Amazonbot', 'cohere-ai', 'Diffbot',
  'Omgilibot', 'Webzio-Extended', 'MJ12bot',
]
// Auth-gated / non-marketing surfaces — kept out of the index.
const APP_PATHS = [
  '/api/', '/admin', '/dashboard', '/orders', '/subscriptions', '/referrals',
  '/notifications', '/checkout', '/catalog', '/login', '/callback', '/unsubscribe',
]

export default function robots(): MetadataRoute.Robots {
  const marketing = { allow: ['/', '/api/og'], disallow: APP_PATHS }
  return {
    rules: [
      { userAgent: '*', ...marketing },
      ...CITATION_GRADE.map((userAgent) => ({ userAgent, ...marketing })),
      ...BLOCKED.map((userAgent) => ({ userAgent, disallow: '/' })),
      { userAgent: 'AhrefsBot', crawlDelay: 10 },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
