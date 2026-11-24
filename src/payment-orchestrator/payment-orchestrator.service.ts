import { checkItem, itemKey, itemTemplate } from '../catalog/item-entitlements';
import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../common/services/prisma.service';
import {
  IntentStatusResult,
  PaymentRailAdapter,
} from '../common/interfaces/payment-rail-adapter.interface';
import { ConnectorRegistry } from '../common/connectors/connector-registry.service';
import { Connector, RenewalEvidence } from '../common/connectors/connector.interface';
import { calculatePeriodEnd, orderAccessEndsAt } from './period.util';
import { lockPaymentPath } from './lock-order';
import { reconcileAmount } from '../workers/reconcile-amount';
import { isValidTransition, IntentStatus } from '../common/types/payment-state.types';
import { OutboxService } from '../outbox/outbox.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { FunnelService } from '../funnel/funnel.service';
import { CreditsService } from '../credits/credits.service';
import {
  applyPlanChangeNow,
  applyPlanChangePayment,
  applyRenewalPayment,
  linkOrderToPeriod,
  subscriptionOrderKind,
} from './subscription-changes';

/**
 * Interactive-transaction budget for the deep payment-fulfilment chain
 * (payment → order → subscription → entitlements → credits → commissions).
 * Prisma's 5s default is too tight now that credits and commissions run inside
 * the same transaction under load; give the chain headroom while still bounding
 * a stuck transaction. maxWait bounds how long we queue for a pool connection.
 */
const FULFILMENT_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Subscription lifecycle events the rails actually emit.
 *
 * Only the first three used to be routed here; every other one fell through to
 * the payment-intent path, where the lookup is by charge id and the event
 * carries a *subscription* id. It matched nothing, was marked failed, retried,
 * and abandoned — so an Apple or Google subscription that expired or went on
 * hold never ended on our side, and the customer kept access the store had
 * already stopped billing for.
 */
export const SUBSCRIPTION_EVENT_TYPES = [
  'subscription.renewed',
  'subscription.renewal_failed',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.on_hold',
  'subscription.grace_period',
  'subscription.recovered',
  'subscription.restarted',
  'subscription.created',
  'subscription.updated',
] as const;

/** The provider took money for another period. */
const RENEWAL_EVENTS: ReadonlySet<string> = new Set([
  'subscription.renewed',
  'subscription.recovered',
  'subscription.restarted',
]);

export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

