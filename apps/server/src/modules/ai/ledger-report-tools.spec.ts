/**
 * The six reports KEY could not produce, and the zero it must never invent.
 *
 * LedgerReportingService exposes eight reports. KEY reached two of them —
 * getArAging and getApAging, through finance_view_receivables and
 * finance_view_payables. The other six had no tool at all, so the most ordinary
 * questions an owner asks their business had no answer from the ledger:
 *
 *   "How did we do last quarter?"      getPnl
 *   "What's our cash position?"        getCashflow
 *   "What are we worth?"               getBalanceSheet
 *   "How much tax do we owe?"          getTaxSummary
 *   "Who are our biggest customers?"   getRevenueBy
 *   "Where is the money going?"        getExpenseBy
 *
 * WHY THIS FILE RUNS THE HANDLERS RATHER THAN READING THEM
 *
 * The standing gates already hold reachability, routes and honest returns
 * statically. What they cannot see is the failure mode specific to a report
 * tool, which is silent:
 *
 *   new Date('last quarter')  ->  Invalid Date
 *
 * Prisma turns that into a range filter matching no rows. The report comes back
 * all zeros. A P&L of zero does not read as an error — it reads as a business
 * that earned nothing, and KEY would say so with a straight face. A backwards
 * range does the same thing, just as convincingly.
 *
 * Every assertion below is therefore on WHETHER THE SERVICE WAS CALLED, not
 * merely on whether something threw. A handler that threw after already
 * querying would still have burned the query; a handler that returns zeros
 * without throwing is the actual defect.
 *
 * The service is stubbed rather than mocked-into-agreement: it records its
 * arguments so the tests can assert that real Dates arrived, and returns a
 * sentinel so the tests can assert the handler reports what the service said
 * rather than something it assembled itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const BIZ = 'biz_report_spec';

const REPORT_TOOLS = [
  'finance_profit_and_loss',
  'finance_cashflow',
  'finance_balance_sheet',
  'finance_tax_summary',
  'finance_revenue_breakdown',
  'finance_expense_breakdown',
] as const;

/** A sentinel per method, so a fabricated return cannot accidentally match. */
function makeLedgerStub() {
  const stub = {
    getPnl: vi.fn(async () => ({ __from: 'getPnl', netProfit: 4242 })),
    getCashflow: vi.fn(async () => ({ __from: 'getCashflow', netCashflow: 77 })),
    getBalanceSheet: vi.fn(async () => ({ __from: 'getBalanceSheet' })),
    getTaxSummary: vi.fn(async () => ({ __from: 'getTaxSummary', taxCollected: 9 })),
    getRevenueBy: vi.fn(async () => [{ __from: 'getRevenueBy', total: 5 }]),
    getExpenseBy: vi.fn(async () => [{ __from: 'getExpenseBy', total: 3 }]),
  };
  return stub;
}

let ledger: ReturnType<typeof makeLedgerStub>;
let svc: FlowOrchestratorService;

/** Total calls across every stubbed report method. */
const callCount = () =>
  Object.values(ledger).reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0);

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(BIZ, tool, args);
}

beforeEach(() => {
  ledger = makeLedgerStub();
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => ledger },
  }) as FlowOrchestratorService;
});

describe('the six ledger reports are reachable at all', () => {
  it('every one is registered', () => {
    for (const name of REPORT_TOOLS) {
      expect(getToolByName(name), `${name} is not in the registry`).toBeDefined();
    }
  });

  it('all six are reads, so none of them can change the books', () => {
    // A report tool that is not `read` would be gated behind approval for no
    // reason, and worse, would be counted as a write in the autonomy budget.
    for (const name of REPORT_TOOLS) {
      const tool = getToolByName(name)!;
      expect(tool.family, `${name} is not a read`).toBe('read');
      expect(tool.riskTier, `${name} is not tier 1`).toBe(1);
    }
  });

  it('none of them duplicates the two that already existed', () => {
    // finance_view_receivables and finance_view_payables already cover
    // getArAging and getApAging. Adding an aging tool here would give KEY two
    // tools for one question, which is how a model ends up asking twice and
    // reporting whichever answer came back last.
    const names = FLOW_TOOLS.map((t) => t.name);
    expect(names.filter((n) => /aging|receivable/i.test(n)).length).toBeLessThanOrEqual(2);
  });
});

