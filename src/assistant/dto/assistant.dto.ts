import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Body for POST /v1/assistant/generate-features. */
export class GenerateFeaturesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  creditsPerPeriod?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}

/**
 * Body for POST /v1/assistant/chat. The message is bounded before it becomes
 * model input — an unbounded body is billable tokens.
 */
export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32_000)
  message!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
