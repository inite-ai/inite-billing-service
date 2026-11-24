import { Prisma } from '@prisma/client';
import { subscriptionOrderKind } from './subscription-changes';

/** A first order and the subscription it made are written in one transaction. */
const SAME_PAYMENT_SECONDS = 60;

/**
 * Whether subscription `s` is, or was, on the plan of order `o`: its price now,
 * or one a recorded plan change took it from. Nothing else joins an order to a
 * subscription — a person buys two products in the same minute.
 */
const SAME_PLAN = Prisma.sql`(
  s.price_id = o.price_id
  OR EXISTS (SELECT 1 FROM billing.outbox_events e
              WHERE e.event_type = 'billing.subscription.plan_changed'
                AND e.payload ->> 'subscription_id' = s.id::text
                AND e.payload ->> 'from_price_id' = o.price_id::text)
  OR EXISTS (SELECT 1 FROM billing.orders c
              WHERE c.user_id = s.user_id AND c.status IN ('paid', 'refunded')
                AND c.metadata #>> '{planChange,subscriptionId}' = s.id::text
                AND c.metadata #>> '{planChange,fromPriceId}' = o.price_id::text)
)`;

/**
 * The subscription of an order that names none. Buying a plan again extended
 * the live row, so it is the latest row of that plan made by then: the one this
 * payment made, or the one it extended.
 */
const UNNAMED_SUBSCRIPTION = Prisma.sql`(
  SELECT s.id FROM billing.subscriptions s
   WHERE s.user_id = o.user_id
     AND s.created_at <= COALESCE(i.created_at, o.created_at)
                         + make_interval(secs => ${SAME_PAYMENT_SECONDS})
     AND ${SAME_PLAN}
   ORDER BY s.created_at DESC LIMIT 1
)`;

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
function paymentsOf(subscription: { id: string; userId: string }): Prisma.Sql {
  return Prisma.sql`
    SELECT o.id, COALESCE(i.created_at, o.created_at) AS paid_at, o.metadata
      FROM billing.orders o
      LEFT JOIN billing.invoices i ON i.order_id = o.id
     WHERE o.user_id = ${subscription.userId}
       AND o.status = 'paid'
       AND o.metadata #> '{planChange}' IS NULL
       AND CASE
             WHEN o.subscription_id IS NOT NULL THEN o.subscription_id::text = ${subscription.id}
             WHEN o.metadata ? 'subscription_id' THEN o.metadata ->> 'subscription_id' = ${subscription.id}
             WHEN o.metadata ? 'subscriptionRenewal'
               THEN o.metadata #>> '{subscriptionRenewal,subscriptionId}' = ${subscription.id}
             WHEN o.mode = 'SUBSCRIPTION' THEN ${UNNAMED_SUBSCRIPTION}::text = ${subscription.id}
             ELSE false
           END`;
}

/**
 * The subscription a paid order paid for, whatever state it is in now, or null
 * when nothing says: refunding an order nobody can place ends nothing.
 */
export async function subscriptionOfOrder(tx: any, order: any): Promise<any | null> {
  let id = linkedSubscriptionId(order);
  if (!id && order.mode === 'SUBSCRIPTION') {
    const rows: Array<{ id: string | null }> =
      (await tx.$queryRaw(Prisma.sql`
        SELECT ${UNNAMED_SUBSCRIPTION}::text AS id
          FROM billing.orders o LEFT JOIN billing.invoices i ON i.order_id = o.id
         WHERE o.id = ${order.id}::uuid
      `)) ?? [];
    id = rows[0]?.id ?? null;
  }
  return id ? tx.subscription.findUnique({ where: { id } }) : null;
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
