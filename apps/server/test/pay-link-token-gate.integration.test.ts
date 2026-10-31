/**
 * V1-46-PUB-PAY-LINK-TOKEN-GATE — the customer pay surface is keyed by the
 * pay-link token (REAL database).
 *
 * M34 (P1). D-07, ruled 2026-10-31 by the owner: token links only, the
 * bare-id pay page is retired. At the V1-49 head:
 *
 *   - /pay/link/[token] reads GET /commerce/payment-links/:token, which hands
 *     out the invoice id, and router.replace()s to /pay/:invoiceId
 *     (pay/link/[token]/page.tsx:18-40); public/invoice/[token]'s Pay button
 *     goes through that page;
 *   - every API the /pay/:invoiceId page calls is keyed by the bare invoice
 *     id, among them POST /commerce/invoices/:invoiceId/payment-intent, so
 *     deactivating or expiring the link has no effect once the customer (or
 *     anyone holding the id) is past the first visit.
 *
 * Contract pinned here:
 *
 *   GET  /commerce/public/invoice-link/:token/pay             live link -> 200, the pay-page projection:
 *                                                             exactly what the kept bare-id public read
 *                                                             (KF-REVENUE-AUTH-PROJECTION-001) answers an
 *                                                             anonymous caller; no payment rows, bank
 *                                                             details or customer email
 *   POST /commerce/public/invoice-link/:token/payment-intent  live link -> the R0-22 intent contract
 *                                                             (one PENDING row on the invoice's own
 *                                                             tenant, status unchanged, 409 when settled)
 *   deactivated (operator route), expired, inactive, unknown or foreign-tenant link, and a DRAFT,
 *   VOID or deleted invoice behind a live link
 *                                                          -> 404 on every customer action (pay page,
 *                                                             intent, receipt), one body; the link view
 *                                                             answers its invalid_or_expired body
 *   POST /commerce/invoices/:invoiceId/payment-intent        retired -> 404, nothing written
 *   GET  /commerce/payment-links/:token                       retired -> 404 (the resolver that handed
 *                                                             out the invoice id for the downgrade)
 *   GET  /commerce/invoices/:invoiceId                        kept: the redacted projection
 *   guards                    -> PublicRateLimitGuard only on both token routes (the token is the
 *                                credential); the public-surface ledger stays at 11 (two token
 *                                routes in, two bare routes out)
 *   LEDGER                    -> no Payment row, FinancialTransaction or LedgerEntry is reachable
 *                                through a revoked token
 *   TENANT                    -> a token of tenant B never reads or writes tenant A's invoice
 *
 * Not in this write set (it.todo below): the provider checkouts (WiPay,
 * PayPal, Stripe), the gateway list and the PayPal capture are routes of
 * payments.controller.ts and stay keyed by the invoice id.
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * InvoiceReceiptBuilderService and the real ledger chain write and read real
 * rows; the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Links, payments and the deactivation are made through the real
 * operator routes. Identity attachment (operator routes only) is a test
 * middleware reading `x-v46a-user`; every customer request is anonymous.
 * Collaborators off the boundary (contact timeline, stats cache, Gmail / AI /
 * Drive) are stubs.
 *
 * Fixtures: prefix `v46a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { computeBalance } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v46a_';
const HEADER = 'x-v46a-user';

/** Every fixture string that must never reach the customer carries this. */
const CANARY = 'V46A_SECRET_';

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
  invLive: `${P}invLive`,
  invIntent: `${P}invIntent`,
  invPartial: `${P}invPartial`,
  invPaid: `${P}invPaid`,
  invRevoke: `${P}invRevoke`,
  invExpired: `${P}invExpired`,
  invInactive: `${P}invInactive`,
  invForeign: `${P}invForeign`,
  invDraft: `${P}invDraft`,
  invVoid: `${P}invVoid`,
  invDeleted: `${P}invDeleted`,
  invBare: `${P}invBare`,
  invLedger: `${P}invLedger`,
  invResolver: `${P}invResolver`,
  // tenant B
  invB: `${P}invB`,
};

