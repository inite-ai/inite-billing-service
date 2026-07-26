import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Producer for the transactional outbox.
 *
 * Domain code writes `OutboxEvent(status='new')` inside its transaction; this
 * scheduler is what actually drains them — it enqueues a drain job onto the
 * `outbox` queue, which `OutboxProcessor` consumes to POST events to every
 * active `Service.webhookUrl`. Without this producer nothing is ever delivered.
 *
 * The job uses a fixed `jobId` with `removeOnComplete/Fail`, so at most one
 * drain is waiting or active at any time — this prevents pile-up if a drain
 * runs longer than the tick, and (since only one drain runs) avoids two workers
 * fetching and double-delivering the same un-claimed `new` events.
 */
@Injectable()
export class OutboxScheduler {
  private readonly logger = new Logger(OutboxScheduler.name);

  constructor(@InjectQueue('outbox') private readonly outboxQueue: Queue) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async enqueueDrain(): Promise<void> {
    try {
      await this.outboxQueue.add(
        'drain-outbox',
        {},
        {
          jobId: 'outbox-drain',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error: any) {
      this.logger.error(`Error enqueuing outbox drain job: ${error.message}`, error.stack);
    }
  }
}
