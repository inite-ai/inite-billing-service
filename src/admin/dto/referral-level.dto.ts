import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body for POST /v1/admin/referral-levels. commissionRate is a fraction in
 * [0, 1] (the service also enforces this) stored as Decimal(5,4); level is a
 * positive integer. Validating here rejects negative/huge/fractional-overflow
 * inputs and strips mass-assignment before they reach the service. Numerics use
 * `@Type(() => Number)` so string-form inputs coerce.
 */
export class CreateReferralLevelDto {
  @IsUUID()
  serviceId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  level!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  commissionRate!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

/** Body for PUT /v1/admin/referral-levels/:id — all fields optional. */
export class UpdateReferralLevelDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  commissionRate?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
