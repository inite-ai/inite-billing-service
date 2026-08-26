import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /v1/admin/risk/:id/review. `refund` moves money, so the
 * resolution it rides on is constrained to the two values the handler acts on
 * (it used to re-check this by hand after the body was already trusted).
 */
export class ReviewAssessmentDto {
  @IsIn(['ok', 'fraud'])
  resolution!: 'ok' | 'fraud';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  refund?: boolean;
}
