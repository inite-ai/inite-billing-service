import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@/lib/safe-redirect'

/**
 * The post-login redirect was guarded by `startsWith('/')`, which is not a
 * same-origin check: `//evil.example` is a protocol-relative URL and
 * `/\evil.example` is normalised to one by every browser. Either turns the
 * OAuth callback into an open redirect — a link that signs the victim into the
 * real site and drops them on someone else's page holding a fresh session.
 */
describe('safeReturnTo', () => {
  it('keeps a plain path, with its query and hash', () => {
    expect(safeReturnTo('/orders?status=paid#row-3')).toBe('/orders?status=paid#row-3')
  })

  it.each([
    ['//evil.example', 'protocol-relative'],
    ['/\\evil.example', 'backslash, normalised to protocol-relative'],
    ['/\\\\evil.example', 'double backslash'],
    ['https://evil.example/x', 'absolute URL'],
    ['http://evil.example', 'absolute URL, plain http'],
    ['javascript:alert(1)', 'script URL'],
    ['evil.example', 'bare host'],
  ])('refuses %s (%s)', (input) => {
    expect(safeReturnTo(input)).toBe('/dashboard')
  })

  it('falls back when there is nothing to go back to', () => {
    expect(safeReturnTo(null)).toBe('/dashboard')
    expect(safeReturnTo(undefined)).toBe('/dashboard')
    expect(safeReturnTo('')).toBe('/dashboard')
  })

  it('takes the caller’s fallback', () => {
    expect(safeReturnTo('//evil.example', '/catalog')).toBe('/catalog')
  })

  it('does not let a path escape by traversal', () => {
    // `new URL` resolves this against the origin, so it cannot climb out of it.
    expect(safeReturnTo('/../../etc/passwd')).toBe('/etc/passwd')
  })
})
