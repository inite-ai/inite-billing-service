import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body for POST /v1/credits/consume — the debit path every product module
 * calls. Credits are integers, so a fractional or absurd `amount`/`units` is
 * rejected rather than silently mangled by the ledger.
 *
 * `userId` and `serviceId` are still overridden from the authenticated caller
 * in the controller (a service key may only act in its own scope); validating
 * them here only rejects malformed input earlier.
 */
export class ConsumeCreditsDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  featureCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  units?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  modelTier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * Body for POST /v1/credits/adjust (service accounts only). Signed: negative
 * burns, positive mints — bounded on both sides so an extra digit is a 400
 * rather than a ledger entry.
 */
export class AdjustCreditsDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
