import { IsOptional, IsInt, IsString, IsArray, Min } from 'class-validator';

export class FounderContextDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  yearsExperience?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  technicalSkills?: string[];

  @IsOptional()
  @IsString()
  leadershipStyle?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  previousExits?: number;

  @IsOptional()
  @IsString()
  educationLevel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  motivations?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  weeklyHoursAvailable?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coFounders?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
