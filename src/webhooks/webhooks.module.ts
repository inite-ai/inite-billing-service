import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'webhooks',
    }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, PrismaService],
  exports: [WebhooksService],
})
// The controller resolves each rail's connector via the global
// PaymentOrchestratorService (fed by the ConnectorRegistry) — no per-rail
// adapter wiring here anymore.
export class WebhooksModule {}
