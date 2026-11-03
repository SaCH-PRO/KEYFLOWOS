/**
 * FOLLOW3-B7-EXPENSE-EDIT-POSTED (V1-82; owner ruling D-67) — an expense edit
 * never leaves its row and its ledger posting disagreeing (REAL database, REAL
 * routes behind the real AuthGuard / BusinessGuard / ModuleScopeGuard /
 * TenantInterceptor, REAL ledger door, REAL readers).
 *
 * At bb6b86d4, ExpensesService.updateExpense (expenses.service.ts:508-573)
 * copied amount, currency and items into expense.update with no posting call,
 * while createExpense posts in the same transaction and deleteExpense refuses a
 * posted expense ("void it"). So PATCH {amount: 40} on a posted 25 cash expense
 * answered 200 with a row of 40 over a ledger (and a cash position) of 25.
 *
 * D-67: a posted expense refuses amount, items and currency edits with 409
 * (void it and record a new one); everything else on it stays editable, and a
 * PATCH that restates the stored amount or currency is not a change. On the
 * expense detail page, Approve pays a BILL through POST bills/:id/pay and
 * Reject voids it through POST bills/:id/void (the web half is in
 * apps/web/src/app/app/expenses/__tests__/expense-detail-actions.test.tsx;
 * the doors it now calls are pinned here).
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at bb6b86d4):
 *
 *   EE-01 RED-BEFORE PATCH {amount 40} on a posted 25 cash expense -> 409, nothing written
 *         (row, FinancialTransaction and LedgerEntry byte-identical); ledger and cash 25
 *   EE-02 RED-BEFORE PATCH {items} changing the total of a posted BILL of 30 -> 409, AP 30
 *   EE-03 RED-BEFORE PATCH {currency 'USD'} on a posted TTD expense -> 409, legs stay TTD
 *   EE-04 RED-BEFORE ExpensesService.updateExpense({amount}) (the service door the KEY finance
 *         adapter calls) on a posted expense -> ConflictException (409), nothing written
 *   EE-05 controls -> 200 as today: PATCH {description, vendor, notes, categoryId, tags} on a
 *         posted expense; PATCH restating the stored amount and currency (and the web edit
 *         form's whole payload); the KEY categorize shape; any edit on an unposted row (a
 *         DRAFT row with no posting). RED-BEFORE: an unposted 0 PAID expense edited to 15
 *         answers 200 and is now posted once (Dr expense / Cr cash 15), so its row and ledger
 *         agree (before: a row of 15 over no posting)
 *   EE-06 the Approve door: POST bills/:id/pay on a BILL posts bill_paid once (Dr AP / Cr cash),
 *         a second pay writes nothing, the actor is recorded by the audit interceptor
 *   EE-07 the Reject door: POST bills/:id/void reverses the bill's AP posting through the door,
 *         AP nets to zero, the actor is recorded
 *   After every case: each booked (PAID/BILL) expense's ledger net on its expense accounts
 *   equals its stored amount, and the cash position equals the independent ledger cash net.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, TeamAuditInterceptor, the global TenantInterceptor,
 * ExpensesController, BillsController, ExpensesService, ExpensePostingService,
 * PostingService, AccountingPeriodService, ChartOfAccountsSeederService,
 * LedgerBalanceService and CashPositionService read and write real rows, with
 * the production GlobalHttpExceptionFilter and ValidationPipe({ whitelist,
 * transform }). Identity attachment is the one stand-in (`x-v82g-user`).
 * EventEmitter2, the timeline and DocumentIntelligenceService are stubs.
 *
 * Fixtures: prefix `v82g_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and
 * afterAll; no $transaction wrapping. afterAll asserts 0 rows are left.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82g_';
const HEADER = 'x-v82g-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`, // TTD
  category: `${P}category`,
  draft: `${P}draft`,
};

const POSTED_REFUSAL = /Cannot change the amount or currency of a posted expense: void it and record a new one/;

let db: any;
let app: any;
let expenses: any;
let cashPosition: any;
let ledgerBalance: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

const CLEANUP = [
  `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
  `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
];

async function cleanup() {
  for (const sql of CLEANUP) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Rows this suite left behind, per table (afterAll: all zero). */
