/**
 * V1-82 (FOLLOW3-B1-VOID-NET-RECEIVED) — no path voids an invoice that still
 * holds money received net (REAL database, REAL ledger posting, REAL invoice
 * workflow).
 *
 * VL-02: the transition map lets PARTIALLY_PAID move to OVERDUE and FAILED,
 * and OVERDUE and FAILED move to VOID (invoice-workflow.service.ts ALLOWED_TRANSITIONS).
 * transition() read only the status, wrote VOID compare-and-set and then
 * called RevenuePostingService.onInvoiceVoided, which reverses the whole
 * invoice_finalized recognition. Nothing read the Payment rows on the way, so
 * a part-paid invoice moved to OVERDUE (or FAILED) and then voided ended VOID
 * with its payment still SUCCESSFUL: on ACCRUAL the ledger read AR -40,
 * income 0 and cash 40; on CASH income 40 stayed on a VOID invoice. Only the
 * direct PARTIALLY_PAID -> VOID move was refused, because the map lacks it.
 *
 * Contract pinned here (D-14: money received is returned by a refund row
 * first; after it nothing is received net and VOID is allowed. D-27: PENDING
 * and FAILED rows are not money received). RED-BEFORE marks a case that fails
 * at the base:
 *
 *   VN-01 RED-BEFORE (ACCRUAL/USD) 100 sent, 40 paid (PARTIALLY_PAID), PATCH status/overdue 200, then
 *         PATCH status/void -> 409 naming the 40 received and saying to refund first; the invoice
 *         stays OVERDUE with paidAt unchanged, the payment rows stay [SUCCESSFUL 40], no invoice.void
 *         is emitted, invoice_finalized stays POSTED, the ledger reads AR 60, income 100, cash 40,
 *         and ledger AR = listPayments remaining = 60
 *   VN-02 RED-BEFORE (CASH/TTD) the same sequence -> 409; income stays 40 on a non-VOID invoice
 *   VN-03 RED-BEFORE (ACCRUAL) PATCH payment-failed 200 FAILED, then void -> 409; FAILED kept, ledger as VN-01
 *   VN-04 RED-BEFORE CommerceService.bulkUpdateInvoices(b, [id], 'void') on the OVERDUE part-paid row
 *         (the KEY bulk path) -> updated 0, the row in failed[] with that reason, nothing reversed
 *   VN-05 controls: an OVERDUE invoice never paid voids 200 and its AR is reversed to 0; an OVERDUE
 *         invoice with 40 paid and 40 refunded (net 0) voids 200; DRAFT -> VOID answers 200;
 *         PARTIALLY_PAID -> VOID answers 409 'Illegal invoice status transition: PARTIALLY_PAID -> VOID';
 *         a PAID invoice cannot reach VOID (void, overdue, payment-failed and bulk void all refused)
 *   VN-06 race: rounds of Promise.allSettled([POST payment 40, PATCH status/void]) on a fresh SENT
 *         invoice. Invariant: never VOID with net received > 0. Either the void wins and the payment is
 *         refused 4xx with no SUCCESSFUL row, or the payment wins and the void answers 409. Recorded
 *         either way; not required to go red at the base (the compare-and-set already catches it there).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed: the plan allows
 * invoices), CommerceController, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows behind the production GlobalHttpExceptionFilter, ValidationPipe and
 * TenantInterceptor. Identity attachment is the one stand-in: a test middleware
 * reads `x-v82a-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 * The event bus is a recorder; the contact timeline, TimelineService, stats
 * cache and the AI / Gmail / Drive services are stubs off the boundary;
 * ExpensePostingService (COGS on PAID) is a no-op stub (no line is a product).
 *
 * Fixtures: prefix `v82a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in beforeAll
 * and afterAll; no $transaction wrapping. Rows the server creates get server
 * ids under the prefixed businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82a_';
const HEADER = 'x-v82a-user';

const ID = {
  owner: `${P}owner`,
  bizAcc: `${P}biz_acc`,
  bizCash: `${P}biz_cash`,
  contactAcc: `${P}contact_acc`,
  contactCash: `${P}contact_cash`,
};
const CONTACT: Record<string, string> = { [ID.bizAcc]: ID.contactAcc, [ID.bizCash]: ID.contactCash };

const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let commerce: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string | null) => any;

const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}
function as(req: request.Test) {
  return req.set(HEADER, ID.owner);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

let refSeq = 0;
function pay(biz: string, invoiceId: string, amount: number) {
  refSeq += 1;
  return as(agent().post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)).send({
    amount,
    method: 'cash',
    reference: `${P}ref_${refSeq}`,
  });
}
function setStatus(biz: string, invoiceId: string, status: 'SENT' | 'OVERDUE' | 'VOID') {
  return as(agent().patch(`/commerce/invoices/${invoiceId}/status/${status.toLowerCase()}`)).send({ businessId: biz, status });
}
function paymentFailed(biz: string, invoiceId: string) {
  return as(agent().patch(`/commerce/invoices/${invoiceId}/payment-failed`)).send({ businessId: biz, reason: 'v82a card declined' });
}
function listPayments(biz: string, invoiceId: string) {
  return as(agent().get(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`));
}
function refund(biz: string, paymentId: string) {
  return as(agent().post(`/commerce/businesses/${biz}/payments/${paymentId}/refund`)).send({ reason: 'v82a refund' });
}

async function invoiceRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT status::text AS status, paid_at AS "paidAt", total, currency, business_id AS "businessId" FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function paymentRows(invoiceId: string): Promise<Array<{ id: string; status: string; amount: number; businessId: string }>> {
  const rows: any[] = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, status: r.status, amount: Number(r.amount), businessId: r.businessId }));
}

/** The invoice's net received over its own-tenant stored rows (balanceOfStoredRows, D-14 / D-27). */
async function netReceived(invoiceId: string): Promise<number> {
  const inv = await invoiceRow(invoiceId);
  const rows = (await paymentRows(invoiceId)).filter((r) => r.businessId === inv.businessId);
  return storedBalanceFn(Number(inv.total), rows, inv.currency).net;
}

