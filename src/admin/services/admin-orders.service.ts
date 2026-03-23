import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { PaymentOrchestratorService } from '../../payment-orchestrator/payment-orchestrator.service';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
  ) {}

  async getOrders(params: {
    status?: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, userId, page, limit } = params;
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    return paginate(this.prisma.order, where, {
      page,
      limit,
      orderBy: { createdAt: 'desc' },
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
    const paidIntent = order.paymentIntents.find(
      (pi) => pi.status === 'paid',
    );
    if (paidIntent) {
      await this.paymentOrchestrator.applyStateTransition(
        paidIntent.id,
        'refunded',
      );
    } else {
      // Fallback: no paid intent found, just update order status directly
      this.logger.warn(
        `No paid payment intent found for order ${id}, updating status directly`,
      );
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

  async getSubscriptions(params: {
    status?: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, userId, page, limit } = params;
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    return paginate(this.prisma.subscription, where, {
      page,
      limit,
      orderBy: { createdAt: 'desc' },
      include: { price: { include: { product: true } } },
    });
  }

  async cancelSubscription(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException(`Subscription not found: ${id}`);

    return this.prisma.subscription.update({
      where: { id },
      data: { status: 'canceled', cancelAtPeriodEnd: true },
    });
  }
}
