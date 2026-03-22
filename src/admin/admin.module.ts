import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../common/services/prisma.service';
import { ReferralLevelsService } from '../affiliates/referral-levels.service';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { FunnelModule } from '../funnel/funnel.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [PaymentOrchestratorModule, PromoCodesModule, FunnelModule, CreditsModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, ReferralLevelsService],
})
export class AdminModule {}
