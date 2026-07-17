import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { RiskService } from '../risk/risk.service';

interface WebhookJobData {
  rail: string;
  webhookId: string;
}

@Processor('webhooks', {
  concurrency: 5,
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrchestrator: PaymentOrchestratorService,
    @Optional() private readonly riskService?: RiskService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { rail, webhookId } = job.data;

    this.logger.log(`Processing webhook: ${rail}/${webhookId}`);

    // Lock webhook event
    const webhookEvent = await this.prisma.webhookEvent.findUnique({
      where: {
        rail_webhookId: {
          rail,
          webhookId,
        },
      },
    });

    if (!webhookEvent) {
      throw new Error(`Webhook event not found: ${rail}/${webhookId}`);
    }

    if (webhookEvent.status === 'processed') {
      this.logger.debug(`Webhook already processed: ${rail}/${webhookId}`);
      return;
    }

    // Recovery: if stuck in 'processing' for >5 min, allow retry
    if (webhookEvent.status === 'processing') {
      const stuckThreshold = 5 * 60 * 1000; // 5 minutes
      const lastActivity = new Date(webhookEvent.processedAt || webhookEvent.receivedAt).getTime();
      if (Date.now() - lastActivity < stuckThreshold) {
        this.logger.debug(`Webhook still processing: ${rail}/${webhookId}`);
        return;
      }
      this.logger.warn(`Recovering stuck webhook: ${rail}/${webhookId}`);
    }

    // Atomic: only claim if still in received/failed/stuck-processing state
    const claimed = await this.prisma.webhookEvent.updateMany({
      where: {
        id: webhookEvent.id,
        status: { in: ['received', 'failed', 'processing'] },
      },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      this.logger.debug(`Webhook already claimed: ${rail}/${webhookId}`);
      return;
    }

    try {
      // Get adapter
      const adapter = this.paymentOrchestrator.getAdapter(rail);

      // Subscription lifecycle events — renewal / renewal_failed / cancelled —
      // are anchored to the provider's *subscription* ID, not a PaymentIntent.
      // Route them through the orchestrator's subscription handler instead of
      // trying to look up an existing PaymentIntent (which won't match: each
      // renewal carries a new charge/contract ID).
      const subLifecycleEvents = new Set([
        'subscription.renewed',
        'subscription.renewal_failed',
        'subscription.cancelled',
      ]);
      if (subLifecycleEvents.has(webhookEvent.eventType)) {
        await this.paymentOrchestrator.handleSubscriptionEvent(
          rail,
          webhookEvent.eventType as any,
          webhookEvent.entityId,
          (webhookEvent.payload as Record<string, any>) || {},
        );
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'processed', processedAt: new Date() },
        });
        this.logger.log(
          `Subscription event processed: ${rail}/${webhookId} (${webhookEvent.eventType})`,
        );
        return;
      }

      // For ONE: Always fetch latest status from API
      let statusResult;
      if (rail === 'ONE') {
        statusResult = await adapter.getIntentStatus(webhookEvent.entityId);
      } else {
        // For other rails, use webhook data
        statusResult = await adapter.getIntentStatus(webhookEvent.entityId);
      }

      // Find payment intent by provider intent ID
      const paymentIntent = await this.prisma.paymentIntent.findFirst({
        where: {
          providerIntentId: webhookEvent.entityId,
          rail,
        },
        include: { order: true },
      });

      if (!paymentIntent) {
        this.logger.warn(`Payment intent not found for provider ID: ${webhookEvent.entityId}`);
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: {
            status: 'failed',
            lastError: 'Payment intent not found',
            attempts: webhookEvent.attempts + 1,
          },
        });
        return;
      }

      let finalStatus = statusResult.status as any;

      if (finalStatus === 'paid' && statusResult.providerData) {
        const order = paymentIntent.order;
        const providerAmount = Number(
          statusResult.providerData.amount ??
            statusResult.providerData.amountTotal?.amount ??
            statusResult.providerData.total_amount,
        );
        const providerCurrency = (
          statusResult.providerData.currency ??
          statusResult.providerData.amountTotal?.currency ??
          ''
        ).toUpperCase();

        const orderAmount = Number(order.amount);
        const orderCurrency = order.currency.toUpperCase();

        if (!isNaN(providerAmount) && providerAmount < orderAmount) {
          this.logger.warn(
            `Amount mismatch for intent ${paymentIntent.id}: provider=${providerAmount}, order=${orderAmount}`,
          );
          finalStatus = 'failed';
        } else if (providerCurrency && providerCurrency !== orderCurrency) {
          this.logger.warn(
            `Currency mismatch for intent ${paymentIntent.id}: provider=${providerCurrency}, order=${orderCurrency}`,
          );
          finalStatus = 'failed';
        }
      }

      // Apply state transition
      await this.paymentOrchestrator.applyStateTransition(
        paymentIntent.id,
        finalStatus,
        statusResult.providerData,
      );

      // Risk signals (fire-and-forget — must never fail webhook processing)
      if (this.riskService && paymentIntent.orderId) {
        if (finalStatus === 'failed') {
          void this.riskService
            .recordPaymentFailure(paymentIntent.orderId)
            .catch((err: any) => this.logger.warn(`Risk failure record error: ${err.message}`));
        } else if (finalStatus === 'paid') {
          void this.riskService
            .recordPaidWhileFlagged(paymentIntent.orderId)
            .catch((err: any) => this.logger.warn(`Risk paid-while-flagged error: ${err.message}`));
        }
      }

      // Mark as processed
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
        },
      });

      this.logger.log(`Webhook processed successfully: ${rail}/${webhookId}`);
    } catch (error: any) {
      this.logger.error(
        `Error processing webhook ${rail}/${webhookId}: ${error.message}`,
        error.stack,
      );

      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'failed',
          lastError: error.message,
          attempts: webhookEvent.attempts + 1,
        },
      });

      throw error;
    }
  }
}
