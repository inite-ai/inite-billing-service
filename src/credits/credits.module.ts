import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { MeteringService } from './metering.service';
import { CreditsController } from './credits.controller';
import { PrismaService } from '../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [CreditsController],
  providers: [CreditsService, MeteringService, PrismaService],
  exports: [CreditsService, MeteringService],
})
export class CreditsModule {}
