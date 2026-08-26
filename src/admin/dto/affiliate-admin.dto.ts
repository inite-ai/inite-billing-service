import { Type } from 'class-transformer';
import {
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
