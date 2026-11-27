/**
 * P148 / RR-JOB-TENANT-CONTEXT (D-261 / D-262 / D-17 / D-103) —
 * Real-Postgres proof that per-business background work runs inside a tenant
 * context (`runForTenant`) so the Prisma tenant isolation extension scopes
 * queries to the active business with NO user attribution.
 *
 * First adoption: `KeyCortexHomeostasisService.scheduledHomeostasis()`.
 *
 * Proves against real Postgres (`DATABASE_URL`) with the real `@keyflow/db`
 * tenant extension wired identically to `main.ts:68`:
 *   1. During `scheduledHomeostasis()`, inside `regulate(A)` / `regulate(B)`:
 *      - `getCurrentBusinessId()` equals the exact business being regulated
 *        (`A` when regulating `A`, `B` when regulating `B`).
 *      - `getCurrentUserId()` is `undefined` (no human attribution).
 *      - An UNSCOPED `prisma.client.keyActionProposal.findMany({ where: { id: { startsWith: P } } })`
 *        (no `businessId` in `where`) issued inside `regulate(A)` returns ONLY A's
 *        rows (0 of B's rows), and inside `regulate(B)` returns ONLY B's rows.
 *   2. Homeostasis readings and endocrine signals for business A during
 *      `scheduledHomeostasis()` match the direct `regulate(A)` baseline on the
 *      same seed (no behavioral drift).
 *   3. `KEY_DISABLED=1` (and `DISABLE_SCHEDULERS=1`) stops `scheduledHomeostasis()`
 *      BEFORE any database read (D-17).
 *   4. Ambient-context actor readers (`BookingsService.requestActor`,
 *      `BookingWaitlistService.offerActor`, `boundMemberOpensContacts`,
 *      `configuringMember`, `AccountingPeriodService.assertMayGate`) still answer
 *      SYSTEM / null / refuse-no-actor inside `runForTenant(A, ...)` as well as
 *      with no context.
 *
 * Fixture prefix: `v72p_` (registered in `apps/server/test/helpers/fixture-prefixes.json`).
 * Teardown uses raw SQL with `sqlLikePrefix(P)` ONLY (zero `.deleteMany(` on
 * soft-deleted models).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72p_';

const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  propA1: `${P}propA1`,
  propA2: `${P}propA2`,
  propB1: `${P}propB1`,
  propB2: `${P}propB2`,
};

const SWITCH_ENV_KEYS = [
  'KEY_DISABLED',
  'DISABLE_SCHEDULERS',
  'KF_DISABLE_SCHEDULERS',
  'ENABLE_SCHEDULERS_IN_TEST',
] as const;

let db: any;
let dbMod: typeof import('@keyflow/db');
let tenant: typeof import('../src/core/tenant/tenant-context');
let KeyCortexHomeostasisService: typeof import('../src/modules/key-cortex/key-cortex-homeostasis.service').KeyCortexHomeostasisService;
let BookingsService: typeof import('../src/modules/bookings/bookings.service').BookingsService;
let BookingWaitlistService: typeof import('../src/modules/bookings/booking-waitlist.service').BookingWaitlistService;
let boundMemberOpensContacts: typeof import('../src/modules/crm/crm-deals.service').boundMemberOpensContacts;
let configuringMember: typeof import('../src/modules/connect/google-contacts-sync.service').configuringMember;
let AccountingPeriodService: typeof import('../src/modules/finance/accounting-period.service').AccountingPeriodService;

let savedEnv: Record<string, string | undefined> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_action_proposals WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

beforeAll(async () => {
  dbMod = await import('@keyflow/db');
  db = dbMod.db;
  tenant = await import('../src/core/tenant/tenant-context');
  ({ KeyCortexHomeostasisService } = await import(
    '../src/modules/key-cortex/key-cortex-homeostasis.service'
  ));
  ({ BookingsService } = await import('../src/modules/bookings/bookings.service'));
  ({ BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service'));
  ({ boundMemberOpensContacts } = await import('../src/modules/crm/crm-deals.service'));
  ({ configuringMember } = await import('../src/modules/connect/google-contacts-sync.service'));
  ({ AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service'));

  // Wire the real tenant context provider identically to apps/server/src/main.ts:68.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  await cleanup();

  await db.user.create({
    data: {
      id: ID.owner,
      email: `${P}owner@example.test`,
      name: 'V72P Owner',
      role: 'USER',
    },
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V72P Biz A', slug: `${P}biza`, ownerId: ID.owner },
      { id: ID.bizB, name: 'V72P Biz B', slug: `${P}bizb`, ownerId: ID.owner },
    ],
  });

  // Seed KeyActionProposal rows in both A and B (KeyActionProposal is in BUSINESS_ID_MODELS).
  await db.keyActionProposal.createMany({
    data: [
      {
        id: ID.propA1,
        businessId: ID.bizA,
        sourceType: 'homeostasis_test',
        title: 'A Proposal 1',
        actionType: 'notify',
      },
      {
        id: ID.propA2,
        businessId: ID.bizA,
        sourceType: 'homeostasis_test',
        title: 'A Proposal 2',
        actionType: 'notify',
      },
      {
        id: ID.propB1,
        businessId: ID.bizB,
        sourceType: 'homeostasis_test',
        title: 'B Proposal 1',
        actionType: 'notify',
      },
      {
        id: ID.propB2,
        businessId: ID.bizB,
        sourceType: 'homeostasis_test',
        title: 'B Proposal 2',
        actionType: 'notify',
      },
    ],
  });

  // Seed AiExecutionLog rows for A (10 rows: 6 success / 4 fail -> 0.6 integrity; 3000ms -> 0.2 latency)
  // and B (10 rows: 10 success -> 1.0 integrity; 1000ms -> ~0.067 latency).
  const now = new Date();
  await db.aiExecutionLog.createMany({
    data: [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `${P}logA_${String(i).padStart(2, '0')}`,
        businessId: ID.bizA,
        action: 'v72p.probe',
        success: i < 6,
        durationMs: 3000,
        createdAt: now,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `${P}logB_${String(i).padStart(2, '0')}`,
        businessId: ID.bizB,
        action: 'v72p.probe',
        success: true,
        durationMs: 1000,
        createdAt: now,
      })),
    ],
  });
}, 60_000);

beforeEach(() => {
  savedEnv = Object.fromEntries(SWITCH_ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.KEY_DISABLED;
  delete process.env.DISABLE_SCHEDULERS;
  delete process.env.KF_DISABLE_SCHEDULERS;
  process.env.ENABLE_SCHEDULERS_IN_TEST = '1';
});

afterEach(() => {
  for (const k of SWITCH_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
}, 30_000);

describe('P148 (RR-JOB-TENANT-CONTEXT): KeyCortexHomeostasisService.scheduledHomeostasis on real Postgres', () => {
  it('wraps each regulated business in a tenant context so unscoped queries see ONLY that tenant and no user is attributed', async () => {
    const prisma = { client: db };
    const released: Array<{ businessId: string; signals: Array<Record<string, unknown>> }> = [];
    const endocrine = {
      release: vi.fn((businessId: string, signals: Array<Record<string, unknown>>) => {
        released.push({ businessId, signals });
      }),
    };

    type ProbeSnapshot = {
      ambientBusinessId: string | undefined;
      ambientUserId: string | undefined;
      unscopedProposalIds: string[];
      unscopedProposalBusinesses: string[];
      bookingsActor: { actorType: string; actorId?: string };
      dealsFilter: unknown;
      syncMember: string | null;
    };

    const probes = new Map<string, ProbeSnapshot>();
    const bookings = Object.create(BookingsService.prototype) as {
      requestActor: (businessId: string) => { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' };
    };

    const interoception = {
      senseBody: vi.fn(async (businessId: string) => {
        if (businessId !== ID.bizA && businessId !== ID.bizB) return null;

        // Deliberately UNSCOPED query (no businessId in `where`): the Prisma
        // tenant extension must filter this to the ambient tenant alone.
        const rows: Array<{ id: string; businessId: string }> = await db.keyActionProposal.findMany({
          where: { id: { startsWith: P } },
          select: { id: true, businessId: true },
          orderBy: { id: 'asc' },
        });

        const dealsFilter = await boundMemberOpensContacts(prisma as never, businessId, []);
        probes.set(businessId, {
          ambientBusinessId: tenant.getCurrentBusinessId(),
          ambientUserId: tenant.getCurrentUserId(),
          unscopedProposalIds: rows.map((r) => r.id),
          unscopedProposalBusinesses: [...new Set(rows.map((r) => r.businessId))],
          bookingsActor: bookings.requestActor(businessId),
          dealsFilter,
          syncMember: configuringMember(businessId),
        });

        return { totalCount: 4, integrity: 0.75 };
      }),
    };

    const svc = new KeyCortexHomeostasisService(
      prisma as never,
      endocrine as never,
      interoception as never,
    );

    await svc.scheduledHomeostasis();

    // Context must be cleared once the sweep completes.
    expect(tenant.getCurrentBusinessId()).toBeUndefined();
    expect(tenant.getCurrentUserId()).toBeUndefined();

    // Both seeded businesses were visited.
    expect(probes.has(ID.bizA)).toBe(true);
    expect(probes.has(ID.bizB)).toBe(true);

    // Business A saw ONLY A's ambient context and ONLY A's KeyActionProposal rows (0 of B's).
    expect(probes.get(ID.bizA)).toEqual({
      ambientBusinessId: ID.bizA,
      ambientUserId: undefined,
      unscopedProposalIds: [ID.propA1, ID.propA2],
      unscopedProposalBusinesses: [ID.bizA],
      bookingsActor: { actorType: 'SYSTEM' },
      dealsFilter: null,
      syncMember: null,
    });

    // Business B saw ONLY B's ambient context and ONLY B's KeyActionProposal rows (0 of A's).
    expect(probes.get(ID.bizB)).toEqual({
      ambientBusinessId: ID.bizB,
      ambientUserId: undefined,
      unscopedProposalIds: [ID.propB1, ID.propB2],
      unscopedProposalBusinesses: [ID.bizB],
      bookingsActor: { actorType: 'SYSTEM' },
      dealsFilter: null,
      syncMember: null,
    });
  });

  it('produces unchanged homeostasis readings and endocrine signals for business A vs direct regulate(A)', async () => {
    const prisma = { client: db };
    const directSignals: Array<Record<string, unknown>> = [];
    const scheduledSignals: Array<Record<string, unknown>> = [];

    const makeIntero = () => ({
      senseBody: vi.fn(async (businessId: string) =>
        businessId === ID.bizA ? { totalCount: 4, integrity: 0.75 } : null,
      ),
    });

    const directSvc = new KeyCortexHomeostasisService(
      prisma as never,
      {
        release: (businessId: string, signals: Array<Record<string, unknown>>) => {
          if (businessId === ID.bizA) directSignals.push(...signals);
        },
      } as never,
      makeIntero() as never,
    );

    const baselineReadings = await directSvc.regulate(ID.bizA);
    expect(baselineReadings.map((r) => ({ variable: r.variable, value: r.value }))).toEqual([
      { variable: 'executionIntegrity', value: 0.6 },
      { variable: 'responseLatency', value: 0.2 },
      { variable: 'bodyIntegrity', value: 0.75 },
    ]);
    expect(directSignals.map((s) => s.hormone)).toEqual(['humility', 'malaise']);

    const scheduledSvc = new KeyCortexHomeostasisService(
      prisma as never,
      {
        release: (businessId: string, signals: Array<Record<string, unknown>>) => {
          if (businessId === ID.bizA) scheduledSignals.push(...signals);
        },
      } as never,
      makeIntero() as never,
    );

    await scheduledSvc.scheduledHomeostasis();
    expect(scheduledSignals).toEqual(directSignals);
  });

  it('KEY_DISABLED=1 stops scheduledHomeostasis before ANY database read (D-17)', async () => {
    process.env.KEY_DISABLED = '1';

    const dbReadSpy = vi.fn(() => {
      throw new Error('DB read must not happen when KEY_DISABLED=1');
    });
    const trappedPrisma = {
      client: {
        business: { findMany: dbReadSpy },
        aiExecutionLog: { findMany: dbReadSpy },
      },
    };
    const endocrine = { release: vi.fn() };
    const interoception = { senseBody: vi.fn() };

    const svc = new KeyCortexHomeostasisService(
      trappedPrisma as never,
      endocrine as never,
      interoception as never,
    );

    await svc.scheduledHomeostasis();

    expect(dbReadSpy).not.toHaveBeenCalled();
    expect(endocrine.release).not.toHaveBeenCalled();
    expect(interoception.senseBody).not.toHaveBeenCalled();
  });

  it('ambient-context readers stay SYSTEM / null / refuse-no-actor under runForTenant(A, ...)', async () => {
    const prisma = { client: db };
    const bookings = Object.create(BookingsService.prototype) as {
      requestActor: (businessId: string) => { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' };
    };
    const waitlist = Object.create(BookingWaitlistService.prototype) as {
      offerActor: (
        businessId: string,
        actorType: 'SYSTEM' | 'USER',
      ) => { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' };
    };
    const periodSvc = Object.assign(Object.create(AccountingPeriodService.prototype), { prisma }) as {
      assertMayGate: (
        businessId: string,
        explicitActorId: string | undefined,
        verb: 'close' | 'reopen' | 'update' | 'delete',
      ) => Promise<string>;
    };

    // Baseline: no context
    expect(bookings.requestActor(ID.bizA)).toEqual({ actorType: 'SYSTEM' });
    expect(waitlist.offerActor(ID.bizA, 'USER')).toEqual({ actorType: 'SYSTEM' });
    await expect(boundMemberOpensContacts(prisma as never, ID.bizA, [])).resolves.toBeNull();
    expect(configuringMember(ID.bizA)).toBeNull();
    await expect(periodSvc.assertMayGate(ID.bizA, undefined, 'close')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // Inside runForTenant(ID.bizA, ...): tenant extension IS active, yet NO user is attributed.
    await tenant.runForTenant(ID.bizA, async () => {
      expect(tenant.getCurrentBusinessId()).toBe(ID.bizA);
      expect(tenant.getCurrentUserId()).toBeUndefined();

      const unscoped = await db.keyActionProposal.findMany({
        where: { id: { startsWith: P } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      expect(unscoped.map((r: { id: string }) => r.id)).toEqual([ID.propA1, ID.propA2]);

      expect(bookings.requestActor(ID.bizA)).toEqual({ actorType: 'SYSTEM' });
      expect(waitlist.offerActor(ID.bizA, 'USER')).toEqual({ actorType: 'SYSTEM' });
      await expect(boundMemberOpensContacts(prisma as never, ID.bizA, [])).resolves.toBeNull();
      expect(configuringMember(ID.bizA)).toBeNull();
      await expect(periodSvc.assertMayGate(ID.bizA, undefined, 'close')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
