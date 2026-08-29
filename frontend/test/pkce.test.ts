import { describe, expect, it, vi } from 'vitest'
import {
  decodeJWT,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  isJWTExpired,
} from '@/lib/pkce'

const b64url = (s: string) => Buffer.from(s).toString('base64url')
const token = (payload: object) => `h.${b64url(JSON.stringify(payload))}.sig`

/**
 * PKCE is what stops an intercepted authorization code from being redeemed by
 * anyone else, so the verifier has to be unguessable and the challenge has to
 * be the SHA-256 the authorization server will recompute.
 */
describe('pkce', () => {
  it('generates a verifier inside RFC 7636’s length and alphabet', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()))
    expect(seen.size).toBe(50)
    expect(new Set(Array.from({ length: 50 }, () => generateState())).size).toBe(50)
  })

  it('computes the challenge as base64url(SHA-256(verifier)) — RFC 7636 §B', async () => {
    // The specification's own test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    await expect(generateCodeChallenge(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('produces a url-safe challenge with no padding', async () => {
    const challenge = await generateCodeChallenge(generateCodeVerifier())
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('decodeJWT', () => {
  it('reads the payload', () => {
    expect(decodeJWT(token({ sub: 'user-1', exp: 123 }))).toEqual({ sub: 'user-1', exp: 123 })
  })

  it('returns null for anything that is not a three-part token', () => {
    expect(decodeJWT('not-a-token')).toBeNull()
    expect(decodeJWT('a.b')).toBeNull()
  })

  it('returns null rather than throwing on a corrupt payload', () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(decodeJWT('h.@@@@.s')).toBeNull()
    noise.mockRestore()
  })
})

describe('isJWTExpired', () => {
  const inSeconds = (offsetMs: number) => Math.floor((Date.now() + offsetMs) / 1000)

  it('treats a token with plenty of life as live', () => {
    expect(isJWTExpired(token({ exp: inSeconds(10 * 60_000) }))).toBe(false)
  })

  it('treats an expired token as expired', () => {
    expect(isJWTExpired(token({ exp: inSeconds(-60_000) }))).toBe(true)
  })

  it('expires a token a minute early, so it cannot die mid-request', () => {
    expect(isJWTExpired(token({ exp: inSeconds(30_000) }))).toBe(true)
  })

  it('treats an undecodable or claimless token as expired', () => {
    expect(isJWTExpired('garbage')).toBe(true)
    expect(isJWTExpired(token({ sub: 'user-1' }))).toBe(true)
  })
})
