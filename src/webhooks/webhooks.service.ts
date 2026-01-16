import { Injectable, Logger } from '@nestjs/common';
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

