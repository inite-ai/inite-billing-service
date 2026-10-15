import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { CheckoutService } from './checkout.service';
import { X402Service } from './x402.service';
import { CheckoutLinkOrJwtGuard, CheckoutLinkOrJwtOrServiceGuard } from './checkout-link.guard';
import { CHECKOUT_LINK_HEADER } from './checkout-link';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  CheckoutSessionResponseDto,
  CreateCheckoutSessionDto,
  PaySessionDto,
  PaySessionResponseDto,
  ValidatePromoCodeDto,
} from '../common/dto/checkout.dto';

@ApiTags('Checkout')
@Controller('v1/checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly promoCodesService: PromoCodesService,
    private readonly catalogService: CatalogService,
    private readonly x402: X402Service,
  ) {}

  @Get('payment-methods')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active payment providers for checkout' })
  async getPaymentMethods() {
    return this.checkoutService.getPaymentMethods();
  }

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Create checkout session' })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: 'Idempotency key for request deduplication',
  })
  @ApiResponse({ status: 201, type: CheckoutSessionResponseDto })
  async createCheckoutSession(
    @Req() req: any,
    @Body() dto: CreateCheckoutSessionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CheckoutSessionResponseDto> {
    // Service callers pass userId in body; JWT users always use their own token
    const userId = req.user?.isService ? dto.userId : req.user?.userId;
    if (!userId) {
      throw new BadRequestException('userId is required (pass in body for service API key calls)');
    }
    // Strip userId from dto so it never leaks into metadata or downstream logic
    delete dto.userId;
    const session = await this.checkoutService.createSession(
      userId,
      dto,
      idempotencyKey,
      req.ip,
      req.user?.isService ? req.user.serviceId : undefined,
    );
    // Where an agent with a wallet can pay it itself, over x402.
    const token = /#t=([^&]+)/.exec(session.checkoutUrl)?.[1];
    if (token && (await this.x402.available().catch(() => false))) {
      return {
        ...session,
        x402Url: this.x402.urlFor(session.sessionId, decodeURIComponent(token)),
      };
    }
    return session;
  }

  @Get('sessions/:id')
  @UseGuards(CheckoutLinkOrJwtOrServiceGuard)
  @ApiOperation({ summary: 'Get checkout session details' })
  @ApiHeader({
    name: CHECKOUT_LINK_HEADER,
    required: false,
    description: 'Token from the checkout link',
  })
  async getCheckoutSession(@Param('id') id: string, @Req() req: any) {
    // The checkout link opens its own order, signed in or not.
    if (req.checkoutLinkToken) {
      return this.checkoutService.getSession(id, undefined, undefined, req.checkoutLinkToken);
    }
    // A user sees their own session; a service sees its own service's sessions.
    // "No check at all for service keys" made every checkout in the platform
    // readable by any registered module.
    const isService = !!req.user?.isService;
    return this.checkoutService.getSession(
      id,
      isService ? undefined : req.user?.userId,
      isService ? req.user.serviceId : undefined,
    );
  }

  @Post('sessions/:id/pay')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(CheckoutLinkOrJwtGuard)
  @ApiOperation({ summary: 'Initiate payment for a checkout session' })
  @ApiHeader({
    name: CHECKOUT_LINK_HEADER,
    required: false,
    description: 'Token from the checkout link',
  })
  @ApiResponse({ status: 200, type: PaySessionResponseDto })
  async paySession(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: PaySessionDto,
  ): Promise<PaySessionResponseDto> {
    if (req.checkoutLinkToken) {
      return this.checkoutService.paySession(id, undefined, dto, undefined, req.checkoutLinkToken);
    }
    return this.checkoutService.paySession(id, req.user.userId, dto, req.user.email);
  }

  @Post('sessions/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(CheckoutLinkOrJwtGuard)
  @ApiOperation({
    summary: 'Check the session’s payment with its provider now, and return the session',
  })
  @ApiHeader({
    name: CHECKOUT_LINK_HEADER,
    required: false,
    description: 'Token from the checkout link',
  })
  async refreshPayment(@Param('id') id: string, @Req() req: any) {
    if (req.checkoutLinkToken) {
      return this.checkoutService.refreshPayment(id, undefined, req.checkoutLinkToken);
    }
    return this.checkoutService.refreshPayment(id, req.user.userId);
  }

  @Post('sessions/:id/validate-promo')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseGuards(CheckoutLinkOrJwtGuard)
  @ApiOperation({ summary: 'Validate a promo code against this session’s price' })
  @ApiHeader({
    name: CHECKOUT_LINK_HEADER,
    required: false,
    description: 'Token from the checkout link',
  })
  async validateSessionPromo(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { promoCode?: string },
  ) {
    const code = typeof body?.promoCode === 'string' ? body.promoCode.trim() : '';
    if (!code) throw new BadRequestException('promoCode is required');
    const result = await this.checkoutService.validateSessionPromo(
      id,
      code,
      req.checkoutLinkToken ? undefined : req.user?.userId,
      req.checkoutLinkToken,
    );
    return {
      isValid: result.isValid,
      error: result.error,
      errorCode: result.errorCode,
      originalAmount: result.originalAmount,
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
      promoCodeName: result.promoCode?.name,
    };
  }

  @Post('validate-promo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Validate a promo code before checkout' })
  async validatePromoCode(@User() user: RequestUser, @Body() body: ValidatePromoCodeDto) {
    const price = await this.catalogService.getPriceByCode(body.priceCode);
    const result = await this.promoCodesService.validatePromoCode(
      body.promoCode,
      price.id,
      user.userId,
    );

    return {
      isValid: result.isValid,
      error: result.error,
      originalAmount: result.originalAmount,
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
      promoCodeName: result.promoCode?.name,
    };
  }
}
