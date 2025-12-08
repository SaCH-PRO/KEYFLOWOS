import { IsEmail, IsOptional, IsString } from 'class-validator';

export class BootstrapDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  name?: string;
}
