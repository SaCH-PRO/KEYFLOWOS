import { describe, expect, it, vi, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { LedgerReportingService } from './ledger-reporting.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LedgerBalanceService } from '../finance/ledger-balance.service';
import { ReceivablesService } from '../finance/receivables.service';

/**
 * FIN4 — Reconciliation integration test.
 *
 * Drives `LedgerReportingService` end-to-end through real NestJS DI
 * against an in-memory ledger fixture that mirrors a realistic month
 * of activity (cash sale, credit invoice + later collection, direct
 * paid expense, accrued bill + payment, tax movement). It asserts:
 *
 *   1. Trial balance is zero (no orphan postings in the fixture).
 *   2. PnL.netProfit == BalanceSheet.netEquityFromIncome.
 *   3. Assets = Liabilities + Equity (with retained earnings).
 *   4. Cashflow inflow/outflow reflects only cash-touching legs.
 *   5. Cashflow indirect-method identity:
 *        ΔCash == NetIncome − ΔAR + ΔAP + ΔTaxPayable
 *   6. Cash basis P&L traces AR settlements (Cash↔AR) back to the
 *      originating Invoice's INCOME composition, and AP settlements
 *      (AP↔Cash) back to the originating Bill's EXPENSE composition.
 *      Resulting cash-basis numbers differ from accrual when there are
 *      open AR/AP at period end.
 */

type Account = { id: string; businessId: string; name: string; type: string; systemKey: string | null };
type Entry = { transactionId: string; businessId: string; accountId: string; debit: number; credit: number; date: Date };
type Txn = {
  id: string;
  businessId: string;
  status: string;
  date: Date;
  sourceType: string | null;
  sourceId: string | null;
};
type Payment = { id: string; invoiceId: string };

interface Fixture {
  accounts: Account[];
  entries: Entry[];
  transactions: Txn[];
  payments: Payment[];
}

function makeFixture(): Fixture {
  const accounts: Account[] = [
    { id: 'cash', businessId: 'biz', name: 'Cash', type: 'ASSET', systemKey: 'CASH' },
    { id: 'bank', businessId: 'biz', name: 'Bank', type: 'ASSET', systemKey: 'BANK' },
    { id: 'ar', businessId: 'biz', name: 'Accounts Receivable', type: 'ASSET', systemKey: 'ACCOUNTS_RECEIVABLE' },
    { id: 'ap', businessId: 'biz', name: 'Accounts Payable', type: 'LIABILITY', systemKey: 'ACCOUNTS_PAYABLE' },
    { id: 'taxp', businessId: 'biz', name: 'Tax Payable', type: 'LIABILITY', systemKey: 'TAX_PAYABLE' },
    { id: 'rev', businessId: 'biz', name: 'Service Revenue', type: 'INCOME', systemKey: 'REVENUE_SERVICE' },
    { id: 'exp', businessId: 'biz', name: 'Rent', type: 'EXPENSE', systemKey: 'EXPENSE_RENT' },
    { id: 'cogs', businessId: 'biz', name: 'COGS', type: 'COGS', systemKey: 'COGS' },
    { id: 'inv', businessId: 'biz', name: 'Inventory', type: 'ASSET', systemKey: 'INVENTORY_ASSET' },
    { id: 'eq', businessId: 'biz', name: 'Owner equity', type: 'EQUITY', systemKey: 'OWNER_EQUITY' },
  ];

  const transactions: Txn[] = [
    { id: 'tx_open', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-01'), sourceType: null, sourceId: null },
    { id: 'tx_buy', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-02'), sourceType: null, sourceId: null },
    // Direct cash sale — Cash 500 / Revenue 500 (sourceType=Payment, basis=CASH)
    { id: 'tx_cash_sale', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-03'), sourceType: 'Payment', sourceId: 'pay_cash' },
    // Credit invoice issued — AR 2200 / Revenue 2000 + Tax 200
    { id: 'tx_inv', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-05'), sourceType: 'Invoice', sourceId: 'inv1' },
    { id: 'tx_cogs', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-05'), sourceType: 'Invoice', sourceId: 'inv1' },
    // Customer pays — Bank 2200 / AR 2200 (sourceType=Payment → invoice inv1)
    { id: 'tx_pay', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-10'), sourceType: 'Payment', sourceId: 'pay1' },
    // Accrued bill — Rent 800 / AP 800
    { id: 'tx_bill', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-15'), sourceType: 'Expense', sourceId: 'exp1' },
    // Bill paid — AP 800 / Bank 800
    { id: 'tx_billpay', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-20'), sourceType: 'Expense', sourceId: 'exp1' },
    // Direct paid expense — Rent 100 / Cash 100
    { id: 'tx_direct_exp', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-22'), sourceType: 'Expense', sourceId: 'exp2' },
    // Open invoice still outstanding at period end — AR 1100 / Rev 1000 + Tax 100
    { id: 'tx_inv_open', businessId: 'biz', status: 'POSTED', date: new Date('2026-01-25'), sourceType: 'Invoice', sourceId: 'inv2' },
  ];

  const payments: Payment[] = [
    { id: 'pay_cash', invoiceId: 'inv_cash' },
    { id: 'pay1', invoiceId: 'inv1' },
  ];

  const entries: Entry[] = [
    // Opening: owner contributes 5000 cash. Cash 5000 / Equity 5000.
    { transactionId: 'tx_open', businessId: 'biz', accountId: 'cash', debit: 5000, credit: 0, date: new Date('2026-01-01') },
    { transactionId: 'tx_open', businessId: 'biz', accountId: 'eq', debit: 0, credit: 5000, date: new Date('2026-01-01') },
    // Buy 1000 of inventory cash. Inv 1000 / Cash 1000.
    { transactionId: 'tx_buy', businessId: 'biz', accountId: 'inv', debit: 1000, credit: 0, date: new Date('2026-01-02') },
    { transactionId: 'tx_buy', businessId: 'biz', accountId: 'cash', debit: 0, credit: 1000, date: new Date('2026-01-02') },
    // Direct cash sale 500 (no tax for simplicity).
    { transactionId: 'tx_cash_sale', businessId: 'biz', accountId: 'cash', debit: 500, credit: 0, date: new Date('2026-01-03') },
    { transactionId: 'tx_cash_sale', businessId: 'biz', accountId: 'rev', debit: 0, credit: 500, date: new Date('2026-01-03') },
    // Invoice 2200: AR 2200 / Rev 2000 / Tax 200.
    { transactionId: 'tx_inv', businessId: 'biz', accountId: 'ar', debit: 2200, credit: 0, date: new Date('2026-01-05') },
    { transactionId: 'tx_inv', businessId: 'biz', accountId: 'rev', debit: 0, credit: 2000, date: new Date('2026-01-05') },
    { transactionId: 'tx_inv', businessId: 'biz', accountId: 'taxp', debit: 0, credit: 200, date: new Date('2026-01-05') },
    // COGS 600 / Inv 600.
    { transactionId: 'tx_cogs', businessId: 'biz', accountId: 'cogs', debit: 600, credit: 0, date: new Date('2026-01-05') },
    { transactionId: 'tx_cogs', businessId: 'biz', accountId: 'inv', debit: 0, credit: 600, date: new Date('2026-01-05') },
    // Customer pays. Bank 2200 / AR 2200.
    { transactionId: 'tx_pay', businessId: 'biz', accountId: 'bank', debit: 2200, credit: 0, date: new Date('2026-01-10') },
    { transactionId: 'tx_pay', businessId: 'biz', accountId: 'ar', debit: 0, credit: 2200, date: new Date('2026-01-10') },
    // Rent bill recorded. Rent 800 / AP 800.
    { transactionId: 'tx_bill', businessId: 'biz', accountId: 'exp', debit: 800, credit: 0, date: new Date('2026-01-15') },
    { transactionId: 'tx_bill', businessId: 'biz', accountId: 'ap', debit: 0, credit: 800, date: new Date('2026-01-15') },
    // Pay rent bill. AP 800 / Bank 800.
    { transactionId: 'tx_billpay', businessId: 'biz', accountId: 'ap', debit: 800, credit: 0, date: new Date('2026-01-20') },
    { transactionId: 'tx_billpay', businessId: 'biz', accountId: 'bank', debit: 0, credit: 800, date: new Date('2026-01-20') },
    // Direct paid expense. Rent 100 / Cash 100.
    { transactionId: 'tx_direct_exp', businessId: 'biz', accountId: 'exp', debit: 100, credit: 0, date: new Date('2026-01-22') },
    { transactionId: 'tx_direct_exp', businessId: 'biz', accountId: 'cash', debit: 0, credit: 100, date: new Date('2026-01-22') },
    // Open invoice still outstanding. AR 1100 / Rev 1000 / Tax 100.
    { transactionId: 'tx_inv_open', businessId: 'biz', accountId: 'ar', debit: 1100, credit: 0, date: new Date('2026-01-25') },
    { transactionId: 'tx_inv_open', businessId: 'biz', accountId: 'rev', debit: 0, credit: 1000, date: new Date('2026-01-25') },
    { transactionId: 'tx_inv_open', businessId: 'biz', accountId: 'taxp', debit: 0, credit: 100, date: new Date('2026-01-25') },
  ];
  return { accounts, entries, transactions, payments };
}

function makePrismaStub(fx: Fixture) {
  const accountById = new Map(fx.accounts.map((a) => [a.id, a]));
  const txById = new Map(fx.transactions.map((t) => [t.id, t]));
  const entriesByTx = new Map<string, Entry[]>();
  for (const e of fx.entries) {
    const arr = entriesByTx.get(e.transactionId) ?? [];
    arr.push(e);
    entriesByTx.set(e.transactionId, arr);
  }

  const inRange = (date: Date, gte?: Date, lte?: Date) =>
    (!gte || date >= gte) && (!lte || date <= lte);

  const filterEntries = (where: any): Entry[] => {
    let rows = fx.entries.filter((e) => e.businessId === where.businessId);
    if (where.date) rows = rows.filter((e) => inRange(e.date, where.date.gte, where.date.lte));
    if (where.account?.type?.in) rows = rows.filter((e) => where.account.type.in.includes(accountById.get(e.accountId)?.type));
    if (where.account?.systemKey?.in) rows = rows.filter((e) => where.account.systemKey.in.includes(accountById.get(e.accountId)?.systemKey));
    if (where.accountId) rows = rows.filter((e) => e.accountId === where.accountId);
    if (where.transactionId?.in) rows = rows.filter((e) => where.transactionId.in.includes(e.transactionId));
    return rows;
  };

  const txnEntriesShape = (tx: Txn) =>
    (entriesByTx.get(tx.id) ?? []).map((e) => {
      const a = accountById.get(e.accountId)!;
      return { accountId: e.accountId, debit: e.debit, credit: e.credit, account: { id: a.id, name: a.name, type: a.type, systemKey: a.systemKey } };
    });

  return {
    business: { findUnique: vi.fn(async () => ({ currency: 'TTD' })) },
    chartOfAccount: {
      findMany: vi.fn(async (args: any) => {
        const ids: string[] = args.where.id?.in ?? [];
        return ids.map((id) => accountById.get(id)).filter(Boolean);
      }),
      findFirst: vi.fn(async (args: any) =>
        fx.accounts.find((a) => a.systemKey === args.where.systemKey) ?? null,
      ),
    },
    ledgerEntry: {
      findMany: vi.fn(async (args: any) => {
        const rows = filterEntries(args.where);
        if (args.distinct?.includes('transactionId')) {
          const seen = new Set<string>();
          return rows.filter((r) => (seen.has(r.transactionId) ? false : (seen.add(r.transactionId), true)))
            .map((r) => ({ transactionId: r.transactionId }));
        }
        if (args.select?.transaction) {
          return rows.map((r) => {
            const t = txById.get(r.transactionId)!;
            return {
              transactionId: r.transactionId,
              debit: r.debit,
              credit: r.credit,
              transaction: { sourceType: t.sourceType, sourceId: t.sourceId, contactId: null },
            };
          });
        }
        return rows;
      }),
      groupBy: vi.fn(async (args: any) => {
        const rows = filterEntries(args.where);
        const map = new Map<string, { debit: number; credit: number }>();
        for (const r of rows) {
          const cur = map.get(r.accountId) ?? { debit: 0, credit: 0 };
          cur.debit += r.debit;
          cur.credit += r.credit;
          map.set(r.accountId, cur);
        }
        return Array.from(map.entries()).map(([accountId, v]) => ({ accountId, _sum: { debit: v.debit, credit: v.credit } }));
      }),
      aggregate: vi.fn(async (args: any) => {
        const rows = filterEntries(args.where);
        const debit = rows.reduce((s, r) => s + r.debit, 0);
        const credit = rows.reduce((s, r) => s + r.credit, 0);
        return { _sum: { debit, credit } };
      }),
    },
    financialTransaction: {
      findMany: vi.fn(async (args: any) => {
        const w = args.where;
        let rows = fx.transactions.filter((t) => t.businessId === w.businessId);
        if (w.status) rows = rows.filter((t) => t.status === w.status);
        if (w.date) rows = rows.filter((t) => inRange(t.date, w.date.gte, w.date.lte));
        if (w.entries?.some?.account?.systemKey?.in) {
          const keys: string[] = w.entries.some.account.systemKey.in;
          rows = rows.filter((t) =>
            (entriesByTx.get(t.id) ?? []).some((e) => {
              const sk = accountById.get(e.accountId)?.systemKey;
              return sk && keys.includes(sk);
            }),
          );
        }
        if (w.OR) {
          rows = rows.filter((t) =>
            w.OR.some((cond: any) =>
              cond.sourceType === t.sourceType && cond.sourceId?.in?.includes(t.sourceId ?? '__'),
            ),
          );
        }
        if (w.id?.in) rows = rows.filter((t) => w.id.in.includes(t.id));
        return rows.map((t) => ({
          id: t.id,
          sourceType: t.sourceType,
          sourceId: t.sourceId,
          contactId: null,
          entries: txnEntriesShape(t),
        }));
      }),
    },
    payment: {
      findMany: vi.fn(async (args: any) => {
        const ids: string[] = args.where.id?.in ?? [];
        return fx.payments.filter((p) => ids.includes(p.id));
      }),
    },
    expense: {
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 }, _count: 0 })),
      findMany: vi.fn(async () => []),
    },
    invoice: {
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _sum: { taxAmount: 300, subtotal: 3000 } })),
    },
    taxLiability: { findMany: vi.fn(async () => []) },
  } as any;
}

const balancesStub = (fx: Fixture) => ({
  getTrialBalance: vi.fn(async () => {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const e of fx.entries) {
      const cur = map.get(e.accountId) ?? { debit: 0, credit: 0 };
      cur.debit += e.debit;
      cur.credit += e.credit;
      map.set(e.accountId, cur);
    }
    return fx.accounts.map((a) => {
      const v = map.get(a.id) ?? { debit: 0, credit: 0 };
      return { accountId: a.id, name: a.name, type: a.type, systemKey: a.systemKey, debit: v.debit, credit: v.credit };
    });
  }),
});

const receivablesStub = () => ({
  getAging: vi.fn(async () => ({
    asOf: new Date().toISOString(), currency: 'TTD', totalOutstanding: 1100, totalOverdue: 0, customers: [],
  })),
});

describe('LedgerReportingService — reconciliation integration', () => {
  const fx = makeFixture();
  let svc: LedgerReportingService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerReportingService,
        { provide: PrismaService, useValue: { client: makePrismaStub(fx) } },
        { provide: LedgerBalanceService, useValue: balancesStub(fx) },
        { provide: ReceivablesService, useValue: receivablesStub() },
      ],
    }).compile();
    svc = moduleRef.get(LedgerReportingService);
  });

  it('Trial balance is zero (no orphan postings)', () => {
    const debit = fx.entries.reduce((s, e) => s + e.debit, 0);
    const credit = fx.entries.reduce((s, e) => s + e.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
  });

  it('PnL net profit matches Balance Sheet retained earnings (accrual)', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const pnl = await svc.getPnl('biz', from, to, 'accrual');
    const bs = await svc.getBalanceSheet('biz', to);

    // Revenue: 500 (cash) + 2000 (invoice) + 1000 (open) = 3500
    // COGS: 600 ; Opex: 800 + 100 = 900 ; Net: 3500-600-900 = 2000
    expect(pnl.revenue.total).toBeCloseTo(3500, 2);
    expect(pnl.cogs.total).toBeCloseTo(600, 2);
    expect(pnl.operatingExpenses.total).toBeCloseTo(900, 2);
    expect(pnl.netProfit).toBeCloseTo(2000, 2);

    expect(bs.netEquityFromIncome).toBeCloseTo(pnl.netProfit, 2);
    expect(bs.identityHolds).toBe(true);
    expect(Math.abs(bs.identityDelta)).toBeLessThan(0.05);
  });

  it('Cashflow indirect-method identity: ΔCash = NetIncome − ΔAR + ΔAP + ΔTaxPayable', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const cf = await svc.getCashflow('biz', from, to, 'accrual');
    // Inflows: 5000 + 500 + 2200 = 7700 ; Outflows: 1000 + 800 + 100 = 1900 ; Net 5800
    expect(cf.cashIn).toBeCloseTo(7700, 2);
    expect(cf.cashOut).toBeCloseTo(1900, 2);
    expect(cf.netMovement).toBeCloseTo(5800, 2);

    // CFO = NetIncome - ΔAR + ΔAP + ΔTaxPayable
    // ΔAR = +1100 (open invoice); ΔAP = 0; ΔTaxPayable = 300
    // CFO = 2000 - 1100 + 0 + 300 = 1200
    expect(cf.accrualAdjustments.netIncome).toBeCloseTo(2000, 2);
    expect(cf.accrualAdjustments.arChange).toBeCloseTo(1100, 2);
    expect(cf.accrualAdjustments.apChange).toBeCloseTo(0, 2);
    expect(cf.accrualAdjustments.taxPayableChange).toBeCloseTo(300, 2);
    expect(cf.accrualAdjustments.cashFromOperations).toBeCloseTo(1200, 2);
  });

  it('Cash basis P&L traces AR/AP settlements to source composition', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const cash = await svc.getPnl('biz', from, to, 'cash');
    const accrual = await svc.getPnl('biz', from, to, 'accrual');

    // Cash revenue: direct cash sale 500 + traced AR settlement 2200 = 2700
    // (open invoice's 1000 not collected → not in cash basis)
    // Cash expense: bill payment traced 800 + direct paid 100 = 900
    expect(cash.revenue.total).toBeCloseTo(2700, 2);
    expect(cash.operatingExpenses.total).toBeCloseTo(900, 2);
    // Cash basis ≠ accrual (open invoice excluded)
    expect(cash.netProfit).not.toBeCloseTo(accrual.netProfit, 2);
    expect(cash.netProfit).toBeCloseTo(1800, 2);
  });

  it('Cashflow basis=cash excludes financing/asset-swap activity (only operating cash)', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const cf = await svc.getCashflow('biz', from, to, 'cash');
    // Operating cash IN: 500 (cash sale) + 2200 (AR collection) = 2700
    // Operating cash OUT: 800 (bill payment) + 100 (direct expense) = 900
    // Excluded: 5000 owner contribution, 1000 inventory purchase
    expect(cf.cashIn).toBeCloseTo(2700, 2);
    expect(cf.cashOut).toBeCloseTo(900, 2);
    expect(cf.netMovement).toBeCloseTo(1800, 2);
    expect(cf.basis).toBe('cash');
    // Cash basis: CFO == NetIncome, no accrual bridge.
    expect(cf.accrualAdjustments.netIncome).toBeCloseTo(1800, 2);
    expect(cf.accrualAdjustments.cashFromOperations).toBeCloseTo(1800, 2);
    expect(cf.accrualAdjustments.arChange).toBe(0);
    expect(cf.accrualAdjustments.apChange).toBe(0);
  });

  it('AP aging nets per economic document (settled bills excluded)', async () => {
    // tx_bill (AP +800) and tx_billpay (AP -800) share sourceId='exp1' →
    // remaining = 0 → settled, must NOT appear in aging. Aging total
    // should be 0 because no other open AP groups exist in fixture.
    const aging = await svc.getApAging('biz', new Date('2026-01-31'));
    expect(aging.total).toBeCloseTo(0, 2);
    expect(aging.vendors.length).toBe(0);
  });

  it('Tax summary reconciles ledger-derived figures with invoice tax fields', async () => {
    const tax = await svc.getTaxSummary('biz', new Date('2026-01-01'), new Date('2026-01-31'));
    // Tax collected (credits to TAX_PAYABLE) = 200 + 100 = 300
    expect(tax.taxCollected).toBeCloseTo(300, 2);
    expect(tax.invoiceTaxes.taxAmount).toBeCloseTo(300, 2);
    expect(tax.invoiceTaxes.ledgerToInvoiceDelta).toBeCloseTo(0, 2);
  });
});
