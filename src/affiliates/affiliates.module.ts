import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';
import { AffiliatePayoutScheduler } from './affiliate-payout.scheduler';
import { AffiliatePayoutProcessor } from './affiliate-payout.processor';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    OutboxModule,
    BullModule.registerQueue({
      name: 'affiliate-payouts',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
  ],
  controllers: [AffiliatesController],
  providers: [
    AffiliatesService,
    AffiliatePayoutScheduler,
    AffiliatePayoutProcessor,
    PrismaService,
  ],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}
