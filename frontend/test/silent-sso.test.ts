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

  it('asks the identity provider for the page language', async () => {
    document.documentElement.lang = 'pt'
    await OAuthClient.login({ interactive: true })
    expect(new URL(assigned).searchParams.get('ui_locales')).toBe('pt')
    document.documentElement.lang = ''
  })

  it('falls back to the locale cookie when the page names no language', async () => {
    document.documentElement.lang = ''
    document.cookie = 'locale=es; path=/'
    await OAuthClient.login()
    expect(new URL(assigned).searchParams.get('ui_locales')).toBe('es')
    document.cookie = 'locale=; path=/; max-age=0'
  })

  it('sends no ui_locales when nothing names a supported language', async () => {
    document.documentElement.lang = 'de'
    await OAuthClient.login()
    expect(new URL(assigned).searchParams.has('ui_locales')).toBe(false)
    document.documentElement.lang = ''
  })

  it('does not fall back on errors that are not about needing the person', async () => {
    await OAuthClient.login()
    expect(OAuthClient.shouldFallBackToInteractive('access_denied')).toBe(false)
  })
})
