import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { checkoutLinkFrom } from './checkout-link';

/**
 * A request that presents a checkout link token goes through without a
 * session; the service checks the token against the order it names. Anything
 * else is handed to the guard the endpoint had before — injected, not
 * inherited, so whatever stands in for that guard stands in here too.
 */
function passWithLink(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest();
  const token = checkoutLinkFrom(request);
  if (!token) return false;
  request.checkoutLinkToken = token;
  return true;
}

@Injectable()
export class CheckoutLinkOrJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtAuthGuard) {}

  canActivate(context: ExecutionContext) {
    return passWithLink(context) || this.jwt.canActivate(context);
  }
}

/** The same, for the endpoint a selling service also reads with its API key. */
@Injectable()
export class CheckoutLinkOrJwtOrServiceGuard implements CanActivate {
  constructor(private readonly jwtOrService: JwtOrServiceGuard) {}

  canActivate(context: ExecutionContext) {
    return passWithLink(context) || this.jwtOrService.canActivate(context);
  }
}
