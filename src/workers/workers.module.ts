import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookProcessor } from './webhook.processor';
import { OutboxProcessor } from './outbox.processor';
import { NotificationEmailProcessor } from './notification-email.processor';
import { OutreachProcessor } from './outreach.processor';
import { SubscriptionExpirerScheduler } from './subscription-expirer.scheduler';
import { AffiliatePayoutProcessor } from '../affiliates/affiliate-payout.processor';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { OutboxModule } from '../outbox/outbox.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutreachModule } from '../outreach/outreach.module';
import { RiskModule } from '../risk/risk.module';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  imports: [
    PaymentOrchestratorModule,
    OutboxModule,
    NotificationsModule,
    OutreachModule,
    RiskModule,
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
  providers: [
    WebhookProcessor,
    OutboxProcessor,
    NotificationEmailProcessor,
    OutreachProcessor,
    SubscriptionExpirerScheduler,
    PrismaService,
  ],
})
export class WorkersModule {}

