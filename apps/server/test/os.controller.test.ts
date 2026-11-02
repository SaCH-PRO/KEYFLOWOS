import { describe, expect, it } from 'vitest';
import { OsController } from '../src/modules/os/os.controller';
import { OsService } from '../src/modules/os/os.service';
import { CommandService } from '../src/modules/command/command.service';

/**
 * One stored ledger row as the mock serves it: the LedgerEntry, its
 * FinancialTransaction's status and its ChartOfAccount's systemKey.
 */
interface LedgerRow {
  businessId: string;
  accountId: string;
  debit: number;
  credit: number;
  status: 'POSTED' | 'REVERSED' | 'VOID' | 'DRAFT';
}

/** The chart-of-account rows of both tenants. */
const COA = [
  { id: 'coa_cash', businessId: 'biz_1', systemKey: 'CASH', name: 'Cash', type: 'ASSET' },
  { id: 'coa_bank', businessId: 'biz_1', systemKey: 'BANK', name: 'Bank Account', type: 'ASSET' },
  { id: 'coa_proc', businessId: 'biz_1', systemKey: 'PAYMENT_PROCESSOR', name: 'Payment Processor Clearing', type: 'ASSET' },
  { id: 'coa_ar', businessId: 'biz_1', systemKey: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', type: 'ASSET' },
  { id: 'coa_card', businessId: 'biz_1', systemKey: 'CREDIT_CARD', name: 'Credit Card', type: 'LIABILITY' },
  { id: 'coa_equity', businessId: 'biz_1', systemKey: 'OWNER_EQUITY', name: 'Owner Equity', type: 'EQUITY' },
  { id: 'coa_cash_b', businessId: 'biz_2', systemKey: 'CASH', name: 'Cash', type: 'ASSET' },
];

/** An opening balance of 1000 posted through the door: DR CASH / CR OWNER_EQUITY. */
const OPENING: LedgerRow[] = [
  { businessId: 'biz_1', accountId: 'coa_cash', debit: 1000, credit: 0, status: 'POSTED' },
  { businessId: 'biz_1', accountId: 'coa_equity', debit: 0, credit: 1000, status: 'POSTED' },
];

function inList(value: unknown, filter: any): boolean {
  if (filter === undefined) return true;
  if (filter && typeof filter === 'object' && Array.isArray(filter.in)) return filter.in.includes(value);
  return value === filter;
}

/** Applies the LedgerEntry where-filters the readers use (businessId, accountId, transaction.status). */
function matches(row: LedgerRow, where: any = {}): boolean {
  if (!inList(row.businessId, where.businessId)) return false;
  if (!inList(row.accountId, where.accountId)) return false;
  if (where.transaction?.status !== undefined && !inList(row.status, where.transaction.status)) return false;
  return true;
}

/** A FinancialAccount row (the Books > Accounts record) as the mock serves it. */
interface AccountRow {
  id: string;
  businessId: string;
  name: string;
  type: string;
  isActive: boolean;
  openingBalance: number;
  currentBalance: number;
}

/** A FinancialTransaction header as the mock serves it (the opening-posting lookup). */
interface TxnRow {
  businessId: string;
  type: string;
  sourceType: string;
  sourceId: string;
  status: 'POSTED' | 'REVERSED' | 'VOID' | 'DRAFT';
}

class PrismaServiceMock {
  readonly ledgerReads: any[] = [];
  readonly accountReads: any[] = [];
  readonly txnReads: any[] = [];
  readonly client: any;

  constructor(opts: { ledger?: LedgerRow[]; currentBalance?: number; accounts?: AccountRow[]; transactions?: TxnRow[] } = {}) {
    const ledger = opts.ledger ?? OPENING;
    const currentBalance = opts.currentBalance ?? 1000;
    const sum = (rows: LedgerRow[]) => ({
      debit: rows.reduce((s, r) => s + r.debit, 0),
      credit: rows.reduce((s, r) => s + r.credit, 0),
    });
    this.client = {
      business: {
        findUnique: async () => ({ id: 'biz_1', name: 'Test Biz', currency: 'TTD' }),
      },
      financialAccount: {
        findMany: async (args: any = {}) => {
          this.accountReads.push(args);
          // The stale opening snapshot: never written after the account is created.
          if (!opts.accounts) return [{ currentBalance, chartOfAccountId: 'coa_cash', type: 'CASH', isActive: true }];
          const w = args.where ?? {};
          return opts.accounts.filter((a) => inList(a.businessId, w.businessId) && inList(a.isActive, w.isActive) && inList(a.type, w.type));
        },
      },
      financialTransaction: {
        findMany: async (args: any = {}) => {
          this.txnReads.push(args);
          const w = args.where ?? {};
          return (opts.transactions ?? [])
            .filter((t) => inList(t.businessId, w.businessId) && inList(t.type, w.type) && inList(t.sourceType, w.sourceType)
              && inList(t.sourceId, w.sourceId) && inList(t.status, w.status))
            .map((t) => ({ sourceId: t.sourceId }));
        },
      },
      invoice: {
        aggregate: async () => ({ _sum: { total: 500 }, _count: 2 }),
      },
      expense: {
        aggregate: async () => ({ _sum: { amount: 100 } }),
      },
      chartOfAccount: {
        findFirst: async () => null,
        findMany: async (args: any = {}) => COA.filter((a) => {
          const w = args.where ?? {};
          return inList(a.businessId, w.businessId) && inList(a.systemKey, w.systemKey) && inList(a.id, w.id) && inList(a.type, w.type);
        }),
      },
      ledgerEntry: {
        aggregate: async (args: any = {}) => {
          this.ledgerReads.push(args);
          return { _sum: sum(ledger.filter((r) => matches(r, args.where))) };
        },
        groupBy: async (args: any = {}) => {
          this.ledgerReads.push(args);
          const rows = ledger.filter((r) => matches(r, args.where));
          const ids = Array.from(new Set(rows.map((r) => r.accountId)));
          return ids.map((accountId) => ({ accountId, _sum: sum(rows.filter((r) => r.accountId === accountId)) }));
        },
      },
      booking: {
        count: async () => 3,
      },
      projectTask: {
        count: async () => 1,
      },
      contact: {
        count: async () => 10,
      },
      deal: {
        count: async () => 2,
        aggregate: async () => ({ _sum: { value: 5000 } }),
      },
      quote: {
        count: async () => 1,
      },
      project: {
        count: async () => 2,
      },
      aiApprovalItem: {
        count: async () => 0,
      },
      commandItem: {
        count: async () => 5,
        groupBy: async () => [{ category: 'MONEY', _count: { category: 3 } }],
      },
    };
  }
}

class TimelineServiceMock {
  async recordEvent(_input: any) { return { id: 'evt_1' }; }
}

class NotificationsServiceMock {
  async create(_input: any) { return { id: 'notif_1' }; }
}

function build(prisma: PrismaServiceMock) {
  const commandService = new CommandService(prisma as any, new TimelineServiceMock() as any, new NotificationsServiceMock() as any, { emit: () => {} } as any);
  const osService = new OsService(prisma as any, commandService as any);
  return new OsController(osService as any);
}

describe('OsController command-center', () => {
  const controller = build(new PrismaServiceMock());

  it('returns command center data', async () => {
    const result = await controller.commandCenter('biz_1');
    expect(result.business.id).toBe('biz_1');
    expect(result.health.overallScore).toBeDefined();
    expect(result.today.priorityCommands).toBeDefined();
    expect(result.flows.financial.cashBalance).toBe(1000);
  });
});

/**
 * V1-34-DM-CASH-POSITION (CF-41): the OS status cash is the ledger's, not the
 * FinancialAccount.currentBalance snapshot (written once at create, never
 * updated). The real-database proof is test/cash-position.integration.test.ts.
 */
describe('V1-34 OS status cash is ledger-derived', () => {
  it('OS-34-01: a 100 payment posted to CASH moves cash to 1100 while currentBalance stays a stale 1000; labelled ledger', async () => {
    const prisma = new PrismaServiceMock({
      currentBalance: 1000,
      ledger: [
        ...OPENING,
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 100, credit: 0, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_ar', debit: 0, credit: 100, status: 'POSTED' },
      ],
    });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(1100);
    expect(result.flows.financial.cashBasis).toBe('ledger');
  });

  it('OS-34-02: a REVERSED payment beside its POSTED REVERSAL nets to zero (both are read)', async () => {
    const prisma = new PrismaServiceMock({
      ledger: [
        ...OPENING,
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 100, credit: 0, status: 'REVERSED' },
        { businessId: 'biz_1', accountId: 'coa_ar', debit: 0, credit: 100, status: 'REVERSED' },
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 0, credit: 100, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_ar', debit: 100, credit: 0, status: 'POSTED' },
      ],
    });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(1000);
  });

  it('OS-34-03: only CASH/BANK/PAYMENT_PROCESSOR rows count; credit card, AR, equity, unbooked and foreign rows do not', async () => {
    const prisma = new PrismaServiceMock({
      ledger: [
        ...OPENING,
        { businessId: 'biz_1', accountId: 'coa_bank', debit: 250, credit: 0, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_proc', debit: 30, credit: 0, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_card', debit: 0, credit: 40, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_ar', debit: 75, credit: 0, status: 'POSTED' },
        // Not booked: a VOID or DRAFT transaction is not in the books.
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 999, credit: 0, status: 'VOID' },
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 888, credit: 0, status: 'DRAFT' },
        // Another tenant's cash.
        { businessId: 'biz_2', accountId: 'coa_cash_b', debit: 5000, credit: 0, status: 'POSTED' },
      ],
    });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(1280);
    // Every ledger read is scoped to the guarded business.
    expect(prisma.ledgerReads.length).toBeGreaterThan(0);
    for (const read of prisma.ledgerReads) expect(read.where?.businessId).toBe('biz_1');
  });

  it('OS-34-04: cents-safe: three 0.10 cash expenses after a 0.30 receipt leave exactly the opening 1000', async () => {
    const prisma = new PrismaServiceMock({
      ledger: [
        ...OPENING,
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 0.1, credit: 0, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 0.2, credit: 0, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 0, credit: 0.1, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 0, credit: 0.1, status: 'POSTED' },
        { businessId: 'biz_1', accountId: 'coa_cash', debit: 0, credit: 0.1, status: 'POSTED' },
      ],
    });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(1000);
  });
});

