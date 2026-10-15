import { describe, expect, it } from 'vitest'
import { defaultPaymentMethod, orderPaymentMethods } from '@/lib/default-rail'

const m = (...codes: string[]) => codes.map((code) => ({ code }))
const codes = (list: { code: string }[]) => list.map((x) => x.code)

describe('default payment method', () => {
  it('prefers PIX, then card, for reais; crypto last', () => {
    const methods = m('CRYPTO', 'LAVA', 'HODLE')
    expect(defaultPaymentMethod(methods, 'BRL')?.code).toBe('HODLE')
    expect(codes(orderPaymentMethods(methods, 'brl'))).toEqual(['HODLE', 'LAVA', 'CRYPTO'])
  })

  it('falls to card for reais when PIX is off', () => {
    expect(defaultPaymentMethod(m('CRYPTO', 'LAVA'), 'BRL')?.code).toBe('LAVA')
  })

  it('prefers card rails for dollars and euros', () => {
    expect(defaultPaymentMethod(m('CRYPTO', 'LAVA', 'STRIPE'), 'USD')?.code).toBe('STRIPE')
    expect(defaultPaymentMethod(m('CRYPTO', 'LAVA'), 'EUR')?.code).toBe('LAVA')
  })

  it('puts unknown rails after card and before crypto, keeping their order', () => {
    expect(codes(orderPaymentMethods(m('CRYPTO', 'ONE', 'HODLE', 'STRIPE'), 'USD'))).toEqual([
      'STRIPE',
      'ONE',
      'HODLE',
      'CRYPTO',
    ])
  })

  it('defaults to crypto only when it is the only way to pay', () => {
    expect(defaultPaymentMethod(m('CRYPTO'), 'BRL')?.code).toBe('CRYPTO')
    expect(defaultPaymentMethod([], 'BRL')).toBeUndefined()
  })

  it('does not mutate the input', () => {
    const methods = m('CRYPTO', 'STRIPE')
    orderPaymentMethods(methods, 'USD')
    expect(codes(methods)).toEqual(['CRYPTO', 'STRIPE'])
  })
})
