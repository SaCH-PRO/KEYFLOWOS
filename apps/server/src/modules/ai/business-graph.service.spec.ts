import { describe, expect, it, vi } from 'vitest';
import { BusinessGraphService, keyContextSight } from './business-graph.service';

/**
 * PR195-PORT (owner PR #195 part 4): KEY's standing context gains treasury
 * (ledger cash, unpaid bills, committed payroll), pipeline (open deals) and
 * support (open tickets) figures and a treasury alert.
 *
 * Held to the head's rules:
 *   - cash is the ledger cash position (CashPositionService, V1-34), never
 *     FinancialAccount.currentBalance; every figure is in the business currency
 *     and an amount in another currency is named apart, never added or
 *     converted (D-13, V1-37c, D-107/D-135);
 *   - the figures are shown only to a viewer who may read them on REST: treasury
 *     needs revenue read (D-57: safe-to-spend, which carries cash, bills and the
 *     payroll reserve), pipeline crm read (GET crm deals), support operations
 *     read (KEY's helpdesk tools; the stricter of the two head rules for
 *     tickets). getSnapshot() (the shared snapshot the REST graph routes and the
 *     other KEY services read) carries none of them; getSnapshotForViewer()
 *     carries the sections that viewer may see; buildContextString() prints
 *     what the snapshot it is given carries.
 */

type Scopes = Record<string, string> | null;

function makeStubs(opts: {
  membership?: { role: string; permissionScopes: Scopes } | null;
  cash?: { cashBalance: number; currency?: string; byCurrency?: Record<string, number> };
  bills?: Array<{ amount: number; currency: string }>;
  payrollRuns?: Array<{ totalGross: number; currency: string }>;
  deals?: Array<{ value: number | null; currency: string }>;
  openTickets?: number;
} = {}) {
  const membership = opts.membership === undefined ? { role: 'OWNER', permissionScopes: null } : opts.membership;
  const cash = opts.cash ?? { cashBalance: 18_500 };
  const cashCurrency = cash.currency ?? 'TTD';
  const prisma = {
    client: {
      business: {
        findUnique: vi.fn(async () => ({
          name: 'KeyFlow Demo Co',
          industry: 'Services',
          archetype: 'AGENCY',
          revenueModel: 'RETAINER',
          currency: 'TTD',
          businessStage: 'GROWTH',
          teamSize: '5-10',
        })),
      },
      membership: { findUnique: vi.fn(async () => membership) },
      contact: {
        count: vi.fn(async () => 12),
        groupBy: vi.fn(async () => [{ status: 'CLIENT', _count: 10 }]),
        findMany: vi.fn(async () => []),
      },
      invoice: {
        aggregate: vi.fn(async () => ({ _sum: { total: 25_000 }, _count: 2 })),
        count: vi.fn(async () => 5),
        findMany: vi.fn(async () => []),
      },
      booking: { count: vi.fn(async () => 3) },
      expense: {
        aggregate: vi.fn(async () => ({ _sum: { amount: 3_000 } })),
        groupBy: vi.fn(async () => []),
        findMany: vi.fn(async () => opts.bills ?? [
          { amount: 3_000, currency: 'TTD' },
          { amount: 1_200, currency: 'TTD' },
        ]),
      },
      expenseCategory: { findMany: vi.fn(async () => []) },
      expenseBudget: { aggregate: vi.fn(async () => ({ _sum: { amount: 10_000 } })) },
      project: { count: vi.fn(async () => 4), findMany: vi.fn(async () => []) },
      projectTask: { count: vi.fn(async () => 0) },
      socialPost: { count: vi.fn(async () => 1) },
      emailCampaign: { count: vi.fn(async () => 0) },
      automation: {
        count: vi.fn(async () => 2),
        aggregate: vi.fn(async () => ({ _sum: { runCount: 14 } })),
      },
      product: {
        count: vi.fn(async () => 6),
        aggregate: vi.fn(async () => ({ _avg: { price: 500 } })),
        findMany: vi.fn(async () => []),
      },
      service: { findMany: vi.fn(async () => []) },
      payrollRun: { findMany: vi.fn(async () => opts.payrollRuns ?? [{ totalGross: 6_000, currency: 'TTD' }]) },
      deal: {
        findMany: vi.fn(async () => opts.deals ?? [
          { value: 20_000, currency: 'TTD' },
          { value: 25_000, currency: 'TTD' },
        ]),
      },
      supportTicket: { count: vi.fn(async () => opts.openTickets ?? 2) },
      financialAccount: {
        // V1-34: never read for cash. A stub that would lie if it were.
        aggregate: vi.fn(async () => ({ _sum: { currentBalance: 999_999 } })),
        findMany: vi.fn(async () => [{ currentBalance: 999_999 }]),
      },
    },
  } as any;
  const cashPosition = {
    getCashPosition: vi.fn(async () => ({
      cashBalance: cash.cashBalance,
      currency: cashCurrency,
      byCurrency: cash.byCurrency ?? { [cashCurrency]: cash.cashBalance },
      basis: 'ledger',
      accounts: [],
      unpostedOpeningBalances: [],
    })),
  } as any;
  return { prisma, cashPosition, svc: new BusinessGraphService(prisma, cashPosition) };
}

