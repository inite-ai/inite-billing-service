import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutreachService } from './outreach.service';
import { OutreachGeneratorService } from './outreach-generator.service';
import { OutreachTriggersScheduler } from './outreach-triggers.scheduler';
import { AdminOutreachController } from './admin-outreach.controller';
import { PrismaService } from '../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { FunnelModule } from '../funnel/funnel.module';

@Module({
  imports: [
    NotificationsModule,
    FunnelModule,
    BullModule.registerQueue({
      name: 'outreach',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000,
        },
      },
    }),
  ],
  controllers: [AdminOutreachController],
  providers: [
    OutreachService,
    OutreachGeneratorService,
    OutreachTriggersScheduler,
    PrismaService,
  ],
  exports: [OutreachService, BullModule],
})
export class OutreachModule {}
