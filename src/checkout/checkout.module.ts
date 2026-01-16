import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentOrchestratorModule } from '../payment-orchestrator/payment-orchestrator.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';

@Module({
  imports: [CatalogModule, PaymentOrchestratorModule, AffiliatesModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}

