import { describe, expect, it, vi } from 'vitest';
import { BusinessGraphService, keyContextSight } from './business-graph.service';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../../core/auth/module-scope.guard';

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
 *
 * PR195-KEY-GATES review repair (review finding SEC-P195KG-2; owner rulings D-57,
 * D-146, D-73): KEY's standing context (getSnapshot with a viewer option, the call
 * chat() and streamChat() make, and getSnapshotForViewer) carries the revenue and
 * receivable figures (revenue collected and this month, outstanding and overdue
 * invoices, the overdue-invoice alert) only to a viewer with revenue read, the
 * month's expenses (and the budget alert) only with expenses read, and the
 * expenses-against-revenue alert only with both. A turn that names no member (the
 * Chatwoot support desk: viewerId null) carries none of them, as it runs none of
 * the tools that read them. The shared snapshot (no viewer option: REST graph
 * routes, the other KEY services) is unchanged.
 *
 *   BG-15  RED-BEFORE  no member (viewerId null, a viewer with no membership): no
 *                      revenue, outstanding or expenses line, figure or alert
 *   BG-16  RED-BEFORE  revenue none (expenses read): the month's expenses, nothing of revenue
 *   BG-17  RED-BEFORE  revenue read (expenses none): revenue and outstanding, nothing of expenses
 *   BG-18  control     STAFF defaults and the OWNER see every line; the shared snapshot is unchanged
 */

type Scopes = Record<string, string> | unknown[] | null;

function makeStubs(opts: {
  membership?: { role: string; permissionScopes: Scopes } | null;
  cash?: { cashBalance: number; currency?: string; byCurrency?: Record<string, number> };
  bills?: Array<{ amount: number; currency: string }>;
  payrollRuns?: Array<{ totalGross: number; currency: string }>;
  deals?: Array<{ value: number | null; currency: string }>;
  openTickets?: number;
  expensesThisMonth?: number;
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
        aggregate: vi.fn(async () => ({ _sum: { amount: opts.expensesThisMonth ?? 3_000 } })),
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
    expect(sight).toEqual({ treasury: true, pipeline: true, support: true, revenue: true, expenses: true });
    const none = await keyContextSight(makeStubs({ membership: { role: 'OWNER', permissionScopes: { revenue: 'none' } } }).prisma, 'biz_1', 'u_co_owner');
    expect(none).toEqual({ treasury: false, pipeline: false, support: false, revenue: false, expenses: false });
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

  it('BG-13 (review SEC-P195-2 / CR-P195-2) a membership whose permissionScopes is [] is an explicit map in which every module is none: no treasury, pipeline or support', async () => {
    const { svc, prisma } = makeStubs({ membership: { role: 'STAFF', permissionScopes: [] } });
    expect(await keyContextSight(prisma, 'biz_1', 'u_arr')).toEqual({ treasury: false, pipeline: false, support: false, revenue: false, expenses: false });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_arr', true);
    expect(snapshot.treasury).toBeUndefined();
    expect(snapshot.pipeline).toBeUndefined();
    expect(snapshot.support).toBeUndefined();
    expect(snapshot.healthIndicators.filter((h) => h.area === 'treasury')).toEqual([]);
    expect(svc.buildContextString(snapshot)).not.toMatch(/Cash & Obligations|committed payroll|Pipeline:|Support:/);
  });

  it.each([
    ['null (role defaults)', null],
    ['{} (explicit, every module none)', {}],
    ['[] (explicit, every module none)', []],
    ['an explicit map', { revenue: 'read', crm: 'none', operations: 'write' }],
    ['an explicit map without the module keys', { marketing: 'admin' }],
  ])('BG-14 (anti-drift) keyContextSight reads permissionScopes %s exactly as ModuleScopeGuard does', async (_label, permissionScopes) => {
    const { prisma } = makeStubs({ membership: { role: 'STAFF', permissionScopes: permissionScopes as Scopes } });
    const guardAllows = async (module: string) => {
      const reflector = { get: (key: string) => (key === MODULE_SCOPE_KEY ? { module, minLevel: 'read' } : undefined) } as any;
      const req = { user: { id: 'u_m', role: 'USER' }, params: { businessId: 'biz_1' } };
      const ctx = { getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => req }) } as any;
      return new ModuleScopeGuard(prisma, reflector).canActivate(ctx).then(() => true, () => false);
    };
    const sight = await keyContextSight(prisma, 'biz_1', 'u_m');
    expect(sight).toEqual({
      treasury: await guardAllows('revenue'),
      pipeline: await guardAllows('crm'),
      support: await guardAllows('operations'),
      revenue: await guardAllows('revenue'),
      expenses: await guardAllows('expenses'),
    });
  });
});

