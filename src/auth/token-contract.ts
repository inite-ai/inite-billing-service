import { ConfigService } from '@nestjs/config';

/**
 * Which `iss` and `aud` values billing accepts on a token from INITE Auth.
 *
 * The rules are the INITE Triad token contract
 * (inite-triad/docs/compatibility.md):
 *  - `iss` is compared exactly, but JWT_ISSUER may be a comma-separated list
 *    (an issuer migration accepts old and new for one minor) and a trailing
 *    slash is not a different issuer. The FIRST entry is this deployment's
 *    issuer: the one advertised in discovery and used to recognise an
 *    agent's did:web.
 *  - `aud`, when pinned with JWT_AUDIENCE, is one of the configured values
 *    (the billing frontend's client id, `inite-billing` by default) or one
 *    of billing's own OAuth resources — the MCP endpoint, the wallet MCP
 *    and the agent wallet API. Those are what an RFC 8707 client asks INITE
 *    Auth for, so pinning the audience can never lock them out.
 */

/** INITE's own issuer, the default when JWT_ISSUER is unset (dev). */
export const DEFAULT_ISSUER = 'https://auth-api.inite.ai';

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Every accepted `iss`, each with and without a trailing slash; empty = unpinned. */
export function acceptedIssuers(raw: string | undefined): string[] {
  return [...new Set(list(raw).flatMap((iss) => [iss, `${iss}/`]))];
}

/** This deployment's issuer (first JWT_ISSUER entry), without a trailing slash. */
export function primaryIssuer(config: Pick<ConfigService, 'get'>): string {
  return list(config.get<string>('JWT_ISSUER'))[0] ?? DEFAULT_ISSUER;
}

/** Billing's public origin — the base of every resource it answers for. */
export function billingBaseUrl(config: Pick<ConfigService, 'get'>): string {
  return (config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai').replace(/\/+$/, '');
}

/** The OAuth resources billing itself advertises (RFC 9728). */
export function billingResources(config: Pick<ConfigService, 'get'>): string[] {
  const base = billingBaseUrl(config);
  return [`${base}/mcp`, `${base}/mcp/wallet`, `${base}/v1/agent-wallet`];
}

/**
 * The `aud` allow-list, or undefined when JWT_AUDIENCE is unset (audience
 * then is checked per endpoint only — see McpResourceGuard and the wallet
 * guards).
 */
export function acceptedAudiences(config: Pick<ConfigService, 'get'>): string[] | undefined {
  const configured = (config.get<string>('JWT_AUDIENCE') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (configured.length === 0) return undefined;
  return [...new Set([...configured, ...billingResources(config)])];
}
