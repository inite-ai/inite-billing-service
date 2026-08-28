import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhooks') private readonly webhooksQueue: Queue,
  ) {}

  /**
   * Retrieve provider config (apiKey / apiSecret) for a given provider code.
   * Throws ForbiddenException if provider is not found or inactive.
   */
  async getProviderConfig(code: string): Promise<{ apiKey?: string; apiSecret?: string }> {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { code } });
    if (!provider || !provider.isActive) {
      throw new ForbiddenException(`${code} provider not configured`);
    }
    return (provider.config as Record<string, any>) || {};
  }

  /**
   * Store a webhook event and queue it for processing.
   *
   * The write and the enqueue are two steps and cannot be made one, so the
   * failure between them has to be survivable. It was not: if the enqueue threw
   * (Redis down, say) the row stayed at `received`, the provider retried, the
   * insert came back P2002, and the duplicate branch returned — quietly, having
   * queued nothing. A paid order's webhook was gone for good.
   *
   * Now the duplicate branch checks what that existing row is actually doing
   * and re-queues it when nobody has taken it. The job id is derived from the
   * event, so a re-queue collapses onto any job already waiting instead of
   * stacking up.
   */
  async storeWebhookEvent(
    rail: string,
    webhookId: string,
    eventType: string,
    entityId: string,
    payload: Record<string, any>,
  ): Promise<void> {
    try {
      // Idempotent insert - will fail if (rail, webhookId) already exists
      await this.prisma.webhookEvent.create({
        data: {
          rail,
          webhookId,
          eventType,
          entityId,
          payload,
          status: 'received',
        },
      });
    } catch (error: any) {
      if (error.code !== 'P2002') throw error;

      const existing = await this.prisma.webhookEvent.findUnique({
        where: { rail_webhookId: { rail, webhookId } },
        select: { status: true },
      });

      if (existing && (existing.status === 'processed' || existing.status === 'processing')) {
        this.logger.debug(`Webhook event already handled: ${rail}/${webhookId}`);
        return;
      }

      // Stored but never queued, or queued and failed: the provider's retry is
      // the second chance, so take it.
      this.logger.warn(
        `Webhook ${rail}/${webhookId} exists as '${existing?.status ?? 'unknown'}' but was not being processed — re-queueing`,
      );
    }

    await this.enqueue(rail, webhookId);
    this.logger.debug(`Webhook event stored and enqueued: ${rail}/${webhookId}`);
  }

  /**
   * A deterministic job id per webhook, so a re-queue of the same event
   * collapses onto the one already waiting rather than adding another.
   */
  private async enqueue(rail: string, webhookId: string): Promise<void> {
    await this.webhooksQueue.add(
      'process-webhook',
      { rail, webhookId },
      { jobId: `webhook:${rail}:${webhookId}`, removeOnComplete: true, removeOnFail: 1000 },
    );
  }
}
