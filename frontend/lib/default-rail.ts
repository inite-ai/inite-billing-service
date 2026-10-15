/**
 * Which payment method the checkout offers first.
 *
 * The page used to preselect whatever the API listed first — crypto, for a
 * 49 BRL book bought from Brazil. The order now follows the money: PIX and
 * then card for reais, card rails for everything else, and crypto last. It is
 * only the default when it is the only way to pay.
 */
const PREFERENCE: Record<string, string[]> = {
  BRL: ['HODLE', 'LAVA', 'STRIPE'],
}
const CARD_FIRST = ['STRIPE', 'LAVA']
const LAST = ['CRYPTO']

function rank(code: string, currency: string | null | undefined): number {
  const preferred = PREFERENCE[(currency ?? '').toUpperCase()] ?? CARD_FIRST
  const i = preferred.indexOf(code)
  if (i >= 0) return i
  return LAST.includes(code) ? preferred.length + 1 : preferred.length
}

/** The methods in the order the page shows them; ties keep the API's order. */
export function orderPaymentMethods<T extends { code: string }>(methods: T[], currency: string | null | undefined): T[] {
  return methods
    .map((method, index) => ({ method, index, rank: rank(method.code, currency) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.method)
}

/** The method selected when the page opens, or undefined when there is none. */
export function defaultPaymentMethod<T extends { code: string }>(
  methods: T[],
  currency: string | null | undefined,
): T | undefined {
  return orderPaymentMethods(methods, currency)[0]
}
