/** Longer than any id a service uses; an order's metadata is free-form. */
const MAX_COMPANY_ID = 128;

/**
 * The selling service's own account the order was bought for. Billing does not
 * know what it means: it is carried from the order to the credit events, or
 * null when the order does not name one.
 */
export function orderCompanyId(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null | undefined)?.company_id;
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= MAX_COMPANY_ID ? id : null;
}

/**
 * The company of a subscription, for the orders billing opens itself (a
 * renewal, a plan change): they are not bought through a checkout that could
 * name one. Two companies among the orders that paid for it, or none, is null:
 * the service reviews it rather than billing guessing.
 */
export async function subscriptionCompanyId(
  db: any,
  sub: { id: string; userId: string; priceId: string },
): Promise<string | null> {
  const orders = await db.order.findMany({
    where: {
      userId: sub.userId,
      status: 'paid',
      OR: [
        { mode: 'SUBSCRIPTION', priceId: sub.priceId },
        { metadata: { path: ['subscription_id'], equals: sub.id } },
        { metadata: { path: ['subscriptionRenewal', 'subscriptionId'], equals: sub.id } },
        { metadata: { path: ['planChange', 'subscriptionId'], equals: sub.id } },
      ],
    },
    select: { metadata: true },
  });
  const ids = new Set(
    orders.map((o: any) => orderCompanyId(o.metadata)).filter((id: string | null) => id !== null),
  );
  return ids.size === 1 ? ([...ids][0] as string) : null;
}

/** What a grant was for, kept on its ledger row and sent with its event. */
export interface CreditGrantSource {
  source: 'subscription' | 'pack' | 'trial';
  periodStart?: Date;
  periodEnd?: Date;
  companyId?: string | null;
}

/** Credits a price or product defines: null when it defines none. */
export function definedCredits(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === 0) return null;
  const amount = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  // Thrown, not skipped: a paid order must not quietly grant nothing.
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Credits must be a non-negative whole number');
  }
  return amount || null;
}
