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
}
