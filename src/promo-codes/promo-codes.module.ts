import { Module } from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  providers: [PromoCodesService, PrismaService],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
