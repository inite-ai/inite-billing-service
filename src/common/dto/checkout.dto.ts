import { IsEnum, IsOptional, IsString, IsObject, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CheckoutMode {
  PAYMENT = 'PAYMENT',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

export enum PaymentRail {
  ONE = 'ONE',
  LAVA = 'LAVA',
  CRYPTO = 'CRYPTO',
}

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
}

export class PaySessionResponseDto {
  @ApiProperty({ description: 'Checkout/redirect URL' })
  checkoutUrl: string;

  @ApiPropertyOptional({ description: 'Payment Intent ID (if payment created)' })
  paymentIntentId?: string;
}
