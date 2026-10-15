import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '@/lib/oauth-client'

/**
 * A sign-in started on /checkout/<id> and finished in another tab — the magic
 * link from the INITE email opens one — still exchanges its code and returns
 * to the checkout, not to /dashboard.
 */
describe('sign-in finished in another tab', () => {
  let assigned = ''
  const tokenCalls: Array<Record<string, string>> = []

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    assigned = ''
    tokenCalls.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/auth/token') {
          tokenCalls.push(JSON.parse(String(init?.body)))
          return new Response(JSON.stringify({ id_token: 'id', expires_in: 900 }))
        }
        return new Response('{}')
      }),
    )
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://billing.test',
        search: '',
        set href(v: string) {
          assigned = v
        },
        get href() {
          return assigned
        },
      },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  /** What a fresh tab of the same origin has: localStorage, no sessionStorage. */
  function openNewTab() {
    sessionStorage.clear()
  }

  it('exchanges the code with the verifier and returns to the checkout', async () => {
    await OAuthClient.login({ interactive: true, returnTo: '/checkout/cs_1?locale=pt' })
    const authorize = new URL(assigned)
    const state = authorize.searchParams.get('state')!

    openNewTab()
    const result = await OAuthClient.handleCallback('code-1', state)

    expect(result.returnTo).toBe('/checkout/cs_1?locale=pt')
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0].code).toBe('code-1')
    expect(tokenCalls[0].code_verifier).toBeTruthy()
  })

  it('still works in the tab that started it, and keeps the returnTo there too', async () => {
    await OAuthClient.login({ interactive: true, returnTo: '/checkout/cs_2' })
    expect(sessionStorage.getItem('returnTo')).toBe('/checkout/cs_2')
    const state = new URL(assigned).searchParams.get('state')!
    const result = await OAuthClient.handleCallback('code-2', state)
    expect(result.returnTo).toBe('/checkout/cs_2')
  })

  it('carries the returnTo from the silent attempt into the interactive one', async () => {
    await OAuthClient.login({ returnTo: '/checkout/cs_3' })
    expect(OAuthClient.shouldFallBackToInteractive('login_required')).toBe(true)
    await OAuthClient.login({ interactive: true })
    const state = new URL(assigned).searchParams.get('state')!
    openNewTab()
    const result = await OAuthClient.handleCallback('code-3', state)
    expect(result.returnTo).toBe('/checkout/cs_3')
  })

  it('refuses a state no tab of this origin started', async () => {
    await OAuthClient.login({ interactive: true, returnTo: '/checkout/cs_4' })
    await expect(OAuthClient.handleCallback('code', 'forged-state')).rejects.toThrow(/State mismatch/)
    expect(tokenCalls).toHaveLength(0)
  })

  it('spends the pending sign-in: a replayed callback is refused', async () => {
    await OAuthClient.login({ interactive: true, returnTo: '/checkout/cs_5' })
    const state = new URL(assigned).searchParams.get('state')!
    openNewTab()
    await OAuthClient.handleCallback('code-5', state)
    openNewTab()
    await expect(OAuthClient.handleCallback('code-5', state)).rejects.toThrow(/State mismatch/)
  })

  it('ignores a pending sign-in older than its lifetime', async () => {
    vi.useFakeTimers()
    try {
      await OAuthClient.login({ interactive: true, returnTo: '/checkout/cs_6' })
      const state = new URL(assigned).searchParams.get('state')!
      vi.advanceTimersByTime(31 * 60 * 1000)
      openNewTab()
      await expect(OAuthClient.handleCallback('code-6', state)).rejects.toThrow(/State mismatch/)
    } finally {
      vi.useRealTimers()
    }
  })
})
