/**
 * V1-15-DM-LEDGER-WRITE-DOOR — an expense void reverses its postings through
 * PostingService (REAL database, REAL posting, REAL bills routes).
 *
 * CF-40 (docs/reconstruction/BUILD-MAP-001.md): at the V1 base,
 * ExpensesService.voidExpense wrote the reversal by hand
 * (expenses.service.ts:313 financialTransaction.create, :332 ledgerEntry.create)
 * instead of calling PostingService.reverse. The hand-written reversal skipped
 * every control the door holds:
 *
 *   - the reconciliation lock: a void reversed entries a completed bank
 *     reconciliation had locked, changing a reconciled balance;
 *   - the closed-period check (V1-15): a void could post into a CLOSED period;
 *   - the externalRef dedupe and the REVERSED status on the original: the
 *     reversal carried no externalRef and the original stayed POSTED;
 *   - concurrency: two voids of one expense raced to the reversal insert.
 *
 * Contract pinned here (POST /finance/businesses/:businessId/bills/:billId/void
 * unless stated):
 *
 *   EVR-01  void a PAID expense            -> 201; one REVERSAL through the door:
 *                                             externalRef '<original>:reversal',
 *                                             original REVERSED, entries mirrored
 *   EVR-02  void a BILL that was paid      -> both postings (bill_created, bill_paid)
 *                                             reversed once; AP and cash net to zero
 *   EVR-03  void twice in sequence         -> both 201; still one REVERSAL per posting
 *   EVR-04  void twice concurrently        -> both 201; still one REVERSAL per posting
 *   EVR-05  void a reconciliation-locked expense -> 409; nothing written: no
 *                                             reversal, original POSTED, expense PAID
 *   EVR-06  (V1-15 review SEC-V15-1) a void is dated now, and a period closes
 *           only once it has ended: closing the current period -> 400 and
 *           nothing changes; a CLOSED current period left by a close made
 *           before that rule is not enforced, so the void posts (201); a foreign
 *           tenant's CLOSED month never blocks a bill dated in it, nor its void
 *   EVR-07  POST a bill dated inside a CLOSED period -> 409; no Expense row, no posting
 *   EVR-08  void an expense whose own (past) period is CLOSED, current period
 *           open                           -> 201; the reversal is dated today
 *   EVR-09  another tenant's expense id on this tenant's route -> 404; untouched
 *   EVR-10  trial balance of the tenant afterwards: sum(debit) = sum(credit) per
 *           currency; every transaction balanced
 *   EVR-11  (V1-15 review CR-1, landed by V1-15b-LEDGER-DOOR-COMPANIONS) a voided
 *           PAID expense and a voided paid BILL net to zero in the cash-basis P&L
 *           and cashflow over a range covering both sides, and the accrual P&L
 *           agrees; the original's month still shows the expense and the void's
 *           month shows its reversal, on both bases
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, TeamAuditInterceptor, BillsController, ExpensesService,
 * ExpensePostingService, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService and LedgerReportingService read and write real rows, with the production
 * GlobalHttpExceptionFilter + ValidationPipe. Identity attachment is the one
 * stand-in (`x-v15b-user`, as the Supabase-verifying AuthMiddleware would).
 * EventEmitter2 and the timeline are recorders off the ledger path.
 *
 * Fixtures: prefix `v15b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { AccountingPeriodService } from '../src/modules/finance/accounting-period.service';
import type { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import type { ExpensesService } from '../src/modules/expenses/expenses.service';
import type { LedgerReportingService } from '../src/modules/reports/ledger-reporting.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v15b_';
const HEADER = 'x-v15b-user';

const ID = {
  owner: `${P}owner`,
  ownerF: `${P}ownerF`,
  biz: `${P}biz`, // the tenant under test
  bizNow: `${P}bizNow`, // its current period gets closed
  bizF: `${P}bizF`, // a foreign tenant, current period closed
  bizPnl: `${P}bizPnl`, // review CR-1: the reports over voided expenses
  finAccount: `${P}cashAccount`,
  recon: `${P}recon`,
};

let db: any;
let app: any;
let expenses: ExpensesService;
let periods: AccountingPeriodService;
let coa: ChartOfAccountsSeederService;
let reporting: LedgerReportingService;

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
    `DELETE FROM reconciliations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function voidBill(expenseId: string, businessId = ID.biz, actor = ID.owner) {
  return agent().post(`/finance/businesses/${businessId}/bills/${expenseId}/void`).set(HEADER, actor).send({ reason: 'v15b void' });
}

function createBill(body: Record<string, unknown>, businessId = ID.biz) {
  return agent().post(`/finance/businesses/${businessId}/bills`).set(HEADER, ID.owner).send(body);
}

function payBill(expenseId: string, businessId = ID.biz) {
  return agent().post(`/finance/businesses/${businessId}/bills/${expenseId}/pay`).set(HEADER, ID.owner).send({ paymentMethod: 'cash' });
}

/** A PAID expense created through the service (the expenses route needs the AI document service). */
async function paidExpense(businessId: string, description: string, amount: number, date?: Date) {
  return expenses.createExpense({ businessId, description: `${P}${description}`, amount, currency: 'TTD', paymentMethod: 'cash', date });
}

