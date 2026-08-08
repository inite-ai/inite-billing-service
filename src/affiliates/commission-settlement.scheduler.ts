import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';

/**
 * Settles pending commissions after the service's settlement period.
 *
 * Flow:
 * 1. Order paid → commission created with status 'pending'
 * 2. After settlementDays pass without refund → status becomes 'earned',
 *    totalEarned incremented → available for withdrawal
 * 3. If order refunded during settlement → commission voided (handled by orchestrator)
 */
@Injectable()
export class CommissionSettlementScheduler {
  private readonly logger = new Logger(CommissionSettlementScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async settleCommissions() {
    // One instance at a time — a concurrent replica could re-settle the same
    // pending commissions and double-count totalEarned.
    await this.lock.runWithLock('commission-settlement', 10 * 60_000, () => this.runSettlement());
  }

  private async runSettlement() {
    const services = await this.prisma.service.findMany({
      where: { isActive: true },
      select: { id: true, metadata: true },
    });

    let totalSettled = 0;

    for (const service of services) {
      const settlementDays = (service.metadata as any)?.settlementDays ?? 15;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - settlementDays);

      // Find pending commissions for affiliates of this service
      const pendingCommissions = await this.prisma.affiliateCommission.findMany({
        where: {
          status: 'pending',
          createdAt: { lte: cutoffDate },
          affiliate: { serviceId: service.id },
        },
      });

      for (const commission of pendingCommissions) {
        // Atomic: only settle if still pending (prevents race with refund→voided)
        const updated = await this.prisma.affiliateCommission.updateMany({
          where: { id: commission.id, status: 'pending' },
          data: { status: 'earned', earnedAt: new Date() },
        });
        if (updated.count === 0) continue; // Already voided or settled

        await this.prisma.affiliate.update({
          where: { id: commission.affiliateId },
          data: { totalEarned: { increment: Number(commission.amount) } },
        });
        totalSettled++;
      }
    }

    // Settle commissions for affiliates without a service (global)
    const defaultSettlementDays = 15;
    const globalCutoff = new Date();
    globalCutoff.setDate(globalCutoff.getDate() - defaultSettlementDays);

    const globalPending = await this.prisma.affiliateCommission.findMany({
      where: {
        status: 'pending',
        createdAt: { lte: globalCutoff },
        affiliate: { serviceId: null },
      },
    });

    for (const commission of globalPending) {
      const updated = await this.prisma.affiliateCommission.updateMany({
        where: { id: commission.id, status: 'pending' },
        data: { status: 'earned', earnedAt: new Date() },
      });
      if (updated.count === 0) continue;

      await this.prisma.affiliate.update({
        where: { id: commission.affiliateId },
        data: { totalEarned: { increment: Number(commission.amount) } },
      });
      totalSettled++;
    }

    if (totalSettled > 0) {
      this.logger.log(`Settled ${totalSettled} commissions`);
    }
  }
}
