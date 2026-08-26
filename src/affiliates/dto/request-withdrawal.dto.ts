import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Body for POST /v1/affiliates/me/withdraw. Omitting `amount` withdraws the
 * whole available balance; when given it is money, so it is bounded and capped
 * to the Decimal(19,4) precision the ledger stores.
 */
export class RequestWithdrawalDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
