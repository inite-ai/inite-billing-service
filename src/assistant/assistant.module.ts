import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { PrismaService } from '../common/services/prisma.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { FunnelModule } from '../funnel/funnel.module';

@Module({
  imports: [ConversationsModule, FunnelModule],
  controllers: [AssistantController],
  providers: [AssistantService, PrismaService],
  exports: [AssistantService],
})
export class AssistantModule {}
