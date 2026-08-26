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

  // Pin the token issuer and audience when configured. Without these, a valid
  // token the identity provider minted for a DIFFERENT audience (another service
  // sharing the same JWKS/issuer) would be accepted here — token confusion.
  // Opt-in via env so existing deployments aren't broken; passport-jwt forwards
  // them to jsonwebtoken.verify, which enforces the `iss` / `aud` claims.
  const issuer = configService.get<string>('JWT_ISSUER') || undefined;
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
