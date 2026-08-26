import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { paginate } from '../../common/helpers/paginate';
import { resolveOrderBy, SortWhitelist } from '../../common/helpers/sort';

export const WEBHOOK_SORT: SortWhitelist = {
  receivedAt: (dir) => ({ receivedAt: dir }),
  status: (dir) => ({ status: dir }),
  rail: (dir) => ({ rail: dir }),
  eventType: (dir) => ({ eventType: dir }),
  attempts: (dir) => ({ attempts: dir }),
};

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getWebhooks(params: {
    page?: number;
    limit?: number;
    status?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const { page, limit, status, sortBy, sortOrder } = params;

    return paginate(this.prisma.webhookEvent, status ? { status } : {}, {
      page,
      limit,
      orderBy: resolveOrderBy(WEBHOOK_SORT, { receivedAt: 'desc' }, sortBy, sortOrder),
    });
  }
}
