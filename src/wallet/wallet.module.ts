import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { AdaptersModule } from '../adapters/adapters.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/** INITE wallets: a person's own USDC on Base, held under their passkey in Turnkey. */
@Module({
  imports: [AdaptersModule],
  controllers: [WalletController],
  providers: [WalletService, PrismaService, JwtAuthGuard],
})
export class WalletModule {}
