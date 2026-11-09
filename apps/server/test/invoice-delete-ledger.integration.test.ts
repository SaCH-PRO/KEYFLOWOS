/**
 * V1-82 (FOLLOW3-B6-DELETE-ISSUED-INVOICE) — deleting an invoice never strands
 * its receivable or the money received on it: single DELETE, the bulk route
 * and the KEY bulk shape (REAL database, REAL ledger posting, REAL invoice
 * workflow, REAL receivables and trial balance).
 *
 * At bb6b86d4 CommerceService.deleteInvoice refused only PAID and
 * PARTIALLY_PAID, then stamped deletedAt and emitted invoice.deleted, and the
 * bulk 'delete' was one updateMany over `status notIn [PAID, PARTIALLY_PAID]`.
 * Nothing reversed the invoice_finalized recognition or the payments, and every
 * reader (listInvoices, receivables, aging) drops a deleted invoice. So an
 * ACCRUAL invoice of 100 sent and deleted left AR 100 in the trial balance for
 * an invoice no receivables list shows, an OVERDUE invoice with 40 received
 * left cash 40 and AR 60 against a deleted document, and a CASH FAILED invoice
 * with 40 received left income 40 on it.
 *
 * Owner ruling D-66: only DRAFT and VOID invoices may be deleted (single, bulk,
 * KEY); an issued invoice is voided first (which reverses its recognition).
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the base):
 *
 *   DL-01 RED-BEFORE ACCRUAL SENT 100 (AR 100), DELETE -> 409 naming SENT and "void it first"; deletedAt null,
 *                    the business's Payment, FinancialTransaction and LedgerEntry rows byte-identical, no
 *                    invoice.deleted, recognition POSTED, the invoice still listed and in the customer balance;
 *                    the remedy then works: void (recognition REVERSED) and DELETE -> 200
 *   DL-02 RED-BEFORE ACCRUAL SENT 100, paid 40 (PARTIALLY_PAID), PATCH status/overdue, DELETE -> 409 naming
 *                    OVERDUE, the 40 received and "refund ... first"; AR 60 / income 100 / cash 40 kept
 *   DL-03 RED-BEFORE CASH SENT 100, paid 40, PATCH payment-failed (FAILED), DELETE -> 409 naming FAILED and
 *                    "refund ... first"; income 40 / cash 40 stay on a live invoice
 *   DL-04 RED-BEFORE PATCH invoices/bulk {action:'delete', ids:[DRAFT, VOID, SENT with AR, OVERDUE part-paid]}
 *                    -> updated 2 (the DRAFT and the VOID), the SENT and OVERDUE rows listed in `skipped` with
 *                    their status and the single route's reason; the same through
 *                    CommerceService.bulkUpdateInvoices (the KEY shape)
 *   DL-05 controls:  DRAFT DELETE 200 (invoice.deleted emitted); VOID (unpaid, recognition reversed) DELETE
 *                    200; PAID and PARTIALLY_PAID still 409 'Cannot delete a paid or partially paid invoice';
 *                    a member of another business gets 403 on A's route and 404 on its own
 *   DL-06 RED-BEFORE an ACCRUAL SENT 100 returned to DRAFT by the AI undo (recognition kept, AR 100): DELETE and
 *                    bulk delete -> refused ("an issued invoice returned to DRAFT", "void it first"); void then
 *                    DELETE -> 200 with AR 0
 *
 *   DL-07 RED-BEFORE the invariant below over every invoice of both businesses, deleted ones included
 *
 * Ledger invariant asserted after every case (booksAgree, over the invoices the
 * case created): for each live ACCRUAL invoice its own ledger AR equals
 * listPayments `remaining` while its recognition is POSTED (0 otherwise), the
 * trial balance's AR moved by exactly the live invoices' AR, and no deleted
 * invoice carries AR, income, cash or net money received. DL-07 asserts it
 * once more over every invoice of both businesses, the trial balance's AR
 * against the live invoices' AR.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed: the plan allows
 * invoices), CommerceController, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService,
 * ReceivablesService and LedgerBalanceService read and write real rows behind
 * the production GlobalHttpExceptionFilter, ValidationPipe and
 * TenantInterceptor. Identity attachment is the one stand-in: a test
 * middleware reads `x-v82f-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware
 * would. The event bus is a recording stub (so a refused delete is shown to
 * emit no invoice.deleted); the CRM contact log, TimelineService, stats cache
 * and the AI / Gmail / Drive services are stubs off the boundary.
 *
 * Fixtures: prefix `v82f_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in
 * beforeAll and afterAll; no $transaction wrapping. Rows the server creates get
 * server ids under the prefixed businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82f_';
const HEADER = 'x-v82f-user';

const ID = {
  owner: `${P}owner`,
  other: `${P}other`,
  acc: `${P}biz_acc`,
  cash: `${P}biz_cash`,
  otherBiz: `${P}biz_other`,
  contactAcc: `${P}contact_acc`,
  contactCash: `${P}contact_cash`,
};

const PAID_REFUSED = 'Cannot delete a paid or partially paid invoice';
/** D-66: the refusal names the status (with its article) and the remedy. */
const VOID_FIRST = (status: string) => new RegExp(`^Cannot delete an? ${status} invoice: .*void it first`);
const REFUND_FIRST = (status: string, received: string) =>
  new RegExp(`^Cannot delete an? ${status} invoice: it holds TTD ${received.replace('.', '\\.')} received; refund .* first`);
