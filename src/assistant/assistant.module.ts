import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { ActionRegistryService } from './actions/action-registry';
import { AssistantActionsService } from './actions/assistant-actions.service';
import { AssistantActionsController } from './actions/assistant-actions.controller';
import { PrismaService } from '../common/services/prisma.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { FunnelModule } from '../funnel/funnel.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { CreditsModule } from '../credits/credits.module';
import { AdminModule } from '../admin/admin.module';
import { RagModule } from '../rag/rag.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';

@Module({
  imports: [
    ConversationsModule,
    FunnelModule,
    SubscriptionsModule,
    PromoCodesModule,
    CreditsModule,
    AdminModule,
    RagModule,
    RecommendationsModule,
  ],
  controllers: [AssistantController, AssistantActionsController],
  providers: [
    AssistantService,
    ActionRegistryService,
    AssistantActionsService,
    PrismaService,
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
