import { Logger } from '@nestjs/common';
import type { OutboxService } from '../outbox/outbox.service';
import { calculatePeriodEnd } from './period.util';

/**
 * Subscription changes billing makes itself, not a provider: the renewal of a
 * subscription on a rail that cannot recur (PIX, crypto, the INITE wallet),
 * and a change of plan within one service.
 *
 * Both are paid as ordinary one-off orders (`mode: PAYMENT`), so no rail sets
 * up a recurring charge of its own for them: a renewal paid by card through
 * lava.top must not become a lava.top subscription at the renewal's amount,
 * and an upgrade's prorated difference must not recur at all. The order says
 * what it is for in its metadata, and `handleOrderPaid` routes it here
 * instead of granting it as a one-time purchase.
 */

export const RENEWAL_KEY = 'subscriptionRenewal';
export const PLAN_CHANGE_KEY = 'planChange';

export interface RenewalMeta {
  subscriptionId: string;
  /** The end of the period this order renews, ISO. */
  periodEnd: string;
}

export interface PlanChangeMeta {
  subscriptionId: string;
  fromPriceId: string;
  toPriceId: string;
  /** The end of the period the difference was priced for, ISO. */
  periodEnd: string;
}

export type SubscriptionOrderKind =
  { kind: 'renewal'; meta: RenewalMeta } | { kind: 'plan_change'; meta: PlanChangeMeta };

/** What an order pays for, when it is a renewal or a plan change billing opened. */
export function subscriptionOrderKind(order: { metadata?: unknown }): SubscriptionOrderKind | null {
  const metadata = (order?.metadata ?? {}) as Record<string, any>;
  const renewal = metadata[RENEWAL_KEY];
  if (renewal && typeof renewal.subscriptionId === 'string') {
    return { kind: 'renewal', meta: renewal as RenewalMeta };
  }
  const change = metadata[PLAN_CHANGE_KEY];
  if (change && typeof change.subscriptionId === 'string' && typeof change.toPriceId === 'string') {
    return { kind: 'plan_change', meta: change as PlanChangeMeta };
  }
  return null;
}

/** The rails a subscription can be on and still be renewed by billing. */
const NOT_RENEWABLE_RAILS = new Set(['PROMO']);

/**
 * Whether billing renews this subscription itself: it was paid on a rail with
 * no provider subscription behind it (PIX, crypto, the wallet, a one-off card
 * payment of an earlier renewal). A provider-backed subscription (lava.top,
 * Stripe, the stores) renews through the provider's webhook; a no-card trial
 * (no rail) and a 100%-off promo (PROMO) end with their period.
 */
export function renewedByBilling(sub: {
  rail?: string | null;
  providerSubscriptionId?: string | null;
}): boolean {
  return !!sub.rail && !sub.providerSubscriptionId && !NOT_RENEWABLE_RAILS.has(sub.rail);
}

const LIVE = ['trialing', 'active', 'past_due'];

interface Deps {
  outbox: Pick<OutboxService, 'emit'>;
  logger: Logger;
}

function entitlementKeys(product: any): string[] {
  const metadata = product?.metadata || {};
  if (Array.isArray(metadata.entitlements)) return metadata.entitlements;
  if (typeof metadata.entitlementKey === 'string') return [metadata.entitlementKey];
  return [product.code];
}

/**
 * Give a subscription the entitlements of the product it is now on, until
 * `expiresAt`: the ones it held are revoked first, so a plan change leaves
 * no key of the old plan behind and a renewal leaves exactly one live row
 * per key.
 */
export async function regrantSubscriptionEntitlements(
  deps: Deps,
  tx: any,
  sub: { id: string; userId: string },
  product: any,
  expiresAt: Date,
): Promise<void> {
  const held = await tx.entitlement.findMany({
    where: { userId: sub.userId, source: 'subscription', status: 'active' },
  });
  const mine = held.filter((e: any) => (e.value as any)?.subscription_id === sub.id);
  const keys = entitlementKeys(product);
  if (mine.length > 0) {
    await tx.entitlement.updateMany({
      where: { id: { in: mine.map((e: any) => e.id) } },
      data: { status: 'revoked', updatedAt: new Date() },
    });
    for (const e of mine) {
      if (keys.includes(e.key)) continue;
      await deps.outbox.emit(
        'billing.entitlement.revoked',
        { user_id: sub.userId, key: e.key, source: 'subscription', subscription_id: sub.id },
        { serviceId: product.serviceId ?? null, tx },
      );
    }
  }
  const now = new Date();
  for (const key of keys) {
    await tx.entitlement.create({
      data: {
        userId: sub.userId,
        key,
        status: 'active',
        source: 'subscription',
        startsAt: now,
        expiresAt,
        value: {
          subscription_id: sub.id,
          product_code: product.code,
          service_id: product.serviceId ?? null,
        },
      },
    });
    await deps.outbox.emit(
      'billing.entitlement.granted',
      {
        user_id: sub.userId,
        key,
        source: 'subscription',
        subscription_id: sub.id,
        expires_at: expiresAt.toISOString(),
      },
      { serviceId: product.serviceId ?? null, tx },
    );
  }
}

function graceEnd(periodEnd: Date, price: { graceDays?: number | null }): Date {
  const days = price?.graceDays || 0;
  return days ? new Date(periodEnd.getTime() + days * 86_400_000) : periodEnd;
}