const RETURNED_VOID_FIRST = /^Cannot delete an issued invoice returned to DRAFT: .*void it first/;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let commerce: any;
let receivables: any;
let ledgerBalance: any;
let coa: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string | null) => any;

/** The event bus: records every emit, so a refused delete is shown to emit nothing. */
const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload?: unknown) => {
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
function as(req: request.Test, user: string = ID.owner) {
  return req.set(HEADER, user);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const contactOf = (biz: string) => (biz === ID.acc ? ID.contactAcc : ID.contactCash);

/** POST a DRAFT invoice of one line of 100. Invoice numbers default to INV-<ms>, unique per tenant (V1-43): space the creates. */
async function draft(biz: string, label: string) {
  await sleep(3);
  const res = await as(agent().post(`/commerce/businesses/${biz}/invoices`)).send({
    contactId: contactOf(biz),
    items: [{ description: `V82F ${label}`, quantity: 1, unitPrice: 100 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.status).toBe('DRAFT');
  expect(res.body.total).toBe(100);
  caseInvoices.push(res.body.id);
  return res.body.id as string;
}
async function moveTo(biz: string, invoiceId: string, status: 'SENT' | 'OVERDUE' | 'VOID') {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/status/${status.toLowerCase()}`)).send({ businessId: biz, status });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe(status);
}
async function sent(biz: string, label: string) {
  const id = await draft(biz, label);
  await moveTo(biz, id, 'SENT');
  return id;
}
async function pay(biz: string, invoiceId: string, amount: number) {
  const res = await as(agent().post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)).send({ amount, method: 'cash' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
async function paymentFailed(biz: string, invoiceId: string) {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/payment-failed`)).send({ businessId: biz, reason: 'v82f declined' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('FAILED');
}
async function markPaid(biz: string, invoiceId: string) {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/paid`)).send({ businessId: biz });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('PAID');
}
/** SENT 100, paid 40 (PARTIALLY_PAID), made OVERDUE. */
async function overduePartPaid(biz: string, label: string) {
  const id = await sent(biz, label);
  await pay(biz, id, 40);
  expect((await invoiceRow(id)).status).toBe('PARTIALLY_PAID');
  await moveTo(biz, id, 'OVERDUE');
  return id;
}
/** SENT 100 then voided, unpaid (ACCRUAL: recognition reversed). */
async function voided(biz: string, label: string) {
  const id = await sent(biz, label);
  await moveTo(biz, id, 'VOID');
  return id;
}
function del(biz: string, invoiceId: string, user: string = ID.owner) {
  return as(agent().delete(`/commerce/businesses/${biz}/invoices/${invoiceId}`), user);
}
function bulkDelete(biz: string, ids: string[]) {
  return as(agent().patch(`/commerce/businesses/${biz}/invoices/bulk`)).send({ action: 'delete', ids });
}

async function invoiceRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT status::text AS status, total, currency, business_id AS "businessId", deleted_at AS "deletedAt" FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

/** The business's books as stored: every Payment, FinancialTransaction and LedgerEntry row, read raw. */
async function books(biz: string) {
  const payments = await db.$queryRawUnsafe(
    `SELECT id, invoice_id AS "invoiceId", amount::text AS amount, status, provider, created_at::text AS "createdAt"
       FROM payments WHERE business_id = $1 ORDER BY id`,
    biz,
  );
  const transactions = await db.$queryRawUnsafe(
    `SELECT id, status, amount::text AS amount, source_type AS "sourceType", source_id AS "sourceId", updated_at::text AS "updatedAt"
       FROM financial_transactions WHERE business_id = $1 ORDER BY id`,
    biz,
  );
  const entries = await db.$queryRawUnsafe(
    `SELECT id, transaction_id AS "transactionId", account_id AS "accountId", debit::text AS debit, credit::text AS credit
       FROM ledger_entries WHERE business_id = $1 ORDER BY id`,
    biz,
  );
  return { payments, transactions, entries };
}

/** The invoice's net received over its own-tenant stored rows (balanceOfStoredRows, D-14), in cents. */
async function netReceivedCents(invoiceId: string): Promise<number> {
  const inv = await invoiceRow(invoiceId);
  const rows: any[] = await db.payment.findMany({ where: { invoiceId, businessId: inv.businessId } });
  return cents(storedBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency).net);
}

/**
 * The invoice's ledger, in cents: every FinancialTransaction it sourced (its
 * recognition and any reversal) plus those of its payments. AR = debit -
 * credit on ACCOUNTS_RECEIVABLE, income = credit - debit on every REVENUE*
 * account, cash = debit - credit on the deposit accounts. `finalized` is the
 * invoice_finalized posting's status (null on CASH, which recognises nothing).
 */
async function ledgerOf(biz: string, invoiceId: string) {
  const payIds = (await db.payment.findMany({ where: { invoiceId }, select: { id: true } })).map((p: any) => p.id);
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
  return { ar, income, cash, finalized: (finalized?.status as string | undefined) ?? null };
}

/** The trial balance's accounts receivable (LedgerBalanceService.getTrialBalance), in cents. */
async function trialBalanceArCents(biz: string): Promise<number> {
  const rows: any[] = await ledgerBalance.getTrialBalance(biz);
  return rows.filter((r) => r.systemKey === 'ACCOUNTS_RECEIVABLE').reduce((s, r) => s + cents(r.net), 0);
}

/** listPayments (GET .../payments) for a live invoice, in cents. */
async function listed(biz: string, invoiceId: string) {
  const res = await as(agent().get(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { net: cents(res.body.paidAmount), remaining: cents(res.body.remaining) };
}

/**
 * The ledger invariant over a set of invoices of the business (deleted ones
 * included): a deleted invoice carries no AR, income, cash or net money
 * received; a live ACCRUAL invoice's own ledger AR equals listPayments
 * `remaining` while its recognition is POSTED (0 once reversed or never
 * posted). With `trialBalanceDelta`, the trial balance's AR moved by exactly
 * the live invoices' AR (a deleted invoice's AR left in the books shows here
 * too). Soft assertions, so a RED run reports every drift at once.
 */
async function booksAgree(biz: string, label: string, invoiceIds: string[] | 'all', trialBalanceDelta?: number) {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, deleted_at AS "deletedAt" FROM invoices WHERE business_id = $1 ORDER BY id`,
    biz,
  );
  let liveAr = 0;
  for (const r of rows) {
    if (invoiceIds !== 'all' && !invoiceIds.includes(r.id)) continue;
    const l = await ledgerOf(biz, r.id);
    if (r.deletedAt) {
      const net = await netReceivedCents(r.id);
      expect.soft(
        { ar: l.ar, income: l.income, cash: l.cash, net },
        `${label}: deleted ${r.status} invoice ${r.id} carries no AR, income, cash or money received`,
      ).toEqual({ ar: 0, income: 0, cash: 0, net: 0 });
      continue;
    }
    liveAr += l.ar;
    if (biz === ID.acc) {
      const b = await listed(biz, r.id);
      const expected = l.finalized === 'POSTED' ? b.remaining : 0;
      expect.soft(l.ar, `${label}: live ${r.status} invoice ${r.id}: ledger AR == listPayments remaining while recognised`).toBe(expected);
    }
  }
  if (biz === ID.acc && trialBalanceDelta !== undefined) {
    expect.soft(trialBalanceDelta, `${label}: the trial-balance AR moved by the live invoices' AR`).toBe(liveAr);
  }
}

/** The invoices the running case created (draft() records them), and the trial-balance AR before it. */
const caseInvoices: string[] = [];
let caseTrialBalanceAr = 0;

/** The refused-delete contract: 409 with the message, the row live, the books byte-identical, no invoice.deleted. */
async function expectDeleteRefused(res: request.Response, message: string | RegExp, biz: string, invoiceId: string, before: unknown) {
  expect.soft(res.status, JSON.stringify(res.body)).toBe(409);
  const text = String(res.body?.message ?? '');
  if (typeof message === 'string') expect.soft(text).toBe(message);
  else expect.soft(text).toMatch(message);
  expect.soft((await invoiceRow(invoiceId)).deletedAt, 'deletedAt stays null').toBeNull();
  expect.soft(await books(biz), 'Payment, FinancialTransaction and LedgerEntry rows byte-identical').toEqual(before);
  expect.soft(
    emitted.filter((e) => e.name === 'invoice.deleted').map((e) => e.payload?.invoiceId),
    'no invoice.deleted event',
  ).not.toContain(invoiceId);
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
  const { InvoiceWorkflowService } = workflowMod;
  storedBalanceFn = workflowMod.balanceOfStoredRows;
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
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

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
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain, receivables and trial balance: the recognition, payments and the AR reads are real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      ReceivablesService,
      LedgerBalanceService,
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
      // Gmail is stubbed: nothing here emails.
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  receivables = moduleRef.get(ReceivablesService);
  ledgerBalance = moduleRef.get(LedgerBalanceService);
  coa = moduleRef.get(ChartOfAccountsSeederService);

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
  await db.user.create({ data: { id: ID.other, email: `${P}other@test.local`, role: 'USER' } });
  // ACCRUAL: issuing posts the receivable (Dr AR / Cr revenue). CASH: nothing posts until money arrives.
  for (const [id, basis] of [[ID.acc, 'ACCRUAL'], [ID.cash, 'CASH']] as const) {
    await db.business.create({
      data: { id, name: `V82F ${basis}`, slug: `${P}${basis.toLowerCase()}`, ownerId: ID.owner, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${P}m_${basis.toLowerCase()}`, userId: ID.owner, businessId: id, role: 'OWNER' } });
    await db.contact.create({
      data: { id: contactOf(id), businessId: id, firstName: 'V82F', lastName: basis, email: `${P}${basis.toLowerCase()}@test.local` },
    });
    await coa.ensureDefaults(id);
  }
  // Business B: its owner is a member of B only.
  await db.business.create({
    data: { id: ID.otherBiz, name: 'V82F Other', slug: `${P}other`, ownerId: ID.other, currency: 'TTD', accountingBasis: 'ACCRUAL' },
  });
  await db.membership.create({ data: { id: `${P}m_other`, userId: ID.other, businessId: ID.otherBiz, role: 'OWNER' } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(async () => {
  caseInvoices.length = 0;
  caseTrialBalanceAr = await trialBalanceArCents(ID.acc);
});

afterEach(async () => {
  // The ledger invariant after every case, on both bases, over the invoices the case created.
  await booksAgree(ID.acc, 'ACCRUAL', caseInvoices, (await trialBalanceArCents(ID.acc)) - caseTrialBalanceAr);
  await booksAgree(ID.cash, 'CASH', caseInvoices);
});

describe('fixture sanity (real rows)', () => {
  it('an ACCRUAL and a CASH TTD business with an owner, a contact each and the AR account; a business B with its own member', async () => {
    const rows = await db.business.findMany({ where: { id: { in: [ID.acc, ID.cash] } }, select: { id: true, accountingBasis: true, currency: true } });
    expect(rows.map((b: any) => [b.id, b.accountingBasis, b.currency]).sort()).toEqual([
      [ID.acc, 'ACCRUAL', 'TTD'],
      [ID.cash, 'CASH', 'TTD'],
    ]);
    expect(await coa.getBySystemKey(ID.acc, 'ACCOUNTS_RECEIVABLE')).toBeTruthy();
    expect(await db.membership.count({ where: { userId: ID.other, businessId: { in: [ID.acc, ID.cash] } } })).toBe(0);
    expect(await db.financialTransaction.count({ where: { businessId: { in: [ID.acc, ID.cash] } } })).toBe(0);
  });
});

describe('V1-82 D-66: an issued invoice is not deleted; it is voided first (real rows)', () => {
  it('DL-01 RED-BEFORE: ACCRUAL invoice of 100 sent (AR 100), DELETE -> 409 naming SENT and "void it first"; nothing written, still listed and owed; void then DELETE -> 200', async () => {
    const id = await sent(ID.acc, 'DL-01');
    expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 10_000, income: 10_000, cash: 0, finalized: 'POSTED' });
    const tbBefore = await trialBalanceArCents(ID.acc);
    const before = await books(ID.acc);

    emitted.length = 0;
    const res = await del(ID.acc, id);
    await expectDeleteRefused(res, VOID_FIRST('SENT'), ID.acc, id, before);

    expect.soft((await ledgerOf(ID.acc, id)).finalized, 'the recognition stays POSTED').toBe('POSTED');
    expect.soft(await trialBalanceArCents(ID.acc), 'trial-balance AR unchanged').toBe(tbBefore);
    const list = await as(agent().get(`/commerce/businesses/${ID.acc}/invoices`).query({ pageSize: 100 }));
    expect(list.status).toBe(200);
    expect.soft(list.body.data.map((i: any) => i.id), 'listInvoices still shows the invoice').toContain(id);
    const customer = await receivables.getCustomerBalance(ID.acc, ID.contactAcc);
    const row = customer.invoices.find((i: any) => i.id === id);
    expect.soft(row?.outstanding, 'the receivables read still owes it').toBe(100);

    // The remedy: void (reverses the recognition), then delete.
    if (!(await invoiceRow(id)).deletedAt) {
      await moveTo(ID.acc, id, 'VOID');
      expect((await ledgerOf(ID.acc, id)).finalized).toBe('REVERSED');
      const ok = await del(ID.acc, id);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await invoiceRow(id)).deletedAt).not.toBeNull();
      expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
    }
  }, 60_000);

  it('DL-02 RED-BEFORE: ACCRUAL sent, paid 40 (PARTIALLY_PAID), PATCH status/overdue, DELETE -> 409 naming OVERDUE, the 40 received and "refund ... first"; AR 60 / income 100 / cash 40 kept', async () => {
    const id = await overduePartPaid(ID.acc, 'DL-02');
    expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 6_000, income: 10_000, cash: 4_000, finalized: 'POSTED' });
    const before = await books(ID.acc);

    emitted.length = 0;
    const res = await del(ID.acc, id);
    await expectDeleteRefused(res, REFUND_FIRST('OVERDUE', '40.00'), ID.acc, id, before);
    expect.soft((await invoiceRow(id)).status).toBe('OVERDUE');
    expect.soft(await ledgerOf(ID.acc, id)).toEqual({ ar: 6_000, income: 10_000, cash: 4_000, finalized: 'POSTED' });
    expect.soft(await netReceivedCents(id)).toBe(4_000);
  }, 60_000);

  it('DL-03 RED-BEFORE: CASH sent, paid 40, PATCH payment-failed (FAILED), DELETE -> 409 naming FAILED and "refund ... first"; income 40 / cash 40 stay on a live invoice', async () => {
    const id = await sent(ID.cash, 'DL-03');
    await pay(ID.cash, id, 40);
    await paymentFailed(ID.cash, id);
    expect(await ledgerOf(ID.cash, id)).toEqual({ ar: 0, income: 4_000, cash: 4_000, finalized: null });
    const before = await books(ID.cash);

    emitted.length = 0;
    const res = await del(ID.cash, id);
    await expectDeleteRefused(res, REFUND_FIRST('FAILED', '40.00'), ID.cash, id, before);
    expect.soft((await invoiceRow(id)).status).toBe('FAILED');
    expect.soft(await netReceivedCents(id)).toBe(4_000);
  }, 60_000);
});

describe('V1-82 D-66: bulk delete deletes only DRAFT and VOID invoices (route and KEY shape, real rows)', () => {
  async function fourRows(label: string) {
    return {
      draft: await draft(ID.acc, `${label} draft`),
      void: await voided(ID.acc, `${label} void`),
      sent: await sent(ID.acc, `${label} sent`),
      overdue: await overduePartPaid(ID.acc, `${label} overdue`),
    };
  }
  function expectBulkResult(body: any, rows: Awaited<ReturnType<typeof fourRows>>) {
    expect.soft(body.updated, JSON.stringify(body)).toBe(2);
    const skipped = new Map<string, any>((body.skipped ?? []).map((s: any) => [s.id, s]));
    expect.soft([...skipped.keys()].sort(), 'the SENT and OVERDUE rows are reported skipped').toEqual([rows.sent, rows.overdue].sort());
    expect.soft(skipped.get(rows.sent)?.invoiceStatus).toBe('SENT');
    expect.soft(String(skipped.get(rows.sent)?.reason ?? '')).toMatch(VOID_FIRST('SENT'));
    expect.soft(skipped.get(rows.overdue)?.invoiceStatus).toBe('OVERDUE');
    expect.soft(String(skipped.get(rows.overdue)?.reason ?? '')).toMatch(REFUND_FIRST('OVERDUE', '40.00'));
    expect.soft(body.skippedCount).toBe(2);
  }
  async function expectOnlyDraftAndVoidDeleted(rows: Awaited<ReturnType<typeof fourRows>>) {
    expect.soft((await invoiceRow(rows.draft)).deletedAt, 'the DRAFT is deleted').not.toBeNull();
    expect.soft((await invoiceRow(rows.void)).deletedAt, 'the VOID is deleted').not.toBeNull();
    expect.soft((await invoiceRow(rows.sent)).deletedAt, 'the SENT with AR stays').toBeNull();
    expect.soft((await invoiceRow(rows.overdue)).deletedAt, 'the OVERDUE part-paid stays').toBeNull();
    expect.soft(await ledgerOf(ID.acc, rows.sent)).toEqual({ ar: 10_000, income: 10_000, cash: 0, finalized: 'POSTED' });
    expect.soft(await ledgerOf(ID.acc, rows.overdue)).toEqual({ ar: 6_000, income: 10_000, cash: 4_000, finalized: 'POSTED' });
  }

  it('DL-04a RED-BEFORE: PATCH invoices/bulk {action:"delete", ids:[DRAFT, VOID, SENT with AR, OVERDUE part-paid]} -> updated 2, the issued rows skipped with the reason', async () => {
    const rows = await fourRows('DL-04a');
    const paymentsBefore = (await books(ID.acc)).payments;
    const res = await bulkDelete(ID.acc, [rows.draft, rows.void, rows.sent, rows.overdue]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectBulkResult(res.body, rows);
    await expectOnlyDraftAndVoidDeleted(rows);
    expect.soft((await books(ID.acc)).payments, 'no Payment row written or changed').toEqual(paymentsBefore);
  }, 90_000);

  it('DL-04b RED-BEFORE: CommerceService.bulkUpdateInvoices(businessId, ids, "delete") (the KEY shape) -> the same result', async () => {
    const rows = await fourRows('DL-04b');
    const result = await commerce.bulkUpdateInvoices(ID.acc, [rows.draft, rows.void, rows.sent, rows.overdue], 'delete');
    expectBulkResult(result, rows);
    await expectOnlyDraftAndVoidDeleted(rows);
  }, 90_000);
});

describe('V1-82 D-66 controls: DRAFT and VOID stay deletable; paid guards and the tenant boundary as before (real rows)', () => {
  it('DL-05a: a DRAFT DELETE -> 200, deletedAt set, invoice.deleted emitted, nothing posted', async () => {
    const id = await draft(ID.acc, 'DL-05a');
    emitted.length = 0;
    const res = await del(ID.acc, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await invoiceRow(id)).deletedAt).not.toBeNull();
    expect(emitted.filter((e) => e.name === 'invoice.deleted').map((e) => e.payload)).toEqual([{ businessId: ID.acc, invoiceId: id }]);
    expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: null });
  }, 60_000);

  it('DL-05b: a VOID invoice (sent, unpaid, recognition reversed) DELETE -> 200; its AR and income are 0', async () => {
    const id = await voided(ID.acc, 'DL-05b');
    expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
    const res = await del(ID.acc, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await invoiceRow(id)).deletedAt).not.toBeNull();
  }, 60_000);

  it('DL-05c: PAID and PARTIALLY_PAID still 409 "Cannot delete a paid or partially paid invoice", nothing written', async () => {
    const paid = await sent(ID.acc, 'DL-05c paid');
    await markPaid(ID.acc, paid);
    const part = await sent(ID.acc, 'DL-05c part');
    await pay(ID.acc, part, 40);
    expect((await invoiceRow(part)).status).toBe('PARTIALLY_PAID');
    for (const id of [paid, part]) {
      const before = await books(ID.acc);
      emitted.length = 0;
      const res = await del(ID.acc, id);
      await expectDeleteRefused(res, PAID_REFUSED, ID.acc, id, before);
    }
  }, 60_000);

  it('DL-05d: a member of business B deleting A\'s invoice -> 403 on A\'s route, 404 on B\'s route; the invoice untouched', async () => {
    const id = await draft(ID.acc, 'DL-05d');
    const onA = await del(ID.acc, id, ID.other);
    expect(onA.status, JSON.stringify(onA.body)).toBe(403);
    const onB = await del(ID.otherBiz, id, ID.other);
    expect(onB.status, JSON.stringify(onB.body)).toBe(404);
    const bulkOnB = await as(agent().patch(`/commerce/businesses/${ID.otherBiz}/invoices/bulk`), ID.other).send({ action: 'delete', ids: [id] });
    expect(bulkOnB.status, JSON.stringify(bulkOnB.body)).toBe(200);
    expect(bulkOnB.body.updated).toBe(0);
    expect((await invoiceRow(id)).deletedAt).toBeNull();
  }, 60_000);
});

describe('V1-82 D-66: an issued invoice returned to DRAFT by the AI undo is still issued (real rows)', () => {
  it('DL-06 RED-BEFORE: ACCRUAL SENT 100 undone to DRAFT (recognition kept, AR 100): DELETE and bulk delete refused "void it first"; void then DELETE -> 200 with AR 0', async () => {
    const id = await sent(ID.acc, 'DL-06');
    const undone = await commerce.undoInvoice(id, ID.acc);
    expect(undone.status).toBe('reverted_to_draft');
    expect((await invoiceRow(id)).status).toBe('DRAFT');
    expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 10_000, income: 10_000, cash: 0, finalized: 'POSTED' });
    const before = await books(ID.acc);

    emitted.length = 0;
    const res = await del(ID.acc, id);
    await expectDeleteRefused(res, RETURNED_VOID_FIRST, ID.acc, id, before);

    const bulk = await bulkDelete(ID.acc, [id]);
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    expect.soft(bulk.body.updated).toBe(0);
    expect.soft(String(bulk.body.skipped?.[0]?.reason ?? '')).toMatch(RETURNED_VOID_FIRST);
    expect.soft((await invoiceRow(id)).deletedAt).toBeNull();

    if (!(await invoiceRow(id)).deletedAt) {
      await moveTo(ID.acc, id, 'VOID');
      const ok = await del(ID.acc, id);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await ledgerOf(ID.acc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
    }
  }, 60_000);
});

describe('V1-82 D-66: the books of both businesses agree over every invoice, deleted ones included (real rows)', () => {
  it('DL-07 RED-BEFORE: no deleted invoice of either business carries AR, income, cash or money received; every live ACCRUAL invoice\'s AR equals its remaining; the trial-balance AR is the live invoices\' AR', async () => {
    await booksAgree(ID.acc, 'ACCRUAL (all invoices)', 'all', await trialBalanceArCents(ID.acc));
    await booksAgree(ID.cash, 'CASH (all invoices)', 'all');
  }, 120_000);
});
