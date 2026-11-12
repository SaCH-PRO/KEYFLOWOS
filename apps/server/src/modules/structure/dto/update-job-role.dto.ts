import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { MAX_APPROVAL_TIER } from '../../../core/authority/module-vocabulary';
import { IsJobRolePermissions } from './create-job-role.dto';

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

  /** The canonical vocabulary, as on create (V1-21-AUTH-JOBROLE-CEILING). */
  @IsOptional()
  @IsJobRolePermissions()
  permissions?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_APPROVAL_TIER)
  defaultApprovalTier?: number;

  @IsOptional()
  @IsString()
  color?: string;
}
