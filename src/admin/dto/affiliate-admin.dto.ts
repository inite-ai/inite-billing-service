import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Affiliate lifecycle states the service understands. */
export const AFFILIATE_STATUSES = ['pending', 'active', 'suspended', 'terminated'] as const;

/**
 * Body for PUT /v1/admin/affiliates/:id. `commissionRate` is a fraction in
 * [0, 1] stored as Decimal — the same bound `CreateReferralLevelDto` enforces.
 * Unvalidated, a rate of 15 (a percentage typed as a number) would pay 1500%
 * of every order.
 */
export class UpdateAffiliateDto {
  @IsOptional()
  @IsIn(AFFILIATE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  commissionRate?: number;
}

/** Body for POST /v1/admin/referral-templates/apply. */
export class ApplyReferralTemplateDto {
  @IsUUID()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  templateKey!: string;
}

/** Body for POST /v1/admin/payouts/:id/fail. */
export class FailPayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** The most rows one bulk request may carry — a screenful of a payout run. */
export const BULK_PAYOUT_MAX = 200;

/**
 * Body for POST /v1/admin/payouts/bulk.
 *
 * The ids are validated as UUIDs up front so a malformed selection is rejected
 * whole, before any money moves: a bulk request that processed nineteen
 * payouts and then failed on a typo would leave the operator reconstructing
 * which nineteen.
 */
export class BulkPayoutDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_PAYOUT_MAX)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsIn(['process', 'fail'])
  action!: 'process' | 'fail';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
