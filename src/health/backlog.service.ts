import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

export interface QueueBacklog {
  /** Waiting to be processed. */
  pending: number;
  /** Given up on after their retries. */
  failed: number;
  /** Age of the oldest pending item, in seconds. Null when there are none. */
  oldestPendingSeconds: number | null;
}

export interface BacklogReport {
  timestamp: string;
  outbox: QueueBacklog;
  webhooks: QueueBacklog;
  /** True when something has been waiting long enough to be worth looking at. */
  stalled: boolean;
}

/**
 * How much work is stuck.
 *
 * `/health/ready` answers whether the dependencies are reachable, which is a
 * different question from whether anything is getting done. Both of the real
 * incidents this service has had were of the second kind: the outbox publisher
 * and the webhook processor kept the process healthy and the database
 * reachable while events piled up behind them, and nothing said so. A count and
 * an age are enough to notice.
 */
const STALL_SECONDS = 15 * 60;

@Injectable()
export class BacklogService {
  constructor(private readonly prisma: PrismaService) {}

  async report(): Promise<BacklogReport> {
    const [outbox, webhooks] = await Promise.all([this.outboxBacklog(), this.webhookBacklog()]);

    const stalled = [outbox, webhooks].some(
      (queue) => queue.oldestPendingSeconds !== null && queue.oldestPendingSeconds > STALL_SECONDS,
    );

    return { timestamp: new Date().toISOString(), outbox, webhooks, stalled };
  }

  private async outboxBacklog(): Promise<QueueBacklog> {
    const [pending, failed, oldest] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'new' } }),
      this.prisma.outboxEvent.count({ where: { status: 'failed' } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: 'new' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return { pending, failed, oldestPendingSeconds: ageInSeconds(oldest?.createdAt) };
  }

  private async webhookBacklog(): Promise<QueueBacklog> {
    const [pending, failed, oldest] = await Promise.all([
      this.prisma.webhookEvent.count({ where: { status: { in: ['received', 'processing'] } } }),
      this.prisma.webhookEvent.count({ where: { status: 'failed' } }),
      this.prisma.webhookEvent.findFirst({
        where: { status: { in: ['received', 'processing'] } },
        orderBy: { receivedAt: 'asc' },
        select: { receivedAt: true },
      }),
    ]);

    return { pending, failed, oldestPendingSeconds: ageInSeconds(oldest?.receivedAt) };
  }
}

function ageInSeconds(at: Date | null | undefined): number | null {
  if (!at) return null;
  return Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
}
