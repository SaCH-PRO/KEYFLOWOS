/**
 * The one canonical human-module vocabulary.
 *
 * WHY THIS FILE EXISTS
 *
 * Before KF-EXEC-AUTH-001 the same `Membership.permissionScopes` column was written
 * in one vocabulary and enforced in another:
 *
 *   ModuleScopeGuard.DEFAULT_SCOPES   13 keys — the ENFORCER
 *   IdentityService.PERMISSION_MODULES 11 keys — the WRITER and VALIDATOR
 *
 * The writer's list was missing `operations` and `analytics`. `inviteTeamMember`
 * always writes an explicit scope map, and the guard reads an explicit map INSTEAD
 * of its own defaults (`scopes[module] || 'none'`), so those two keys evaluated to
 * 'none' for everyone invited — including an invited ADMIN. That is 58 `operations`
 * routes and 14 `analytics` routes refused. `validateScopesPayload` rejected both
 * names as `Invalid module`, so it could not be repaired through the API either.
 * A founding owner was unaffected only because the TENANT-001 constructor writes no
 * scope map at all, so their membership fell through to the enforcer's 13 keys.
 *
 * `connect` was in NEITHER list while seven integration-hub routes require it, so it
 * was unreachable for every principal except SUPER_ADMIN.
 *
 * CG-REVIEW-AUTH-PRECEDENCE-001 resolved this: one canonical KEY UNIVERSE, being the
 * enforcer's existing 13 plus `connect`. Role defaults are the enforcer's existing
 * ones — converging the writers on semantics the guard already declared, rather than
 * minting a new role policy. `connect` defaults to NONE for every role and becomes
 * reachable only through an explicit validated scope grant.
 *
 * WHAT THIS IS NOT
 *
 * It is a key universe, not an authority union. `JobRolePolicyService`'s
 * MODULE_TOOL_FAMILIES is a SEPARATE namespace for KEY tool families (finance, sales,
 * hr, legal, ...) and is deliberately not aliased onto these keys. A JobRole
 * permission reaches human module authority only on an exact match with a key below,
 * and even then it is capped by the Membership envelope.
 */

/**
 * Every module key the human authority system recognises.
 *
 * Order is the enforcer's historical order, with `connect` appended. Anything not in
 * this list is not a module key: `validateScopesPayload` rejects it on write and the
 * resolver records it as provenance-only rather than letting it grant anything.
 */
export const CANONICAL_MODULES = [
  'crm',
  'revenue',
  'bookings',
  'projects',
  'content',
  'expenses',
  'automations',
  'storefront',
  'settings',
  'ai',
  'team',
  'analytics',
  'operations',
  'connect',
] as const;

export type CanonicalModule = (typeof CANONICAL_MODULES)[number];

const CANONICAL_MODULE_SET: ReadonlySet<string> = new Set(CANONICAL_MODULES);

export function isCanonicalModule(key: string): key is CanonicalModule {
  return CANONICAL_MODULE_SET.has(key);
}

/** Access levels, weakest first. `none` is a level, not an absence — see below. */
export const ACCESS_LEVELS = ['none', 'read', 'write', 'admin'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const LEVEL_RANK: Readonly<Record<AccessLevel, number>> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);
}

/** Rank of an arbitrary stored value; anything unrecognised ranks as `none`. */
export function rankOf(level: string | undefined | null): number {
  return isAccessLevel(level) ? LEVEL_RANK[level] : 0;
}

export function strongest(a: AccessLevel, b: AccessLevel): AccessLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export function weakest(a: AccessLevel, b: AccessLevel): AccessLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/**
 * Roles that have a default scope map. `role` is a free-text String column, so
 * anything outside this set falls back to STAFF — the same fallback both the guard
 * and IdentityService already used.
 */
export const DEFAULT_ROLE = 'STAFF';

/**
 * `connect` is NONE for every role by deliberate decision, not by omission. It is
 * listed explicitly so that a future reader sees a policy rather than a gap, and so
 * that `Object.keys(ROLE_DEFAULT_SCOPES.OWNER)` covers the whole canonical universe.
 */
