import { describe, expect, it } from 'vitest';
import { EffectiveAuthorityResolver } from './effective-authority.resolver';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Precedence proofs for the resolver core.
 *
 * The chain under test, as resolved by CG-REVIEW-AUTH-PRECEDENCE-001:
 *
 *   explicit deny  >  assignment allow  >  grant allow  >  base role/default allow
 *
 * over one law: a position or grant may SELECT or NARROW authority inside the
 * Membership envelope and may never create authority the Membership does not grant.
 */

const NOW_ISH = () => new Date();

interface Fixture {
  user?: { id: string; role: string | null } | null;
  membership?: { id: string; role: string; permissionScopes: unknown; maxApprovalTier: number } | null;
  assignments?: any[];
  grants?: any[];
  grantorMemberships?: { id: string }[];
  delegations?: any[];
}

/**
 * A fake that honours the predicates the resolver relies on for freshness, rather than
 * returning whatever it was seeded with. A fake that ignores `revokedAt` would pass the
 * expiry tests while proving nothing — the filtering IS the behaviour under test.
 */
function fakePrisma(f: Fixture): PrismaService {
  const matchesValidity = (row: any, now: Date) => {
    if (row.revokedAt) return false;
    if (row.validFrom && row.validFrom > now) return false;
    if (row.validUntil && row.validUntil < now) return false;
    return true;
  };
  const matchesDelegation = (row: any, now: Date) => {
    if (row.isActive === false) return false;
    if (row.activeFrom && row.activeFrom > now) return false;
    if (row.activeUntil && row.activeUntil < now) return false;
    return true;
  };

  return {
    client: {
      user: { findUnique: async ({ where }: any) => (f.user && f.user.id === where.id ? f.user : null) },
      membership: {
        findUnique: async ({ where }: any) => {
          const key = where.userId_businessId;
          if (!key || !f.membership) return null;
          return key.businessId === 'biz_1' ? f.membership : null;
        },
        findMany: async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? [];
          return (f.grantorMemberships ?? []).filter((m) => ids.includes(m.id));
        },
      },
      orgAssignment: {
        findMany: async ({ where }: any) =>
          (f.assignments ?? []).filter(
            (a) => a.membershipId === where.membershipId && a.endedAt === null,
          ),
      },
      authorityGrant: {
        findMany: async ({ where }: any) => {
          const now: Date = where.validFrom.lte;
          return (f.grants ?? []).filter(
            (g) => g.granteeType === 'USER' && g.granteeId === where.granteeId && matchesValidity(g, now),
          );
        },
      },
      delegationRule: {
        findMany: async ({ where }: any) => {
          const now: Date = where.activeFrom.lte;
          const ids: string[] = where.delegateId.in;
          return (f.delegations ?? []).filter((d) => ids.includes(d.delegateId) && matchesDelegation(d, now));
        },
      },
    },
  } as unknown as PrismaService;
}

const resolverFor = (f: Fixture) => new EffectiveAuthorityResolver(fakePrisma(f));

const OWNER_NO_MAP = { id: 'mem_1', role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 };
const USER = { id: 'user_1', role: 'USER' };

function position(over: Partial<{ id: string; permissions: unknown; tier: number }> = {}) {
  return {
    id: over.id ?? 'asg_1',
    membershipId: 'mem_1',
    endedAt: null,
    jobRoleId: 'jr_1',
    jobRole: {
      id: 'jr_1',
      name: 'Position',
      permissions: over.permissions ?? null,
      defaultApprovalTier: over.tier ?? 0,
    },
  };
}

describe('EffectiveAuthorityResolver — relationship', () => {
  it('denies every module when there is no Membership in this Business', async () => {
    const r = await resolverFor({ user: USER, membership: OWNER_NO_MAP }).resolve('biz_OTHER', 'user_1');
    expect(r.relationship.basis).toBe('none');
    expect(r.modules.crm.level).toBe('none');
    expect(r.modules.operations.level).toBe('none');
    expect(r.approvalTier.effective).toBe(0);
  });

  it('records SUPER_ADMIN as an explicit traced source rather than a silent bypass', async () => {
    const r = await resolverFor({
      user: { id: 'user_1', role: 'SUPER_ADMIN' },
      membership: null,
    }).resolve('biz_1', 'user_1');

    expect(r.relationship.basis).toBe('super_admin');
    expect(r.modules.crm.level).toBe('admin');
    expect(r.modules.crm.sources.map((s) => s.kind)).toContain('super_admin');
    expect(r.provenance.join(' ')).toMatch(/SUPER_ADMIN/);
  });
});

