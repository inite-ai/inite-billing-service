import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ChangePlanDto {
  @ApiProperty({ description: 'The price of the plan to move to, of the same service' })
  @IsString()
  @MaxLength(100)
  priceCode!: string;

  @ApiPropertyOptional({ description: 'Where the upgrade payment returns on success' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  successUrl?: string;

  @ApiPropertyOptional({ description: 'Where the upgrade payment returns on failure' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  errorUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