/**
 * The invoice's ledger: every FinancialTransaction it sourced (its recognition
 * and any reversal) plus those of its payments (the payment postings and any
 * refund reversal). AR = debit - credit on ACCOUNTS_RECEIVABLE, income =
 * credit - debit on every REVENUE* account, cash = debit - credit on the
 * deposit accounts. `finalized` is the invoice_finalized posting's status
 * (null on CASH, which recognises nothing on issue).
 */
async function ledgerOf(biz: string, invoiceId: string) {
  const payIds = (await paymentRows(invoiceId)).map((p) => p.id);
  const txs: any[] = await db.financialTransaction.findMany({
    where: {
      businessId: biz,
      OR: [
        { sourceType: 'Invoice', sourceId: invoiceId },
        { sourceType: 'Payment', sourceId: { in: payIds } },
      ],
    },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  let ar = 0;
  let income = 0;
  let cash = 0;
  for (const t of txs) {
    for (const e of t.entries) {
      const key: string = e.account?.systemKey ?? '';
      const d = cents(e.debit);
      const c = cents(e.credit);
      if (key === 'ACCOUNTS_RECEIVABLE') ar += d - c;
      else if (key.startsWith('REVENUE')) income += c - d;
      else if (DEPOSIT_KEYS.has(key)) cash += d - c;
    }
  }
  const finalized = txs.find((t) => t.externalRef === `Invoice:${invoiceId}:invoice_finalized`);
  return { ar: ar / 100, income: income / 100, cash: cash / 100, finalized: (finalized?.status as string | undefined) ?? null };
}

function voidEventsFor(invoiceId: string) {
  return emitted.filter((e) => e.name === 'invoice.void' && e.payload?.invoice?.id === invoiceId);
}

/** A DRAFT invoice of 100 in the business's currency. Invoice numbers default to INV-<ms>: space the creates. */
async function draft(biz: string) {
  await sleep(3);
  const res = await as(agent().post(`/commerce/businesses/${biz}/invoices`)).send({
    contactId: CONTACT[biz],
    items: [{ description: 'V82A work', quantity: 1, unitPrice: 100 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body).toMatchObject({ status: 'DRAFT', total: 100 });
  return res.body.id as string;
}

async function sent(biz: string) {
  const id = await draft(biz);
  const res = await setStatus(biz, id, 'SENT');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('SENT');
  return id;
}

/** DRAFT 100, sent, paid 40: PARTIALLY_PAID with one SUCCESSFUL 40 row. */
async function partPaid(biz: string) {
  const id = await sent(biz);
  const res = await pay(biz, id, 40);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect((await invoiceRow(id)).status).toBe('PARTIALLY_PAID');
  return { id, paymentId: res.body.payment.id as string };
}

async function overdue(biz: string, id: string) {
  const res = await setStatus(biz, id, 'OVERDUE');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('OVERDUE');
}

/**
 * PATCH status/void expected to be refused 409. A void that went through
 * reports the status and the ledger it left behind (the RED-BEFORE evidence).
 */
async function expectVoidRefused(biz: string, id: string) {
  const res = await setStatus(biz, id, 'VOID');
  if (res.status !== 409) {
    const after = {
      invoice: (await invoiceRow(id))?.status,
      ledger: await ledgerOf(biz, id),
      payments: (await paymentRows(id)).map((p) => [p.status, p.amount]),
    };
    const answer = res.status < 400 ? `status ${res.body?.status}` : `message ${JSON.stringify(res.body?.message)}`;
    expect(res.status, `void answered ${res.status} (${answer}); left ${JSON.stringify(after)}`).toBe(409);
  }
  return res;
}

/** The refusal message names the net received and says to refund it first. */
function expectNetReceivedRefusal(message: unknown) {
  expect(typeof message).toBe('string');
  expect(message as string).toMatch(/40\.00/);
  expect(message as string).toMatch(/received/i);
  expect(message as string).toMatch(/refund .*first/i);
}

/** What a refused void must leave: the status held, paidAt unchanged, [SUCCESSFUL 40], no invoice.void. */
async function expectUntouched(id: string, status: string, paidAtBefore: unknown) {
  const inv = await invoiceRow(id);
  expect(inv.status).toBe(status);
  expect(inv.paidAt).toEqual(paidAtBefore);
  expect((await paymentRows(id)).map((p) => [p.status, p.amount])).toEqual([['SUCCESSFUL', 40]]);
  expect(voidEventsFor(id)).toHaveLength(0);
}

/** ACCRUAL after a refused void: the recognition stays POSTED; AR 60, income 100, cash 40; ledger AR = listPayments remaining. */
async function expectAccrualPartPaidLedger(id: string) {
  const ledger = await ledgerOf(ID.bizAcc, id);
  expect(ledger).toEqual({ ar: 60, income: 100, cash: 40, finalized: 'POSTED' });
  const listed = await listPayments(ID.bizAcc, id);
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body).toMatchObject({ paidAmount: 40, remaining: 60 });
  expect(ledger.ar).toBe(listed.body.remaining);
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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
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
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

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
      // Real ledger chain: the recognition, the payment postings and every reversal are real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      // The plan answer: invoices are within the plan.
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);

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
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  // ACCRUAL/USD: issuing posts the recognition (Dr AR / Cr revenue), a payment clears AR.
  await db.business.create({
    data: { id: ID.bizAcc, name: 'V82A Accrual', slug: `${P}biz_acc`, ownerId: ID.owner, currency: 'USD', accountingBasis: 'ACCRUAL' },
  });
  // CASH/TTD: issuing posts nothing, a payment posts Dr cash / Cr revenue.
  await db.business.create({
    data: { id: ID.bizCash, name: 'V82A Cash', slug: `${P}biz_cash`, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' },
  });
  for (const biz of [ID.bizAcc, ID.bizCash]) {
    await db.membership.create({ data: { id: `${P}m_${biz}`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({
      data: { id: CONTACT[biz], businessId: biz, firstName: 'V82A', lastName: 'Customer', email: `${P}c_${biz.slice(P.length)}@test.local` },
    });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('an ACCRUAL/USD and a CASH/TTD business, each with an owner, a contact and its system accounts; a part-paid invoice reads PARTIALLY_PAID with AR 60 on ACCRUAL', async () => {
    const acc = await db.business.findUnique({ where: { id: ID.bizAcc } });
    const cashBiz = await db.business.findUnique({ where: { id: ID.bizCash } });
    expect([acc.accountingBasis, acc.currency]).toEqual(['ACCRUAL', 'USD']);
    expect([cashBiz.accountingBasis, cashBiz.currency]).toEqual(['CASH', 'TTD']);
    for (const biz of [ID.bizAcc, ID.bizCash]) {
      const keys = (await db.chartOfAccount.findMany({ where: { businessId: biz, isSystem: true }, select: { systemKey: true } })).map(
        (a: any) => a.systemKey,
      );
      expect(keys).toEqual(expect.arrayContaining(['ACCOUNTS_RECEIVABLE', 'REVENUE', 'CASH']));
    }
    const { id } = await partPaid(ID.bizAcc);
    expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 60, income: 100, cash: 40, finalized: 'POSTED' });
    expect((await invoiceRow(id)).currency).toBe('USD');
  });
});

describe('V1-82 no path voids an invoice that still holds money received net (real rows)', () => {
  it('VN-01 RED-BEFORE (ACCRUAL/USD): part-paid 40, PATCH status/overdue 200, then PATCH status/void -> 409 naming the 40 received; OVERDUE kept, [SUCCESSFUL 40], no invoice.void, recognition POSTED, AR 60 / income 100 / cash 40 = listPayments remaining', async () => {
    const { id } = await partPaid(ID.bizAcc);
    await overdue(ID.bizAcc, id);
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const res = await expectVoidRefused(ID.bizAcc, id);
    expectNetReceivedRefusal(res.body.message);

    await expectUntouched(id, 'OVERDUE', paidAtBefore);
    await expectAccrualPartPaidLedger(id);
  });

  it('VN-02 RED-BEFORE (CASH/TTD): the same sequence -> 409; OVERDUE kept, [SUCCESSFUL 40], no invoice.void, income stays 40 on a non-VOID invoice', async () => {
    const { id } = await partPaid(ID.bizCash);
    await overdue(ID.bizCash, id);
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const res = await expectVoidRefused(ID.bizCash, id);
    expectNetReceivedRefusal(res.body.message);

    await expectUntouched(id, 'OVERDUE', paidAtBefore);
    expect(await ledgerOf(ID.bizCash, id)).toEqual({ ar: 0, income: 40, cash: 40, finalized: null });
    const listed = await listPayments(ID.bizCash, id);
    expect(listed.body).toMatchObject({ paidAmount: 40, remaining: 60 });
  });

  it('VN-03 RED-BEFORE (ACCRUAL): PATCH payment-failed answers 200 FAILED, then void -> 409; FAILED kept, the ledger as VN-01', async () => {
    const { id } = await partPaid(ID.bizAcc);
    const failed = await paymentFailed(ID.bizAcc, id);
    expect(failed.status, JSON.stringify(failed.body)).toBe(200);
    expect(failed.body.status).toBe('FAILED');
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const res = await expectVoidRefused(ID.bizAcc, id);
    expectNetReceivedRefusal(res.body.message);

    await expectUntouched(id, 'FAILED', paidAtBefore);
    await expectAccrualPartPaidLedger(id);
  });

  it('VN-04 RED-BEFORE: CommerceService.bulkUpdateInvoices(b, [id], "void") on the OVERDUE part-paid row (the KEY bulk path) -> updated 0, the row in failed[] with the refusal, nothing reversed', async () => {
    const { id } = await partPaid(ID.bizAcc);
    await overdue(ID.bizAcc, id);
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const result = await commerce.bulkUpdateInvoices(ID.bizAcc, [id], 'void');
    if (result.updated !== 0) {
      const after = { invoice: (await invoiceRow(id))?.status, ledger: await ledgerOf(ID.bizAcc, id) };
      expect(result.updated, `bulk ${JSON.stringify(result)}; left ${JSON.stringify(after)}`).toBe(0);
    }
    expect(result).toMatchObject({ updated: 0, action: 'void', failedCount: 1 });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(id);
    expectNetReceivedRefusal(result.failed[0].reason);

    await expectUntouched(id, 'OVERDUE', paidAtBefore);
    await expectAccrualPartPaidLedger(id);
  });

  describe('VN-05 controls', () => {
    it('an OVERDUE invoice that was never paid voids 200 and its AR is reversed to 0 (one invoice.void)', async () => {
      const id = await sent(ID.bizAcc);
      await overdue(ID.bizAcc, id);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 100, income: 100, cash: 0, finalized: 'POSTED' });

      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('VOID');
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      expect(voidEventsFor(id)).toHaveLength(1);
    });

    it('an OVERDUE invoice with 40 paid and 40 refunded (net 0) voids 200: AR, income and cash all 0', async () => {
      const { id, paymentId } = await partPaid(ID.bizAcc);
      await overdue(ID.bizAcc, id);
      const refunded = await refund(ID.bizAcc, paymentId);
      expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
      expect((await invoiceRow(id)).status, 'a refund does not reopen OVERDUE').toBe('OVERDUE');
      expect((await paymentRows(id)).map((p) => [p.status, p.amount])).toEqual([
        ['SUCCESSFUL', 40],
        ['REFUNDED', -40],
      ]);
      expect(await netReceived(id)).toBe(0);

      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('VOID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      expect(voidEventsFor(id)).toHaveLength(1);
    });

    it('DRAFT -> VOID answers 200', async () => {
      const id = await draft(ID.bizAcc);
      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('VOID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: null });
    });

    it("PARTIALLY_PAID -> VOID answers 409 with the unchanged message 'Illegal invoice status transition: PARTIALLY_PAID -> VOID'", async () => {
      const { id } = await partPaid(ID.bizAcc);
      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.message).toBe('Illegal invoice status transition: PARTIALLY_PAID -> VOID');
      await expectUntouched(id, 'PARTIALLY_PAID', null);
      await expectAccrualPartPaidLedger(id);
    });

    it('a PAID invoice cannot reach VOID: void, overdue and payment-failed are refused 409 and bulk void lists it failed; it stays PAID', async () => {
      const id = await sent(ID.bizAcc);
      const settled = await pay(ID.bizAcc, id, 100);
      expect(settled.status, JSON.stringify(settled.body)).toBe(201);
      const before = await invoiceRow(id);
      expect(before.status).toBe('PAID');

      const voided = await setStatus(ID.bizAcc, id, 'VOID');
      expect(voided.status, JSON.stringify(voided.body)).toBe(409);
      expect(voided.body.message).toBe('Illegal invoice status transition: PAID -> VOID');
      expect((await setStatus(ID.bizAcc, id, 'OVERDUE')).status).toBe(409);
      expect((await paymentFailed(ID.bizAcc, id)).status).toBe(409);
      const bulk = await commerce.bulkUpdateInvoices(ID.bizAcc, [id], 'void');
      expect(bulk).toMatchObject({ updated: 0, failedCount: 1 });

      const after = await invoiceRow(id);
      expect(after.status).toBe('PAID');
      expect(after.paidAt).toEqual(before.paidAt);
      expect(voidEventsFor(id)).toHaveLength(0);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 100, cash: 100, finalized: 'POSTED' });
    });
  });

  it('VN-06 race: Promise.allSettled([POST payment 40, PATCH status/void]) on a fresh SENT invoice never ends VOID with net received > 0; exactly one side wins each round', async () => {
    const ROUNDS = 8;
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const id = await sent(ID.bizAcc);
      const calls = [pay(ID.bizAcc, id, 40), setStatus(ID.bizAcc, id, 'VOID')];
      // Alternate which request is put on the wire first.
      const settled = await Promise.allSettled(round % 2 === 0 ? calls : [calls[1], calls[0]]);
      const [payRes, voidRes] = (round % 2 === 0 ? settled : [settled[1], settled[0]]).map((s) =>
        s.status === 'fulfilled' ? s.value : ({ status: 0, body: { error: String(s.reason) } } as any),
      );
      const inv = await invoiceRow(id);
      const net = await netReceived(id);
      const successful = (await paymentRows(id)).filter((p) => p.status === 'SUCCESSFUL');
      const line = `round ${round}: payment ${payRes.status}, void ${voidRes.status}, final ${inv.status}, net ${net}`;
      outcomes.push(line);

      // The invariant.
      expect(inv.status === 'VOID' && net > 0, `${line}: VOID with money received net`).toBe(false);
      if (voidRes.status === 200) {
        // The void won: the payment is refused 4xx and wrote no SUCCESSFUL row; the recognition is reversed.
        expect(payRes.status, line).toBeGreaterThanOrEqual(400);
        expect(payRes.status, line).toBeLessThan(500);
        expect(successful, line).toHaveLength(0);
        expect(inv.status, line).toBe('VOID');
        expect(await ledgerOf(ID.bizAcc, id), line).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      } else {
        // The payment won: the void is refused 409.
        expect(payRes.status, line).toBe(201);
        expect(voidRes.status, line).toBe(409);
        expect(successful.map((p) => p.amount), line).toEqual([40]);
        expect(inv.status, line).toBe('PARTIALLY_PAID');
        expect(await ledgerOf(ID.bizAcc, id), line).toEqual({ ar: 60, income: 100, cash: 40, finalized: 'POSTED' });
      }
    }
    // Recorded for the packet evidence either way.
    console.log(`[v82a VN-06]\n${outcomes.join('\n')}`);
  });
});
