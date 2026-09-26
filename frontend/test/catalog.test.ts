import { describe, expect, it } from 'vitest'
import {
  currenciesOf,
  formatMoney,
  guessCurrency,
  humanizeKey,
  isFeatureKey,
  oneOffPricesFor,
  priceFor,
  resolveCurrency,
  yearlySaving,
} from '@/lib/catalog'
import type { Price, Product } from '@/lib/types'

let n = 0
const price = (currency: string, amount: string, interval?: string, metadata?: Record<string, unknown>): Price => ({
  id: `p${++n}`,
  productId: 'x',
  code: `c${n}`,
  currency,
  amount,
  interval,
  isActive: true,
  metadata,
})
const product = (prices: Price[], type: Product['type'] = 'subscription'): Product => ({
  id: 'x',
  code: 'x',
  name: 'X',
  moduleScope: 'x',
  type,
  isActive: true,
  prices,
})

const rent = product([
  price('USD', '49', 'month'),
  price('USD', '470', 'year'),
  price('BRL', '249', 'month'),
  price('RUB', '4490', 'month'),
  price('RUB', '42990', 'year'),
])

describe('currency', () => {
  it('guesses from the language, then the browser region', () => {
    expect(guessCurrency('ru')).toBe('RUB')
    expect(guessCurrency('en', 'pt-BR')).toBe('BRL')
    expect(guessCurrency('en', 'de-DE')).toBe('EUR')
    expect(guessCurrency('en', 'en-US')).toBe('USD')
  })

  it('takes the first wanted currency on offer, else dollars', () => {
    expect(resolveCurrency(['USD', 'BRL'], null, 'RUB', 'BRL')).toBe('BRL')
    expect(resolveCurrency(['EUR', 'USD'], 'RUB')).toBe('USD')
    expect(resolveCurrency(['EUR'], 'RUB')).toBe('EUR')
  })

  it('lists currencies with dollars first', () => {
    expect(currenciesOf([rent])).toEqual(['USD', 'BRL', 'RUB'])
  })
})

describe('price for a currency', () => {
  it('shows the price in the chosen currency', () => {
    expect(priceFor(rent, 'RUB', 'month')?.amount).toBe('4490')
  })

  it('falls back to dollars when a price is missing in that currency', () => {
    expect(priceFor(rent, 'BRL', 'year')?.currency).toBe('USD')
  })

  it('computes the yearly saving within one currency', () => {
    expect(yearlySaving(rent, 'USD')).toBe(20)
    expect(yearlySaving(rent, 'RUB')).toBe(20)
  })

  it('offers every pack of a one-off product in the shown currency', () => {
    const pack = product(
      [price('USD', '15', undefined, { credits: 500 }), price('BRL', '75'), price('USD', '50', undefined, { credits: 2000 })],
      'one_time',
    )
    expect(oneOffPricesFor(pack, 'USD').map((p) => p.amount)).toEqual(['15', '50'])
    expect(oneOffPricesFor(pack, 'RUB').map((p) => p.currency)).toEqual(['USD', 'USD'])
  })

  it('formats with the currency’s own symbol', () => {
    expect(formatMoney('29', 'USD', 'en')).toBe('$29')
    expect(formatMoney('145', 'BRL', 'en')).toBe('R$145')
    expect(formatMoney('4490', 'RUB', 'ru')).toMatch(/4\s490\s₽/)
  })
})

describe('feature names', () => {
  it('tells machine keys from sentences', () => {
    expect(isFeatureKey('custom-domain')).toBe(true)
    expect(isFeatureKey('multiCompany')).toBe(true)
    expect(isFeatureKey('Reels & Stories')).toBe(false)
    expect(isFeatureKey('500 credits/month')).toBe(false)
  })

  it('spells a key out', () => {
    expect(humanizeKey('ai-damage-detection')).toBe('Ai damage detection')
    expect(humanizeKey('multiCompany')).toBe('Multi company')
  })
})
