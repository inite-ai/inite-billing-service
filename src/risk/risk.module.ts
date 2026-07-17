import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskAdminController } from './risk-admin.controller';
import { PrismaService } from '../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [NotificationsModule, OutboxModule, AdminModule],
  controllers: [RiskAdminController],
  providers: [RiskService, PrismaService],
  exports: [RiskService],
})
export class RiskModule {}
