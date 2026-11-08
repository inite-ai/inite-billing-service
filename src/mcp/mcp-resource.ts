import {
  ArgumentsHost,
  Catch,
  CanActivate,
  Controller,
  Get,
  Res,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RequestUser } from '../auth/decorators/user.decorator';
import { primaryIssuer } from '../auth/token-contract';

/**
 * Billing's MCP endpoint as an OAuth protected resource (RFC 9728).
 *
 * A client that finds `https://billing.inite.ai/mcp` — Claude's connector
 * directory among them — learns where to sign the person in from the 401
 * this endpoint answers with, and asks INITE Auth for a token bound to this
 * resource with the scope named here. Without the challenge the 401 was a
 * dead end: no client could tell which identity provider to use.
 */
export const BILLING_ACCOUNT_SCOPE = 'billing:account';

export function billingMcpResource(config: ConfigService): string {
  return `${(config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai').replace(/\/$/, '')}/mcp`;
}

export function billingMcpMetadataUrl(config: ConfigService): string {
  const resource = new URL(billingMcpResource(config));
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

function challenge(config: ConfigService, error?: string): string {
  return (
    `Bearer resource_metadata="${billingMcpMetadataUrl(config)}", scope="${BILLING_ACCOUNT_SCOPE}"` +
    (error ? `, error="${error}"` : '')
  );
}

/** Marks a refusal the filter answers with `error="insufficient_scope"`. */
class InsufficientScopeException extends ForbiddenException {}

/**
 * What a user token must carry to use this endpoint, on top of the guard
 * that already checked who signed it. Both, always:
 *
 * - `aud` is exactly this endpoint (RFC 8707). A token issued for anything
 *   else is not a token for billing's MCP door: another resource URL (say
 *   brain's MCP endpoint), a first-party client id, or a self-registered
 *   client's own `dcr_` id (what INITE Auth stamps when a client names no
 *   resource). Any of those, given by a person to one connector, used to be
 *   replayable here against their billing account.
 * - `billing:account` in its scopes: the person agreed to that on the
 *   consent screen, and to nothing else here. The check does not depend on
 *   the audience.
 *
 * Service keys (`x-api-key`) are not tokens and pass as before.
 */
@Injectable()
export class McpResourceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<Request & { user?: RequestUser }>().user;
    if (!user || user.isService) return true;
    const audience = user.audience ?? [];
    if (!audience.includes(billingMcpResource(this.config))) {
      throw new UnauthorizedException('This token was not issued for INITE billing');
    }
    if (!(user.scopes ?? []).includes(BILLING_ACCOUNT_SCOPE)) {
      throw new InsufficientScopeException(
        `This token does not carry ${BILLING_ACCOUNT_SCOPE}: sign in again and allow access to your billing account`,
      );
    }
    return true;
  }
}

/**
 * Adds the RFC 6750 challenge to the endpoint's 401 and scope-403, which is
 * what makes a client start (or step up) its sign-in. Everything else passes
 * through with the body Nest would have sent.
 */
@Catch(UnauthorizedException, InsufficientScopeException)
export class McpChallengeFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const scopeError = exception instanceof InsufficientScopeException;
    res
      .status(exception.getStatus())
      .setHeader(
        'WWW-Authenticate',
        challenge(this.config, scopeError ? 'insufficient_scope' : undefined),
      )
      .json(exception.getResponse());
  }
}

/** RFC 9728 metadata for the MCP endpoint — public, like the wallet's. */

@Controller()
export class McpMetadataController {
  constructor(private readonly config: ConfigService) {}

  @Get('.well-known/oauth-protected-resource/mcp')
  @ApiExcludeEndpoint()
  metadata(@Res() res: Response) {
    res
      .set('Access-Control-Allow-Origin', '*')
      .set('Cache-Control', 'public, max-age=3600')
      .json({
        resource: billingMcpResource(this.config),
        resource_name: 'INITE billing',
        authorization_servers: [primaryIssuer(this.config)],
        scopes_supported: [BILLING_ACCOUNT_SCOPE],
        bearer_methods_supported: ['header'],
        resource_documentation: 'https://billing.inite.ai/docs',
      });
  }
}
