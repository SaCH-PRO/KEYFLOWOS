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
 *   EVR-06  void while the current period is CLOSED -> 409; nothing written;
 *                                             reopening lets the void through
 *   EVR-07  POST a bill dated inside a CLOSED period -> 409; no Expense row, no posting
 *   EVR-08  void an expense whose own (past) period is CLOSED, current period
 *           open                           -> 201; the reversal is dated today
 *   EVR-09  another tenant's expense id on this tenant's route -> 404; untouched
 *   EVR-10  trial balance of the tenant afterwards: sum(debit) = sum(credit) per
 *           currency; every transaction balanced
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, TeamAuditInterceptor, BillsController, ExpensesService,
 * ExpensePostingService, PostingService, AccountingPeriodService and
 * ChartOfAccountsSeederService write real rows, with the production
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

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v15b_';
const HEADER = 'x-v15b-user';

const ID = {
  owner: `${P}owner`,
  ownerF: `${P}ownerF`,
  biz: `${P}biz`, // the tenant under test
  bizNow: `${P}bizNow`, // its current period gets closed
  bizF: `${P}bizF`, // a foreign tenant, current period closed
  finAccount: `${P}cashAccount`,
  recon: `${P}recon`,
};

let db: any;
let app: any;
let expenses: ExpensesService;
let periods: AccountingPeriodService;
let coa: ChartOfAccountsSeederService;

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

async function openAndClose(businessId: string, year: number, month: number) {
  const period = await periods.create(businessId, { year, month });
  return periods.close(businessId, period.id, { closedById: ID.owner });
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
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
    ],
  }).compile();
  expenses = moduleRef.get(ExpensesMod.ExpensesService);
  periods = moduleRef.get(PeriodMod.AccountingPeriodService);
  coa = moduleRef.get(SeederMod.ChartOfAccountsSeederService);

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

describe('CF-40: a void is a posting, so a CLOSED current period refuses it', () => {
  it('EVR-06: void while the current period is CLOSED -> 409, nothing written; reopening lets it through; a foreign closed period never blocks', async () => {
    const exp = await paidExpense(ID.bizNow, 'void in closed now', 45);
    const { year, month } = currentPeriod();
    const closed = await openAndClose(ID.bizNow, year, month);
    const before = await ledgerCounts(ID.bizNow);

    const refused = await voidBill(exp.id, ID.bizNow);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.message).toMatch(/closed/i);
    expect(await ledgerCounts(ID.bizNow)).toEqual(before);
    const row = await db.expense.findUnique({ where: { id: exp.id } });
    expect(row.status).toBe('PAID');
    expect(row.deletedAt).toBeNull();

    // The foreign tenant closes its current period too; it has no bearing on ID.biz.
    await openAndClose(ID.bizF, year, month);
    const mine = await paidExpense(ID.biz, 'void beside a foreign closed period', 5);
    expect((await voidBill(mine.id)).status).toBe(201);

    await periods.reopen(ID.bizNow, closed.id);
    const res = await voidBill(exp.id, ID.bizNow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expectReversedThroughDoor(await txnsOf(exp.id), 1);
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
});
