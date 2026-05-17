import {
  IsString,
  IsOptional,
  IsISO8601,
  IsArray,
} from 'class-validator';

export class UpdateCallLogDto {
  @IsString()
  @IsOptional()
  contactId?: string;

  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;

  @IsString()
  @IsOptional()
  script?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  evidenceIds?: string[];
}
