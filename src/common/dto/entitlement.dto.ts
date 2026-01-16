import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EntitlementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  value?: Record<string, any>;

  @ApiProperty()
  source: string;

  @ApiPropertyOptional()
  startsAt?: Date;

  @ApiPropertyOptional()
  expiresAt?: Date;

  @ApiProperty()
  createdAt: Date;
}

