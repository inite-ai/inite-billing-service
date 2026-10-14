/** The interface languages this frontend has messages for (`messages/<locale>.json`). */
export const LOCALES = ['en', 'ru', 'pt', 'es'] as const
export type AppLocale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'en'
export const LOCALE_COOKIE = 'locale'
/** Set by the middleware when the URL carries `?locale=`, so this very render uses it. */
export const LOCALE_HEADER = 'x-billing-locale'

/** `pt-BR`, `PT`, `es_419` → the supported base language, or null. */
export function supportedLocale(value: string | null | undefined): AppLocale | null {
  if (!value) return null
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  return (LOCALES as readonly string[]).includes(base) ? (base as AppLocale) : null
}

/** The first supported language of an `Accept-Language` header, honouring q-weights. */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag, q: q ? Number(q.slice(2)) || 0 : 1, i }
    })
    .filter((r) => r.tag && r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
  for (const r of ranked) {
    const locale = supportedLocale(r.tag)
    if (locale) return locale
  }
  return null
}

/** The page language: `?locale=` → `locale` cookie → Accept-Language → English. */
export function resolveLocale(sources: {
  param?: string | null
  cookie?: string | null
  acceptLanguage?: string | null
}): AppLocale {
  return (
    supportedLocale(sources.param) ??
    supportedLocale(sources.cookie) ??
    localeFromAcceptLanguage(sources.acceptLanguage) ??
    DEFAULT_LOCALE
  )
}

/** The BCP 47 tag for number and date formatting. */
export function intlTag(locale: string): string {
  switch (supportedLocale(locale)) {
    case 'ru':
      return 'ru-RU'
    case 'pt':
      return 'pt-BR'
    case 'es':
      return 'es-419'
    default:
      return 'en-US'
  }
}
