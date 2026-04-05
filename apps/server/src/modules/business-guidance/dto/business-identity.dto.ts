import { IsOptional, IsString, IsArray } from 'class-validator';

export class BusinessIdentityDto {
  @IsOptional()
  @IsString()
  missionStatement?: string;

  @IsOptional()
  @IsString()
  visionStatement?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coreValues?: string[];

  @IsOptional()
  @IsString()
  targetMarket?: string;

  @IsOptional()
  @IsString()
  uniqueSellingPoint?: string;

  @IsOptional()
  @IsString()
  brandPersonality?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
