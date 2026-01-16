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
import { MockOneAdapter } from '../test/mocks/one-adapter.mock';
import { PaymentOrchestratorService } from './payment-orchestrator/payment-orchestrator.service';
import { CryptoAdapter } from './adapters/crypto/crypto.adapter';
import { OneAdapter } from './adapters/one/one.adapter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.test',
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => {
        // Use in-memory Redis for tests (or mock)
        return {
          connection: {
            host: 'localhost',
            port: 6379,
          },
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
    // Wait a bit for modules to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // Register mock adapter instead of real ONE adapter
    this.orchestrator.registerAdapter(this.mockOneAdapter);
    this.orchestrator.registerAdapter(this.cryptoAdapter);
  }
}
