import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../common/services/prisma.service';
import { assertPublicUrl } from './ssrf-guard';
import { signOutboxDelivery } from './outbox-signature';

/**
 * Outbox publisher processor. Consumes `drain-outbox` jobs enqueued by
 * `OutboxScheduler`, loads pending `outbox_events`, and delivers each via HTTP
 * POST to every active service that has a `webhookUrl` (SSRF-guarded).
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

  async process(_job: Job): Promise<void> {
    const events = await this.outboxService.getPendingEvents(100);
    if (events.length === 0) return;

    // Get all active services — filter by webhookUrl in JS (field may not be in Prisma types on CI)
    const allServices = await this.prisma.service.findMany({
      where: { isActive: true },
    });

    const services = allServices.filter((s: any) => s.webhookUrl != null);

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

        // SSRF guard: resolve the host and reject if it (or any address it
        // resolves to) is private/loopback/link-local — not just a string check.
        const guard = await assertPublicUrl(webhookUrl);
        if (!guard.ok) {
          this.logger.warn(
            `Rejecting webhook URL for service ${service.code} (${guard.reason}): ${webhookUrl}`,
          );
          continue;
        }

        // Sign the exact body so consumers can authenticate the event (and reject
        // forged/replayed ones): HMAC-SHA256 over `${timestamp}.${body}` keyed on
        // the service's apiKey — a secret the consumer already holds.
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const body = JSON.stringify({
          type: event.eventType,
          data: event.payload,
          aggregate: event.aggregate,
          eventId: event.id,
          timestamp: event.createdAt,
        });
        const signature = signOutboxDelivery((service as any).apiKey, timestamp, body);

        try {
          const res = await fetch(webhookUrl, {
            method: 'POST',
            // Don't follow redirects — a public URL could 3xx into a private
            // target, sidestepping the SSRF guard above.
            redirect: 'manual',
            headers: {
              'Content-Type': 'application/json',
              'x-service-code': service.code,
              'x-event-type': event.eventType,
              'x-event-id': event.id,
              'x-billing-timestamp': timestamp,
              'x-billing-signature': signature,
            },
            body,
            signal: AbortSignal.timeout(10_000),
          });

          // With redirect:'manual' a 3xx surfaces as a non-ok response; treat it
          // (and any non-2xx) as a failed delivery to retry.
          if (!res.ok) {
            const note =
              res.status >= 300 && res.status < 400 ? ' (redirect not followed)' : '';
            this.logger.warn(
              `Webhook delivery failed for ${service.code}: ${res.status} ${res.statusText}${note}`,
            );
            allDelivered = false;
          }
        } catch (error: any) {
          this.logger.error(`Webhook delivery error for ${service.code}: ${error.message}`);
          allDelivered = false;
        }
      }

      if (allDelivered) {
        await this.outboxService.markSent(event.id);
      } else {
        await this.outboxService.markFailed(event.id, 'One or more webhook deliveries failed');
      }
    }
  }
}
