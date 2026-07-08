import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(256)
  password!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  username?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  company?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  referralCode?: string;
}

export class ResendVerificationDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;
}
