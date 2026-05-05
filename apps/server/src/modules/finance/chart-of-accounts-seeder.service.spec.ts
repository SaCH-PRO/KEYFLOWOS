import { describe, expect, it, vi } from 'vitest';
import { ChartOfAccountsSeederService, SYSTEM_COA } from './chart-of-accounts-seeder.service';

/**
 * Unit tests for `ChartOfAccountsSeederService` covering:
 *   - Idempotent re-runs of `ensureDefaults()` (no duplicate writes).
 *   - Stable ExpenseCategory -> COA linking, including pattern matching
 *     and the EXPENSE_GENERAL fallback.
 *
 * Uses a hand-rolled in-memory Prisma stub so the test is hermetic.
 */

function makeStub(seedExpenseCategories: Array<{ id: string; name: string; chartOfAccountId?: string | null }> = []) {
  const coa = new Map<string, { id: string; businessId: string; systemKey: string | null; name: string; type: string; parentId: string | null }>();
  const expenseCategories = new Map(
    seedExpenseCategories.map((c) => [c.id, { ...c, businessId: 'biz_1', chartOfAccountId: c.chartOfAccountId ?? null }]),
  );
  let seq = 0;

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
        for (const r of coa.values()) {
          if (r.businessId === k.businessId && r.systemKey === k.systemKey) return r;
        }
        seq += 1;
        const row = {
          id: `coa_${seq}`,
          businessId: args.create.businessId,
          systemKey: args.create.systemKey,
          name: args.create.name,
          type: args.create.type,
          parentId: null,
        };
        coa.set(row.id, row);
        return row;
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
  } } };
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
