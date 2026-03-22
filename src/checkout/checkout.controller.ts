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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { CheckoutService } from './checkout.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { CatalogService } from '../catalog/catalog.service';
import { PrismaService } from '../common/services/prisma.service';
import {
  CreateCheckoutSessionDto,
  CheckoutSessionResponseDto,
  PaySessionDto,
  PaySessionResponseDto,
} from '../common/dto/checkout.dto';

@ApiTags('Checkout')
@Controller('v1/checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly promoCodesService: PromoCodesService,
    private readonly catalogService: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('payment-methods')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active payment providers for checkout' })
  async getPaymentMethods() {
    const providers = await this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        supportedModes: true,
        currencies: true,
      },
    });
    return providers;
  }

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Create checkout session' })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: 'Idempotency key for request deduplication',
  })
  @ApiResponse({ status: 201, type: CheckoutSessionResponseDto })
  async createCheckoutSession(
    @User() user: RequestUser,
    @Body() dto: CreateCheckoutSessionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CheckoutSessionResponseDto> {
    return this.checkoutService.createSession(
      user.userId,
      dto,
      idempotencyKey,
    );
  }

  @Get('sessions/:id')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Get checkout session details' })
  async getCheckoutSession(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    // If service API key, no user ownership check
    const userId = req.user?.isService ? undefined : req.user?.userId;
    return this.checkoutService.getSession(id, userId);
  }

  @Post('sessions/:id/pay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Initiate payment for a checkout session' })
  @ApiResponse({ status: 200, type: PaySessionResponseDto })
  async paySession(
    @Param('id') id: string,
    @User() user: RequestUser,
    @Body() dto: PaySessionDto,
  ): Promise<PaySessionResponseDto> {
    return this.checkoutService.paySession(id, user.userId, dto);
  }

  @Post('validate-promo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Validate a promo code before checkout' })
  async validatePromoCode(
    @User() user: RequestUser,
    @Body() body: { promoCode: string; priceCode: string },
  ) {
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