/** Seeded PaymentLink rows (every other link is minted by the real route). */
const LINK = {
  expired: { id: `${P}link_expired`, token: `${P}tok_expired` },
  inactive: { id: `${P}link_inactive`, token: `${P}tok_inactive` },
  // A link row of tenant B pointing at tenant A's SENT invoice (M31: no FK ties the two).
  foreign: { id: `${P}link_foreign`, token: `${P}tok_foreign` },
  draft: { id: `${P}link_draft`, token: `${P}tok_draft` },
  void: { id: `${P}link_void`, token: `${P}tok_void` },
  deleted: { id: `${P}link_deleted`, token: `${P}tok_deleted` },
};
const UNKNOWN_TOKEN = `${P}tok_nosuchlink`;

const TOTAL = 100;
const DAY_MS = 86_400_000;

let db: any;
let app: any;
let redis: any;
let CommerceControllerRef: any;
let PublicRateLimitGuardRef: any;
let PUBLIC_RATE_LIMIT_KEY_REF: string;

/** Route-minted links: invoice -> { id, token }. */
const LINK_OF: Record<string, { id: string; token: string }> = {};

let unknownPay: { status: number; body: any };
let unknownIntent: { status: number; body: any };
let unknownReceipt: { status: number; body: any };
let unknownView: { status: number; body: any };

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

// ---- the customer's actions: anonymous, by the pay-link token alone --------

function payPage(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/pay`);
}

function intent(token: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/public/invoice-link/${encodeURIComponent(token)}/payment-intent`).send(body);
}

function receipt(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/receipt`);
}

function view(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}`);
}

/** The kept bare-id public read (KF-REVENUE-AUTH-PROJECTION-001), anonymous. */
function bareProjection(invoiceId: string) {
  return agent().get(`/commerce/invoices/${encodeURIComponent(invoiceId)}`);
}

function bizOf(invoiceId: string) {
  return invoiceId === ID.invB ? ID.bizB : ID.bizA;
}

function ownerOf(biz: string) {
  return biz === ID.bizB ? ID.ownerB : ID.ownerA;
}

/** A link minted by the operator route (AuthGuard, BusinessGuard, revenue:write). */
async function mintLink(invoiceId: string) {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payment-link`)
    .set(HEADER, ownerOf(biz))
    .send({});
  if (res.status !== 201 || !res.body?.token) throw new Error(`link on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  LINK_OF[invoiceId] = { id: res.body.id, token: res.body.token };
  return LINK_OF[invoiceId];
}

/** The operator's "deactivate link" through the real route (revenue:write). */
async function deactivate(invoiceId: string) {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .delete(`/commerce/businesses/${biz}/payment-links/${LINK_OF[invoiceId].id}`)
    .set(HEADER, ownerOf(biz));
  if (![200, 204].includes(res.status)) throw new Error(`deactivate on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
}

/** An operator payment through the real route (a real posting). */
async function pay(invoiceId: string, amount: number, slip: string) {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)
    .set(HEADER, ownerOf(biz))
    .send({ amount, method: 'cash', reference: `${CANARY}${P}${slip}`, notes: `${CANARY}note_${slip}` });
  if (res.status !== 201) throw new Error(`operator payment on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

async function invoiceRow(id: string): Promise<any> {
  // Raw read: the soft-delete extension hides the deleted fixture from findUnique.
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, total, paid_at AS "paidAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function balanceOf(invoiceId: string) {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId },
    select: { total: true, currency: true, payments: { select: { amount: true, status: true } } },
  });
  return computeBalance(Number(inv.total), inv.payments, inv.currency);
}

async function ledgerCounts(businessId: string) {
  return {
    transactions: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

/** Every invoice, payment and link row of a tenant, as plain JSON (byte-for-byte comparable). */
async function tenantSnapshot(businessId: string): Promise<string> {
  const invoices = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, total, paid_at AS "paidAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM invoices WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  const payments = await db.$queryRawUnsafe(
    `SELECT id, invoice_id AS "invoiceId", amount, status, provider, method, provider_payment_id AS "providerPaymentId"
       FROM payments WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  const links = await db.$queryRawUnsafe(
    `SELECT id, invoice_id AS "invoiceId", token, active, expires_at AS "expiresAt" FROM payment_links WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  return JSON.stringify({ invoices, payments, links });
}

/** The error body without the per-request fields, so two 404s can be compared. */
function neutral(body: any) {
  const { path: _path, timestamp: _timestamp, correlationId: _correlationId, ...rest } = body ?? {};
  return rest;
}

/** The answer an unknown token gets on the same action: same status and same body (less the per-request fields). */
function expectUnknownAnswer(res: { status: number; body: any }, unknown: { status: number; body: any }, label: string) {
  expect(res.status, label).toBe(404);
  expect(neutral(res.body), label).toEqual(neutral(unknown.body));
  expect(res.body, label).not.toHaveProperty('invoiceNumber');
  expect(res.body, label).not.toHaveProperty('remaining');
}

function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {})).not.toContain(CANARY);
}

