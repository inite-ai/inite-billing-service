import { Module, Global, OnModuleInit } from '@nestjs/common';
import { PaymentOrchestratorService } from './payment-orchestrator.service';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxModule } from '../outbox/outbox.module';

@Global()
@Module({
  imports: [OutboxModule],
  providers: [PaymentOrchestratorService, PrismaService],
  exports: [PaymentOrchestratorService, PrismaService],
})
export class PaymentOrchestratorModule {}