/**
 * V1-34 review CR-34-01: an opening balance entered on an account (Books >
 * Accounts; FinanceAccountsService.create writes the row and posts nothing)
 * counts until an OPENING_BALANCE posting sourced from that account is in the
 * books, and is never counted twice.
 */
describe('V1-34 OS status cash bridges an unposted account opening balance', () => {
  const ACCOUNTS: AccountRow[] = [
    { id: 'fa_bank', businessId: 'biz_1', name: 'Bank', type: 'BANK', isActive: true, openingBalance: 10000, currentBalance: 10000 },
    // Not cash: a liability, an archived till, another tenant's bank.
    { id: 'fa_card', businessId: 'biz_1', name: 'Card', type: 'CREDIT_CARD', isActive: true, openingBalance: 300, currentBalance: 300 },
    { id: 'fa_old', businessId: 'biz_1', name: 'Old till', type: 'CASH', isActive: false, openingBalance: 50, currentBalance: 50 },
    { id: 'fa_b', businessId: 'biz_2', name: 'Bank B', type: 'BANK', isActive: true, openingBalance: 7000, currentBalance: 7000 },
  ];
  const OPENING_POSTED: LedgerRow[] = [
    { businessId: 'biz_1', accountId: 'coa_bank', debit: 10000, credit: 0, status: 'POSTED' },
    { businessId: 'biz_1', accountId: 'coa_equity', debit: 0, credit: 10000, status: 'POSTED' },
  ];

  it('OS-34-05: an unposted 10000 opening reads 10000 (money health Healthy), not 0; other rows are not cash', async () => {
    const prisma = new PrismaServiceMock({ ledger: [], accounts: ACCOUNTS, transactions: [] });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(10000);
    expect(result.flows.financial.cashBasis).toBe('ledger');
    expect(result.health.money).toMatchObject({ score: 100, label: 'Healthy' });
    for (const read of [...prisma.accountReads, ...prisma.txnReads]) expect(read.where?.businessId).toBe('biz_1');
  });

  it('OS-34-06: once the opening is posted (OPENING_BALANCE sourced from the account) it is read from the ledger only, never twice', async () => {
    const prisma = new PrismaServiceMock({
      ledger: [...OPENING_POSTED, { businessId: 'biz_1', accountId: 'coa_bank', debit: 100, credit: 0, status: 'POSTED' }],
      accounts: ACCOUNTS,
      transactions: [{ businessId: 'biz_1', type: 'OPENING_BALANCE', sourceType: 'FinancialAccount', sourceId: 'fa_bank', status: 'POSTED' }],
    });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(10100);
  });

  it('OS-34-07: an unbooked or foreign-tenant posting does not mark the opening as posted', async () => {
    const prisma = new PrismaServiceMock({
      ledger: [],
      accounts: ACCOUNTS,
      transactions: [
        { businessId: 'biz_1', type: 'OPENING_BALANCE', sourceType: 'FinancialAccount', sourceId: 'fa_bank', status: 'VOID' },
        { businessId: 'biz_2', type: 'OPENING_BALANCE', sourceType: 'FinancialAccount', sourceId: 'fa_bank', status: 'POSTED' },
      ],
    });
    const result: any = await build(prisma).commandCenter('biz_1');
    expect(result.flows.financial.cashBalance).toBe(10000);
  });
});
