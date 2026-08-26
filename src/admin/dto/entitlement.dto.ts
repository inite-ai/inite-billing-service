import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Body for POST /v1/admin/entitlements — a manual access grant, so the target
 * user and the key being granted are both constrained. `value` stays free-form:
 * entitlement payloads are module-defined.
 */
export class CreateEntitlementDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  key!: string;

  @IsOptional()
  value?: any;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/** Body for PUT /v1/admin/entitlements/:id. */
export class UpdateEntitlementDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  key?: string;

  @IsOptional()
  value?: any;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
