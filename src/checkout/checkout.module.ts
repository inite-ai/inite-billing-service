import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { FunnelModule } from '../funnel/funnel.module';
import { RiskModule } from '../risk/risk.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { CheckoutLinkOrJwtGuard, CheckoutLinkOrJwtOrServiceGuard } from './checkout-link.guard';

@Module({
  imports: [
    CatalogModule,
    PaymentOrchestratorModule,
    AffiliatesModule,
    PromoCodesModule,
    FunnelModule,
    RiskModule,
  ],
  controllers: [CheckoutController],
  providers: [
    CheckoutService,
    // The checkout link guards hand everything without a link to these.
    JwtAuthGuard,
    JwtOrServiceGuard,
    CheckoutLinkOrJwtGuard,
    CheckoutLinkOrJwtOrServiceGuard,
  ],
  exports: [CheckoutService],
})
export class CheckoutModule {}
