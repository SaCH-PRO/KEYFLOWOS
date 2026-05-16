import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateAssignmentDto {
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @IsString()
  jobRoleId?: string;

  @IsOptional()
  @IsString()
  reportsToId?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  endedAt?: string;
}