describe('a report is what the ledger said, not what the handler assembled', () => {
  it('P&L returns the service result', async () => {
    const out = await run('finance_profit_and_loss', { from: '2026-01-01', to: '2026-03-31' });
    expect(ledger.getPnl).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ __from: 'getPnl', netProfit: 4242 });
  });

  it('cashflow returns the service result', async () => {
    const out = await run('finance_cashflow', { from: '2026-01-01', to: '2026-03-31' });
    expect(ledger.getCashflow).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ __from: 'getCashflow' });
  });

  it('balance sheet returns the service result', async () => {
    const out = await run('finance_balance_sheet', { asOfDate: '2026-03-31' });
    expect(ledger.getBalanceSheet).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ __from: 'getBalanceSheet' });
  });

  it('tax summary returns the service result', async () => {
    const out = await run('finance_tax_summary', { from: '2026-01-01', to: '2026-03-31' });
    expect(ledger.getTaxSummary).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ __from: 'getTaxSummary' });
  });

  it('the breakdowns pass real Date objects, not the raw strings', async () => {
    // LedgerReportingService takes Date, and TypeScript cannot see through
    // `args: Record<string, any>`. A string would reach Prisma and be compared
    // as text.
    await run('finance_revenue_breakdown', {
      dimension: 'customer',
      from: '2026-01-01',
      to: '2026-03-31',
    });
    const [, dimension, from, to] = ledger.getRevenueBy.mock.calls[0] as unknown as [
      string,
      string,
      Date,
      Date,
    ];
    expect(dimension).toBe('customer');
    expect(from, 'from arrived as something other than a Date').toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
    expect(from.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});

describe('an unreadable period is refused, never reported as zero', () => {
  it('rejects a date it cannot parse, without querying', async () => {
    await expect(
      run('finance_profit_and_loss', { from: 'last quarter', to: '2026-03-31' }),
    ).rejects.toThrow(/not a date I can read/i);

    // The load-bearing half. Throwing is not the point — NOT producing a
    // zeroed report is. A handler that queried and then threw would still have
    // asked the database a meaningless question.
    expect(callCount(), 'the ledger was queried with an invalid range').toBe(0);
  });

  it('rejects an unparseable `to` as well', async () => {
    await expect(
      run('finance_cashflow', { from: '2026-01-01', to: 'whenever' }),
    ).rejects.toThrow(/not a date I can read/i);
    expect(callCount()).toBe(0);
  });

  it('rejects a period that runs backwards', async () => {
    // Both dates parse. Both are real. The report is still all zeros, and that
    // is the version nobody would think to check.
    await expect(
      run('finance_tax_summary', { from: '2026-03-31', to: '2026-01-01' }),
    ).rejects.toThrow(/runs backwards/i);
    expect(callCount()).toBe(0);
  });

  it('rejects an unreadable asOfDate on the balance sheet', async () => {
    await expect(
      run('finance_balance_sheet', { asOfDate: 'end of days' }),
    ).rejects.toThrow(/not a date I can read/i);
    expect(callCount()).toBe(0);
  });

  it('rejects a basis that is neither accrual nor cash', async () => {
    await expect(
      run('finance_profit_and_loss', { from: '2026-01-01', to: '2026-03-31', basis: 'vibes' }),
    ).rejects.toThrow(/accrual/i);
    expect(callCount()).toBe(0);
  });

  // Negative control for all five above. Without it they would also pass
  // against a handler that refused every period it was ever given.
  it('accepts a period that is actually valid', async () => {
    await run('finance_profit_and_loss', { from: '2026-01-01', to: '2026-03-31', basis: 'cash' });
    expect(ledger.getPnl).toHaveBeenCalledTimes(1);
    expect(ledger.getPnl.mock.calls[0][3]).toBe('cash');
  });

  it('defaults the basis to accrual rather than guessing', async () => {
    await run('finance_cashflow', { from: '2026-01-01', to: '2026-03-31' });
    expect(ledger.getCashflow.mock.calls[0][3]).toBe('accrual');
  });
});

describe('a dimension outside the supported set is refused by name', () => {
  it('revenue breakdown rejects an unknown dimension', async () => {
    // getRevenueBy switches on the dimension and falls through to an empty
    // array for anything it does not recognise. Passing 'region' through would
    // return [] — "you have no revenue by region" rather than "I cannot break
    // revenue down by region".
    await expect(
      run('finance_revenue_breakdown', { dimension: 'region', from: '2026-01-01', to: '2026-03-31' }),
    ).rejects.toThrow(/must be one of/i);
    expect(callCount()).toBe(0);
  });

  it('expense breakdown rejects an unknown dimension', async () => {
    await expect(
      run('finance_expense_breakdown', { dimension: 'customer', from: '2026-01-01', to: '2026-03-31' }),
    ).rejects.toThrow(/must be one of/i);
    expect(callCount()).toBe(0);
  });

  it('but accepts every dimension the service actually implements', async () => {
    for (const d of ['customer', 'product', 'service', 'source']) {
      await run('finance_revenue_breakdown', { dimension: d, from: '2026-01-01', to: '2026-03-31' });
    }
    for (const d of ['vendor', 'category', 'project']) {
      await run('finance_expense_breakdown', { dimension: d, from: '2026-01-01', to: '2026-03-31' });
    }
    expect(ledger.getRevenueBy).toHaveBeenCalledTimes(4);
    expect(ledger.getExpenseBy).toHaveBeenCalledTimes(3);
  });
});
