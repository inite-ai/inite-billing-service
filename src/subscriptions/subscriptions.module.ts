import { Module, forwardRef } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxModule } from '../outbox/outbox.module';
import { CreditsModule } from '../credits/credits.module';
import { FunnelModule } from '../funnel/funnel.module';

@Module({
  imports: [OutboxModule, forwardRef(() => CreditsModule), forwardRef(() => FunnelModule)],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PrismaService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