describe('EffectiveAuthorityResolver — base envelope', () => {
  it('uses role defaults when there is no explicit scope map', async () => {
    const r = await resolverFor({ user: USER, membership: OWNER_NO_MAP }).resolve('biz_1', 'user_1');
    expect(r.modules.operations.level).toBe('admin');
    expect(r.modules.operations.reason).toBe('role_default');
    expect(r.modules.connect.level).toBe('none'); // connect is never role-granted
  });

  it('treats an explicit none as an EXPLICIT DENY, distinct from an absent key', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, permissionScopes: { crm: 'none', revenue: 'admin' } },
    }).resolve('biz_1', 'user_1');

    expect(r.modules.crm.level).toBe('none');
    expect(r.modules.crm.explicitDeny).toBe(true);
    expect(r.modules.crm.reason).toBe('explicit_deny');

    // Absent from the same map. Also denied — legacy behaviour is preserved — but it
    // is a GAP, not a decision, and the two must stay distinguishable (CG-REVIEW C2).
    expect(r.modules.bookings.level).toBe('none');
    expect(r.modules.bookings.explicitDeny).toBe(false);
    expect(r.modules.bookings.reason).toBe('denied_by_absence');
  });

  it('does not role-default a missing key inside an explicit map', async () => {
    // Doing so would WIDEN authority relative to the live guard, which computes
    // `scopes[module] || 'none'`. An OWNER with an explicit map gets nothing back.
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, permissionScopes: { crm: 'admin' } },
    }).resolve('biz_1', 'user_1');
    expect(r.modules.revenue.level).toBe('none');
  });

  it('denies an unrecognised level exactly as the guard does', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, permissionScopes: { crm: 'superuser' } },
    }).resolve('biz_1', 'user_1');
    expect(r.modules.crm.level).toBe('none');
    expect(r.modules.crm.explicitDeny).toBe(true);
  });
});

describe('EffectiveAuthorityResolver — positions', () => {
  it('lets a position narrow a module inside the Membership envelope', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP, // OWNER => crm admin
      assignments: [position({ permissions: { crm: 'read' } })],
    }).resolve('biz_1', 'user_1');

    expect(r.modules.crm.level).toBe('read');
    expect(r.modules.crm.reason).toBe('position_narrowed');
  });

  it('never lets a position exceed the Membership envelope', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, role: 'STAFF', permissionScopes: { crm: 'read' } },
      assignments: [position({ permissions: { crm: 'admin' } })],
    }).resolve('biz_1', 'user_1');

    expect(r.modules.crm.level).toBe('read');
    expect(r.modules.crm.reason).toBe('position_capped_at_membership');
    expect(r.modules.crm.sources.some((s) => s.kind === 'position' && /capped/.test(s.detail))).toBe(true);
  });

  it('cannot cancel an explicit deny', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, permissionScopes: { crm: 'none' } },
      assignments: [position({ permissions: { crm: 'admin' } })],
    }).resolve('biz_1', 'user_1');

    expect(r.modules.crm.level).toBe('none');
    expect(r.modules.crm.explicitDeny).toBe(true);
    expect(r.modules.crm.sources.some((s) => s.kind === 'position' && /explicit deny/.test(s.detail))).toBe(true);
  });

  it('composes multiple positions by strongest, then caps — no accidental escalation', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, permissionScopes: { crm: 'write', revenue: 'read' } },
      assignments: [
        position({ id: 'asg_1', permissions: { crm: 'read', revenue: 'admin' } }),
        position({ id: 'asg_2', permissions: { crm: 'write' } }),
      ],
    }).resolve('biz_1', 'user_1');

    // crm: strongest position is write, envelope is write -> write.
    expect(r.modules.crm.level).toBe('write');
    // revenue: a position asks for admin, the envelope only has read -> read.
    expect(r.modules.revenue.level).toBe('read');
    expect(r.positions).toHaveLength(2);
  });

  it('records non-canonical JobRole keys as provenance and grants nothing from them', async () => {
    // MODULE_TOOL_FAMILIES uses `finance`, `hr`, `legal`... Aliasing those onto module
    // keys is prohibited scope, and silently dropping them would hide the divergence.
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      assignments: [position({ permissions: { finance: 'admin', hr: 'admin', crm: 'read' } })],
    }).resolve('biz_1', 'user_1');

    expect(r.positions[0].unmatchedKeys.sort()).toEqual(['finance', 'hr']);
    expect(r.positions[0].matchedModules).toEqual({ crm: 'read' });
    expect(r.modules.revenue.level).toBe('admin'); // untouched by `finance`
  });

  it('ignores an ended assignment on the next decision', async () => {
    const ended = { ...position({ permissions: { crm: 'read' } }), endedAt: new Date('2020-01-01') };
    const r = await resolverFor({ user: USER, membership: OWNER_NO_MAP, assignments: [ended] }).resolve('biz_1', 'user_1');
    expect(r.positions).toHaveLength(0);
    expect(r.modules.crm.level).toBe('admin'); // not narrowed by a position that ended
  });
});

