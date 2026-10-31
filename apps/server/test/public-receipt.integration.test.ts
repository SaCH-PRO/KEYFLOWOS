/**
 * V1-49-PUBLIC-RECEIPT — the customer's receipt by pay-link token (REAL database).
 *
 * M24 (P0, for P0-5 "customer-facing link, receipt"; D-07 ruled the link and
 * the receipt into Release 0, token links only). At the V1-48 head:
 *
 *   - there is no anonymous receipt route for a token: the only receipt route
 *     is GET /commerce/invoices/:invoiceId/receipt behind AuthGuard,
 *     BusinessGuard and revenue:read (RA-G7-05), so a customer holding the
 *     pay link gets 401 and GET .../invoice-link/:token/receipt is a 404;
 *   - the invoice.paid listener claims full settlement whatever the rows say
 *     (pinned in src/modules/commerce/invoice-receipt.listener.spec.ts).
 *
 * Contract pinned here (GET /commerce/public/invoice-link/:token/receipt):
 *
 *   guards                    -> PublicRateLimitGuard only, @PublicRateLimit(30, 60_000); the
 *                                token is the credential (public-surface ledger +1, stand-in
 *                                "token plus rate limit")
 *   PAID                      -> 200, exactly the receipt projection keys: amountPaid, amountDue
 *                                (computeBalance paid / remaining over the invoice's own-tenant
 *                                Payment rows), paidAt, and the printed invoice facts; no payment
 *                                rows, references or notes, no customer email (canary)
 *   PARTIALLY_PAID 40 of 100  -> 200, amountPaid 40, amountDue 60, paidAt null (D-07: "the
 *                                receipt", paid and remaining shown as on the link)
 *   SENT / OVERDUE, unpaid    -> 409, no figures
 *   unknown / expired / inactive / foreign-tenant link, or a DRAFT, VOID or deleted invoice
 *                             -> 404, the same body as an unknown token
 *   LEDGER (no refund row)    -> amountPaid = sum(SUCCESSFUL) = computeBalance.paid = the ledger
 *                                cash net of the invoice's payment postings
 *   LEDGER (refund row)       -> characterization naming V1-29 (M28: computeBalance subtracts a
 *                                flipped REFUNDED row twice; the ledger reverses it once)
 *   read-only                 -> no FinancialTransaction, LedgerEntry, Payment or PaymentLink
 *                                write; the invoice row is unchanged
 *   TENANT (M31)              -> a Payment row tagged with another tenant is not counted; another
 *                                tenant's token never returns this invoice's figures
 *   authenticated route       -> unchanged: 401 without identity, the operator shape for the owner
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * InvoiceReceiptBuilderService and the real ledger chain write and read real
 * rows; the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Payments, the refund and links are made through the real operator
 * routes. Identity attachment (operator routes only) is a test middleware
 * reading `x-v49a-user`; every receipt read is anonymous. Collaborators off the
 * boundary (contact timeline, stats cache, Gmail / AI / Drive) are stubs.
 *
 * Fixtures: prefix `v49a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { computeBalance } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v49a_';
const HEADER = 'x-v49a-user';

/** Every fixture string that must never reach the public receipt carries this. */
const CANARY = 'V49A_SECRET_';

// This suite's public rate-limit keys live under its own namespace, so the
// resets below never touch another suite's windows on the same Redis index.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // tenant A: one invoice per case, so balances and links never bleed between cases
  invPaid: `${P}invPaid`,
  invPartial: `${P}invPartial`,
  invSent: `${P}invSent`,
  invOverdue: `${P}invOverdue`,
  invDraft: `${P}invDraft`,
  invVoid: `${P}invVoid`,
  invDeleted: `${P}invDeleted`,
  invLedger: `${P}invLedger`,
  invRefund: `${P}invRefund`,
  invTenantA: `${P}invTenantA`,
  // tenant B
  invB: `${P}invB`,
};

/** Seeded PaymentLink rows (every other link is minted by the real route). */
const LINK = {
  expired: { id: `${P}link_expired`, token: `${P}tok_expired` },
  inactive: { id: `${P}link_inactive`, token: `${P}tok_inactive` },
  // A link row of tenant B pointing at tenant A's PAID invoice (M31: no FK ties the two).
  foreign: { id: `${P}link_foreign`, token: `${P}tok_foreign` },
  draft: { id: `${P}link_draft`, token: `${P}tok_draft` },
  void: { id: `${P}link_void`, token: `${P}tok_void` },
  deleted: { id: `${P}link_deleted`, token: `${P}tok_deleted` },
};
const UNKNOWN_TOKEN = `${P}tok_nosuchlink`;

