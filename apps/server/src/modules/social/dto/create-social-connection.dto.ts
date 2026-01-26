import { IsOptional, IsString } from 'class-validator';

export class CreateSocialConnectionDto {
  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  platformId?: string;

  @IsString()
  token!: string;
}
