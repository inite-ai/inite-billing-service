import { IsUserId } from '../../common/validators/is-user-id';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