describe('EffectiveAuthorityResolver — grants', () => {
  const grant = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'grant_1',
    granteeType: 'USER',
    granteeId: 'user_1',
    scope: 'tier4_financial',
    maxAmount: null,
    grantorId: 'mem_grantor',
    validFrom: new Date('2020-01-01'),
    validUntil: null,
    revokedAt: null,
    ...over,
  });

  it('carries an active grant on the tier4 axis, never onto a module key', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      grants: [grant()],
      grantorMemberships: [{ id: 'mem_grantor' }],
    }).resolve('biz_1', 'user_1');

    expect(r.tier4Scopes).toEqual(['tier4_financial']);
    // tier4_operations is NOT the `operations` module; nothing aliases across.
    expect(r.grants[0].grantorStatus).toBe('active');
  });

  it('drops a revoked grant at the resolver read', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      grants: [grant({ revokedAt: new Date('2021-01-01') })],
      grantorMemberships: [{ id: 'mem_grantor' }],
    }).resolve('biz_1', 'user_1');
    expect(r.grants).toHaveLength(0);
    expect(r.tier4Scopes).toEqual([]);
  });

  it('drops an expired grant at the resolver read', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      grants: [grant({ validUntil: new Date('2021-01-01') })],
      grantorMemberships: [{ id: 'mem_grantor' }],
    }).resolve('biz_1', 'user_1');
    expect(r.grants).toHaveLength(0);
  });

  it('drops a not-yet-valid grant at the resolver read', async () => {
    const future = new Date(NOW_ISH().getTime() + 86_400_000);
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      grants: [grant({ validFrom: future })],
      grantorMemberships: [{ id: 'mem_grantor' }],
    }).resolve('biz_1', 'user_1');
    expect(r.grants).toHaveLength(0);
  });

  it('contributes nothing when the grantor does not resolve to a Membership here', async () => {
    // CG-REVIEW C3: legacy_unresolvable_grantor. Reported, never guessed, never repaired.
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      grants: [grant({ grantorId: 'some-user-id-or-system' })],
      grantorMemberships: [],
    }).resolve('biz_1', 'user_1');

    expect(r.grants[0].grantorStatus).toBe('legacy_unresolvable');
    expect(r.tier4Scopes).toEqual([]);
    expect(r.provenance.join(' ')).toMatch(/legacy_unresolvable_grantor/);
  });
});

describe('EffectiveAuthorityResolver — delegations', () => {
  const rule = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'rule_1',
    scope: 'ALL',
    maxTier: 4,
    delegateId: 'asg_1',
    isActive: true,
    activeFrom: new Date('2020-01-01'),
    activeUntil: null,
    ...over,
  });

  it('caps a delegation at the Membership approval tier', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, role: 'ADMIN', permissionScopes: {}, maxApprovalTier: 2 },
      assignments: [position()],
      delegations: [rule({ maxTier: 4 })],
    }).resolve('biz_1', 'user_1');

    expect(r.delegations[0].maxTier).toBe(4);
    expect(r.delegations[0].cappedTier).toBe(2);
    expect(r.approvalTier.delegationTierCapped).toBe(2);
  });

  it('rejects an expired delegation', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      assignments: [position()],
      delegations: [rule({ activeUntil: new Date('2021-01-01') })],
    }).resolve('biz_1', 'user_1');
    expect(r.delegations).toHaveLength(0);
  });

  it('rejects an inactive delegation inside its window', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      assignments: [position()],
      delegations: [rule({ isActive: false })],
    }).resolve('biz_1', 'user_1');
    expect(r.delegations).toHaveLength(0);
  });
});

