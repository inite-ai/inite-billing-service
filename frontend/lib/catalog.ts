import type { Price, Product } from './types'

/** A service with the products it sells, as the storefront returns it. */
export interface StorefrontService {
  id: string
  code: string
  name: string
  products: Product[]
}

export type Interval = 'month' | 'year'

const EURO_REGIONS = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
])

/**
 * The currency a visitor most likely pays in, from the interface language and
 * the browser's region: roubles for Russian, reais in Brazil, pesos in
 * Argentina, euros in the eurozone, dollars otherwise. Only a guess to start
 * from — the page lets them switch, and remembers it.
 */
export function guessCurrency(locale: string, browserLanguage?: string): string {
  if (locale === 'ru') return 'RUB'
  const region = browserLanguage?.split('-')[1]?.toUpperCase()
  if (region === 'BR') return 'BRL'
  if (region === 'AR') return 'ARS'
  if (region === 'RU') return 'RUB'
  if (region && EURO_REGIONS.has(region)) return 'EUR'
  return 'USD'
}

/** The first of the wanted currencies that is on offer, else the first on offer. */
export function resolveCurrency(available: string[], ...wanted: (string | null | undefined)[]): string {
  for (const c of wanted) if (c && available.includes(c)) return c
  if (available.includes('USD')) return 'USD'
  return available[0] ?? 'USD'
}

/** Every currency a set of products can be paid in, dollars first. */
export function currenciesOf(products: Product[]): string[] {
  const set = new Set<string>()
  for (const p of products) for (const pr of p.prices ?? []) if (pr.isActive) set.add(pr.currency)
  return [...set].sort((a, b) => (a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b)))
}

export function formatMoney(amount: number | string, currency: string, locale: string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    // A code Intl does not know: still say what it is.
    return `${n.toLocaleString()} ${currency}`
  }
}

const active = (product: Product) => (product.prices ?? []).filter((p) => p.isActive)

/**
 * The price to show for a product in a currency: the one in that currency if
 * there is one, else dollars, else whatever the product is sold in — a
 * product priced only in euros still shows, in euros.
 */
export function priceFor(product: Product, currency: string, interval: Interval | null): Price | undefined {
  const candidates = active(product).filter((p) => (interval ? p.interval === interval : !p.interval))
  return (
    candidates.find((p) => p.currency === currency) ??
    candidates.find((p) => p.currency === 'USD') ??
    candidates[0]
  )
}

/** All one-off prices of a product in the currency shown (credit packs have several). */
export function oneOffPricesFor(product: Product, currency: string): Price[] {
  const once = active(product).filter((p) => !p.interval)
  const inCurrency = once.filter((p) => p.currency === currency)
  if (inCurrency.length) return inCurrency
  const usd = once.filter((p) => p.currency === 'USD')
  if (usd.length) return usd
  const first = once[0]?.currency
  return once.filter((p) => p.currency === first)
}

/** Percent saved by paying yearly, in the same currency, or 0. */
export function yearlySaving(product: Product, currency: string): number {
  const monthly = priceFor(product, currency, 'month')
  const yearly = priceFor(product, currency, 'year')
  if (!monthly || !yearly || monthly.currency !== yearly.currency) return 0
  const m = Number(monthly.amount)
  const y = Number(yearly.amount)
  if (!(m > 0)) return 0
  return Math.max(0, Math.round((1 - y / (m * 12)) * 100))
}

export function meta(product: Product): Record<string, unknown> {
  return (product.metadata ?? {}) as Record<string, unknown>
}

export const isAddon = (product: Product) => meta(product).isAddon === true
export const isHighlighted = (product: Product) => {
  const v = meta(product).highlighted
  return v === true || v === 'true'
}

/** The description in the interface language (`description_ru`) if written, else the default one. */
export function description(product: Product, locale?: string): string | undefined {
  const m = meta(product)
  for (const v of [locale ? m[`description_${locale}`] : undefined, m.description]) {
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

export function features(product: Product): string[] {
  const v = meta(product).features
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return v.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

export function numberMeta(product: Product, key: string): number | null | undefined {
  const v = meta(product)[key]
  if (v === null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

/**
 * Whether a feature entry is a machine key (`custom-domain`, `multiCompany`)
 * rather than a sentence someone wrote for customers (`Reels & Stories`).
 */
export function isFeatureKey(feature: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9]*([-_:.][a-zA-Z0-9]+)*$/.test(feature) && !/\s/.test(feature)
}

/** `custom-domain` → `Custom domain`, `multiCompany` → `Multi company`. */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_:.\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Sort key: the monthly (or one-off) amount in the shown currency. */
export function sortAmount(product: Product, currency: string): number {
  const p = priceFor(product, currency, 'month') ?? priceFor(product, currency, 'year') ?? priceFor(product, currency, null)
  const n = p ? Number(p.amount) : Number.POSITIVE_INFINITY
  return p?.interval === 'year' ? n / 12 : n
}
