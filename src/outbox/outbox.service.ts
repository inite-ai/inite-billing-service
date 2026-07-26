import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

/** Give up re-delivering a `failed` event after this many attempts. */
const MAX_DELIVERY_ATTEMPTS = 10;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emit an outbox event (idempotent creation)
   */
  async emit(
    eventType: string,
    payload: Record<string, any>,
    aggregate?: Record<string, any>,
    tx?: any,
  ): Promise<void> {
    const client = tx || this.prisma;
    try {
      await client.outboxEvent.create({
        data: {
          eventType,
          payload: payload || {},
          aggregate: aggregate || {},
          status: 'new',
        },
      });

      this.logger.debug(`Outbox event created: ${eventType}`);
    } catch (error) {
      this.logger.error(`Error creating outbox event: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get pending outbox events: brand-new events, plus `failed` events that
   * still have retry budget (so a transient consumer outage self-heals on the
   * next drain instead of stranding the event forever).
   */
  async getPendingEvents(limit: number = 100): Promise<any[]> {
    return this.prisma.outboxEvent.findMany({
      where: {
        OR: [{ status: 'new' }, { status: 'failed', attempts: { lt: MAX_DELIVERY_ATTEMPTS } }],
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
    });
  }

  /**
   * Mark event as sent
   */
  async markSent(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'sent',
        sentAt: new Date(),
      },
    });
  }

  /**
   * Mark event as failed. Uses an atomic `increment` so concurrent updates
   * can't clobber the attempt count (the previous read-modify-write was racy).
   */
  async markFailed(eventId: string, error: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
        lastError: error,
      },
    });
  }
}
