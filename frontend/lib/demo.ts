/**
 * The family demo, as billing's own frontend does it.
 *
 * Every INITE product offers the same read-only demo of one made-up company,
 * «Atlântica Group (demo)», a tenant of INITE Auth. The other products get it
 * from the private `@inite/auth` kit (inite-shared); this repository is public
 * and cannot import it, so the same pieces live here:
 *
 *   - the ids, pinned (source of truth: INITE Auth,
 *     inite-auth-service `src/organizations/demo-tenant.ts`; the backend pins
 *     the same in `src/common/demo-tenant.ts`, and tests hold both to it);
 *   - the per-visitor bucket in front of `/api/auth/demo` (auth allows a
 *     client 30 grants a minute; one visitor gets 5);
 *   - the readable `demo_session` cookie (the demo's end, in Unix seconds), so
 *     the banner counts down without asking the server.
 *
 * The banner and button copy is in `messages/*.json` under `demo`, word for
 * word the kit's `DEMO_COPY` (`test/demo.test.ts` checks it).
 */

import { decodeJWT } from './pkce'

export const DEMO_ORG_ID = 'a7a71c00-de00-4000-8000-000000000001'
export const DEMO_ORG_SLUG = 'demo'
export const DEMO_ORG_NAME = 'Atlântica Group (demo)'

/** The readable cookie with the demo's end (Unix seconds). */
export const DEMO_SESSION_COOKIE = 'demo_session'

/** Ana (owner), Bruno (org admin), Carla (member). */
export const DEMO_PERSONAS = ['owner', 'manager', 'staff'] as const
export type DemoPersona = (typeof DEMO_PERSONAS)[number]

/** `owner` or `demo:owner` → `owner`; anything else → null. */
export function demoPersona(value: string | null | undefined): DemoPersona | null {
  const v = (value ?? '').trim().toLowerCase().replace(/^demo:/, '')
  return (DEMO_PERSONAS as readonly string[]).includes(v) ? (v as DemoPersona) : null
}

/** Whether a token's claims are a demo persona's: the flag, or the demo organisation. */
export function isDemoClaims(claims: Record<string, unknown> | null | undefined): boolean {
  if (!claims) return false
  if (claims.demo === true) return true
  return typeof claims.org_id === 'string' && claims.org_id.toLowerCase() === DEMO_ORG_ID
}

/** The demo's end from the cookie's value, or null when it is not a time. */
export function demoEndsAt(cookieValue: string | null | undefined): Date | null {
  const n = Number(cookieValue)
  return Number.isFinite(n) && n > 1_000_000_000 ? new Date(n * 1000) : null
}

/** The demo's end from `document.cookie`, or null outside a demo (or a browser). */
export function readDemoEnd(cookie: string = typeof document === 'undefined' ? '' : document.cookie): Date | null {
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === DEMO_SESSION_COOKIE) {
      try {
        return demoEndsAt(decodeURIComponent(rest.join('=')))
      } catch {
        return null
      }
    }
  }
  return null
}

/** "1 ч 42 мин", "12 мин", "1 мин" (never "0 мин" while time is left). */
export function formatDemoLeft(ms: number, units: { hours: string; minutes: string }): string {
  const total = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} ${units.minutes}`
  return m ? `${h} ${units.hours} ${m} ${units.minutes}` : `${h} ${units.hours}`
}

/** `/api/auth/demo?persona=…&return_to=…`: open the demo as one persona. */
export function demoSignInHref(persona: DemoPersona = 'owner', returnTo = '/dashboard'): string {
  return `/api/auth/demo?${new URLSearchParams({ persona, return_to: returnTo })}`
}

/** `/api/auth/logout?return_to=…`: leave the demo (or any session) and land on a path here. */
export function signOutHref(returnTo = '/'): string {
  return `/api/auth/logout?${new URLSearchParams({ return_to: returnTo })}`
}

export interface DemoIdentity {
  id: string
  email: string
  name: string
  orgRole: string | null
}

/**
 * Who a demo access token is, for the page (never for a decision: the API
 * verifies the token). Null for anything but an unexpired demo token.
 */
export function demoIdentity(accessToken: string | null | undefined, nowMs = Date.now()): DemoIdentity | null {
  if (!accessToken) return null
  const claims = decodeJWT(accessToken)
  if (!claims || !isDemoClaims(claims)) return null
  if (typeof claims.exp !== 'number' || nowMs >= claims.exp * 1000) return null
  if (typeof claims.sub !== 'string' || !claims.sub) return null
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : '',
    orgRole: typeof claims.org_role === 'string' ? claims.org_role.toLowerCase() : null,
  }
}

/** The visitor's address: Cloudflare's, then the proxy's, then the first forwarded hop. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

/**
 * Fixed one-minute windows, in this process: `perKey` for one address, `total`
 * for all together (auth's per-client limit), and a bounded map so a flood of
 * addresses cannot grow it. `take` gives the seconds to wait when refused, else 0.
 */
export function minuteBuckets(perKey: number, total: number, maxKeys = 10_000) {
  let window = 0
  let all = 0
  const counts = new Map<string, number>()
  return {
    take(key: string, nowMs = Date.now()): number {
      const w = Math.floor(nowMs / 60_000)
      if (w !== window) {
        window = w
        all = 0
        counts.clear()
      }
      const retry = Math.max(1, Math.ceil(((w + 1) * 60_000 - nowMs) / 1000))
      const n = counts.get(key) ?? 0
      if (n >= perKey || all >= total) return retry
      if (!counts.has(key) && counts.size >= maxKeys) return retry
      counts.set(key, n + 1)
      all += 1
      return 0
    },
  }
}
