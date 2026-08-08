import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { RiskService } from '../risk/risk.service';
import { reconcileAmount } from './reconcile-amount';

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

      // Re-fetch the authoritative status from the provider for every rail
      // (never trust the webhook body's amount/status — see the validation
      // below), then reconcile against the stored order.
      const statusResult = await adapter.getIntentStatus(webhookEvent.entityId);

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

      if (finalStatus === 'paid') {
        // Reconcile against the adapter's NORMALIZED amount/currency (major
        // units). The previous check read raw provider fields
        // (amount/amountTotal.amount/total_amount) that don't exist under those
        // names and mixed cents with dollars, so provider(cents) < order(dollars)
        // was always false and underpayments were never caught.
        const rec = reconcileAmount(paymentIntent.order, statusResult);
        if (!rec.ok) {
          this.logger.warn(
            `Reconciliation ${rec.reason} for intent ${paymentIntent.id}: ` +
              `provider=${statusResult.amount} ${statusResult.currency ?? ''}, ` +
              `order=${paymentIntent.order.amount} ${paymentIntent.order.currency}`,
          );
          finalStatus = 'failed';
        } else if (!rec.reconciled) {
          this.logger.warn(
            `Paid webhook for intent ${paymentIntent.id} on rail ${rail} was not ` +
              `amount-reconciled: adapter supplied no normalized amount`,
          );
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
