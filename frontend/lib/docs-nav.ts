/**
 * Source of truth for the docs sidebar, landing index, and prev/next pager.
 *
 * Adding a docs page:
 * 1. Add an entry here (slug = the route segment under `/docs/`).
 * 2. Drop a `frontend/app/docs/<slug>/page.mdx`.
 * 3. Sidebar, landing cards, pager, and sitemap pick it up.
 */
export interface DocPage {
  slug: string
  title: string
  /** Short description shown on the docs landing card. */
  description: string
}

export interface DocGroup {
  heading: string
  pages: DocPage[]
}

export const DOCS_GROUPS: DocGroup[] = [
  {
    heading: 'Start here',
    pages: [
      {
        slug: 'getting-started',
        title: 'Getting started',
        description: 'Local setup, environment variables, migrations, and running the test suite.',
      },
    ],
  },
  {
    heading: 'Reference',
    pages: [
      {
        slug: 'architecture',
        title: 'Architecture',
        description: 'Module map, the payment state machine, event flows, and the data model.',
      },
      {
        slug: 'api',
        title: 'API reference',
        description: 'REST surface, auth (JWT / service API keys), webhooks, and examples.',
      },
    ],
  },
  {
    heading: 'AI',
    pages: [
      {
        slug: 'ai-features',
        title: 'AI features',
        description: 'The assistant, confirm-gated action layer, outreach, metering, search and insights.',
      },
    ],
  },
  {
    heading: 'Operate',
    pages: [
      {
        slug: 'operations',
        title: 'Operations',
        description: 'Deploy pipeline, feature-flag rollout order, runbook notes, and adding a payment rail.',
      },
    ],
  },
]

/** Flattened ordered list — used by the prev/next pager and the sitemap. */
export const DOCS_PAGES: DocPage[] = DOCS_GROUPS.flatMap((g) => g.pages)

export function adjacentDocs(currentSlug: string): { prev: DocPage | null; next: DocPage | null } {
  const idx = DOCS_PAGES.findIndex((p) => p.slug === currentSlug)
  if (idx === -1) return { prev: null, next: null }
  return {
    prev: idx > 0 ? DOCS_PAGES[idx - 1] : null,
    next: idx < DOCS_PAGES.length - 1 ? DOCS_PAGES[idx + 1] : null,
  }
}
