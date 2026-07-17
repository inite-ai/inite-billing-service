import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { FunnelModule } from '../funnel/funnel.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [CatalogModule, PaymentOrchestratorModule, AffiliatesModule, PromoCodesModule, FunnelModule, RiskModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}

