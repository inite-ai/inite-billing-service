import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { MeteringService } from './metering.service';
import { CreditsController } from './credits.controller';
import { ServiceCreditsController } from './service-credits.controller';
import { ServiceCreditGrantsService } from './service-credit-grants.service';
import { PrismaService } from '../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
// Provided here, not imported with ServiceApiModule: that module reaches the
// payment orchestrator through checkout, and the orchestrator imports this one.
import { ServiceTokenGuard } from '../service-api/service-token.guard';

@Module({
  imports: [NotificationsModule, OutboxModule],
  controllers: [CreditsController, ServiceCreditsController],
  providers: [
    CreditsService,
    MeteringService,
    ServiceCreditGrantsService,
    ServiceTokenGuard,
    PrismaService,
  ],
  exports: [CreditsService, MeteringService],
})
export class CreditsModule {}
