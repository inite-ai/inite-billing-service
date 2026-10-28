import {
  ArgumentsHost,
  Catch,
  CanActivate,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  Param,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RequestUser } from '../auth/decorators/user.decorator';
import { primaryIssuer } from '../auth/token-contract';
import { BILLING_ACCOUNT_SCOPE, billingMcpResource } from './mcp-resource';

/**
 * The billed gateway `/mcp/s/<slug>` as an OAuth protected resource (RFC 9728).
 *
 * Until 28.10.2026 the gateway ran only JwtOrServiceGuard: any INITE user
 * token was accepted and billed, including one a person gave a connector for
 * some other server (brain, a product MCP, a third-party DCR client). Family
 * MCP plan S5. Now a user token is accepted only when it was issued for this
 * gateway resource, for billing's own `/mcp` (with `billing:account`, the rule
 * McpResourceGuard already applies), or by a first-party INITE client whose
 * audience is its client id. A dynamically registered client's default
 * audience (`dcr_…`, minted when no `resource` was sent) names no server, so
 * it is refused here: billing a person's credits needs a token they gave this
 * gateway.
 */

/** A slug the registry could hold (RegisterMcpServerDto: a string of at most 64). */
const SLUG = /^[^\s"\\/]{1,64}$/;

export function gatewayResource(config: ConfigService, slug: string): string {
  const base = billingMcpResource(config); // <FRONTEND_URL>/mcp
  return `${base}/s/${encodeURIComponent(slug)}`;
}

export function gatewayMetadataUrl(config: ConfigService, slug: string): string {
  const resource = new URL(gatewayResource(config, slug));
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

/** Why a user token is not one this gateway may bill, or null when it is. */
export function gatewayAudienceRefusal(
  config: ConfigService,
  slug: string,
  user: Pick<RequestUser, 'audience' | 'scopes' | 'isService'>,
): string | null {
  if (user.isService) return null;
  const audience = user.audience ?? [];
  if (audience.includes(gatewayResource(config, slug))) return null;
  if (audience.includes(billingMcpResource(config))) {
    return (user.scopes ?? []).includes(BILLING_ACCOUNT_SCOPE)
      ? null
      : `This token does not carry ${BILLING_ACCOUNT_SCOPE}`;
  }
  if (audience.some((a) => /^https?:\/\//i.test(a))) {
    return 'This token was not issued for this INITE billing gateway';
  }
  if (audience.some((a) => a.startsWith('dcr_'))) {
    return 'This token names no resource: connect to this gateway URL so the token is issued for it';
  }
  return null;
}

@Injectable()
export class McpGatewayResourceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser; params: Record<string, string> }>();
    const user = req.user;
    if (!user) return true; // JwtOrServiceGuard already refused anonymous callers
    const refusal = gatewayAudienceRefusal(this.config, req.params?.slug ?? '', user);
    if (refusal) throw new UnauthorizedException(refusal);
    return true;
  }
}

/** Adds the RFC 6750 challenge, pointed at this slug's metadata, to the gateway's 401. */
@Catch(UnauthorizedException)
export class McpGatewayChallengeFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { params?: Record<string, string> }>();
    const slug = req?.params?.slug ?? '';
    const challenge = SLUG.test(slug)
      ? `Bearer resource_metadata="${gatewayMetadataUrl(this.config, slug)}"`
      : 'Bearer';
    res
      .status(exception.getStatus())
      .setHeader('WWW-Authenticate', challenge)
      .json(exception.getResponse());
  }
}

/** RFC 9728 metadata for each gateway slug. Public, like billing's own. */
@Controller()
export class McpGatewayMetadataController {
  constructor(private readonly config: ConfigService) {}

  @Get('.well-known/oauth-protected-resource/mcp/s/:slug')
  @ApiExcludeEndpoint()
  metadata(@Param('slug') slug: string, @Res() res: Response) {
    if (!SLUG.test(slug)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res
      .set('Access-Control-Allow-Origin', '*')
      .set('Cache-Control', 'public, max-age=3600')
      .json({
        resource: gatewayResource(this.config, slug),
        resource_name: `INITE billing gateway: ${slug}`,
        authorization_servers: [primaryIssuer(this.config)],
        scopes_supported: ['openid', 'profile', 'email'],
        bearer_methods_supported: ['header'],
        resource_documentation: 'https://billing.inite.ai/docs',
      });
  }
}
