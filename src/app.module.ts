import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        // BullMQ/ioredis accepts URL string directly
        return {
          connection: redisUrl,
        };
      },
    }),
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
  ],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    // Adapters are registered in main.ts after app initialization
  }
}

