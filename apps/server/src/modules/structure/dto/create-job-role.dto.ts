import { IsString, IsOptional, IsInt, IsJSON } from 'class-validator';

export class CreateJobRoleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  level?: number;

  @IsOptional()
  permissions?: Record<string, string>;

  @IsOptional()
  @IsInt()
  defaultApprovalTier?: number;

  @IsOptional()
  @IsString()
  color?: string;
}
