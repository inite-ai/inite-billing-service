import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { OneAdapter } from './one/one.adapter';
import { CryptoAdapter } from './crypto/crypto.adapter';
import { LavaAdapter } from './lava/lava.adapter';

@Module({
  providers: [PrismaService, OneAdapter, CryptoAdapter, LavaAdapter],
  exports: [OneAdapter, CryptoAdapter, LavaAdapter],
})
export class AdaptersModule {}
