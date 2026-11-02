/**
 * V1-15-DM-LEDGER-WRITE-DOOR — the posting door enforces closed accounting
 * periods, and the ledger it writes balances (REAL database, REAL posting,
 * REAL invoice workflow).
 *
 * CF-40 / M30 (docs/reconstruction/BUILD-MAP-001.md):
 *
 *   CF-40  Closing an accounting period was metadata only. AccountingPeriodService
 *          stamped `lockedByPeriod` on the period's transactions, but
 *          checkClosed() had no caller, so PostingService.post() dated inside a
 *          CLOSED period succeeded, and so did every payment, refund and expense
 *          that posts through it.
 *   M30    Journal balance was enforced only in application code, with no
 *          real-database trial balance per currency.
 *
 * Contract pinned here:
 *
 *   LWD-01  post() dated inside a CLOSED period (first day, mid-month, last
 *           instant)                          -> ConflictException (409); no row
 *   LWD-02  reopen the period                 -> the same post succeeds, balanced
 *   LWD-03  another tenant's CLOSED period does not block this tenant
 *   LWD-04  an idempotent replay of a posting that already exists returns it
 *           (writes nothing) even after its period closed
 *   LWD-05  HTTP manual payment while the current period is CLOSED -> 409; no
 *           Payment row, no posting, invoice status unchanged
 *   LWD-06  HTTP refund while the current period is CLOSED -> 409; payment still
 *           SUCCESSFUL, no reversal, invoice status unchanged
 *   LWD-07  reopen                            -> the payment and the refund post
 *   TB-01   trial balance after payments (two currencies), a refund and an
 *           expense void: sum(debit) = sum(credit) per currency, every
 *           transaction balanced, entry currency = transaction currency
 *   TB-02   accrual AR net per invoice = computeBalance(...).remaining, for every
 *           invoice whose payments were not refunded; the AR account holds
 *           nothing that is not attributable to an invoice
 *   TB-03   (todo) the same equality for a refunded invoice: blocked by M28,
 *           see the case.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService, ExpensesService and ExpensePostingService write
 * real rows, and the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Identity attachment is the one stand-in: a test middleware reads
 * `x-v15a-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recorder; the contact timeline, stats cache and the AI / Gmail / Drive
 * services are stubs off the ledger path.
 *
 * Fixtures: prefix `v15a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PostingService, PostingInput } from '../src/modules/finance/posting.service';
import type { AccountingPeriodService } from '../src/modules/finance/accounting-period.service';
import type { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';
import type { ExpensesService } from '../src/modules/expenses/expenses.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v15a_';
const HEADER = 'x-v15a-user';

const ID = {
  owner: `${P}owner`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`, // direct post() cases
  bizB: `${P}bizB`, // another tenant with its own closed period
  bizPay: `${P}bizPay`, // HTTP payment / refund against a closed current period
  bizTB: `${P}bizTB`, // trial balance (accrual basis)
  contactPay: `${P}contactPay`,
  contactTB: `${P}contactTB`,
  invPayEarly: `${P}invPayEarly`,
  invPayClosed: `${P}invPayClosed`,
  invPart: `${P}invPart`,
  invFull: `${P}invFull`,
  invRefund: `${P}invRefund`,
  invOpen: `${P}invOpen`,
  invUsd: `${P}invUsd`,
};

const TB_INVOICES: Array<{ id: string; total: number; currency: string }> = [
  { id: ID.invPart, total: 100, currency: 'TTD' },
  { id: ID.invFull, total: 100, currency: 'TTD' },
  { id: ID.invRefund, total: 100, currency: 'TTD' },
  { id: ID.invOpen, total: 100, currency: 'TTD' },
  { id: ID.invUsd, total: 250, currency: 'USD' },
];

let db: any;
let app: any;
let redis: any;
let posting: PostingService;
let periods: AccountingPeriodService;
let coa: ChartOfAccountsSeederService;
let workflow: InvoiceWorkflowService;
let expenses: ExpensesService;
let computeBalance: (total: number, payments: Array<{ amount: unknown; status: string }>, currency?: string) => { remaining: number };

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
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function pay(businessId: string, invoiceId: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${businessId}/invoices/${invoiceId}/payments`).set(HEADER, ID.owner).send(body);
}

function refund(businessId: string, paymentId: string) {
  return agent().post(`/commerce/businesses/${businessId}/payments/${paymentId}/refund`).set(HEADER, ID.owner).send({ reason: 'v15a refund' });
}

/** Ledger row counts for one business (a fresh read). */
async function ledgerCounts(businessId: string): Promise<{ txns: number; entries: number }> {
  return {
    txns: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

async function accountId(businessId: string, systemKey: string): Promise<string> {
  const row = await coa.getBySystemKey(businessId, systemKey);
  if (!row) throw new Error(`no ${systemKey} account for ${businessId}`);
  return row.id;
}

/** A balanced cash sale for `businessId`, dated `date`. */
async function probe(businessId: string, sourceId: string, date: Date): Promise<PostingInput> {
  return {
    businessId,
    type: 'INCOME',
    date,
    amount: 10,
    currency: 'TTD',
    description: `v15a probe ${sourceId}`,
    sourceType: 'V15Probe',
    sourceId,
    kind: 'probe',
    entries: [
      { accountId: await accountId(businessId, 'CASH'), debit: 10 },
      { accountId: await accountId(businessId, 'REVENUE'), credit: 10 },
    ],
  };
}

async function openAndClose(businessId: string, year: number, month: number) {
  const period = await periods.create(businessId, { year, month });
  return periods.close(businessId, period.id, { closedById: ID.owner });
}

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

async function paymentPostings(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({ where: { sourceType: 'Payment', sourceId: paymentId }, orderBy: { createdAt: 'asc' } });
}

async function seedInvoice(id: string, businessId: string, contactId: string, n: number, total: number, currency: string, status: string) {
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V15A-${String(n).padStart(3, '0')}`,
      status,
      subtotal: total,
      total,
      currency,
      businessId,
      contactId,
      items: { create: [{ id: `${id}_item1`, description: `v15a item ${n}`, quantity: 1, unitPrice: total, total }] },
    },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const PostingMod = await import('../src/modules/finance/posting.service');
  const PeriodMod = await import('../src/modules/finance/accounting-period.service');
  const SeederMod = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const ExpensesMod = await import('../src/modules/expenses/expenses.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  computeBalance = workflowMod.computeBalance as typeof computeBalance;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // The real ledger chain, including the period ledger the door consults.
      RevenuePostingService,
      PostingMod.PostingService,
      PeriodMod.AccountingPeriodService,
      SeederMod.ChartOfAccountsSeederService,
      ExpensePostingService,
      ExpensesMod.ExpensesService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  posting = moduleRef.get(PostingMod.PostingService);
  periods = moduleRef.get(PeriodMod.AccountingPeriodService);
  coa = moduleRef.get(SeederMod.ChartOfAccountsSeederService);
  workflow = moduleRef.get(workflowMod.InvoiceWorkflowService);
  expenses = moduleRef.get(ExpensesMod.ExpensesService);

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

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  for (const [biz, owner, basis] of [
    [ID.bizA, ID.owner, 'CASH'],
    [ID.bizB, ID.ownerB, 'CASH'],
    [ID.bizPay, ID.owner, 'CASH'],
    [ID.bizTB, ID.owner, 'ACCRUAL'],
  ] as const) {
    await db.business.create({ data: { id: biz, name: `V15A ${biz}`, ownerId: owner, currency: 'TTD', accountingBasis: basis } });
    await db.membership.create({ data: { id: `${biz}_m`, userId: owner, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
  }
  await db.contact.create({ data: { id: ID.contactPay, businessId: ID.bizPay, firstName: 'V15A', lastName: 'Payer', email: `${P}payer@test.local` } });
  await db.contact.create({ data: { id: ID.contactTB, businessId: ID.bizTB, firstName: 'V15A', lastName: 'Ledger', email: `${P}ledger@test.local` } });

  await seedInvoice(ID.invPayEarly, ID.bizPay, ID.contactPay, 1, 100, 'TTD', 'SENT');
  await seedInvoice(ID.invPayClosed, ID.bizPay, ID.contactPay, 2, 100, 'TTD', 'SENT');
  let n = 10;
  for (const inv of TB_INVOICES) {
    n += 1;
    // DRAFT, then SENT through the workflow: on accrual basis that posts Dr AR / Cr Revenue.
    await seedInvoice(inv.id, ID.bizTB, ID.contactTB, n, inv.total, inv.currency, 'DRAFT');
    await workflow.transition(inv.id, 'SENT');
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('seeded four tenants with a chart of accounts, and the accrual invoices are recognised in AR', async () => {
    for (const biz of [ID.bizA, ID.bizB, ID.bizPay, ID.bizTB]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } }), biz).toBeGreaterThan(0);
      expect(await db.accountingPeriod.count({ where: { businessId: biz } }), biz).toBe(0);
    }
    const finalized = await db.financialTransaction.findMany({ where: { businessId: ID.bizTB, sourceType: 'Invoice' } });
    expect(finalized.map((t: any) => t.sourceId).sort()).toEqual(TB_INVOICES.map((i) => i.id).sort());
  });
});

describe('CF-40: post() refuses a date inside a CLOSED accounting period', () => {
  let closedMarch: any;

  beforeAll(async () => {
    closedMarch = await openAndClose(ID.bizA, 2025, 3);
  });

  it('LWD-01: post() dated inside a CLOSED period (first day, mid-month, last instant) -> 409; no transaction, no entry', async () => {
    expect(closedMarch.status).toBe('CLOSED');
    const before = await ledgerCounts(ID.bizA);
    for (const [label, date] of [
      ['first day', new Date(Date.UTC(2025, 2, 1, 0, 0, 0, 0))],
      ['mid-month', new Date(Date.UTC(2025, 2, 15, 12, 0, 0))],
      ['last instant', new Date(Date.UTC(2025, 2, 31, 23, 59, 59, 999))],
    ] as const) {
      const input = await probe(ID.bizA, `${P}closed_${label.replace(/\W+/g, '-')}`, date);
      await expect(posting.post(input), label).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/closed/i) });
    }
    expect(await ledgerCounts(ID.bizA)).toEqual(before);
  });

  it('LWD-01b: the day after the closed period posts (the guard is the period, not the month around it)', async () => {
    const res = await posting.post(await probe(ID.bizA, `${P}after_close`, new Date(Date.UTC(2025, 3, 1, 0, 0, 0, 0))));
    expect(res.alreadyPosted).toBe(false);
  });

  it('LWD-02: reopening the period allows the same post; it is written once and balanced', async () => {
    await periods.reopen(ID.bizA, closedMarch.id);
    const input = await probe(ID.bizA, `${P}closed_mid-month`, new Date(Date.UTC(2025, 2, 15, 12, 0, 0)));
    const res = await posting.post(input);
    expect(res.alreadyPosted).toBe(false);
    const txn = await db.financialTransaction.findUnique({ where: { id: res.transactionId }, include: { entries: true } });
    expect(txn.status).toBe('POSTED');
    expect(txn.date.toISOString()).toBe('2025-03-15T12:00:00.000Z');
    const debit = txn.entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
    const credit = txn.entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    expect(txn.entries).toHaveLength(2);
    expect(debit).toBe(10);
    expect(credit).toBe(10);
  });

  it('LWD-03: another tenant\'s CLOSED period does not block this tenant (and does block its own)', async () => {
    await openAndClose(ID.bizB, 2025, 4);
    const date = new Date(Date.UTC(2025, 3, 10, 9, 0, 0));
    const before = await ledgerCounts(ID.bizB);
    await expect(posting.post(await probe(ID.bizB, `${P}b_closed`, date))).rejects.toMatchObject({ status: 409 });
    expect(await ledgerCounts(ID.bizB)).toEqual(before);

    const res = await posting.post(await probe(ID.bizA, `${P}a_in_b_closed_month`, date));
    expect(res.alreadyPosted).toBe(false);
    expect((await db.financialTransaction.findUnique({ where: { id: res.transactionId } })).businessId).toBe(ID.bizA);
  });

  it('LWD-04: an idempotent replay of a posting that already exists returns it after its period closed, writing nothing', async () => {
    await periods.close(ID.bizA, closedMarch.id, { closedById: ID.owner });
    const before = await ledgerCounts(ID.bizA);
    const replay = await posting.post(await probe(ID.bizA, `${P}closed_mid-month`, new Date(Date.UTC(2025, 2, 15, 12, 0, 0))));
    expect(replay.alreadyPosted).toBe(true);
    expect(await ledgerCounts(ID.bizA)).toEqual(before);
  });
});

describe('CF-40 over HTTP: payments and refunds post through the door, so a closed current period refuses them', () => {
  let earlyPaymentId: string;
  let currentId: string;

  beforeAll(async () => {
    // A payment recorded while the period is open, to refund after it closes.
    const early = await pay(ID.bizPay, ID.invPayEarly, { amount: 40, method: 'cash', reference: `${P}early` });
    expect(early.status, JSON.stringify(early.body)).toBe(201);
    earlyPaymentId = early.body.payment.id;
    const { year, month } = currentPeriod();
    currentId = (await openAndClose(ID.bizPay, year, month)).id;
  });

  it('LWD-05: POST a manual payment while the current period is CLOSED -> 409; no Payment row, no posting, invoice still SENT', async () => {
    const before = await ledgerCounts(ID.bizPay);
    const res = await pay(ID.bizPay, ID.invPayClosed, { amount: 40, method: 'cash', reference: `${P}closed` });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await db.payment.count({ where: { invoiceId: ID.invPayClosed } })).toBe(0);
    expect(await ledgerCounts(ID.bizPay)).toEqual(before);
    expect((await db.invoice.findUnique({ where: { id: ID.invPayClosed } })).status).toBe('SENT');
  });

  it('LWD-06: refund while the current period is CLOSED -> 409; payment still SUCCESSFUL, no reversal, invoice status unchanged', async () => {
    const statusBefore = (await db.invoice.findUnique({ where: { id: ID.invPayEarly } })).status;
    const before = await ledgerCounts(ID.bizPay);
    const res = await refund(ID.bizPay, earlyPaymentId);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await db.payment.findUnique({ where: { id: earlyPaymentId } })).status).toBe('SUCCESSFUL');
    expect(await paymentPostings(earlyPaymentId)).toHaveLength(1);
    expect(await ledgerCounts(ID.bizPay)).toEqual(before);
    expect((await db.invoice.findUnique({ where: { id: ID.invPayEarly } })).status).toBe(statusBefore);
  });

  it('LWD-07: reopening the current period allows the payment and the refund to post', async () => {
    await periods.reopen(ID.bizPay, currentId);
    const res = await pay(ID.bizPay, ID.invPayClosed, { amount: 40, method: 'cash', reference: `${P}reopened` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await paymentPostings(res.body.payment.id)).toHaveLength(1);

    const r = await refund(ID.bizPay, earlyPaymentId);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const postings = await paymentPostings(earlyPaymentId);
    expect(postings.map((t: any) => t.type)).toEqual(['INCOME', 'REVERSAL']);
    expect(postings[0].status).toBe('REVERSED');
  });
});

describe('M30: real-database trial balance after payment, refund and void', () => {
  const paymentsOf: Record<string, string[]> = {};
  let voidedExpenseId: string;

  beforeAll(async () => {
    const plan: Array<[string, number]> = [
      [ID.invPart, 40],
      [ID.invFull, 100],
      [ID.invRefund, 40],
      [ID.invUsd, 100],
    ];
    for (const [inv, amount] of plan) {
      const res = await pay(ID.bizTB, inv, { amount, method: 'cash', reference: `${P}tb-${inv.slice(P.length)}` });
      expect(res.status, `${inv}: ${JSON.stringify(res.body)}`).toBe(201);
      paymentsOf[inv] = [...(paymentsOf[inv] ?? []), res.body.payment.id];
    }
    const r = await refund(ID.bizTB, paymentsOf[ID.invRefund][0]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    // An expense paid and then voided, plus a bill left open (AP).
    const paid = await expenses.createExpense({ businessId: ID.bizTB, description: `${P}tb paid expense`, amount: 30, currency: 'TTD', paymentMethod: 'cash' });
    voidedExpenseId = paid.id;
    await expenses.voidExpense({ businessId: ID.bizTB, expenseId: paid.id, reason: 'v15a trial balance void' });
    await expenses.createExpense({ businessId: ID.bizTB, description: `${P}tb open bill`, amount: 20, currency: 'TTD', status: 'BILL' });
  });

  it('TB-01: sum(debit) = sum(credit) per currency; every transaction balanced; entry currency = transaction currency', async () => {
    const perCurrency: Array<{ currency: string; debit: string; credit: string; n: number }> = await db.$queryRawUnsafe(
      `SELECT currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit, COUNT(*)::int AS n
         FROM ledger_entries WHERE business_id = $1 GROUP BY currency ORDER BY currency`,
      ID.bizTB,
    );
    expect(perCurrency.map((r) => r.currency)).toEqual(['TTD', 'USD']);
    for (const r of perCurrency) {
      expect(r.n, r.currency).toBeGreaterThan(1);
      expect(Number(r.debit), `${r.currency} debits vs credits`).toBe(Number(r.credit));
    }
    const unbalanced = await db.$queryRawUnsafe(
      `SELECT transaction_id, SUM(debit)::text AS d, SUM(credit)::text AS c FROM ledger_entries
        WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
      ID.bizTB,
    );
    expect(unbalanced).toEqual([]);
    const mixed = await db.$queryRawUnsafe(
      `SELECT le.id FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
        WHERE le.business_id = $1 AND (le.currency <> ft.currency OR le.business_id <> ft.business_id)`,
      ID.bizTB,
    );
    expect(mixed).toEqual([]);

    // The void is in the books as a reversal through the door, and the expense nets to zero.
    const expenseTxns = await db.financialTransaction.findMany({ where: { businessId: ID.bizTB, sourceType: 'Expense', sourceId: voidedExpenseId } });
    expect(expenseTxns.map((t: any) => t.type).sort()).toEqual(['EXPENSE', 'REVERSAL']);
  });

  /** AR net (debit - credit) attributable to one invoice: its recognition and its payments' postings and reversals. */
  async function arNet(invoiceId: string): Promise<number> {
    const ar = await accountId(ID.bizTB, 'ACCOUNTS_RECEIVABLE');
    const pays: string[] = (await db.payment.findMany({ where: { invoiceId }, select: { id: true } })).map((p: any) => p.id);
    const [row] = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(le.debit - le.credit), 0)::text AS net
         FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
        WHERE le.business_id = $1 AND le.account_id = $2
          AND ((ft.source_type = 'Invoice' AND ft.source_id = $3) OR (ft.source_type = 'Payment' AND ft.source_id = ANY($4::text[])))`,
      ID.bizTB,
      ar,
      invoiceId,
      pays,
    );
    return Number(row.net);
  }

  async function remainingOf(invoiceId: string): Promise<number> {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    return computeBalance(Number(inv.total), inv.payments, inv.currency).remaining;
  }

  it('TB-02: accrual AR net equals computeBalance.remaining for every invoice whose payments were not refunded; AR holds nothing unattributed', async () => {
    const expected: Record<string, number> = { [ID.invPart]: 60, [ID.invFull]: 0, [ID.invOpen]: 100, [ID.invUsd]: 150 };
    for (const [inv, value] of Object.entries(expected)) {
      expect(await arNet(inv), `AR of ${inv}`).toBe(value);
      expect(await remainingOf(inv), `computeBalance.remaining of ${inv}`).toBe(value);
    }
    // The refunded invoice: the ledger is right (the reversal restores the receivable).
    const refunded = await db.invoice.findUnique({ where: { id: ID.invRefund }, include: { payments: true } });
    const settled = refunded.payments.filter((p: any) => p.status === 'SUCCESSFUL').reduce((s: number, p: any) => s + p.amount, 0);
    expect(refunded.payments.map((p: any) => p.status)).toEqual(['REFUNDED']);
    expect(await arNet(ID.invRefund)).toBe(Number(refunded.total) - settled);

    // Every AR posting is attributable to one of the invoices above.
    const ar = await accountId(ID.bizTB, 'ACCOUNTS_RECEIVABLE');
    const [total] = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(debit - credit), 0)::text AS net FROM ledger_entries WHERE business_id = $1 AND account_id = $2`,
      ID.bizTB,
      ar,
    );
    let sum = 0;
    for (const inv of TB_INVOICES) sum += await arNet(inv.id);
    expect(Number(total.net)).toBe(sum);
  });

  // M28 (owned by V1-29, invoice-workflow.service.ts is outside this packet's
  // write set): a refund flips the payment row to REFUNDED and computeBalance
  // both drops it from `paid` and subtracts it again as `refunded`, so for the
  // refunded invoice above remaining = 140 while the ledger AR is 100. The
  // ledger side is pinned in TB-02; the equality is owed by V1-29.
  it.todo('TB-03: AR net equals computeBalance.remaining for a refunded invoice (blocked by M28 / V1-29: computeBalance subtracts a REFUNDED payment twice)');
});
