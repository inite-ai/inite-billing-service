import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { canSeal, sealLegacyKeys } from '../common/key-seal';

/** At boot, seals the private keys written before they were sealed (key-seal.ts). */
@Injectable()
export class KeySealBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeySealBackfill.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (!canSeal()) {
      // Card and invoice payments do not need it; wallets and x402 refuse
      // to use or make a key until it is set.
      this.logger.error('KEY_SEAL_SECRET is not set: private keys can be neither made nor used');
      return;
    }
    try {
      const sealed = await sealLegacyKeys(this.prisma);
      if (sealed > 0) this.logger.log(`Sealed ${sealed} private key(s) stored bare`);
    } catch (error: any) {
      this.logger.error(`Could not seal stored private keys: ${error?.message}`);
    }
  }
}
