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
  IsIn,
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
import { IsUserId } from '../common/validators/is-user-id';
import { PrismaService } from '../common/services/prisma.service';
import { CART_MAX_LINES, CART_MAX_QTY, CheckoutService } from '../checkout/checkout.service';
import { CheckoutMode } from '../common/dto/checkout.dto';
import { WalletMerchantsService } from '../wallet/wallet-merchants.service';
import { SCOPE_CHECKOUT, ServiceScope, ServiceTokenGuard } from './service-token.guard';
import { SessionLinksService } from './session-links';
import { SERVICE_BUYER_PATTERN, assertOwnGuestId } from './buyer';

/**
 * A line of the service's catalogue (`priceCode`), or an open line: an item
 * the service prices and names itself through one of its open products
 * (`productCode`, `amount`, `currency`, `title`, `ref`). Billing checks an
 * open line against the product's bounds (src/checkout/open-product.ts).
 */
class CartLineDto {
  @IsOptional() @IsString() @MaxLength(100) priceCode?: string;
  @IsInt() @Min(1) @Max(CART_MAX_QTY) quantity!: number;
  @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  /** A decimal string, e.g. "2.00"; never a float. */
  @IsOptional() @IsString() @MaxLength(20) amount?: string;
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() @MaxLength(100) ref?: string;
}

const OPEN_FIELDS = ['amount', 'currency', 'title', 'ref'] as const;

class ServiceSessionDto {
  @IsString()
  @MaxLength(255)
  @Matches(SERVICE_BUYER_PATTERN, {
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
  /**
   * `SUBSCRIPTION` sells a plan (one `priceCode` of a subscription product):
   * renewed by the rail when it can recur, by billing otherwise. Default
   * `PAYMENT`, as before.
   */
  @IsOptional() @IsIn([CheckoutMode.PAYMENT, CheckoutMode.SUBSCRIPTION]) mode?: CheckoutMode;
}

class ServicePayFromWalletDto {
  @IsUserId() userId!: string;
  @IsOptional() @IsString() @MaxLength(2000) returnTo?: string;
}

/**
 * A purchase or a subscription opened by a service with an INITE Auth service token
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
    assertOwnGuestId(dto.userId, user.serviceCode);
    const mode = dto.mode ?? CheckoutMode.PAYMENT;
    if (mode === CheckoutMode.SUBSCRIPTION && dto.lines) {
      throw new BadRequestException('A subscription is one priceCode, not a cart');
    }
    const open = dto.lines?.some((l) => l.productCode);
    if (dto.lines && open) {
      // One open line is the whole order: its grant is the order's.
      const [line] = dto.lines;
      if (dto.lines.length !== 1 || line.priceCode) {
        throw new BadRequestException('An open line is sold on its own, in an order of one line');
      }
      if (!user.serviceId || !user.serviceCode)
        throw new ForbiddenException('A service is required');
      const session = await this.checkout.createOpenSession(
        dto.userId,
        {
          line: {
            productCode: line.productCode!,
            amount: line.amount!,
            currency: line.currency!,
            title: line.title!,
            ref: line.ref!,
            quantity: line.quantity,
          },
          successUrl: dto.successUrl,
          errorUrl: dto.errorUrl,
          ...(metadata ? { metadata } : {}),
          ...(dto.locale ? { locale: dto.locale } : {}),
        },
        key.trim(),
        {
          serviceId: user.serviceId,
          serviceCode: user.serviceCode,
          clientId: (user as RequestUser & { clientId?: string }).clientId,
        },
      );
      const links = await this.links.withX402(session);
      return {
        ...links,
        amount: session.amount,
        currency: session.currency,
        rails: session.rails,
        ...(session.entitlementKey ? { entitlementKey: session.entitlementKey } : {}),
      };
    }
    if (dto.lines?.some((l) => !l.priceCode || OPEN_FIELDS.some((f) => l[f] !== undefined))) {
      // An amount is never the caller's to name on a catalogue line.
      throw new BadRequestException('A catalogue line names a priceCode and a quantity only');
    }
    if (dto.lines) {
      const cart = await this.checkout.createCartSession(
        dto.userId,
        {
          lines: dto.lines.map((l) => ({ priceCode: l.priceCode!, quantity: l.quantity })),
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
        mode,
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
    const open = (order.metadata as Record<string, any> | null)?.open;
    return {
      sessionId: order.id,
      status: order.status,
      amount: order.amount.toFixed(2),
      currency: order.currency,
      priceCode: order.price.code,
      userId: order.userId,
      // An open line: what the service asked to sell, as billing kept it.
      ...(open
        ? {
            productCode: open.productCode,
            title: open.title,
            ref: open.ref,
            quantity: open.quantity,
            ...(open.entitlementKey ? { entitlementKey: open.entitlementKey } : {}),
          }
        : {}),
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
