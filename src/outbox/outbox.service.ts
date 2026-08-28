import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

/** Give up re-delivering a `failed` event after this many attempts. */
const MAX_DELIVERY_ATTEMPTS = 10;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emit an outbox event.
   *
   * `serviceId` is who the event is *for*. It used to not exist, and the
   * publisher POSTed every event to every registered consumer — payloads carry
   * user ids, order ids, amounts and entitlement keys, so each product module
   * would have received every other module's billing traffic. It is an option
   * rather than a positional argument so that every call site has to name its
   * owner where a reader can see it.
   *
   * A null owner means the publisher delivers to nobody. That is the safe
   * direction for a leak: a caller that forgets to attribute an event stops a
   * delivery instead of broadcasting one.
   */
  async emit(
    eventType: string,
    payload: Record<string, any>,
    options: {
      serviceId?: string | null;
      aggregate?: Record<string, any>;
      tx?: any;
    } = {},
  ): Promise<void> {
    const { serviceId, aggregate, tx } = options;
    const client = tx || this.prisma;
    try {
      await client.outboxEvent.create({
        data: {
          eventType,
          payload: payload || {},
          aggregate: aggregate || {},
          status: 'new',
          serviceId: serviceId ?? null,
        },
      });

      this.logger.debug(`Outbox event created: ${eventType} (service: ${serviceId ?? 'none'})`);
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
