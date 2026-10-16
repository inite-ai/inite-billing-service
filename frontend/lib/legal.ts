import fs from 'node:fs'
import path from 'node:path'

/**
 * Legal pages (the privacy policy) live as Markdown under content/legal/<locale>/.
 * English is the binding text; a translation exists only for some interface
 * languages, and every other one falls back to English rather than to nothing.
 */
export const LEGAL_LOCALES = ['en', 'ru'] as const
export type LegalLocale = (typeof LEGAL_LOCALES)[number]

const DIR = path.join(process.cwd(), 'content/legal')

export function legalLocale(locale: string): LegalLocale {
  return (LEGAL_LOCALES as readonly string[]).includes(locale) ? (locale as LegalLocale) : 'en'
}

export function getLegalDoc(slug: 'privacy', locale: string): { locale: LegalLocale; body: string } {
  const resolved = legalLocale(locale)
  const body = fs.readFileSync(path.join(DIR, resolved, `${slug}.mdx`), 'utf8')
  return { locale: resolved, body }
}
