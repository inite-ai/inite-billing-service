import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { getAddress, isAddress } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { WalletService } from './wallet.service';

class FundPixDto {
  /** Reais, e.g. "50". */
  @IsString() @MaxLength(12) amount!: string;
}

/**
 * Funding any INITE wallet by its address, for whoever has the link: the
 * page an agent hands a person (`/fund/<address>`). Shows only what the chain
 * already shows (the address, its USDC balance) and starts PIX top-ups that
 * Hodle delivers to that address. Nothing here can take money out.
 */
@ApiTags('Wallet funding')
@Controller('v1/public/fund')
export class WalletFundController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
  ) {}

  @Get(':address')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'An INITE wallet by address: balance and how to fund it' })
  async show(@Param('address') address: string) {
    const wallet = await this.find(address);
    const overview: any = await this.wallets.overview(wallet.ownerDid);
    return {
      address: wallet.address,
      network: overview.wallet?.network,
      asset: 'USDC',
      balance: overview.wallet?.balance ?? null,
      owner: wallet.ownerKey ? 'agent' : 'person',
      pix: overview.topups?.pix ?? false,
    };
  }

  @Post(':address/pix')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Top up by PIX: Hodle delivers USDC to this address' })
  async pix(@Param('address') address: string, @Body() body: FundPixDto) {
    const wallet = await this.find(address);
    return this.wallets.topUpByPix(wallet.ownerDid, body.amount);
  }

  @Get(':address/topups/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'A PIX top-up as it stands' })
  async topUp(@Param('address') address: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const wallet = await this.find(address);
    return this.wallets.topUp(wallet.ownerDid, id);
  }

  private async find(raw: string) {
    if (!isAddress(raw, { strict: false })) throw new NotFoundException('Not an INITE wallet');
    const wallet = await this.prisma.wallet.findUnique({ where: { address: getAddress(raw) } });
    if (!wallet) throw new NotFoundException('Not an INITE wallet');
    return wallet;
  }
}
