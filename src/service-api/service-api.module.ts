import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { WalletModule } from '../wallet/wallet.module';
import { ServiceTokenGuard } from './service-token.guard';
import { SessionLinksService } from './session-links';
import { ServiceCheckoutController } from './service-checkout.controller';

/** Billing's service API: INITE Auth service tokens with scopes, no static keys. */
@Module({
  imports: [CheckoutModule, WalletModule],
  controllers: [ServiceCheckoutController],
  providers: [PrismaService, ServiceTokenGuard, SessionLinksService],
  exports: [ServiceTokenGuard, SessionLinksService],
})
export class ServiceApiModule {}
