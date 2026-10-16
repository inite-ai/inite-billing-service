import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import type { RequestUser } from '../auth/decorators/user.decorator';
import { WALLET_GRANT_TYPE, WALLET_SCOPE } from './agent-limits';
import { selfAgentId } from './self-agent';

/** The wallet's MCP endpoint: the OAuth resource agents get tokens for. */
export function walletResource(config: ConfigService): string {
  return `${(config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai').replace(/\/$/, '')}/mcp/wallet`;
}

export function walletResourceMetadataUrl(config: ConfigService): string {
  const resource = new URL(walletResource(config));
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

/**
 * Lets in an AI agent's token for the wallet, and nothing else:
 * - issued by INITE Auth (the JWT strategy checks signature and issuer);
 * - for this resource (`aud`) — a token an agent got for some other site
 *   cannot be replayed here to spend the person's money;
 * - naming the agent (`act`) — the person's own token is for the account
 *   page, not for paying as an agent — with the wallet grant (`wallet:pay`,
 *   or an `inite_wallet` detail);
 * - or an agent on its own (its did:web as `sub`, no `act`): its own wallet.
 *
 * A request without a usable token gets 401 with `WWW-Authenticate` pointing
 * at the resource metadata (RFC 9728), which is how an MCP client finds INITE
 * Auth and asks the person to connect.
 */
@Injectable()
export class AgentTokenGuard extends AuthGuard('jwt') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const res = http.getResponse<Response>();
    const challenge = (error?: string) =>
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${walletResourceMetadataUrl(this.config)}", scope="${WALLET_SCOPE}"` +
          (error ? `, error="${error}"` : ''),
      );
    try {
      await super.canActivate(context);
    } catch (error) {
      challenge();
      throw error instanceof UnauthorizedException ? error : new UnauthorizedException();
    }
    const user = http.getRequest<Request & { user: RequestUser }>().user;
    if (!user.audience?.includes(walletResource(this.config))) {
      challenge('invalid_token');
      throw new UnauthorizedException('This token was not issued for the INITE wallet');
    }
    const issuer = (this.config.get<string>('JWT_ISSUER') || 'https://auth-api.inite.ai').replace(
      /\/$/,
      '',
    );
    if (!user.actor && selfAgentId(user.userId, issuer)) return true;
    if (!user.actor) {
      throw new ForbiddenException(
        'The wallet MCP is for AI agents: acting for a person, or on their own INITE identity',
      );
    }
    const granted =
      user.scopes?.includes(WALLET_SCOPE) ||
      user.authorizationDetails?.some((d) => d?.type === WALLET_GRANT_TYPE);
    if (!granted) {
      challenge('insufficient_scope');
      throw new ForbiddenException('The person has not let this agent use the wallet');
    }
    return true;
  }
}
