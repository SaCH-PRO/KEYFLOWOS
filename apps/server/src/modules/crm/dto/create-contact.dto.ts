import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsIn(['LEAD', 'PROSPECT', 'CLIENT', 'LOST'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsOptional()
  tags?: string[];

  @IsOptional()
  custom?: Record<string, any>;
}
