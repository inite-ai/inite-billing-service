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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { IsUserId, USER_ID_PATTERN } from '../common/validators/is-user-id';
import { PrismaService } from '../common/services/prisma.service';
import { CART_MAX_LINES, CART_MAX_QTY, CheckoutService } from '../checkout/checkout.service';
import { CheckoutMode } from '../common/dto/checkout.dto';
import { WalletMerchantsService } from '../wallet/wallet-merchants.service';
import { SCOPE_CHECKOUT, ServiceScope, ServiceTokenGuard } from './service-token.guard';
import { SessionLinksService } from './session-links';

class CartLineDto {
  @IsString() @MaxLength(100) priceCode!: string;
  @IsInt() @Min(1) @Max(CART_MAX_QTY) quantity!: number;
}

/** A person's DID (or legacy UUID), or the calling service's own guest id. */
const BUYER_PATTERN = /^(?:[a-z0-9][a-z0-9_-]{0,99}:[A-Za-z0-9_-]{8,128})$/;

class ServiceSessionDto {
  @IsString()
  @MaxLength(255)
  @Matches(new RegExp(`${USER_ID_PATTERN.source}|${BUYER_PATTERN.source}`), {
    message: "userId must be a DID, a UUID or this service's guest id",
  })
  userId!: string;
  /** One price, bought once. Either this or `lines`. */
  @IsOptional() @IsString() @MaxLength(100) priceCode?: string;
  /** A cart: the service's own prices, each with a quantity. Either this or `priceCode`. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CART_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines?: CartLineDto[];
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
      throw new BadRequestException('A stake is not an ordinary checkout');
    }
    if (!!dto.priceCode === !!dto.lines) {
      throw new BadRequestException('Send either priceCode or lines');
    }
    // A guest id is namespaced by the service that made it up, never another's.
    if (!dto.userId.startsWith('did:') && dto.userId.includes(':')) {
      if (!user.serviceCode || !dto.userId.startsWith(`${user.serviceCode}:`)) {
        throw new BadRequestException(`A guest id is ${user.serviceCode}:<id>`);
      }
    }
    if (dto.lines) {
      const cart = await this.checkout.createCartSession(
        dto.userId,
        {
          lines: dto.lines.map((l) => ({ priceCode: l.priceCode, quantity: l.quantity })),
          successUrl: dto.successUrl,
          errorUrl: dto.errorUrl,
          ...(metadata ? { metadata } : {}),
          ...(dto.locale ? { locale: dto.locale } : {}),
        },
        `service:${user.serviceId}:${key.trim()}`,
        user.serviceId!,
      );
      const links = await this.links.withX402(cart);
      return { ...links, amount: cart.amount, currency: cart.currency };
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