async function leftovers(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const sql of CLEANUP) {
    const select = sql.replace(/^DELETE FROM (\w+) WHERE/, 'SELECT COUNT(*)::int AS n FROM $1 WHERE');
    const table = /^DELETE FROM (\w+)/.exec(sql)![1];
    const rows: Array<{ n: number }> = await db.$queryRawUnsafe(select);
    out[table] = rows[0].n;
  }
  return out;
}

function agent() {
  return request(app.getHttpServer());
}

function postExpense(body: Record<string, unknown>) {
  return agent().post(`/expenses/businesses/${ID.biz}/expenses`).set(HEADER, ID.owner).send(body);
}

function patchExpense(expenseId: string, body: Record<string, unknown>) {
  return agent().patch(`/expenses/businesses/${ID.biz}/expenses/${expenseId}`).set(HEADER, ID.owner).send(body);
}

function postBill(body: Record<string, unknown>) {
  return agent().post(`/finance/businesses/${ID.biz}/bills`).set(HEADER, ID.owner).send(body);
}

function payBill(billId: string) {
  return agent().post(`/finance/businesses/${ID.biz}/bills/${billId}/pay`).set(HEADER, ID.owner).send({});
}

function voidBill(billId: string) {
  return agent().post(`/finance/businesses/${ID.biz}/bills/${billId}/void`).set(HEADER, ID.owner).send({});
}

