import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/services/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async settleCommissions() {
    // Get all services with their settlement periods
    const services = await this.prisma.service.findMany({
      where: { isActive: true },
      select: { id: true, metadata: true },
    });

    let totalSettled = 0;

    for (const service of services) {
      const settlementDays = (service.metadata as any)?.settlementDays ?? 15;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - settlementDays);

      // Find pending commissions older than settlement period
      const pendingCommissions = await this.prisma.affiliateCommission.findMany({
        where: {
          status: 'pending',
          createdAt: { lte: cutoffDate },
          order: {
            price: {
              product: { serviceId: service.id },
            },
          },
        },
        include: { affiliate: true },
      });

      for (const commission of pendingCommissions) {
        await this.prisma.$transaction([
          this.prisma.affiliateCommission.update({
            where: { id: commission.id },
            data: {
              status: 'earned',
              earnedAt: new Date(),
            },
          }),
          this.prisma.affiliate.update({
            where: { id: commission.affiliateId },
            data: {
              totalEarned: { increment: Number(commission.amount) },
            },
          }),
        ]);
        totalSettled++;
      }
    }

    // Also settle commissions without a service (global affiliates)
    const defaultSettlementDays = 30;
    const globalCutoff = new Date();
    globalCutoff.setDate(globalCutoff.getDate() - defaultSettlementDays);

    const globalPending = await this.prisma.affiliateCommission.findMany({
      where: {
        status: 'pending',
        createdAt: { lte: globalCutoff },
        order: {
          price: {
            product: { serviceId: null },
          },
        },
      },
    });

    for (const commission of globalPending) {
      await this.prisma.$transaction([
        this.prisma.affiliateCommission.update({
          where: { id: commission.id },
          data: {
            status: 'earned',
            earnedAt: new Date(),
          },
        }),
        this.prisma.affiliate.update({
          where: { id: commission.affiliateId },
          data: {
            totalEarned: { increment: Number(commission.amount) },
          },
        }),
      ]);
      totalSettled++;
    }

    if (totalSettled > 0) {
      this.logger.log(`Settled ${totalSettled} commissions`);
    }
  }
}
