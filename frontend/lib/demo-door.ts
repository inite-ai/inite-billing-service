/**
 * `/api/auth/demo?persona=owner|manager|staff&return_to=/path`: the demo
 * button's door, the same contract as the `@inite/auth` kit's.
 *
 * Off (404) unless `DEMO_ENABLED=1`. A visitor gets 5 a minute, the process
 * 30 (auth's per-client limit). It asks auth for the persona's token
 * (lib/demo-grant.ts), replaces whatever session the browser had with an
 * access cookie only (no refresh token may outlive the demo and bring the
 * earlier session back), writes the readable `demo_session` with the demo's
 * end, and redirects. HEAD answers 204 when the demo is on, so a page can
 * show its button only then.
 */

import { NextRequest, NextResponse } from 'next/server'
import { safeReturnTo } from './safe-redirect'
import { clientIp, DEMO_SESSION_COOKIE, demoPersona, minuteBuckets } from './demo'
import { requestDemoGrant, type DemoGrant } from './demo-grant'
import type { DemoPersona } from './demo'

export interface DemoDoorDeps {
  enabled: boolean
  grant: (persona: DemoPersona) => Promise<DemoGrant | null>
  buckets: { take(key: string, nowMs?: number): number }
  secure: boolean
  now?: () => number
}

const sharedBuckets = minuteBuckets(5, 30)

export function demoDoorDeps(): DemoDoorDeps {
  return {
    enabled: process.env.DEMO_ENABLED === '1',
    grant: (persona) => requestDemoGrant(persona),
    buckets: sharedBuckets,
    secure: process.env.NODE_ENV === 'production',
  }
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }

export async function demoDoor(request: NextRequest, deps: DemoDoorDeps = demoDoorDeps()): Promise<NextResponse> {
  if (!deps.enabled) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  if (request.method === 'HEAD') return new NextResponse(null, { status: 204, headers: NO_STORE })

  const params = request.nextUrl.searchParams
  const returnTo = safeReturnTo(params.get('return_to') ?? params.get('returnTo'), '/dashboard')
  const raw = params.get('persona')
  const persona = raw === null ? 'owner' : demoPersona(raw)
  if (!persona) return NextResponse.json({ error: 'invalid_persona' }, { status: 400, headers: NO_STORE })

  const retry = deps.buckets.take(clientIp(request.headers))
  if (retry) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retry) } },
    )
  }

  const grant = await deps.grant(persona)
  if (!grant) {
    const back = new URL('/login', request.url)
    back.searchParams.set('auth_error', 'demo_unavailable')
    return NextResponse.redirect(back, { status: 303, headers: NO_STORE })
  }

  const now = deps.now?.() ?? Date.now()
  const response = NextResponse.redirect(new URL(returnTo, request.url), { status: 303, headers: NO_STORE })
  response.cookies.set('access_token', grant.accessToken, {
    httpOnly: true,
    secure: deps.secure,
    sameSite: 'lax',
    maxAge: grant.expiresIn,
    path: '/',
  })
  response.cookies.set('refresh_token', '', {
    httpOnly: true,
    secure: deps.secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  response.cookies.set(DEMO_SESSION_COOKIE, String(Math.floor(now / 1000) + grant.expiresIn), {
    httpOnly: false,
    secure: deps.secure,
    sameSite: 'lax',
    maxAge: grant.expiresIn,
    path: '/',
  })
  return response
}
