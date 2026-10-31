import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ChartOfAccountsSeederService, SYSTEM_COA } from './chart-of-accounts-seeder.service';

/**
 * Unit tests for `ChartOfAccountsSeederService` covering:
 *   - Idempotent re-runs of `ensureDefaults()` (no duplicate writes).
 *   - Stable ExpenseCategory -> COA linking, including pattern matching
 *     and the EXPENSE_GENERAL fallback.
 *   - R0-D1-COA-SEED-RACE: concurrent first-run seeding of one business is
 *     serialized per business, and a P2002 from the (businessId, systemKey)
 *     unique index is absorbed as "already seeded" (re-read), never thrown.
 *
 * Uses a hand-rolled in-memory Prisma stub so the test is hermetic.
 */

type StubOpts = {
  /**
   * Emulate Prisma's non-native upsert on the (businessId, systemKey) unique
   * index: SELECT, yield to the event loop, then INSERT — and raise P2002 when
   * another caller inserted the same key in that gap. This is exactly the race
   * the real database produces when two `ensureDefaults()` runs interleave
   * (journey harness D1, reproduced 3/3 on the unmodified code).
   */
  raceUniqueIndex?: boolean;
  /**
   * systemKeys whose first upsert loses to a writer in ANOTHER process: that
   * writer's row lands before our INSERT, so the upsert raises P2002 and the
   * row is present for a re-read.
   */
  foreignInsertOn?: string[];
  /** The first upsert throws this (non-P2002) error once — a transient fault. */
  failOnceWith?: Error;
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`business_id`,`system_key`)',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['business_id', 'system_key'] } },
  );
}