async function txnsOf(expenseId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { sourceType: 'Expense', sourceId: expenseId },
    include: { entries: { include: { account: { select: { systemKey: true, type: true } } }, orderBy: { id: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
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

/** Everything an edit could write: the row, and the business's ledger rows. */
async function snapshot(expenseId: string): Promise<string> {
  const row = await db.expense.findUnique({ where: { id: expenseId } });
  const txns = await db.financialTransaction.findMany({ where: { businessId: ID.biz }, orderBy: { id: 'asc' } });
  const entries = await db.ledgerEntry.findMany({ where: { businessId: ID.biz }, orderBy: { id: 'asc' } });
  return JSON.stringify({ row, txns, entries });
}

/** The independent ledger cash net of the business (numeric, unrounded). */
async function ledgerCash(): Promise<number> {
  const rows: Array<{ net: string }> = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(le.debit - le.credit), 0)::text AS net
       FROM ledger_entries le
       JOIN chart_of_accounts coa ON coa.id = le.account_id
      WHERE le.business_id = $1
        AND coa.business_id = $1
        AND coa.system_key IN ('CASH', 'BANK', 'PAYMENT_PROCESSOR')`,
    ID.biz,
  );
  return Number(rows[0].net);
}

/** The expense's net on EXPENSE-type accounts across all its postings (reversals net to zero). */
async function ledgerExpenseNet(expenseId: string): Promise<number> {
  let net = 0;
  for (const t of await txnsOf(expenseId)) {
    for (const e of t.entries) if (e.account.type === 'EXPENSE') net += num(e.debit) - num(e.credit);
  }
  return Math.round(net * 10000) / 10000;
}

/** The packet's invariant: every booked expense agrees with its ledger, and the cash position with the ledger cash. */
async function expectRowsAgreeWithLedger() {
  const rows = await db.expense.findMany({ where: { businessId: ID.biz, status: { in: ['PAID', 'BILL'] } } });
  const problems: string[] = [];
  for (const r of rows) {
    const net = await ledgerExpenseNet(r.id);
    if (Math.round(net * 100) !== Math.round(r.amount * 100)) problems.push(`${r.description}: row ${r.amount} vs ledger ${net}`);
  }
  expect(problems, 'a booked expense whose row and ledger disagree').toEqual([]);
  const position = await cashPosition.getCashPosition(ID.biz);
  expect(position.cashBalance, 'cash position = independent ledger cash net').toBe(Math.round((await ledgerCash()) * 100) / 100);
  const tb = await ledgerBalance.getTrialBalance(ID.biz);
  const debit = tb.reduce((s: number, x: any) => s + num(x.debit), 0);
  const credit = tb.reduce((s: number, x: any) => s + num(x.credit), 0);
  expect(Math.round(debit * 100), 'the trial balance balances').toBe(Math.round(credit * 100));
}

async function postedCashExpense(description: string, amount: number) {
  const res = await postExpense({ description: `${P}${description}`, amount, paymentMethod: 'cash' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect((await txnsOf(res.body.id)).map((t) => t.externalRef)).toEqual([`Expense:${res.body.id}:paid`]);
  return res.body;
}

async function auditRow(action: string, entityId: string) {
  return vi.waitFor(
    async () => {
      const row = await db.teamActivityLog.findFirst({ where: { businessId: ID.biz, action, entityId } });
      if (!row) throw new Error(`no ${action} audit row yet`);
      return row;
    },
    { timeout: 5000, interval: 50 },
  );
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
      ExpensePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      CashPositionService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  }).compile();
  expenses = moduleRef.get(ExpensesService);
  cashPosition = moduleRef.get(CashPositionService);
  ledgerBalance = moduleRef.get(LedgerBalanceService);
  const coa = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
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
  await db.business.create({ data: { id: ID.biz, name: 'V82G Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${ID.biz}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await coa.ensureDefaults(ID.biz);
  await db.expenseCategory.create({ data: { id: ID.category, businessId: ID.biz, name: `${P}Software` } });
}, 180_000);

afterEach(async () => {
  if (db && app) await expectRowsAgreeWithLedger();
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    const left = await leftovers();
    expect(Object.values(left).every((n) => n === 0), `v82g_ rows left: ${JSON.stringify(left)}`).toBe(true);
  }
});

describe('D-67: a posted expense refuses amount, items and currency edits (409, nothing written)', () => {
  it('EE-01: PATCH {amount 40} on a posted 25 cash expense -> 409; row, transactions and entries byte-identical', async () => {
    const exp = await postedCashExpense('ee01 cash 25', 25);
    const before = await snapshot(exp.id);
    const res = await patchExpense(exp.id, { amount: 40 });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(POSTED_REFUSAL);
    expect(await snapshot(exp.id)).toBe(before);
    expect(await ledgerExpenseNet(exp.id)).toBe(25);
    expect(await ledgerCash()).toBe(-25);
  });

  it('EE-02: PATCH {items} changing the total of a posted BILL of 30 -> 409; the AP posting stays 30', async () => {
    const bill = await postBill({ description: `${P}ee02 bill 30`, amount: 30 });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    const before = await snapshot(bill.body.id);
    const res = await patchExpense(bill.body.id, {
      items: [
        { amount: 20, description: `${P}ee02 a` },
        { amount: 15, description: `${P}ee02 b` },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(POSTED_REFUSAL);
    expect(await snapshot(bill.body.id)).toBe(before);
    const [txn] = await txnsOf(bill.body.id);
    expect(legs(txn)).toEqual([['ACCOUNTS_PAYABLE', 'Cr', 30], ['EXPENSE_OTHER', 'Dr', 30]]);
  });

  it("EE-03: PATCH {currency 'USD'} on a posted TTD expense -> 409; the row and its legs stay TTD", async () => {
    const exp = await postedCashExpense('ee03 ttd', 12);
    const before = await snapshot(exp.id);
    const res = await patchExpense(exp.id, { currency: 'USD' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(POSTED_REFUSAL);
    expect(await snapshot(exp.id)).toBe(before);
    expect((await db.expense.findUnique({ where: { id: exp.id } })).currency).toBe('TTD');
    for (const t of await txnsOf(exp.id)) for (const e of t.entries) expect(e.currency).toBe('TTD');
  });

  it('EE-04: ExpensesService.updateExpense({amount}) (the KEY finance adapter door) on a posted expense -> ConflictException, nothing written', async () => {
    const exp = await postedCashExpense('ee04 key shape', 25);
    const before = await snapshot(exp.id);
    let error: any = null;
    try {
      await expenses.updateExpense({ businessId: ID.biz, expenseId: exp.id, amount: 40 });
    } catch (e) {
      error = e;
    }
    expect(error, 'the service door refuses').not.toBeNull();
    expect(typeof error.getStatus === 'function' ? error.getStatus() : error).toBe(409);
    expect(String(error.message)).toMatch(POSTED_REFUSAL);
    expect(await snapshot(exp.id)).toBe(before);
  });
});

describe('D-67 controls: everything else stays editable (200 as today)', () => {
  it('EE-05a: PATCH {description, vendor, notes, categoryId, tags} on a posted expense -> 200; the ledger is untouched', async () => {
    const exp = await postedCashExpense('ee05a posted', 50);
    const ledgerBefore = JSON.stringify(await txnsOf(exp.id));
    const res = await patchExpense(exp.id, {
      description: `${P}ee05a renamed`,
      vendor: `${P}vendor`,
      notes: `${P}notes`,
      categoryId: ID.category,
      tags: ['a', 'b'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.expense.findUnique({ where: { id: exp.id } });
    expect({ description: row.description, vendor: row.vendor, notes: row.notes, categoryId: row.categoryId, tags: row.tags, amount: row.amount }).toEqual({
      description: `${P}ee05a renamed`,
      vendor: `${P}vendor`,
      notes: `${P}notes`,
      categoryId: ID.category,
      tags: ['a', 'b'],
      amount: 50,
    });
    expect(JSON.stringify(await txnsOf(exp.id))).toBe(ledgerBefore);
  });

  it("EE-05b: PATCH restating the stored amount and currency ('ttd'), and the web edit form's whole payload -> 200; nothing posted", async () => {
    const exp = await postedCashExpense('ee05b restate', 25);
    const ledgerBefore = JSON.stringify(await txnsOf(exp.id));
    const restated = await patchExpense(exp.id, { amount: 25, currency: 'ttd' });
    expect(restated.status, JSON.stringify(restated.body)).toBe(200);
    // What ExpenseFormSideSheet / ExpenseFormModal send in edit mode (no currency since FOLLOW3-B4).
    const form = await patchExpense(exp.id, {
      description: `${P}ee05b restate`,
      amount: 25,
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'cash',
      tags: [],
      isRecurring: false,
      projectId: null,
      contactId: null,
      serviceId: null,
    });
    expect(form.status, JSON.stringify(form.body)).toBe(200);
    const row = await db.expense.findUnique({ where: { id: exp.id } });
    expect({ amount: row.amount, currency: row.currency }).toEqual({ amount: 25, currency: 'TTD' });
    expect(JSON.stringify(await txnsOf(exp.id))).toBe(ledgerBefore);
  });

  it('EE-05c: the KEY categorize shape (categoryId only) on a posted expense -> resolves; the ledger is untouched', async () => {
    const exp = await postedCashExpense('ee05c categorize', 8);
    const ledgerBefore = JSON.stringify(await txnsOf(exp.id));
    const updated = await expenses.updateExpense({ businessId: ID.biz, expenseId: exp.id, categoryId: ID.category });
    expect(updated.categoryId).toBe(ID.category);
    expect(JSON.stringify(await txnsOf(exp.id))).toBe(ledgerBefore);
  });

  it('EE-05d: an unposted 0 PAID expense edited to 15 -> 200 and posted once (Dr expense / Cr cash 15): row and ledger agree', async () => {
    const zero = await postExpense({ description: `${P}ee05d zero`, amount: 0, paymentMethod: 'cash' });
    expect(zero.status, JSON.stringify(zero.body)).toBe(201);
    expect(await txnsOf(zero.body.id)).toEqual([]);
    const res = await patchExpense(zero.body.id, { amount: 15 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.expense.findUnique({ where: { id: zero.body.id } })).amount).toBe(15);
    const txns = await txnsOf(zero.body.id);
    expect(txns.map((t) => t.externalRef)).toEqual([`Expense:${zero.body.id}:paid`]);
    expect(legs(txns[0])).toEqual([['CASH', 'Cr', 15], ['EXPENSE_OTHER', 'Dr', 15]]);
    // Now posted: a further amount edit is refused like any posted expense's.
    const again = await patchExpense(zero.body.id, { amount: 16 });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
  });

  it('EE-05e: any edit on an unposted DRAFT row (no posting) -> 200; nothing is posted', async () => {
    await db.expense.create({ data: { id: ID.draft, businessId: ID.biz, description: `${P}ee05e draft`, amount: 10, currency: 'TTD', status: 'DRAFT' } });
    const res = await patchExpense(ID.draft, { amount: 12, currency: 'USD', description: `${P}ee05e draft edited` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.expense.findUnique({ where: { id: ID.draft } });
    expect({ amount: row.amount, currency: row.currency, status: row.status }).toEqual({ amount: 12, currency: 'USD', status: 'DRAFT' });
    expect(await txnsOf(ID.draft)).toEqual([]);
  });
});

describe('D-67: the detail page\'s Approve and Reject doors (POST bills/:id/pay and /void)', () => {
  it('EE-06: Approve -> POST bills/:id/pay posts bill_paid once (Dr AP / Cr cash), a second pay writes nothing; the actor is recorded', async () => {
    const bill = await postBill({ description: `${P}ee06 bill 18`, amount: 18 });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    const paid = await payBill(bill.body.id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.status).toBe('PAID');
    const txns = await txnsOf(bill.body.id);
    expect(txns.map((t) => t.externalRef).sort()).toEqual([`Expense:${bill.body.id}:bill_created`, `Expense:${bill.body.id}:bill_paid`].sort());
    const billPaid = txns.find((t) => t.externalRef.endsWith(':bill_paid'));
    expect(legs(billPaid)).toEqual([['ACCOUNTS_PAYABLE', 'Dr', 18], ['CASH', 'Cr', 18]]);

    const counts = { txns: await db.financialTransaction.count({ where: { businessId: ID.biz } }), entries: await db.ledgerEntry.count({ where: { businessId: ID.biz } }) };
    const again = await payBill(bill.body.id);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect({ txns: await db.financialTransaction.count({ where: { businessId: ID.biz } }), entries: await db.ledgerEntry.count({ where: { businessId: ID.biz } }) }).toEqual(counts);

    const audit = await auditRow('bill_paid', bill.body.id);
    expect(audit.userId).toBe(ID.owner);
  });

  it('EE-07: Reject -> POST bills/:id/void reverses the AP posting through the door; AP nets to zero; the actor is recorded', async () => {
    const bill = await postBill({ description: `${P}ee07 bill 22`, amount: 22 });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    const voided = await voidBill(bill.body.id);
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(voided.body.status).toBe('VOID');
    const txns = await txnsOf(bill.body.id);
    const original = txns.find((t) => t.type !== 'REVERSAL');
    const reversal = txns.find((t) => t.type === 'REVERSAL');
    expect(original.status).toBe('REVERSED');
    expect(reversal.externalRef).toBe(`${original.externalRef}:reversal`);
    let ap = 0;
    for (const t of txns) for (const e of t.entries) if (e.account.systemKey === 'ACCOUNTS_PAYABLE') ap += num(e.debit) - num(e.credit);
    expect(ap).toBe(0);
    const audit = await auditRow('bill_voided', bill.body.id);
    expect(audit.userId).toBe(ID.owner);
  });
});
