import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { ConnectorsModule } from '../common/connectors/connectors.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ServiceApiModule } from '../service-api/service-api.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MerchantRailsService } from './merchant-rails.service';
import { MerchantsService } from './merchants.service';
import { MerchantsAdminController, MerchantsController } from './merchants.controller';
import { MerchantWebhooksController } from './merchant-webhooks.controller';

/**
 * Merchant-own payment accounts (docs/connected-accounts.md). Global so the
 * checkout, the orchestrator and the webhook processor can route a merchant's
 * order to the merchant's own account without importing this module.
 */
@Global()
@Module({
  imports: [ConnectorsModule, WebhooksModule, ServiceApiModule],
  controllers: [MerchantsController, MerchantsAdminController, MerchantWebhooksController],
  providers: [PrismaService, MerchantRailsService, MerchantsService, JwtAuthGuard],
  exports: [MerchantRailsService],
})
export class MerchantsModule {}
