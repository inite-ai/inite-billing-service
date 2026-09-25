import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsObject,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CheckoutMode {
  PAYMENT = 'PAYMENT',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

// NOTE: the canonical rail identity lives in src/common/connectors/rail.ts
// (RAILS). The old narrow `PaymentRail` enum here (ONE/LAVA/CRYPTO only) was
// never imported anywhere and disagreed with the real rails, so it was removed.

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'Price code to purchase' })
  @IsString()
  priceCode: string;

  @ApiProperty({ enum: CheckoutMode, description: 'Payment mode' })
  @IsEnum(CheckoutMode)
  mode: CheckoutMode;

  @ApiPropertyOptional({ description: 'Success redirect URL' })
  @IsUrl()
  @IsOptional()
  successUrl?: string;

  @ApiPropertyOptional({ description: 'Error redirect URL' })
  @IsUrl()
  @IsOptional()
  errorUrl?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Referral code for affiliate tracking' })
  @IsString()
  @IsOptional()
  referralCode?: string;

  @ApiPropertyOptional({ description: 'User ID (required for service-to-service calls)' })
  @IsString()
  @IsOptional()
  userId?: string;
}

export class CheckoutSessionResponseDto {
  @ApiProperty({ description: 'Session ID (order ID)' })
  sessionId: string;

  @ApiProperty({ description: 'Checkout URL to redirect user' })
  checkoutUrl: string;
}

export class PaySessionDto {
  @ApiPropertyOptional({ description: 'Payment rail (provider code)' })
  @IsString()
  @IsOptional()
  rail?: string;

  @ApiPropertyOptional({ description: 'Promo code for discount' })
  @IsString()
  @IsOptional()
  promoCode?: string;

  @ApiPropertyOptional({
    description: 'Crypto rail only: the network to pay on',
    enum: ['TRON', 'TON', 'ETH', 'SOL'],
  })
  @IsIn(['TRON', 'TON', 'ETH', 'SOL'])
  @IsOptional()
  cryptoChain?: string;

  @ApiPropertyOptional({
    description: 'Crypto rail only: the token to pay with',
    enum: ['USDT', 'USDC'],
  })
  @IsIn(['USDT', 'USDC'])
  @IsOptional()
  cryptoToken?: string;
}

export class PaySessionResponseDto {
  @ApiProperty({ description: 'Checkout/redirect URL' })
  checkoutUrl: string;

  @ApiPropertyOptional({ description: 'Payment Intent ID (if payment created)' })
  paymentIntentId?: string;

  @ApiPropertyOptional({
    description:
      'Payment instructions for a rail with no page to redirect to — for crypto: the address, the exact amount, the deadline and progress.',
  })
  payment?: Record<string, any> | null;
}

/**
 * Body for POST /v1/checkout/validate-promo — the pre-checkout check the
 * frontend runs before showing a discount.
 */
export class ValidatePromoCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  promoCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  priceCode!: string;
}
