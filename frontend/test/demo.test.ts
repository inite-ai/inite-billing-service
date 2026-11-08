// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  DEMO_ORG_ID,
  demoIdentity,
  demoPersona,
  formatDemoLeft,
  minuteBuckets,
  readDemoEnd,
} from '@/lib/demo'
import { requestDemoGrant, DEMO_GRANT_TYPE, DEMO_SUBJECT_TOKEN_TYPE } from '@/lib/demo-grant'
import { demoDoor, type DemoDoorDeps } from '@/lib/demo-door'
import { getUserToken } from '@/lib/middleware/auth'
import { POST as refresh } from '@/app/api/auth/refresh/route'
import en from '@/messages/en.json'
import ru from '@/messages/ru.json'
import pt from '@/messages/pt.json'
import es from '@/messages/es.json'

/**
 * The family demo in billing's own frontend: this public repository cannot
 * use the private `@inite/auth` kit, so it does the same thing itself.
 */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600
const anaToken = (extra: Record<string, unknown> = {}) =>
  jwt({
    sub: 'did:key:z6MkAnaDemo',
    email: 'ana@demo.invalid',
    name: 'Ana Demo',
    org_id: DEMO_ORG_ID,
    org_role: 'owner',
    demo: true,
    exp: inAnHour(),
    ...extra,
  })

describe('the demo tenant id', () => {
  it('is the one INITE Auth fixes (inite-auth-service src/organizations/demo-tenant.ts)', () => {
    // Source of truth: INITE Auth; inite-shared repeats it in @inite/auth/demo.
    expect(DEMO_ORG_ID).toBe('a7a71c00-de00-4000-8000-000000000001')
  })
})

describe('the demo copy', () => {
  // Word for word the kit's DEMO_COPY (inite-shared packages/auth/src/demo-ui.tsx).
  const KIT = {
    ru: ['Войти в демо', 'Это демо: компания и данные вымышленные, изменить ничего нельзя.', 'Осталось {time}.', 'Выйти из демо', 'Демо закончилось.', 'Открыть заново'],
    en: ['Try the demo', 'This is a demo: the company and its data are made up, and nothing can be changed.', '{time} left.', 'Leave the demo', 'The demo has ended.', 'Open it again'],
    pt: ['Experimentar a demonstração', 'Isto é uma demonstração: a empresa e os dados são fictícios, e nada pode ser alterado.', 'Restam {time}.', 'Sair da demonstração', 'A demonstração terminou.', 'Abrir de novo'],
    es: ['Probar la demo', 'Esto es una demo: la empresa y los datos son ficticios, y no se puede cambiar nada.', 'Quedan {time}.', 'Salir de la demo', 'La demo ha terminado.', 'Abrirla de nuevo'],
  }
  const messages = { en, ru, pt, es } as Record<string, { demo: Record<string, string> }>

  it.each(Object.keys(KIT))('%s matches the family banner and button', (lang) => {
    const d = messages[lang].demo
    expect([d.button, d.banner, d.left, d.exit, d.ended, d.again]).toEqual(KIT[lang as keyof typeof KIT])
  })

  it('has no emoji and, in Russian, no long dash', () => {
    for (const lang of Object.keys(messages)) {
      const text = JSON.stringify(messages[lang].demo)
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
      if (lang === 'ru') expect(text).not.toContain('—')
    }
  })

  it('counts down in hours and minutes, never zero while time is left', () => {
    const units = { hours: 'ч', minutes: 'мин' }
    expect(formatDemoLeft(102 * 60_000, units)).toBe('1 ч 42 мин')
    expect(formatDemoLeft(5_000, units)).toBe('1 мин')
    expect(formatDemoLeft(120 * 60_000, units)).toBe('2 ч')
    expect(readDemoEnd('a=1; demo_session=1900000000')?.getTime()).toBe(1_900_000_000_000)
    expect(readDemoEnd('demo_session=1')).toBeNull()
  })
})

describe('demo personas and the visitor bucket', () => {
  it('takes owner, manager, staff, with or without demo:', () => {
    expect(demoPersona('demo:Owner')).toBe('owner')
    expect(demoPersona('staff')).toBe('staff')
    expect(demoPersona('admin')).toBeNull()
  })

  it('lets one address in five times a minute, and everyone thirty', () => {
    const b = minuteBuckets(5, 30)
    const t = 1_800_000_000_000
    for (let i = 0; i < 5; i++) expect(b.take('1.1.1.1', t)).toBe(0)
    expect(b.take('1.1.1.1', t)).toBeGreaterThan(0)
    for (let i = 0; i < 25; i++) expect(b.take(`10.0.0.${i}`, t)).toBe(0)
    expect(b.take('2.2.2.2', t)).toBeGreaterThan(0)
    expect(b.take('1.1.1.1', t + 60_000)).toBe(0)
  })
})

