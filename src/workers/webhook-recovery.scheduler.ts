import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';

/** How long a webhook may sit unqueued before this sweep assumes it was lost. */
const STRANDED_AFTER_MS = 2 * 60 * 1000;

/** Matches the processor's claim lease: past this, a holder is presumed dead. */
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

/** Bounded so one sweep cannot flood the queue after a long outage. */
const BATCH = 200;

/**
 * Re-queues webhooks the queue lost.
 *
 * Storing the event and enqueuing it are two steps, and the second one can fail
 * or evaporate: Redis restarts, the queue is flushed, a worker dies holding a
 * claim. When that happens nothing brings the event back — the provider had
 * already been answered with a 200, so there is no retry coming, and a paid
 * order's webhook sits at `received` forever.
 *
 * This is the backstop for exactly that: rows nobody is working on, re-queued
 * under the same deterministic job id, so a sweep that overlaps a live job
 * collapses onto it rather than duplicating work.
 */
@Injectable()
export class WebhookRecoveryScheduler {
  private readonly logger = new Logger(WebhookRecoveryScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: DistributedLockService,
    @InjectQueue('webhooks') private readonly webhooksQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    // One instance per tick: several replicas re-queueing the same rows is
    // harmless (the job id dedupes) but the queries are not free.
    await this.lock.runWithLock('webhook-recovery', 60_000, () => this.requeueStranded());
  }

  private async requeueStranded(): Promise<void> {
    const now = Date.now();
    const strandedBefore = new Date(now - STRANDED_AFTER_MS);
    const leaseExpiry = new Date(now - PROCESSING_LEASE_MS);

    const stranded = await this.prisma.webhookEvent.findMany({
      where: {
        OR: [
          // Stored, never queued — or queued into a Redis that then lost it.
          { status: 'received', receivedAt: { lt: strandedBefore } },
          // Claimed by a worker that never finished. The processor knows how to
          // take these over; it just needs a job to do it from.
          { status: 'processing', processedAt: { lt: leaseExpiry } },
          { status: 'processing', processedAt: null, receivedAt: { lt: leaseExpiry } },
        ],
      },
      select: { rail: true, webhookId: true, status: true },
      orderBy: { receivedAt: 'asc' },
      take: BATCH,
    });

    if (stranded.length === 0) return;

    for (const event of stranded) {
      await this.webhooksQueue.add(
        'process-webhook',
        { rail: event.rail, webhookId: event.webhookId },
        {
          jobId: `webhook:${event.rail}:${event.webhookId}`,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    }

    this.logger.warn(
      `Re-queued ${stranded.length} stranded webhook(s) — the queue lost them after they were stored`,
    );
  }
}
