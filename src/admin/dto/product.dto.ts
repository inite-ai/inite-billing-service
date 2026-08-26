import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Product types the schema's ProductType enum accepts. */
export const PRODUCT_TYPES = ['subscription', 'one_time', 'usage'] as const;

export type ProductTypeValue = (typeof PRODUCT_TYPES)[number];

/**
 * Body for POST /v1/admin/products and the service-scoped POST /v1/products.
 * `type` drives which fulfilment path the orchestrator takes, so an unknown
 * value must be rejected at the edge rather than reaching Prisma as an invalid
 * enum at write time.
 */
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  moduleScope!: string;

  @IsIn(PRODUCT_TYPES as unknown as string[])
  type!: ProductTypeValue;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/** Body for PUT /v1/admin/products/:id and the service-scoped update. */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  moduleScope?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * Body for the service-scoped POST /v1/products. The owning service comes from
 * the API key, never the body, and `moduleScope` is optional here (the service
 * catalog defaults it) — so this is deliberately not `CreateProductDto`.
 */
export class CreateServiceProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsIn(PRODUCT_TYPES as unknown as string[])
  type!: ProductTypeValue;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  moduleScope?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * Body for the service-scoped PUT /v1/products/:id. `serviceId` is absent on
 * purpose: ownership is fixed by the calling key, so a service must not be able
 * to reassign a product to another service.
 */
export class UpdateServiceProductDto {
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
