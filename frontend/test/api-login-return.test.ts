import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api from '@/lib/api'

/**
 * A buyer without a billing session opens a checkout link. The API answers
 * 401, the refresh fails, and the interceptor sent them to a bare `/login`:
 * after signing in they landed on the dashboard and the order was gone.
 */
describe('api: sign-in after a lost session', () => {
  let assigned = ''

  const at = (pathname: string, search = '') => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://billing.test',
        pathname,
        search,
        set href(v: string) {
          assigned = v
        },
        get href() {
          return assigned
        },
      },
    })
  }

  const unauthorized = () =>
    api.get('/v1/checkout/sessions/ord-1', {
      adapter: async (config) =>
        Promise.reject(
          Object.assign(new Error('401'), {
            config,
            response: { status: 401, data: {}, headers: {}, config, statusText: '' },
          }),
        ),
    })

  beforeEach(() => {
    assigned = ''
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('comes back to the checkout it left', async () => {
    at('/checkout/ord-1', '?locale=pt')
    await expect(unauthorized()).rejects.toBeTruthy()
    expect(assigned).toBe(`/login?returnTo=${encodeURIComponent('/checkout/ord-1?locale=pt')}`)
  })

  it('does not point the login page back at itself', async () => {
    at('/login')
    await expect(unauthorized()).rejects.toBeTruthy()
    expect(assigned).toBe('/login')
  })
})
