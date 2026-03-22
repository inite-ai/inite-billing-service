import { Module } from '@nestjs/common';
import { FunnelService } from './funnel.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  providers: [FunnelService, PrismaService],
  exports: [FunnelService],
})
export class FunnelModule {}
