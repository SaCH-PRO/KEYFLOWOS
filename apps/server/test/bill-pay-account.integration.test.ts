/**
 * V1-64 (EXPENSES-HUB-1, P103 — D-168 / D-170): paying a bill with an explicit
 * `paymentAccountId` credits that FinancialAccount's linked ChartOfAccount
 * through PostingService (REAL PostgreSQL, REAL HTTP via supertest, NO mocked
 * guards or ledger services).
 *
 * Contract pinned here (POST /finance/businesses/:businessId/bills/:billId/pay
 * unless stated):
 *
 *   RED-BEFORE (must FAIL before the P103 server fix, PASS after):
 *     BPA-01  explicit BANK `paymentAccountId` (linked to a specific Bank COA)
 *             -> 201, posts Dr AP / Cr <chosen Bank COA> once,
 *             FinancialTransaction.metadata.paymentAccountId === bankAccount.id,
 *             FinancialAccount.currentBalance untouched (V1-34)
 *     BPA-02  explicit CREDIT_CARD `paymentAccountId` -> 201, credits the linked
 *             Credit Card COA and records metadata.paymentAccountId
 *     BPA-03  refusals (400, zero writes, bill stays BILL with paidAt=null):
 *             foreign-tenant paymentAccountId, nonexistent paymentAccountId,
 *             archived (isActive=false) account, non-payment account types
 *             (LOAN, EQUITY, TAX, OTHER), currency mismatch (D-13), inactive
 *             linked COA, non-payment linked COA (ACCOUNTS_RECEIVABLE)
 *     BPA-04  concurrent double-pay & sequential idempotent replay -> all 201,
 *             single bill_paid posting, original paymentMethod/paidAt preserved
 *             (never overwritten) and metadata.paymentAccountId recorded
 *     BPA-05  void after explicit paymentAccountId pay -> reverses both
 *             bill_created and bill_paid, specifically reversing the chosen
 *             Bank COA, net per account = 0, tenant trial balance balanced
 *     BPA-06  voided bill cannot be paid -> 400, zero writes (voidExpense sets
 *             deletedAt; markBillPaid must check status=VOID before deletedAt)
 *
 *   CONTROLS (must PASS both before and after the fix):
 *     BPA-C1  omitting paymentAccountId keeps Cash / paymentMethod default (D-168)
 *     BPA-C2  auth/scope boundary: expenses:read -> 403, non-member SUPER_ADMIN
 *             -> 403 (BusinessMemberGuard, D-46), expenses:write -> 201
 *     BPA-C3  void after default pay reverses both bill_created and bill_paid;
 *             trial balance nets to 0
 *     BPA-C4  DELETE /expenses/businesses/:b/expenses/:id on a posted PAID
 *             expense -> 400; row stays active and PAID
 *
 * Fixtures: prefix `v64c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import type { ExpensesService } from '../src/modules/expenses/expenses.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64c_';
const HEADER = 'x-v64c-user';

const ID = {
  owner: `${P}owner`,
  reader: `${P}reader`,
  writer: `${P}writer`,
  superAdmin: `${P}superAdmin`,
  ownerF: `${P}ownerF`,
  biz: `${P}biz`,
  bizF: `${P}bizF`,
  coaBankChecking: `${P}coaBankChecking`,
  coaInactive: `${P}coaInactive`,
  faBank: `${P}faBank`,
  faCard: `${P}faCard`,
  faArchived: `${P}faArchived`,
  faUsd: `${P}faUsd`,
  faLoan: `${P}faLoan`,
  faEquity: `${P}faEquity`,
  faTax: `${P}faTax`,
  faOther: `${P}faOther`,
  faInactiveCoa: `${P}faInactiveCoa`,
  faBadCoa: `${P}faBadCoa`,
  faForeign: `${P}faForeign`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: any;
let coa: ChartOfAccountsSeederService;
let expenses: ExpensesService;
let coaIds: {
  ap: string;
  cash: string;
  bank: string;
  creditCard: string;
  bankChecking: string;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

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
    `UPDATE financial_transactions SET reversal_of_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function createBill(body: Record<string, unknown>, businessId = ID.biz, actor = ID.owner) {
  return agent().post(`/finance/businesses/${businessId}/bills`).set(HEADER, actor).send(body);
}

function payBill(
  expenseId: string,
  body: Record<string, unknown> = {},
  businessId = ID.biz,
  actor = ID.owner,
) {
  return agent().post(`/finance/businesses/${businessId}/bills/${expenseId}/pay`).set(HEADER, actor).send(body);
}

function voidBill(expenseId: string, businessId = ID.biz, actor = ID.owner) {
  return agent()
    .post(`/finance/businesses/${businessId}/bills/${expenseId}/void`)
    .set(HEADER, actor)
    .send({ reason: 'v64c void' });
}

function deleteExpense(expenseId: string, businessId = ID.biz, actor = ID.owner) {
  return agent().delete(`/expenses/businesses/${businessId}/expenses/${expenseId}`).set(HEADER, actor);
}

async function txnsOf(expenseId: string) {
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

function netByAccount(txns: Array<{ entries: Array<{ accountId: string; debit: unknown; credit: unknown }> }>): Record<string, number> {
  const net: Record<string, number> = {};
  for (const t of txns) {
    for (const e of t.entries) {
      net[e.accountId] = (net[e.accountId] ?? 0) + Number(e.debit) - Number(e.credit);
    }
  }
  return net;
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
  const { BusinessMemberGuard } = await import('../src/core/auth/business-member.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { BillsController } = await import('../src/modules/expenses/bills.controller');
  const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [BillsController, ExpensesController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      BusinessMemberGuard,
      TeamAuditInterceptor,
      ExpensesService,
      ExpensePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  }).compile();

  coa = moduleRef.get(ChartOfAccountsSeederService);
  expenses = moduleRef.get(ExpensesService);

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

  await db.user.createMany({
    data: [
      { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' },
      { id: ID.reader, email: `${P}reader@test.local`, role: 'USER' },
      { id: ID.writer, email: `${P}writer@test.local`, role: 'USER' },
      { id: ID.superAdmin, email: `${P}superadmin@test.local`, role: 'SUPER_ADMIN' },
      { id: ID.ownerF, email: `${P}ownerF@test.local`, role: 'USER' },
    ],
  });

  await db.business.create({ data: { id: ID.biz, name: `V64C ${ID.biz}`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizF, name: `V64C ${ID.bizF}`, ownerId: ID.ownerF, currency: 'TTD' } });

  await db.membership.createMany({
    data: [
      { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
      {
        id: `${P}m_reader`,
        userId: ID.reader,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { expenses: 'read' },
      },
      {
        id: `${P}m_writer`,
        userId: ID.writer,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { expenses: 'write' },
      },
      { id: `${P}m_ownerF`, userId: ID.ownerF, businessId: ID.bizF, role: 'OWNER' },
    ],
  });

  await coa.ensureDefaults(ID.biz);
  await coa.ensureDefaults(ID.bizF);

  const ap = await coa.getBySystemKey(ID.biz, 'ACCOUNTS_PAYABLE');
  const cash = await coa.getBySystemKey(ID.biz, 'CASH');
  const bank = await coa.getBySystemKey(ID.biz, 'BANK');
  const creditCard = await coa.getBySystemKey(ID.biz, 'CREDIT_CARD');
  const loanPayable = await coa.getBySystemKey(ID.biz, 'LOAN_PAYABLE');
  const ownerEquity = await coa.getBySystemKey(ID.biz, 'OWNER_EQUITY');
  const taxPayable = await coa.getBySystemKey(ID.biz, 'TAX_PAYABLE');
  const ar = await coa.getBySystemKey(ID.biz, 'ACCOUNTS_RECEIVABLE');
  const bankF = await coa.getBySystemKey(ID.bizF, 'BANK');

  // Specific Bank COA distinct from both system CASH (1000) and system BANK (1010)
  const bankChecking = await db.chartOfAccount.create({
    data: {
      id: ID.coaBankChecking,
      businessId: ID.biz,
      code: '1011',
      name: `${P}Republic Bank Checking`,
      type: 'ASSET',
      systemKey: null,
      isSystem: false,
      isActive: true,
    },
  });

  const inactiveCoa = await db.chartOfAccount.create({
    data: {
      id: ID.coaInactive,
      businessId: ID.biz,
      code: '1012',
      name: `${P}Closed Bank COA`,
      type: 'ASSET',
      systemKey: null,
      isSystem: false,
      isActive: false,
    },
  });

  coaIds = {
    ap: ap!.id,
    cash: cash!.id,
    bank: bank!.id,
    creditCard: creditCard!.id,
    bankChecking: bankChecking.id,
  };

  await db.financialAccount.createMany({
    data: [
      {
        id: ID.faBank,
        businessId: ID.biz,
        chartOfAccountId: bankChecking.id,
        name: `${P}Republic Checking`,
        type: 'BANK',
        currency: 'TTD',
        openingBalance: 5000,
        currentBalance: 5000,
        isActive: true,
      },
      {
        id: ID.faCard,
        businessId: ID.biz,
        chartOfAccountId: creditCard!.id,
        name: `${P}Corporate Visa`,
        type: 'CREDIT_CARD',
        currency: 'TTD',
        openingBalance: 0,
        currentBalance: 1200,
        isActive: true,
      },
      {
        id: ID.faArchived,
        businessId: ID.biz,
        chartOfAccountId: bankChecking.id,
        name: `${P}Archived Checking`,
        type: 'BANK',
        currency: 'TTD',
        isActive: false,
      },
      {
        id: ID.faUsd,
        businessId: ID.biz,
        chartOfAccountId: bankChecking.id,
        name: `${P}USD Wire Account`,
        type: 'BANK',
        currency: 'USD',
        isActive: true,
      },
      {
        id: ID.faLoan,
        businessId: ID.biz,
        chartOfAccountId: loanPayable!.id,
        name: `${P}Equipment Loan`,
        type: 'LOAN',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faEquity,
        businessId: ID.biz,
        chartOfAccountId: ownerEquity!.id,
        name: `${P}Owner Capital`,
        type: 'EQUITY',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faTax,
        businessId: ID.biz,
        chartOfAccountId: taxPayable!.id,
        name: `${P}VAT Reserve`,
        type: 'TAX',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faOther,
        businessId: ID.biz,
        chartOfAccountId: cash!.id,
        name: `${P}Misc Account`,
        type: 'OTHER',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faInactiveCoa,
        businessId: ID.biz,
        chartOfAccountId: inactiveCoa.id,
        name: `${P}Inactive COA Bank`,
        type: 'BANK',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faBadCoa,
        businessId: ID.biz,
        chartOfAccountId: ar!.id,
        name: `${P}Mislinked AR Bank`,
        type: 'BANK',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faForeign,
        businessId: ID.bizF,
        chartOfAccountId: bankF!.id,
        name: `${P}Foreign Tenant Bank`,
        type: 'BANK',
        currency: 'TTD',
        isActive: true,
      },
    ],
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('RED-BEFORE: explicit paymentAccountId on bill pay (EXPENSES-HUB-1, D-168/D-170)', () => {
  it('BPA-01: paying a BILL with explicit BANK paymentAccountId posts Dr AP / Cr <chosen Bank COA> once, records metadata.paymentAccountId, and leaves currentBalance untouched', async () => {
    const created = await createBill({
      description: `${P}cloud hosting bill`,
      amount: 250,
      currency: 'TTD',
      vendor: 'Hosting Co',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    const paid = await payBill(billId, {
      paymentAccountId: ID.faBank,
      paymentMethod: 'bank_transfer',
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).toBeTruthy();

    const txns = await txnsOf(billId);
    const billPaidTxns = txns.filter((t: any) => t.externalRef === `Expense:${billId}:bill_paid`);
    expect(billPaidTxns).toHaveLength(1);
    const [paidTxn] = billPaidTxns;

    const dr = paidTxn.entries.find((e: any) => Number(e.debit) > 0);
    const cr = paidTxn.entries.find((e: any) => Number(e.credit) > 0);
    expect(dr.accountId).toBe(coaIds.ap);
    expect(Number(dr.debit)).toBe(250);
    expect(cr.accountId).toBe(coaIds.bankChecking);
    expect(Number(cr.credit)).toBe(250);
    expect(paidTxn.metadata).toMatchObject({
      paymentAccountId: ID.faBank,
      paymentMethod: 'bank_transfer',
    });

    // V1-34: cash lives in the ledger; FinancialAccount.currentBalance is never mutated.
    const accountAfter = await db.financialAccount.findUnique({ where: { id: ID.faBank } });
    expect(Number(accountAfter.currentBalance)).toBe(5000);
  });

  it('BPA-02: paying a BILL with explicit CREDIT_CARD paymentAccountId credits the linked Credit Card COA and records metadata.paymentAccountId', async () => {
    const created = await createBill({
      description: `${P}software subscription bill`,
      amount: 120,
      currency: 'TTD',
      vendor: 'SaaS Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    // Omit paymentMethod intentionally: the chosen CREDIT_CARD FinancialAccount must drive the credit COA.
    const paid = await payBill(billId, { paymentAccountId: ID.faCard });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    const txns = await txnsOf(billId);
    const paidTxn = txns.find((t: any) => t.externalRef === `Expense:${billId}:bill_paid`);
    expect(paidTxn).toBeTruthy();

    const dr = paidTxn.entries.find((e: any) => Number(e.debit) > 0);
    const cr = paidTxn.entries.find((e: any) => Number(e.credit) > 0);
    expect(dr.accountId).toBe(coaIds.ap);
    expect(cr.accountId).toBe(coaIds.creditCard);
    expect(Number(cr.credit)).toBe(120);
    expect(paidTxn.metadata).toMatchObject({ paymentAccountId: ID.faCard });

    const cardAfter = await db.financialAccount.findUnique({ where: { id: ID.faCard } });
    expect(Number(cardAfter.currentBalance)).toBe(1200);
  });

  it('BPA-03: refuses invalid paymentAccountId with 400 and zero writes (foreign tenant, nonexistent, archived, LOAN/EQUITY/TAX/OTHER, currency mismatch D-13, inactive/non-payment COA)', async () => {
    const created = await createBill({
      description: `${P}refusal guard bill`,
      amount: 95,
      currency: 'TTD',
      vendor: 'Guard Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;
    const beforeCounts = await ledgerCounts(ID.biz);

    const invalidCases: Array<[string, string]> = [
      ['foreign-tenant account', ID.faForeign],
      ['nonexistent account', `${P}nonexistentAccount`],
      ['archived account', ID.faArchived],
      ['LOAN account', ID.faLoan],
      ['EQUITY account', ID.faEquity],
      ['TAX account', ID.faTax],
      ['OTHER account', ID.faOther],
      ['USD currency mismatch on TTD bill (D-13)', ID.faUsd],
      ['inactive linked COA', ID.faInactiveCoa],
      ['non-payment linked COA (AR)', ID.faBadCoa],
    ];

    for (const [label, paymentAccountId] of invalidCases) {
      const res = await payBill(billId, { paymentAccountId });
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      const row = await db.expense.findUnique({ where: { id: billId } });
      expect(row.status, `${label} must leave bill as BILL`).toBe('BILL');
      expect(row.paidAt, `${label} must leave paidAt null`).toBeNull();
      expect(await ledgerCounts(ID.biz), `${label} must write zero ledger rows`).toEqual(beforeCounts);
    }
  });

  it('BPA-04: concurrent double-pay & sequential idempotent replay return 201, post bill_paid once, and preserve original paymentMethod and paidAt', async () => {
    const created = await createBill({
      description: `${P}concurrent pay bill`,
      amount: 140,
      currency: 'TTD',
      vendor: 'Race Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    const firstPaidAt = '2026-06-10T10:00:00.000Z';
    const secondPaidAt = '2026-06-11T12:00:00.000Z';
    const replayPaidAt = '2026-06-15T00:00:00.000Z';

    const [r1, r2] = await Promise.all([
      payBill(billId, { paymentAccountId: ID.faBank, paymentMethod: 'bank_transfer', paidAt: firstPaidAt }),
      payBill(billId, { paymentAccountId: ID.faBank, paymentMethod: 'cash', paidAt: secondPaidAt }),
    ]);
    expect([r1.status, r2.status], JSON.stringify([r1.body, r2.body])).toEqual([201, 201]);

    // Both concurrent callers must observe the single winning paymentMethod and paidAt.
    expect(r1.body.paidAt).toBe(r2.body.paidAt);
    expect(r1.body.paymentMethod).toBe(r2.body.paymentMethod);

    const winningPaidAt = r1.body.paidAt;
    const winningMethod = r1.body.paymentMethod;

    // Sequential replay with different paymentMethod/paidAt must not overwrite the winner.
    const r3 = await payBill(billId, {
      paymentAccountId: ID.faBank,
      paymentMethod: 'cheque',
      paidAt: replayPaidAt,
    });
    expect(r3.status, JSON.stringify(r3.body)).toBe(201);
    expect(r3.body.paidAt).toBe(winningPaidAt);
    expect(r3.body.paymentMethod).toBe(winningMethod);

    const row = await db.expense.findUnique({ where: { id: billId } });
    expect(row.status).toBe('PAID');
    expect(row.paidAt.toISOString()).toBe(winningPaidAt);
    expect(row.paymentMethod).toBe(winningMethod);

    const txns = await txnsOf(billId);
    const billPaidTxns = txns.filter((t: any) => t.externalRef === `Expense:${billId}:bill_paid`);
    expect(billPaidTxns).toHaveLength(1);
    const [paidTxn] = billPaidTxns;
    expect(paidTxn.date.toISOString()).toBe(winningPaidAt);
    expect(paidTxn.metadata).toMatchObject({
      paymentAccountId: ID.faBank,
      paymentMethod: winningMethod,
    });
    expect(paidTxn.entries.find((e: any) => Number(e.credit) > 0).accountId).toBe(coaIds.bankChecking);
  });

  it('BPA-05: voiding a bill paid via explicit paymentAccountId reverses both bill_created and bill_paid against the chosen Bank COA and nets to zero', async () => {
    const created = await createBill({
      description: `${P}explicit bank pay then void`,
      amount: 180,
      currency: 'TTD',
      vendor: 'Void Bank Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    const paid = await payBill(billId, { paymentAccountId: ID.faBank });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    const voided = await voidBill(billId);
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(voided.body.status).toBe('VOID');

    const txns = await txnsOf(billId);
    const originals = txns.filter((t: any) => t.type !== 'REVERSAL');
    const reversals = txns.filter((t: any) => t.type === 'REVERSAL');
    expect(originals).toHaveLength(2);
    expect(reversals).toHaveLength(2);

    const billPaidRev = reversals.find((r: any) => r.externalRef === `Expense:${billId}:bill_paid:reversal`);
    expect(billPaidRev).toBeTruthy();
    const revDebit = billPaidRev.entries.find((e: any) => Number(e.debit) > 0);
    expect(revDebit.accountId).toBe(coaIds.bankChecking);
    expect(Number(revDebit.debit)).toBe(180);

    for (const [account, net] of Object.entries(netByAccount(txns))) {
      expect(net, account).toBe(0);
    }

    const unbalanced = await db.$queryRawUnsafe(
      `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
      ID.biz,
    );
    expect(unbalanced).toEqual([]);
  });

  it('BPA-06: paying a voided bill returns 400 and writes nothing', async () => {
    const created = await createBill({ description: `${P}voided before pay`, amount: 55, currency: 'TTD' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    const voided = await voidBill(billId);
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);

    const beforeCounts = await ledgerCounts(ID.biz);
    const paid = await payBill(billId, { paymentMethod: 'cash' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(400);
    expect(await ledgerCounts(ID.biz)).toEqual(beforeCounts);
  });
});

describe('Controls: default path, auth/scope boundary, void reversal, delete guard', () => {
  it('BPA-C1: omitting paymentAccountId keeps Cash / paymentMethod default (D-168)', async () => {
    const cashBill = await createBill({ description: `${P}default cash bill`, amount: 45, currency: 'TTD' });
    expect(cashBill.status, JSON.stringify(cashBill.body)).toBe(201);
    const paidCash = await payBill(cashBill.body.id, {});
    expect(paidCash.status, JSON.stringify(paidCash.body)).toBe(201);

    const cashTxn = (await txnsOf(cashBill.body.id)).find((t: any) => t.externalRef === `Expense:${cashBill.body.id}:bill_paid`);
    expect(cashTxn.entries.find((e: any) => Number(e.credit) > 0).accountId).toBe(coaIds.cash);

    const bankBill = await createBill({ description: `${P}default bank method bill`, amount: 65, currency: 'TTD' });
    expect(bankBill.status, JSON.stringify(bankBill.body)).toBe(201);
    const paidBank = await payBill(bankBill.body.id, { paymentMethod: 'bank_transfer' });
    expect(paidBank.status, JSON.stringify(paidBank.body)).toBe(201);

    const bankTxn = (await txnsOf(bankBill.body.id)).find((t: any) => t.externalRef === `Expense:${bankBill.body.id}:bill_paid`);
    expect(bankTxn.entries.find((e: any) => Number(e.credit) > 0).accountId).toBe(coaIds.bank);
  });

  it('BPA-C2: auth/scope boundary enforces expenses:read -> 403, non-member SUPER_ADMIN -> 403 (BusinessMemberGuard), expenses:write -> 201', async () => {
    const created = await createBill({ description: `${P}scope check bill`, amount: 75, currency: 'TTD' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    const readRes = await payBill(billId, { paymentMethod: 'cash' }, ID.biz, ID.reader);
    expect(readRes.status, JSON.stringify(readRes.body)).toBe(403);
    expect((await db.expense.findUnique({ where: { id: billId } })).status).toBe('BILL');

    const superAdminRes = await payBill(billId, { paymentMethod: 'cash' }, ID.biz, ID.superAdmin);
    expect(superAdminRes.status, JSON.stringify(superAdminRes.body)).toBe(403);
    expect((await db.expense.findUnique({ where: { id: billId } })).status).toBe('BILL');

    const writeRes = await payBill(billId, { paymentMethod: 'cash' }, ID.biz, ID.writer);
    expect(writeRes.status, JSON.stringify(writeRes.body)).toBe(201);
    expect(writeRes.body.status).toBe('PAID');
  });

  it('BPA-C3: void after default pay reverses both bill_created and bill_paid and nets to zero', async () => {
    const created = await createBill({ description: `${P}default pay then void`, amount: 85, currency: 'TTD' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    expect((await payBill(billId, { paymentMethod: 'cash' })).status).toBe(201);
    const voided = await voidBill(billId);
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);

    const txns = await txnsOf(billId);
    expect(txns.filter((t: any) => t.type !== 'REVERSAL')).toHaveLength(2);
    expect(txns.filter((t: any) => t.type === 'REVERSAL')).toHaveLength(2);
    for (const [account, net] of Object.entries(netByAccount(txns))) {
      expect(net, account).toBe(0);
    }
  });

  it('BPA-C4: DELETE /expenses/businesses/:b/expenses/:id on a posted PAID expense returns 400 and leaves row intact', async () => {
    const paidExp = await expenses.createExpense({
      businessId: ID.biz,
      description: `${P}posted paid expense`,
      amount: 60,
      currency: 'TTD',
      paymentMethod: 'cash',
    });

    const res = await deleteExpense(paidExp.id);
    expect(res.status, JSON.stringify(res.body)).toBe(400);

    const row = await db.expense.findUnique({ where: { id: paidExp.id } });
    expect(row.status).toBe('PAID');
    expect(row.deletedAt).toBeNull();
  });
});

describe('R1 Security repairs (R1-SEC-01, NIT-02): malformed/blank pay inputs rejected with 400', () => {
  it('BPA-R1-01: rejects malformed/blank paymentAccountId, paidAt, and paymentMethod with 400 and zero DB/ledger writes', async () => {
    const created = await createBill({
      description: `${P}malformed payload guard bill`,
      amount: 110,
      currency: 'TTD',
      vendor: 'Validation Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;
    const beforeCounts = await ledgerCounts(ID.biz);

    const malformedPayloads: Array<[string, Record<string, unknown>]> = [
      ['numeric paymentAccountId', { paymentAccountId: 123 }],
      ['object paymentAccountId', { paymentAccountId: {} }],
      ['empty paymentAccountId', { paymentAccountId: '' }],
      ['whitespace paymentAccountId', { paymentAccountId: '   ' }],
      ['numeric paidAt', { paidAt: 1700000000000 }],
      ['blank paidAt', { paidAt: '   ' }],
      ['invalid date paidAt', { paidAt: 'not-a-date' }],
      ['numeric paymentMethod', { paymentMethod: 42 }],
    ];

    for (const [label, payload] of malformedPayloads) {
      const res = await payBill(billId, payload);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      const row = await db.expense.findUnique({ where: { id: billId } });
      expect(row.status, `${label} must leave bill as BILL`).toBe('BILL');
      expect(row.paidAt, `${label} must leave paidAt null`).toBeNull();
      expect(await ledgerCounts(ID.biz), `${label} must write zero ledger rows`).toEqual(beforeCounts);
    }
  });

  it('BPA-R1-02: explicit paymentAccountId: null preserves the D-168 Cash default (201) and omits empty metadata (NIT-02)', async () => {
    const created = await createBill({
      description: `${P}explicit null account default`,
      amount: 70,
      currency: 'TTD',
      vendor: 'Cash Default Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;

    const paid = await payBill(billId, { paymentAccountId: null });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.status).toBe('PAID');

    const paidTxn = (await txnsOf(billId)).find((t: any) => t.externalRef === `Expense:${billId}:bill_paid`);
    expect(paidTxn).toBeTruthy();
    expect(paidTxn.entries.find((e: any) => Number(e.credit) > 0).accountId).toBe(coaIds.cash);
    expect(paidTxn.metadata).toBeNull();
  });
});
