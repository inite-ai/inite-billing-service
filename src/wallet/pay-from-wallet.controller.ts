import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ServiceAuthGuard } from '../auth/guards/service-auth.guard';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { WalletMerchantsService } from './wallet-merchants.service';

class PayFromWalletDto {
  /** The buyer, as INITE Auth names them (their DID): whose wallet is charged. */
  @IsString() @MaxLength(255) userId!: string;
  /** Where the approve page sends the person back to (https). */
  @IsOptional() @IsString() @MaxLength(2000) returnTo?: string;
}

/**
 * A site pays its own checkout session from the buyer's INITE wallet.
 *
 * 200 — paid, or sent and confirming on Base (the order completes in a
 * minute or two); 409 — the person must act first, at `approveUrl`; 404 —
 * not this site's session, or wallet payments are off.
 */
@ApiTags('Checkout')
@ApiSecurity('api-key')
@UseGuards(ServiceAuthGuard)
@Controller('v1/checkout/sessions')
export class PayFromWalletController {
  constructor(private readonly merchants: WalletMerchantsService) {}

  @Post(':id/pay-from-wallet')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Pay a session from the buyer's INITE wallet, within the limits they set for this site",
  })
  async pay(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PayFromWalletDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user.isService || !user.serviceId || !user.serviceCode) {
      throw new ForbiddenException('A service key is required');
    }
    const result = await this.merchants.pay({
      ownerDid: body.userId,
      orderId: id,
      serviceId: user.serviceId,
      serviceCode: user.serviceCode,
      returnTo: body.returnTo,
    });
    if (result.status === 'needs_approval') res.status(409);
    return result;
  }
}
