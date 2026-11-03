/**
 * FOLLOW3-B4-EXPENSE-CURRENCY-CENTS (V1-82; VL-06, VL-07) — expenses and bills
 * default to the business currency and are stored and posted in whole cents
 * (REAL database, REAL routes behind the real AuthGuard / BusinessGuard /
 * ModuleScopeGuard / TenantInterceptor, REAL ledger door, REAL readers).
 *
 * At bb6b86d4, ExpensesService.createExpense wrote `amount: input.amount` and
 * `currency: input.currency ?? 'TTD'` (expenses.service.ts:159-160) and posted
 * both inside the same transaction (ExpensePostingService.onExpensePaid /
 * onBillCreated debit item.amount or expense.amount unrounded). updateExpense
 * stored a raw amount, currency and items, and RecurringExpenseService.create
 * stored `currency: input.currency ?? 'TTD'`. So a USD business's expenses,
 * bills and recurring expenses were TTD, and an amount of 12.345 was stored as
 * 12.345 and posted as 12.3450 while the cash position (rounded to cents) read
 * -12.35: the row, the ledger and the cockpit disagreed.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at bb6b86d4):
 *
 *   EC-01 RED-BEFORE POST /expenses/businesses/:usd/expenses {amount 25, cash}, no currency
 *         -> 'USD' (response and row), every posting entry USD, cash position -25 USD
 *   EC-02 RED-BEFORE ExpensesService.createExpense({businessId: usd, amount 7}) (the KEY
 *         finance adapter and flow orchestrator shape) -> USD
 *   EC-03 RED-BEFORE POST /finance/businesses/:usd/bills {amount 30} -> USD, AP posting USD
 *   EC-04 RED-BEFORE RecurringExpenseService.create({businessId: usd}) with no currency stores
 *         USD, and runOnce generates a USD expense posted in USD; the USD trial balance holds
 *         no TTD row
 *   EC-05 RED-BEFORE a named 'usd' on the USD business is stored 'USD'
 *   EC-06 controls: the TTD business defaults to TTD; a named 'USD' on the TTD business stays
 *         USD (D-13: a supported document currency); EUR answers 400 with no expense and no
 *         ledger row (commerce-currency CUR-09 unchanged)
 *   EC-07 RED-BEFORE amount 12.345 on TTD -> stored 12.35; financial_transactions.amount and
 *         both legs 12.35; ledger cash = cash position = -12.35
 *   EC-08 RED-BEFORE three expenses of 12.345 -> ledger cash net = cash position = -37.05
 *         (before: ledger -37.035 against a cash position of -37.04)
 *   EC-09 RED-BEFORE 1.00001 -> stored 1.00 against a ledger of 1.0000; a BILL of 7.005 ->
 *         7.01 stored, 7.01 on EXPENSE and on AP
 *   EC-10 RED-BEFORE amount 10 with items 3.333 / 6.667 -> items 3.33 / 6.67, the same legs,
 *         cash credited 10.00
 *   EC-11 RED-BEFORE PATCH {amount 5.555, items 2.225 / 3.334} on an unposted (0) expense ->
 *         5.56 and items 2.23 / 3.33
 *   EC-12 RED-BEFORE (behaviour note) 0.0001 rounds to a 0 expense with no posting, the
 *         existing <= 0 no-op of the posting recipes, instead of a 0.0001 posting
 *   EC-13 RED-BEFORE every stored expense amount, item amount, transaction amount and ledger
 *         leg of this suite is a whole cent
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, TeamAuditInterceptor, the global TenantInterceptor,
 * ExpensesController, BillsController, ExpensesService, RecurringExpenseService,
 * ExpensePostingService, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService, LedgerBalanceService and CashPositionService
 * read and write real rows, with the production GlobalHttpExceptionFilter and
 * ValidationPipe({ whitelist, transform }). Identity attachment is the one
 * stand-in (`x-v82d-user`, as the Supabase-verifying AuthMiddleware would).
 * EventEmitter2, the timeline and DocumentIntelligenceService (receipt OCR,
 * off every path here) are stubs.
 *
 * Fixtures: prefix `v82d_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and
 * afterAll; no $transaction wrapping. Server-created rows hang off the prefixed
 * businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82d_';
const HEADER = 'x-v82d-user';

const ID = {
  owner: `${P}owner`,
  bizT: `${P}bizTtd`, // TTD: the controls and the cents cases
  bizU: `${P}bizUsd`, // USD: the currency default cases
  bizC7: `${P}bizC7`, // TTD: EC-07 alone, so its cash figures are absolute
  bizC8: `${P}bizC8`, // TTD: EC-08 alone
};
const BUSINESSES = [
  [ID.bizT, 'TTD'],
  [ID.bizU, 'USD'],
  [ID.bizC7, 'TTD'],
  [ID.bizC8, 'TTD'],
] as const;

let db: any;
let app: any;
let expenses: any;
let recurring: any;
let ledgerBalance: any;
let cashPosition: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function postExpense(businessId: string, body: Record<string, unknown>) {
  return agent().post(`/expenses/businesses/${businessId}/expenses`).set(HEADER, ID.owner).send(body);
}

function patchExpense(businessId: string, expenseId: string, body: Record<string, unknown>) {
  return agent().patch(`/expenses/businesses/${businessId}/expenses/${expenseId}`).set(HEADER, ID.owner).send(body);
}

function postBill(businessId: string, body: Record<string, unknown>) {
  return agent().post(`/finance/businesses/${businessId}/bills`).set(HEADER, ID.owner).send(body);
}

/** The expense's postings with their entries and each entry's chart row. */
async function txnsOf(expenseId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { sourceType: 'Expense', sourceId: expenseId },
    include: { entries: { include: { account: { select: { systemKey: true, type: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
}

async function ledgerCounts(businessId: string): Promise<{ txns: number; entries: number }> {
  return {
    txns: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

/**
 * LEDGER, independent of every reader under test: the net (debit - credit) of
 * the business's cash-class entries in `currency`, summed by Postgres in
 * numeric and NOT rounded, so a sub-cent ledger shows as such.
 */
async function ledgerCash(businessId: string, currency: string): Promise<number> {
  const rows: Array<{ net: string }> = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(le.debit - le.credit), 0)::text AS net
       FROM ledger_entries le
       JOIN chart_of_accounts coa ON coa.id = le.account_id
      WHERE le.business_id = $1
        AND coa.business_id = $1
        AND coa.system_key IN ('CASH', 'BANK', 'PAYMENT_PROCESSOR')
        AND UPPER(TRIM(le.currency)) = $2`,
    businessId,
    currency,
  );
  return Number(rows[0].net);
}

/** True when `value` (a number or a numeric/Decimal string) is a whole number of cents. */
function isCent(value: unknown): boolean {
  const cents = Number(String(value)) * 100;
  return Number.isFinite(cents) && Math.abs(cents - Math.round(cents)) < 1e-6;
}

const num = (v: unknown) => Number(String(v));

/** The legs of a posting as [systemKey or type, side, amount], sorted. */
function legs(txn: any): Array<[string, 'Dr' | 'Cr', number]> {
  return txn.entries
    .map((e: any): [string, 'Dr' | 'Cr', number] => {
      const key = e.account.systemKey ?? e.account.type;
      return num(e.debit) > 0 ? [key, 'Dr', num(e.debit)] : [key, 'Cr', num(e.credit)];
    })
    .sort((a: any, b: any) => `${a[0]}${a[1]}${a[2]}`.localeCompare(`${b[0]}${b[1]}${b[2]}`));
}

function expectAllIn(txns: any[], currency: string) {
  expect(txns.length, 'the expense was posted').toBeGreaterThan(0);
  for (const t of txns) {
    expect(t.currency, `${t.externalRef} currency`).toBe(currency);
    for (const e of t.entries) expect(e.currency, `${t.externalRef} entry currency`).toBe(currency);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
  const { BillsController } = await import('../src/modules/expenses/bills.controller');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { RecurringExpenseService } = await import('../src/modules/expenses/recurring-expense.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [ExpensesController, BillsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TeamAuditInterceptor,
      ExpensesService,
      RecurringExpenseService,
      ExpensePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      CashPositionService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      // Receipt OCR: off every path exercised here.
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  }).compile();
  expenses = moduleRef.get(ExpensesService);
  recurring = moduleRef.get(RecurringExpenseService);
  ledgerBalance = moduleRef.get(LedgerBalanceService);
  cashPosition = moduleRef.get(CashPositionService);
  const coa = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  for (const [biz, currency] of BUSINESSES) {
    await db.business.create({ data: { id: biz, name: `V82D ${biz}`, ownerId: ID.owner, currency } });
    await db.membership.create({ data: { id: `${biz}_m`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded a TTD and a USD business with a chart of accounts and no ledger rows', async () => {
    for (const [biz, currency] of BUSINESSES) {
      expect((await db.business.findUnique({ where: { id: biz } })).currency, biz).toBe(currency);
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } }), biz).toBeGreaterThan(0);
      expect(await ledgerCounts(biz), biz).toEqual({ txns: 0, entries: 0 });
    }
  });
});

describe('VL-06: expenses and bills default to the business currency (D-13)', () => {
  it('EC-01: POST an expense on the USD business with no currency -> USD row, USD postings, cash position -25 USD', async () => {
    const res = await postExpense(ID.bizU, { description: `${P}ec01 cash`, amount: 25, paymentMethod: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.currency).toBe('USD');
    expect((await db.expense.findUnique({ where: { id: res.body.id } })).currency).toBe('USD');
    expectAllIn(await txnsOf(res.body.id), 'USD');

    const position = await cashPosition.getCashPosition(ID.bizU);
    expect(position.currency).toBe('USD');
    expect(position.byCurrency, 'no TTD cash on a USD business').toEqual({ USD: -25 });
    expect(position.cashBalance).toBe(-25);
    expect(await ledgerCash(ID.bizU, 'USD')).toBe(-25);
  });

  it('EC-02: ExpensesService.createExpense with no currency (the KEY and flow shape) -> USD', async () => {
    const exp = await expenses.createExpense({ businessId: ID.bizU, description: `${P}ec02 key shape`, amount: 7 });
    expect(exp.currency).toBe('USD');
    expectAllIn(await txnsOf(exp.id), 'USD');
  });

  it('EC-03: POST /finance/businesses/:usd/bills with no currency -> USD; the AP posting is USD', async () => {
    const res = await postBill(ID.bizU, { description: `${P}ec03 bill`, amount: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('BILL');
    expect(res.body.currency).toBe('USD');
    const txns = await txnsOf(res.body.id);
    expect(txns.map((t) => t.externalRef)).toEqual([`Expense:${res.body.id}:bill_created`]);
    expectAllIn(txns, 'USD');
    expect(legs(txns[0])).toEqual([['ACCOUNTS_PAYABLE', 'Cr', 30], ['EXPENSE_GENERAL', 'Dr', 30]]);
  });

  it('EC-04: a recurring expense created with no currency on the USD business stores USD and generates a USD expense; the USD trial balance holds no TTD row', async () => {
    const schedule = await recurring.create({
      businessId: ID.bizU,
      name: `${P}ec04 schedule`,
      frequency: 'MONTHLY',
      nextRunDate: new Date(),
      description: `${P}ec04 recurring`,
      amount: 12,
      paymentMethod: 'cash',
    });
    expect(schedule.currency).toBe('USD');
    await recurring.runOnce(schedule.id, ID.bizU);
    const generated = await db.expense.findMany({ where: { businessId: ID.bizU, recurringExpenseId: schedule.id } });
    expect(generated).toHaveLength(1);
    expect(generated[0].currency).toBe('USD');
    expectAllIn(await txnsOf(generated[0].id), 'USD');

    const tb = await ledgerBalance.getTrialBalance(ID.bizU);
    expect(tb.filter((r: any) => r.currency !== 'USD').map((r: any) => `${r.name} ${r.currency} ${r.debit}/${r.credit}`)).toEqual([]);
    const debit = tb.reduce((s: number, r: any) => s + num(r.debit), 0);
    const credit = tb.reduce((s: number, r: any) => s + num(r.credit), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  });

  it("EC-05: a named 'usd' on the USD business is stored 'USD'", async () => {
    const res = await postExpense(ID.bizU, { description: `${P}ec05 lower`, amount: 5, currency: 'usd', paymentMethod: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.currency).toBe('USD');
    expect((await db.expense.findUnique({ where: { id: res.body.id } })).currency).toBe('USD');
    expectAllIn(await txnsOf(res.body.id), 'USD');
  });

  it('EC-06 controls: the TTD business defaults to TTD; a named USD stays USD (D-13); EUR -> 400, no expense, no ledger row (CUR-09)', async () => {
    const ttd = await postExpense(ID.bizT, { description: `${P}ec06 default`, amount: 9, paymentMethod: 'cash' });
    expect(ttd.status, JSON.stringify(ttd.body)).toBe(201);
    expect(ttd.body.currency).toBe('TTD');
    expectAllIn(await txnsOf(ttd.body.id), 'TTD');

    const usd = await postExpense(ID.bizT, { description: `${P}ec06 usd`, amount: 11, currency: 'USD', paymentMethod: 'cash' });
    expect(usd.status, JSON.stringify(usd.body)).toBe(201);
    expect(usd.body.currency).toBe('USD');
    expectAllIn(await txnsOf(usd.body.id), 'USD');

    const before = await ledgerCounts(ID.bizT);
    const eur = await postExpense(ID.bizT, { description: `${P}ec06 eur`, amount: 13, currency: 'EUR', paymentMethod: 'cash' });
    expect(eur.status, JSON.stringify(eur.body)).toBe(400);
    expect(await db.expense.count({ where: { businessId: ID.bizT, description: `${P}ec06 eur` } })).toBe(0);
    expect(await ledgerCounts(ID.bizT)).toEqual(before);
  });
});

describe('VL-07: expense and bill amounts are stored and posted in whole cents (V1-22 rule)', () => {
  it('EC-07: amount 12.345 -> 12.35 stored; the transaction and both legs 12.35; ledger cash = cash position = -12.35', async () => {
    const res = await postExpense(ID.bizC7, { description: `${P}ec07 half cent`, amount: 12.345, paymentMethod: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.amount).toBe(12.35);
    expect((await db.expense.findUnique({ where: { id: res.body.id } })).amount).toBe(12.35);
    const [txn, ...rest] = await txnsOf(res.body.id);
    expect(rest).toEqual([]);
    expect(num(txn.amount)).toBe(12.35);
    expect(legs(txn)).toEqual([['CASH', 'Cr', 12.35], ['EXPENSE_GENERAL', 'Dr', 12.35]]);

    expect(await ledgerCash(ID.bizC7, 'TTD')).toBe(-12.35);
    expect((await cashPosition.getCashPosition(ID.bizC7)).cashBalance).toBe(-12.35);
  });

  it('EC-08: three expenses of 12.345 -> ledger cash net = cash position = -37.05', async () => {
    for (const n of [1, 2, 3]) {
      const res = await postExpense(ID.bizC8, { description: `${P}ec08 #${n}`, amount: 12.345, paymentMethod: 'cash' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const ledger = await ledgerCash(ID.bizC8, 'TTD');
    const position = (await cashPosition.getCashPosition(ID.bizC8)).cashBalance;
    expect({ ledger, position }).toEqual({ ledger: -37.05, position: -37.05 });
  });

  it('EC-09: 1.00001 -> 1.00 stored against a ledger of 1.0000; a BILL of 7.005 -> 7.01 stored and on EXPENSE and AP', async () => {
    const res = await postExpense(ID.bizT, { description: `${P}ec09 tiny`, amount: 1.00001, paymentMethod: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await db.expense.findUnique({ where: { id: res.body.id } })).amount).toBe(1);
    const [txn] = await txnsOf(res.body.id);
    expect(num(txn.amount)).toBe(1);
    expect(legs(txn)).toEqual([['CASH', 'Cr', 1], ['EXPENSE_GENERAL', 'Dr', 1]]);

    const bill = await postBill(ID.bizT, { description: `${P}ec09 bill`, amount: 7.005 });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.amount).toBe(7.01);
    expect((await db.expense.findUnique({ where: { id: bill.body.id } })).amount).toBe(7.01);
    const [billTxn] = await txnsOf(bill.body.id);
    expect(legs(billTxn)).toEqual([['ACCOUNTS_PAYABLE', 'Cr', 7.01], ['EXPENSE_GENERAL', 'Dr', 7.01]]);
  });

  it('EC-10: amount 10 with items 3.333 / 6.667 -> items 3.33 / 6.67 stored and posted; cash credited 10.00', async () => {
    const res = await postExpense(ID.bizT, {
      description: `${P}ec10 split`,
      amount: 10,
      paymentMethod: 'cash',
      items: [
        { amount: 3.333, description: `${P}ec10 a` },
        { amount: 6.667, description: `${P}ec10 b` },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await db.expense.findUnique({ where: { id: res.body.id } });
    expect(row.amount).toBe(10);
    expect((row.items as any[]).map((i) => i.amount)).toEqual([3.33, 6.67]);
    const [txn] = await txnsOf(res.body.id);
    expect(legs(txn)).toEqual([['CASH', 'Cr', 10], ['EXPENSE_GENERAL', 'Dr', 3.33], ['EXPENSE_GENERAL', 'Dr', 6.67]]);
    expect(num(txn.amount)).toBe(10);
  });

  it('EC-11: PATCH {amount 5.555, items 2.225 / 3.334} on an unposted (0) expense -> 5.56 and items 2.23 / 3.33', async () => {
    const zero = await postExpense(ID.bizT, { description: `${P}ec11 zero`, amount: 0, paymentMethod: 'cash' });
    expect(zero.status, JSON.stringify(zero.body)).toBe(201);
    expect(await txnsOf(zero.body.id), 'a 0 expense posts nothing').toEqual([]);

    const res = await patchExpense(ID.bizT, zero.body.id, {
      amount: 5.555,
      items: [
        { amount: 2.225, description: `${P}ec11 a` },
        { amount: 3.334, description: `${P}ec11 b` },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.amount).toBe(5.56);
    const row = await db.expense.findUnique({ where: { id: zero.body.id } });
    expect(row.amount).toBe(5.56);
    expect((row.items as any[]).map((i) => i.amount)).toEqual([2.23, 3.33]);
    for (const t of await txnsOf(zero.body.id)) {
      expect(isCent(t.amount), `${t.externalRef} amount ${t.amount}`).toBe(true);
      for (const e of t.entries) expect(isCent(e.debit) && isCent(e.credit), `${t.externalRef} leg ${e.debit}/${e.credit}`).toBe(true);
    }
  });

  it('EC-12 (behaviour note): 0.0001 rounds to a 0 expense with no posting (the posting recipes\' <= 0 no-op)', async () => {
    const res = await postExpense(ID.bizT, { description: `${P}ec12 dust`, amount: 0.0001, paymentMethod: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await db.expense.findUnique({ where: { id: res.body.id } })).amount).toBe(0);
    expect(await txnsOf(res.body.id)).toEqual([]);
  });

  it('EC-13: every stored expense amount, item amount, transaction amount and ledger leg of this suite is a whole cent', async () => {
    const businessIds = BUSINESSES.map(([b]) => b);
    const problems: string[] = [];
    for (const e of await db.expense.findMany({ where: { businessId: { in: businessIds } } })) {
      if (!isCent(e.amount)) problems.push(`expense ${e.description} amount ${e.amount}`);
      for (const item of (Array.isArray(e.items) ? e.items : []) as any[]) {
        if (!isCent(item.amount)) problems.push(`expense ${e.description} item ${item.amount}`);
      }
    }
    for (const t of await db.financialTransaction.findMany({ where: { businessId: { in: businessIds } }, include: { entries: true } })) {
      if (!isCent(t.amount)) problems.push(`${t.externalRef} amount ${t.amount}`);
      for (const le of t.entries) if (!isCent(le.debit) || !isCent(le.credit)) problems.push(`${t.externalRef} leg ${le.debit}/${le.credit}`);
    }
    expect(problems).toEqual([]);
  });
});