describe('BusinessGraphService: KEY treasury, pipeline and support sight (PR195-PORT)', () => {
  it('BG-01 the owner sees ledger cash, unpaid bills, committed payroll, open deals and open tickets', async () => {
    const { svc, cashPosition, prisma } = makeStubs();
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_owner', true);

    expect(cashPosition.getCashPosition).toHaveBeenCalledWith('biz_1');
    expect(snapshot.treasury).toEqual({
      currency: 'TTD',
      cashBalance: 18_500,
      cashBasis: 'ledger',
      unpaidBillsAmount: 4_200,
      unpaidBillsCount: 2,
      committedPayrollAmount: 6_000,
      committedPayrollRuns: 1,
      otherCurrencies: [],
    });
    expect(snapshot.pipeline).toEqual({ currency: 'TTD', openDealCount: 2, openPipelineValue: 45_000, otherCurrencies: [] });
    expect(snapshot.support).toEqual({ openTicketCount: 2 });

    // Committed payroll is the DRAFT and APPROVED runs of this business only.
    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1', status: { in: ['DRAFT', 'APPROVED'] } }) }),
    );
    // Unpaid bills are this business's live BILL expenses.
    expect(prisma.client.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1', status: 'BILL', deletedAt: null }) }),
    );
    // V1-34: FinancialAccount.currentBalance is never read as cash.
    expect(prisma.client.financialAccount.aggregate).not.toHaveBeenCalled();
    expect(snapshot.treasury!.cashBalance).not.toBe(999_999);

    const context = svc.buildContextString(snapshot);
    expect(context).toContain('Cash & Obligations: TTD 18,500.00 cash (ledger), TTD 4,200.00 unpaid bills (2), TTD 6,000.00 committed payroll (1 run)');
    expect(context).toContain('Pipeline: 2 open deals (TTD 45,000.00)');
    expect(context).toContain('Support: 2 open tickets');
  });

  it('BG-02 a treasury alert is raised when committed bills and payroll exceed ledger cash', async () => {
    const { svc } = makeStubs({
      cash: { cashBalance: 5_000 },
      bills: [{ amount: 3_000, currency: 'TTD' }],
      payrollRuns: [{ totalGross: 4_000, currency: 'TTD' }],
    });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_owner', true);
    const alert = snapshot.healthIndicators.find((h) => h.area === 'treasury' && h.status === 'critical');
    expect(alert?.detail).toBe('Committed bills and payroll (TTD 7,000.00) exceed ledger cash (TTD 5,000.00)');
    expect(svc.buildContextString(snapshot)).toContain('[CRITICAL] Committed bills and payroll (TTD 7,000.00) exceed ledger cash (TTD 5,000.00)');
  });

  it('BG-03 no treasury alert while cash covers the obligations', async () => {
    const { svc } = makeStubs({ cash: { cashBalance: 50_000 } });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_owner', true);
    expect(snapshot.healthIndicators.filter((h) => h.area === 'treasury')).toEqual([]);
  });

  it('BG-04 (D-13) other-currency cash, bills, payroll and deals are named apart, never added or converted', async () => {
    const { svc } = makeStubs({
      cash: { cashBalance: 10_000, byCurrency: { TTD: 10_000, USD: 700 } },
      bills: [{ amount: 1_000, currency: 'TTD' }, { amount: 50, currency: 'usd' }],
      payrollRuns: [{ totalGross: 2_000, currency: 'TTD' }, { totalGross: 300, currency: 'USD' }],
      deals: [{ value: 5_000, currency: 'TTD' }, { value: 900, currency: 'USD' }, { value: null, currency: 'TTD' }],
    });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_owner', true);
    expect(snapshot.treasury).toMatchObject({
      cashBalance: 10_000,
      unpaidBillsAmount: 1_000,
      unpaidBillsCount: 2,
      committedPayrollAmount: 2_000,
      committedPayrollRuns: 2,
      otherCurrencies: [{ currency: 'USD', cash: 700, unpaidBills: 50, committedPayroll: 300 }],
    });
    expect(snapshot.pipeline).toEqual({
      currency: 'TTD',
      openDealCount: 3,
      openPipelineValue: 5_000,
      otherCurrencies: [{ currency: 'USD', value: 900 }],
    });
    const context = svc.buildContextString(snapshot);
    expect(context).toContain('held apart, not converted: USD 700.00 cash, USD 50.00 unpaid bills, USD 300.00 committed payroll');
    expect(context).toContain('Pipeline: 3 open deals (TTD 5,000.00; held apart, not converted: USD 900.00)');
    expect(snapshot.healthIndicators).toContainEqual(expect.objectContaining({ area: 'treasury', status: 'warning' }));
  });

  it('BG-05 the shared snapshot (REST graph routes, other KEY services) carries no treasury, pipeline or support figures', async () => {
    const { svc } = makeStubs({ cash: { cashBalance: 1_000 }, payrollRuns: [{ totalGross: 9_000, currency: 'TTD' }] });
    const snapshot = await svc.getSnapshot('biz_1', true);
    expect(snapshot.treasury).toBeUndefined();
    expect(snapshot.pipeline).toBeUndefined();
    expect(snapshot.support).toBeUndefined();
    expect(snapshot.healthIndicators.filter((h) => h.area === 'treasury')).toEqual([]);
    const context = svc.buildContextString(snapshot);
    expect(context).not.toMatch(/Cash & Obligations|committed payroll|Pipeline:|Support:/);
  });

  it('BG-06 a member without revenue read sees no cash, bills or payroll, nor the treasury alert', async () => {
    const { svc } = makeStubs({
      membership: { role: 'STAFF', permissionScopes: { crm: 'read', operations: 'read', revenue: 'none' } },
      cash: { cashBalance: 1_000 },
      payrollRuns: [{ totalGross: 9_000, currency: 'TTD' }],
    });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_staff', true);
    expect(snapshot.treasury).toBeUndefined();
    expect(snapshot.healthIndicators.filter((h) => h.area === 'treasury')).toEqual([]);
    expect(snapshot.pipeline).toBeDefined();
    expect(snapshot.support).toBeDefined();
    const context = svc.buildContextString(snapshot);
    expect(context).not.toMatch(/Cash & Obligations|committed payroll|ledger cash/);
  });

  it('BG-07 an explicit scope map with no revenue key reads as none (EXPLICIT_MAP_MISSING_KEY)', async () => {
    const { svc } = makeStubs({ membership: { role: 'ADMIN', permissionScopes: { crm: 'admin' } } });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_admin', true);
    expect(snapshot.treasury).toBeUndefined();
    expect(snapshot.support).toBeUndefined();
    expect(snapshot.pipeline).toBeDefined();
  });

  it('BG-08 a member without crm read sees no pipeline; without operations read no support', async () => {
    const { svc } = makeStubs({ membership: { role: 'STAFF', permissionScopes: { revenue: 'read', crm: 'none', operations: 'none' } } });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_staff', true);
    expect(snapshot.treasury).toBeDefined();
    expect(snapshot.pipeline).toBeUndefined();
    expect(snapshot.support).toBeUndefined();
    const context = svc.buildContextString(snapshot);
    expect(context).not.toMatch(/Pipeline:|Support:/);
  });

  it('BG-09 no viewer, or a viewer who is no member (a SUPER_ADMIN included), sees none of them', async () => {
    const { svc } = makeStubs({ membership: null });
    for (const viewer of [undefined, null, 'u_outsider']) {
      const snapshot = await svc.getSnapshotForViewer('biz_1', viewer, true);
      expect(snapshot.treasury).toBeUndefined();
      expect(snapshot.pipeline).toBeUndefined();
      expect(snapshot.support).toBeUndefined();
    }
  });

  it('BG-10 role defaults apply when the membership has no explicit map (STAFF: revenue, crm and operations read)', async () => {
    const sight = await keyContextSight(makeStubs({ membership: { role: 'STAFF', permissionScopes: null } }).prisma, 'biz_1', 'u_staff');
    expect(sight).toEqual({ treasury: true, pipeline: true, support: true });
    const none = await keyContextSight(makeStubs({ membership: { role: 'OWNER', permissionScopes: { revenue: 'none' } } }).prisma, 'biz_1', 'u_co_owner');
    expect(none).toEqual({ treasury: false, pipeline: false, support: false });
  });

  it('BG-11 the per-viewer projection never leaks into the shared cache', async () => {
    const { svc } = makeStubs();
    await svc.getSnapshotForViewer('biz_1', 'u_owner', true);
    const shared = await svc.getSnapshot('biz_1');
    expect(shared.treasury).toBeUndefined();
    expect(shared.healthIndicators.filter((h) => h.area === 'treasury')).toEqual([]);
  });

  it('BG-12 a payroll or ledger change bumps the snapshot revision, so the next read is fresh', async () => {
    const { svc, prisma } = makeStubs();
    const { invalidateBusinessFinancialSnapshotCache } = await import('../finance/finance-accounting.util');
    await svc.getSnapshotForViewer('biz_rev', 'u_owner');
    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledTimes(1);
    await svc.getSnapshotForViewer('biz_rev', 'u_owner');
    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledTimes(1);
    invalidateBusinessFinancialSnapshotCache('biz_rev');
    await svc.getSnapshotForViewer('biz_rev', 'u_owner');
    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledTimes(2);
  });
});
