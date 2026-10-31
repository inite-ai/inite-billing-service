import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  priceId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  currentPeriodStart: Date;

  @ApiProperty()
  currentPeriodEnd: Date;

  @ApiProperty()
  cancelAtPeriodEnd: boolean;

  @ApiPropertyOptional()
  providerSubscriptionId?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'The price a scheduled plan change moves to at period end' })
  pendingPriceCode?: string | null;

  @ApiPropertyOptional()
  pendingProductName?: string | null;

  @ApiPropertyOptional({ description: 'Renewed by a pay link billing sends (PIX, crypto, wallet)' })
  renewsByLink?: boolean;
}
