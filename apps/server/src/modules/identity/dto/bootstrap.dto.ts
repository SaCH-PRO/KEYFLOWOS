import { IsEmail, IsOptional, IsPhoneNumber, IsString, IsUrl, MaxLength } from 'class-validator';

export class BootstrapDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  username?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid phone number' })
  @MaxLength(30)
  phone?: string;

  @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  avatarUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  company?: string;
}
