import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { Request } from 'express';
import { acceptedAudiences, acceptedIssuers } from '../token-contract';

export interface JwtPayload {
  /** The person's DID (did:key:…), or an agent's own did:web — never a UUID. */
  sub: string;
  roles?: string[];
  email?: string;
  /** Whether the identity provider has confirmed the address belongs to this user. */
  email_verified?: boolean;
  /** Who acts for `sub` (RFC 8693): an AI agent, named by its DID. */
  act?: { sub?: string; client_id?: string };
  aud?: string | string[];
  scope?: string;
  authorization_details?: Array<Record<string, unknown>>;
  /**
   * The organisation the person acts for (INITE Auth Organization.id), with
   * RBAC token claims on. One org per token: the client's tenant, else the
   * person's first membership.
   */
  org_id?: string;
  /** The person's role in that organisation (Membership.role). */
  org_role?: string;
}

const ORG_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The token's organisation and role, only when `org_id` is a well-formed id. */
export function orgOf(payload: Pick<JwtPayload, 'org_id' | 'org_role'>): {
  orgId?: string;
  orgRole?: string;
} {
  if (typeof payload.org_id !== 'string' || !ORG_ID.test(payload.org_id)) return {};
  return {
    orgId: payload.org_id.toLowerCase(),
    ...(typeof payload.org_role === 'string' && payload.org_role
      ? { orgRole: payload.org_role.toLowerCase() }
      : {}),
  };
}

/** Extract JWT from Authorization header OR access_token cookie */
function extractJwt(req: Request): string | null {
  // Try Authorization: Bearer ... header first
  const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (fromHeader) return fromHeader;

  // Fall back to httpOnly cookie
  return req?.cookies?.access_token || null;
}

export function buildJwtOptions(configService: ConfigService): StrategyOptionsWithoutRequest {
  const logger = new Logger('JwtStrategy');
  const jwtSecret = configService.get<string>('JWT_SECRET');
  const authServiceUrl = configService.get<string>('AUTH_SERVICE_URL');

  // Pin the token issuer. Without it any token this JWKS can verify is accepted,
  // including one minted by a different issuer that happens to publish keys we
  // trust. passport-jwt forwards it to jsonwebtoken.verify, which enforces `iss`.
  // JWT_ISSUER may list several issuers (comma-separated) while an issuer moves;
  // a trailing slash on either side is the same issuer.
  //
  // Required in production, for the same reason AUTH_SERVICE_URL is: an
  // unpinned issuer is a configuration mistake, and the failure it produces is
  // silent acceptance rather than a visible error.
  const issuers = acceptedIssuers(configService.get<string>('JWT_ISSUER'));
  const issuer = issuers.length > 0 ? issuers : undefined;
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  if (isProduction && !issuer) {
    throw new Error(
      'JWT_ISSUER is required in production: it is the `iss` claim this service ' +
        'will accept. Unset, any token the configured JWKS can verify is accepted, ' +
        "whoever issued it. Set it to the identity provider's issuer URL — note " +
        'that this is the value in the token, which is not necessarily the same ' +
        'host as AUTH_SERVICE_URL.',
    );
  }

  // Audience: pinned when JWT_AUDIENCE is set, and then billing's own OAuth
  // resources (/mcp, /mcp/wallet, /v1/agent-wallet) are always part of the
  // accepted set — they are what an RFC 8707 client is issued, so pinning the
  // first-party client id alone would lock every MCP client and agent out.
  //
  // INITE Auth stamps `aud` on every access token (the RFC 8707 resource when
  // one was asked for, otherwise the client id), so pinning is safe. It stays
  // opt-in for one minor so existing deployments are not broken on upgrade
  // (Triad contract, backward-compat policy); unset in production is warned.
  const audience = acceptedAudiences(configService);
  if (issuer) logger.log(`Pinning JWT issuer: ${issuer.join(', ')}`);
  if (audience) logger.log(`Pinning JWT audience: ${audience.join(', ')}`);
  else if (isProduction) {
    logger.warn(
      'JWT_AUDIENCE is not set: a token INITE Auth issued for another service is ' +
        'accepted outside the MCP and wallet endpoints. Set it to the billing ' +
        "frontend's OAuth client id (inite-billing).",
    );
  }

  const base = {
    jwtFromRequest: extractJwt,
    ignoreExpiration: false,
    ...(issuer ? { issuer } : {}),
    ...(audience ? { audience } : {}),
  };

  // Test/dev fallback: symmetric HS256 via JWT_SECRET
  if (jwtSecret && configService.get<string>('NODE_ENV') !== 'production') {
    logger.log('Using HS256 symmetric secret (non-production)');
    return { ...base, secretOrKey: jwtSecret, algorithms: ['HS256'] };
  }

  // Production: JWKS from auth service.
  //
  // No default on purpose. This used to fall back to the INITE identity
  // provider, which meant a deployment that forgot to set AUTH_SERVICE_URL
  // silently validated its users' tokens against someone else's JWKS instead
  // of failing. A missing issuer is a configuration error, not a default.
  const authBase = authServiceUrl?.replace(/\/+$/, '');
  if (!authBase) {
    throw new Error(
      'AUTH_SERVICE_URL is required: it is the identity provider whose JWKS ' +
        'validates access tokens (expects {AUTH_SERVICE_URL}/.well-known/jwks.json). ' +
        'For local development set JWT_SECRET instead and run with NODE_ENV != production.',
    );
  }

  logger.log(`Using JWKS endpoint: ${authBase}/.well-known/jwks.json`);
  return {
    ...base,
    secretOrKeyProvider: passportJwtSecret({
      jwksUri: `${authBase}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    }),
    algorithms: ['RS256'],
  } as StrategyOptionsWithoutRequest;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super(buildJwtOptions(configService));
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token: missing sub');
    }

    return {
      userId: payload.sub,
      roles: payload.roles || [],
      email: payload.email,
      emailVerified: payload.email_verified === true,
      ...(typeof payload.act?.sub === 'string'
        ? { actor: payload.act.sub, actorClientId: payload.act.client_id }
        : {}),
      audience: payload.aud === undefined ? [] : [payload.aud].flat(),
      scopes: typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [],
      ...(Array.isArray(payload.authorization_details)
        ? { authorizationDetails: payload.authorization_details }
        : {}),
      ...orgOf(payload),
    };
  }
}
