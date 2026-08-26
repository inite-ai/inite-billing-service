import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsNumber,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Billing intervals `calculatePeriodEnd` actually understands. Anything else
 * falls through its `default` branch and silently bills monthly, so an
 * unrecognised interval must be rejected at the edge rather than guessed at
 * renewal time.
 */
export const PRICE_INTERVALS = ['day', 'week', 'month', 'year'] as const;

/**
 * Body for POST /v1/admin/prices and POST /v1/prices (service-scoped).
 *
 * `amount` is money: Decimal(19,4) in the database, so it is bounded and capped
 * at 4 decimal places here. Without validation an inline-typed body accepted
 * negatives, NaN, and unbounded values straight into a Price row.
 *
 * The field list matches what the admin UI sends (PriceForm) exactly — the
 * global ValidationPipe runs `forbidNonWhitelisted`, so an unlisted field is a
 * 400 rather than a silent drop.
 */
export class CreatePriceDto {
  @IsUUID()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code!: string;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(9_999_999_999_999)
  amount!: number;

  @IsOptional()
  @IsIn(PRICE_INTERVALS as unknown as string[])
  interval?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  graceDays?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/** Body for PUT /v1/admin/prices/:id — every field optional, same bounds. */
export class UpdatePriceDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(9_999_999_999_999)
  amount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  graceDays?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
