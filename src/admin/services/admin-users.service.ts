import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/services/prisma.service';
import { paginate } from '../../common/helpers/paginate';
import { resolveOrderBy, SortWhitelist } from '../../common/helpers/sort';

/**
 * The customer list is a `groupBy` over orders, so its sort keys are
 * aggregates, not columns: `orderBy: { totalSpent: ... }` is not a thing
 * Prisma can express here. Kept separate from {@link resolveOrderBy} for that
 * reason, and the keys match what the table's headers offer.
 */
const CUSTOMER_SORT = new Map<
  string,
  (dir: 'asc' | 'desc') => Prisma.OrderOrderByWithAggregationInput
>([
  ['lastOrderAt', (dir) => ({ _max: { createdAt: dir } })],
  ['totalSpent', (dir) => ({ _sum: { amount: dir } })],
  ['totalOrders', (dir) => ({ _count: { id: dir } })],
  ['userId', (dir) => ({ userId: dir })],
]);

export const ENTITLEMENT_SORT: SortWhitelist = {
  createdAt: (dir) => ({ createdAt: dir }),
  key: (dir) => ({ key: dir }),
  status: (dir) => ({ status: dir }),
  expiresAt: (dir) => ({ expiresAt: dir }),
  userId: (dir) => ({ userId: dir }),
};

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getEntitlements(params: {
    userId?: string;
    status?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { userId, status, page, limit, sortBy, sortOrder } = params;
    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;

    return paginate(this.prisma.entitlement, where, {
      page,
      limit,
      orderBy: resolveOrderBy(ENTITLEMENT_SORT, { createdAt: 'desc' }, sortBy, sortOrder),
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

  /**
   * How many distinct customers a filter matches. `groupBy` has no count, so
   * this is the row count of the grouping itself — kept next to the list it
   * describes so the export and the table can never disagree on the total.
   */
  async countCustomers(params: { search?: string }): Promise<number> {
    const where = params.search ? { userId: { contains: params.search } } : {};
    const groups = await this.prisma.order.groupBy({ by: ['userId'], where });
    return groups.length;
  }

  async getCustomers(params: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { page = 1, limit = 20, search, sortBy, sortOrder } = params;

    const whereClause: any = search ? { userId: { contains: search } } : {};

    const sortDir: 'asc' | 'desc' = sortOrder?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    // A `Map`, not an object indexed by the query string: indexing by an
    // untrusted name reaches the prototype whatever guard sits in front of it.
    const buildSort = sortBy ? CUSTOMER_SORT.get(sortBy) : undefined;

    // `groupBy` types its `orderBy` as a union of literal error strings unless
    // the sort is written inline, which a runtime-chosen sort cannot be. The
    // result shape is spelled out instead of inferred so the mapping below
    // stays type-checked.
    const orders = (await (this.prisma.order.groupBy as any)({
      by: ['userId'],
      _count: { id: true },
      _sum: { amount: true },
      _max: { createdAt: true },
      orderBy: buildSort ? buildSort(sortDir) : { _max: { createdAt: 'desc' } },
      where: whereClause,
      skip: (page - 1) * limit,
      take: limit,
    })) as Array<{
      userId: string;
      _count: { id: number };
      _sum: { amount: Prisma.Decimal | null };
      _max: { createdAt: Date | null };
    }>;

    const totalCustomers = await this.countCustomers({ search });

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
      total: totalCustomers,
      page,
      limit,
      pages: Math.ceil(totalCustomers / limit),
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
