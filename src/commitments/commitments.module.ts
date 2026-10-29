import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OutboxModule } from '../outbox/outbox.module';
import { CreditsModule } from '../credits/credits.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { WalletModule } from '../wallet/wallet.module';
import { ServiceApiModule } from '../service-api/service-api.module';
import { CommitmentsService } from './commitments.service';
import { CommitmentScheduler } from './commitment-scheduler.service';
import { CharitiesService } from './charities.service';
import { CommitmentCatalogService } from './commitment-catalog.service';
import { CommitmentRefunds } from './commitment-refunds';
import { CommitmentsController } from './commitments.controller';
import {
  CommitmentsAdminController,
  CommitmentsPublicController,
} from './commitments-public.controller';

/** Money held against a promise (docs/commitments.md). */
@Module({
  imports: [OutboxModule, CreditsModule, CheckoutModule, WalletModule, ServiceApiModule],
  // The public routes first: `charities` and `mine` must not be read as `:id`.
  controllers: [CommitmentsPublicController, CommitmentsAdminController, CommitmentsController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    CommitmentsService,
    CommitmentScheduler,
    CharitiesService,
    CommitmentCatalogService,
    CommitmentRefunds,
  ],
})
export class CommitmentsModule {}
