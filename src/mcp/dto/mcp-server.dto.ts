import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterMcpServerDto {
  @ApiProperty({ description: 'Path segment agents will call: /mcp/s/<slug>', example: 'weather' })
  @IsString()
  @MaxLength(64)
  slug: string;

  @ApiProperty({ example: 'Weather tools' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Where your own MCP server lives. Must be publicly reachable over http(s).',
    example: 'https://tools.example.com/mcp',
  })
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  upstreamUrl: string;

  @ApiPropertyOptional({
    description:
      'Headers sent to your server, for your own auth. Written, never returned; send null for a key to remove it.',
  })
  @IsOptional()
  @IsObject()
  upstreamHeaders?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['free', 'per_call', 'entitlement'], default: 'per_call' })
  @IsOptional()
  @IsIn(['free', 'per_call', 'entitlement'])
  pricingMode?: 'free' | 'per_call' | 'entitlement';

  @ApiPropertyOptional({ description: 'Flat credits per billable call.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditsPerCall?: number;

  @ApiPropertyOptional({
    description: 'Charge through an existing metered feature instead, bringing its quotas along.',
  })
  @IsOptional()
  @IsString()
  featureCode?: string;

  @ApiPropertyOptional({ description: 'Entitlement the caller must hold, for entitlement pricing.' })
  @IsOptional()
  @IsString()
  requiredEntitlement?: string;

  @ApiPropertyOptional({
    description: 'Price to offer when a caller cannot pay. The refusal carries a checkout URL.',
  })
  @IsOptional()
  @IsString()
  priceCode?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateMcpServerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  upstreamUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  upstreamHeaders?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['free', 'per_call', 'entitlement'] })
  @IsOptional()
  @IsIn(['free', 'per_call', 'entitlement'])
  pricingMode?: 'free' | 'per_call' | 'entitlement';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  creditsPerCall?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  featureCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requiredEntitlement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
