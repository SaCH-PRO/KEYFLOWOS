import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type ConstitutionVersionStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

const CONSTITUTION_VERSION_STATUSES: ConstitutionVersionStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

export class GenerateConstitutionVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeNotes?: string;

  @IsOptional()
  @IsIn(CONSTITUTION_VERSION_STATUSES)
  status?: ConstitutionVersionStatus;
}
