import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';

/** Settlement window for affiliates that belong to no particular service. */
const DEFAULT_SETTLEMENT_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Settles pending commissions after the service's settlement period.
 *
 * Flow:
 * 1. Order paid → commission created with status 'pending'
 * 2. After settlementDays pass without refund → status becomes 'earned',
 *    totalEarned incremented → available for withdrawal
 * 3. If order refunded during settlement → commission voided (handled by orchestrator)
 *
 * Steps 2's two halves — the status flip and the totalEarned increment — used to
 * be two separate statements per commission with no transaction around them. A
 * crash, a deploy, or a dropped connection between them left the commission
 * settled but the affiliate's total never credited: money they had earned, that
 * the ledger agreed they had earned, that they could never withdraw and no
 * subsequent run would ever notice (the flip is what makes a commission skipped
 * on the next pass). Both halves now commit together, per affiliate.
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
      const settlementDays = Number(
        (service.metadata as any)?.settlementDays ?? DEFAULT_SETTLEMENT_DAYS,
      );
      totalSettled += await this.settleScope({ serviceId: service.id }, settlementDays);
    }

    // Affiliates without a service (global programme).
    totalSettled += await this.settleScope({ serviceId: null }, DEFAULT_SETTLEMENT_DAYS);

    if (totalSettled > 0) {
      this.logger.log(`Settled ${totalSettled} commissions`);
    }
  }

  /**
   * Settle everything due for one programme. Grouped by affiliate so each
   * affiliate's commissions and their credited total move in a single
   * transaction.
   */
  private async settleScope(
    affiliateFilter: { serviceId: string | null },
    settlementDays: number,
  ): Promise<number> {
    const days = Number.isFinite(settlementDays) ? settlementDays : DEFAULT_SETTLEMENT_DAYS;
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const due = await this.prisma.affiliateCommission.groupBy({
      by: ['affiliateId'],
      where: {
        status: 'pending',
        createdAt: { lte: cutoff },
        affiliate: affiliateFilter,
      },
    });

    let settled = 0;
    for (const { affiliateId } of due) {
      try {
        settled += await this.settleAffiliate(affiliateId, cutoff);
      } catch (error: any) {
        // One affiliate's failure must not stop the rest of the programme;
        // nothing was flipped, so the next run picks these up again.
        this.logger.error(
          `Settlement failed for affiliate ${affiliateId}: ${error.message}`,
          error.stack,
        );
      }
    }
    return settled;
  }

  /**
   * Flip every due commission and credit their sum, atomically.
   *
   * The flip is a single `UPDATE ... RETURNING` so the rows credited are exactly
   * the rows this transaction changed — a commission voided by a concurrent
   * refund is filtered by the `status = 'pending'` predicate and never counted.
   * Locks are taken commissions-first, then the affiliate, matching the refund
   * path so the two can never deadlock against each other.
   */
  private async settleAffiliate(affiliateId: string, cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const flipped = await tx.$queryRaw<Array<{ amount: Decimal | string }>>(Prisma.sql`
        UPDATE billing.affiliate_commissions
           SET status = 'earned'::billing."CommissionStatus",
               earned_at = NOW(),
               updated_at = NOW()
         WHERE affiliate_id = ${affiliateId}::uuid
           AND status = 'pending'::billing."CommissionStatus"
           AND created_at <= ${cutoff}
        RETURNING amount
      `);

      if (flipped.length === 0) return 0;

      const credited = flipped.reduce(
        (sum, row) => sum.plus(new Decimal(row.amount as any)),
        new Decimal(0),
      );

      await tx.affiliate.update({
        where: { id: affiliateId },
        data: { totalEarned: { increment: credited } },
      });

      return flipped.length;
    });
  }
}