/**
 * A paid renewal order: the next period, at the order's price (which is the
 * scheduled plan when a downgrade was waiting).
 *
 * The new period starts where the paid one ended, so paying the link early
 * loses no days and paying it during the grace window does not give the
 * grace days twice. A subscription that already ended (paid after the
 * grace window ran out) starts again from now: the money came in, so the
 * plan comes back.
 */
export async function applyRenewalPayment(
  deps: Deps,
  tx: any,
  order: any,
  meta: RenewalMeta,
): Promise<void> {
  const sub = await tx.subscription.findUnique({ where: { id: meta.subscriptionId } });
  if (!sub || sub.userId !== order.userId) {
    deps.logger.error(
      `Renewal order ${order.id} paid for subscription ${meta.subscriptionId}, which is not the buyer's — left for review`,
    );
    return;
  }
  const price = order.price;
  const product = price.product;
  const now = new Date();
  const live = LIVE.includes(sub.status);
  const interval = price.interval || 'month';
  let periodStart = live ? new Date(sub.currentPeriodEnd) : now;
  let periodEnd = calculatePeriodEnd(periodStart, interval);
  // Continuing from the old end must not buy time that is already gone.
  if (periodEnd.getTime() <= now.getTime()) {
    periodStart = now;
    periodEnd = calculatePeriodEnd(now, interval);
  }
  const latestIntent = await tx.paymentIntent.findFirst({
    where: { orderId: order.id },
    orderBy: { updatedAt: 'desc' },
  });
  const changedPlan = sub.priceId !== price.id;

  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      priceId: price.id,
      pendingPriceId: null,
      renewalOrderId: null,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      // The rail this period was paid on: the next renewal starts from it.
      ...(latestIntent?.rail ? { rail: latestIntent.rail } : {}),
      updatedAt: now,
    },
  });

  await regrantSubscriptionEntitlements(deps, tx, sub, product, graceEnd(periodEnd, price));

  if (changedPlan) {
    await deps.outbox.emit(
      'billing.subscription.plan_changed',
      {
        subscription_id: sub.id,
        user_id: sub.userId,
        from_price_id: sub.priceId,
        to_price_id: price.id,
        price_code: price.code,
        effective: 'period_end',
      },
      { serviceId: product.serviceId ?? null, tx },
    );
  }
  await deps.outbox.emit(
    'billing.subscription.updated',
    {
      subscription_id: sub.id,
      user_id: sub.userId,
      status: 'active',
      current_period_end: periodEnd.toISOString(),
      renewal: true,
      order_id: order.id,
    },
    { serviceId: product.serviceId ?? null, tx },
  );
}

/**
 * Move a live subscription onto another price of the same service now, for
 * the rest of the period it is in. Used for a paid upgrade (the difference
 * was this order) and for a change that costs nothing (a trial, or a
 * difference that rounds to zero). The period does not move.
 *
 * Returns false, changing nothing, when the subscription is no longer live:
 * the caller decides what that means for money already paid.
 */
export async function applyPlanChangeNow(
  deps: Deps,
  tx: any,
  input: { subscriptionId: string; toPrice: any; orderId?: string },
): Promise<boolean> {
  const sub = await tx.subscription.findUnique({ where: { id: input.subscriptionId } });
  if (!sub || !LIVE.includes(sub.status)) return false;
  const price = input.toPrice;
  const product = price.product;
  if (sub.priceId === price.id) return true;

  await tx.subscription.update({
    where: { id: sub.id },
    data: { priceId: price.id, pendingPriceId: null, updatedAt: new Date() },
  });
  await regrantSubscriptionEntitlements(
    deps,
    tx,
    sub,
    product,
    graceEnd(new Date(sub.currentPeriodEnd), price),
  );
  await deps.outbox.emit(
    'billing.subscription.plan_changed',
    {
      subscription_id: sub.id,
      user_id: sub.userId,
      from_price_id: sub.priceId,
      to_price_id: price.id,
      price_code: price.code,
      effective: 'now',
      current_period_end: new Date(sub.currentPeriodEnd).toISOString(),
      ...(input.orderId ? { order_id: input.orderId } : {}),
    },
    { serviceId: product.serviceId ?? null, tx },
  );
  return true;
}

/** A paid upgrade order. */
export async function applyPlanChangePayment(
  deps: Deps,
  tx: any,
  order: any,
  meta: PlanChangeMeta,
): Promise<void> {
  const sub = await tx.subscription.findUnique({ where: { id: meta.subscriptionId } });
  if (!sub || sub.userId !== order.userId) {
    deps.logger.error(
      `Plan change order ${order.id} paid for subscription ${meta.subscriptionId}, which is not the buyer's — left for review`,
    );
    return;
  }
  const applied = await applyPlanChangeNow(deps, tx, {
    subscriptionId: sub.id,
    toPrice: order.price,
    orderId: order.id,
  });
  if (!applied) {
    // The money is in and the plan it paid for is gone (ended while the
    // payment was confirming). Nothing is granted on a dead subscription;
    // the order stays paid and is surfaced for a refund.
    deps.logger.error(
      `Plan change order ${order.id} paid after subscription ${sub.id} ended — refund by hand`,
    );
    await deps.outbox.emit(
      'billing.subscription.plan_change_failed',
      { subscription_id: sub.id, user_id: sub.userId, order_id: order.id, reason: 'not_live' },
      { serviceId: order.price?.product?.serviceId ?? null, tx },
    );
  }
}
