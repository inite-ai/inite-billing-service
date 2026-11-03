import { describe, expect, it } from 'vitest'
import { familyResearchFor } from '@inite/landing/family-research'
import { getAllPosts, getPost, postJsonLd } from '@/lib/blog'
import sitemap from '@/app/sitemap'
import { GET as llmsTxt } from '@/app/llms.txt/route'

const posts = getAllPosts()

describe('blog', () => {
  it('parses every post and finds it again by its slug', () => {
    expect(posts.length).toBeGreaterThanOrEqual(5)
    for (const p of posts) {
      expect(getPost(p.slug)?.frontmatter.title).toBe(p.frontmatter.title)
    }
  })

  it('refuses a slug that could leave content/blog', () => {
    expect(getPost('../legal/en/privacy')).toBeNull()
    expect(getPost('usage-based-billing.mdx')).toBeNull()
  })

  it('lists every post in the sitemap and in llms.txt', async () => {
    const urls = sitemap().map((e) => e.url)
    const llms = await (await llmsTxt()).text()
    expect(llms).not.toContain('__BLOG__')
    for (const p of posts) {
      expect(urls.some((u) => u.endsWith(`/blog/${p.slug}`))).toBe(true)
      expect(llms).toContain(`/blog/${p.slug}`)
    }
  })

  it('gives every post an article in its JSON-LD, with its FAQ when it has one', () => {
    for (const p of posts) {
      const graph = postJsonLd(p)['@graph'] as { '@type': string }[]
      expect(graph.map((g) => g['@type'])).toContain('BlogPosting')
      if (p.frontmatter.faqs?.length) expect(graph.map((g) => g['@type'])).toContain('FAQPage')
    }
  })

  // The posts written by measured demand: the query sits in the title, and
  // each links an inite.ai study in its own language, tagged as ours.
  it.each([
    'usage-based-billing',
    'stripe-usage-based-billing',
    'ai-billing',
    'stripe-alternative',
    'payment-orchestration-platform',
    'merchant-of-record',
    'gateway-de-pagamento',
    'agentic-payments',
    'x402-protocol',
    'stablecoin-payments',
    'referral-program-software',
  ])(
    '%s carries its query and the family research link',
    (slug) => {
      const post = getPost(slug)
      expect(post).not.toBeNull()
      const fm = post!.frontmatter
      expect(fm.title.toLowerCase().replace(/-/g, ' ')).toContain(slug.replace(/-/g, ' '))
      expect(fm.faqs?.length ?? 0).toBeGreaterThanOrEqual(3)
      const link = familyResearchFor({ title: fm.title, tags: fm.tags, category: fm.category }, fm.lang, 'billing')
      expect(link?.href).toMatch(new RegExp(`^https://inite\\.ai/${fm.lang}/research/.+\\?from=blog:billing$`))
    },
  )
})
