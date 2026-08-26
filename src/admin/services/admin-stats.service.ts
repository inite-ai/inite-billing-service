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

  /**
   * What is waiting for someone, right now.
   *
   * The dashboard's six all-time counters answer "how are we doing"; nothing
   * answered "what do I have to clear today". Every number here is a queue an
   * operator can empty, and each one is the count behind a link to that queue
   * already filtered — so the panel is a to-do list rather than a scoreboard.
   */
  async getTriage() {
    // Orders sitting unpaid for a day are stuck, not in progress: a live
    // checkout resolves in minutes, so anything older is abandoned or broken.
    const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      pendingPayouts,
      pendingPayoutAmount,
      flaggedRisk,
      failedWebhooks,
      pastDueSubscriptions,
      staleOpenOrders,
      failedOutbox,
    ] = await Promise.all([
      this.prisma.affiliatePayout.count({ where: { status: 'pending' } }),
      this.prisma.affiliatePayout.aggregate({
        where: { status: 'pending' },
        _sum: { totalAmount: true },
      }),
      this.prisma.riskAssessment.count({ where: { status: { in: ['flagged', 'blocked'] } } }),
      this.prisma.webhookEvent.count({ where: { status: 'failed' } }),
      this.prisma.subscription.count({ where: { status: 'past_due' } }),
      this.prisma.order.count({
        where: { status: { in: ['created', 'open'] }, createdAt: { lt: staleBefore } },
      }),
      this.prisma.outboxEvent.count({ where: { status: 'failed' } }),
    ]);

    return {
      pendingPayouts,
      pendingPayoutAmount: pendingPayoutAmount._sum.totalAmount?.toString() || '0',
      flaggedRisk,
      failedWebhooks,
      pastDueSubscriptions,
      staleOpenOrders,
      staleOpenOrdersOlderThanHours: 24,
      failedOutbox,
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
