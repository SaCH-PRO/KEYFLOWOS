import { IsString, IsOptional, IsInt, Min, Max, ValidateBy, type ValidationOptions } from 'class-validator';
import {
  ACCESS_LEVELS,
  CRM_SUBPERMISSION_VALUES,
  MAX_APPROVAL_TIER,
  isCanonicalModule,
  isCrmSubPermission,
} from '../../../core/authority/module-vocabulary';

/**
 * Why `value` is not a JobRole permissions map in the canonical vocabulary, or null when
 * it is (V1-21-AUTH-JOBROLE-CEILING, CF-27).
 *
 * An assignment copies these permissions onto the holder's Membership.permissionScopes,
 * which ModuleScopeGuard reads INSTEAD of the role defaults, so the map is held to the
 * vocabulary that column is validated against on the identity routes
 * (IdentityService.validateScopesPayload): a canonical module with an access level, or a
 * CRM ownership sub-permission with one of its values. A KEY tool-family key (finance,
 * sales, hr, ...) is refused: copied onto a membership it grants no module and denies
 * every canonical one, the inventory's `scope_map_uses_non_canonical_keys`.
 */
export function jobRolePermissionsProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'permissions must be a map of module to access level';
  }
  for (const [key, level] of Object.entries(value as Record<string, unknown>)) {
    if (isCanonicalModule(key)) {
      if (typeof level !== 'string' || !(ACCESS_LEVELS as readonly string[]).includes(level)) {
        return `Invalid permission level: ${String(level)} for module ${key}`;
      }
    } else if (isCrmSubPermission(key)) {
      if (typeof level !== 'string' || !CRM_SUBPERMISSION_VALUES[key].has(level)) {
        return `Invalid value '${String(level)}' for ${key}`;
      }
    } else {
      return `Invalid module: ${key}`;
    }
  }
  return null;
}

/** The DTO face of jobRolePermissionsProblem, for the global ValidationPipe. */
export function IsJobRolePermissions(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isJobRolePermissions',
      validator: {
        validate: (value: unknown) => jobRolePermissionsProblem(value) === null,
        defaultMessage: (args) => jobRolePermissionsProblem(args?.value) ?? 'permissions are invalid',
      },
    },
    options,
  );
}

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
