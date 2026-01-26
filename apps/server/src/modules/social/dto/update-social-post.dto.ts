import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSocialPostDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  mediaUrls?: string[];

  @IsOptional()
  @IsIn(['DRAFT', 'SCHEDULED', 'POSTED', 'FAILED'])
  status?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}
