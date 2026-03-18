import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OneAdapter } from './one/one.adapter';
import { CryptoAdapter } from './crypto/crypto.adapter';
import { LavaAdapter } from './lava/lava.adapter';

@Module({
  imports: [ConfigModule],
  providers: [OneAdapter, CryptoAdapter, LavaAdapter],
  exports: [OneAdapter, CryptoAdapter, LavaAdapter],
})
export class AdaptersModule {}
