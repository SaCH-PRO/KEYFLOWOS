import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateAssignmentDto {
  @IsString()
  membershipId!: string;

  @IsString()
  userId!: string;

  @IsString()
  orgUnitId!: string;

  @IsOptional()
  @IsString()
  jobRoleId?: string;

  @IsOptional()
  @IsString()
  reportsToId?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