describe('BusinessGraphService: KEY context revenue and expense figures (SEC-P195KG-2)', () => {
  /** The money lines and alerts of the context string, and the figures the stubs answer with. */
  const REVENUE_LINES = /Revenue: |Outstanding: |overdue invoice\(s\) totaling/;
  const EXPENSE_LINES = /Expenses: |Budget utilization/;
  const BOTH_LINES = /Expenses consuming/;
  const FIGURES = /25,000|30,000|5,000\b/;
  // 25,000 collected and this month, 2 overdue; 30,000 of expenses against a 10,000 budget: every money alert raised
  const stubs = (membership: { role: string; permissionScopes: Scopes } | null) => makeStubs({ membership, expensesThisMonth: 30_000 });
  const areas = (snapshot: { healthIndicators: Array<{ area: string }> }) => snapshot.healthIndicators.map((h) => h.area);

  it('BG-15 RED-BEFORE: a KEY turn that names no member (the Chatwoot desk: viewerId null) carries no revenue, receivable or expense figure, line or alert', async () => {
    const { svc } = stubs(null);
    const snapshots = [
      await svc.getSnapshot('biz_1', true, { viewerId: null }),
      await svc.getSnapshotForViewer('biz_1', undefined, true),
      await svc.getSnapshotForViewer('biz_1', 'u_outsider', true),
    ];
    for (const snapshot of snapshots) {
      expect(snapshot.revenue).toBeUndefined();
      expect(snapshot.expenses).toBeUndefined();
      expect(snapshot.entities.overdueInvoices).toEqual([]);
      expect(snapshot.entities.topContacts).toEqual([]);
      for (const a of ['revenue', 'expenses', 'profitability', 'treasury']) expect(areas(snapshot), a).not.toContain(a);
      const context = svc.buildContextString(snapshot);
      expect(context).not.toMatch(REVENUE_LINES);
      expect(context).not.toMatch(EXPENSE_LINES);
      expect(context).not.toMatch(BOTH_LINES);
      expect(context).not.toMatch(FIGURES);
      expect(context).toContain('Business: KeyFlow Demo Co');
    }
  });

  it('BG-16 RED-BEFORE: a member with no revenue access (expenses read) sees the month\'s expenses and nothing of revenue', async () => {
    const { svc } = stubs({ role: 'STAFF', permissionScopes: { crm: 'read', operations: 'read', expenses: 'read' } });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_staff', true);
    expect(snapshot.revenue).toBeUndefined();
    expect(snapshot.expenses).toMatchObject({ totalThisMonth: 30_000 });
    expect(areas(snapshot)).not.toContain('revenue');
    expect(areas(snapshot)).not.toContain('profitability');
    expect(areas(snapshot)).toContain('expenses');
    const context = svc.buildContextString(snapshot);
    expect(context).not.toMatch(REVENUE_LINES);
    expect(context).not.toMatch(BOTH_LINES);
    expect(context).not.toMatch(/25,000/);
    expect(context).toContain('Expenses: $30,000 this month');
  });

  it('BG-17 RED-BEFORE: a member with revenue read and no expenses access sees revenue and outstanding, nothing of expenses', async () => {
    const { svc } = stubs({ role: 'STAFF', permissionScopes: { revenue: 'read', crm: 'read' } });
    const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_staff', true);
    expect(snapshot.revenue).toMatchObject({ totalCollected: 25_000 });
    expect(snapshot.expenses).toBeUndefined();
    expect(areas(snapshot)).toContain('revenue');
    expect(areas(snapshot)).not.toContain('expenses');
    expect(areas(snapshot)).not.toContain('profitability');
    const context = svc.buildContextString(snapshot);
    expect(context).toContain('Revenue: $25,000 collected');
    expect(context).toContain('Outstanding: $25,000 (2 invoices, 2 overdue)');
    expect(context).not.toMatch(EXPENSE_LINES);
    expect(context).not.toMatch(BOTH_LINES);
    expect(context).not.toMatch(/30,000/);
  });

  it('BG-18 control: STAFF defaults and the OWNER see every line and alert; the shared snapshot (no viewer option) is unchanged', async () => {
    for (const membership of [{ role: 'STAFF', permissionScopes: null }, { role: 'OWNER', permissionScopes: null }]) {
      const { svc } = stubs(membership);
      const snapshot = await svc.getSnapshotForViewer('biz_1', 'u_m', true);
      expect(snapshot.revenue).toBeDefined();
      expect(snapshot.expenses).toBeDefined();
      expect(areas(snapshot)).toEqual(expect.arrayContaining(['revenue', 'expenses', 'profitability']));
      const context = svc.buildContextString(snapshot);
      expect(context).toMatch(REVENUE_LINES);
      expect(context).toMatch(EXPENSE_LINES);
      expect(context).toMatch(BOTH_LINES);
    }
    const { svc } = stubs(null);
    const shared = await svc.getSnapshot('biz_1', true);
    expect(shared.revenue).toMatchObject({ totalCollected: 25_000 });
    expect(shared.expenses).toMatchObject({ totalThisMonth: 30_000 });
    expect(areas(shared)).toEqual(expect.arrayContaining(['revenue', 'expenses', 'profitability']));
    const context = svc.buildContextString(shared);
    expect(context).toContain('Revenue: $25,000 collected');
    expect(context).toContain('Expenses: $30,000 this month');
  });
});
