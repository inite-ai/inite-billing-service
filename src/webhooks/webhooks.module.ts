import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../common/services/prisma.service';
import { AdaptersModule } from '../adapters/adapters.module';

@Module({
  imports: [
    AdaptersModule,
    BullModule.registerQueue({
      name: 'webhooks',
    }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, PrismaService],
  exports: [WebhooksService],
})
export class WebhooksModule {
  // OneAdapter and CryptoAdapter are provided by AdaptersModule
}

