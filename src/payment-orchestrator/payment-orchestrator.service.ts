import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentRailAdapter } from '../common/interfaces/payment-rail-adapter.interface';
import {
  isValidTransition,
  mapIntentToOrderStatus,
  IntentStatus,
} from '../common/types/payment-state.types';
import { OutboxService } from '../outbox/outbox.service';
import { AffiliatesService } from '../affiliates/affiliates.service';

@Injectable()
export class PaymentOrchestratorService {
  private readonly logger = new Logger(PaymentOrchestratorService.name);
  private adapters: Map<string, PaymentRailAdapter> = new Map();
  private affiliatesService: AffiliatesService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  setAffiliatesService(affiliatesService: AffiliatesService) {
    this.affiliatesService = affiliatesService;
  }

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
      });
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

    // Emit event
    await this.outboxService.emit('billing.payment.succeeded', {
      order_id: order.id,
      user_id: order.userId,
      amount: order.amount.toString(),
      currency: order.currency,
    });
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

    // Revoke entitlements
    await tx.entitlement.updateMany({
      where: {
        userId: order.userId,
        source: 'order',
        status: 'active',
      },
      data: {
        status: 'revoked',
        updatedAt: new Date(),
      },
    });

    // Emit event
    await this.outboxService.emit('billing.payment.refunded', {
      order_id: order.id,
      user_id: order.userId,
    });

    await this.outboxService.emit('billing.entitlement.revoked', {
      user_id: order.userId,
      source: 'order',
      order_id: order.id,
    });
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
    });
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
      });
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

    // Grant/update entitlements
    const product = order.price.product;
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
      });
    }

    await this.outboxService.emit('billing.subscription.updated', {
      subscription_id: subscription.id,
      user_id: order.userId,
      status: subscription.status,
      current_period_end: periodEnd.toISOString(),
    });
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
   * Handle affiliate commission using multi-level referral system
   */
  private async handleAffiliateCommission(order: any, tx: any): Promise<void> {
    if (!this.affiliatesService) {
      this.logger.warn('AffiliatesService not set, skipping commission processing');
      return;
    }

    // Determine serviceId from product
    const serviceId = order.price?.product?.serviceId || undefined;

    try {
      await this.affiliatesService.processMultiLevelCommissions(
        order.id,
        order.userId,
        Number(order.amount),
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

