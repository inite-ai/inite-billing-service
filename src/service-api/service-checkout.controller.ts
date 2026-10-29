import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { IsUserId } from '../common/validators/is-user-id';
import { PrismaService } from '../common/services/prisma.service';
import { CheckoutService } from '../checkout/checkout.service';
import { CheckoutMode } from '../common/dto/checkout.dto';
import { WalletMerchantsService } from '../wallet/wallet-merchants.service';
import { SCOPE_CHECKOUT, ServiceScope, ServiceTokenGuard } from './service-token.guard';
import { SessionLinksService } from './session-links';

class ServiceSessionDto {
  @IsUserId() userId!: string;
  @IsString() @MaxLength(100) priceCode!: string;
  @IsUrl({ require_tld: false }) successUrl!: string;
  @IsUrl({ require_tld: false }) errorUrl!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(16) locale?: string;
}

class ServicePayFromWalletDto {
  @IsUserId() userId!: string;
  @IsOptional() @IsString() @MaxLength(2000) returnTo?: string;
}

/**
 * An ordinary purchase opened by a service with an INITE Auth service token
 * (`billing:checkout`) — the same checkout as POST /v1/checkout/sessions, the
 * mikefluff-site "Path B", without a shared static key. A service sells only
 * its own catalogue and reads only its own sessions.
 */
@ApiTags('Checkout')
@ApiBearerAuth()
@UseGuards(ServiceTokenGuard)
@ServiceScope(SCOPE_CHECKOUT)
@Controller('v1/service-checkout/sessions')
export class ServiceCheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly links: SessionLinksService,
    private readonly merchants: WalletMerchantsService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Open a checkout session for a person, paid on any rail' })
  async create(
    @User() user: RequestUser,
    @Body() dto: ServiceSessionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key?.trim()) throw new BadRequestException('idempotency-key header is required');
    const { metadata } = dto;
    if (metadata && 'commitment' in metadata) {
      throw new BadRequestException('A stake is opened through /v1/commitments');
    }
    const session = await this.checkout.createSession(
      dto.userId,
      {
        priceCode: dto.priceCode,
        mode: CheckoutMode.PAYMENT,
        successUrl: dto.successUrl,
        errorUrl: dto.errorUrl,
        ...(metadata ? { metadata } : {}),
        ...(dto.locale ? { locale: dto.locale } : {}),
      } as any,
      `service:${user.serviceId}:${key.trim()}`,
      undefined,
      user.serviceId,
    );
    return this.links.withX402(session);
  }

  @Get(':id')
  async get(@User() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { price: { include: { product: true } } },
    });
    if (!order || order.price?.product?.serviceId !== user.serviceId) {
      throw new NotFoundException('Checkout session not found');
    }
    return {
      sessionId: order.id,
      status: order.status,
      amount: order.amount.toFixed(2),
      currency: order.currency,
      priceCode: order.price.code,
      userId: order.userId,
    };
  }

  @Post(':id/pay-from-wallet')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async pay(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ServicePayFromWalletDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user.serviceId || !user.serviceCode) throw new ForbiddenException('A service is required');
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
