import { Module, Global, forwardRef } from '@nestjs/common';
import { PaymentOrchestratorService } from './payment-orchestrator.service';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxModule } from '../outbox/outbox.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { FunnelModule } from '../funnel/funnel.module';
import { CreditsModule } from '../credits/credits.module';

@Global()
@Module({
  imports: [
    OutboxModule,
    forwardRef(() => AffiliatesModule),
    forwardRef(() => FunnelModule),
    forwardRef(() => CreditsModule),
  ],
  providers: [PaymentOrchestratorService, PrismaService],
  exports: [PaymentOrchestratorService, PrismaService],
})
export class PaymentOrchestratorModule {}
