import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OrderStatusFilter {
  created = 'created',
  open = 'open',
  paid = 'paid',
  failed = 'failed',
  refunded = 'refunded',
  expired = 'expired',
}

export class GetOrdersQueryDto {
  @ApiPropertyOptional({ enum: OrderStatusFilter, description: 'Filter by status' })
  @IsEnum(OrderStatusFilter)
  @IsOptional()
  status?: OrderStatusFilter;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  priceId: string;

  @ApiProperty()
  mode: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional()
  externalId?: string;

  @ApiPropertyOptional()
  metadata?: Record<string, any>;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaymentIntentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty()
  rail: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  checkoutUrl?: string;

  @ApiPropertyOptional()
  method?: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional()
  expiresAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
