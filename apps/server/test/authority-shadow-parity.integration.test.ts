/**
 * RR-AUTHORITY-SHADOW-PARITY (V1-72): real-Postgres parity matrix between the
 * legacy ModuleScopeGuard calculation (`memberModuleLevel` + `LEVEL_RANK`) and
 * `EffectiveAuthorityResolver` over every role x canonical module x minLevel
 * for every base-envelope shape, plus position & grant narrowing invariants
 * (`resolver <= legacy`, never above) and shadow mismatch signal counting.
 *
 * Fixtures: prefix `v72r_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (`sqlLikePrefix`) in dependency order in beforeAll
 * and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Reflector } from '@nestjs/core';
import { sqlLikePrefix } from './helpers/sql-like.js';
import {
  CANONICAL_MODULES,
  LEVEL_RANK,
  memberModuleLevel,
  rankOf,
  type CanonicalModule,
} from '../src/core/authority/module-vocabulary';
import { EffectiveAuthorityResolver } from '../src/core/authority/effective-authority.resolver';
import {
  ModuleScopeGuard,
  RequireModuleScope,
  ShadowEffectiveAuthority,
} from '../src/core/auth/module-scope.guard';
import { securitySignals } from '../src/core/observability/security-signals';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72r_';
const BIZ = `${P}biz`;
const OWNER_USER = `${P}owner`;

const ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const;
const MIN_LEVELS = ['read', 'write', 'admin'] as const;

type EnvelopeShape = {
  name: string;
  permissionScopes: unknown;
};

const ALL_NONE_MAP: Record<string, string> = Object.fromEntries(
  CANONICAL_MODULES.map((m) => [m, 'none']),
);

const MIXED_EXPLICIT_MAP: Record<string, string> = {
  crm: 'admin',
  revenue: 'write',
  bookings: 'read',
  expenses: 'none',
  operations: 'write',
  settings: 'read',
  ai: 'admin',
  team: 'read',
  analytics: 'write',
  content: 'read',
  projects: 'write',
  automations: 'read',
  inventory: 'write',
  reports: 'read',
  commerce: 'write',
  connect: 'read',
};

const SHAPES: readonly EnvelopeShape[] = [
  { name: 'no_scope_map', permissionScopes: null },
  { name: 'explicit_map', permissionScopes: MIXED_EXPLICIT_MAP },
  { name: 'explicit_none', permissionScopes: ALL_NONE_MAP },
  { name: 'missing_key', permissionScopes: { crm: 'write', bookings: 'read', operations: 'admin' } },
  { name: 'empty_array_map', permissionScopes: [] },
  { name: 'nonempty_array_map', permissionScopes: ['crm', 'operations'] },
];

let db: any;
let resolver: EffectiveAuthorityResolver;
let prismaWrapper: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM authority_grants WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_assignments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM job_roles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

class ShadowedRevenueWrite {
  @RequireModuleScope('revenue', 'write')
  @ShadowEffectiveAuthority()
  handler() {}
}

function makeCtx(userId: string, handler: () => void) {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: userId, role: 'USER' },
        params: { businessId: BIZ },
      }),
    }),
  } as any;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  prismaWrapper = { client: db };
  resolver = new EffectiveAuthorityResolver(prismaWrapper);

  await cleanup();

  await db.user.create({
    data: { id: OWNER_USER, email: `${P}owner@test.local`, role: 'USER' },
  });
  await db.business.create({
    data: { id: BIZ, name: 'V72R Authority Parity Biz', ownerId: OWNER_USER, currency: 'TTD' },
  });
  await db.membership.create({
    data: { id: `${P}mem_owner`, userId: OWNER_USER, businessId: BIZ, role: 'OWNER' },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('RR-AUTHORITY-SHADOW-PARITY: base-envelope parity matrix on Postgres (v72r_)', () => {
  it('agrees 100% across every role x base-envelope shape x canonical module x minLevel (864 cells)', async () => {
    const disagreements: string[] = [];
    let checkedCells = 0;

    for (const role of ROLES) {
      for (const shape of SHAPES) {
        const key = `${role.toLowerCase()}_${shape.name}`;
        const userId = `${P}u_${key}`;
        const memId = `${P}m_${key}`;

        await db.user.create({
          data: { id: userId, email: `${P}${key}@test.local`, role: 'USER' },
        });
        const membership = await db.membership.create({
          data: {
            id: memId,
            userId,
            businessId: BIZ,
            role,
            permissionScopes: shape.permissionScopes as any,
          },
        });

        const resolved = await resolver.resolve(BIZ, userId);
        expect(resolved.validity.truncated, `${key} must not truncate`).toBe(false);

        for (const mod of CANONICAL_MODULES) {
          const legacyLevel = memberModuleLevel(membership, mod);
          const legacyRank = rankOf(legacyLevel);
          const resolverDecision = resolved.modules[mod];
          const resolverRank = LEVEL_RANK[resolverDecision.level];

          if (resolverDecision.level !== legacyLevel) {
            disagreements.push(
              `LEVEL ${role}/${shape.name}/${mod}: legacy=${legacyLevel} resolver=${resolverDecision.level} (${resolverDecision.reason})`,
            );
          }

          for (const minLevel of MIN_LEVELS) {
            checkedCells++;
            const requiredRank = LEVEL_RANK[minLevel];
            const legacyAllows = legacyRank >= requiredRank;
            const resolverAllows = resolverRank >= requiredRank;
            if (resolverAllows !== legacyAllows) {
              disagreements.push(
                `DECISION ${role}/${shape.name}/${mod}/${minLevel}: legacy=${legacyAllows}(${legacyLevel}) resolver=${resolverAllows}(${resolverDecision.level})`,
              );
            }
          }
        }
      }
    }

    expect(checkedCells).toBe(ROLES.length * SHAPES.length * CANONICAL_MODULES.length * MIN_LEVELS.length);
    expect(disagreements).toEqual([]);
  });
});

describe('RR-AUTHORITY-SHADOW-PARITY: positions and grants narrow inside envelope, never widen (v72r_)', () => {
  it('resolver <= legacy across all canonical modules with active positions and active/expired/revoked grants, and shadow mismatch counter records the narrowing', async () => {
    const userId = `${P}u_narrowed`;
    const memId = `${P}m_narrowed`;
    const unitId = `${P}unit_1`;
    const roleId = `${P}jrole_1`;
    const assignId = `${P}assign_1`;

    await db.user.create({
      data: { id: userId, email: `${P}narrowed@test.local`, role: 'USER' },
    });
    const membership = await db.membership.create({
      data: {
        id: memId,
        userId,
        businessId: BIZ,
        role: 'STAFF',
        permissionScopes: {
          revenue: 'write',
          crm: 'write',
          bookings: 'write',
          settings: 'none',
          operations: 'read',
        },
        maxApprovalTier: 2,
      },
    });

    await db.orgUnit.create({
      data: { id: unitId, businessId: BIZ, name: 'V72R Sales Ops', type: 'DEPARTMENT' },
    });

    // JobRole narrows revenue from write -> read, keeps crm at write, and attempts
    // to grant settings: admin (outside the Membership envelope, so resolver MUST cap to none).
    await db.jobRole.create({
      data: {
        id: roleId,
        businessId: BIZ,
        name: 'V72R Junior Clerk',
        permissions: {
          revenue: 'read',
          crm: 'write',
          settings: 'admin',
          expenses: 'admin',
        },
        defaultApprovalTier: 3,
      },
    });

    await db.orgAssignment.create({
      data: {
        id: assignId,
        businessId: BIZ,
        membershipId: memId,
        userId,
        orgUnitId: unitId,
        jobRoleId: roleId,
        isPrimary: true,
      },
    });

    const now = Date.now();
    await db.authorityGrant.createMany({
      data: [
        {
          id: `${P}grant_active`,
          businessId: BIZ,
          grantorId: `${P}mem_owner`,
          granteeType: 'USER',
          granteeId: userId,
          scope: 'tier4_operations',
          validFrom: new Date(now - 60_000),
          validUntil: new Date(now + 3_600_000),
        },
        {
          id: `${P}grant_expired`,
          businessId: BIZ,
          grantorId: `${P}mem_owner`,
          granteeType: 'USER',
          granteeId: userId,
          scope: 'tier4_financial',
          validFrom: new Date(now - 7_200_000),
          validUntil: new Date(now - 60_000),
        },
        {
          id: `${P}grant_revoked`,
          businessId: BIZ,
          grantorId: `${P}mem_owner`,
          granteeType: 'USER',
          granteeId: userId,
          scope: 'tier4_hiring',
          validFrom: new Date(now - 3_600_000),
          validUntil: new Date(now + 3_600_000),
          revokedAt: new Date(now - 10_000),
        },
      ],
    });

    const resolved = await resolver.resolve(BIZ, userId);
    expect(resolved.validity.truncated).toBe(false);

    // Fundamental law: with positions and grants present, resolver is NEVER above legacy.
    for (const mod of CANONICAL_MODULES) {
      const legacyRank = rankOf(memberModuleLevel(membership, mod));
      const resolverRank = LEVEL_RANK[resolved.modules[mod].level];
      expect(
        resolverRank,
        `${mod}: resolver=${resolved.modules[mod].level} must never exceed legacy=${memberModuleLevel(membership, mod)}`,
      ).toBeLessThanOrEqual(legacyRank);
    }

    // Specific expected narrowing & cap outcomes:
    expect(resolved.modules.revenue.level).toBe('read'); // narrowed from write -> read
    expect(resolved.modules.crm.level).toBe('write'); // kept inside envelope
    expect(resolved.modules.settings.level).toBe('none'); // JobRole admin capped to explicit none
    expect(resolved.modules.expenses.level).toBe('none'); // JobRole admin capped to denied_by_absence
    expect(resolved.tier4Scopes).toEqual(['tier4_operations']); // expired & revoked excluded

    // Live ModuleScopeGuard shadow evaluation over real Postgres:
    // Legacy ALLOWS revenue:write, resolver narrows to read -> DENY => legacy wins + signal counted!
    securitySignals.reset();
    const guard = new ModuleScopeGuard(prismaWrapper, new Reflector(), resolver);
    (guard as any).logger = { warn: () => undefined, debug: () => undefined, error: () => undefined };

    const allowed = await guard.canActivate(makeCtx(userId, ShadowedRevenueWrite.prototype.handler));
    expect(allowed).toBe(true); // legacy answer stays authoritative

    const snap = securitySignals.snapshot();
    expect(snap.counts.authority_shadow_mismatch).toBe(1);
    const labelKey = `revenue:${resolved.modules.revenue.reason}`;
    expect(snap.byLabel.authority_shadow_mismatch[labelKey]).toBe(1);

    // Zero tenant or user IDs leak into SecuritySignals snapshot
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain(BIZ);
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain(memId);
  });
});
