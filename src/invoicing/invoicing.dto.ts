import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SERVICE_BUYER_PATTERN } from '../service-api/buyer';

export const MANUAL_METHODS = ['pix', 'bank_transfer', 'cash', 'other'] as const;

export class CreateInvoiceDto {
  @ApiProperty({ description: "One of this service's open products (docs/open-product.md)" })
  @IsString()
  @MaxLength(100)
  productCode: string;

  @ApiProperty({
    description: "Who pays: a DID, org:<uuid>, or this service's guest id <service>:<id>",
  })
  @IsString()
  @MaxLength(255)
  @Matches(SERVICE_BUYER_PATTERN, {
    message: "userId must be a DID, a UUID, org:<uuid> or this service's guest id",
  })
  userId: string;

  @ApiProperty({ description: 'Decimal string, within the product bounds', example: '4500.00' })
  @IsString()
  @MaxLength(20)
  amount: string;

  @ApiProperty({ example: 'BRL' })
  @IsString()
  @MaxLength(10)
  currency: string;

  @ApiProperty({ description: 'What it is for, shown to the payer' })
  @IsString()
  @MaxLength(120)
  description: string;

  @ApiProperty({ description: "The service's own reference for the line (a deal, a month)" })
  @IsString()
  @MaxLength(100)
  ref: string;

  @ApiPropertyOptional({ description: 'When it is due (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @ApiPropertyOptional({ description: 'Carried on the order (dealId, month, ...)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  successUrl: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  errorUrl?: string;

  @ApiPropertyOptional({ example: 'pt' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}

export class MarkInvoicePaidDto {
  @ApiProperty({ enum: MANUAL_METHODS })
  @IsIn(MANUAL_METHODS as unknown as string[])
  method: (typeof MANUAL_METHODS)[number];

  @ApiPropertyOptional({ description: 'The bank or PIX reference (E2E id)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional({ description: 'When the money arrived (ISO 8601); now when absent' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;
}
