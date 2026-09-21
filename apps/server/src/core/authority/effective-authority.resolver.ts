import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CANONICAL_MODULES,
  EXPLICIT_MAP_MISSING_KEY,
  LEVEL_RANK,
  defaultScopesForRole,
  isAccessLevel,
  isCanonicalModule,
  strongest,
  weakest,
  type AccessLevel,
  type CanonicalModule,
} from './module-vocabulary';
import { resolveMembershipApprovalTier } from './approval-tier';
import type {
  AuthoritySource,
  DelegationContribution,
  EffectiveAuthorityResult,
  GrantContribution,
  ModuleDecision,
  PositionContribution,
} from './effective-authority.types';

/**
 * One explainable decision-time authority answer over the rows that already exist.
 *
 * PRECEDENCE, as resolved by CG-REVIEW-AUTH-PRECEDENCE-001:
 *
 *   explicit deny  >  assignment allow  >  grant allow  >  base role/default allow
 *
 * with one law over the whole chain: a position or a grant may SELECT or NARROW
 * authority inside the Membership envelope, and may never create authority the
 * Membership does not already grant. That is why every positive contribution below
 * ends in a `weakest(..., base)` cap rather than a max().
 *
 * WHAT THIS RESOLVER IS NOT ALLOWED TO DO, AND WHY IT MATTERS
 *
 * It does not union vocabularies. `JobRolePolicyService`'s MODULE_TOOL_FAMILIES keys
 * (finance, sales, hr, legal, procurement...) share almost nothing with the canonical
 * human module keys, and a JobRole permission reaches module authority only on an
 * EXACT match. Non-matching keys are recorded on the result as `unmatchedKeys` and
 * grant nothing. An alias table would quietly turn `{finance: 'admin'}` into revenue
 * admin for a person no one intended to give it to.
 *
 * FRESHNESS
 *
 * Every expiry and revocation predicate is evaluated against a single `resolvedAt`
 * captured once at the top, so one resolve cannot see a grant as both live and expired.
 * That is the AUTH-001 freshness boundary: revoked or expired grants and delegations
 * contribute nothing at the resolver read. It is NOT a guard-to-handler admission
 * boundary — Membership revocation is a hard delete with no tombstone, so that
 * obligation is transferred to KF-EXEC-ACTION-001 and flagged on every result rather
 * than quietly assumed.
 */
