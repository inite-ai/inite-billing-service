import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { Request } from 'express';

export interface JwtPayload {
  sub: string; // inite_user_id (uuid)
  roles?: string[];
  email?: string;
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
  //
  // Required in production, for the same reason AUTH_SERVICE_URL is: an
  // unpinned issuer is a configuration mistake, and the failure it produces is
  // silent acceptance rather than a visible error.
  const issuer = configService.get<string>('JWT_ISSUER') || undefined;
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

  // Audience stays optional on purpose, and is NOT enforced by default.
  //
  // The INITE identity provider does not put an `aud` claim on user access
  // tokens — it carries `client_id` instead — and jsonwebtoken rejects a token
  // with no `aud` when an audience is configured. Requiring it here would lock
  // out every real user rather than tighten anything. Deployments whose IdP
  // does set `aud` can opt in.
  const audience = configService.get<string>('JWT_AUDIENCE') || undefined;
  if (issuer) logger.log(`Pinning JWT issuer: ${issuer}`);
  if (audience) logger.log(`Pinning JWT audience: ${audience}`);

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
  if (!authServiceUrl) {
    throw new Error(
      'AUTH_SERVICE_URL is required: it is the identity provider whose JWKS ' +
        'validates access tokens (expects {AUTH_SERVICE_URL}/.well-known/jwks.json). ' +
        'For local development set JWT_SECRET instead and run with NODE_ENV != production.',
    );
  }

  logger.log(`Using JWKS endpoint: ${authServiceUrl}/.well-known/jwks.json`);
  return {
    ...base,
    secretOrKeyProvider: passportJwtSecret({
      jwksUri: `${authServiceUrl}/.well-known/jwks.json`,
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
    };
  }
}
