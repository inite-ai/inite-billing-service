import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsUserId } from '../common/validators/is-user-id';

export class VerificationDto {
  @IsBoolean() referee!: boolean;
  @IsBoolean() proof!: boolean;
}

export class CreateCommitmentDto {
  /** The person, as INITE Auth names them: the DID from their own sign-in at the product. */
  @IsUserId() userId!: string;
  @IsString() @MaxLength(200) @Matches(/^[\w:.\-]+$/) externalRef!: string;
  @IsString() @MaxLength(100) productCode!: string;
  @IsString() @Matches(/^\d{1,7}(\.\d{1,2})?$/) tier!: string;
  @IsString() @MaxLength(64) charityCode!: string;
  @IsISO8601() endsAt!: string;
  @IsObject() @ValidateNested() @Type(() => VerificationDto) verification!: VerificationDto;
  @IsUrl({ require_tld: false }) successUrl!: string;
  @IsUrl({ require_tld: false }) errorUrl!: string;
  @IsOptional() @IsString() @MaxLength(16) locale?: string;
}

export class ReleaseDto {
  @IsIn(['money', 'credits']) as!: 'money' | 'credits';
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class DisputeDto {
  @IsIn(['user', 'referee']) by!: 'user' | 'referee';
  @IsString() @MaxLength(2000) reason!: string;
}

export class PayFromWalletDto {
  @IsOptional() @IsString() @MaxLength(2000) returnTo?: string;
}

export const OVERRIDE_TARGETS = [
  'held',
  'released_money',
  'released_credits',
  'forfeited',
  'refunded_on_cancel',
] as const;

export class OverrideDto {
  @IsIn(OVERRIDE_TARGETS as unknown as string[]) to!: (typeof OVERRIDE_TARGETS)[number];
  @IsString() @MaxLength(2000) reason!: string;
}

export class CharityDto {
  @IsString() @Matches(/^[a-z0-9-]{2,64}$/) code!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsUrl() url?: string;
  @IsOptional() @IsObject() description?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(2000) payoutMethod?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CharityPayoutDto {
  @IsString() charityCode!: string;
  @IsISO8601() periodTo!: string;
}

export class CharityPayoutSentDto {
  @IsString() @MaxLength(500) reference!: string;
}
