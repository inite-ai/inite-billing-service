import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { demoReadOnly, isDemoClaims } from './demo';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The demo is read-only, for the whole API, before any handler runs.
 *
 * Global, so a route added later is covered without anyone remembering it:
 * an interceptor runs after the route's guards (which have put the verified
 * session on `req.user`) and before its pipes and handler, so a demo write
 * never reaches a service, an order, a payment provider's client or the
 * outbox. Every method but GET/HEAD/OPTIONS is refused, a POST that only
 * reads included: the demo needs none, and the assistant's are model calls.
 *
 * A route with no guard has no `req.user`. A demo visitor's token still
 * travels with such a request (the cookie), so it is read here without
 * verifying it: this can only refuse, never let anything through, and
 * refusing a forged "demo" token costs its sender nothing they had.
 */
@Injectable()
export class DemoReadOnlyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    if (!SAFE_METHODS.has(String(req?.method ?? '').toUpperCase()) && isDemoRequest(req)) {
      throw demoReadOnly();
    }
    return next.handle();
  }
}

/** A demo session's request: the verified user, or the token it carries. */
export function isDemoRequest(req: any): boolean {
  if (req?.user?.demo === true) return true;
  return (
    isDemoClaims(unverifiedClaims(bearerOf(req))) ||
    isDemoClaims(unverifiedClaims(req?.cookies?.access_token))
  );
}

function bearerOf(req: any): string | null {
  const header = req?.headers?.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** A JWT's payload, unverified: only ever used to refuse. */
export function unverifiedClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part || part.length > 16_384) return null;
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}
