import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Body for POST /v1/admin/credits/adjust — a manual mint or burn of credits.
 *
 * Credits are integers on CreditBalance, so a fractional amount was silently
 * meaningless before. The bound is symmetric and finite: an operator typo of an
 * extra digit should be a 400, not a ledger entry.
 *
 * `description` is what lands in the CreditUsage ledger row as the operator's
 * justification. The admin UI historically posted it as `reason`, which the
 * handler never read — every manual adjustment recorded `undefined`.
 */
export class AdminAdjustCreditsDto {
  @IsUUID()
  userId!: string;

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