const TOTAL = 100;
const DAY_MS = 86_400_000;

/** The public receipt projection: these keys and no others. */
const RECEIPT_KEYS = ['amountDue', 'amountPaid', 'business', 'contact', 'currency', 'invoiceNumber', 'issuedAt', 'items', 'paidAt', 'status', 'total'];
/** The authenticated receipt's keys at the base (InvoiceReceiptBuilderService.buildReceipt), unchanged. */
const AUTH_RECEIPT_KEYS = ['business', 'contact', 'currency', 'invoiceNumber', 'issuedAt', 'items', 'paidAt', 'status', 'total'];

let db: any;
let app: any;
let redis: any;
let CommerceControllerRef: any;
let PublicRateLimitGuardRef: any;
let PUBLIC_RATE_LIMIT_KEY_REF: string;

/** Route-minted links: invoice -> token. */
const TOKEN: Record<string, string> = {};
let unknownRes: { status: number; body: any };

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

/** The customer's receipt read: anonymous, by the pay-link token alone. */
function receipt(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/receipt`);
}

function ownerOf(biz: string) {
  return biz === ID.bizB ? ID.ownerB : ID.ownerA;
}

function bizOf(invoiceId: string) {
  return invoiceId === ID.invB ? ID.bizB : ID.bizA;
}

/** An operator payment through the real route (a real posting). Returns the Payment id. */
async function pay(invoiceId: string, amount: number, method: string, slip: string): Promise<string> {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)
    .set(HEADER, ownerOf(biz))
    .send({ amount, method, reference: `${CANARY}${P}${slip}`, notes: `${CANARY}note_${slip}` });
  if (res.status !== 201) throw new Error(`operator payment on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body?.payment?.id;
  if (!id) throw new Error(`operator payment on ${invoiceId} returned no payment id: ${JSON.stringify(res.body)}`);
  return id;
}

async function mintLink(invoiceId: string): Promise<string> {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payment-link`)
    .set(HEADER, ownerOf(biz))
    .send({});
  if (res.status !== 201 || !res.body?.token) throw new Error(`link on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  TOKEN[invoiceId] = res.body.token;
  return res.body.token;
}

async function balanceOf(invoiceId: string) {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId },
    select: { total: true, currency: true, businessId: true, payments: { select: { amount: true, status: true, businessId: true } } },
  });
  // The invoice's own tenant only (M31): the Payment table carries no FK to Business.
  return computeBalance(Number(inv.total), inv.payments.filter((p: any) => p.businessId === inv.businessId), inv.currency);
}

async function successfulSum(invoiceId: string, businessId: string): Promise<number> {
  const rows = await db.payment.findMany({ where: { invoiceId, businessId, status: 'SUCCESSFUL' }, select: { amount: true } });
  return rows.reduce((s: number, r: any) => s + Number(r.amount), 0);
}

/**
 * The ledger's cash net for an invoice: debit minus credit on the deposit
 * accounts (CASH, BANK, PAYMENT_PROCESSOR) of every posting sourced by one of
 * the invoice's Payment rows (the payment posting and any refund reversal).
 */
async function ledgerCashNet(invoiceId: string, businessId: string): Promise<number> {
  const payments = await db.payment.findMany({ where: { invoiceId, businessId }, select: { id: true } });
  const txns = await db.financialTransaction.findMany({
    where: { businessId, sourceType: 'Payment', sourceId: { in: payments.map((p: any) => p.id) } },
    include: { entries: { include: { account: true } } },
  });
  let net = 0;
  for (const t of txns) {
    for (const e of t.entries) {
      if (['CASH', 'BANK', 'PAYMENT_PROCESSOR'].includes(e.account.systemKey)) net += Number(e.debit) - Number(e.credit);
    }
  }
  return Math.round(net * 100) / 100;
}

