import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Affiliate payout processor
 * Runs monthly to generate payouts for earned commissions (NET-15)
 * Payouts are generated 15 days after the end of each month
 */
@Processor('affiliate-payouts', {
  concurrency: 1,
})
export class AffiliatePayoutProcessor extends WorkerHost {
  private readonly logger = new Logger(AffiliatePayoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.logger.log('Processing affiliate payouts (NET-15)');

    // Calculate period: previous month
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // NET-15: payouts generated 15 days after month end
    const payoutDate = new Date(lastMonthEnd);
    payoutDate.setDate(payoutDate.getDate() + 15);

    // Only process if we're past the payout date
    if (now < payoutDate) {
      this.logger.debug(`Payout date not reached yet. Will process on ${payoutDate.toISOString()}`);
      return;
    }

    // Get all active affiliates
    const affiliates = await this.prisma.affiliate.findMany({
      where: { status: 'active' },
    });

    this.logger.log(`Processing payouts for ${affiliates.length} affiliates`);

    for (const affiliate of affiliates) {
      try {
        // Wrap per-affiliate payout logic in a transaction (H12)
        await this.prisma.$transaction(async (tx) => {
          // Check if payout already exists for this period
          const existingPayout = await tx.affiliatePayout.findFirst({
            where: {
              affiliateId: affiliate.id,
              periodStart: lastMonth,
              periodEnd: lastMonthEnd,
            },
          });

          if (existingPayout) {
            this.logger.debug(
              `Payout already exists for affiliate ${affiliate.id} for period ${lastMonth.toISOString()}`,
            );
            return;
          }

          // Get earned commissions for the period that haven't been paid
          const commissions = await tx.affiliateCommission.findMany({
            where: {
              affiliateId: affiliate.id,
              status: { in: ['earned', 'pending'] },
              earnedAt: {
                gte: lastMonth,
                lte: lastMonthEnd,
              },
              payoutId: null,
            },
          });

          if (commissions.length === 0) {
            this.logger.debug(`No commissions to payout for affiliate ${affiliate.id}`);
            return;
          }

          // Calculate total payout amount
          const totalAmount = commissions.reduce((sum, c) => sum + Number(c.amount), 0);

          if (totalAmount <= 0) {
            return;
          }

          // Group by currency
          const byCurrency = new Map<string, number>();
          for (const commission of commissions) {
            const current = byCurrency.get(commission.currency) || 0;
            byCurrency.set(commission.currency, current + Number(commission.amount));
          }

          // Create payout for each currency
          for (const [currency, amount] of byCurrency.entries()) {
            const payout = await tx.affiliatePayout.create({
              data: {
                affiliateId: affiliate.id,
                periodStart: lastMonth,
                periodEnd: lastMonthEnd,
                totalAmount: amount,
                currency,
                status: 'pending',
                payoutDate,
              },
            });

            // Link commissions to payout
            const currencyCommissions = commissions.filter((c) => c.currency === currency);

            await tx.affiliateCommission.updateMany({
              where: {
                id: { in: currencyCommissions.map((c) => c.id) },
              },
              data: {
                payoutId: payout.id,
                status: 'paid',
              },
            });

            // Update affiliate totals
            await tx.affiliate.update({
              where: { id: affiliate.id },
              data: {
                totalPaid: {
                  increment: amount,
                },
              },
            });

            this.logger.log(
              `Created payout ${payout.id} for affiliate ${affiliate.id}: ${amount} ${currency}`,
            );

            // Emit event
            await this.outboxService.emit('billing.affiliate.payout.created', {
              payout_id: payout.id,
              affiliate_id: affiliate.id,
              amount: amount.toString(),
              currency,
              period_start: lastMonth.toISOString(),
              period_end: lastMonthEnd.toISOString(),
            });
          }
        });
      } catch (error: any) {
        this.logger.error(
          `Error processing payout for affiliate ${affiliate.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log('Affiliate payout processing completed');
  }
}
