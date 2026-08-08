import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  IsDateString,
} from 'class-validator';

/**
 * Body for POST /v1/admin/promo-codes. Previously an inline TS interface, so the
 * global ValidationPipe skipped it (metatype Object) — negative/huge/fractional
 * values and mass-assignment got through. Numeric fields use `@Type(() => Number)`
 * so string-form inputs are coerced before validation (the admin UI sends some
 * numbers as strings). Range rules (percentage ≤ 100, etc.) stay in the service.
 */
export class CreatePromoCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(['percentage', 'fixed_amount'])
  discountType!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  discountValue!: number;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minPurchaseAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxDiscountAmount?: number;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsageCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsagePerUser?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
