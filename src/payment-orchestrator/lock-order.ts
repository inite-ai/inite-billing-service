import { Prisma } from '@prisma/client';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Lock everything a payment transition touches, in the one order used
 * everywhere: subscription, order, intent.
 *
 * The ids are resolved without a lock first; what they point at is read again
 * by the caller after the locks are held.
 */
export async function lockPaymentPath(tx: any, paymentIntentId: string): Promise<void> {
  const rows: any[] =
    (await tx.$queryRaw(Prisma.sql`
      SELECT o.id AS order_id, o.user_id, o.price_id, o.mode::text AS mode,
             COALESCE(o.subscription_id::text,
                      o.metadata #>> '{subscriptionRenewal,subscriptionId}',
                      o.metadata #>> '{planChange,subscriptionId}') AS subscription_id
        FROM billing.payment_intents p
        JOIN billing.orders o ON o.id = p.order_id
       WHERE p.id = ${paymentIntentId}::uuid
    `)) ?? [];
  const path = rows[0]?.order_id ? rows[0] : null;
  if (path?.subscription_id && UUID.test(path.subscription_id)) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM billing.subscriptions WHERE id = ${path.subscription_id}::uuid FOR UPDATE`,
    );
  } else if (path?.mode === 'SUBSCRIPTION') {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM billing.subscriptions
       WHERE user_id = ${path.user_id} AND price_id = ${path.price_id}::uuid
       ORDER BY id FOR UPDATE
    `);
  }
  if (path) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM billing.orders WHERE id = ${path.order_id}::uuid FOR UPDATE`,
    );
  }
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM billing.payment_intents WHERE id = ${paymentIntentId}::uuid FOR UPDATE`,
  );
}