export function isSubscriptionEvent(eventType: string): eventType is SubscriptionEventType {
  return (SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(eventType);
}

@Injectable()
export class PaymentOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(PaymentOrchestratorService.name);
  private adapters: Map<string, PaymentRailAdapter> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
    @Inject(forwardRef(() => AffiliatesService))
    private readonly affiliatesService: AffiliatesService,
    @Inject(forwardRef(() => FunnelService))
    private readonly funnelService: FunnelService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
    @Optional() private readonly connectorRegistry?: ConnectorRegistry,
  ) {}

  /**
   * Populate the adapter map from the auto-discovered ConnectorRegistry at boot.
   * This replaces the old hand-maintained registration block in main.ts — adding
   * a rail no longer means editing bootstrap wiring. The registry's onModuleInit
   * (in an imported module) runs first, so discovery is complete here. Tests that
   * call registerAdapter directly still override by rail.
   */
  onModuleInit(): void {
    if (!this.connectorRegistry) return;
    for (const connector of this.connectorRegistry.all()) {
      this.registerAdapter(connector);
    }
  }

  registerAdapter(adapter: PaymentRailAdapter) {
    this.adapters.set(adapter.rail(), adapter);
    this.logger.log(`Registered payment rail adapter: ${adapter.rail()}`);
  }

  getAdapter(rail: string): PaymentRailAdapter {
    // Explicitly-registered adapters (tests, main.ts) win; otherwise fall back
    // to the auto-discovered ConnectorRegistry (the single source going forward).
    const adapter = this.adapters.get(rail) ?? this.connectorRegistry?.get(rail);
    if (!adapter) {
      throw new NotFoundException(`Payment rail adapter not found: ${rail}`);
    }
    return adapter;
  }

  /**
   * Best-effort provider-side subscription cancel, shared by the user and admin
   * cancel flows. Returns false (and logs) when the rail can't cancel
   * programmatically (IAP — the user cancels in the store) or isn't wired, so
   * the caller can still update its own state. Throws if the provider call
   * itself fails, so a "cancelled" that didn't stop billing is never silent.
   */
  async cancelProviderSubscription(subscription: any, atPeriodEnd: boolean): Promise<boolean> {
    const rail = subscription?.rail;
    const providerSubscriptionId = subscription?.providerSubscriptionId;
    if (!rail || !providerSubscriptionId) return false;

    let connector: Connector;
    try {
      connector = this.getAdapter(rail) as Connector;
    } catch {
      this.logger.warn(
        `No connector for rail ${rail} — subscription ${subscription.id} cancelled in DB only`,
      );
      return false;
    }

    if (!connector.capabilities?.().supportsCancel || !connector.cancelSubscription) {
      this.logger.warn(
        `Rail ${rail} has no programmatic cancel — subscription ${subscription.id} cancelled in DB only`,
      );
      return false;
    }

    await connector.cancelSubscription({ providerSubscriptionId, atPeriodEnd });
    this.logger.log(
      `Provider subscription ${providerSubscriptionId} cancelled (${rail}, atPeriodEnd=${atPeriodEnd})`,
    );
    return true;
  }

  /**
   * Ask the provider where a live payment stands and apply the answer — the
   * same decision a webhook leads to, reached without one.
   *
   * For rails whose webhook may be missing or late (lava.top), and for the
   * checkout page asking "has it gone through?" when the customer comes back.
   * The rules are the webhook processor's: the provider's status is re-read,
   * a "paid" without evidence of the right amount is refused, and only a
   * valid transition is applied — which the intent row lock makes safe to race
   * against a webhook arriving at the same moment.
   */
  async syncIntentWithProvider(
    paymentIntentId: string,
  ): Promise<{ status: IntentStatus; changed: boolean }> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      include: { order: true },
    });
    if (!intent) throw new NotFoundException(`Payment intent not found: ${paymentIntentId}`);
    const current = intent.status as IntentStatus;
    if (!['created', 'opened'].includes(current) || !intent.providerIntentId) {
      return { status: current, changed: false };
    }

    const adapter = this.getAdapter(intent.rail);
    const result = await adapter.getIntentStatus(intent.providerIntentId);
    let next = result.status as IntentStatus;
    if (next === 'paid') {
      const rec = reconcileAmount(intent.order, result);
      if (!rec.ok) {
        this.logger.warn(
          `Provider reports ${intent.id} paid but reconciliation failed (${rec.reason}); marking failed`,
        );
        next = 'failed';
      }
    }
    if (next === current || next === 'created' || !isValidTransition(current, next)) {
      return { status: current, changed: false };
    }

    await this.applyStateTransition(intent.id, next, result.providerData);
    return { status: next, changed: true };
  }

  /**
   * Apply state transition to payment intent and related entities
   * Ensures idempotency - if already in target state, does nothing
   */
  async applyStateTransition(
    paymentIntentId: string,
    newStatus: IntentStatus,
    providerData?: Record<string, any>,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize transitions on this intent before reading it. The idempotency
      // check below is read-then-write, and at Read Committed two concurrent
      // deliveries of the same webhook — a provider retry racing the original,
      // or two workers on one queue — both read `created`, both pass the check,
      // and both run the full fulfilment chain: two invoices, two credit
      // grants, two entitlements, two commissions, two events. The lock makes
      // the loser wait and re-read the state the winner committed, where the
      // idempotency check finally does its job.
      //
      // Subscription, order, intent, always in that order: a renewal event and
      // a payment of the same subscription must not wait for each other.
      await lockPaymentPath(tx, paymentIntentId);

      const intent = await tx.paymentIntent.findUnique({
        where: { id: paymentIntentId },
        include: { order: { include: { price: { include: { product: true } } } } },
      });

      if (!intent) {
        throw new NotFoundException(`Payment intent not found: ${paymentIntentId}`);
      }

      // Idempotency check: if already in target state, do nothing
      if (intent.status === newStatus) {
        this.logger.debug(
          `Payment intent ${paymentIntentId} already in state ${newStatus}, skipping`,
        );
        return;
      }

      // Validate transition
      if (!isValidTransition(intent.status as IntentStatus, newStatus)) {
        throw new Error(`Invalid state transition: ${intent.status} -> ${newStatus}`);
      }

      // Update payment intent
      await tx.paymentIntent.update({
        where: { id: paymentIntentId },
        data: {
          status: newStatus,
          snapshot: (providerData || intent.snapshot) as any,
          updatedAt: new Date(),
        },
      });

      await this.applyAttemptToOrder(tx, intent, newStatus);

      // Emit outbox events
      await this.outboxService.emit(
        'billing.payment.status_changed',
        {
          payment_intent_id: paymentIntentId,
          order_id: intent.orderId,
          status: newStatus,
          previous_status: intent.status,
        },
        { serviceId: intent.order.price?.product?.serviceId ?? null, tx: tx },
      );

      // Track funnel events based on status transitions
      const product = intent.order.price?.product;
      const funnelBase = {
        userId: intent.order.userId,
        orderId: intent.orderId,
        productId: product?.id,
        serviceId: product?.serviceId ?? undefined,
        amount: Number(intent.order.amount),
        currency: intent.order.currency,
      };

      if (newStatus === 'opened') {
        this.funnelService.track({
          ...funnelBase,
          eventType: 'payment_pending',
          stage: 'payment',
        });
      } else if (newStatus === 'paid') {
        this.funnelService.track({
          ...funnelBase,
          eventType: 'payment_completed',
          stage: 'conversion',
        });
      } else if (newStatus === 'failed' || newStatus === 'expired') {
        this.funnelService.track({
          ...funnelBase,
          eventType: 'payment_failed',
          stage: 'churned',
        });
      }
    }, FULFILMENT_TX_OPTIONS);
  }

  /**
   * What an attempt's new state does to the order it was for. An attempt is
   * not the order: the order is ended only by the last attempt that could pay
   * it, and a renewal order is not ended by attempts at all. Money that comes
   * for an order that cannot take it is kept (UnappliedPayment), never dropped
   * and never granted twice. Runs with the order locked.
   */
  private async applyAttemptToOrder(tx: any, intent: any, newStatus: IntentStatus): Promise<void> {
    const order = intent.order;
    const setOrder = (status: string) =>
      tx.order.update({ where: { id: order.id }, data: { status, updatedAt: new Date() } });

    switch (newStatus) {
      case 'created':
        return;

      case 'opened':
        if (!intent.supersededAt && order.status === 'created') await setOrder('open');
        return;

      case 'paid': {
        if (order.status === 'created' || order.status === 'open') {
          await setOrder('paid');
          // Whatever else is open may still settle; it no longer counts as live.
          await tx.paymentIntent.updateMany({
            where: {
              orderId: order.id,
              id: { not: intent.id },
              status: { in: ['created', 'opened'] },
              supersededAt: null,
            },
            data: { supersededAt: new Date() },
          });
          await this.handleOrderPaid(order.id, tx);
          return;
        }
        await this.keepUnapplied(
          tx,
          intent,
          order.status === 'paid'
            ? 'already_paid'
            : order.status === 'refunded'
              ? 'order_refunded'
              : 'order_closed',
        );
        return;
      }

      case 'refunded': {
        const kept = await tx.unappliedPayment.updateMany({
          where: { paymentIntentId: intent.id },
          data: { status: 'refunded', resolvedAt: new Date() },
        });
        // Returning money that paid nothing takes nothing back.
        if (kept.count > 0 || order.status === 'refunded') return;
        await setOrder('refunded');
        await this.handleOrderRefunded(order.id, tx);
        return;
      }

      case 'failed':
      case 'expired': {
        if (order.status !== 'created' && order.status !== 'open') return;
        if (intent.supersededAt) return;
        const otherLive = await tx.paymentIntent.count({
          where: {
            orderId: order.id,
            id: { not: intent.id },
            status: { in: ['created', 'opened'] },
            supersededAt: null,
          },
        });
        if (otherLive > 0) return;
        if (subscriptionOrderKind(order)?.kind === 'renewal') {
          // Payable again: the renewal ends by its own clock.
          if (order.status !== 'created') await setOrder('created');
          return;
        }
        await setOrder(newStatus);
        await this.handleOrderFailed(order.id, tx);
        return;
      }
    }
  }

  /** Money that paid no order: one row per attempt, for a person to settle. */
  private async keepUnapplied(
    tx: any,
    intent: any,
    reason: string,
    settled?: { amount?: unknown; currency?: string },
  ): Promise<void> {
    const amount = settled?.amount ?? intent.amount;
    const currency = settled?.currency ?? intent.currency;
    await tx.unappliedPayment.upsert({
      where: { paymentIntentId: intent.id },
      update: {},
      create: {
        paymentIntentId: intent.id,
        orderId: intent.orderId,
        userId: intent.order.userId,
        rail: intent.rail,
        amount: String(amount),
        currency,
        providerRef: intent.providerIntentId,
        reason,
      },
    });
    this.logger.error(
      `Payment ${intent.id} (${intent.rail}) settled ${amount} ${currency} that order ${intent.orderId} cannot take (${reason}); kept for review`,
    );
    await this.outboxService.emit(
      'billing.payment.unapplied',
      {
        payment_intent_id: intent.id,
        order_id: intent.orderId,
        user_id: intent.order.userId,
        amount: String(amount),
        currency,
        reason,
      },
      { serviceId: intent.order.price?.product?.serviceId ?? null, tx },
    );
  }

  /**
   * A provider says an attempt we had closed (`expired`, `failed`) is paid.
   *
   * The only way out of those two states. The amount and the currency are
   * checked as for any payment. An order that can still be paid is paid, once,
   * through the same fulfilment; anything else keeps the money as unapplied.
   */
  async settleLate(
    paymentIntentId: string,
    result: Pick<
      IntentStatusResult,
      'status' | 'amount' | 'currency' | 'amountVerifiedByAdapter' | 'providerData'
    >,
  ): Promise<void> {
    if (result.status !== 'paid') return;
    await this.prisma.$transaction(async (tx) => {
      await lockPaymentPath(tx, paymentIntentId);
      const intent: any = await tx.paymentIntent.findUnique({
        where: { id: paymentIntentId },
        include: { order: { include: { price: { include: { product: true } } } } },
      });
      if (!intent) throw new NotFoundException(`Payment intent not found: ${paymentIntentId}`);
      // Someone settled it while we waited for the lock.
      if (intent.status !== 'expired' && intent.status !== 'failed') return;

      const rec = reconcileAmount(intent.order, result);
      if (!rec.ok) {
        await this.keepUnapplied(tx, intent, rec.reason!, {
          amount: result.amount,
          currency: result.currency?.toUpperCase(),
        });
        return;
      }
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'paid',
          snapshot: (result.providerData || intent.snapshot) as any,
          updatedAt: new Date(),
        },
      });
      await this.applyAttemptToOrder(tx, intent, 'paid');
      await this.outboxService.emit(
        'billing.payment.status_changed',
        {
          payment_intent_id: intent.id,
          order_id: intent.orderId,
          status: 'paid',
          previous_status: intent.status,
        },
        { serviceId: intent.order.price?.product?.serviceId ?? null, tx },
      );
    }, FULFILMENT_TX_OPTIONS);
  }

  /** Ask a provider about an attempt we closed; settle it if the money came. */
  async recheckClosedIntent(paymentIntentId: string): Promise<boolean> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent?.providerIntentId || !['expired', 'failed'].includes(intent.status)) return false;
    const result = await this.getAdapter(intent.rail).getIntentStatus(intent.providerIntentId);
    if (result.status !== 'paid') return false;
    await this.settleLate(intent.id, result);
    return true;
  }

  private async handleOrderPaid(orderId: string, tx: any): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { price: { include: { product: true } } },
    });

    if (!order) return;

    // Create invoice
    await tx.invoice.create({
      data: {
        orderId: order.id,
        status: 'paid',
        amount: order.amount,
        currency: order.currency,
      },
    });

    // A renewal or a plan change billing opened is a one-off payment to the
    // rail but a subscription to us (subscription-changes.ts).
    const subscriptionKind = subscriptionOrderKind(order);
    if (subscriptionKind?.kind === 'renewal') {
      await applyRenewalPayment(this.changeDeps(), tx, order, subscriptionKind.meta);
    } else if (subscriptionKind?.kind === 'plan_change') {
      await applyPlanChangePayment(this.changeDeps(), tx, order, subscriptionKind.meta);
    } else if (order.mode === 'PAYMENT') {
      // Grant entitlements for one-time payment
      await this.grantEntitlementsForOrder(order, tx);
    } else if (order.mode === 'SUBSCRIPTION') {
      // Handle subscription creation/update
      await this.handleSubscriptionPayment(order, tx);
    }

    // Handle affiliate commission (only for first payment)
    await this.handleAffiliateCommission(order, tx);

    // Grant credits if product defines them
    await this.handleCreditsGrant(order, tx);

    // Emit event
    await this.outboxService.emit(
      'billing.payment.succeeded',
      {
        order_id: order.id,
        user_id: order.userId,
        amount: order.amount.toString(),
        currency: order.currency,
      },
      { serviceId: order.price?.product?.serviceId ?? null, tx: tx },
    );
  }

  private async handleOrderRefunded(orderId: string, tx: any): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) return;

    // Update invoice
    await tx.invoice.updateMany({
      where: { orderId: order.id },
      data: { status: 'refunded' },
    });

    // Void affiliate commissions for this order (C4)
    await this.voidAffiliateCommissions(order.id, tx);

    // Refund credits if they were granted for this order
    await this.handleCreditsRefund(order, tx);

    // A refunded subscription payment used to leave the subscription running
    // and its entitlements active: only `source: 'order'` entitlements were
    // revoked below, and subscription access is granted with
    // `source: 'subscription'`. The customer kept the product after getting
    // their money back, and the next period would have billed them again.
    // A refunded renewal ends the period it paid for the same way. A refunded
    // upgrade difference does not undo the upgrade: that is an admin's call.
    if (order.mode === 'SUBSCRIPTION' || subscriptionOrderKind(order)?.kind === 'renewal') {
      await this.endSubscriptionForRefundedOrder(order, tx);
    }

    // Revoke entitlements scoped to this order only (H7)
    const activeEntitlements = await tx.entitlement.findMany({
      where: {
        userId: order.userId,
        source: 'order',
        status: 'active',
      },
    });
    const orderEntitlementIds = activeEntitlements
      .filter((e: any) => {
        const value = e.value as any;
        return value && value.order_id === order.id;
      })
      .map((e: any) => e.id);

    if (orderEntitlementIds.length > 0) {
      await tx.entitlement.updateMany({
        where: { id: { in: orderEntitlementIds } },
        data: {
          status: 'revoked',
          updatedAt: new Date(),
        },
      });
    }

    // Emit event
    await this.outboxService.emit(
      'billing.payment.refunded',
      {
        order_id: order.id,
        user_id: order.userId,
      },
      { serviceId: order.price?.product?.serviceId ?? null, tx: tx },
    );

    await this.outboxService.emit(
      'billing.entitlement.revoked',
      {
        user_id: order.userId,
        source: 'order',
        order_id: order.id,
      },
      { serviceId: order.price?.product?.serviceId ?? null, tx: tx },
    );
  }

  private async handleOrderFailed(orderId: string, tx: any): Promise<void> {
    // `price.product` is what addresses the event below. Without the include it
    // was always undefined, so every payment.failed event went out with no
    // owning service — and since the outbox delivers by owner, to nobody.
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { price: { include: { product: true } } },
    });

    if (!order) return;

    // Update invoice if exists
    await tx.invoice.updateMany({
      where: { orderId: order.id, status: 'open' },
      data: { status: 'failed' },
    });

    await this.releasePromoCodeUsage(order.id, tx);

    // Emit event
    await this.outboxService.emit(
      'billing.payment.failed',
      {
        order_id: order.id,
        user_id: order.userId,
      },
      { serviceId: order.price?.product?.serviceId ?? null, tx: tx },
    );
  }

  /**
   * Give back the promo code a failed or expired order consumed.
   *
   * The code is redeemed when the session is paid — before the provider has
   * said anything — so an order that then fails or expires kept the redemption
   * forever. A campaign capped at 500 uses could be exhausted entirely by
   * abandoned checkouts, and a per-user limit of one (the default) meant a
   * customer whose card was declined could never use the code again, with
   * nothing in the UI explaining why.
   *
   * A refund deliberately does NOT come through here: that sale happened, and
   * restoring the redemption would let a code be farmed by buying and refunding.
   */
  private async releasePromoCodeUsage(orderId: string, tx: any): Promise<void> {
    const released: Array<{ promo_code_id: string }> = await tx.$queryRaw(Prisma.sql`
      DELETE FROM billing.promo_code_usages
       WHERE order_id = ${orderId}::uuid
      RETURNING promo_code_id
    `);
    if (released.length === 0) return;

    const counts = new Map<string, number>();
    for (const row of released) {
      counts.set(row.promo_code_id, (counts.get(row.promo_code_id) ?? 0) + 1);
    }

    for (const [promoCodeId, count] of counts) {
      // Guarded so a miscounted code cannot be driven below zero, which would
      // silently hand out uses beyond the cap.
      const updated = await tx.promoCode.updateMany({
        where: { id: promoCodeId, currentUsageCount: { gte: count } },
        data: { currentUsageCount: { decrement: count } },
      });
      if (updated.count === 0) {
        this.logger.warn(
          `Promo code ${promoCodeId} usage count is below the ${count} use(s) order ${orderId} is giving back — left as is`,
        );
      }
    }
  }

  private async grantEntitlementsForOrder(order: any, tx: any): Promise<void> {
    const product = order.price.product;
    // Sold per item: exactly the key for the item named at checkout.
    const template = itemTemplate(product);
    let entitlementKeys: string[];
    if (template) {
      const item = (order.metadata as Record<string, unknown> | null)?.item;
      try {
        entitlementKeys = [itemKey(template, checkItem(template, item))];
      } catch {
        this.logger.error(`Order ${order.id} is for an item product but names no valid item`);
        return;
      }
    } else {
      entitlementKeys = this.extractEntitlementKeys(product);
    }
    const startsAt = new Date();
    // A one-time order for a priced period (a year paid once) is that period
    // of access; a price with no interval is kept for good. See orderAccessEndsAt.
    const expiresAt = orderAccessEndsAt(startsAt, order.price.interval, order.price.graceDays);

    for (const key of entitlementKeys) {
      await tx.entitlement.create({
        data: {
          userId: order.userId,
          key,
          status: 'active',
          source: 'order',
          startsAt,
          expiresAt,
          value: {
            order_id: order.id,
            product_code: product.code,
            // Records the owning service so a service-to-service read can be
            // scoped to its own entitlements (see EntitlementsService).
            service_id: product.serviceId ?? null,
          },
        },
      });

      await this.outboxService.emit(
        'billing.entitlement.granted',
        {
          user_id: order.userId,
          key,
          source: 'order',
          order_id: order.id,
        },
        { serviceId: product.serviceId ?? null, tx: tx },
      );
    }
  }

  private async handleSubscriptionPayment(order: any, tx: any): Promise<void> {
    const price = order.price;
    const now = new Date();
    // A renewal the provider charged carries the period it paid for.
    const periodStart = order.periodEnd ? new Date(order.periodStart ?? now) : now;
    const periodEnd = order.periodEnd
      ? new Date(order.periodEnd)
      : calculatePeriodEnd(now, price.interval || 'month');
    const expiresAt = price.graceDays
      ? new Date(periodEnd.getTime() + price.graceDays * 24 * 60 * 60 * 1000)
      : periodEnd;

    // Resolve provider linkage from the latest PaymentIntent on this order.
    // We need this so renewal webhooks can look up the Subscription later by
    // (rail, providerSubscriptionId).
    const latestIntent = await tx.paymentIntent.findFirst({
      where: { orderId: order.id },
      orderBy: { updatedAt: 'desc' },
    });
    const providerLinkage = this.extractProviderSubscriptionLinkage(latestIntent);

    // Find or create subscription
    let subscription = order.subscriptionId
      ? await tx.subscription.findUnique({ where: { id: order.subscriptionId } })
      : await tx.subscription.findFirst({
          where: {
            userId: order.userId,
            priceId: price.id,
            status: { in: ['trialing', 'active', 'past_due'] },
          },
        });

    const isRenewal = !!subscription;
    // A no-card trial (startTrial) has no rail; its first payment is the
    // plan's first payment.
    const wasUnpaidTrial = subscription?.status === 'trialing' && !subscription?.rail;

    if (subscription) {
      // Update existing subscription. Only overwrite provider linkage if it
      // was missing (e.g. older record predating this fix).
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'active',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          ...(order.periodEnd ? {} : { billingAnchor: now }),
          cancelAtPeriodEnd: false,
          updatedAt: now,
          ...(subscription.providerSubscriptionId
            ? {}
            : { providerSubscriptionId: providerLinkage.providerSubscriptionId }),
          ...(subscription.rail ? {} : { rail: providerLinkage.rail }),
        },
      });
      subscription = await tx.subscription.findUnique({
        where: { id: subscription.id },
      });
    } else {
      // Create new subscription
      subscription = await tx.subscription.create({
        data: {
          userId: order.userId,
          priceId: price.id,
          status: price.trialDays && price.trialDays > 0 ? 'trialing' : 'active',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          billingAnchor: periodStart,
          cancelAtPeriodEnd: false,
          providerSubscriptionId: providerLinkage.providerSubscriptionId,
          rail: providerLinkage.rail,
        },
      });
    }

    await linkOrderToPeriod(tx, order, subscription.id, periodStart, periodEnd);

    // Track funnel event for subscription
    const product = order.price.product;
    this.funnelService.track({
      userId: order.userId,
      eventType: isRenewal ? 'subscription_renewed' : 'subscription_created',
      stage: 'retention',
      orderId: order.id,
      productId: product?.id,
      serviceId: product?.serviceId ?? undefined,
      amount: Number(order.amount),
      currency: order.currency,
      properties: { subscriptionId: subscription?.id },
    });

    // Grant/update entitlements
    const entitlementKeys = this.extractEntitlementKeys(product);

    for (const key of entitlementKeys) {
      // Revoke old entitlements
      await tx.entitlement.updateMany({
        where: {
          userId: order.userId,
          key,
          source: 'subscription',
          status: 'active',
        },
        data: {
          status: 'revoked',
          updatedAt: new Date(),
        },
      });

      // Create new entitlement
      await tx.entitlement.create({
        data: {
          userId: order.userId,
          key,
          status: 'active',
          source: 'subscription',
          startsAt: now,
          expiresAt,
          value: {
            subscription_id: subscription.id,
            product_code: product.code,
            service_id: product.serviceId ?? null,
          },
        },
      });

      await this.outboxService.emit(
        'billing.entitlement.granted',
        {
          user_id: order.userId,
          key,
          source: 'subscription',
          subscription_id: subscription.id,
          expires_at: expiresAt.toISOString(),
        },
        { serviceId: product.serviceId ?? null, tx: tx },
      );
    }

    // The first payment of a plan is its own event: `updated` fires on every
    // renewal too, and a service could not tell a new customer from a
    // returning period. `updated` still fires, for services that read it.
    if (!isRenewal || wasUnpaidTrial) {
      await this.outboxService.emit(
        'billing.subscription.created',
        {
          subscription_id: subscription.id,
          user_id: order.userId,
          status: subscription.status,
          price_code: price.code,
          rail: subscription.rail ?? null,
          current_period_end: periodEnd.toISOString(),
          order_id: order.id,
        },
        { serviceId: product.serviceId ?? null, tx: tx },
      );
    }

    await this.outboxService.emit(
      'billing.subscription.updated',
      {
        subscription_id: subscription.id,
        user_id: order.userId,
        status: subscription.status,
        current_period_end: periodEnd.toISOString(),
      },
      { serviceId: product.serviceId ?? null, tx: tx },
    );
  }

  private changeDeps() {
    return { outbox: this.outboxService, logger: this.logger };
  }

  /**
   * Move a live subscription onto another price now, with no payment: a plan
   * change during a no-card trial, or one whose prorated difference is zero.
   * Entitlements move with it; a paid change comes through handleOrderPaid.
   */
  async changePlanWithoutPayment(subscriptionId: string, toPrice: any): Promise<boolean> {
    return this.prisma.$transaction(
      (tx) => applyPlanChangeNow(this.changeDeps(), tx, { subscriptionId, toPrice }),
      FULFILMENT_TX_OPTIONS,
    );
  }

  /**
   * Handle a subscription lifecycle event delivered via provider webhook —
   * renewal, renewal failure, or cancellation.
   *
   * Identifies the Subscription by (rail, providerSubscriptionId). For
   * renewals, synthesises an Order + PaymentIntent + Invoice so the existing
   * fulfilment path (handleSubscriptionPayment) advances the period and
   * regrants entitlements/credits — no parallel codepath to keep in sync.
   */
  async handleSubscriptionEvent(
    rail: string,
    eventType: SubscriptionEventType,
    providerSubscriptionId: string,
    providerData: Record<string, any>,
  ): Promise<void> {
    const evidence = await this.renewalEvidence(
      rail,
      eventType,
      providerSubscriptionId,
      providerData,
    );
    if (evidence === null) {
      this.logger.log(`${eventType} for ${rail} ${providerSubscriptionId} is not a renewal`);
      return;
    }
    return this.prisma.$transaction(async (tx) => {
      // Locked before it is read: a poll and a webhook for one renewal take turns.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM billing.subscriptions WHERE rail = ${rail} AND provider_subscription_id = ${providerSubscriptionId} ORDER BY id FOR UPDATE`,
      );
      const subscription = await tx.subscription.findFirst({
        where: { rail, providerSubscriptionId },
        include: { price: { include: { product: true } } },
      });

      if (!subscription) {
        this.logger.warn(
          `Subscription event ${eventType} for unknown sub: rail=${rail} id=${providerSubscriptionId}`,
        );
        return;
      }

      switch (eventType) {
        case 'subscription.renewed':
        // Google Play's word for "the hold ended and billing resumed"; Apple's
        // for "the customer re-subscribed within the same period". Both mean
        // the provider is charging again, which is a renewal to us.
        case 'subscription.recovered':
        case 'subscription.restarted':
          await this.advanceSubscriptionPeriod(subscription, evidence!, providerData, tx);
          break;

        case 'subscription.renewal_failed':
        // `on_hold` and `grace_period` are the store's dunning states: the
        // customer's payment method failed and they have not fixed it yet.
        // That is what `past_due` means here, and the grace window is the
        // expirer's job from there.
        case 'subscription.on_hold':
        case 'subscription.grace_period':
          await this.markSubscriptionPastDue(subscription, providerData, tx);
          break;

        case 'subscription.cancelled':
          await this.handleProviderCancellation(subscription, tx);
          break;

        // The store has stopped billing and the period is over. Anything else
        // would leave the customer holding entitlements nobody is paying for.
        case 'subscription.expired':
          await this.endSubscription(subscription.id, 'grace_period_exhausted', tx);
          break;

        // `created` is the subscription we just made ourselves from the
        // purchase, and `updated` carries provider-side plan changes we do not
        // model. Both are acknowledged rather than acted on — but they are
        // acknowledged *here*, not sent down the payment-intent path where
        // they matched nothing and were retried until they were abandoned.
        case 'subscription.created':
        case 'subscription.updated':
          this.logger.log(
            `Subscription ${eventType} for ${subscription.id} (${rail}) — no action needed`,
          );
          break;
      }
    }, FULFILMENT_TX_OPTIONS);
  }

  /**
   * Which charge a renewal event is about: from the adapter where the rail has
   * one to ask, else from the charge id in the payload. Undefined for events
   * that are not renewals, null when the adapter says this one is not.
   *
   * There is no fallback to our own period. It was the period being renewed,
   * so a poll that had already renewed it gave the late webhook of the same
   * charge a fresh key, and a second renewal.
   */
  private async renewalEvidence(
    rail: string,
    eventType: SubscriptionEventType,
    providerSubscriptionId: string,
    payload: Record<string, any>,
  ): Promise<RenewalEvidence | null | undefined> {
    if (!RENEWAL_EVENTS.has(eventType)) return undefined;
    const subscription = await this.prisma.subscription.findFirst({
      where: { rail, providerSubscriptionId },
      select: { currentPeriodEnd: true },
    });
    if (!subscription) return undefined;

    let connector: Connector | null = null;
    try {
      connector = this.getAdapter(rail) as Connector;
    } catch {
      connector = null;
    }
    if (connector?.readRenewal) {
      return connector.readRenewal({
        providerSubscriptionId,
        currentPeriodEnd: subscription.currentPeriodEnd,
        payload,
      });
    }
    const chargeId = payload?.id || payload?.charge || payload?.payment_intent;
    if (!chargeId) {
      throw new Error(`${rail} renewal of ${providerSubscriptionId} names no charge`);
    }
    return { chargeId: String(chargeId) };
  }

  /**
   * Renewal — synthesise paid Order + PaymentIntent and run handleOrderPaid
   * so the existing period-advance / entitlement-regrant / credits / outbox
   * logic fires unchanged. One charge is booked once, for what was charged and
   * the period it paid for. The unique (provider_intent_id, rail) is the
   * backstop behind the guards below.
   */
  private async advanceSubscriptionPeriod(
    subscription: any,
    evidence: RenewalEvidence,
    providerData: Record<string, any>,
    tx: any,
  ): Promise<void> {
    const price = subscription.price;
    const ids = [evidence.chargeId, ...(evidence.aliases ?? [])];
    const existing = await tx.paymentIntent.findFirst({
      where: { rail: subscription.rail, providerIntentId: { in: ids } },
      select: { id: true },
    });
    if (existing) {
      this.logger.warn(
        `Renewal ${evidence.chargeId} already applied for subscription ${subscription.id}; skipping (idempotent)`,
      );
      return;
    }

    const interval = price.interval || 'month';
    const heldEnd = new Date(subscription.currentPeriodEnd);
    if (evidence.periodEnd) {
      // A period we already hold is not a second renewal of it: this is also
      // what recognises one the code before this booked under its own key.
      const half = (calculatePeriodEnd(heldEnd, interval).getTime() - heldEnd.getTime()) / 2;
      const ahead = evidence.periodEnd.getTime() - heldEnd.getTime();
      if (ahead <= half) {
        await this.confirmHeldPeriod(subscription, ahead > 0 ? evidence.periodEnd : heldEnd, tx);
        return;
      }
    }

    const now = new Date();
    let periodStart = heldEnd;
    let periodEnd =
      evidence.periodEnd ?? calculatePeriodEnd(heldEnd, interval, subscription.billingAnchor);
    if (evidence.periodEnd && evidence.periodStart && evidence.periodStart < evidence.periodEnd) {
      periodStart = evidence.periodStart;
    } else if (!evidence.periodEnd && periodEnd <= now) {
      // The old period ended so long ago that continuing it buys nothing.
      periodStart = now;
      periodEnd = calculatePeriodEnd(now, interval);
    }

    const amount = evidence.amount ?? price.amount;
    const currency = evidence.amount && evidence.currency ? evidence.currency : price.currency;
    if (String(currency) !== String(price.currency) || Number(amount) !== Number(price.amount)) {
      this.logger.warn(
        `Renewal ${evidence.chargeId} of subscription ${subscription.id} was charged ${amount} ${currency}; its price is ${price.amount} ${price.currency}`,
      );
    }

    const order = await tx.order.create({
      data: {
        userId: subscription.userId,
        priceId: price.id,
        externalId: `renewal_${evidence.chargeId}`,
        status: 'paid',
        mode: 'SUBSCRIPTION',
        amount,
        currency,
        subscriptionId: subscription.id,
        periodStart,
        periodEnd,
        metadata: {
          renewal: true,
          subscription_id: subscription.id,
          provider_charge_id: evidence.chargeId,
          ...(evidence.aliases?.length ? { provider_charge_aliases: evidence.aliases } : {}),
        },
      },
    });

    await tx.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: subscription.rail,
        status: 'paid',
        providerIntentId: evidence.chargeId,
        amount,
        currency,
        snapshot: providerData,
      },
    });

    // Reuse existing fulfilment — creates invoice, advances period, grants
    // entitlements, resets credits, emits outbox events.
    await this.handleOrderPaid(order.id, tx);
  }

  /**
   * The provider's period is the one already held, give or take its own date:
   * take the date, and a subscription marked past due while it was paid up
   * stops being so. No money moved, so no order.
   */
  private async confirmHeldPeriod(subscription: any, periodEnd: Date, tx: any): Promise<void> {
    const moved = periodEnd.getTime() !== new Date(subscription.currentPeriodEnd).getTime();
    const revived = subscription.status === 'past_due' && periodEnd > new Date();
    if (!moved && !revived) return;
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        currentPeriodEnd: periodEnd,
        ...(revived ? { status: 'active' } : {}),
        updatedAt: new Date(),
      },
    });
    if (moved) {
      const grace = (subscription.price?.graceDays || 0) * 86_400_000;
      await tx.entitlement.updateMany({
        where: {
          userId: subscription.userId,
          source: 'subscription',
          status: 'active',
          value: { path: ['subscription_id'], equals: subscription.id },
        },
        data: { expiresAt: new Date(periodEnd.getTime() + grace), updatedAt: new Date() },
      });
    }
  }

  private async markSubscriptionPastDue(
    subscription: any,
    providerData: Record<string, any>,
    tx: any,
  ): Promise<void> {
    if (subscription.status === 'past_due') return;
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'past_due', updatedAt: new Date() },
    });
    await this.outboxService.emit(
      'billing.subscription.payment_failed',
      {
        subscription_id: subscription.id,
        user_id: subscription.userId,
        current_period_end: subscription.currentPeriodEnd.toISOString(),
        provider_error: providerData?.errorMessage || providerData?.failure_message || null,
      },
      { serviceId: await this.serviceIdForSubscription(subscription.id, tx), tx: tx },
    );
  }

  private async handleProviderCancellation(subscription: any, tx: any): Promise<void> {
    if (subscription.status === 'canceled' || subscription.status === 'ended') return;
    // Honor cancelAtPeriodEnd UX: keep access until currentPeriodEnd, then
    // the expirer cron flips it to 'canceled' + revokes. If period already
    // passed we cancel immediately.
    const periodPassed = subscription.currentPeriodEnd <= new Date();
    if (periodPassed) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'canceled', cancelAtPeriodEnd: true, updatedAt: new Date() },
      });
      await this.revokeSubscriptionEntitlements(subscription.id, tx);
    } else {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true, updatedAt: new Date() },
      });
    }
    await this.outboxService.emit(
      'billing.subscription.cancelled',
      {
        subscription_id: subscription.id,
        user_id: subscription.userId,
        cancel_at_period_end: !periodPassed,
      },
      { serviceId: await this.serviceIdForSubscription(subscription.id, tx), tx: tx },
    );
  }

  /**
   * Revoke all active entitlements that were granted by a specific subscription.
   * Used by the expirer cron and provider-cancellation handler.
   */
  async revokeSubscriptionEntitlements(subscriptionId: string, tx: any): Promise<void> {
    const serviceId = await this.serviceIdForSubscription(subscriptionId, tx);
    const entitlements = await tx.entitlement.findMany({
      where: {
        source: 'subscription',
        status: 'active',
      },
    });
    const matching = entitlements.filter((e: any) => {
      const v = e.value as any;
      return v && v.subscription_id === subscriptionId;
    });
    if (matching.length === 0) return;
    await tx.entitlement.updateMany({
      where: { id: { in: matching.map((e: any) => e.id) } },
      data: { status: 'revoked', updatedAt: new Date() },
    });
    for (const e of matching) {
      await this.outboxService.emit(
        'billing.entitlement.revoked',
        {
          user_id: e.userId,
          key: e.key,
          source: 'subscription',
          subscription_id: subscriptionId,
        },
        { serviceId, tx },
      );
    }
  }

  /**
   * Mark a subscription as ended (period over, no more renewals coming) and
   * revoke its entitlements. Called by the expirer cron.
   */
  async endSubscription(
    subscriptionId: string,
    reason: 'promo_expired' | 'cancelled_at_period_end' | 'grace_period_exhausted',
    tx?: any,
  ): Promise<void> {
    const run = async (txInner: any) => {
      const sub = await txInner.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub || sub.status === 'ended') return;
      const newStatus = reason === 'cancelled_at_period_end' ? 'canceled' : 'ended';
      await txInner.subscription.update({
        where: { id: subscriptionId },
        data: { status: newStatus, updatedAt: new Date() },
      });
      await this.revokeSubscriptionEntitlements(subscriptionId, txInner);
      await this.outboxService.emit(
        'billing.subscription.ended',
        {
          subscription_id: subscriptionId,
          user_id: sub.userId,
          status: newStatus,
          reason,
        },
        { serviceId: await this.serviceIdForSubscription(subscriptionId, txInner), tx: txInner },
      );
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Which consumer an event about this subscription belongs to.
   *
   * Outbox deliveries are addressed by service now, and the subscription
   * lifecycle paths only carry an id — so the owner is read back through
   * price → product. Returns null when the chain is incomplete, and a null
   * owner is delivered to nobody rather than to everybody.
   */
  private async serviceIdForSubscription(subscriptionId: string, tx: any): Promise<string | null> {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { price: { include: { product: true } } },
    });
    return sub?.price?.product?.serviceId ?? null;
  }

  private extractEntitlementKeys(product: any): string[] {
    // Extract entitlement keys from product metadata
    // Format: metadata.entitlements = ["key1", "key2"] or metadata.entitlementKey = "key1"
    const metadata = product.metadata || {};
    if (Array.isArray(metadata.entitlements)) {
      return metadata.entitlements;
    }
    if (typeof metadata.entitlementKey === 'string') {
      return [metadata.entitlementKey];
    }
    // Default: use product code as entitlement key
    return [product.code];
  }

  /**
   * Extract provider subscription ID + rail from a PaymentIntent.
   *
   * Each rail records the provider's subscription identifier in a slightly
   * different place — Stripe puts it in the snapshot from the API, Lava
   * reuses the contract ID, Apple uses originalTransactionId, etc. PROMO
   * has no provider, so the linkage is null.
   */
  private extractProviderSubscriptionLinkage(intent: any): {
    providerSubscriptionId: string | null;
    rail: string | null;
  } {
    if (!intent) return { providerSubscriptionId: null, rail: null };
    const snapshot = (intent.snapshot as Record<string, any>) || {};
    const rail = intent.rail || null;

    let providerSubscriptionId: string | null = null;
    switch (rail) {
      case 'STRIPE':
        providerSubscriptionId =
          snapshot.subscription ||
          (typeof snapshot.id === 'string' && snapshot.id.startsWith('sub_') ? snapshot.id : null);
        break;
      case 'LAVA':
        // Lava reuses the contract ID as the subscription anchor; later
        // recurring contracts reference this one via parentContractId.
        providerSubscriptionId = intent.providerIntentId || null;
        break;
      case 'APPLE_IAP':
        // Apple identifies an auto-renewable subscription by its ORIGINAL
        // transaction id — constant across renewals. The per-renewal
        // transactionId changes each cycle, so renewal/cancel webhooks (which
        // anchor on originalTransactionId) must resolve to the same value we
        // persist here. The snapshot may hold it camelCase (raw StoreKit
        // transaction) or snake_case (our createPaymentIntent metadata); fall
        // back to providerIntentId, which equals originalTransactionId for the
        // first purchase.
        providerSubscriptionId =
          snapshot.originalTransactionId ||
          snapshot.apple_original_transaction_id ||
          intent.providerIntentId ||
          null;
        break;
      case 'GOOGLE_PLAY':
        // Google identifies a subscription by its purchase token, which we
        // persist as the PaymentIntent providerIntentId at creation. The paid
        // transition overwrites the snapshot with the SubscriptionPurchaseV2
        // object (which does not echo the token), so providerIntentId is the
        // reliable anchor.
        providerSubscriptionId =
          intent.providerIntentId ||
          snapshot.google_purchase_token ||
          snapshot.purchaseToken ||
          null;
        break;
      case 'PROMO':
      case 'CRYPTO':
      case 'ONE':
      default:
        providerSubscriptionId = null;
    }

    return { providerSubscriptionId, rail };
  }

  /**
   * Grant credits if product metadata defines creditsPerPeriod or credits
   */
  private async handleCreditsGrant(order: any, tx: any): Promise<void> {
    const product = order.price?.product;
    if (!product) return;

    const metadata = product.metadata || {};
    const creditsPerPeriod = metadata.creditsPerPeriod || metadata.credits;
    if (!creditsPerPeriod) return;

    const serviceId = product.serviceId;

    // Credits are granted on the SAME transaction as the payment (tx) — never a
    // separate one. A failure here must roll the whole fulfilment back (the
    // webhook then retries) rather than be swallowed, otherwise a paid order can
    // silently grant nothing, and a later rollback would leave phantom credits.
    if (order.mode === 'SUBSCRIPTION' || subscriptionOrderKind(order)) {
      // For subscriptions, find the subscription to get period end
      const subscription = order.subscriptionId
        ? await tx.subscription.findUnique({ where: { id: order.subscriptionId } })
        : await tx.subscription.findFirst({
            where: {
              userId: order.userId,
              priceId: order.priceId,
              status: { in: ['trialing', 'active', 'past_due'] },
            },
            orderBy: { updatedAt: 'desc' },
          });

      const periodEnd =
        subscription?.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.creditsService.resetForPeriod(
        {
          userId: order.userId,
          serviceId,
          newBalance: creditsPerPeriod,
          resetsAt: periodEnd,
          // Stamped so a refund of this order can find what it granted.
          orderId: order.id,
        },
        tx,
      );
    } else {
      await this.creditsService.grant(
        {
          userId: order.userId,
          serviceId,
          amount: creditsPerPeriod,
          description: `Credits from order ${order.id}`,
          orderId: order.id,
        },
        tx,
      );
    }
  }

  /**
   * Refund credits that were granted for an order
   */
  /**
   * Take back the credits this order paid for.
   *
   * Two things were wrong here. The call was `creditsService.refund`, which
   * *added* credits — so refunding a 100-credit purchase left the customer with
   * 200 and their money back. And subscription grants were written by
   * `resetForPeriod` without an `orderId`, so this lookup found nothing and a
   * refunded subscription payment took back none of its credits at all.
   *
   * Reversals are skipped for grants already reversed, so a second refund
   * attempt on the same order cannot double-debit.
   */
  /**
   * What a full refund does to the subscription the order paid for: refunding
   * a period that is over changes no access, a period paid ahead is taken
   * back and nothing else, and the running period ends it.
   *
   * The order names its subscription and its period. One paid before orders
   * did is matched as it always was, by (userId, priceId), and only when no
   * newer paid order of that plan exists: refunding an old month used to end
   * today's subscription. Only a live subscription is touched.
   */
  private async endSubscriptionForRefundedOrder(order: any, tx: any): Promise<void> {
    const renewal = subscriptionOrderKind(order);
    const linkedId =
      order.subscriptionId ??
      (renewal?.kind === 'renewal' ? renewal.meta.subscriptionId : null) ??
      ((order.metadata as any)?.renewal ? (order.metadata as any).subscription_id : null);
    let subscription: any;
    if (linkedId) {
      subscription = await tx.subscription.findUnique({ where: { id: linkedId } });
      if (!subscription || !['trialing', 'active', 'past_due'].includes(subscription.status)) {
        return;
      }
    } else {
      const newer = await tx.order.count({
        where: {
          userId: order.userId,
          priceId: order.priceId,
          status: 'paid',
          createdAt: { gt: order.createdAt },
        },
      });
      if (newer > 0) {
        this.logger.log(`Order ${order.id} was refunded for an earlier period: access unchanged`);
        return;
      }
      subscription = await tx.subscription.findFirst({
        where: {
          userId: order.userId,
          priceId: order.priceId,
          status: { in: ['trialing', 'active', 'past_due'] },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!subscription) return;
    }

    const now = new Date();
    if (
      order.periodEnd &&
      new Date(order.periodEnd) <= now &&
      subscription.currentPeriodEnd > now
    ) {
      this.logger.log(`Order ${order.id} was refunded for a period that is over: access unchanged`);
      return;
    }
    if (
      order.periodStart &&
      new Date(order.periodStart) > now &&
      new Date(subscription.currentPeriodStart).getTime() === new Date(order.periodStart).getTime()
    ) {
      await this.takeBackPrepaidPeriod(subscription, order, tx);
      return;
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'ended', updatedAt: new Date() },
    });
    await this.revokeSubscriptionEntitlements(subscription.id, tx);
    await this.outboxService.emit(
      'billing.subscription.ended',
      {
        subscription_id: subscription.id,
        user_id: order.userId,
        status: 'ended',
        reason: 'payment_refunded',
        order_id: order.id,
      },
      { serviceId: order.price?.product?.serviceId ?? null, tx },
    );

    this.logger.log(`Ended subscription ${subscription.id}: order ${order.id} was refunded`);
  }

  private async takeBackPrepaidPeriod(subscription: any, order: any, tx: any): Promise<void> {
    const before = await tx.order.findFirst({
      where: { subscriptionId: subscription.id, periodEnd: order.periodStart, status: 'paid' },
      include: { price: true },
    });
    const periodEnd = new Date(order.periodStart);
    const grace = ((before?.price ?? order.price)?.graceDays || 0) * 86_400_000;
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        currentPeriodStart: before?.periodStart ?? subscription.createdAt,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      },
    });
    await tx.entitlement.updateMany({
      where: {
        userId: subscription.userId,
        source: 'subscription',
        status: 'active',
        value: { path: ['subscription_id'], equals: subscription.id },
      },
      data: { expiresAt: new Date(periodEnd.getTime() + grace), updatedAt: new Date() },
    });
    this.logger.log(
      `Order ${order.id} was refunded: subscription ${subscription.id} ends ${periodEnd.toISOString()}`,
    );
  }

  private async handleCreditsRefund(order: any, tx: any): Promise<void> {
    const grants = await tx.creditUsage.findMany({
      where: { orderId: order.id, type: 'grant' },
      include: { creditBalance: true },
    });
    if (grants.length === 0) return;

    const alreadyReversed = await tx.creditUsage.count({
      where: { orderId: order.id, type: 'purchase_reversal' },
    });
    if (alreadyReversed > 0) {
      this.logger.warn(
        `Credits for order ${order.id} were already revoked — skipping (refund replayed?)`,
      );
      return;
    }

    // On the same tx as the order refund so they commit together: a paid order
    // must not be marked refunded while the credits it bought stay in place.
    for (const grant of grants) {
      await this.creditsService.revokeGrant(
        {
          userId: grant.userId,
          serviceId: grant.creditBalance.serviceId ?? undefined,
          amount: grant.amount,
          orderId: order.id,
        },
        tx,
      );
    }
  }

  /**
   * Void the commissions a refunded order generated, and take back what was
   * already credited for them.
   *
   * A settled ('earned') commission has already been added to
   * `Affiliate.totalEarned`. Voiding it without unwinding that credit left the
   * affiliate's balance permanently carrying a sale that never happened — every
   * refund raised what they appeared to be owed, and the withdrawal path
   * authorised against exactly that number.
   *
   * Both halves run in the caller's money transaction, commissions locked before
   * the affiliate row — the same order the settlement job takes them in, so the
   * two cannot deadlock.
   */
  private async voidAffiliateCommissions(orderId: string, tx: any): Promise<void> {
    // Settled commissions: void and unwind their credit. RETURNING gives exactly
    // the rows this statement changed, so a commission the settlement job is
    // flipping concurrently is counted once, by whichever transaction wins.
    const settled: Array<{ affiliate_id: string; amount: any }> = await tx.$queryRaw(Prisma.sql`
      UPDATE billing.affiliate_commissions
         SET status = 'voided'::billing."CommissionStatus",
             updated_at = NOW()
       WHERE order_id = ${orderId}::uuid
         AND status = 'earned'::billing."CommissionStatus"
      RETURNING affiliate_id, amount
    `);

    const creditedByAffiliate = new Map<string, Decimal>();
    for (const row of settled) {
      const current = creditedByAffiliate.get(row.affiliate_id) ?? new Decimal(0);
      creditedByAffiliate.set(row.affiliate_id, current.plus(new Decimal(row.amount)));
    }

    for (const [affiliateId, credited] of creditedByAffiliate) {
      await tx.affiliate.update({
        where: { id: affiliateId },
        data: { totalEarned: { decrement: credited } },
      });
    }

    // Unsettled commissions were never credited — voiding them is the whole job.
    await tx.affiliateCommission.updateMany({
      where: { orderId, status: 'pending' },
      data: { status: 'voided' },
    });

    // Commissions already covered by a payout are real money that has left, or
    // is leaving. They are deliberately not voided — but nobody was being told,
    // and clawing them back is a decision for whoever runs the programme.
    const alreadyPaid = await tx.affiliateCommission.count({
      where: { orderId, status: 'paid' },
    });
    if (alreadyPaid > 0) {
      this.logger.warn(
        `Order ${orderId} was refunded after ${alreadyPaid} of its commissions were paid out — ` +
          `those commissions stand and need a manual clawback`,
      );
    }
  }

  /**
   * Handle affiliate commission using multi-level referral system.
   * Commissions are calculated on the original amount (before promo code discount).
   */
  private async handleAffiliateCommission(order: any, tx: any): Promise<void> {
    // Determine serviceId from product
    const serviceId = order.price?.product?.serviceId || undefined;

    // Commissions are calculated on the amount the user actually paid (after discount)
    const commissionBasisAmount = Number(order.amount);

    // Deliberately not caught. The swallow that used to be here protected
    // nothing: a database-level failure poisons the surrounding transaction, so
    // every step after this one — credits, the payment.succeeded event — failed
    // anyway, just with a misleading error. What it did do is let an
    // application-level failure commit: `processMultiLevelCommissions` burns the
    // referral's one-shot `firstOrderPaid` flag before it writes a single
    // commission row, so a swallowed error committed a referral marked as
    // converted with nothing to show for it — and the atomic check-and-set means
    // no later run will ever try again. Letting it throw rolls the flag back with
    // everything else and the webhook retries the whole settlement.
    await this.affiliatesService.processMultiLevelCommissions(
      order.id,
      order.userId,
      commissionBasisAmount,
      order.currency,
      serviceId,
      tx,
    );
  }
}
