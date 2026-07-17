import { Module } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  controllers: [RecommendationsController],
  providers: [RecommendationsService, PrismaService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
