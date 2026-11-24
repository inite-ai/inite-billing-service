import { Prisma } from '@prisma/client';
import { subscriptionOrderKind } from './subscription-changes';

const LIVE = ['trialing', 'active', 'past_due'];

/** A first order and the subscription it made are written in one transaction. */
const SAME_PAYMENT_SECONDS = 60;

/** The subscription an order says it is for: its column, or what older code wrote in metadata. */
export function linkedSubscriptionId(order: any): string | null {
  if (order.subscriptionId) return order.subscriptionId;
  const kind = subscriptionOrderKind(order);
  if (kind) return kind.meta.subscriptionId;
  const metadata = (order.metadata ?? {}) as Record<string, any>;
  return metadata.renewal && typeof metadata.subscription_id === 'string'
    ? metadata.subscription_id
    : null;
}

/** Paid orders of a subscription, however they name it, with when they were paid. */
function paymentsOf(subscription: { id: string; userId: string; createdAt?: Date }): Prisma.Sql {
  return Prisma.sql`
    SELECT o.id, COALESCE(i.created_at, o.created_at) AS paid_at, o.metadata
      FROM billing.orders o
      LEFT JOIN billing.invoices i ON i.order_id = o.id
     WHERE o.user_id = ${subscription.userId}
       AND o.status = 'paid'
       AND o.metadata #> '{planChange}' IS NULL
       AND (
         o.subscription_id::text = ${subscription.id}
         OR (o.subscription_id IS NULL AND (
              o.metadata ->> 'subscription_id' = ${subscription.id}
              OR o.metadata #>> '{subscriptionRenewal,subscriptionId}' = ${subscription.id}
              OR (o.mode = 'SUBSCRIPTION'
                  AND NOT COALESCE(o.metadata ? 'subscription_id', false)
                  AND abs(extract(epoch FROM COALESCE(i.created_at, o.created_at) - ${
                    subscription.createdAt ?? new Date(0)
                  }::timestamptz)) < ${SAME_PAYMENT_SECONDS})
            ))
       )`;
}

/**
 * The subscription a paid order paid for, whatever state it is in now. An
 * order written before orders named it is matched to the subscription made in
 * the same payment; failing that (a trial's first payment), by plan and only
 * among live ones, as it always was.
 */
export async function subscriptionOfOrder(tx: any, order: any): Promise<any | null> {
  const linked = linkedSubscriptionId(order);
  if (linked) return tx.subscription.findUnique({ where: { id: linked } });
  if (order.mode !== 'SUBSCRIPTION') return null;
  const made: Array<{ id: string }> =
    (await tx.$queryRaw(Prisma.sql`
      SELECT s.id
        FROM billing.subscriptions s
        JOIN billing.orders o ON o.id = ${order.id}::uuid AND o.user_id = s.user_id
        LEFT JOIN billing.invoices i ON i.order_id = o.id
       WHERE abs(extract(epoch FROM s.created_at - COALESCE(i.created_at, o.created_at))) < ${SAME_PAYMENT_SECONDS}
       ORDER BY (s.price_id = o.price_id) DESC,
                abs(extract(epoch FROM s.created_at - COALESCE(i.created_at, o.created_at)))
       LIMIT 1
    `)) ?? [];
  if (made[0]?.id) return tx.subscription.findUnique({ where: { id: made[0].id } });
  return tx.subscription.findFirst({
    where: { userId: order.userId, priceId: order.priceId, status: { in: LIVE } },
    orderBy: { updatedAt: 'desc' },
  });
}

/** Whether the subscription was paid for again after this order. */
export async function paidAgainAfter(tx: any, subscription: any, order: any): Promise<boolean> {
  const rows: unknown[] =
    (await tx.$queryRaw(Prisma.sql`
      WITH payments AS (${paymentsOf(subscription)}),
           this AS (
             SELECT COALESCE(i.created_at, o.created_at) AS paid_at
               FROM billing.orders o LEFT JOIN billing.invoices i ON i.order_id = o.id
              WHERE o.id = ${order.id}::uuid
           )
      SELECT p.id FROM payments p, this
       WHERE p.id <> ${order.id}::uuid AND p.paid_at > this.paid_at LIMIT 1
    `)) ?? [];
  return rows.length > 0;
}

/**
 * The order already booked for a charge heard of late: paid about when the
 * charge was made, and not yet named by another charge.
 */
export async function bookedFor(
  tx: any,
  subscription: any,
  chargedAt: Date,
  withinMs: number,
): Promise<string | null> {
  const rows: Array<{ id: string }> =
    (await tx.$queryRaw(Prisma.sql`
      WITH payments AS (${paymentsOf(subscription)})
      SELECT id FROM payments
       WHERE NOT COALESCE(metadata ? 'provider_charge_aliases', false)
         AND abs(extract(epoch FROM paid_at - ${chargedAt}::timestamptz)) < ${withinMs / 1000}
       ORDER BY abs(extract(epoch FROM paid_at - ${chargedAt}::timestamptz))
       LIMIT 1
    `)) ?? [];
  return rows[0]?.id ?? null;
}

/** The order one of these charge names was already put on. */
export async function chargeNamed(
  tx: any,
  subscription: any,
  names: string[],
): Promise<{ id: string } | null> {
  const rows: Array<{ id: string }> =
    (await tx.$queryRaw(Prisma.sql`
      WITH payments AS (${paymentsOf(subscription)})
      SELECT id FROM payments
       WHERE metadata -> 'provider_charge_aliases' ?| ARRAY[${Prisma.join(names)}]::text[]
       LIMIT 1
    `)) ?? [];
  return rows[0] ?? null;
}
