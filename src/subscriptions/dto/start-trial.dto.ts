import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
  @IsUUID()
  userId?: string;
}