@Injectable()
export class EffectiveAuthorityResolver {
  /**
   * Per-read ceiling. `defaultTakeExtension` caps unbounded findMany at 1000 rows, so
   * an unbounded read here would truncate SILENTLY and answer "no such position" for a
   * position that exists. These reads are per-principal and small; the ceiling exists
   * to make a surprise visible through `validity.truncated`, not to page a hot path.
   */
  private static readonly READ_CEILING = 200;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(businessId: string, userId: string): Promise<EffectiveAuthorityResult> {
    const resolvedAt = new Date();
    const provenance: string[] = [];
    let truncated = false;

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    // Membership is NOT in BUSINESS_ID_MODELS, so the Prisma tenant extension does not
    // scope it. The businessId in this compound key is the only thing keeping this
    // read inside the tenant, which is why it is the compound unique and not `id`.
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { id: true, role: true, permissionScopes: true, maxApprovalTier: true },
    });

    const isSuperAdmin = user?.role === 'SUPER_ADMIN';

    if (!membership) {
      if (isSuperAdmin) {
        provenance.push('SUPER_ADMIN with no Membership in this Business — bypass applies, traced');
        return this.superAdminResult(businessId, userId, user?.role ?? null, resolvedAt, provenance);
      }
      provenance.push('no Membership for this user in this Business — all modules deny');
      return this.noRelationshipResult(businessId, userId, user?.role ?? null, resolvedAt, provenance);
    }

    if (isSuperAdmin) {
      // Compatibility with the four existing bypasses, but recorded as a source. The
      // binding law forbids ADDING a silent superuser exception; it does not let us
      // pretend the existing ones are not there.
      provenance.push(`SUPER_ADMIN bypass over Membership ${membership.id} — traced, not silent`);
      return this.superAdminResult(businessId, userId, user?.role ?? null, resolvedAt, provenance, membership.id, membership.role);
    }

    const explicitScopes = toExplicitScopeMap(membership.permissionScopes);
    const hasExplicitScopeMap = explicitScopes !== null;
    provenance.push(
      hasExplicitScopeMap
        ? `Membership ${membership.id} role=${membership.role} with an explicit scope map (${Object.keys(explicitScopes).length} keys)`
        : `Membership ${membership.id} role=${membership.role} with no explicit scope map — role defaults apply`,
    );

    // ── base envelope ────────────────────────────────────────────────────────
    const base = new Map<CanonicalModule, ModuleDecision>();
    const roleDefaults = defaultScopesForRole(membership.role);

    for (const module of CANONICAL_MODULES) {
      base.set(module, this.baseDecision(module, membership, explicitScopes, roleDefaults));
    }

    // ── active positions ─────────────────────────────────────────────────────
    const assignments = await this.prisma.client.orgAssignment.findMany({
      where: { businessId, membershipId: membership.id, endedAt: null },
      select: {
        id: true,
        jobRoleId: true,
        jobRole: { select: { id: true, name: true, permissions: true, defaultApprovalTier: true } },
      },
      orderBy: { id: 'asc' },
      take: EffectiveAuthorityResolver.READ_CEILING,
    });
    truncated ||= assignments.length === EffectiveAuthorityResolver.READ_CEILING;

    const positions = assignments.map((a) => toPositionContribution(a));
    if (positions.length > 0) {
      provenance.push(`${positions.length} active position(s): ${positions.map((p) => p.jobRoleName ?? p.assignmentId).join(', ')}`);
    }
    this.applyPositions(base, positions, provenance);

    // ── USER grants ──────────────────────────────────────────────────────────
    const grants = await this.loadUserGrants(businessId, userId, resolvedAt);
    truncated ||= grants.truncated;
    this.applyGrants(base, grants.contributions, provenance);

    // ── delegations ──────────────────────────────────────────────────────────
    const membershipTier = resolveMembershipApprovalTier(membership);
    const delegations = await this.loadDelegations(
      businessId,
      positions.map((p) => p.assignmentId),
      resolvedAt,
      membershipTier.tier,
    );
    truncated ||= delegations.truncated;

    // ── approval tier ────────────────────────────────────────────────────────
    const positionTiers = positions
      .map((p) => p.defaultApprovalTier)
      .filter((t): t is number => typeof t === 'number');
    const positionTierCapped = positionTiers.length > 0 ? Math.min(Math.max(...positionTiers), membershipTier.tier) : null;
    const delegationTierCapped = delegations.contributions.length > 0
      ? Math.max(...delegations.contributions.map((d) => d.cappedTier))
      : null;

    provenance.push(
      `approval tier ${membershipTier.tier} from ${membershipTier.source}` +
        (positionTierCapped !== null ? `; strongest position tier capped to ${positionTierCapped}` : '') +
        (delegationTierCapped !== null ? `; strongest delegation tier capped to ${delegationTierCapped}` : '') +
        (membershipTier.tierZeroAmbiguity ? '; tier_zero_ambiguity — stored 0 discarded for the role default' : ''),
    );

    if (truncated) {
      provenance.push('TRUNCATED — a bounded read hit its ceiling; this result may be incomplete');
    }

    return {
      principal: { userId, userRole: user?.role ?? null },
      business: { businessId },
      relationship: {
        basis: 'membership',
        membershipId: membership.id,
        membershipRole: membership.role,
        hasExplicitScopeMap,
      },
      modules: Object.fromEntries(base) as Record<CanonicalModule, ModuleDecision>,
      positions,
      grants: grants.contributions,
      delegations: delegations.contributions,
      approvalTier: {
        effective: membershipTier.tier,
        membershipTier: membershipTier.tier,
        membershipTierSource: membershipTier.source,
        positionTierCapped,
        delegationTierCapped,
        tierZeroAmbiguity: membershipTier.tierZeroAmbiguity,
      },
      tier4Scopes: [
        ...new Set(
          grants.contributions
            .filter((g) => g.grantorStatus === 'active' && g.scope.startsWith('tier4_'))
            .map((g) => g.scope),
        ),
      ],
      validity: { resolvedAt, truncated, membershipFreshnessUnprovable: true },
      provenance,
    };
  }

  /** Convenience for a guard: does this principal meet `minLevel` on `module`? */
  async allows(businessId: string, userId: string, module: CanonicalModule, minLevel: AccessLevel): Promise<boolean> {
    const result = await this.resolve(businessId, userId);
    return LEVEL_RANK[result.modules[module].level] >= LEVEL_RANK[minLevel];
  }

  // ───────────────────────────────────────────────────────────────────────────

  private baseDecision(
    module: CanonicalModule,
    membership: { id: string; role: string },
    explicitScopes: Record<string, unknown> | null,
    roleDefaults: Record<CanonicalModule, AccessLevel>,
  ): ModuleDecision {
    const membershipSource: AuthoritySource = {
      kind: 'membership',
      id: membership.id,
      detail: `Membership role ${membership.role}`,
    };

    if (explicitScopes === null) {
      return {
        module,
        level: roleDefaults[module],
        reason: 'role_default',
        explicitDeny: false,
        sources: [membershipSource, { kind: 'role_default', id: null, detail: `role default ${roleDefaults[module]} for ${membership.role}` }],
      };
    }

    // Presence matters. `hasOwnProperty` rather than a truthiness check, because the
    // whole point of C2 is that a present 'none' and an absent key are different facts.
    if (!Object.prototype.hasOwnProperty.call(explicitScopes, module)) {
      return {
        module,
        level: EXPLICIT_MAP_MISSING_KEY,
        reason: 'denied_by_absence',
        explicitDeny: false,
        sources: [membershipSource, { kind: 'explicit_scope_map', id: membership.id, detail: `key absent from the explicit map` }],
      };
    }

    const raw = explicitScopes[module];

    if (raw === 'none') {
      return {
        module,
        level: 'none',
        reason: 'explicit_deny',
        explicitDeny: true,
        sources: [membershipSource, { kind: 'explicit_scope_map', id: membership.id, detail: `explicit 'none' — deny` }],
      };
    }

    if (!isAccessLevel(raw)) {
      // The live guard computes `LEVEL_HIERARCHY[level] ?? 0` and denies. Treated as an
      // explicit deny rather than an absence so that no later source can raise it,
      // which keeps the resolver's answer identical to the guard's.
      return {
        module,
        level: 'none',
        reason: 'explicit_deny',
        explicitDeny: true,
        sources: [membershipSource, { kind: 'explicit_scope_map', id: membership.id, detail: `unrecognised level — denied, as the guard does` }],
      };
    }

    return {
      module,
      level: raw,
      reason: 'explicit_scope_map',
      explicitDeny: false,
      sources: [membershipSource, { kind: 'explicit_scope_map', id: membership.id, detail: `explicit ${raw}` }],
    };
  }

  private applyPositions(
    base: Map<CanonicalModule, ModuleDecision>,
    positions: PositionContribution[],
    provenance: string[],
  ): void {
    // Strongest across positions FIRST, so two positions compose with each other before
    // either meets the Membership cap. Capping each one separately then taking the max
    // gives the same number here, but this order is what "compose, then cap" means and
    // it keeps the trace honest about which position won.
    const strongestByModule = new Map<CanonicalModule, { level: AccessLevel; assignmentId: string }>();
    for (const position of positions) {
      for (const [module, level] of Object.entries(position.matchedModules) as [CanonicalModule, AccessLevel][]) {
        const current = strongestByModule.get(module);
        if (!current || LEVEL_RANK[level] > LEVEL_RANK[current.level]) {
          strongestByModule.set(module, { level, assignmentId: position.assignmentId });
        }
      }
    }

    for (const [module, winner] of strongestByModule) {
      const decision = base.get(module)!;

      if (decision.explicitDeny) {
        // Explicit deny is terminal. A position cannot cancel it — that is the whole
        // content of "explicit deny > assignment allow".
        decision.sources.push({
          kind: 'position',
          id: winner.assignmentId,
          detail: `position would grant ${winner.level}, overridden by explicit deny`,
        });
        provenance.push(`${module}: explicit deny holds over position ${winner.assignmentId} (${winner.level})`);
        continue;
      }

      const capped = weakest(winner.level, decision.level);
      decision.sources.push({
        kind: 'position',
        id: winner.assignmentId,
        detail:
          capped === winner.level
            ? `position grants ${winner.level}`
            : `position ${winner.level} capped to ${capped} by the Membership envelope`,
      });

      if (capped !== decision.level) {
        provenance.push(`${module}: ${decision.level} narrowed to ${capped} by position ${winner.assignmentId}`);
        decision.level = capped;
        decision.reason = 'position_narrowed';
      } else if (LEVEL_RANK[winner.level] > LEVEL_RANK[decision.level]) {
        provenance.push(`${module}: position ${winner.assignmentId} asked for ${winner.level}, capped at ${decision.level}`);
        decision.reason = 'position_capped_at_membership';
      }
    }
  }

  private applyGrants(
    base: Map<CanonicalModule, ModuleDecision>,
    grants: GrantContribution[],
    provenance: string[],
  ): void {
    for (const grant of grants) {
      if (grant.grantorStatus !== 'active') {
        provenance.push(`grant ${grant.grantId} (${grant.scope}) ignored — legacy_unresolvable_grantor`);
        continue;
      }
      // Generic on purpose. No AuthorityGrant.scope value is a canonical module key
      // today — they are all `tier4_*`, which land on `tier4Scopes` instead — so this
      // branch is currently unreachable by data shape rather than by omission. It is
      // written out so a scope that IS a module key gets the same cap as a position,
      // and so the absence is visible to the next reader.
      if (!isCanonicalModule(grant.scope)) continue;

      const decision = base.get(grant.scope)!;
      if (decision.explicitDeny) {
        decision.sources.push({ kind: 'grant', id: grant.grantId, detail: 'overridden by explicit deny' });
        continue;
      }
      const capped = weakest('admin', decision.level);
      decision.sources.push({
        kind: 'grant',
        id: grant.grantId,
        detail: capped === decision.level ? `grant capped at the Membership envelope (${capped})` : `grant grants ${capped}`,
      });
      decision.reason = 'grant_capped_at_membership';
    }
  }

  private async loadUserGrants(
    businessId: string,
    userId: string,
    now: Date,
  ): Promise<{ contributions: GrantContribution[]; truncated: boolean }> {
    const rows = await this.prisma.client.authorityGrant.findMany({
      where: {
        businessId,
        granteeType: 'USER',
        granteeId: userId,
        // Expired or revoked sources contribute nothing. All three predicates are
        // evaluated against the single `now` captured at the top of resolve().
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      },
      select: { id: true, scope: true, maxAmount: true, validUntil: true, grantorId: true },
      orderBy: { id: 'asc' },
      take: EffectiveAuthorityResolver.READ_CEILING,
    });

    if (rows.length === 0) return { contributions: [], truncated: false };

    // CG-REVIEW C3: a grant whose grantorId does not resolve to an active Membership in
    // THIS Business is legacy_unresolvable_grantor and contributes nothing. It is never
    // guessed at and never rewritten — the classifier reports it for a human instead.
    const grantorIds = [...new Set(rows.map((r) => r.grantorId).filter(Boolean))];
    const resolvable = new Set<string>();
    if (grantorIds.length > 0) {
      const found = await this.prisma.client.membership.findMany({
        where: { id: { in: grantorIds }, businessId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: EffectiveAuthorityResolver.READ_CEILING,
      });
      for (const m of found) resolvable.add(m.id);
    }

    return {
      contributions: rows.map((r) => ({
        grantId: r.id,
        scope: r.scope,
        maxAmount: r.maxAmount ?? null,
        validUntil: r.validUntil ?? null,
        grantorStatus: resolvable.has(r.grantorId) ? ('active' as const) : ('legacy_unresolvable' as const),
        grantorMembershipId: resolvable.has(r.grantorId) ? r.grantorId : null,
      })),
      truncated: rows.length === EffectiveAuthorityResolver.READ_CEILING,
    };
  }

  private async loadDelegations(
    businessId: string,
    assignmentIds: string[],
    now: Date,
    membershipTier: number,
  ): Promise<{ contributions: DelegationContribution[]; truncated: boolean }> {
    if (assignmentIds.length === 0) return { contributions: [], truncated: false };

    const rows = await this.prisma.client.delegationRule.findMany({
      where: {
        businessId,
        delegateId: { in: assignmentIds },
        isActive: true,
        activeFrom: { lte: now },
        OR: [{ activeUntil: null }, { activeUntil: { gte: now } }],
      },
      select: { id: true, scope: true, maxTier: true, delegateId: true, activeUntil: true },
      orderBy: { id: 'asc' },
      take: EffectiveAuthorityResolver.READ_CEILING,
    });

    return {
      contributions: rows.map((r) => ({
        ruleId: r.id,
        scope: r.scope,
        maxTier: r.maxTier,
        viaAssignmentId: r.delegateId,
        activeUntil: r.activeUntil ?? null,
        // A delegation reaches the principal through one of their own assignments, so
        // it is assignment-derived and capped by the Membership tier (CG-REVIEW C4).
        cappedTier: Math.min(r.maxTier, membershipTier),
      })),
      truncated: rows.length === EffectiveAuthorityResolver.READ_CEILING,
    };
  }

  private superAdminResult(
    businessId: string,
    userId: string,
    userRole: string | null,
    resolvedAt: Date,
    provenance: string[],
    membershipId: string | null = null,
    membershipRole: string | null = null,
  ): EffectiveAuthorityResult {
    const source: AuthoritySource = { kind: 'super_admin', id: userId, detail: 'User.role is SUPER_ADMIN' };
    return {
      principal: { userId, userRole },
      business: { businessId },
      relationship: { basis: 'super_admin', membershipId, membershipRole, hasExplicitScopeMap: false },
      modules: Object.fromEntries(
        CANONICAL_MODULES.map((module) => [
          module,
          { module, level: 'admin' as AccessLevel, reason: 'super_admin_bypass' as const, explicitDeny: false, sources: [source] },
        ]),
      ) as Record<CanonicalModule, ModuleDecision>,
      positions: [],
      grants: [],
      delegations: [],
      approvalTier: {
        effective: 4,
        membershipTier: 4,
        membershipTierSource: 'role_default',
        positionTierCapped: null,
        delegationTierCapped: null,
        tierZeroAmbiguity: false,
      },
      tier4Scopes: [],
      validity: { resolvedAt, truncated: false, membershipFreshnessUnprovable: true },
      provenance,
    };
  }

  private noRelationshipResult(
    businessId: string,
    userId: string,
    userRole: string | null,
    resolvedAt: Date,
    provenance: string[],
  ): EffectiveAuthorityResult {
    return {
      principal: { userId, userRole },
      business: { businessId },
      relationship: { basis: 'none', membershipId: null, membershipRole: null, hasExplicitScopeMap: false },
      modules: Object.fromEntries(
        CANONICAL_MODULES.map((module) => [
          module,
          {
            module,
            level: 'none' as AccessLevel,
            reason: 'no_membership' as const,
            explicitDeny: false,
            sources: [{ kind: 'membership' as const, id: null, detail: 'no Membership in this Business' }],
          },
        ]),
      ) as Record<CanonicalModule, ModuleDecision>,
      positions: [],
      grants: [],
      delegations: [],
      approvalTier: {
        effective: 0,
        membershipTier: 0,
        membershipTierSource: 'role_default',
        positionTierCapped: null,
        delegationTierCapped: null,
        tierZeroAmbiguity: false,
      },
      tier4Scopes: [],
      validity: { resolvedAt, truncated: false, membershipFreshnessUnprovable: true },
      provenance,
    };
  }
}

