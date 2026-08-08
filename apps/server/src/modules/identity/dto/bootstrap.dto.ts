import { Transform, Type } from 'class-transformer';
import { IsArray, IsEmail, IsObject, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/**
 * A single external identity-provider link, shaped like Supabase's
 * `identities` array entries. We only validate the fields we need for
 * Cross-Account Protection (RISC) mapping; extra fields are ignored.
 */
export class UserIdentityDataDto {
  @IsString()
  @IsOptional()
  identity_id?: string;

  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  provider?: string;

  @IsObject()
  @IsOptional()
  identity_data?: Record<string, unknown>;
}

export class BootstrapDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }) => emptyToUndefined(value))
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => emptyToUndefined(value))
  username?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => emptyToUndefined(value))
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => emptyToUndefined(value))
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => emptyToUndefined(value))
  lastName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  @Transform(({ value }) => emptyToUndefined(value))
  phone?: string;

  @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  @IsOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  avatarUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Transform(({ value }) => emptyToUndefined(value))
  company?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  @Transform(({ value }) => emptyToUndefined(value))
  referralCode?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UserIdentityDataDto)
  identities?: UserIdentityDataDto[];
}
