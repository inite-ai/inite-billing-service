import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../common/services/prisma.service';
import { assertPublicUrl } from './ssrf-guard';
import { postToPinnedAddress } from './pinned-post';
import { signOutboxDelivery } from './outbox-signature';

/**
 * Outbox publisher. Consumes `drain-outbox` jobs from `OutboxScheduler`, loads
 * pending `outbox_events`, and delivers each to the consumer it belongs to.
 *
 * It used to POST every event to every registered service. The payloads carry
 * user ids, order ids, amounts and entitlement keys, so the club module would
 * have received the health module's orders and vice versa — one signature
 * check away from being another tenant's ledger. Delivery is addressed by
 * `serviceId` now, and an event without one goes nowhere.
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

    // Only the services these events are addressed to, and only those that can
    // actually receive: inactive or webhook-less consumers are not failures.
    const ownerIds = [...new Set(events.map((e) => e.serviceId).filter(Boolean))] as string[];
    const subscribers = new Map<string, any>(
      (
        await this.prisma.service.findMany({
          where: { id: { in: ownerIds }, isActive: true },
        })
      )
        .filter((s: any) => s.webhookUrl != null)
        .map((s: any) => [s.id, s]),
    );

    for (const event of events) {
      let allDelivered = true;

      if (!event.serviceId) {
        // Fail closed. An unattributed event is a bug in the emitter, not a
        // licence to broadcast it to everyone.
        this.logger.warn(
          `Outbox event ${event.id} (${event.eventType}) has no owning service — not delivered`,
        );
        await this.outboxService.markSent(event.id);
        continue;
      }

      const service = subscribers.get(event.serviceId);
      if (!service) {
        // The addressee is inactive or has no webhook URL: there is nothing to
        // retry against, so the event is done rather than stuck.
        await this.outboxService.markSent(event.id);
        continue;
      }

      {
        const webhookUrl = (service as any).webhookUrl as string;

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
          // Deliver to the address the guard just vetted rather than to the
          // hostname. Resolving a second time inside the HTTP client left a
          // window where a record with a short TTL could answer the check with
          // a public address and the connection with 169.254.169.254.
          const res = await postToPinnedAddress({
            url: webhookUrl,
            addresses: guard.addresses!,
            headers: {
              'Content-Type': 'application/json',
              'x-service-code': service.code,
              'x-event-type': event.eventType,
              'x-event-id': event.id,
              'x-billing-timestamp': timestamp,
              'x-billing-signature': signature,
            },
            body,
            timeoutMs: 10_000,
          });

          // Redirects are not followed, so a 3xx surfaces as a non-ok response;
          // treat it (and any non-2xx) as a failed delivery to retry.
          if (!res.ok) {
            const note = res.status >= 300 && res.status < 400 ? ' (redirect not followed)' : '';
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
