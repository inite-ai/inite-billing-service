import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { PrismaService } from '../common/services/prisma.service';
import { FunnelModule } from '../funnel/funnel.module';

@Module({
  imports: [FunnelModule],
  controllers: [InsightsController],
  providers: [InsightsService, PrismaService],
  exports: [InsightsService],
})
export class InsightsModule {}
