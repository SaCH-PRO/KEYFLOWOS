import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { BusinessStage } from './update-business.dto';

export class GenerateProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  industry?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skills?: string[];

  @IsEnum(BusinessStage, { message: `businessStage must be one of: ${Object.values(BusinessStage).join(', ')}` })
  @IsOptional()
  businessStage?: BusinessStage;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;
}