function makeStub(
  seedExpenseCategories: Array<{ id: string; name: string; chartOfAccountId?: string | null }> = [],
  opts: StubOpts = {},
) {
  const coa = new Map<string, { id: string; businessId: string; systemKey: string | null; name: string; type: string; parentId: string | null }>();
  const expenseCategories = new Map(
    seedExpenseCategories.map((c) => [c.id, { ...c, businessId: 'biz_1', chartOfAccountId: c.chartOfAccountId ?? null }]),
  );
  let seq = 0;
  let p2002Thrown = 0;
  let transientThrown = false;
  const foreignDone = new Set<string>();

  const findByKey = (businessId: string, systemKey: string) => {
    for (const r of coa.values()) if (r.businessId === businessId && r.systemKey === systemKey) return r;
    return null;
  };
  const insert = (create: any) => {
    seq += 1;
    const row = {
      id: `coa_${seq}`,
      businessId: create.businessId,
      systemKey: create.systemKey,
      name: create.name,
      type: create.type,
      parentId: null,
    };
    coa.set(row.id, row);
    return row;
  };

  const client = {
    chartOfAccount: {
      findMany: vi.fn(async (args: any) => {
        const rows = Array.from(coa.values()).filter(
          (r) => r.businessId === args.where.businessId && (!args.where.systemKey?.in || args.where.systemKey.in.includes(r.systemKey)),
        );
        return rows.map((r) => ({ id: r.id, systemKey: r.systemKey, name: r.name, type: r.type, parentId: r.parentId }));
      }),
      findUnique: vi.fn(async (args: any) => {
        if (args.where.id) return coa.get(args.where.id) ?? null;
        const k = args.where.businessId_systemKey;
        if (k) {
          for (const r of coa.values()) if (r.businessId === k.businessId && r.systemKey === k.systemKey) return r;
        }
        return null;
      }),
      upsert: vi.fn(async (args: any) => {
        const k = args.where.businessId_systemKey;
        if (opts.failOnceWith && !transientThrown) {
          transientThrown = true;
          throw opts.failOnceWith;
        }
        const existing = findByKey(k.businessId, k.systemKey);
        if (existing) return existing;
        if (opts.foreignInsertOn?.includes(k.systemKey) && !foreignDone.has(k.systemKey)) {
          // Another process won the INSERT between our SELECT and INSERT.
          foreignDone.add(k.systemKey);
          insert(args.create);
          p2002Thrown += 1;
          throw uniqueViolation();
        }
        if (opts.raceUniqueIndex) {
          // Prisma's non-native upsert: SELECT ... then INSERT, with the event
          // loop free in between for a concurrent run to land the same key.
          await new Promise((r) => setImmediate(r));
          if (findByKey(k.businessId, k.systemKey)) {
            p2002Thrown += 1;
            throw uniqueViolation();
          }
        }
        return insert(args.create);
      }),
      update: vi.fn(async (args: any) => {
        const row = coa.get(args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
    expenseCategory: {
      findMany: vi.fn(async (args: any) => {
        return Array.from(expenseCategories.values()).filter(
          (c) => c.businessId === args.where.businessId && (args.where.chartOfAccountId === null ? c.chartOfAccountId === null : true),
        );
      }),
      update: vi.fn(async (args: any) => {
        const row = expenseCategories.get(args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
  };

  return { prisma: { client } as any, state: { coa, expenseCategories, get callCount() {
    return (client.chartOfAccount.upsert as any).mock.calls.length;
  }, get p2002Thrown() {
    return p2002Thrown;
  }, get findManyCalls() {
    return (client.chartOfAccount.findMany as any).mock.calls.length;
  } } };
}

/** systemKey -> row for a business, from the stub's in-memory table. */
function rowsOf(stub: ReturnType<typeof makeStub>, businessId: string) {
  return new Map(
    Array.from(stub.state.coa.values())
      .filter((r) => r.businessId === businessId)
      .map((r) => [r.systemKey, r] as const),
  );
}

describe('ChartOfAccountsSeederService.ensureDefaults', () => {
  it('seeds the full system COA on first run', async () => {
    const stub = makeStub();
    const svc = new ChartOfAccountsSeederService(stub.prisma);
    await svc.ensureDefaults('biz_1');
    expect(stub.state.coa.size).toBe(SYSTEM_COA.length);
    // Every system key represented exactly once.
    const keys = new Set(Array.from(stub.state.coa.values()).map((r) => r.systemKey));
    for (const seed of SYSTEM_COA) expect(keys.has(seed.systemKey)).toBe(true);
  });

  it('is idempotent — second run writes no new rows', async () => {
    const stub = makeStub();
    const svc = new ChartOfAccountsSeederService(stub.prisma);
    await svc.ensureDefaults('biz_1');
    const sizeAfterFirst = stub.state.coa.size;
    const upsertCallsAfterFirst = stub.state.callCount;

    await svc.ensureDefaults('biz_1');
    expect(stub.state.coa.size).toBe(sizeAfterFirst);
    // Second run short-circuits via the existing-systemKey set, so no
    // additional upserts should be issued.
    expect(stub.state.callCount).toBe(upsertCallsAfterFirst);
  });

  it('isolates COA per business', async () => {
    const stub = makeStub();
    const svc = new ChartOfAccountsSeederService(stub.prisma);
    await svc.ensureDefaults('biz_1');
    await svc.ensureDefaults('biz_2');
    const byBiz = new Map<string, number>();
    for (const r of stub.state.coa.values()) byBiz.set(r.businessId, (byBiz.get(r.businessId) ?? 0) + 1);
    expect(byBiz.get('biz_1')).toBe(SYSTEM_COA.length);
    expect(byBiz.get('biz_2')).toBe(SYSTEM_COA.length);
  });
});

describe('ChartOfAccountsSeederService.linkExpenseCategories', () => {
  it('matches by name pattern and falls back to EXPENSE_GENERAL', async () => {
    const stub = makeStub([
      { id: 'ec_1', name: 'Marketing & Ads' },
      { id: 'ec_2', name: 'Office Supplies' },
      { id: 'ec_3', name: 'Travel' },
      { id: 'ec_4', name: 'Random Misc Bucket' }, // no pattern match -> fallback
    ]);
    const svc = new ChartOfAccountsSeederService(stub.prisma);
    await svc.ensureDefaults('biz_1');

    const bySystemKey = new Map(Array.from(stub.state.coa.values()).map((r) => [r.systemKey, r.id]));
    expect(stub.state.expenseCategories.get('ec_1')!.chartOfAccountId).toBe(bySystemKey.get('EXPENSE_MARKETING'));
    expect(stub.state.expenseCategories.get('ec_2')!.chartOfAccountId).toBe(bySystemKey.get('EXPENSE_OFFICE'));
    expect(stub.state.expenseCategories.get('ec_3')!.chartOfAccountId).toBe(bySystemKey.get('EXPENSE_TRAVEL'));
    expect(stub.state.expenseCategories.get('ec_4')!.chartOfAccountId).toBe(bySystemKey.get('EXPENSE_GENERAL'));
  });

  it('is idempotent — already-linked categories are not re-linked', async () => {
    const stub = makeStub([{ id: 'ec_1', name: 'Marketing', chartOfAccountId: 'pre_existing_id' }]);
    const svc = new ChartOfAccountsSeederService(stub.prisma);
    await svc.ensureDefaults('biz_1');
    // Only unlinked rows are queried; pre-linked stays intact.
    expect(stub.state.expenseCategories.get('ec_1')!.chartOfAccountId).toBe('pre_existing_id');
  });

  it('repeated calls do not change established links', async () => {
    const stub = makeStub([{ id: 'ec_1', name: 'Software & SaaS' }]);
    const svc = new ChartOfAccountsSeederService(stub.prisma);
    await svc.ensureDefaults('biz_1');
    const linkedId = stub.state.expenseCategories.get('ec_1')!.chartOfAccountId;
    expect(linkedId).toBeTruthy();
    await svc.ensureDefaults('biz_1');
    expect(stub.state.expenseCategories.get('ec_1')!.chartOfAccountId).toBe(linkedId);
  });
});

describe('ChartOfAccountsSeederService concurrency (R0-D1-COA-SEED-RACE)', () => {
  // RevenuePostingService.onPaymentRecorded resolved the deposit and credit
  // accounts with Promise.all -> two concurrent getBySystemKey -> two
  // concurrent ensureDefaults -> the second upsert of every key collided on
  // the (businessId, systemKey) unique index with P2002. The seeder must
  // serialize first-run seeding per business and absorb a P2002 as "already
  // seeded" so a first payment on a fresh tenant never dies on seeding.

  it('two concurrent ensureDefaults() calls for one business share one in-flight seed: both resolve, one full set exists, no key is upserted twice', async () => {
    const stub = makeStub([], { raceUniqueIndex: true });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    await Promise.all([svc.ensureDefaults('biz_1'), svc.ensureDefaults('biz_1')]);

    const rows = rowsOf(stub, 'biz_1');
    expect(rows.size).toBe(SYSTEM_COA.length);
    for (const seed of SYSTEM_COA) expect(rows.has(seed.systemKey)).toBe(true);
    // One seed run, not two interleaved ones.
    expect(stub.state.callCount).toBe(SYSTEM_COA.length);
    expect(stub.state.p2002Thrown).toBe(0);
  });

  it('concurrent getBySystemKey() for two different keys on a fresh business (the payment-posting shape) both resolve', async () => {
    const stub = makeStub([], { raceUniqueIndex: true });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    const [cash, revenue] = await Promise.all([
      svc.getBySystemKey('biz_1', 'CASH'),
      svc.getBySystemKey('biz_1', 'REVENUE'),
    ]);

    expect(cash?.systemKey).toBe('CASH');
    expect(revenue?.systemKey).toBe('REVENUE');
    expect(rowsOf(stub, 'biz_1').size).toBe(SYSTEM_COA.length);
    expect(stub.state.p2002Thrown).toBe(0);
  });

  it('a P2002 on the upsert is treated as already seeded: the row is re-read, never thrown, and its parent link is still applied', async () => {
    // Another process (a second server replica) lands CASH and
    // REVENUE_SERVICE first; our upsert of those keys raises P2002.
    const stub = makeStub([], { foreignInsertOn: ['CASH', 'REVENUE_SERVICE'] });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    await expect(svc.ensureDefaults('biz_1')).resolves.toBeUndefined();

    expect(stub.state.p2002Thrown).toBe(2);
    const rows = rowsOf(stub, 'biz_1');
    expect(rows.size).toBe(SYSTEM_COA.length);
    // The re-read row joins the parent-link pass like any row we created.
    expect(rows.get('REVENUE_SERVICE')!.parentId).toBe(rows.get('REVENUE')!.id);
    expect(rows.get('EXPENSE_MARKETING')!.parentId).toBe(rows.get('EXPENSE_GENERAL')!.id);
  });

  it('getBySystemKey() still returns the row when its own upsert lost the race to another process', async () => {
    const stub = makeStub([], { foreignInsertOn: ['REVENUE'] });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    const row = await svc.getBySystemKey('biz_1', 'REVENUE');

    expect(row?.systemKey).toBe('REVENUE');
    expect(stub.state.p2002Thrown).toBe(1);
  });

  it('a transient (non-P2002) failure is not swallowed and is not pinned: the next ensureDefaults() runs fresh and succeeds', async () => {
    const stub = makeStub([], { failOnceWith: new Error('connection reset') });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    await expect(svc.ensureDefaults('biz_1')).rejects.toThrow('connection reset');
    await expect(svc.ensureDefaults('biz_1')).resolves.toBeUndefined();
    expect(rowsOf(stub, 'biz_1').size).toBe(SYSTEM_COA.length);
  });

  it('after the in-flight seed settles, a later call does not reuse it: rows already exist, so it issues no upsert', async () => {
    const stub = makeStub([], { raceUniqueIndex: true });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    await Promise.all([svc.ensureDefaults('biz_1'), svc.ensureDefaults('biz_1')]);
    const findManyAfterSeed = stub.state.findManyCalls;
    await svc.ensureDefaults('biz_1');

    expect(stub.state.callCount).toBe(SYSTEM_COA.length);
    // The later call really ran (it re-read the table) rather than returning
    // a stale resolved promise.
    expect(stub.state.findManyCalls).toBeGreaterThan(findManyAfterSeed);
  });

  it('seeding is serialized per business, not globally: two businesses seed concurrently and each gets one full set', async () => {
    const stub = makeStub([], { raceUniqueIndex: true });
    const svc = new ChartOfAccountsSeederService(stub.prisma);

    await Promise.all([svc.ensureDefaults('biz_1'), svc.ensureDefaults('biz_2')]);

    expect(rowsOf(stub, 'biz_1').size).toBe(SYSTEM_COA.length);
    expect(rowsOf(stub, 'biz_2').size).toBe(SYSTEM_COA.length);
    expect(stub.state.callCount).toBe(2 * SYSTEM_COA.length);
  });
});
