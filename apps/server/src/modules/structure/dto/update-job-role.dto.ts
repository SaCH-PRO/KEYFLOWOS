import { IsString, IsOptional, IsInt } from 'class-validator';

export class UpdateJobRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

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
