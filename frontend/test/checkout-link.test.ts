import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api from '@/lib/api'
import { checkoutLinkHeaders, forgetCheckoutLinkInAddressBar, takeCheckoutLink } from '@/lib/checkout-link'

/**
 * A store's checkout link opens its order without a billing sign-in. The page
 * takes the token from the fragment, keeps it for this order (the buyer comes
 * back from the provider to a bare /checkout/<id>), and its calls never send
 * the buyer off to /login.
 */
describe('checkout link', () => {
  let assigned = ''
  const replaceState = vi.fn()

  const at = (pathname: string, search = '', hash = '') => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://billing.test',
        pathname,
        search,
        hash,
        set href(v: string) {
          assigned = v
        },
        get href() {
          return assigned
        },
      },
    })
  }

  beforeEach(() => {
    assigned = ''
    localStorage.clear()
    replaceState.mockClear()
    vi.spyOn(window.history, 'replaceState').mockImplementation(replaceState)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('takes the token from the fragment', () => {
    at('/checkout/ord-1', '?locale=ru', '#t=secret')
    expect(takeCheckoutLink('ord-1')).toBe('secret')
  })

  it('drops it from the address bar once the page has mounted', () => {
    vi.useFakeTimers()
    at('/checkout/ord-1', '?locale=ru', '#t=secret')
    forgetCheckoutLinkInAddressBar()
    expect(replaceState).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(replaceState.mock.calls[0].slice(1)).toEqual(['', '/checkout/ord-1?locale=ru'])
    vi.useRealTimers()
  })

  it('remembers it for the same order on the way back from the provider', () => {
    at('/checkout/ord-1', '', '#t=secret')
    takeCheckoutLink('ord-1')
    at('/checkout/ord-1', '?returned=1')
    expect(takeCheckoutLink('ord-1')).toBe('secret')
    expect(takeCheckoutLink('ord-2')).toBeNull()
  })

  it('a call through the link stays on the page when it is refused', async () => {
    at('/checkout/ord-1')
    vi.stubGlobal('fetch', vi.fn())
    const refused = api.get('/v1/checkout/sessions/ord-1', {
      ...checkoutLinkHeaders('secret'),
      adapter: async (config) =>
        Promise.reject(
          Object.assign(new Error('401'), {
            config,
            response: { status: 401, data: {}, headers: {}, config, statusText: '' },
          }),
        ),
    })
    await expect(refused).rejects.toBeTruthy()
    expect(assigned).toBe('')
    expect(fetch).not.toHaveBeenCalled()
  })
})
