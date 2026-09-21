import type { AccessLevel, CanonicalModule } from './module-vocabulary';

/**
 * The shape CG-DIRECTIVE-AUTH-IMPL-001 specified, filled from the rows that exist.
 *
 * Every field that answers "may they?" is accompanied by something that answers "why?".
 * A decision this system cannot explain is a decision nobody can review, and the
 * authority sources here disagree often enough that the explanation is the product.
 */

/** Why a module resolved the way it did. Ordered by the precedence that produced it. */
export type ModuleDecisionReason =
  | 'super_admin_bypass'
  | 'no_membership'
  | 'explicit_deny'
  | 'denied_by_absence'
  | 'explicit_scope_map'
  | 'role_default'
  | 'position_narrowed'
  | 'position_capped_at_membership'
  | 'grant_capped_at_membership';

export interface AuthoritySource {
  /** Which kind of row produced this contribution. */
  kind: 'super_admin' | 'membership' | 'explicit_scope_map' | 'role_default' | 'position' | 'grant' | 'delegation';
  /** The row's id where one exists, so a decision can be traced back to a record. */
  id: string | null;
  /** Human-readable, safe to log. Never contains a scope map or any secret. */
  detail: string;
}

export interface ModuleDecision {
  module: CanonicalModule;
  level: AccessLevel;
  reason: ModuleDecisionReason;
  /**
   * True only for a canonical key PRESENT in an explicit map with value 'none' (or an
   * unrecognised value, which the live guard also denies). Distinct from a key that is
   * simply absent — that is `denied_by_absence`. CG-REVIEW C2 requires the two stay
   * distinguishable, because one is a decision and the other is a gap.
   */
  explicitDeny: boolean;
  /** Every source that contributed, including ones that were capped away. */
  sources: AuthoritySource[];
}

export interface PositionContribution {
  assignmentId: string;
  jobRoleId: string | null;
  jobRoleName: string | null;
  defaultApprovalTier: number | null;
  /** JobRole permission keys that exactly matched a canonical module key. */
  matchedModules: Partial<Record<CanonicalModule, AccessLevel>>;
  /**
   * JobRole permission keys that did NOT match a canonical module key — `finance`,
   * `hr`, `legal` and the rest of the MODULE_TOOL_FAMILIES namespace. Recorded so the
   * divergence is visible; they grant nothing. Aliasing them is prohibited scope.
   */
  unmatchedKeys: string[];
}

export interface GrantContribution {
  grantId: string;
  scope: string;
  maxAmount: number | null;
  validUntil: Date | null;
  /**
   * 'active'              — grantor resolves to a live Membership in this Business
   * 'legacy_unresolvable' — grantorId names no active Membership here; contributes
   *                         NOTHING (CG-REVIEW C3). Never guessed, never rewritten.
   */
  grantorStatus: 'active' | 'legacy_unresolvable';
  grantorMembershipId: string | null;
}

export interface DelegationContribution {
  ruleId: string;
  scope: string;
  maxTier: number;
  /** The principal's own active assignment that this rule delegates to. */
  viaAssignmentId: string;
  activeUntil: Date | null;
  /** maxTier after the Membership approval-tier cap (CG-REVIEW C4). */
  cappedTier: number;
}

export interface ApprovalTierResult {
  /**
   * The effective tier. Equal to the Membership tier: CG-REVIEW C4 froze the existing
   * rule, and nothing in it lets a position or delegation move the membership's own
   * ceiling. Positions and delegations are listed as capped contributors, not inputs.
   */
  effective: number;
  membershipTier: number;
  membershipTierSource: 'stored_max_approval_tier' | 'role_default';
  /** Strongest active position tier, already capped at `membershipTier`. */
  positionTierCapped: number | null;
  /** Strongest active delegation tier, already capped at `membershipTier`. */
  delegationTierCapped: number | null;
  /**
   * The stored value was 0 with no explicit scope map, so it was discarded for the
   * role default — the one case where a deliberate restriction cannot be recorded.
   * Surfaced, not fixed: no nullable migration in AUTH-001.
   */
  tierZeroAmbiguity: boolean;
}

export interface EffectiveAuthorityResult {
  principal: { userId: string; userRole: string | null };
  business: { businessId: string };

  relationship: {
    /**
     * 'membership'  — an active Membership row exists. The only basis for ordinary
     *                 authenticated-human authority.
     * 'super_admin' — User.role is SUPER_ADMIN. Compatibility is preserved, but it is
     *                 an explicit traced source here rather than a silent short-circuit.
     * 'none'        — no relationship; every module denies.
     */
     basis: 'membership' | 'super_admin' | 'none';
    membershipId: string | null;
    membershipRole: string | null;
    /** True when permissionScopes held an object, so the explicit-map rules apply. */
    hasExplicitScopeMap: boolean;
  };

  modules: Record<CanonicalModule, ModuleDecision>;
  positions: PositionContribution[];
  grants: GrantContribution[];
  delegations: DelegationContribution[];
  approvalTier: ApprovalTierResult;

  /**
   * Tier-4 scopes carried by active, grantor-resolvable USER grants.
   *
   * Deliberately a SEPARATE axis from `modules`. AuthorityGrant.scope values are
   * `tier4_financial` / `tier4_publishing` / `tier4_operations`, which are not
   * canonical module keys, and mapping them onto one would be exactly the alias
   * invention CG-REVIEW prohibits. `tier4_operations` in particular is NOT the
   * `operations` module.
   */
  tier4Scopes: string[];

  validity: {
    /** The instant every expiry and revocation predicate was evaluated against. */
    resolvedAt: Date;
    /**
     * A bounded read hit its ceiling, so this result may be incomplete. Never silently
     * true: a truncated authority read is a wrong authority answer, and the caller is
     * told rather than left to assume the set was whole.
     */
    truncated: boolean;
    /**
     * Membership has no tombstone and no version column, so freshness cannot be proven
     * across a concurrent hard delete between this read and the action it admits. The
     * obligation is transferred to KF-EXEC-ACTION-001; this flag keeps the gap visible
     * at the point of use instead of only in a control message.
     */
    membershipFreshnessUnprovable: true;
  };

  /** Ordered, human-readable trace of how this result was produced. */
  provenance: string[];
}