async function txnsOf(expenseId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { sourceType: 'Expense', sourceId: expenseId },
    include: { entries: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function ledgerCounts(businessId: string): Promise<{ txns: number; entries: number }> {
  return {
    txns: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

/** Each posted original has exactly one reversal made by PostingService.reverse. */
function expectReversedThroughDoor(txns: any[], originals: number) {
  const orig = txns.filter((t) => t.type !== 'REVERSAL');
  const revs = txns.filter((t) => t.type === 'REVERSAL');
  expect(orig, 'original postings').toHaveLength(originals);
  expect(revs, 'reversals').toHaveLength(originals);
  for (const o of orig) {
    const r = revs.filter((x) => x.reversalOfId === o.id);
    expect(r, `reversals of ${o.externalRef}`).toHaveLength(1);
    expect(o.status, `${o.externalRef} is marked REVERSED`).toBe('REVERSED');
    expect(r[0].externalRef, 'the reversal carries the door\'s idempotency key').toBe(`${o.externalRef}:reversal`);
    expect(r[0].status).toBe('POSTED');
    expect(Number(r[0].amount)).toBe(Number(o.amount));
    // Entries mirrored: same accounts, debit and credit swapped.
    const mirror = (es: any[], flip: boolean) =>
      es.map((e) => `${e.accountId}:${Number(flip ? e.credit : e.debit)}:${Number(flip ? e.debit : e.credit)}`).sort();
    expect(mirror(r[0].entries, false)).toEqual(mirror(o.entries, true));
  }
}

/** Net (debit - credit) per account over a set of transactions. */
function netByAccount(txns: any[]): Record<string, number> {
  const net: Record<string, number> = {};
  for (const t of txns) for (const e of t.entries) net[e.accountId] = (net[e.accountId] ?? 0) + Number(e.debit) - Number(e.credit);
  return net;
}

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/** The UTC month `offset` months from the current one (-1 = last month, which has ended). */
function monthFromNow(offset: number): { year: number; month: number } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Create and close a period as `closedById`, who must be the business's owner or an admin (review SEC-V15-2). */
async function openAndClose(businessId: string, year: number, month: number, closedById: string = ID.owner) {
  const period = await periods.create(businessId, { year, month });
  return periods.close(businessId, period.id, { closedById });
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
  const { BillsController } = await import('../src/modules/expenses/bills.controller');
  const ExpensesMod = await import('../src/modules/expenses/expenses.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const PeriodMod = await import('../src/modules/finance/accounting-period.service');
  const SeederMod = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const ReportingMod = await import('../src/modules/reports/ledger-reporting.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [BillsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TeamAuditInterceptor,
      ExpensesMod.ExpensesService,
      ExpensePostingService,
      PostingService,
      PeriodMod.AccountingPeriodService,
      SeederMod.ChartOfAccountsSeederService,
      ReportingMod.LedgerReportingService,
      LedgerBalanceService,
      ReceivablesService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
    ],
  }).compile();
  expenses = moduleRef.get(ExpensesMod.ExpensesService);
  periods = moduleRef.get(PeriodMod.AccountingPeriodService);
  coa = moduleRef.get(SeederMod.ChartOfAccountsSeederService);
  reporting = moduleRef.get(ReportingMod.LedgerReportingService);

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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerF, email: `${P}ownerF@test.local`, role: 'USER' } });
  for (const [biz, owner] of [
    [ID.biz, ID.owner],
    [ID.bizNow, ID.owner],
    [ID.bizF, ID.ownerF],
  ] as const) {
    await db.business.create({ data: { id: biz, name: `V15B ${biz}`, ownerId: owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${biz}_m`, userId: owner, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
  }
  // A completed bank reconciliation over the cash account (its lock is set per entry in EVR-05).
  const cash = await coa.getBySystemKey(ID.biz, 'CASH');
  await db.financialAccount.create({
    data: { id: ID.finAccount, businessId: ID.biz, chartOfAccountId: cash!.id, name: `${P}Cash drawer`, type: 'CASH', currency: 'TTD' },
  });
  await db.reconciliation.create({
    data: {
      id: ID.recon,
      businessId: ID.biz,
      accountId: ID.finAccount,
      periodStart: new Date(Date.UTC(2020, 0, 1)),
      periodEnd: new Date(Date.UTC(2100, 0, 1)),
      statementBalance: 0,
      systemBalance: 0,
      difference: 0,
      status: 'RECONCILED',
      completedAt: new Date(),
    },
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded three tenants with a chart of accounts and no ledger rows', async () => {
    for (const biz of [ID.biz, ID.bizNow, ID.bizF]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } }), biz).toBeGreaterThan(0);
      expect(await ledgerCounts(biz), biz).toEqual({ txns: 0, entries: 0 });
    }
  });
});

describe('CF-40: the expense void reverses through PostingService', () => {
  it('EVR-01: void a PAID expense -> 201; one REVERSAL made by the door (externalRef, original REVERSED, entries mirrored)', async () => {
    const exp = await paidExpense(ID.biz, 'paid once', 50);
    expect((await txnsOf(exp.id)).map((t) => t.externalRef)).toEqual([`Expense:${exp.id}:paid`]);

    const res = await voidBill(exp.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('VOID');
    expectReversedThroughDoor(await txnsOf(exp.id), 1);
    const row = await db.expense.findUnique({ where: { id: exp.id } });
    expect(row.status).toBe('VOID');
    expect(row.deletedAt).not.toBeNull();
  });

  it('EVR-02: void a BILL that was paid -> bill_created and bill_paid each reversed once; AP and cash net to zero', async () => {
    const created = await createBill({ description: `${P}bill paid then void`, amount: 80, paymentMethod: 'cash' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const paid = await payBill(created.body.id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    const res = await voidBill(created.body.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const txns = await txnsOf(created.body.id);
    expectReversedThroughDoor(txns, 2);
    expect(txns.filter((t) => t.type !== 'REVERSAL').map((t) => t.externalRef).sort()).toEqual(
      [`Expense:${created.body.id}:bill_created`, `Expense:${created.body.id}:bill_paid`].sort(),
    );
    for (const [account, net] of Object.entries(netByAccount(txns))) expect(net, account).toBe(0);
  });

  it('EVR-03: void twice in sequence -> both 201; still one REVERSAL per posting', async () => {
    const exp = await paidExpense(ID.biz, 'voided twice', 25);
    const first = await voidBill(exp.id);
    const second = await voidBill(exp.id);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.status).toBe('VOID');
    expectReversedThroughDoor(await txnsOf(exp.id), 1);
  });

  it('EVR-04: void twice concurrently -> both 201; still one REVERSAL per posting', async () => {
    const exp = await paidExpense(ID.biz, 'voided concurrently', 35);
    const [a, b] = await Promise.all([voidBill(exp.id), voidBill(exp.id)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expectReversedThroughDoor(await txnsOf(exp.id), 1);
  });

  it('EVR-05: void a reconciliation-locked expense -> 409; no reversal, original POSTED, expense still PAID', async () => {
    const exp = await paidExpense(ID.biz, 'reconciled', 60);
    const [orig] = await txnsOf(exp.id);
    const cash = await coa.getBySystemKey(ID.biz, 'CASH');
    // What ReconciliationService.complete does to in-period entries on the reconciled account.
    const locked = await db.ledgerEntry.updateMany({
      where: { transactionId: orig.id, accountId: cash!.id },
      data: { lockedByReconciliationId: ID.recon },
    });
    expect(locked.count).toBe(1);
    const before = await ledgerCounts(ID.biz);

    const res = await voidBill(exp.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(/locked by reconciliation/i);
    const txns = await txnsOf(exp.id);
    expect(txns.map((t) => `${t.type}:${t.status}`)).toEqual(['EXPENSE:POSTED']);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    const row = await db.expense.findUnique({ where: { id: exp.id } });
    expect(row.status).toBe('PAID');
    expect(row.deletedAt).toBeNull();
  });

  it('EVR-08: void an expense whose own past period is CLOSED, current period open -> 201; the reversal is dated today', async () => {
    const exp = await paidExpense(ID.biz, 'dated in a closed month', 15, new Date(Date.UTC(2025, 0, 15, 10, 0, 0)));
    await openAndClose(ID.biz, 2025, 1);
    const res = await voidBill(exp.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const txns = await txnsOf(exp.id);
    expectReversedThroughDoor(txns, 1);
    const reversal = txns.find((t) => t.type === 'REVERSAL');
    expect(reversal.date.toISOString().slice(0, 7)).toBe(new Date().toISOString().slice(0, 7));
    const original = txns.find((t) => t.type !== 'REVERSAL');
    expect(original.date.toISOString()).toBe('2025-01-15T10:00:00.000Z');
  });

  it('EVR-07: POST a bill dated inside a CLOSED period -> 409; no Expense row, no posting', async () => {
    await openAndClose(ID.biz, 2025, 2);
    const before = await ledgerCounts(ID.biz);
    const description = `${P}bill in closed february`;
    const res = await createBill({ description, amount: 40, date: '2025-02-10T12:00:00.000Z' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await db.expense.count({ where: { businessId: ID.biz, description } })).toBe(0);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
  });

  it('EVR-09: another tenant\'s expense id on this tenant\'s route -> 404; the foreign expense is untouched', async () => {
    const foreign = await paidExpense(ID.bizF, 'foreign', 70);
    const res = await voidBill(foreign.id, ID.biz, ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect((await db.expense.findUnique({ where: { id: foreign.id } })).status).toBe('PAID');
    expect((await txnsOf(foreign.id)).map((t) => `${t.type}:${t.status}`)).toEqual(['EXPENSE:POSTED']);
  });
});

describe('CF-40 + review SEC-V15-1: a void is dated now, and a period closes only once it has ended', () => {
  it('EVR-06: closing the current period -> 400, nothing changes; a CLOSED current period left by an earlier close is not enforced, the void posts; a foreign closed month never blocks', async () => {
    const exp = await paidExpense(ID.bizNow, 'void beside the current period', 45);
    const { year, month } = currentPeriod();
    const current = await periods.create(ID.bizNow, { year, month });
    const before = await ledgerCounts(ID.bizNow);
    await expect(periods.close(ID.bizNow, current.id, { closedById: ID.owner })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/has not ended/),
    });
    const period = await db.accountingPeriod.findUnique({ where: { id: current.id } });
    expect(`${period.status}:${period.closedById}:${period.lockedTransactionStamp}`).toBe('OPEN:null:null');
    expect(await ledgerCounts(ID.bizNow)).toEqual(before);

    // Closing was metadata only before V1-15 and any month could be closed, so
    // such a row can exist: it does not refuse what is dated now.
    await db.accountingPeriod.update({ where: { id: current.id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: ID.owner } });
    const res = await voidBill(exp.id, ID.bizNow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expectReversedThroughDoor(await txnsOf(exp.id), 1);

    // The foreign tenant closes last month; it has no bearing on ID.biz, nor on a bill ID.biz dates in it.
    const last = monthFromNow(-1);
    expect((await openAndClose(ID.bizF, last.year, last.month, ID.ownerF)).status).toBe('CLOSED');
    const billDate = new Date(Date.UTC(last.year, last.month - 1, 15, 12, 0, 0)).toISOString();
    const bill = await createBill({ description: `${P}bill in a month only bizF closed`, amount: 5, date: billDate });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect((await voidBill(bill.body.id)).status).toBe(201);
    expectReversedThroughDoor(await txnsOf(bill.body.id), 1);
  });
});

describe('M30: trial balance after the voids', () => {
  it('EVR-10: sum(debit) = sum(credit) per currency for each tenant; every transaction balanced', async () => {
    for (const biz of [ID.biz, ID.bizNow, ID.bizF]) {
      const perCurrency: Array<{ currency: string; debit: string; credit: string; n: number }> = await db.$queryRawUnsafe(
        `SELECT currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit, COUNT(*)::int AS n
           FROM ledger_entries WHERE business_id = $1 GROUP BY currency ORDER BY currency`,
        biz,
      );
      expect(perCurrency.length, biz).toBeGreaterThan(0);
      for (const r of perCurrency) expect(Number(r.debit), `${biz} ${r.currency}`).toBe(Number(r.credit));
      const unbalanced = await db.$queryRawUnsafe(
        `SELECT transaction_id FROM ledger_entries WHERE business_id = $1
          GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
        biz,
      );
      expect(unbalanced, biz).toEqual([]);
    }
  });

  // Review CR-1. The ledger nets a void to zero (EVR-02, EVR-10). At 2dd2eb65 the
  // cash-basis P&L did not: LedgerReportingService.computeCashBasisPnl read status
  // POSTED only, so once PostingService.reverse marked the original REVERSED it
  // dropped out while its POSTED reversal counted as a negative expense, and a
  // reversed bill payment (Dr Cash / Cr AP) was skipped as a non-operating move.
  it('EVR-11 (review CR-1): a voided PAID expense and a voided paid BILL net to zero in the cash-basis P&L and cashflow; the accrual P&L agrees; each month shows its own side', async () => {
    await db.business.create({ data: { id: ID.bizPnl, name: `V15B ${ID.bizPnl}`, ownerId: ID.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${ID.bizPnl}_m`, userId: ID.owner, businessId: ID.bizPnl, role: 'OWNER' } });
    await coa.ensureDefaults(ID.bizPnl);
    // May 2025 (open): a paid expense (30) and a bill (80) paid that month, both voided
    // today; a paid expense (12) kept.
    const voided = await paidExpense(ID.bizPnl, 'pnl voided expense', 30, new Date(Date.UTC(2025, 4, 10, 12, 0, 0)));
    const bill = await expenses.createExpense({
      businessId: ID.bizPnl, description: `${P}pnl voided bill`, amount: 80, currency: 'TTD', status: 'BILL', date: new Date(Date.UTC(2025, 4, 12, 12, 0, 0)),
    });
    await expenses.markBillPaid({ businessId: ID.bizPnl, expenseId: bill.id, paymentMethod: 'cash', paidAt: new Date(Date.UTC(2025, 4, 14, 12, 0, 0)) });
    await paidExpense(ID.bizPnl, 'pnl kept expense', 12, new Date(Date.UTC(2025, 4, 20, 12, 0, 0)));
    for (const id of [voided.id, bill.id]) expect((await voidBill(id, ID.bizPnl)).status, id).toBe(201);
    expectReversedThroughDoor(await txnsOf(voided.id), 1);
    expectReversedThroughDoor(await txnsOf(bill.id), 2);

    const now = new Date();
    const ranges: Array<[string, Date, Date, number]> = [
      // Covering both sides: only the kept expense.
      ['both sides', new Date(Date.UTC(2025, 4, 1)), new Date(now.getTime() + 86_400_000), 12],
      // The original's month: what was paid then (the void does not rewrite a past month).
      ['May 2025', new Date(Date.UTC(2025, 4, 1)), new Date(Date.UTC(2025, 4, 31, 23, 59, 59, 999)), 122],
      // The void's month: the reversals, offset in the open period.
      ['this month', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), new Date(now.getTime() + 86_400_000), -110],
    ];
    for (const [label, from, to, opex] of ranges) {
      const cash = await reporting.getPnl(ID.bizPnl, from, to, 'cash');
      const accrual = await reporting.getPnl(ID.bizPnl, from, to, 'accrual');
      expect(cash.operatingExpenses.total, `cash-basis expenses, ${label}`).toBe(opex);
      expect(accrual.operatingExpenses.total, `accrual expenses, ${label}`).toBe(opex);
      expect(cash.netProfit, `cash-basis net profit, ${label}`).toBe(-opex);
      expect(accrual.netProfit, `accrual net profit, ${label}`).toBe(-opex);
      const flow = await reporting.getCashflow(ID.bizPnl, from, to, 'cash');
      expect(flow.netMovement, `cash-basis operating cash, ${label}`).toBe(-opex);
      expect(flow.accrualAdjustments.netIncome, `cash-basis net income, ${label}`).toBe(-opex);
    }

    const unbalanced = await db.$queryRawUnsafe(
      `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
      ID.bizPnl,
    );
    expect(unbalanced).toEqual([]);
    const [totals] = await db.$queryRawUnsafe(
      `SELECT SUM(debit)::text AS debit, SUM(credit)::text AS credit FROM ledger_entries WHERE business_id = $1`,
      ID.bizPnl,
    );
    expect(Number(totals.debit)).toBe(Number(totals.credit));
  });
});
