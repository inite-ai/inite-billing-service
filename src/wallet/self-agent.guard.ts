import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequestUser } from '../auth/decorators/user.decorator';
import { selfAgentId } from './self-agent';

/** The agent wallet API: the audience an agent asks INITE Auth for. */
export function agentWalletResource(config: ConfigService): string {
  return `${(config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai').replace(/\/$/, '')}/v1/agent-wallet`;
}

/**
 * Lets in an agent that exists on its own: a token from INITE Auth
 * (signature and issuer checked by the JWT strategy) whose `sub` is a
 * self-registered agent's did:web, issued for this API (`aud`), and not on
 * anyone's behalf (no `act`).
 */
@Injectable()
export class SelfAgentGuard extends AuthGuard('jwt') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch (error) {
      throw error instanceof UnauthorizedException ? error : new UnauthorizedException();
    }
    const user = context.switchToHttp().getRequest<Request & { user: RequestUser }>().user;
    if (!user.audience?.includes(agentWalletResource(this.config))) {
      throw new UnauthorizedException(
        `This token was not issued for ${agentWalletResource(this.config)}: ask INITE Auth for that audience`,
      );
    }
    const issuer = (this.config.get<string>('JWT_ISSUER') || 'https://auth-api.inite.ai').replace(
      /\/$/,
      '',
    );
    if (user.actor || !selfAgentId(user.userId, issuer)) {
      throw new ForbiddenException(
        'This API is for an agent with its own INITE identity (registered with its own key). A person’s wallet is at /v1/wallet.',
      );
    }
    return true;
  }
}
