import { IsString, IsOptional, MaxLength, IsArray } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(10000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
