import { IsBoolean, IsArray, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class QualificationQuestionDto {
  @IsString()
  @MaxLength(200)
  id!: string;

  @IsString()
  @MaxLength(500)
  text!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

class QualificationPackageDto {
  @IsString()
  @MaxLength(100)
  id!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  executionModel?: string;
}

export class UpdateQualificationConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QualificationQuestionDto)
  questions?: QualificationQuestionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QualificationPackageDto)
  packages?: QualificationPackageDto[];

  @IsOptional()
  @IsObject()
  scoring?: Record<string, unknown>;
}