/**
 * Whether a `permissionScopes` value counts as an explicit map.
 *
 * Mirrors ModuleScopeGuard's `permissionScopes && typeof === 'object'` EXACTLY,
 * arrays included. That is deliberate and it matters: `permissionScopes` is a Json
 * column, so an array can be stored in it. Excluding arrays here would fall through to
 * role defaults while the guard treats the array as a scope map whose every key is
 * absent — i.e. the resolver would ALLOW where the guard DENIES. Every other
 * divergence in this file makes the resolver stricter than the guard; this one would
 * have made it laxer, which is the only direction that can leak authority.
 */
function toExplicitScopeMap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function toPositionContribution(assignment: {
  id: string;
  jobRoleId: string | null;
  jobRole: { id: string; name: string; permissions: unknown; defaultApprovalTier: number } | null;
}): PositionContribution {
  const matchedModules: Partial<Record<CanonicalModule, AccessLevel>> = {};
  const unmatchedKeys: string[] = [];

  const permissions = toExplicitScopeMap(assignment.jobRole?.permissions);
  if (permissions) {
    for (const [key, raw] of Object.entries(permissions)) {
      // EXACT match only. `finance`, `hr`, `legal` and the rest of the JobRole tool
      // namespace fall here and stay here: aliasing them onto module keys is prohibited.
      if (isCanonicalModule(key) && isAccessLevel(raw)) {
        const existing = matchedModules[key];
        matchedModules[key] = existing ? strongest(existing, raw) : raw;
      } else {
        unmatchedKeys.push(key);
      }
    }
  }

  return {
    assignmentId: assignment.id,
    jobRoleId: assignment.jobRoleId ?? assignment.jobRole?.id ?? null,
    jobRoleName: assignment.jobRole?.name ?? null,
    defaultApprovalTier: assignment.jobRole?.defaultApprovalTier ?? null,
    matchedModules,
    unmatchedKeys,
  };
}
