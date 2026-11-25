import { IsUserId } from '../../common/validators/is-user-id';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /v1/subscriptions/trial. `userId` is honoured only for service
 * callers (the controller derives it from the JWT otherwise).
 */
export class StartTrialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  priceCode!: string;

  @IsOptional()
  @IsUserId()
  userId?: string;

  @ApiPropertyOptional({
    description:
      "As on a checkout: `company_id` names the calling service's own account the trial is for; it is kept on the subscription and sent with its credit events.",
    example: { company_id: 'c_123' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
