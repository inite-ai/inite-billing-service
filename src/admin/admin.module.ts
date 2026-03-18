import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../common/services/prisma.service';
import { ReferralLevelsService } from '../affiliates/referral-levels.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, PrismaService, ReferralLevelsService],
})
export class AdminModule {}
