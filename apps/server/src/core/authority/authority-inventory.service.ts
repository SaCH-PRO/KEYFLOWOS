import { isAccessLevel, isCanonicalModule, isTier4Scope, TIER4_GRANT_MIN_TIER } from './module-vocabulary';
import { resolveMembershipApprovalTier } from './approval-tier';

/**
 * Read-only inventories of the two things AUTH-001 found but is not allowed to repair.
 *
 * Deliberately modelled on `FoundingMembershipService` from KF-EXEC-TENANT-001, which
 * is the house pattern: classify into named classes, repair only a class with exactly
 * one possible correct answer, and print everything else for a human. Here NOTHING is
 * repaired — CG-REVIEW-AUTH-PRECEDENCE-001 says `repair: NONE_AUTOMATIC` for grants,
 * and a stale copied scope map has no single correct answer at all. Guessing would mint
 * authority for an identity nobody chose, which is worse than a visibly broken row.
 *
 * NOT A NEST PROVIDER
 *
 * No `@Injectable`, and it takes the Prisma client directly rather than PrismaService.
 * That is the accurate label: nothing injects this, no decorator drives it, and its
 * only caller is `scripts/authority-inventory.ts`. Decorating it would have Nest build
 * it on every boot for nobody — the shape `unreachable-provider.spec.ts` exists to
 * catch — and it would force the script into an `as unknown as PrismaService` cast for
 * a dependency it never actually needs. KF-EXEC-TENANT-001's FoundingMembershipService
 * is the same arrangement.
 *
 * PAGING
 *
 * `defaultTakeExtension` caps every unbounded `findMany` at 1000 rows. An inventory
 * that ignores that reports on the first 1000 and calls the estate scanned. Every read
 * below pages on a stable id cursor and terminates on an EMPTY page, not a short one —
 * a short page only means "the end" if the server honoured `take`, which is exactly the
 * assumption the cap violates.
 */

export type GrantorClass =
  | 'active_grantor'
  | 'legacy_unresolvable_grantor'
  /**
   * The grantor Membership still exists but its CURRENT approval tier is below the
   * tier-4 bound, so the resolver no longer lets the grant contribute. A separate class
   * from `legacy_unresolvable_grantor` on purpose: one is a row nobody can interpret,
   * the other is a decision that has since been overtaken, and they need different
   * remedies. USER grants only — KEY readers are outside the AUTH-001 cutover, so a
   * KEY grant is never classified this way.
   */
  | 'grantor_no_longer_grantable'
  | 'grantor_is_empty';

export interface GrantorFinding {
  grantId: string;
  businessId: string;
  granteeType: string;
  scope: string;
  grantorId: string;
  classification: GrantorClass;
  detail: string;
}

export type StaleCopyClass =
  | 'copy_matches_live_jobrole'
  | 'copy_diverged_from_live_jobrole'
  | 'copy_from_deleted_or_ended_position'
  | 'scope_map_uses_non_canonical_keys'
  | 'no_copied_authority';

export interface StaleCopyFinding {
  membershipId: string;
  businessId: string;
  role: string;
  classification: StaleCopyClass;
  detail: string;
}

/**
 * The narrow slice of the Prisma client this needs. Structural, so the script passes
 * `db` straight in and the tests pass a fake without either one pretending to be a
 * PrismaService.
 */
export interface AuthorityInventoryClient {
  authorityGrant: { findMany(args: unknown): Promise<any[]> };
  membership: { findMany(args: unknown): Promise<any[]> };
  orgAssignment: { findMany(args: unknown): Promise<any[]> };
}

export class AuthorityInventoryService {
  private static readonly PAGE = 500;

  constructor(private readonly db: AuthorityInventoryClient) {}

