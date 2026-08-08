import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DistributedLockService } from '../common/locks/distributed-lock.service';

/**
 * Scheduler for affiliate payouts
 * Runs daily to check if it's time to generate payouts (NET-15)
 */
@Injectable()
export class AffiliatePayoutScheduler {
  private readonly logger = new Logger(AffiliatePayoutScheduler.name);

  constructor(
    @InjectQueue('affiliate-payouts') private readonly payoutQueue: Queue,
    private readonly lock: DistributedLockService,
  ) {}

  /**
   * Run daily at 2 AM to check for pending payouts
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleAffiliatePayouts() {
    // One instance enqueues the payout job — otherwise every replica adds one and
    // payouts could be generated multiple times.
    await this.lock.runWithLock('affiliate-payout', 60_000, () => this.enqueuePayouts());
  }

  private async enqueuePayouts() {
    this.logger.log('Scheduled affiliate payout check triggered');

    try {
      // Add job to queue
      await this.payoutQueue.add(
        'process-payouts',
        {},
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      this.logger.log('Affiliate payout job added to queue');
    } catch (error: any) {
      this.logger.error(`Error scheduling affiliate payout job: ${error.message}`, error.stack);
    }
  }
}
