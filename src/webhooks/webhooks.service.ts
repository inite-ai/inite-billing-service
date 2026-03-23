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
   * Store webhook event idempotently and enqueue processing
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

      // Enqueue processing job
      await this.webhooksQueue.add('process-webhook', {
        rail,
        webhookId,
      });

      this.logger.debug(`Webhook event stored and enqueued: ${rail}/${webhookId}`);
    } catch (error: any) {
      // If unique constraint violation, webhook already processed
      if (error.code === 'P2002') {
        this.logger.debug(`Webhook event already exists: ${rail}/${webhookId}`);
        return;
      }
      throw error;
    }
  }
}