/**
 * No payment row, reference, note, bank detail or customer email anywhere in
 * the body, at any depth. The business's own public contact email is the one
 * email allowed (the profile the link view already serves).
 */
function expectNoPaymentRowsOrEmail(body: unknown) {
  const forbidden = ['payments', 'reference', 'providerPaymentId', 'evidenceUrl', 'recordedBy', 'metaData', 'invoiceTemplate', 'quoteTemplate'];
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

/** Every customer action on one token answers as for an unknown token. */
async function expectEveryActionRefused(token: string, label: string) {
  expectUnknownAnswer(await payPage(token), unknownPay, `${label}: pay page`);
  expectUnknownAnswer(await intent(token, { method: 'bank_transfer' }), unknownIntent, `${label}: intent`);
  expectUnknownAnswer(await intent(token, { method: 'cash', amount: 10 }), unknownIntent, `${label}: intent with an amount`);
  expectUnknownAnswer(await receipt(token), unknownReceipt, `${label}: receipt`);
  const v = await view(token);
  expect(v.status, `${label}: view`).toBe(200);
  expect(v.body, `${label}: view`).toEqual(unknownView.body);
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
      // Real ledger chain: the operator payments post real rows.
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
      { provide: GmailService, useValue: {} },
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
  // them) and its contact a canary email: neither may reach the customer.
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'V46A Biz A', ownerId: ID.ownerA, currency: 'TTD', email: `${P}billing@test.local`, metaData: { bankAccountNumber: `${CANARY}acct` } },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V46A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V46a', lastName: 'Customer', email: `${P}${CANARY}customer@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V46a', lastName: 'CustomerB', email: `${P}customerB@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);

  // ---- invoices: 100 each; SENT unless the case needs another start state ----
  const startStatus: Record<string, string> = { [ID.invDraft]: 'DRAFT', [ID.invVoid]: 'VOID' };
  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const biz = bizOf(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V46A-${String(n).padStart(3, '0')}`,
        status: startStatus[id] ?? 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        notes: 'Thank you for your business',
        businessId: biz,
        contactId: biz === ID.bizB ? ID.contactB : ID.contactA,
        items: { create: [{ id: `${id}_item1`, description: `V46A item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }

  // ---- links minted by the real route while the invoices are payable ------
  for (const inv of [ID.invLive, ID.invIntent, ID.invPartial, ID.invPaid, ID.invRevoke, ID.invBare, ID.invLedger, ID.invResolver, ID.invB]) {
    await mintLink(inv);
  }

  // ---- operator payments through the real route (real postings) -------------
  await pay(ID.invPartial, 40, 'slip_partial');
  await pay(ID.invPaid, 100, 'slip_paid');
  await pay(ID.invLedger, 30, 'slip_ledger');

  // ---- the links the cases revoke, through the operator route ---------------
  await deactivate(ID.invBare);
  await deactivate(ID.invLedger);

  // ---- seeded rows the routes cannot make -----------------------------------
  await db.paymentLink.create({ data: { id: LINK.expired.id, token: LINK.expired.token, invoiceId: ID.invExpired, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() - DAY_MS) } });
  await db.paymentLink.create({ data: { id: LINK.inactive.id, token: LINK.inactive.token, invoiceId: ID.invInactive, businessId: ID.bizA, active: false } });
  await db.paymentLink.create({ data: { id: LINK.foreign.id, token: LINK.foreign.token, invoiceId: ID.invForeign, businessId: ID.bizB, active: true } });
  await db.paymentLink.create({ data: { id: LINK.draft.id, token: LINK.draft.token, invoiceId: ID.invDraft, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.void.id, token: LINK.void.token, invoiceId: ID.invVoid, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.deleted.id, token: LINK.deleted.token, invoiceId: ID.invDeleted, businessId: ID.bizA, active: true } });
  await db.$executeRawUnsafe(`UPDATE invoices SET deleted_at = NOW() WHERE id = $1`, ID.invDeleted);

  await clearRateLimits();
  unknownPay = await payPage(UNKNOWN_TOKEN);
  unknownIntent = await intent(UNKNOWN_TOKEN, { method: 'bank_transfer' });
  unknownReceipt = await receipt(UNKNOWN_TOKEN);
  unknownView = await view(UNKNOWN_TOKEN);
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

describe('fixture sanity (real rows)', () => {
  it('two tenants; links minted, paid and revoked through the operator routes; the unknown-token answers are 404 on the token routes', async () => {
    expect((await invoiceRow(ID.invLive)).status).toBe('SENT');
    expect((await invoiceRow(ID.invPartial)).status).toBe('PARTIALLY_PAID');
    expect((await invoiceRow(ID.invPaid)).status).toBe('PAID');
    expect((await invoiceRow(ID.invDraft)).status).toBe('DRAFT');
    expect((await invoiceRow(ID.invDeleted)).deletedAt).toBeTruthy();
    expect((await db.paymentLink.findUnique({ where: { id: LINK_OF[ID.invBare].id } })).active).toBe(false);
    expect((await db.paymentLink.findUnique({ where: { id: LINK_OF[ID.invLedger].id } })).active).toBe(false);
    expect((await db.paymentLink.findUnique({ where: { id: LINK_OF[ID.invRevoke].id } })).active).toBe(true);
    expect(unknownView.body).toEqual({ ok: false, reason: 'invalid_or_expired' });
    expect(unknownReceipt.status).toBe(404);
    expect(unknownPay.status).toBe(404);
    expect(unknownIntent.status).toBe(404);
    // The ledger case is not vacuous: the operator payments posted real rows.
    expect((await ledgerCounts(ID.bizA)).transactions).toBeGreaterThanOrEqual(3);
  });
});

describe('the pay page is keyed by the token (V1-46)', () => {
  it('TG-01: a live link answers the pay-page projection, exactly what the kept bare-id public read gives an anonymous caller; no payment rows, bank details or customer email', async () => {
    const res = await payPage(LINK_OF[ID.invLive].token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: ID.invLive,
      businessId: ID.bizA,
      status: 'SENT',
      total: TOTAL,
      currency: 'TTD',
      paid: 0,
      remaining: TOTAL,
      business: { name: 'V46A Biz A' },
      contact: { firstName: 'V46a', lastName: 'Customer' },
    });
    expect(res.body.items).toHaveLength(1);
    expectNoPaymentRowsOrEmail(res.body);

    const bare = await bareProjection(ID.invLive);
    expect(bare.status).toBe(200);
    expect(res.body).toEqual(bare.body);
  });

  it('TG-02: the projection states what has been paid and what remains (40 of 100), and a settled invoice stays readable through its link as PAID with nothing remaining', async () => {
    const partial = await payPage(LINK_OF[ID.invPartial].token);
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body).toMatchObject({ id: ID.invPartial, status: 'PARTIALLY_PAID', paid: 40, remaining: 60 });
    expectNoPaymentRowsOrEmail(partial.body);

    const paid = await payPage(LINK_OF[ID.invPaid].token);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ id: ID.invPaid, status: 'PAID', paid: TOTAL, remaining: 0 });
  });

  it('TG-03: a payment intent through a live link answers the R0-22 success, writes one PENDING row on the invoice\'s own tenant, leaves the status and the ledger as they were, and the link still reads', async () => {
    const ledgerBefore = await ledgerCounts(ID.bizA);
    const res = await intent(LINK_OF[ID.invIntent].token, { method: 'bank_transfer' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toEqual({ success: true, method: 'bank_transfer', invoiceNumber: expect.any(String) });

    const rows = await paymentsOf(ID.invIntent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', method: 'bank_transfer', businessId: ID.bizA, amount: 0 });
    expect((await invoiceRow(ID.invIntent)).status).toBe('SENT');
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerBefore);

    const again = await intent(LINK_OF[ID.invIntent].token, { method: 'bank_transfer' });
    expect(again.status).toBe(res.status);
    expect(await paymentsOf(ID.invIntent)).toHaveLength(1);
    expect((await payPage(LINK_OF[ID.invIntent].token)).status).toBe(200);
  });

  it('TG-04: an intent through the live link of a settled invoice is the R0-22 409; nothing written', async () => {
    const before = await paymentsOf(ID.invPaid);
    const res = await intent(LINK_OF[ID.invPaid].token, { method: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await paymentsOf(ID.invPaid)).toEqual(before);
  });
});

describe('a revoked link stops every customer action (M34)', () => {
  it('TG-05: deactivating the link through the operator route turns a working pay page and intent into the unknown-token 404 on every action; nothing is written after the revocation', async () => {
    const token = LINK_OF[ID.invRevoke].token;
    expect((await payPage(token)).status, 'pay page before the revocation').toBe(200);
    const first = await intent(token, { method: 'cash' });
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    const afterFirst = await paymentsOf(ID.invRevoke);
    expect(afterFirst).toHaveLength(1);

    await deactivate(ID.invRevoke);
    await clearRateLimits();

    await expectEveryActionRefused(token, 'deactivated');
    expect(await paymentsOf(ID.invRevoke)).toEqual(afterFirst);
    expect((await invoiceRow(ID.invRevoke)).status).toBe('SENT');
  });

  it('TG-06: an expired, an inactive, an unknown and a foreign-tenant link answer one 404 on every action; nothing written', async () => {
    const bBefore = await tenantSnapshot(ID.bizB);
    for (const [token, inv] of [
      [LINK.expired.token, ID.invExpired],
      [LINK.inactive.token, ID.invInactive],
      [LINK.foreign.token, ID.invForeign],
    ] as const) {
      await clearRateLimits();
      await expectEveryActionRefused(token, token);
      expect(await paymentsOf(inv), token).toHaveLength(0);
      expect((await invoiceRow(inv)).status, token).toBe('SENT');
    }
    await clearRateLimits();
    await expectEveryActionRefused(UNKNOWN_TOKEN, 'unknown');
    expect(await tenantSnapshot(ID.bizB)).toBe(bBefore);
  });

  it('TG-07: a DRAFT, a VOID and a soft-deleted invoice behind a live link answer the unknown-token 404 on the pay page and the intent; nothing written', async () => {
    for (const [token, inv, status] of [
      [LINK.draft.token, ID.invDraft, 'DRAFT'],
      [LINK.void.token, ID.invVoid, 'VOID'],
      [LINK.deleted.token, ID.invDeleted, 'SENT'],
    ] as const) {
      await clearRateLimits();
      expectUnknownAnswer(await payPage(token), unknownPay, `${token}: pay page`);
      expectUnknownAnswer(await intent(token, { method: 'bank_transfer' }), unknownIntent, `${token}: intent`);
      expect(await paymentsOf(inv), token).toHaveLength(0);
      expect((await invoiceRow(inv)).status, token).toBe(status);
    }
  });

  it('TG-08 LEDGER: no payment or posting is reachable through a revoked token: Payment rows, computeBalance and both ledger counts are unchanged', async () => {
    const token = LINK_OF[ID.invLedger].token;
    const balanceBefore = await balanceOf(ID.invLedger);
    expect(balanceBefore).toMatchObject({ paid: 30, remaining: 70 });
    const rowsBefore = await paymentsOf(ID.invLedger);
    const countsA = await ledgerCounts(ID.bizA);
    const countsB = await ledgerCounts(ID.bizB);

    for (const body of [{ method: 'bank_transfer' }, { method: 'cash', amount: 70 }, { method: 'google_pay' }]) {
      expectUnknownAnswer(await intent(token, body), unknownIntent, JSON.stringify(body));
    }
    expectUnknownAnswer(await payPage(token), unknownPay, 'pay page');
    expectUnknownAnswer(await receipt(token), unknownReceipt, 'receipt');

    expect(await paymentsOf(ID.invLedger)).toEqual(rowsBefore);
    expect(await balanceOf(ID.invLedger)).toEqual(balanceBefore);
    expect(await ledgerCounts(ID.bizA)).toEqual(countsA);
    expect(await ledgerCounts(ID.bizB)).toEqual(countsB);
    expect((await invoiceRow(ID.invLedger)).status).toBe('PARTIALLY_PAID');
  });
});

describe('the bare-id pay actions are retired (D-07)', () => {
  it('TG-09: POST /commerce/invoices/:invoiceId/payment-intent is gone: a SENT invoice whose only link is revoked answers 404 and nothing is written', async () => {
    const ledgerBefore = await ledgerCounts(ID.bizA);
    for (const body of [{ method: 'bank_transfer' }, { method: 'cash', amount: 25 }]) {
      const res = await agent().post(`/commerce/invoices/${ID.invBare}/payment-intent`).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body).not.toHaveProperty('success');
    }
    expect(await paymentsOf(ID.invBare)).toHaveLength(0);
    expect((await invoiceRow(ID.invBare)).status).toBe('SENT');
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerBefore);
  });

  it('TG-10: GET /commerce/payment-links/:token, the resolver that handed out the invoice id for the /pay/:invoiceId downgrade, is gone: 404 with no invoice id', async () => {
    const res = await agent().get(`/commerce/payment-links/${encodeURIComponent(LINK_OF[ID.invResolver].token)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(ID.invResolver);
    // The link itself still works through the token routes.
    expect((await payPage(LINK_OF[ID.invResolver].token)).status).toBe(200);
  });

  it('TG-11: the bare-id public read keeps its redacted projection (KF-REVENUE-AUTH-PROJECTION-001): 200 for a SENT invoice, 404 for a DRAFT one', async () => {
    const res = await bareProjection(ID.invResolver);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.invResolver, status: 'SENT', remaining: TOTAL });
    expectNoPaymentRowsOrEmail(res.body);
    expect((await bareProjection(ID.invDraft)).status).toBe(404);
  });
});

