import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Outbox publisher processor
 * Polls outbox_events and publishes them
 * Default implementation: logs events (can be extended to publish to message bus)
 */
@Processor('outbox', {
  concurrency: 10,
})
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(private readonly outboxService: OutboxService) {
    super();
  }

  async process(job: Job): Promise<void> {
    // This processor polls for pending events
    const events = await this.outboxService.getPendingEvents(100);

    for (const event of events) {
      try {
        // Default: log event (extend to publish to Kafka/RabbitMQ/etc)
        this.logger.log(`Outbox event: ${event.eventType}`, {
          eventId: event.id,
          payload: event.payload,
        });

        // TODO: Implement actual publisher (Kafka, RabbitMQ, etc)
        // await this.publisher.publish(event.eventType, event.payload);

        // Mark as sent
        await this.outboxService.markSent(event.id);
      } catch (error: any) {
        this.logger.error(
          `Error publishing outbox event ${event.id}: ${error.message}`,
          error.stack,
        );
        await this.outboxService.markFailed(event.id, error.message);
      }
    }
  }
}
