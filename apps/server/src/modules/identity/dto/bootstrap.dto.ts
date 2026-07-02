import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
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
}
