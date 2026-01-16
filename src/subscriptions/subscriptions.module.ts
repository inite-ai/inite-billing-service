import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PrismaService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

