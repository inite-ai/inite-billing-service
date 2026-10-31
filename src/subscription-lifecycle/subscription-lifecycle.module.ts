import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ServiceApiModule } from '../service-api/service-api.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PrismaService } from '../common/services/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { PlanChangeService } from './plan-change.service';
import { SubscriptionRenewalsService } from './renewals.service';
import { SubscriptionChangeController } from './subscription-change.controller';
import { ServiceSubscriptionsController } from './service-subscriptions.controller';

/**
 * Family subscriptions sold through billing (inite-shared
 * .planning/family-subscriptions-2026-10.md §3.3): renewal where the rail
 * cannot recur, change of plan, the customer page's service view, and the
 * service-token lane's subscription routes.
 */
@Module({
  imports: [
    CheckoutModule,
    WalletModule,
    NotificationsModule,
    OutboxModule,
    ServiceApiModule,
    SubscriptionsModule,
  ],
  controllers: [SubscriptionChangeController, ServiceSubscriptionsController],
  providers: [
    PlanChangeService,
    SubscriptionRenewalsService,
    PrismaService,
    JwtAuthGuard,
    JwtOrServiceGuard,
  ],
})
export class SubscriptionLifecycleModule {}
