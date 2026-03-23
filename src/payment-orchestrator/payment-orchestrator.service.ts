import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentRailAdapter } from '../common/interfaces/payment-rail-adapter.interface';
import {
  isValidTransition,
  mapIntentToOrderStatus,
  IntentStatus,
} from '../common/types/payment-state.types';
import { OutboxService } from '../outbox/outbox.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { FunnelService } from '../funnel/funnel.service';
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class PaymentOrchestratorService {
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
  ) {}

  registerAdapter(adapter: PaymentRailAdapter) {
    this.adapters.set(adapter.rail(), adapter);
    this.logger.log(`Registered payment rail adapter: ${adapter.rail()}`);
  }

  getAdapter(rail: string): PaymentRailAdapter {
    const adapter = this.adapters.get(rail);
    if (!adapter) {
      throw new NotFoundException(`Payment rail adapter not found: ${rail}`);
    }
    return adapter;
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
        throw new Error(
          `Invalid state transition: ${intent.status} -> ${newStatus}`,
        );
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

      // Map to order status
      const orderStatus = mapIntentToOrderStatus(newStatus);

      // Update order if status changed
      const currentOrderStatus = intent.order.status;
      if (currentOrderStatus !== orderStatus) {
        await tx.order.update({
          where: { id: intent.orderId },
          data: {
            status: orderStatus,
            updatedAt: new Date(),
          },
        });

        // Handle order status changes
        if (orderStatus === 'paid') {
          await this.handleOrderPaid(intent.orderId, tx);
        } else if (orderStatus === 'refunded') {
          await this.handleOrderRefunded(intent.orderId, tx);
        } else if (orderStatus === 'failed' || orderStatus === 'expired') {
          await this.handleOrderFailed(intent.orderId, tx);
        }
      }

      // Emit outbox events
      await this.outboxService.emit('billing.payment.status_changed', {
        payment_intent_id: paymentIntentId,
        order_id: intent.orderId,
        status: newStatus,
        previous_status: intent.status,
      }, undefined, tx);

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
    });
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

    if (order.mode === 'PAYMENT') {
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
    await this.outboxService.emit('billing.payment.succeeded', {
      order_id: order.id,
      user_id: order.userId,
      amount: order.amount.toString(),
      currency: order.currency,
    }, undefined, tx);
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
    await tx.affiliateCommission.updateMany({
      where: { orderId: order.id, status: { in: ['pending', 'earned'] } },
      data: { status: 'voided' },
    });

    // Refund credits if they were granted for this order
    await this.handleCreditsRefund(order, tx);

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
    await this.outboxService.emit('billing.payment.refunded', {
      order_id: order.id,
      user_id: order.userId,
    }, undefined, tx);

    await this.outboxService.emit('billing.entitlement.revoked', {
      user_id: order.userId,
      source: 'order',
      order_id: order.id,
    }, undefined, tx);
  }

  private async handleOrderFailed(orderId: string, tx: any): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) return;

    // Update invoice if exists
    await tx.invoice.updateMany({
      where: { orderId: order.id, status: 'open' },
      data: { status: 'failed' },
    });

    // Emit event
    await this.outboxService.emit('billing.payment.failed', {
      order_id: order.id,
      user_id: order.userId,
    }, undefined, tx);
  }

  private async grantEntitlementsForOrder(order: any, tx: any): Promise<void> {
    const product = order.price.product;
    const entitlementKeys = this.extractEntitlementKeys(product);

    for (const key of entitlementKeys) {
      await tx.entitlement.create({
        data: {
          userId: order.userId,
          key,
          status: 'active',
          source: 'order',
          startsAt: new Date(),
          expiresAt: null, // One-time payments don't expire
          value: {
            order_id: order.id,
            product_code: product.code,
          },
        },
      });

      await this.outboxService.emit('billing.entitlement.granted', {
        user_id: order.userId,
        key,
        source: 'order',
        order_id: order.id,
      }, undefined, tx);
    }
  }

  private async handleSubscriptionPayment(order: any, tx: any): Promise<void> {
    const price = order.price;
    const now = new Date();
    const periodEnd = this.calculatePeriodEnd(now, price.interval || 'month');
    const expiresAt = price.graceDays
      ? new Date(periodEnd.getTime() + price.graceDays * 24 * 60 * 60 * 1000)
      : periodEnd;

    // Find or create subscription
    let subscription = await tx.subscription.findFirst({
      where: {
        userId: order.userId,
        priceId: price.id,
        status: { in: ['trialing', 'active', 'past_due'] },
      },
    });

    const isRenewal = !!subscription;

    if (subscription) {
      // Update existing subscription
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          updatedAt: now,
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
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        },
      });
    }

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
          },
        },
      });

      await this.outboxService.emit('billing.entitlement.granted', {
        user_id: order.userId,
        key,
        source: 'subscription',
        subscription_id: subscription.id,
        expires_at: expiresAt.toISOString(),
      }, undefined, tx);
    }

    await this.outboxService.emit('billing.subscription.updated', {
      subscription_id: subscription.id,
      user_id: order.userId,
      status: subscription.status,
      current_period_end: periodEnd.toISOString(),
    }, undefined, tx);
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

  private calculatePeriodEnd(start: Date, interval: string): Date {
    const end = new Date(start);
    if (interval === 'month') {
      end.setMonth(end.getMonth() + 1);
    } else if (interval === 'year') {
      end.setFullYear(end.getFullYear() + 1);
    }
    return end;
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

    try {
      if (order.mode === 'SUBSCRIPTION') {
        // For subscriptions, find the subscription to get period end
        const subscription = await tx.subscription.findFirst({
          where: {
            userId: order.userId,
            priceId: order.priceId,
            status: { in: ['trialing', 'active', 'past_due'] },
          },
          orderBy: { updatedAt: 'desc' },
        });

        const periodEnd = subscription?.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await this.creditsService.resetForPeriod({
          userId: order.userId,
          serviceId,
          newBalance: creditsPerPeriod,
          resetsAt: periodEnd,
        });
      } else {
        await this.creditsService.grant({
          userId: order.userId,
          serviceId,
          amount: creditsPerPeriod,
          description: `Credits from order ${order.id}`,
          orderId: order.id,
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Error granting credits for order ${order.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Refund credits that were granted for an order
   */
  private async handleCreditsRefund(order: any, tx: any): Promise<void> {
    // Look up credit usages tied to this order
    const creditUsages = await tx.creditUsage.findMany({
      where: {
        orderId: order.id,
        type: 'grant',
      },
      include: { creditBalance: true },
    });

    for (const usage of creditUsages) {
      try {
        await this.creditsService.refund({
          userId: usage.userId,
          serviceId: usage.creditBalance.serviceId ?? undefined,
          amount: usage.amount,
          orderId: order.id,
        });
      } catch (error: any) {
        this.logger.error(
          `Error refunding credits for order ${order.id}: ${error.message}`,
          error.stack,
        );
      }
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

    try {
      await this.affiliatesService.processMultiLevelCommissions(
        order.id,
        order.userId,
        commissionBasisAmount,
        order.currency,
        serviceId,
        tx,
      );
    } catch (error: any) {
      this.logger.error(
        `Error processing multi-level commissions for order ${order.id}: ${error.message}`,
        error.stack,
      );
    }
  }
}
