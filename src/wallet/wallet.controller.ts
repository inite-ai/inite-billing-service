import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { WalletService } from './wallet.service';

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
  constructor(private readonly wallets: WalletService) {}

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
}

function person(user: RequestUser): string {
  if (user.actor) throw new ForbiddenException('An agent cannot manage the wallet');
  if (user.isService) throw new ForbiddenException('The wallet is the person’s');
  return user.userId;
}
