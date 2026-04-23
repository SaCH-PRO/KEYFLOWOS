import { IsOptional, IsPhoneNumber, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateUserDto {
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
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid phone number' })
  @MaxLength(30)
  phone?: string;

  @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  @IsOptional()
  @MaxLength(2048)
  avatarUrl?: string;
}

export class UpdatePasswordDto {
  @IsString()
  @MaxLength(256)
  newPassword!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  authTokenOverride?: string;
}
