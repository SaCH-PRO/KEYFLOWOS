import { Inject, Injectable, Optional } from '@nestjs/common';
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
  TIER4_GRANT_MIN_TIER,
  isTier4Scope,
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
 * Injection token letting a test shrink the resolver's page size. Never provided in
 * production — the default applies — and the semantic result must not depend on it.
 */
export const AUTHORITY_PAGE_SIZE = 'AUTHORITY_PAGE_SIZE';

/** The value AuthorityModule binds to that token. */
export const DEFAULT_AUTHORITY_PAGE_SIZE = 200;

/**
 * An authority-source read could not be completed. Never surfaced to a caller as an
 * error: `resolve()` catches it and returns a fail-closed denial, because the one thing
 * an authority resolver must not do with an incomplete read is answer permissively.
 */
export class AuthorityReadIncompleteError extends Error {}

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
   * Rows per page. NOT a ceiling — every read below pages to exhaustion.
   *
   * The first version of this file used a 200-row ceiling and set a `truncated` flag.
   * CG-REVIEW-AUTH-001 rejected that as unsafe, correctly: active positions NARROW the
   * Membership envelope, so if the only narrowing position for a module sits past row
   * 200, a ceiling-bounded read silently leaves the broader permission in place and
   * `allows()` returns true. A flag on a permissive answer does not stop the overgrant;
   * it annotates it. `defaultTakeExtension` caps unbounded findMany at 1000 rows, so
   * "just read them all" is not available either — the cap would truncate silently.
   *
   * Page size is a performance knob and nothing else: `AUTHORITY_PAGE_SIZE` is bound by
   * AuthorityModule to `DEFAULT_AUTHORITY_PAGE_SIZE`, and a test may construct the
   * resolver with a different size. The semantic result must be identical at every
   * size — that invariance is asserted, because a page size that changes the answer
   * means the paging is wrong.
   */
  /**
   * Runaway guard, not a data bound. At the default page size this is 200k rows for a
   * single principal — far past anything real, so reaching it means a cursor that is
   * not advancing rather than a genuinely large estate. Hitting it FAILS CLOSED.
   */
  private static readonly MAX_PAGES = 1000;

  private readonly pageSize: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(AUTHORITY_PAGE_SIZE) pageSize?: number,
  ) {
    this.pageSize = pageSize && pageSize > 0 ? pageSize : DEFAULT_AUTHORITY_PAGE_SIZE;
  }

  async resolve(businessId: string, userId: string): Promise<EffectiveAuthorityResult> {
    const resolvedAt = new Date();
    const provenance: string[] = [];
    try {
      return await this.resolveComplete(businessId, userId, resolvedAt, provenance);
    } catch (err) {
      if (!(err instanceof AuthorityReadIncompleteError)) throw err;
      // FAIL CLOSED. An incomplete read of narrowing sources cannot be answered
      // permissively, so it is not answered at all.
      provenance.push(`INCOMPLETE READ — failing closed: ${err.message}`);
      const denied = this.noRelationshipResult(businessId, userId, null, resolvedAt, provenance);
      return { ...denied, validity: { ...denied.validity, truncated: true } };
    }
  }

  private async resolveComplete(
    businessId: string,
    userId: string,
    resolvedAt: Date,
    provenance: string[],
  ): Promise<EffectiveAuthorityResult> {

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
    const assignments = await this.pageAll('orgAssignment', (cursor) =>
      this.prisma.client.orgAssignment.findMany({
        where: { businessId, membershipId: membership.id, endedAt: null },
        select: {
          id: true,
          jobRoleId: true,
          jobRole: { select: { id: true, name: true, permissions: true, defaultApprovalTier: true } },
        },
        orderBy: { id: 'asc' },
        take: this.pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    const positions = assignments.map((a) => toPositionContribution(a));
    if (positions.length > 0) {
      provenance.push(`${positions.length} active position(s): ${positions.map((p) => p.jobRoleName ?? p.assignmentId).join(', ')}`);
    }
    this.applyPositions(base, positions, provenance);

    // ── USER grants ──────────────────────────────────────────────────────────
    const membershipTier = resolveMembershipApprovalTier(membership);
    const grants = await this.loadUserGrants(businessId, userId, resolvedAt);
    this.applyGrants(base, grants, provenance);

    // ── delegations ──────────────────────────────────────────────────────────
    const delegations = await this.loadDelegations(
      businessId,
      positions.map((p) => p.assignmentId),
      resolvedAt,
      membershipTier.tier,
    );

    // ── approval tier ────────────────────────────────────────────────────────
    const positionTiers = positions
      .map((p) => p.defaultApprovalTier)
      .filter((t): t is number => typeof t === 'number');
    const positionTierCapped = positionTiers.length > 0 ? Math.min(Math.max(...positionTiers), membershipTier.tier) : null;
    const delegationTierCapped = delegations.length > 0
      ? Math.max(...delegations.map((d) => d.cappedTier))
      : null;

    provenance.push(
      `approval tier ${membershipTier.tier} from ${membershipTier.source}` +
        (positionTierCapped !== null ? `; strongest position tier capped to ${positionTierCapped}` : '') +
        (delegationTierCapped !== null ? `; strongest delegation tier capped to ${delegationTierCapped}` : '') +
        (membershipTier.tierZeroAmbiguity ? '; tier_zero_ambiguity — stored 0 discarded for the role default' : ''),
    );

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
      grants,
      delegations,
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
          grants.filter((g) => g.grantorStatus === 'active_grantor' && isTier4Scope(g.scope)).map((g) => g.scope),
        ),
      ],
      validity: { resolvedAt, truncated: false, membershipFreshnessUnprovable: true },
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
      if (grant.grantorStatus !== 'active_grantor') {
        provenance.push(`grant ${grant.grantId} (${grant.scope}) ignored — ${grant.grantorStatus}`);
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
  ): Promise<GrantContribution[]> {
    const rows = await this.pageAll('authorityGrant', (cursor) =>
      this.prisma.client.authorityGrant.findMany({
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
        take: this.pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    if (rows.length === 0) return [];

    // The grantor bound, applied at DECISION time and not only at creation.
    //
    // CG-REVIEW-AUTH-001: bounding a grant when it is written and then trusting it
    // forever is not bounding it. A grantor demoted below tier 4 after issuing a grant
    // no longer has the authority the grant conveys, and the binding law is about the
    // grantor's CURRENT grantable authority. So the grantor's tier is recomputed here,
    // through the same frozen Membership rule every other tier decision uses.
    //
    // Not recursive: the grantor's tier comes from their Membership alone. It is never
    // derived from grants, so no grant can bootstrap the authority that validates it.
    const grantorIds = [...new Set(rows.map((r) => r.grantorId).filter(Boolean))];
    const grantors = new Map<string, number>();
    for (const batch of chunk(grantorIds, this.pageSize)) {
      // Paged like everything else: a truncated grantor lookup would silently
      // reclassify a live grant as unresolvable, which is the same class of wrong
      // answer in the opposite direction.
      const found = await this.pageAll('membership', (cursor) =>
        this.prisma.client.membership.findMany({
          where: { id: { in: batch }, businessId },
          select: { id: true, role: true, permissionScopes: true, maxApprovalTier: true },
          orderBy: { id: 'asc' },
          take: this.pageSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      );
      for (const m of found) grantors.set(m.id, resolveMembershipApprovalTier(m).tier);
    }

    return rows.map((r) => {
      const grantorTier = grantors.get(r.grantorId);

      if (grantorTier === undefined) {
        return {
          grantId: r.id,
          scope: r.scope,
          maxAmount: r.maxAmount ?? null,
          validUntil: r.validUntil ?? null,
          grantorStatus: 'legacy_unresolvable_grantor' as const,
          grantorMembershipId: null,
          grantorTier: null,
        };
      }

      // The bound applies to the tier-4 family. A scope outside it has no stated
      // threshold in the data, and inventing one would be the alias invention this
      // packet prohibits — so it is left to the Membership envelope alone.
      const bounded = !isTier4Scope(r.scope) || grantorTier >= TIER4_GRANT_MIN_TIER;

      return {
        grantId: r.id,
        scope: r.scope,
        maxAmount: r.maxAmount ?? null,
        validUntil: r.validUntil ?? null,
        grantorStatus: bounded ? ('active_grantor' as const) : ('grantor_no_longer_grantable' as const),
        grantorMembershipId: r.grantorId,
        grantorTier,
      };
    });
  }

  private async loadDelegations(
    businessId: string,
    assignmentIds: string[],
    now: Date,
    membershipTier: number,
  ): Promise<DelegationContribution[]> {
    if (assignmentIds.length === 0) return [];

    const rows: { id: string; scope: string; maxTier: number; delegateId: string; activeUntil: Date | null }[] = [];
    // Chunked because `delegateId: { in: [...] }` grows with the principal's positions,
    // and paged within each chunk because the matching rules can outnumber them.
    for (const batch of chunk(assignmentIds, this.pageSize)) {
      const page = await this.pageAll('delegationRule', (cursor) =>
        this.prisma.client.delegationRule.findMany({
          where: {
            businessId,
            delegateId: { in: batch },
            isActive: true,
            activeFrom: { lte: now },
            OR: [{ activeUntil: null }, { activeUntil: { gte: now } }],
          },
          select: { id: true, scope: true, maxTier: true, delegateId: true, activeUntil: true },
          orderBy: { id: 'asc' },
          take: this.pageSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      );
      rows.push(...page);
    }

    return rows.map((r) => ({
      ruleId: r.id,
      scope: r.scope,
      maxTier: r.maxTier,
      viaAssignmentId: r.delegateId,
      activeUntil: r.activeUntil ?? null,
      // A delegation reaches the principal through one of their own assignments, so
      // it is assignment-derived and capped by the Membership tier (CG-REVIEW C4).
      cappedTier: Math.min(r.maxTier, membershipTier),
    }));
  }

  /**
   * Pages a read to EXHAUSTION on a stable id cursor, stopping on an EMPTY page.
   *
   * Not a short page. `defaultTakeExtension` can return fewer rows than `take` asked
   * for, so treating a short page as the end is exactly how a narrowing position goes
   * missing. Follows the KF-EXEC-TENANT-001 inventory precedent.
   */
  private async pageAll<T extends { id: string }>(
    source: string,
    fetch: (cursor: string | undefined) => Promise<T[]>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; ; page += 1) {
      if (page >= EffectiveAuthorityResolver.MAX_PAGES) {
        throw new AuthorityReadIncompleteError(
          `${source} exceeded ${EffectiveAuthorityResolver.MAX_PAGES} pages — cursor is not advancing`,
        );
      }
      const rows = await fetch(cursor);
      if (rows.length === 0) break;
      out.push(...rows);
      const next = rows[rows.length - 1]?.id;
      if (!next || next === cursor) {
        throw new AuthorityReadIncompleteError(`${source} returned a non-advancing cursor`);
      }
      cursor = next;
    }
    return out;
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
