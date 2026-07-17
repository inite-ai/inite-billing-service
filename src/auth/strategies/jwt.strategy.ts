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

function buildJwtOptions(configService: ConfigService): StrategyOptionsWithoutRequest {
  const logger = new Logger('JwtStrategy');
  const jwtSecret = configService.get<string>('JWT_SECRET');
  const authServiceUrl = configService.get<string>('AUTH_SERVICE_URL') || 'https://auth.inite.ai';

  const base = {
    jwtFromRequest: extractJwt,
    ignoreExpiration: false,
  };

  // Test/dev fallback: symmetric HS256 via JWT_SECRET
  if (jwtSecret && configService.get<string>('NODE_ENV') !== 'production') {
    logger.log('Using HS256 symmetric secret (non-production)');
    return { ...base, secretOrKey: jwtSecret, algorithms: ['HS256'] };
  }

  // Production: JWKS from auth service
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
