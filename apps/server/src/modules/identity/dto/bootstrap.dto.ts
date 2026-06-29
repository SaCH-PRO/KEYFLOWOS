import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsPhoneNumber, IsString, IsUrl, MaxLength } from 'class-validator';

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

  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid phone number' })
  @MaxLength(30)
  @Transform(({ value }) => emptyToUndefined(value))
  phone?: string;

  @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
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
