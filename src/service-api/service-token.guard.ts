import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PrismaService } from '../common/services/prisma.service';
import { acceptedIssuers, billingBaseUrl } from '../auth/token-contract';

export const SERVICE_SCOPE_KEY = 'serviceScope';
/** The scope a service token must carry for this route. */
export const ServiceScope = (scope: string) => SetMetadata(SERVICE_SCOPE_KEY, scope);

/** The scopes of billing's token-authenticated service API. */
export const SCOPE_COMMITMENTS = 'billing:commitments';
export const SCOPE_CHECKOUT = 'billing:checkout';

/**
 * The audience a service token must be minted for. One name for billing's
 * whole service API, distinct from every audience a person's token carries,
 * so a service token is never mistaken for a person's and a person's token
 * is never accepted here.
 */
export function serviceApiAudience(config: Pick<ConfigService, 'get'>): string {
  return (
    config.get<string>('SERVICE_API_AUDIENCE')?.trim() || `${billingBaseUrl(config)}/v1/services`
  );
}

/**
 * Service to service, the family way: an INITE Auth `client_credentials`
 * token, never a shared static key.
 *
 * Checked, all of them, fail closed:
 * - the signature, against INITE Auth's JWKS (RS256); HS256 with JWT_SECRET
 *   only outside production, as the person-token strategy does;
 * - `iss` (JWT_ISSUER, required in production) and `aud` (the service API);
 * - the route's scope, from `scope`/`scopes`;
 * - that the caller is a machine: `client_id` present and `sub` not a DID
 *   (a person, or an agent's own identity);
 * - that `client_id` is the registered token identity of an active Service.
 *
 * The request then carries the service as `request.user`, the same shape the
 * API-key guard gives, so tenant scoping works unchanged.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly logger = new Logger(ServiceTokenGuard.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<string>(SERVICE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Deny by default: a route behind this guard must name its scope.
    if (!scope) throw new ForbiddenException('No service scope declared for this route');

    const request = context.switchToHttp().getRequest();
    const header = String(request.headers?.authorization ?? '');
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!token) throw new UnauthorizedException('A service token is required');

    const payload = await this.verify(token);
    const scopes = new Set(
      [
        ...(typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : []),
        ...(Array.isArray((payload as any).scopes) ? (payload as any).scopes : []),
      ].filter(Boolean),
    );
    if (!scopes.has(scope)) throw new ForbiddenException(`The token lacks ${scope}`);

    const clientId = (payload as any).client_id;
    if (typeof clientId !== 'string' || !clientId) {
      throw new UnauthorizedException('Not a service token');
    }
    if (typeof payload.sub === 'string' && payload.sub.startsWith('did:')) {
      throw new UnauthorizedException('A person or agent token cannot act as a service');
    }
    const service = await this.prisma.service.findUnique({ where: { authClientId: clientId } });
    if (!service || !service.isActive) {
      throw new UnauthorizedException('This client is not a billing service');
    }

    request.user = {
      userId: null,
      roles: ['service'],
      isService: true,
      serviceId: service.id,
      serviceCode: service.code,
      clientId,
      scopes: [...scopes],
    };
    return true;
  }

  private async verify(token: string): Promise<JWTPayload> {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const issuers = acceptedIssuers(this.config.get<string>('JWT_ISSUER'));
    if (isProduction && issuers.length === 0) {
      throw new UnauthorizedException('Service tokens are not configured');
    }
    const options = {
      audience: serviceApiAudience(this.config),
      ...(issuers.length > 0 ? { issuer: issuers } : {}),
    };
    try {
      const secret = this.config.get<string>('JWT_SECRET');
      if (secret && !isProduction) {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
          ...options,
          algorithms: ['HS256'],
        });
        return payload;
      }
      const { payload } = await jwtVerify(token, this.keySet(), {
        ...options,
        algorithms: ['RS256'],
      });
      return payload;
    } catch (error: any) {
      this.logger.debug(`Service token refused: ${error?.code ?? error?.message}`);
      throw new UnauthorizedException('Invalid service token');
    }
  }

  private keySet() {
    if (this.jwks) return this.jwks;
    const base = this.config.get<string>('AUTH_SERVICE_URL')?.replace(/\/+$/, '');
    if (!base) throw new UnauthorizedException('Service tokens are not configured');
    this.jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
    return this.jwks;
  }
}
