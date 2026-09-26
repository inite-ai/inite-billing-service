import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PriceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  amount: string;

  @ApiPropertyOptional()
  interval?: string;

  @ApiPropertyOptional()
  trialDays?: number;

  @ApiPropertyOptional()
  graceDays?: number;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({ description: "Present on the storefront, e.g. a credit pack's `credits`" })
  metadata?: Record<string, any>;
}

export class ProductResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  serviceId?: string;

  @ApiProperty()
  moduleScope: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ type: [PriceResponseDto] })
  prices?: PriceResponseDto[];
}

export class StorefrontServiceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: [ProductResponseDto] })
  products: ProductResponseDto[];
}

export class StorefrontResponseDto {
  @ApiProperty({ type: [StorefrontServiceDto] })
  services: StorefrontServiceDto[];
}