describe('EffectiveAuthorityResolver — approval tier stays distinct from execution permission', () => {
  it('keeps a high approval tier while every module is denied', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { id: 'mem_1', role: 'OWNER', permissionScopes: {}, maxApprovalTier: 4 },
    }).resolve('biz_1', 'user_1');

    expect(r.approvalTier.effective).toBe(4);
    expect(r.modules.crm.level).toBe('none'); // empty explicit map denies everything
  });

  it('does not let a position raise the Membership approval tier', async () => {
    const r = await resolverFor({
      user: USER,
      membership: { id: 'mem_1', role: 'STAFF', permissionScopes: {}, maxApprovalTier: 1 },
      assignments: [position({ tier: 4 })],
    }).resolve('biz_1', 'user_1');

    expect(r.approvalTier.effective).toBe(1);
    expect(r.approvalTier.positionTierCapped).toBe(1);
  });

  it('surfaces tier_zero_ambiguity instead of silently reversing a deliberate zero', async () => {
    // maxApprovalTier is Int @default(0) NOT NULL, so 0-with-no-map is indistinguishable
    // from unset. The frozen rule returns the role default; the flag records that it did.
    const r = await resolverFor({ user: USER, membership: OWNER_NO_MAP }).resolve('biz_1', 'user_1');
    expect(r.approvalTier.effective).toBe(4);
    expect(r.approvalTier.tierZeroAmbiguity).toBe(true);
    expect(r.provenance.join(' ')).toMatch(/tier_zero_ambiguity/);
  });
});

describe('EffectiveAuthorityResult — explainability', () => {
  it('names a source for every module decision', async () => {
    const r = await resolverFor({
      user: USER,
      membership: OWNER_NO_MAP,
      assignments: [position({ permissions: { crm: 'read' } })],
    }).resolve('biz_1', 'user_1');

    for (const decision of Object.values(r.modules)) {
      expect(decision.sources.length).toBeGreaterThan(0);
      expect(decision.reason).toBeTruthy();
    }
    expect(r.provenance.length).toBeGreaterThan(0);
  });

  it('flags that Membership freshness cannot be proven across the admission boundary', async () => {
    // Transferred to KF-EXEC-ACTION-001. Kept on every result so the gap is visible at
    // the point of use, not only in a control message nobody reads at 3am.
    const r = await resolverFor({ user: USER, membership: OWNER_NO_MAP }).resolve('biz_1', 'user_1');
    expect(r.validity.membershipFreshnessUnprovable).toBe(true);
    expect(r.validity.truncated).toBe(false);
  });
});

describe('EffectiveAuthorityResolver — never laxer than the live guard', () => {
  it('treats an array permissionScopes as an explicit map, exactly as the guard does', async () => {
    // permissionScopes is a Json column, so this is storable. The guard's
    // `typeof === 'object'` is true for an array and every key lookup misses, so it
    // denies. Falling back to role defaults here would ALLOW where the guard DENIES.
    const r = await resolverFor({
      user: USER,
      membership: { ...OWNER_NO_MAP, permissionScopes: ['crm', 'revenue'] },
    }).resolve('biz_1', 'user_1');

    expect(r.relationship.hasExplicitScopeMap).toBe(true);
    expect(r.modules.crm.level).toBe('none');
    expect(r.modules.crm.reason).toBe('denied_by_absence');
  });

  it('falls back to role defaults only when permissionScopes is genuinely absent', async () => {
    for (const scopes of [null, undefined]) {
      const r = await resolverFor({
        user: USER,
        membership: { ...OWNER_NO_MAP, permissionScopes: scopes },
      }).resolve('biz_1', 'user_1');
      expect(r.modules.crm.level).toBe('admin');
    }
  });
});
