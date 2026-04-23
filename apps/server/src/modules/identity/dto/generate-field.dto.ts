import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class GenerateFieldDto {
  @IsString()
  @IsIn(['tagline', 'description', 'skills'], { message: 'field must be one of: tagline, description, skills' })
  field!: string;

  @IsObject()
  @IsOptional()
  context?: Record<string, string>;
}
