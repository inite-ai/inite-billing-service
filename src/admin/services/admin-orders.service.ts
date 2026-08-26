import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { PaymentOrchestratorService } from '../../payment-orchestrator/payment-orchestrator.service';
import { Connector } from '../../common/connectors/connector.interface';
import { paginate } from '../../common/helpers/paginate';
import { resolveOrderBy, SortWhitelist } from '../../common/helpers/sort';

/**
 * Columns an operator can sort the order list by. Ordering happens in the
 * database over the whole filtered set — sorting the twenty rows of the current
 * page would present a page-local ranking as a global one.
 */
export const ORDER_SORT: SortWhitelist = {
  createdAt: (dir) => ({ createdAt: dir }),
  amount: (dir) => ({ amount: dir }),
  status: (dir) => ({ status: dir }),
  userId: (dir) => ({ userId: dir }),
  product: (dir) => ({ price: { product: { name: dir } } }),
};

export const SUBSCRIPTION_SORT: SortWhitelist = {
  createdAt: (dir) => ({ createdAt: dir }),
  status: (dir) => ({ status: dir }),
  currentPeriodEnd: (dir) => ({ currentPeriodEnd: dir }),
  userId: (dir) => ({ userId: dir }),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The order list's filter, shared with the CSV export so an exported file is
 * the same set of records the operator was looking at — an export that quietly
 * dropped the filter would be worse than no export.
 */
export function buildOrderWhere(params: { status?: string; userId?: string; search?: string }) {
  const where: any = {};
  if (params.status) where.status = params.status;
  if (params.userId) where.userId = params.userId;

  const term = params.search?.trim();
  if (term) {
    where.OR = [
      // A pasted UUID should hit its record exactly rather than by substring.
      ...(UUID_RE.test(term) ? [{ id: term }, { userId: term }] : []),
      { externalId: { contains: term, mode: 'insensitive' } },
      { userId: { contains: term, mode: 'insensitive' } },
      { paymentIntents: { some: { providerIntentId: { contains: term } } } },
    ];
  }
  return where;
}

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
  ) {}

  /**
   * A support ticket carries an order number or a payment reference, not a
   * UUID — but `userId` (exact match) was the only way in, so the admin could
   * only find a record for someone who already knew the answer. `search`
   * accepts what an operator actually has and matches it across the identifiers
   * the order is reachable by. `userId` stays for existing callers.
   */
  async getOrders(params: {
    status?: string;
    userId?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { status, userId, search, page, limit, sortBy, sortOrder } = params;
    const where = buildOrderWhere({ status, userId, search });

    return paginate(this.prisma.order, where, {
      page,
      limit,
      orderBy: resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, sortBy, sortOrder),
      include: { price: { include: { product: true } }, paymentIntents: true },
    });
  }

  async getOrderById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        price: { include: { product: true } },
        paymentIntents: true,
        invoices: true,
        affiliateCommissions: true,
      },
    });
    if (!order) throw new NotFoundException(`Order not found: ${id}`);
    return order;
  }

  async refundOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { paymentIntents: true },
    });
    if (!order) throw new NotFoundException(`Order not found: ${id}`);
    if (order.status !== 'paid') {
      throw new BadRequestException(`Order is not in paid status`);
    }

    // Find the successful payment intent and transition it to refunded
    // This will revoke entitlements and update invoices via the orchestrator
    const paidIntent = order.paymentIntents.find((pi) => pi.status === 'paid');
    if (paidIntent) {
      // Issue the provider refund BEFORE the DB transition: applyStateTransition
      // revokes entitlements + reverses credits, so if we did that first and the
      // provider refund then failed, the customer would lose access without ever
      // getting their money back. For rails that can't refund programmatically
      // (IAP, crypto) this is a no-op and the refund is handled out-of-band.
      await this.issueProviderRefund(paidIntent, order);
      await this.paymentOrchestrator.applyStateTransition(paidIntent.id, 'refunded');
    } else {
      // Fallback: no paid intent found, just update order status directly
      this.logger.warn(`No paid payment intent found for order ${id}, updating status directly`);
      await this.prisma.order.update({
        where: { id },
        data: { status: 'refunded' },
      });
    }

    return this.prisma.order.findUnique({
      where: { id },
      include: { paymentIntents: true },
    });
  }

  /**
   * Ask the rail's connector to refund the charge, when it supports it. Throws
   * if the provider refund fails so the caller aborts before touching the DB —
   * a failed refund must not silently revoke the customer's access. Rails that
   * can't refund programmatically are skipped (refund handled out-of-band).
   */
  private async issueProviderRefund(paidIntent: any, order: any): Promise<void> {
    let connector: Connector | undefined;
    try {
      connector = this.paymentOrchestrator.getAdapter(paidIntent.rail) as Connector;
    } catch {
      this.logger.warn(
        `No connector for rail ${paidIntent.rail} — marking order ${order.id} refunded in DB only (refund the provider manually)`,
      );
      return;
    }

    const supportsRefund = connector.capabilities?.().supportsRefund && !!connector.refund;
    if (!supportsRefund) {
      this.logger.warn(
        `Rail ${paidIntent.rail} has no programmatic refund — order ${order.id} refunded in DB only (refund the provider manually)`,
      );
      return;
    }
    if (!paidIntent.providerIntentId) {
      throw new BadRequestException(
        `Cannot refund order ${order.id}: paid intent has no providerIntentId`,
      );
    }

    const result = await connector.refund!({
      providerIntentId: paidIntent.providerIntentId,
      amount: Number(order.amount),
      currency: order.currency,
    });
    if (!result.refunded) {
      throw new BadRequestException(`Provider refund did not succeed for order ${order.id}`);
    }
    this.logger.log(
      `Provider refund issued for order ${order.id} (${paidIntent.rail}, refund ${result.providerRefundId ?? 'n/a'})`,
    );
  }

  async getSubscriptions(params: {
    status?: string;
    userId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { status, userId, page, limit, sortBy, sortOrder } = params;
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    return paginate(this.prisma.subscription, where, {
      page,
      limit,
      orderBy: resolveOrderBy(SUBSCRIPTION_SORT, { createdAt: 'desc' }, sortBy, sortOrder),
      include: { price: { include: { product: true } } },
    });
  }

  async cancelSubscription(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException(`Subscription not found: ${id}`);

    // Stop the provider billing immediately, then revoke entitlements and emit
    // the domain event through the orchestrator — a bare status write left the
    // provider charging and downstream services (and the user's access) stale.
    await this.paymentOrchestrator.cancelProviderSubscription(sub, false);
    await this.paymentOrchestrator.endSubscription(id, 'cancelled_at_period_end');

    return this.prisma.subscription.findUnique({ where: { id } });
  }
}
