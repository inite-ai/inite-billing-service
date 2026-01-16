import { Module } from '@nestjs/common';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementsService, PrismaService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}

