import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { checkoutLinkFrom } from './checkout-link';

/**
 * A request that presents a checkout link token goes through without a
 * session; the service checks the token against the order it names. Anything
 * else needs what the endpoint needed before.
 */
@Injectable()
export class CheckoutLinkOrJwtGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = checkoutLinkFrom(request);
    if (token) {
      request.checkoutLinkToken = token;
      return true;
    }
    return super.canActivate(context);
  }
}

/** The same, for the endpoint a selling service also reads with its API key. */
@Injectable()
export class CheckoutLinkOrJwtOrServiceGuard extends JwtOrServiceGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = checkoutLinkFrom(request);
    if (token) {
      request.checkoutLinkToken = token;
      return true;
    }
    return super.canActivate(context);
  }
}
