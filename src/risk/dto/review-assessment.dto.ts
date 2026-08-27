import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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

/** The most assessments one bulk review may carry. */
export const BULK_REVIEW_MAX = 200;

/**
 * Body for POST /v1/admin/risk/bulk-review. Same resolution for every id in
 * the selection — clearing a run of false positives is one decision applied
 * many times, not many decisions.
 */
export class BulkReviewAssessmentDto extends ReviewAssessmentDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_REVIEW_MAX)
  @IsUUID('4', { each: true })
  ids!: string[];
}