describe('TENANT and the route contract (V1-46)', () => {
  it("TG-12 TENANT: tenant B's live token reads and writes tenant B's invoice only; tenant A's invoices, payments and links are byte-identical", async () => {
    const aBefore = await tenantSnapshot(ID.bizA);
    const page = await payPage(LINK_OF[ID.invB].token);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ id: ID.invB, businessId: ID.bizB });
    expect(JSON.stringify(page.body)).not.toContain(ID.bizA);

    const res = await intent(LINK_OF[ID.invB].token, { method: 'bank_transfer', amount: 10 });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const rows = await paymentsOf(ID.invB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.bizB, invoiceId: ID.invB, status: 'PENDING', amount: 10 });
    expect(await tenantSnapshot(ID.bizA)).toBe(aBefore);
  });

  it('TG-13: both token routes sit behind PublicRateLimitGuard alone (the token is the credential); the pay page allows 30 reads a minute and the intent 10 writes', async () => {
    const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = await import('@nestjs/common/constants');
    const { RequestMethod } = await import('@nestjs/common');

    const payHandler = CommerceControllerRef.prototype.getPayPageByToken;
    expect(typeof payHandler, 'pay page handler').toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, payHandler)).toBe('public/invoice-link/:token/pay');
    expect(Reflect.getMetadata(METHOD_METADATA, payHandler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_REF, payHandler)).toEqual({ limit: 30, windowMs: 60_000 });
    expect(Reflect.getMetadata(GUARDS_METADATA, payHandler) ?? []).toEqual([PublicRateLimitGuardRef]);

    const intentHandler = CommerceControllerRef.prototype.recordPaymentIntentByToken;
    expect(typeof intentHandler, 'intent handler').toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, intentHandler)).toBe('public/invoice-link/:token/payment-intent');
    expect(Reflect.getMetadata(METHOD_METADATA, intentHandler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_REF, intentHandler)).toEqual({ limit: 10, windowMs: 60_000 });
    expect(Reflect.getMetadata(GUARDS_METADATA, intentHandler) ?? []).toEqual([PublicRateLimitGuardRef]);

    // The two bare-id handlers are gone from the controller.
    expect(CommerceControllerRef.prototype.recordPublicPaymentIntent).toBeUndefined();
    expect(CommerceControllerRef.prototype.getPaymentLinkByToken).toBeUndefined();

    for (let i = 1; i <= 30; i += 1) {
      const res = await payPage(LINK_OF[ID.invLive].token);
      expect(res.status, `read ${i}`).toBe(200);
    }
    expect((await payPage(LINK_OF[ID.invLive].token)).status).toBe(429);
  });

  it.todo(
    'TG-14: the provider checkouts (WiPay, PayPal, Stripe), the gateway list and the PayPal capture answer 404 through a revoked token — ' +
      'they are routes of payments.controller.ts, outside this write set, and stay keyed by the invoice id; the token page reaches them only after a live-token read',
  );
});
