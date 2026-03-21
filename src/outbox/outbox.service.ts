import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

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
   * Get pending outbox events
   */
  async getPendingEvents(limit: number = 100): Promise<any[]> {
    return this.prisma.outboxEvent.findMany({
      where: {
        status: 'new',
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
   * Mark event as failed
   */
  async markFailed(eventId: string, error: string): Promise<void> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
    });

    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'failed',
        attempts: (event?.attempts || 0) + 1,
        lastError: error,
      },
    });
  }
}

