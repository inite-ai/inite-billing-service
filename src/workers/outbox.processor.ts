import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../common/services/prisma.service';

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^metadata\.google\.internal$/i,
];

function isPublicUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    return !PRIVATE_IP_PATTERNS.some((p) => p.test(hostname));
  } catch {
    return false;
  }
}

/**
 * Outbox publisher processor.
 * Polls outbox_events and delivers them via HTTP POST to all registered
 * services that have a webhookUrl configured.
 */
@Processor('outbox', {
  concurrency: 10,
})
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly outboxService: OutboxService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const events = await this.outboxService.getPendingEvents(100);
    if (events.length === 0) return;

    // Get all active services — filter by webhookUrl in JS (field may not be in Prisma types on CI)
    const allServices = await this.prisma.service.findMany({
      where: { isActive: true },
    });

    const services = allServices.filter(
      (s: any) => s.webhookUrl != null,
    );

    if (services.length === 0) {
      // No webhook consumers — mark all as sent
      for (const event of events) {
        await this.outboxService.markSent(event.id);
      }
      return;
    }

    for (const event of events) {
      let allDelivered = true;

      for (const service of services) {
        const webhookUrl = (service as any).webhookUrl as string;
        if (!webhookUrl) continue;

        if (!isPublicUrl(webhookUrl)) {
          this.logger.warn(
            `Rejecting private/invalid webhook URL for service ${service.code}: ${webhookUrl}`,
          );
          continue;
        }

        try {
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-service-code': service.code,
              'x-event-type': event.eventType,
              'x-event-id': event.id,
            },
            body: JSON.stringify({
              type: event.eventType,
              data: event.payload,
              aggregate: event.aggregate,
              eventId: event.id,
              timestamp: event.createdAt,
            }),
            signal: AbortSignal.timeout(10_000),
          });

          if (!res.ok) {
            this.logger.warn(
              `Webhook delivery failed for ${service.code}: ${res.status} ${res.statusText}`,
            );
            allDelivered = false;
          }
        } catch (error: any) {
          this.logger.error(
            `Webhook delivery error for ${service.code}: ${error.message}`,
          );
          allDelivered = false;
        }
      }

      if (allDelivered) {
        await this.outboxService.markSent(event.id);
      } else {
        await this.outboxService.markFailed(
          event.id,
          'One or more webhook deliveries failed',
        );
      }
    }
  }
}
