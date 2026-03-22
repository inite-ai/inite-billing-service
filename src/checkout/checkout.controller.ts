import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { CheckoutService } from './checkout.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  CreateCheckoutSessionDto,
  CheckoutSessionResponseDto,
} from '../common/dto/checkout.dto';

@ApiTags('Checkout')
@Controller('v1/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly promoCodesService: PromoCodesService,
    private readonly catalogService: CatalogService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
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
    return this.checkoutService.createCheckoutSession(
      user.userId,
      dto,
      idempotencyKey,
    );
  }

  @Post('validate-promo')
  @HttpCode(HttpStatus.OK)
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

