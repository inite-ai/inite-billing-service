import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getEntitlements(params: {
    userId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { userId, status, page, limit } = params;
    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;

    return paginate(this.prisma.entitlement, where, {
      page,
      limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createEntitlement(data: { userId: string; key: string; value?: any; expiresAt?: string }) {
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

  async updateEntitlement(id: string, data: { key?: string; value?: any; expiresAt?: string }) {
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

  async getCustomers(params: { page?: number; limit?: number; search?: string }) {
    const { page = 1, limit = 20, search } = params;

    const whereClause: any = search ? { userId: { contains: search } } : {};

    const orders = await this.prisma.order.groupBy({
      by: ['userId'],
      _count: { id: true },
      _sum: { amount: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      where: whereClause,
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalUsers = await this.prisma.order.groupBy({
      by: ['userId'],
      where: whereClause,
    });

    const userIds = orders.map((o) => o.userId);

    const [subscriptions, entitlements, credits, affiliates] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          userId: { in: userIds },
          status: { in: ['active', 'trialing'] },
        },
        select: { userId: true, status: true, priceId: true },
      }),
      this.prisma.entitlement.findMany({
        where: { userId: { in: userIds }, status: 'active' },
        select: { userId: true, key: true },
      }),
      this.prisma.creditBalance.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, balance: true },
      }),
      this.prisma.affiliate.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, status: true, referralCode: true },
      }),
    ]);

    const items = orders.map((o) => ({
      userId: o.userId,
      totalOrders: o._count.id,
      totalSpent: o._sum.amount?.toString() || '0',
      lastOrderAt: o._max.createdAt,
      activeSubscriptions: subscriptions.filter((s) => s.userId === o.userId).length,
      activeEntitlements: entitlements.filter((e) => e.userId === o.userId).length,
      creditBalance: credits
        .filter((c) => c.userId === o.userId)
        .reduce((sum, c) => sum + c.balance, 0),
      affiliate: affiliates.find((a) => a.userId === o.userId) || null,
    }));

    return {
      items,
      total: totalUsers.length,
      page,
      limit,
      pages: Math.ceil(totalUsers.length / limit),
    };
  }

  async getCustomerDetail(userId: string) {
    const [orders, subscriptions, entitlements, credits, affiliate, funnelEvents] =
      await Promise.all([
        this.prisma.order.findMany({
          where: { userId },
          include: { price: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.subscription.findMany({
          where: { userId },
          include: { price: { include: { product: true } } },
        }),
        this.prisma.entitlement.findMany({ where: { userId } }),
        this.prisma.creditBalance.findMany({
          where: { userId },
          include: { service: true },
        }),
        this.prisma.affiliate.findFirst({ where: { userId } }),
        this.prisma.funnelEvent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);

    const totalSpent = orders
      .filter((o) => o.status === 'paid')
      .reduce((sum, o) => sum + Number(o.amount), 0);

    return {
      userId,
      totalOrders: orders.length,
      totalSpent,
      orders,
      subscriptions,
      entitlements,
      credits,
      affiliate,
      funnelEvents,
    };
  }
}
