import { ForbiddenException } from '@nestjs/common';
import { DEMO_READ_ONLY, DEMO_SUBSCRIBER, isDemoSubscriber } from './demo-tenant';

/** The demo tenant's ids and checks (src/common/demo-tenant.ts), and the guards on them. */
export {
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  DEMO_READ_ONLY,
  DEMO_SUBSCRIBER,
  isDemoClaims,
  isDemoSubscriber,
} from './demo-tenant';

/** A Prisma `userId` filter that leaves the demo tenant out of totals and sweeps. */
export const NOT_DEMO = { not: DEMO_SUBSCRIBER } as const;

/** The 403 a demo write gets, everywhere. */
export function demoReadOnly(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: DEMO_READ_ONLY,
    message: 'The demo is read-only: nothing can be bought, paid, refunded or changed',
  });
}

/**
 * Put before anything that would create an order, a payment intent or a
 * provider call for `userId`. A selling service's key can name any
 * subscriber, so the demo tenant is refused here and not only for a demo
 * session: no checkout, charge or webhook ever exists for it.
 */
export function assertNotDemoSubscriber(userId: string | null | undefined): void {
  if (isDemoSubscriber(userId)) throw demoReadOnly();
}

/** The same for a caller: a demo session, or a request for the demo tenant. */
export function assertNotDemo(
  caller: { demo?: boolean; userId?: string | null } | null | undefined,
): void {
  if (caller?.demo === true || isDemoSubscriber(caller?.userId)) throw demoReadOnly();
}