const CONNECT_DEFAULT: AccessLevel = 'none';

/** STAFF has never had access to these three; preserved verbatim from the enforcer. */
const STAFF_DENIED = ['settings', 'team', 'ai'] as const;

function buildDefaults(level: (module: CanonicalModule) => AccessLevel): Record<CanonicalModule, AccessLevel> {
  return Object.fromEntries(
    CANONICAL_MODULES.map((m) => [m, m === 'connect' ? CONNECT_DEFAULT : level(m)]),
  ) as Record<CanonicalModule, AccessLevel>;
}

/**
 * Role defaults, byte-identical to ModuleScopeGuard's pre-AUTH-001 table for its 13
 * keys. These apply ONLY when a Membership has no explicit scope map. Inside an
 * explicit map a missing key is NOT role-defaulted — see EXPLICIT_MAP_MISSING_KEY.
 */
export const ROLE_DEFAULT_SCOPES: Readonly<Record<string, Record<CanonicalModule, AccessLevel>>> = {
  OWNER: buildDefaults(() => 'admin'),
  ADMIN: buildDefaults((m) => (m === 'team' ? 'write' : 'admin')),
  STAFF: buildDefaults((m) => ((STAFF_DENIED as readonly string[]).includes(m) ? 'none' : 'read')),
};

export function defaultScopesForRole(role: string): Record<CanonicalModule, AccessLevel> {
  return ROLE_DEFAULT_SCOPES[role] ?? ROLE_DEFAULT_SCOPES[DEFAULT_ROLE];
}

/**
 * What a key that is absent from an EXPLICIT scope map means.
 *
 * `none`, and deliberately so. The live guard computes `scopes[module] || 'none'`, so
 * role-defaulting a missing key inside an explicit map would WIDEN authority relative
 * to the deployed behaviour for every member who already has one. CG-REVIEW-AUTH-
 * PRECEDENCE-001 holds this at legacy behaviour for AUTH-001; the resolver records it
 * as `denied_by_absence` provenance so the distinction from an explicit `none` — which
 * is an explicit deny — survives into the trace rather than being flattened away.
 */
export const EXPLICIT_MAP_MISSING_KEY: AccessLevel = 'none';

/**
 * Approval tiers by role. Unchanged, and deliberately separate from module levels:
 * approval tier and execution permission are distinct outputs and must not be merged.
 */
export const DEFAULT_APPROVAL_TIERS: Readonly<Record<string, number>> = {
  OWNER: 4,
  ADMIN: 3,
  STAFF: 0,
};

export const MAX_APPROVAL_TIER = 4;

/**
 * The approval tier a grantor must hold to confer a `tier4_*` AuthorityGrant.
 *
 * Read off the scope names themselves, which is the only bound the existing data
 * supports: a grant named `tier4_financial` confers tier-4 authority, and
 * `DEFAULT_APPROVAL_TIERS` puts tier 4 at OWNER. Shared by the creation-time check in
 * `AiSettingsService` and the decision-time check in `EffectiveAuthorityResolver`,
 * because a grant bounded on the way in and unbounded on the way out is not bounded.
 */
export const TIER4_GRANT_MIN_TIER = MAX_APPROVAL_TIER;

/** Whether a grant scope is one of the tier-4 family the bound above applies to. */
export function isTier4Scope(scope: string): boolean {
  return scope.startsWith('tier4_');
}

/**
 * CRM ownership sub-permission keys that may appear alongside module keys in a scope
 * map. They are NOT module keys — `resolveCrmAccess` reads them as sub-flags on top of
 * the `crm` level — but `validateScopesPayload` has always accepted them and the
 * resolver must not mistake them for unknown junk.
 */
export const CRM_SUBPERMISSION_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  crm_view: new Set(['all', 'owned']),
  crm_edit: new Set(['any', 'owned', 'none']),
  crm_reassign: new Set(['true', 'false', 'yes', 'no']),
  crm_delete: new Set(['any', 'owned', 'none']),
};

export function isCrmSubPermission(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CRM_SUBPERMISSION_VALUES, key);
}
