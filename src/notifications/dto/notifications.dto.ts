import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { NOTIFICATION_CATEGORIES } from '../notifications.service';

const PREFERENCE_CATEGORIES = [...NOTIFICATION_CATEGORIES, 'all'];

export class MarkReadDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class SetPreferenceDto {
  @IsString()
  @IsIn(PREFERENCE_CATEGORIES)
  category: string;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;
}

export class UnsubscribeDto {
  @IsString()
  token: string;

  @IsOptional()
  @IsString()
  @IsIn(PREFERENCE_CATEGORIES)
  category?: string;
}
