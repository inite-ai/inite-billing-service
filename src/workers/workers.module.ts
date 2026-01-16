import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookProcessor } from './webhook.processor';
import { OutboxProcessor } from './outbox.processor';
import { AffiliatePayoutProcessor } from '../affiliates/affiliate-payout.processor';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    PaymentOrchestratorModule,
    OutboxModule,
    BullModule.registerQueue({
      name: 'webhooks',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    BullModule.registerQueue({
      name: 'outbox',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),
    BullModule.registerQueue({
      name: 'affiliate-payouts',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
  ],
  providers: [WebhookProcessor, OutboxProcessor],
})
export class WorkersModule {}