async function ledgerCounts(businessId: string) {
  return {
    transactions: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

async function invoiceRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, total, paid_at AS "paidAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

/** The error body without the per-request fields, so two 404s can be compared. */
function neutral(body: any) {
  const { path: _path, timestamp: _timestamp, correlationId: _correlationId, ...rest } = body ?? {};
  return rest;
}

/** The answer an unknown token gets: same status and same body (less the per-request fields). */
function expectUnknownAnswer(res: { status: number; body: any }, label: string) {
  expect(res.status, label).toBe(404);
  expect(neutral(res.body), label).toEqual(neutral(unknownRes.body));
  expect(res.body, label).not.toHaveProperty('amountPaid');
  expect(res.body, label).not.toHaveProperty('invoiceNumber');
}

function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {})).not.toContain(CANARY);
}

/**
 * No payment row, reference, note, bank detail or customer email anywhere in
 * the receipt, at any depth. The business's own public contact email (the
 * profile the link view already serves) is the one email allowed.
 */
function expectNoPaymentRowsOrEmail(body: unknown) {
  const forbidden = ['payments', 'reference', 'providerPaymentId', 'evidenceUrl', 'recordedBy', 'notes', 'metaData'];
  const walk = (node: unknown, at: string) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      expect(forbidden, `${at}.${k}`).not.toContain(k);
      if (at !== '$.business') expect(k, `${at}.${k}`).not.toBe('email');
      walk(v, `${at}.${k}`);
    }
  };
  walk(body, '$');
  expectNoCanary(body);
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
  const rateLimitMod = await import('../src/core/guards/public-rate-limit.guard');
  const { PublicRateLimitGuard, PUBLIC_RATE_LIMIT_KEY } = rateLimitMod;
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
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
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  CommerceControllerRef = CommerceController;
  PublicRateLimitGuardRef = PublicRateLimitGuard;
  PUBLIC_RATE_LIMIT_KEY_REF = PUBLIC_RATE_LIMIT_KEY;

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
      // Real ledger chain: the operator payments and the refund post real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: EventEmitter2,
        useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined, off: () => undefined, once: () => undefined, removeListener: () => undefined },
      },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: { sendEmail: async () => ({ messageId: `${P}msg` }) } },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only (the operator routes). No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  // ---- two tenants, each with an owner, a contact and a system chart of accounts.
  // Business A carries bank details under metaData (no public route serves
  // them) and its contact a canary email: neither may reach the receipt.
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'V49A Biz A', ownerId: ID.ownerA, currency: 'TTD', email: `${P}billing@test.local`, metaData: { bankAccountNumber: `${CANARY}acct` } },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V49A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V49a', lastName: 'Customer', email: `${P}${CANARY}customer@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V49a', lastName: 'CustomerB', email: `${P}customerB@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);

  // ---- invoices: 100 each; SENT unless the case needs another start state ----
  const startStatus: Record<string, string> = {
    [ID.invOverdue]: 'OVERDUE',
    [ID.invDraft]: 'DRAFT',
    [ID.invVoid]: 'VOID',
  };
  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const biz = bizOf(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V49A-${String(n).padStart(3, '0')}`,
        status: startStatus[id] ?? 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        notes: 'Thank you for your business',
        businessId: biz,
        contactId: biz === ID.bizB ? ID.contactB : ID.contactA,
        items: { create: [{ id: `${id}_item1`, description: `V49A item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }

  // ---- links minted by the real route while the invoices are payable ------
  for (const inv of [ID.invPaid, ID.invPartial, ID.invSent, ID.invOverdue, ID.invDeleted, ID.invLedger, ID.invRefund, ID.invTenantA, ID.invB]) {
    await mintLink(inv);
  }

  // ---- operator payments and one refund through the real routes ------------
  await pay(ID.invPaid, 60, 'cash', 'slip_paid_1');
  await pay(ID.invPaid, 40, 'bank_transfer', 'slip_paid_2');
  await pay(ID.invPartial, 40, 'cash', 'slip_partial');
  await pay(ID.invDeleted, 100, 'cash', 'slip_deleted');
  await pay(ID.invLedger, 70, 'cash', 'slip_ledger_1');
  await pay(ID.invLedger, 30, 'bank_transfer', 'slip_ledger_2');
  await pay(ID.invRefund, 50, 'cash', 'slip_refund_1');
  const refunded = await pay(ID.invRefund, 30, 'cash', 'slip_refund_2');
  const refund = await agent()
    .post(`/commerce/businesses/${ID.bizA}/payments/${refunded}/refund`)
    .set(HEADER, ID.ownerA)
    .send({ reason: 'customer returned goods' });
  if (refund.status !== 201) throw new Error(`refund failed: ${refund.status} ${JSON.stringify(refund.body)}`);
  await pay(ID.invTenantA, 50, 'cash', 'slip_tenant_a');
  await pay(ID.invB, 100, 'cash', 'slip_b');

  // ---- seeded rows the routes cannot make -----------------------------------
  await db.paymentLink.create({ data: { id: LINK.expired.id, token: LINK.expired.token, invoiceId: ID.invPaid, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() - DAY_MS) } });
  await db.paymentLink.create({ data: { id: LINK.inactive.id, token: LINK.inactive.token, invoiceId: ID.invPaid, businessId: ID.bizA, active: false } });
  await db.paymentLink.create({ data: { id: LINK.foreign.id, token: LINK.foreign.token, invoiceId: ID.invPaid, businessId: ID.bizB, active: true } });
  await db.paymentLink.create({ data: { id: LINK.draft.id, token: LINK.draft.token, invoiceId: ID.invDraft, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.void.id, token: LINK.void.token, invoiceId: ID.invVoid, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.deleted.id, token: LINK.deleted.token, invoiceId: ID.invDeleted, businessId: ID.bizA, active: true } });
  // invDeleted was paid in full through the route, then soft-deleted.
  await db.$executeRawUnsafe(`UPDATE invoices SET deleted_at = NOW() WHERE id = $1`, ID.invDeleted);
  // A SUCCESSFUL Payment row tagged with tenant B on tenant A's invoice (M31: no FK, no tenant extension).
  await db.payment.create({
    data: {
      id: `${P}pay_foreign`, businessId: ID.bizB, invoiceId: ID.invTenantA, amount: 30, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'cash', method: 'cash', providerPaymentId: `${P}pp_foreign`, reference: `${CANARY}foreign`, notes: `${CANARY}foreign_note`,
    },
  });

  await clearRateLimits();
  const u = await receipt(UNKNOWN_TOKEN);
  unknownRes = { status: u.status, body: u.body };
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

beforeEach(async () => {
  await clearRateLimits();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows)', () => {
  it('the operator routes produced the seeded states: PAID 100/100 with paidAt, PARTIALLY_PAID 40/100, SENT and OVERDUE unpaid, a refunded row and real postings', async () => {
    const paid = await invoiceRow(ID.invPaid);
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).toBeTruthy();
    expect((await invoiceRow(ID.invPartial)).status).toBe('PARTIALLY_PAID');
    expect((await invoiceRow(ID.invSent)).status).toBe('SENT');
    expect((await invoiceRow(ID.invOverdue)).status).toBe('OVERDUE');
    expect((await invoiceRow(ID.invLedger)).status).toBe('PAID');
    const del = await invoiceRow(ID.invDeleted);
    expect(del.status).toBe('PAID');
    expect(del.deletedAt).toBeTruthy();
    const refundRows = await db.payment.findMany({ where: { invoiceId: ID.invRefund }, orderBy: { createdAt: 'asc' } });
    expect(refundRows.map((r: any) => [Number(r.amount), r.status])).toEqual([[50, 'SUCCESSFUL'], [30, 'REFUNDED']]);
    expect((await ledgerCounts(ID.bizA)).transactions).toBeGreaterThanOrEqual(8);
    expect(Object.keys(TOKEN)).toHaveLength(9);
  });
});

describe('M24: the customer gets a receipt by the pay-link token (V1-49)', () => {
  it('R-01: PAID 100 of 100 answers 200 with exactly the receipt projection: amountPaid 100, amountDue 0, the invoice paidAt', async () => {
    const row = await invoiceRow(ID.invPaid);
    const res = await receipt(TOKEN[ID.invPaid]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...RECEIPT_KEYS].sort());
    expect(res.body).toMatchObject({
      invoiceNumber: expect.stringMatching(/^V49A-/),
      status: 'PAID',
      currency: 'TTD',
      total: TOTAL,
      amountPaid: 100,
      amountDue: 0,
      paidAt: new Date(row.paidAt).toISOString(),
    });
    expect(res.body.contact).toEqual({ firstName: 'V49a', lastName: 'Customer' });
    expect(res.body.business.name).toBe('V49A Biz A');
    expect(res.body.items).toEqual([{ description: expect.stringMatching(/^V49A item /), quantity: 1, unitPrice: TOTAL, total: TOTAL }]);
  });

  it('R-02 canary: no payment rows, references or notes, no customer email and no bank details anywhere in the receipt', async () => {
    const res = await receipt(TOKEN[ID.invPaid]);
    expect(res.status).toBe(200);
    expectNoPaymentRowsOrEmail(res.body);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('note_slip_paid');
    expect(text).not.toContain('slip_paid');
    expect(text).not.toContain('customer@test.local');
    expect(text).not.toContain('bankAccountNumber');
  });

  it('R-03: PARTIALLY_PAID 40 of 100 answers 200 with amountPaid 40, amountDue 60 and no paidAt (never "remaining 0")', async () => {
    const res = await receipt(TOKEN[ID.invPartial]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...RECEIPT_KEYS].sort());
    expect(res.body).toMatchObject({ status: 'PARTIALLY_PAID', total: TOTAL, amountPaid: 40, amountDue: 60, paidAt: null });
    expectNoPaymentRowsOrEmail(res.body);
  });

  it('R-04: a SENT invoice with nothing paid answers 409 and no figures; so does an OVERDUE one', async () => {
    for (const inv of [ID.invSent, ID.invOverdue]) {
      const res = await receipt(TOKEN[inv]);
      expect(res.status, inv).toBe(409);
      expect(res.body, inv).not.toHaveProperty('amountPaid');
      expect(res.body, inv).not.toHaveProperty('invoiceNumber');
      expectNoCanary(res.body);
    }
  });
});

describe('neutral answers: dead, foreign and unshareable links read as unknown (V1-49)', () => {
  it('R-05: an unknown token is a 404', () => {
    expect(unknownRes.status).toBe(404);
    expect(unknownRes.body).not.toHaveProperty('amountPaid');
  });

  it('R-06: an expired link and an inactive link on the PAID invoice answer exactly the unknown-token 404', async () => {
    for (const token of [LINK.expired.token, LINK.inactive.token]) {
      expectUnknownAnswer(await receipt(token), token);
    }
  });

  it("R-07 TENANT (M31): a PaymentLink row carrying tenant B's businessId on tenant A's PAID invoice answers the unknown-token 404", async () => {
    const res = await receipt(LINK.foreign.token);
    expectUnknownAnswer(res, 'foreign link');
    expect(JSON.stringify(res.body)).not.toContain(ID.invPaid);
  });

  it('R-08: an active link to a DRAFT, VOID or soft-deleted invoice answers the unknown-token 404', async () => {
    for (const token of [LINK.draft.token, LINK.void.token, LINK.deleted.token]) {
      expectUnknownAnswer(await receipt(token), token);
    }
  });
});

describe('LEDGER and TENANT (V1-49)', () => {
  it('R-09 LEDGER (no refund row): receipt amountPaid = sum(SUCCESSFUL) = computeBalance.paid = the ledger cash net; amountDue = computeBalance.remaining', async () => {
    const res = await receipt(TOKEN[ID.invLedger]);
    expect(res.status).toBe(200);
    const balance = await balanceOf(ID.invLedger);
    expect(balance.refunded).toBe(0);
    expect(res.body.amountPaid).toBe(balance.paid);
    expect(res.body.amountPaid).toBe(await successfulSum(ID.invLedger, ID.bizA));
    expect(res.body.amountPaid).toBe(await ledgerCashNet(ID.invLedger, ID.bizA));
    expect(res.body.amountDue).toBe(balance.remaining);
    expect(res.body).toMatchObject({ status: 'PAID', amountPaid: 100, amountDue: 0 });
  });

  it('R-10 LEDGER (refund row, characterization naming V1-29): the receipt equals computeBalance, which drops the flipped REFUNDED row from paid AND subtracts it again (M28)', async () => {
    const res = await receipt(TOKEN[ID.invRefund]);
    expect(res.status).toBe(200);
    const balance = await balanceOf(ID.invRefund);
    expect(res.body.amountPaid).toBe(balance.paid);
    expect(res.body.amountDue).toBe(balance.remaining);
    // 50 + 30 received, 30 refunded through the operator route: the ledger nets 50.
    const cashNet = await ledgerCashNet(ID.invRefund, ID.bizA);
    expect(cashNet).toBe(50);
    // computeBalance: paid 50 (the REFUNDED row is no longer SUCCESSFUL), refunded 30, net 20.
    expect(balance).toMatchObject({ paid: 50, refunded: 30, net: 20, remaining: 80 });
    // V1-29: the true remaining is 100 - 50 = 50; the receipt shows 80 until V1-29 settles the convention.
    expect(res.body).toMatchObject({ status: 'PARTIALLY_PAID', amountPaid: 50, amountDue: 80, paidAt: null });
    expect(res.body.amountDue).not.toBe(TOTAL - cashNet);
  });

  it('R-11 read-only: reading a receipt three times writes no FinancialTransaction, LedgerEntry, Payment or PaymentLink and leaves the invoice row as it was', async () => {
    const countsA = await ledgerCounts(ID.bizA);
    const countsB = await ledgerCounts(ID.bizB);
    const paymentsBefore = await db.payment.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });
    const linksBefore = await db.paymentLink.findMany({ where: { invoiceId: ID.invPaid }, orderBy: { id: 'asc' } });
    const rowBefore = await invoiceRow(ID.invPaid);
    for (let i = 0; i < 3; i++) expect((await receipt(TOKEN[ID.invPaid])).status).toBe(200);
    expect(await ledgerCounts(ID.bizA)).toEqual(countsA);
    expect(await ledgerCounts(ID.bizB)).toEqual(countsB);
    expect(await db.payment.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(paymentsBefore);
    expect(await db.paymentLink.findMany({ where: { invoiceId: ID.invPaid }, orderBy: { id: 'asc' } })).toEqual(linksBefore);
    expect(await invoiceRow(ID.invPaid)).toEqual(rowBefore);
  });

  it("R-12 TENANT (M31): a SUCCESSFUL Payment row tagged with tenant B on tenant A's invoice is not counted: A's receipt shows 50 paid, 50 due", async () => {
    const res = await receipt(TOKEN[ID.invTenantA]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'PARTIALLY_PAID', amountPaid: 50, amountDue: 50 });
    expectNoCanary(res.body);
  });

  it("R-13 TENANT: tenant B's own token returns B's receipt (100 paid) and nothing of A's invoices or payments", async () => {
    const res = await receipt(TOKEN[ID.invB]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'PAID', amountPaid: 100, amountDue: 0 });
    expect(res.body.business.name).toBe('V49A Biz B');
    const text = JSON.stringify(res.body);
    for (const inv of [ID.invPaid, ID.invPartial, ID.invTenantA, ID.invLedger]) expect(text).not.toContain(inv);
    expect(text).not.toContain('V49A Biz A');
    expectNoCanary(res.body);
  });
});

describe('the route and the authenticated receipt (V1-49)', () => {
  it('R-14: the handler is GET public/invoice-link/:token/receipt behind PublicRateLimitGuard alone with @PublicRateLimit(30, 60000); the 31st read in the window is 429', async () => {
    const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = await import('@nestjs/common/constants');
    const { RequestMethod } = await import('@nestjs/common');
    const handler = CommerceControllerRef.prototype.getPublicReceiptByToken;
    expect(typeof handler, 'receipt handler').toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('public/invoice-link/:token/receipt');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_REF, handler)).toEqual({ limit: 30, windowMs: 60_000 });
    expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).toEqual([PublicRateLimitGuardRef]);

    for (let i = 1; i <= 30; i += 1) {
      const res = await receipt(TOKEN[ID.invPaid]);
      expect(res.status, `request ${i}`).toBe(200);
    }
    expect((await receipt(TOKEN[ID.invPaid])).status).toBe(429);
  });

  it('R-15: the authenticated receipt route is unchanged: 401 without identity, the operator shape (with the customer email) for the owner', async () => {
    const anon = await agent().get(`/commerce/invoices/${ID.invPaid}/receipt?businessId=${ID.bizA}`);
    expect(anon.status).toBe(401);
    const owner = await agent().get(`/commerce/invoices/${ID.invPaid}/receipt?businessId=${ID.bizA}`).set(HEADER, ID.ownerA);
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(Object.keys(owner.body).sort()).toEqual([...AUTH_RECEIPT_KEYS].sort());
    expect(owner.body.contact.email).toBe(`${P}${CANARY}customer@test.local`);
    // The other tenant's owner still cannot read A's receipt through it.
    const foreign = await agent().get(`/commerce/invoices/${ID.invPaid}/receipt?businessId=${ID.bizB}`).set(HEADER, ID.ownerB);
    expect(foreign.status).toBe(404);
  });
});
