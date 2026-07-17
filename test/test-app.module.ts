import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AnthropicModule } from '../src/common/anthropic/anthropic.module';
import { AuthModule } from '../src/auth/auth.module';
import { PaymentOrchestratorModule } from '../src/payment-orchestrator/payment-orchestrator.module';
import { AdaptersModule } from '../src/adapters/adapters.module';
import { CatalogModule } from '../src/catalog/catalog.module';
import { CheckoutModule } from '../src/checkout/checkout.module';
import { OrdersModule } from '../src/orders/orders.module';
import { SubscriptionsModule } from '../src/subscriptions/subscriptions.module';
import { EntitlementsModule } from '../src/entitlements/entitlements.module';
import { WebhooksModule } from '../src/webhooks/webhooks.module';
import { OutboxModule } from '../src/outbox/outbox.module';
import { WorkersModule } from '../src/workers/workers.module';
import { AffiliatesModule } from '../src/affiliates/affiliates.module';
import { AdminModule } from '../src/admin/admin.module';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';

import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';
import { OneAdapter } from '../src/adapters/one/one.adapter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.test',
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6381';
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port, 10) || 6379,
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
  ],
  providers: [
    MockOneAdapter,
    {
      provide: OneAdapter,
      useClass: MockOneAdapter, // Replace real ONE adapter with mock
    },
  ],
  exports: [MockOneAdapter],
})
export class TestAppModule implements OnModuleInit {
  constructor(
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly mockOneAdapter: MockOneAdapter,
    private readonly cryptoAdapter: CryptoAdapter,
  ) {}

  async onModuleInit() {
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.orchestrator.registerAdapter(this.mockOneAdapter);
    this.orchestrator.registerAdapter(this.cryptoAdapter);
  }
}
