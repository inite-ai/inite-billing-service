import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LockModule } from './common/locks/lock.module';
import { AnthropicModule } from './common/anthropic/anthropic.module';
import { AuthModule } from './auth/auth.module';
import { PaymentOrchestratorModule } from './payment-orchestrator/payment-orchestrator.module';
import { AdaptersModule } from './adapters/adapters.module';
import { CatalogModule } from './catalog/catalog.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OutboxModule } from './outbox/outbox.module';
import { WorkersModule } from './workers/workers.module';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { AdminModule } from './admin/admin.module';
import { PromoCodesModule } from './promo-codes/promo-codes.module';
import { HealthModule } from './health/health.module';
import { FunnelModule } from './funnel/funnel.module';
import { ConversationsModule } from './conversations/conversations.module';
import { AssistantModule } from './assistant/assistant.module';
import { CreditsModule } from './credits/credits.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutreachModule } from './outreach/outreach.module';
import { RagModule } from './rag/rag.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { RiskModule } from './risk/risk.module';
import { InsightsModule } from './insights/insights.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 60 }],
    }),
    ScheduleModule.forRoot(),
    LockModule,
    BullModule.forRootAsync({
      useFactory: () => {
        const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
          },
        };
      },
    }),
    AnthropicModule,
    AuthModule,
    PaymentOrchestratorModule,
    AdaptersModule,
    CatalogModule,
    CheckoutModule,
    OrdersModule,
    SubscriptionsModule,
    EntitlementsModule,
    WebhooksModule,
    OutboxModule,
    WorkersModule,
    AffiliatesModule,
    AdminModule,
    PromoCodesModule,
    HealthModule,
    FunnelModule,
    ConversationsModule,
    AssistantModule,
    CreditsModule,
    NotificationsModule,
    OutreachModule,
    RagModule,
    RecommendationsModule,
    RiskModule,
    InsightsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    // Adapters are registered in main.ts after app initialization
  }
}
