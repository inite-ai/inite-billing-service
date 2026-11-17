/**
 * The demo grant (INITE Auth): this frontend's server, as its own
 * confidential client, asks auth for a demo persona's token. RFC 8693 token
 * exchange with a subject of auth's own type:
 *
 *   grant_type=urn:ietf:params:oauth:grant-type:token-exchange
 *   subject_token_type=urn:inite:params:oauth:token-type:demo-persona
 *   subject_token=demo:owner | demo:manager | demo:staff
 *
 * Auth answers with an access token only (no refresh token, no id token),
 * `expires_in` 7200, scope `openid profile billing:read`, claims `demo: true`
 * and the demo organisation. Server-side only: the client secret never
 * leaves this process.
 */

import { decodeJWT } from './pkce'
import { DEMO_ORG_ID, type DemoPersona } from './demo'

export const DEMO_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const DEMO_SUBJECT_TOKEN_TYPE = 'urn:inite:params:oauth:token-type:demo-persona'

export interface DemoGrant {
  accessToken: string
  expiresIn: number
}

export interface DemoGrantConfig {
  authUrl: string
  clientId: string
  clientSecret: string | undefined
  fetch?: typeof fetch
}

export function demoGrantConfig(): DemoGrantConfig {
  return {
    authUrl: process.env.AUTH_SERVICE_URL || process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai',
    clientId: process.env.OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'inite-billing',
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
  }
}

/**
 * Ask auth for `persona`'s token. Null when the secret is missing, auth
 * refuses or is unreachable, or what it returns is not a demo token of the
 * demo organisation: only such a token may sign a visitor in through the
 * demo door.
 */
export async function requestDemoGrant(persona: DemoPersona, config: DemoGrantConfig = demoGrantConfig()): Promise<DemoGrant | null> {
  if (!config.clientSecret) {
    console.error('[demo] OAUTH_CLIENT_SECRET is not set: the demo grant needs a confidential client')
    return null
  }
  const doFetch = config.fetch ?? fetch
  let res: Response
  try {
    res = await doFetch(`${config.authUrl.replace(/\/+$/, '')}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: DEMO_GRANT_TYPE,
        subject_token_type: DEMO_SUBJECT_TOKEN_TYPE,
        subject_token: `demo:${persona}`,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      cache: 'no-store',
    })
  } catch {
    console.error('[demo] demo grant: auth unreachable')
    return null
  }
  if (!res.ok) {
    console.error('[demo] demo grant refused:', res.status)
    return null
  }
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null
  const accessToken = typeof body?.access_token === 'string' ? body.access_token : null
  if (!accessToken) return null
  const claims = decodeJWT(accessToken)
  if (claims?.demo !== true || claims.org_id !== DEMO_ORG_ID) {
    console.error('[demo] demo grant returned a token that is not a demo token; refused')
    return null
  }
  const expiresIn =
    typeof body?.expires_in === 'number' && body.expires_in > 0 ? Math.min(body.expires_in, 7200) : 7200
  return { accessToken, expiresIn }
}
