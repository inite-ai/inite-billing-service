import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { SelfAgentGuard } from './self-agent.guard';
import { SelfAgentWalletService } from './self-agent-wallet.service';
import { WalletService } from './wallet.service';

class PayDto {
  @IsString() @MaxLength(2000) url!: string;
  /** The most the agent agrees to pay, in USDC. */
  @IsString() @MaxLength(24) maxAmount!: string;
  @IsOptional() @IsString() @MaxLength(10) method?: string;
  @IsOptional() @IsObject() headers?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(65_536) body?: string;
}

class StampDto {
  /** The agent key's stamp of the prepared request (Turnkey's X-Stamp value). */
  @IsString() @MaxLength(4096) stamp!: string;
}

class WithdrawDto {
  @IsString() @MaxLength(64) to!: string;
  @IsString() @MaxLength(24) amount!: string;
}

/**
 * The wallet of an AI agent with its own INITE identity: opened by the agent,
 * owned by the agent's key, funded by anyone who sends USDC to its address.
 */
@ApiTags('Agent wallet')
@ApiBearerAuth()
@UseGuards(SelfAgentGuard)
@Controller('v1/agent-wallet')
export class SelfAgentWalletController {
  constructor(
    private readonly agentWallets: SelfAgentWalletService,
    private readonly wallets: WalletService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The agent’s wallet: address to fund, balance, payments' })
  overview(@User() user: RequestUser) {
    return this.agentWallets.overview(user.userId);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Open the wallet; its only owner is the agent’s key from its DID document',
  })
  open(@User() user: RequestUser) {
    return this.agentWallets.open(user.userId);
  }

  @Post('payments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Read an x402 seller’s terms and prepare the payment for the agent’s stamp',
  })
  prepare(@User() user: RequestUser, @Body() body: PayDto) {
    return this.agentWallets.prepare(user.userId, body);
  }

  @Post('payments/:id/confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pay with the stamped request: Turnkey signs, the seller is paid' })
  confirm(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: StampDto,
  ) {
    return this.agentWallets.confirm(user.userId, id, body.stamp);
  }

  @Post('withdrawals')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Prepare a transfer out of the wallet for the agent’s stamp' })
  prepareWithdrawal(@User() user: RequestUser, @Body() body: WithdrawDto) {
    return this.wallets.prepareWithdrawal(user.userId, body);
  }

  @Post('withdrawals/:id/confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a transfer the agent stamped' })
  confirmWithdrawal(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: StampDto,
  ) {
    return this.wallets.confirmWithdrawal(user.userId, id, body.stamp);
  }
}
