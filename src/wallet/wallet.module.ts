import { Module } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { AdaptersModule } from '../adapters/adapters.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletAgentsService } from './wallet-agents.service';
import { AgentPaymentsService } from './agent-payments.service';
import { AgentTokenGuard } from './agent-token.guard';
import { WalletMcpController } from './wallet-mcp.controller';

/**
 * INITE wallets: a person's own USDC on Base, held under their passkey in
 * Turnkey, and the AI agents they let pay from it (`/mcp/wallet`).
 */
@Module({
  imports: [AdaptersModule],
  controllers: [WalletController, WalletMcpController],
  providers: [
    WalletService,
    WalletAgentsService,
    AgentPaymentsService,
    PrismaService,
    JwtAuthGuard,
    AgentTokenGuard,
  ],
})
export class WalletModule {}
