import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminCatalogService } from './services/admin-catalog.service';
import { AdminOrdersService } from './services/admin-orders.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminAffiliatesService } from './services/admin-affiliates.service';
import { AdminProvidersService } from './services/admin-providers.service';
import { AdminStatsService } from './services/admin-stats.service';
import { PrismaService } from '../common/services/prisma.service';
import { ReferralLevelsService } from '../affiliates/referral-levels.service';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { FunnelModule } from '../funnel/funnel.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [PaymentOrchestratorModule, PromoCodesModule, FunnelModule, CreditsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminCatalogService,
    AdminOrdersService,
    AdminUsersService,
    AdminAffiliatesService,
    AdminProvidersService,
    AdminStatsService,
    PrismaService,
    ReferralLevelsService,
  ],
})
export class AdminModule {}
