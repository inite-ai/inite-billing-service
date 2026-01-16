import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OneAdapter } from './one/one.adapter';
import { CryptoAdapter } from './crypto/crypto.adapter';

@Module({
  imports: [ConfigModule],
  providers: [OneAdapter, CryptoAdapter],
  exports: [OneAdapter, CryptoAdapter],
})
export class AdaptersModule {}

