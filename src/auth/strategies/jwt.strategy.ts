import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';

export interface JwtPayload {
  sub: string; // inite_user_id (uuid)
  roles?: string[];
  email?: string;
}

function buildJwtOptions(configService: ConfigService): StrategyOptionsWithoutRequest {
  const logger = new Logger('JwtStrategy');
  const publicKey = configService
    .get<string>('JWT_PUBLIC_KEY')
    ?.replace(/\\n/g, '\n');
  const jwtSecret = configService.get<string>('JWT_SECRET');
  const authServiceUrl =
    configService.get<string>('AUTH_SERVICE_URL') ||
    configService.get<string>('NEXT_PUBLIC_AUTH_SERVICE_URL') ||
    'https://auth.inite.ai';

  const base = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    ignoreExpiration: false,
  };

  // Priority: static public key > JWKS endpoint > symmetric secret
  if (publicKey) {
    logger.log('Using static RS256 public key from JWT_PUBLIC_KEY');
    return { ...base, secretOrKey: publicKey, algorithms: ['RS256'] };
  }

  if (authServiceUrl) {
    logger.log(`Using JWKS endpoint: ${authServiceUrl}/.well-known/jwks.json`);
    return {
      ...base,
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `${authServiceUrl}/.well-known/jwks.json`,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 600000, // 10 minutes
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }),
      algorithms: ['RS256'],
    } as StrategyOptionsWithoutRequest;
  }

  if (jwtSecret) {
    logger.log('Using symmetric HS256 secret from JWT_SECRET');
    return { ...base, secretOrKey: jwtSecret, algorithms: ['HS256'] };
  }

  logger.error(
    'No JWT key configured. Set JWT_PUBLIC_KEY, AUTH_SERVICE_URL (for JWKS), or JWT_SECRET.',
  );
  return { ...base, secretOrKey: 'unconfigured', algorithms: ['HS256'] };
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
