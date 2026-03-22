import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { CreditsController } from './credits.controller';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  controllers: [CreditsController],
  providers: [CreditsService, PrismaService],
  exports: [CreditsService],
})
export class CreditsModule {}
