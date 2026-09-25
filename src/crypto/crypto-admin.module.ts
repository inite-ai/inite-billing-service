import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { WorkersModule } from '../workers/workers.module';
import { CryptoAdminController } from './crypto-admin.controller';
import { CryptoAdminService } from './crypto-admin.service';

/** Admin surface of the crypto rail: settings, invoices, unmatched transfers. */
@Module({
  imports: [WorkersModule],
  controllers: [CryptoAdminController],
  providers: [CryptoAdminService, PrismaService],
})
export class CryptoAdminModule {}
