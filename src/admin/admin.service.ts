import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
  ) {}

  private generateApiKey(): string {
    return `sk_${randomBytes(24).toString('hex')}`;
  }

  private maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 4) return '****';
    return `sk_****${apiKey.slice(-4)}`;
  }

  // ─── Services ──────────────────────────────────────────────

  async getServices() {
    const services = await this.prisma.service.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return services.map((s) => ({
      ...s,
      apiKey: this.maskApiKey(s.apiKey),
    }));
  }

  async createService(data: { code: string; name: string; metadata?: any }) {
    return this.prisma.service.create({
      data: {
        ...data,
        apiKey: this.generateApiKey(),
      },
    });
  }

  async updateService(
    id: string,
    data: { name?: string; isActive?: boolean; metadata?: any },
  ) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return this.prisma.service.update({ where: { id }, data });
  }

  async revealServiceApiKey(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return { apiKey: service.apiKey };
  }

  async regenerateServiceApiKey(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return this.prisma.service.update({
      where: { id },
      data: { apiKey: this.generateApiKey() },
    });
  }

  async deleteService(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return this.prisma.service.delete({ where: { id } });
  }

  // ─── Products ──────────────────────────────────────────────

  async getProducts(serviceId?: string) {
    const where: any = {};
    if (serviceId) where.serviceId = serviceId;

    return this.prisma.product.findMany({
      where,
      include: { prices: true, service: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProduct(data: {
    code: string;
    name: string;
    serviceId?: string;
    moduleScope: string;
    type: any;
    metadata?: any;
  }) {
    return this.prisma.product.create({ data });
  }

  async updateProduct(
    id: string,
    data: {
      name?: string;
      serviceId?: string;
      moduleScope?: string;
      isActive?: boolean;
      metadata?: any;
    },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);
    return this.prisma.product.update({ where: { id }, data });
  }

  async deleteProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);
    return this.prisma.product.delete({ where: { id } });
  }

  // ─── Prices ────────────────────────────────────────────────

  async getPrices(productId?: string) {
    const where: any = {};
    if (productId) where.productId = productId;

    return this.prisma.price.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPrice(data: {
    productId: string;
    code: string;
    currency: string;
    amount: number;
    interval?: string;
    trialDays?: number;
    graceDays?: number;
    metadata?: any;
  }) {
    return this.prisma.price.create({ data });
  }

  async updatePrice(
    id: string,
    data: {
      amount?: number;
      isActive?: boolean;
      trialDays?: number;
      graceDays?: number;
      metadata?: any;
    },
  ) {
    const price = await this.prisma.price.findUnique({ where: { id } });
    if (!price) throw new NotFoundException(`Price not found: ${id}`);
    return this.prisma.price.update({ where: { id }, data });
  }

  async deletePrice(id: string) {
    const price = await this.prisma.price.findUnique({ where: { id } });
    if (!price) throw new NotFoundException(`Price not found: ${id}`);
    return this.prisma.price.delete({ where: { id } });
  }

  // ─── Orders ────────────────────────────────────────────────

  async getOrders(params: {
    status?: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, userId, page = 1, limit = 20 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { price: { include: { product: true } }, paymentIntents: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
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

  // ─── Subscriptions ────────────────────────────────────────

  async getSubscriptions(params: {
    status?: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, userId, page = 1, limit = 20 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [items, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: { price: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async cancelSubscription(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException(`Subscription not found: ${id}`);

    return this.prisma.subscription.update({
      where: { id },
      data: { status: 'canceled', cancelAtPeriodEnd: true },
    });
  }

  // ─── Entitlements ──────────────────────────────────────────

  async getEntitlements(params: {
    userId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { userId, status, page = 1, limit = 20 } = params;
    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.entitlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.entitlement.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async createEntitlement(data: {
    userId: string;
    key: string;
    value?: any;
    expiresAt?: string;
  }) {
    return this.prisma.entitlement.create({
      data: {
        userId: data.userId,
        key: data.key,
        status: 'active',
        source: 'admin',
        value: data.value || {},
        startsAt: new Date(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  async updateEntitlement(
    id: string,
    data: { key?: string; value?: any; expiresAt?: string },
  ) {
    const ent = await this.prisma.entitlement.findUnique({ where: { id } });
    if (!ent) throw new NotFoundException(`Entitlement not found: ${id}`);

    const updateData: any = {};
    if (data.key) updateData.key = data.key;
    if (data.value) updateData.value = data.value;
    if (data.expiresAt) updateData.expiresAt = new Date(data.expiresAt);

    return this.prisma.entitlement.update({ where: { id }, data: updateData });
  }

  async revokeEntitlement(id: string) {
    const ent = await this.prisma.entitlement.findUnique({ where: { id } });
    if (!ent) throw new NotFoundException(`Entitlement not found: ${id}`);

    return this.prisma.entitlement.update({
      where: { id },
      data: { status: 'revoked' },
    });
  }

  // ─── Affiliates ────────────────────────────────────────────

  async getAffiliates(params: {
    status?: string;
    serviceId?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, serviceId, page = 1, limit = 20 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (serviceId) where.serviceId = serviceId;

    const [items, total] = await Promise.all([
      this.prisma.affiliate.findMany({
        where,
        include: {
          _count: { select: { referrals: true, commissions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.affiliate.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async updateAffiliate(
    id: string,
    data: { status?: string; commissionRate?: number },
  ) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id },
    });
    if (!affiliate)
      throw new NotFoundException(`Affiliate not found: ${id}`);

    // Validate commission rate bounds (C5)
    if (data.commissionRate !== undefined && (data.commissionRate < 0 || data.commissionRate > 1)) {
      throw new BadRequestException(
        'commissionRate must be between 0 and 1 (inclusive)',
      );
    }

    return this.prisma.affiliate.update({
      where: { id },
      data: data as any,
    });
  }

  // ─── Payouts ───────────────────────────────────────────────

  async getPayouts(params: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, page = 1, limit = 20 } = params;
    const where: any = {};
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.affiliatePayout.findMany({
        where,
        include: { affiliate: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.affiliatePayout.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async processPayout(id: string) {
    const payout = await this.prisma.affiliatePayout.findUnique({
      where: { id },
    });
    if (!payout) throw new NotFoundException(`Payout not found: ${id}`);
    if (payout.status !== 'pending') {
      throw new BadRequestException(`Payout is not in pending status`);
    }

    return this.prisma.affiliatePayout.update({
      where: { id },
      data: { status: 'paid', processedAt: new Date() },
    });
  }

  async failPayout(id: string, reason?: string) {
    const payout = await this.prisma.affiliatePayout.findUnique({
      where: { id },
    });
    if (!payout) throw new NotFoundException(`Payout not found: ${id}`);

    return this.prisma.affiliatePayout.update({
      where: { id },
      data: { status: 'failed', failureReason: reason || 'Marked as failed by admin' },
    });
  }

  // ─── Webhooks ──────────────────────────────────────────────

  async getWebhooks(params: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = params;

    const [items, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.webhookEvent.count(),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ─── Payment Providers ──────────────────────────────────────

  async getPaymentProviders() {
    return this.prisma.paymentProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPaymentProvider(data: {
    code: string;
    name: string;
    isActive?: boolean;
    supportedModes?: string[];
    currencies?: string[];
    countries?: string[];
    webhookUrl?: string;
    config?: any;
    metadata?: any;
  }) {
    return this.prisma.paymentProvider.create({ data: data as any });
  }

  async updatePaymentProvider(
    id: string,
    data: {
      name?: string;
      isActive?: boolean;
      supportedModes?: string[];
      currencies?: string[];
      countries?: string[];
      webhookUrl?: string;
      config?: any;
      metadata?: any;
    },
  ) {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payment provider not found: ${id}`);
    return this.prisma.paymentProvider.update({ where: { id }, data: data as any });
  }

  async deletePaymentProvider(id: string) {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payment provider not found: ${id}`);
    return this.prisma.paymentProvider.delete({ where: { id } });
  }

  // ─── Stats ─────────────────────────────────────────────────

  async getStats() {
    const [
      totalOrders,
      paidOrders,
      totalRevenue,
      activeSubscriptions,
      totalAffiliates,
      totalCommissions,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: 'paid' } }),
      this.prisma.order.aggregate({
        where: { status: 'paid' },
        _sum: { amount: true },
      }),
      this.prisma.subscription.count({
        where: { status: { in: ['active', 'trialing'] } },
      }),
      this.prisma.affiliate.count({ where: { status: 'active' } }),
      this.prisma.affiliateCommission.aggregate({
        where: { status: { in: ['earned', 'paid'] } },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalOrders,
      paidOrders,
      totalRevenue: totalRevenue._sum.amount?.toString() || '0',
      activeSubscriptions,
      totalAffiliates,
      totalCommissions: totalCommissions._sum.amount?.toString() || '0',
    };
  }
}
