import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import readingTime from 'reading-time'
import { z } from 'zod'
import { SITE_URL, ORG } from './brand'

const DIR = path.join(process.cwd(), 'content/blog')

const FaqSchema = z.object({ question: z.string(), answer: z.string() })
export const FrontmatterSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.string(), // ISO YYYY-MM-DD
  author: z.string().default('INITE'),
  category: z.string().default('Engineering'),
  tags: z.array(z.string()).default([]),
  dateModified: z.string().optional(),
  directAnswer: z.string().optional(),
  faqs: z.array(FaqSchema).optional(),
})
export type Frontmatter = z.infer<typeof FrontmatterSchema>
export interface Post {
  slug: string
  frontmatter: Frontmatter
  body: string
  readingMinutes: number
}

function parse(file: string): Post {
  const slug = file.replace(/\.mdx?$/, '')
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8')
  const { data, content } = matter(raw)
  const frontmatter = FrontmatterSchema.parse(data)
  return { slug, frontmatter, body: content, readingMinutes: Math.max(1, Math.ceil(readingTime(content).minutes)) }
}

export function getAllPosts(): Post[] {
  if (!fs.existsSync(DIR)) return []
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.mdx'))
    .map(parse)
    .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date))
}

export function getPost(slug: string): Post | null {
  try {
    return parse(`${slug}.mdx`)
  } catch {
    return null
  }
}

export function getAllSlugs(): string[] {
  return getAllPosts().map((p) => p.slug)
}

export function getRelated(post: Post, limit = 2): Post[] {
  return getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({
      p,
      score:
        (p.frontmatter.category === post.frontmatter.category ? 10 : 0) +
        p.frontmatter.tags.filter((t) => post.frontmatter.tags.includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p)
}

/** OG image URL for a post (reuses the site's dynamic /api/og). */
export function postOgUrl(post: Post): string {
  const fm = post.frontmatter
  const q = new URLSearchParams({
    locale: 'en',
    title: fm.title,
    subtitle: fm.directAnswer ?? fm.description,
    kicker: fm.category,
  })
  return `${SITE_URL}/api/og?${q.toString()}`
}

/** JSON-LD @graph: BlogPosting + BreadcrumbList (+ FAQPage when present). */
export function postJsonLd(post: Post) {
  const fm = post.frontmatter
  const url = `${SITE_URL}/blog/${post.slug}`
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      headline: fm.title,
      description: fm.directAnswer ?? fm.description,
      datePublished: fm.date,
      dateModified: fm.dateModified ?? fm.date,
      inLanguage: 'en',
      articleSection: fm.category,
      keywords: fm.tags.join(', '),
      wordCount: post.body.split(/\s+/).length,
      timeRequired: `PT${post.readingMinutes}M`,
      image: postOgUrl(post),
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      author: { '@type': 'Person', name: fm.author },
      publisher: { '@id': `${ORG.url}/#organization` },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
        { '@type': 'ListItem', position: 3, name: fm.title, item: url },
      ],
    },
  ]
  if (fm.faqs?.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: fm.faqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    })
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}