describe('the demo grant', () => {
  const config = (fetchImpl: unknown, clientSecret: string | undefined = 'placeholder-secret') => ({
    authUrl: 'https://auth.example.com/',
    clientId: 'inite-billing',
    clientSecret,
    fetch: fetchImpl as typeof fetch,
  })

  it('asks auth, as this confidential client, for the persona, server-side', async () => {
    const token = anaToken()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: token, expires_in: 7200 })))
    await expect(requestDemoGrant('owner', config(fetchImpl))).resolves.toEqual({ accessToken: token, expiresIn: 7200 })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://auth.example.com/v1/oauth/token')
    const form = new URLSearchParams(String(init.body))
    expect(Object.fromEntries(form)).toEqual({
      grant_type: DEMO_GRANT_TYPE,
      subject_token_type: DEMO_SUBJECT_TOKEN_TYPE,
      subject_token: 'demo:owner',
      client_id: 'inite-billing',
      client_secret: 'placeholder-secret',
    })
  })

  it('refuses a token that is not a demo token of the demo organisation', async () => {
    const real = jwt({ sub: 'did:key:z6MkReal', exp: inAnHour() })
    const other = jwt({ sub: 'x', demo: true, org_id: '11111111-1111-4111-8111-111111111111', exp: inAnHour() })
    for (const t of [real, other]) {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: t })))
      await expect(requestDemoGrant('owner', config(fetchImpl))).resolves.toBeNull()
    }
  })

  it('does nothing without a client secret, and survives auth refusing', async () => {
    const fetchImpl = vi.fn()
    await expect(requestDemoGrant('owner', config(fetchImpl, ''))).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    const refused = vi.fn(async () => new Response('{}', { status: 429 }))
    await expect(requestDemoGrant('owner', config(refused))).resolves.toBeNull()
  })
})

describe('/api/auth/demo', () => {
  const req = (query: string, method = 'GET', ip = '203.0.113.7') =>
    new NextRequest(`https://billing.example.com/api/auth/demo${query}`, {
      method,
      headers: { 'cf-connecting-ip': ip },
    })
  const deps = (over: Partial<DemoDoorDeps> = {}): DemoDoorDeps => ({
    enabled: true,
    grant: vi.fn(async () => ({ accessToken: anaToken(), expiresIn: 7200 })),
    buckets: minuteBuckets(5, 30),
    secure: true,
    now: () => 1_800_000_000_000,
    ...over,
  })

  it('is off unless DEMO_ENABLED=1', async () => {
    const d = deps({ enabled: false })
    expect((await demoDoor(req('?persona=owner'), d)).status).toBe(404)
    expect((await demoDoor(req('', 'HEAD'), d)).status).toBe(404)
    expect(d.grant).not.toHaveBeenCalled()
  })

  it('answers HEAD 204 when on, so the button shows', async () => {
    expect((await demoDoor(req('', 'HEAD'), deps())).status).toBe(204)
  })

  it('signs in with an access cookie only and the readable demo_session, then redirects', async () => {
    const res = await demoDoor(req('?persona=owner&return_to=/subscriptions'), deps())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://billing.example.com/subscriptions')
    const access = res.cookies.get('access_token')!
    expect(access.httpOnly).toBe(true)
    expect(access.maxAge).toBe(7200)
    expect(res.cookies.get('refresh_token')?.value).toBe('')
    expect(res.cookies.get('refresh_token')?.maxAge).toBe(0)
    const demo = res.cookies.get('demo_session')!
    expect(demo.value).toBe(String(1_800_000_000 + 7200))
    expect(demo.httpOnly).toBe(false)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('stays on this site and defaults to Ana', async () => {
    const d = deps()
    const res = await demoDoor(req('?return_to=//evil.example'), d)
    expect(res.headers.get('location')).toBe('https://billing.example.com/dashboard')
    expect(d.grant).toHaveBeenCalledWith('owner')
    expect((await demoDoor(req('?persona=admin'), d)).status).toBe(400)
  })

  it('refuses the sixth try a minute from one address', async () => {
    const d = deps()
    for (let i = 0; i < 5; i++) expect((await demoDoor(req('?persona=staff'), d)).status).toBe(303)
    const res = await demoDoor(req('?persona=staff'), d)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(d.grant).toHaveBeenCalledTimes(5)
  })

  it('sends the visitor back to sign-in when auth refuses', async () => {
    const res = await demoDoor(req('?persona=owner'), deps({ grant: vi.fn(async () => null) }))
    expect(res.headers.get('location')).toBe('https://billing.example.com/login?auth_error=demo_unavailable')
    expect(res.cookies.get('access_token')).toBeUndefined()
  })
})

describe('a demo session in the page', () => {
  it('is Ana, from the token, and never an admin', async () => {
    const token = anaToken({ roles: ['admin'], metadata: { isAdmin: true } })
    expect(demoIdentity(token)).toEqual({ id: 'did:key:z6MkAnaDemo', email: 'ana@demo.invalid', name: 'Ana Demo', orgRole: 'owner' })
    const routed = await getUserToken(new Request('https://b.example.com/', { headers: { cookie: `access_token=${token}` } }))
    expect(routed?.role).toBe('USER')
  })

  it('is nobody once expired or when the token is not a demo one', () => {
    expect(demoIdentity(anaToken({ exp: 1 }))).toBeNull()
    expect(demoIdentity(jwt({ sub: 'did:key:z6MkReal', exp: inAnHour() }))).toBeNull()
  })

  it('survives /api/auth/refresh: no refresh token, the demo is answered, not cleared', async () => {
    const res = await refresh(
      new NextRequest('https://b.example.com/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: `access_token=${anaToken()}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ demo: true, user: { id: 'did:key:z6MkAnaDemo', name: 'Ana Demo' } })
    expect(res.cookies.get('access_token')).toBeUndefined()
  })
})
