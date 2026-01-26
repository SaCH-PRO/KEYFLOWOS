import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateSocialPostDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsArray()
  mediaUrls?: string[];
}
