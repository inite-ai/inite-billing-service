import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { paginate } from '../../common/helpers/paginate';

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

  async getWebhooks(params: { page?: number; limit?: number }) {
    const { page, limit } = params;

    return paginate(this.prisma.webhookEvent, {}, {
      page,
      limit,
      orderBy: { receivedAt: 'desc' },
    });
  }
}