  /**
   * Which AuthorityGrant rows name a grantor the resolver can stand behind.
   *
   * A `legacy_unresolvable_grantor` row contributes nothing at decision time. That is
   * already enforced in the resolver; this says how many there are, which is the number
   * nobody could produce before.
   */
  async classifyGrantors(): Promise<GrantorFinding[]> {
    const grants = await this.pageAll((cursor) =>
      this.db.authorityGrant.findMany({
        where: { revokedAt: null },
        select: { id: true, businessId: true, granteeType: true, scope: true, grantorId: true },
        orderBy: { id: 'asc' },
        take: AuthorityInventoryService.PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    if (grants.length === 0) return [];

    // A grantor is only resolvable INSIDE the grant's own Business. The same id
    // resolving somewhere else is not the grantor of this grant.
    const byBusiness = new Map<string, Set<string>>();
    for (const g of grants) {
      if (!g.grantorId) continue;
      const set = byBusiness.get(g.businessId) ?? new Set<string>();
      set.add(g.grantorId);
      byBusiness.set(g.businessId, set);
    }

    // The grantor's CURRENT tier, not merely their existence. Mirrors the resolver.
    const grantorTiers = new Map<string, number>();
    for (const [businessId, ids] of byBusiness) {
      for (const batch of chunk([...ids], AuthorityInventoryService.PAGE)) {
        const found = await this.pageAll((cursor) =>
          this.db.membership.findMany({
            where: { id: { in: batch }, businessId },
            select: { id: true, role: true, permissionScopes: true, maxApprovalTier: true },
            orderBy: { id: 'asc' },
            take: AuthorityInventoryService.PAGE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
        );
        for (const m of found) grantorTiers.set(`${businessId}:${m.id}`, resolveMembershipApprovalTier(m).tier);
      }
    }

    return grants.map((g) => {
      const base = {
        grantId: g.id,
        businessId: g.businessId,
        granteeType: g.granteeType,
        scope: g.scope,
        grantorId: g.grantorId,
      };
      if (!g.grantorId) {
        return { ...base, classification: 'grantor_is_empty' as const, detail: 'grantorId is empty' };
      }
      const tier = grantorTiers.get(`${g.businessId}:${g.grantorId}`);
      if (tier !== undefined) {
        // The bound applies to the tier-4 family and to USER grants only.
        if (g.granteeType === 'USER' && isTier4Scope(g.scope) && tier < TIER4_GRANT_MIN_TIER) {
          return {
            ...base,
            classification: 'grantor_no_longer_grantable' as const,
            detail: `grantor ${g.grantorId} is now tier ${tier}, below the tier ${TIER4_GRANT_MIN_TIER} this grant conveys — contributes nothing`,
          };
        }
        return {
          ...base,
          classification: 'active_grantor' as const,
          detail: `grantor ${g.grantorId} is a Membership in this business at tier ${tier}`,
        };
      }
      return {
        ...base,
        classification: 'legacy_unresolvable_grantor' as const,
        // Named rather than guessed. Historically this field held a User id or the
        // literal 'system'; which one is unknowable from the row, so we do not claim.
        detail: `grantor ${g.grantorId} names no Membership in this business — contributes nothing`,
      };
    });
  }

  /**
   * Where `Membership.permissionScopes` has drifted from the JobRole it was copied from.
   *
   * `structure.service` copies `jobRole.permissions` into the membership at assignment
   * create and update, and at no other time. `updateJobRole` does not re-project,
   * `deleteJobRole` does not unwind, and an ended assignment leaves the copy in place —
   * so the copy and the live role diverge on the first edit and never reconverge, while
   * the guard reads the copy and `JobRolePolicyService` reads the live role.
   */
  async classifyStaleCopies(): Promise<StaleCopyFinding[]> {
    const memberships = await this.pageAll((cursor) =>
      this.db.membership.findMany({
        select: { id: true, businessId: true, role: true, permissionScopes: true },
        orderBy: { id: 'asc' },
        take: AuthorityInventoryService.PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    if (memberships.length === 0) return [];

    const assignments = await this.pageAll((cursor) =>
      this.db.orgAssignment.findMany({
        where: { membershipId: { in: memberships.map((m) => m.id) } },
        select: {
          id: true,
          membershipId: true,
          endedAt: true,
          jobRole: { select: { id: true, permissions: true } },
        },
        orderBy: { id: 'asc' },
        take: AuthorityInventoryService.PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );

    const liveByMembership = new Map<string, unknown[]>();
    for (const a of assignments) {
      if (a.endedAt !== null || !a.jobRole) continue;
      const list = liveByMembership.get(a.membershipId ?? '') ?? [];
      list.push(a.jobRole.permissions);
      liveByMembership.set(a.membershipId ?? '', list);
    }

    return memberships.map((m) => {
      const copy = asPlainObject(m.permissionScopes);
      if (!copy) {
        return { membershipId: m.id, businessId: m.businessId, role: m.role, classification: 'no_copied_authority' as const, detail: 'no explicit scope map — role defaults apply' };
      }

      const nonCanonical = Object.keys(copy).filter(
        (k) => !isCanonicalModule(k) && !k.startsWith('crm_'),
      );
      if (nonCanonical.length > 0) {
        return {
          membershipId: m.id,
          businessId: m.businessId,
          role: m.role,
          classification: 'scope_map_uses_non_canonical_keys' as const,
          // This is the one that silently locks a person out: the guard reads
          // `scopes[module] || 'none'`, so a map of JobRole tool-family keys denies
          // every canonical module while looking like a populated permission set.
          detail: `keys outside the canonical vocabulary grant nothing: ${nonCanonical.join(', ')}`,
        };
      }

      const live = liveByMembership.get(m.id) ?? [];
      if (live.length === 0) {
        return {
          membershipId: m.id,
          businessId: m.businessId,
          role: m.role,
          classification: 'copy_from_deleted_or_ended_position' as const,
          detail: 'an explicit scope map exists with no active position backing it',
        };
      }

      const matches = live.some((permissions) => shallowScopeEqual(asPlainObject(permissions), copy));
      return {
        membershipId: m.id,
        businessId: m.businessId,
        role: m.role,
        classification: matches ? ('copy_matches_live_jobrole' as const) : ('copy_diverged_from_live_jobrole' as const),
        detail: matches
          ? 'copied scopes still equal an active JobRole'
          : 'copied scopes match no active JobRole — the copy and the live role have diverged',
      };
    });
  }

  /**
   * Pages on a stable id cursor and stops on an EMPTY page.
   *
   * Not a short page. `defaultTakeExtension` can hand back fewer rows than `take` asked
   * for, and treating that as the end silently truncates the inventory — which is how
   * an authority report grows a blind spot the size of whatever the cap hid.
   */
  private async pageAll<T extends { id: string }>(
    fetch: (cursor: string | undefined) => Promise<T[]>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await fetch(cursor);
      if (page.length === 0) break;
      out.push(...page);
      cursor = page[page.length - 1].id;
    }
    return out;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function shallowScopeEqual(a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false;
  const ak = Object.keys(a).filter((k) => isAccessLevel(a[k]));
  const bk = Object.keys(b).filter((k) => isAccessLevel(b[k]));
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}
