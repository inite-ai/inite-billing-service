import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Body for POST /v1/admin/services. `code` is the stable identifier external
 * modules authenticate and scope against, so it is constrained to a slug rather
 * than accepting arbitrary text that later shows up in URLs and log lines.
 */
export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9-_]*$/, {
    message: 'code must be lowercase alphanumeric with dashes or underscores',
  })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/** Body for PUT /v1/admin/services/:id — `code` is immutable, so it is absent. */
export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
