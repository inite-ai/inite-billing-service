import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../common/services/prisma.service';
import { ReferralLevelsService } from '../affiliates/referral-levels.service';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';

@Module({
  imports: [PaymentOrchestratorModule, PromoCodesModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, ReferralLevelsService],
})
export class AdminModule {}
