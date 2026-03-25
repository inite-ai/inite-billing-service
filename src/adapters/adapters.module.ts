import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { OneAdapter } from './one/one.adapter';
import { CryptoAdapter } from './crypto/crypto.adapter';
import { LavaAdapter } from './lava/lava.adapter';
import { StripeAdapter } from './stripe/stripe.adapter';
import { AppleIAPAdapter } from './apple-iap/apple-iap.adapter';
import { GooglePlayAdapter } from './google-play/google-play.adapter';

@Module({
  providers: [
    PrismaService,
    OneAdapter,
    CryptoAdapter,
    LavaAdapter,
    StripeAdapter,
    AppleIAPAdapter,
    GooglePlayAdapter,
  ],
  exports: [
    OneAdapter,
    CryptoAdapter,
    LavaAdapter,
    StripeAdapter,
    AppleIAPAdapter,
    GooglePlayAdapter,
  ],
})
export class AdaptersModule {}
