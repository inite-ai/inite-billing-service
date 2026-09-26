import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '@/lib/oauth-client'

describe('silent SSO', () => {
  let assigned = ''

  beforeEach(() => {
    sessionStorage.clear()
    assigned = ''
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://billing.test',
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

  it('tries prompt=none first', async () => {
    await OAuthClient.login()
    expect(new URL(assigned).searchParams.get('prompt')).toBe('none')
  })

  it('asks interactively when told to', async () => {
    await OAuthClient.login({ interactive: true })
    expect(new URL(assigned).searchParams.has('prompt')).toBe(false)
  })

  it('falls back to the interactive sign-in once after a silent miss', async () => {
    await OAuthClient.login()
    expect(OAuthClient.shouldFallBackToInteractive('login_required')).toBe(true)
    // The marker is spent: a failure of the interactive sign-in is an error, not another bounce.
    expect(OAuthClient.shouldFallBackToInteractive('login_required')).toBe(false)
  })

  it('does not fall back on errors that are not about needing the person', async () => {
    await OAuthClient.login()
    expect(OAuthClient.shouldFallBackToInteractive('access_denied')).toBe(false)
  })
})
