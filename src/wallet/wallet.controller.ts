import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { WalletService } from './wallet.service';
import { WalletAgentsService } from './wallet-agents.service';
import { WalletMerchantsService } from './wallet-merchants.service';

class PasskeyAttestationDto {
  @IsString() @MaxLength(256) challenge!: string;
  @IsString() @MaxLength(1024) credentialId!: string;
  @IsString() @MaxLength(8192) clientDataJson!: string;
  @IsString() @MaxLength(16384) attestationObject!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) transports?: string[];
}

class OpenWalletDto {
  @ValidateNested() @Type(() => PasskeyAttestationDto) passkey!: PasskeyAttestationDto;
}

class PixTopUpDto {
  /** Reais, e.g. "50" or "49.90". */
  @IsString() @MaxLength(12) amount!: string;
}

class WithdrawDto {
  @IsString() @MaxLength(64) to!: string;
  /** USDC, up to six decimals. */
  @IsString() @MaxLength(24) amount!: string;
}

class ApproveAgentDto {
  @IsString() @MaxLength(12) perPayment!: string;
  @IsString() @MaxLength(12) daily!: string;
  @IsString() @MaxLength(12) monthly!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) merchants?: string[];
}

class AllowSiteDto {
  @IsString() @MaxLength(12) perPayment!: string;
  @IsString() @MaxLength(12) monthly!: string;
}

class PaySessionDto {
  @IsString() @MaxLength(64) sessionId!: string;
}

class ConfirmWithdrawalDto {
  /** The wallet passkey's stamp of the prepared request (Turnkey's X-Stamp-WebAuthn value). */
  @IsString() @MaxLength(8192) stamp!: string;
}

/**
 * The person's INITE wallet, for the account page in INITE ID.
 *
 * Only the person: a token an agent holds for them (one with `act`) is
 * refused here. Agents pay through their own grant, within the limits the
 * person set, never by opening, topping up or emptying the wallet.
 */
@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/wallet')
export class WalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly agents: WalletAgentsService,
    private readonly merchants: WalletMerchantsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The wallet, its USDC balance and recent top-ups and withdrawals' })
  overview(@User() user: RequestUser) {
    return this.wallets.overview(person(user));
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Open the wallet with a new passkey' })
  open(@User() user: RequestUser, @Body() body: OpenWalletDto) {
    return this.wallets.open(person(user), {
      ...body.passkey,
      transports: body.passkey.transports ?? [],
    });
  }

  @Post('topups/pix')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Top up by PIX: Hodle delivers USDC to the wallet' })
  topUpByPix(@User() user: RequestUser, @Body() body: PixTopUpDto) {
    return this.wallets.topUpByPix(person(user), body.amount);
  }

  @Get('topups/:id')
  @ApiOperation({ summary: 'A top-up as it stands' })
  topUp(@User() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.wallets.topUp(person(user), id);
  }

  @Post('withdrawals')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Prepare a withdrawal for the passkey to approve' })
  prepareWithdrawal(@User() user: RequestUser, @Body() body: WithdrawDto) {
    return this.wallets.prepareWithdrawal(person(user), body);
  }

  @Post('withdrawals/:id/confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a withdrawal the passkey approved' })
  confirmWithdrawal(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmWithdrawalDto,
  ) {
    return this.wallets.confirmWithdrawal(person(user), id, body.stamp);
  }

  @Get('agents')
  @ApiOperation({ summary: 'AI agents that asked for the wallet, with their limits and spending' })
  listAgents(@User() user: RequestUser) {
    return this.agents.list(person(user));
  }

  @Post('agents/:id/approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve an agent with these limits: the next request for the passkey' })
  approveAgent(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApproveAgentDto,
  ) {
    return this.agents.prepareApproval(person(user), id, body);
  }

  @Post('agents/:id/approve/confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Send the request the passkey approved; returns the next one or the agent',
  })
  confirmAgent(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmWithdrawalDto,
  ) {
    return this.agents.confirmApproval(person(user), id, body.stamp);
  }

  @Post('agents/:id/revoke')
  @ApiOperation({ summary: 'Take the wallet away from an agent; its key is erased at once' })
  revokeAgent(@User() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.agents.revoke(person(user), id);
  }

  @Get('sites')
  @ApiOperation({ summary: 'Sites allowed to charge the wallet, with their limits' })
  listSites(@User() user: RequestUser) {
    return this.merchants.list(person(user));
  }

  @Get('sites/:service')
  @ApiOperation({ summary: 'What the approve page shows for a site (and a session of it)' })
  site(
    @User() user: RequestUser,
    @Param('service') service: string,
    @Query('session') session?: string,
  ) {
    return this.merchants.preview(person(user), service, session);
  }

  @Put('sites/:service')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Allow a site to charge the wallet within these limits' })
  allowSite(
    @User() user: RequestUser,
    @Param('service') service: string,
    @Body() body: AllowSiteDto,
  ) {
    return this.merchants.allow(person(user), service, body);
  }

  @Delete('sites/:service')
  @ApiOperation({ summary: 'Stop a site from charging the wallet' })
  revokeSite(@User() user: RequestUser, @Param('service') service: string) {
    return this.merchants.revoke(person(user), service);
  }

  @Post('sites/:service/pay')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Pay one of the site's sessions from the wallet, now" })
  paySite(
    @User() user: RequestUser,
    @Param('service') service: string,
    @Body() body: PaySessionDto,
  ) {
    return this.merchants.payAsPerson(person(user), service, body.sessionId);
  }

  @Post('checkout/approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: "Make the wallet's INITE checkout user: the next request for the passkey",
  })
  prepareCheckout(@User() user: RequestUser) {
    return this.merchants.prepareCheckout(person(user));
  }

  @Post('checkout/approve/confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send the request the passkey approved; returns the next one or done' })
  confirmCheckout(@User() user: RequestUser, @Body() body: ConfirmWithdrawalDto) {
    return this.merchants.confirmCheckout(person(user), body.stamp);
  }
}

function person(user: RequestUser): string {
  if (user.actor) throw new ForbiddenException('An agent cannot manage the wallet');
  if (user.isService) throw new ForbiddenException('The wallet is the person’s');
  return user.userId;
}
