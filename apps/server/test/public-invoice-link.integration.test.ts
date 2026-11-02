/**
 * V1-48-PUBLIC-TOKEN-VIEW — the customer's public invoice link (REAL database).
 *
 * CF-18 and M34 (build map, P0-5 "customer-facing link, visible result";
 * D-07 ruled the link and the receipt into Release 0, token links only).
 * At its base (lines at c2f6f46d):
 *
 *   - GET /commerce/public/invoice-link/:token hand-builds a redacted invoice
 *     block with no paid or remaining figure, so a PARTIALLY_PAID invoice shows
 *     only a status badge and the total (commerce.controller.ts, the token
 *     viewer);
 *   - createPaymentLink (commerce.service.ts) leaves the token to the column
 *     default, PaymentLink.token @default(cuid()) (schema.prisma), and returns
 *     an existing active link as it is, so a new expiresInDays is ignored and
 *     an active link that has already expired is handed out again;
 *   - the token viewer loads the link's invoice by the link's invoiceId alone,
 *     so a PaymentLink row carrying another tenant's businessId opens this
 *     invoice.
 *
 * Contract pinned here:
 *
 *   token payload            -> { ok, token, invoice: <the eleven keys PC-02 pins>, balance }
 *   balance                  -> { amountPaid, amountDue, paidAt }: computeBalance's paid and
 *                               remaining over this tenant's Payment rows; paidAt only when PAID
 *   100 paid of 250          -> amountPaid 100, amountDue 150, paidAt null; still no payment
 *                               rows, no references and no customer email anywhere (canary)
 *   PAID                     -> amountDue 0, paidAt = the invoice's paidAt
 *   new link token           -> randomBytes(24) base64url (32 chars), passed explicitly; the
 *                               schema default is still cuid(), so no migration
 *   legacy cuid link (ST-V48-1) -> a live link minted before V1-48 is rotated in place (same
 *                               row, random token) the next time POST .../payment-link, send,
 *                               reminder or resend hands it out; the cuid then reads as unknown;
 *                               a dead legacy link is left as it is
 *   expiresInDays           -> honoured on a new link and on the existing active link;
 *                               an active link past its expiry is never handed out again;
 *                               a non-positive or non-number value is a 400 and writes nothing
 *   expired / inactive / foreign-tenant link -> the same body as an unknown token
 *   LEDGER (no refund row)   -> amountPaid = computeBalance.paid = sum(SUCCESSFUL) = the
 *                               ledger cash net of the invoice's payment postings
 *   LEDGER (refund row)      -> the payload still equals computeBalance; V1-29 (D-14) counts the
 *                               separate refund row once, so amountDue = total - the ledger cash net
 *   read-only                -> viewing writes no FinancialTransaction, LedgerEntry or Payment
 *                               and leaves the invoice row as it was
 *   TENANT (M31)             -> Payment sits outside the tenant extension: a Payment row
 *                               carrying another tenant's businessId is not counted, and
 *                               another tenant's token never returns this invoice's figures
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CommerceService, InvoiceWorkflowService and
 * the real ledger chain (RevenuePostingService, PostingService,
 * ChartOfAccountsSeederService) write real rows; the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. Payments, refunds
 * and links are made through the real operator routes. Identity attachment
 * (operator routes only) is a test middleware reading `x-v48a-user`; every
 * token view is anonymous. Collaborators off the boundary (contact timeline,
 * stats cache, Gmail / AI / Drive) are stubs.
 *
 * Fixtures: prefix `v48a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { computeBalance } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v48a_';
const HEADER = 'x-v48a-user';

/** Every fixture string that must never reach the public payload carries this. */
const CANARY = 'V48A_SECRET_';

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
  // tenant A, one invoice per case so balances and links never bleed between cases
  invPartial: `${P}invPartial`,
  invPaid: `${P}invPaid`,
  invTokens: `${P}invTokens`,
  invExpiry: `${P}invExpiry`,
  invExpiryNew: `${P}invExpiryNew`,
  invStale: `${P}invStale`,
  invBadExpiry: `${P}invBadExpiry`,
  invDead: `${P}invDead`,
  invDeactivate: `${P}invDeactivate`,
  invLedger: `${P}invLedger`,
  invRefund: `${P}invRefund`,
  invTenantA: `${P}invTenantA`,
  // ST-V48-1: invoices whose link was minted before V1-48 (a cuid() token)
  invLegacy: `${P}invLegacy`,
  invLegacyExpiry: `${P}invLegacyExpiry`,
  invLegacySend: `${P}invLegacySend`,
  invLegacyRemind: `${P}invLegacyRemind`,
  invLegacyPaid: `${P}invLegacyPaid`,
  invLegacyDead: `${P}invLegacyDead`,
  invLegacyRace: `${P}invLegacyRace`,
  // tenant B
  invB: `${P}invB`,
};

/** Seeded PaymentLink rows (every other link is minted by the real route). */
const LINK = {
  expired: { id: `${P}link_expired`, token: `${P}tok_expired` },
  inactive: { id: `${P}link_inactive`, token: `${P}tok_inactive` },
  stale: { id: `${P}link_stale`, token: `${P}tok_stale` },
  // A link row of tenant B pointing at tenant A's invoice (M31: no FK ties the two).
  foreign: { id: `${P}link_foreign`, token: `${P}tok_foreign` },
};
const UNKNOWN_TOKEN = `${P}tok_nosuchlink`;

const TOTAL = 250;
const DAY_MS = 86_400_000;

/** The eleven invoice-block keys PC-02 (revenue-authorization) pins; this packet adds none. */
const INVOICE_BLOCK_KEYS = ['business', 'contact', 'currency', 'dueDate', 'id', 'invoiceNumber', 'issueDate', 'items', 'notes', 'status', 'total'];

/** randomBytes(24).toString('base64url'): 32 URL-safe characters. */
const RANDOM_TOKEN = /^[A-Za-z0-9_-]{32,}$/;
/** The shape of a cuid() default: 'c' and 24 lowercase alphanumerics. */
const CUID_SHAPE = /^c[a-z0-9]{24}$/;

let db: any;
let app: any;
let redis: any;

/** Emails the operator routes hand to GmailService.sendEmail (stubbed: nothing leaves the process). */
const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];

/** Route-minted links: invoice -> token. */
const TOKEN: Record<string, string> = {};
/** Operator payments: invoice -> Payment ids, in the order recorded. */
const PAYMENT_IDS: Record<string, string[]> = {};
let unknownBody: Record<string, unknown>;

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

/** The customer's view: anonymous, exactly as /public/invoice/[token] calls it. */
function view(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}`);
}

function ownerOf(biz: string) {
  return biz === ID.bizB ? ID.ownerB : ID.ownerA;
}

function bizOf(invoiceId: string) {
  return invoiceId === ID.invB ? ID.bizB : ID.bizA;
}

/** POST .../payment-link as the invoice's owner. */
function createLink(invoiceId: string, body: Record<string, unknown> = {}) {
  const biz = bizOf(invoiceId);
  return agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payment-link`)
    .set(HEADER, ownerOf(biz))
    .send(body);
}

/** An operator payment through the real route (a real posting). Returns the Payment id. */
async function pay(invoiceId: string, amount: number, method: string, slip: string): Promise<string> {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)
    .set(HEADER, ownerOf(biz))
    .send({ amount, method, reference: `${CANARY}${P}${slip}` });
  if (res.status !== 201) throw new Error(`operator payment on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body?.payment?.id;
  if (!id) throw new Error(`operator payment on ${invoiceId} returned no payment id: ${JSON.stringify(res.body)}`);
  (PAYMENT_IDS[invoiceId] ??= []).push(id);
  return id;
}

async function mintLink(invoiceId: string): Promise<string> {
  const res = await createLink(invoiceId);
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

async function linksOf(invoiceId: string): Promise<any[]> {
  return db.paymentLink.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/**
 * A link row as every link was minted before V1-48: no token passed, so the
 * column default cuid() fills it (ST-V48-1).
 */
async function seedLegacyLink(invoiceId: string, extra: Record<string, unknown> = {}): Promise<any> {
  const row = await db.paymentLink.create({ data: { invoiceId, businessId: bizOf(invoiceId), ...extra } });
  expect(row.token, 'seeded legacy token').toMatch(CUID_SHAPE);
  return row;
}

/** The token in the /public/invoice/<token> URL of an email or a paymentUrl. */
function linkTokenIn(text: string | null | undefined): string | undefined {
  return /\/public\/invoice\/([A-Za-z0-9_-]+)/.exec(text ?? '')?.[1];
}

function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {})).not.toContain(CANARY);
}

/** No payment row, reference or customer email anywhere in the payload, at any depth. */
function expectNoPaymentRowsOrEmail(body: unknown) {
  const walk = (node: unknown, at: string) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      expect(['payments', 'reference', 'providerPaymentId', 'evidenceUrl', 'recordedBy'], `${at}.${k}`).not.toContain(k);
      if (at === '$.invoice.contact') expect(k, `${at}.${k}`).not.toBe('email');
      walk(v, `${at}.${k}`);
    }
  };
  walk(body, '$');
  expectNoCanary(body);
}

/** Within a minute of now + days. */
function expectExpiryAbout(expiresAt: string | Date | null | undefined, days: number) {
  expect(expiresAt, 'expiresAt').toBeTruthy();
  const at = new Date(expiresAt as string).getTime();
  expect(Math.abs(at - (Date.now() + days * DAY_MS))).toBeLessThan(60_000);
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
      // Captures send-email / send-reminder / resend-receipt mail (ST-V48-1 reads the pay link in it).
      {
        provide: GmailService,
        useValue: {
          sendEmail: async (m: any) => {
            sentEmails.push(m);
            return { messageId: `${P}msg_${sentEmails.length}` };
          },
        },
      },
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
  // them) and its contact a canary email: neither may reach the payload.
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'V48A Biz A', ownerId: ID.ownerA, currency: 'TTD', metaData: { bankAccountNumber: `${CANARY}acct` } },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V48A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V48a', lastName: 'Customer', email: `${P}${CANARY}customer@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V48a', lastName: 'CustomerB', email: `${P}customerB@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);

  // ---- invoices: every one SENT for 250 ----------------------------------
  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const biz = bizOf(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V48A-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        notes: 'Thank you for your business',
        businessId: biz,
        contactId: biz === ID.bizB ? ID.contactB : ID.contactA,
        items: { create: [{ id: `${id}_item1`, description: `V48A item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }

  // ---- links minted by the real route while the invoices are payable ------
  for (const inv of [ID.invPartial, ID.invPaid, ID.invTokens, ID.invLedger, ID.invRefund, ID.invTenantA, ID.invB]) {
    await mintLink(inv);
  }

  // ---- operator payments and one refund through the real routes ------------
  await pay(ID.invPartial, 100, 'cash', 'slip_partial');
  await pay(ID.invPaid, 100, 'cash', 'slip_paid_1');
  await pay(ID.invPaid, 150, 'bank_transfer', 'slip_paid_2');
  await pay(ID.invLedger, 60, 'cash', 'slip_ledger_1');
  await pay(ID.invLedger, 40, 'bank_transfer', 'slip_ledger_2');
  await pay(ID.invRefund, 100, 'cash', 'slip_refund_1');
  const refunded = await pay(ID.invRefund, 60, 'cash', 'slip_refund_2');
  const refund = await agent()
    .post(`/commerce/businesses/${ID.bizA}/payments/${refunded}/refund`)
    .set(HEADER, ID.ownerA)
    .send({ reason: 'customer returned goods' });
  if (refund.status !== 201) throw new Error(`refund failed: ${refund.status} ${JSON.stringify(refund.body)}`);
  await pay(ID.invTenantA, 50, 'cash', 'slip_tenant_a');
  await pay(ID.invB, 30, 'cash', 'slip_b');

  // ---- seeded rows the routes cannot make -----------------------------------
  await db.paymentLink.create({ data: { id: LINK.expired.id, token: `${P}tok_expired`, invoiceId: ID.invDead, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() - DAY_MS) } });
  await db.paymentLink.create({ data: { id: LINK.inactive.id, token: `${P}tok_inactive`, invoiceId: ID.invDead, businessId: ID.bizA, active: false } });
  await db.paymentLink.create({ data: { id: LINK.stale.id, token: `${P}tok_stale`, invoiceId: ID.invStale, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() - DAY_MS) } });
  await db.paymentLink.create({ data: { id: LINK.foreign.id, token: `${P}tok_foreign`, invoiceId: ID.invPartial, businessId: ID.bizB, active: true } });
  // A SUCCESSFUL Payment row tagged with tenant B on tenant A's invoice (M31: no FK, no tenant extension).
  await db.payment.create({
    data: {
      id: `${P}pay_foreign`, businessId: ID.bizB, invoiceId: ID.invTenantA, amount: 70, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'cash', method: 'cash', providerPaymentId: `${P}pp_foreign`, reference: `${CANARY}foreign`,
    },
  });

  await clearRateLimits();
  unknownBody = (await view(UNKNOWN_TOKEN)).body;
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
  it('the operator routes produced the seeded states: 100 of 250, PAID with paidAt, a refunded row, real postings, and one link per minted invoice', async () => {
    expect((await invoiceRow(ID.invPartial)).status).toBe('PARTIALLY_PAID');
    const paid = await invoiceRow(ID.invPaid);
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).toBeTruthy();
    expect((await invoiceRow(ID.invRefund)).status).toBe('PARTIALLY_PAID');
    const refundRows = await db.payment.findMany({ where: { invoiceId: ID.invRefund }, orderBy: { createdAt: 'asc' } });
    // V1-29 (D-14): the refunded 60 stays SUCCESSFUL beside a separate -60 REFUNDED row.
    expect(refundRows.map((r: any) => [Number(r.amount), r.status])).toEqual([[100, 'SUCCESSFUL'], [60, 'SUCCESSFUL'], [-60, 'REFUNDED']]);
    expect((await ledgerCounts(ID.bizA)).transactions).toBeGreaterThanOrEqual(8);
    expect(unknownBody).toEqual({ ok: false, reason: 'invalid_or_expired' });
    // One route-minted link per minted invoice (the seeded foreign link on invPartial carries tenant B).
    for (const inv of Object.keys(TOKEN)) {
      expect((await linksOf(inv)).filter((l: any) => l.businessId === bizOf(inv)), inv).toHaveLength(1);
    }
  });
});

describe('CF-18: the token payload carries paid and remaining (V1-48)', () => {
  it('L-01: for 100 paid of 250 the payload carries balance { amountPaid 100, amountDue 150, paidAt null } beside the unchanged eleven-key invoice block', async () => {
    const res = await view(TOKEN[ID.invPartial]);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe(TOKEN[ID.invPartial]);
    expect(res.body.invoice).toMatchObject({ id: ID.invPartial, status: 'PARTIALLY_PAID', total: TOTAL, currency: 'TTD' });
    expect(Object.keys(res.body.invoice).sort()).toEqual([...INVOICE_BLOCK_KEYS].sort());
    expect(res.body.balance).toEqual({ amountPaid: 100, amountDue: 150, paidAt: null });
  });

  it('L-02 canary: still no payment rows, no payment references and no customer email anywhere in the payload', async () => {
    const res = await view(TOKEN[ID.invPartial]);
    expect(res.status).toBe(200);
    expectNoPaymentRowsOrEmail(res.body);
    expect(res.body.invoice.contact).toEqual({ firstName: 'V48a', lastName: 'Customer' });
  });

  it('L-03: a PAID invoice carries amountDue 0, amountPaid 250 and the invoice\'s paidAt', async () => {
    const row = await invoiceRow(ID.invPaid);
    const res = await view(TOKEN[ID.invPaid]);
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('PAID');
    expect(res.body.balance).toEqual({ amountPaid: 250, amountDue: 0, paidAt: new Date(row.paidAt).toISOString() });
    expectNoPaymentRowsOrEmail(res.body);
  });
});

describe('M34: new link tokens are crypto-random and passed explicitly (V1-48)', () => {
  it('L-04: every route-minted token is randomBytes(24) base64url (32 URL-safe chars, 24 bytes), not a cuid, and all are distinct', async () => {
    const tokens = Object.values(TOKEN);
    expect(tokens.length).toBeGreaterThanOrEqual(7);
    for (const t of tokens) {
      expect(t, t).toMatch(RANDOM_TOKEN);
      expect(t.length, t).toBeGreaterThanOrEqual(32);
      expect(Buffer.from(t, 'base64url').length, t).toBeGreaterThanOrEqual(24);
      expect(t, t).not.toMatch(CUID_SHAPE);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
    // The stored row holds exactly what the route answered.
    const stored = await linksOf(ID.invTokens);
    expect(stored.map((l: any) => l.token)).toEqual([TOKEN[ID.invTokens]]);
  });

  it('L-05 no migration: the column default is still cuid(), so the random token is the service passing it explicitly', () => {
    const schema = readFileSync(path.resolve(__dirname, '../../../packages/db/prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model PaymentLink {'), schema.indexOf('}', schema.indexOf('model PaymentLink {')));
    expect(model).toMatch(/token\s+String\s+@unique\s+@default\(cuid\(\)\)/);
  });
});

describe('expiresInDays is honoured (V1-48)', () => {
  it('L-06: on a new link, expiresInDays sets expiresAt to now + N days', async () => {
    const res = await createLink(ID.invExpiryNew, { expiresInDays: 3 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.token).toMatch(RANDOM_TOKEN);
    expectExpiryAbout(res.body.expiresAt, 3);
    const stored = await linksOf(ID.invExpiryNew);
    expect(stored).toHaveLength(1);
    expectExpiryAbout(stored[0].expiresAt, 3);
  });

  it('L-07: with an active link already in place, a new expiresInDays is applied to it (same token, one active link); a later call without one leaves it as set', async () => {
    const first = await createLink(ID.invExpiry);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.expiresAt).toBeNull();

    const second = await createLink(ID.invExpiry, { expiresInDays: 7 });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.token).toBe(first.body.token);
    expectExpiryAbout(second.body.expiresAt, 7);

    const third = await createLink(ID.invExpiry);
    expect(third.status).toBe(201);
    expect(third.body.token).toBe(first.body.token);
    expect(new Date(third.body.expiresAt).getTime()).toBe(new Date(second.body.expiresAt).getTime());

    const stored = await linksOf(ID.invExpiry);
    expect(stored.filter((l: any) => l.active)).toHaveLength(1);
    expectExpiryAbout(stored[0].expiresAt, 7);
    expect((await view(first.body.token)).body.ok).toBe(true);
  });

  it('L-08: an active link already past its expiry is never handed out again: the route mints a fresh random token that opens the invoice', async () => {
    const res = await createLink(ID.invStale);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.token).not.toBe(LINK.stale.token);
    expect(res.body.token).toMatch(RANDOM_TOKEN);
    expect(res.body.expiresAt).toBeNull();
    const fresh = await view(res.body.token);
    expect(fresh.body.ok).toBe(true);
    expect(fresh.body.invoice.id).toBe(ID.invStale);
    // The stale token itself still answers as unknown.
    expect((await view(LINK.stale.token)).body).toEqual(unknownBody);
  });

  it('L-09: a non-positive or non-number expiresInDays is a 400 and writes no link', async () => {
    for (const expiresInDays of [-1, 0, 'abc', Number.MAX_SAFE_INTEGER]) {
      const res = await createLink(ID.invBadExpiry, { expiresInDays });
      expect(res.status, `${JSON.stringify(expiresInDays)}: ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(await linksOf(ID.invBadExpiry)).toHaveLength(0);
  });
});

describe('neutral answers: expired, inactive and foreign links read as unknown (V1-48)', () => {
  it('L-10: an expired link and an inactive link answer exactly the unknown-token body', async () => {
    expect(unknownBody).toEqual({ ok: false, reason: 'invalid_or_expired' });
    for (const token of [LINK.expired.token, LINK.inactive.token]) {
      const res = await view(token);
      expect(res.status, token).toBe(200);
      expect(res.body, token).toEqual(unknownBody);
    }
  });

  it('L-11: a link deactivated through the operator route answers the unknown-token body', async () => {
    const created = await createLink(ID.invDeactivate);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await view(created.body.token)).body.ok).toBe(true);
    const del = await agent().delete(`/commerce/businesses/${ID.bizA}/payment-links/${created.body.id}`).set(HEADER, ID.ownerA);
    expect([200, 204]).toContain(del.status);
    expect((await view(created.body.token)).body).toEqual(unknownBody);
  });

  it("L-12 TENANT (M31): a PaymentLink row carrying tenant B's businessId on tenant A's invoice answers the unknown-token body, with none of A's figures", async () => {
    const res = await view(LINK.foreign.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(unknownBody);
    expect(JSON.stringify(res.body)).not.toContain(ID.invPartial);
  });
});

describe('LEDGER and TENANT (V1-48)', () => {
  it('L-13 LEDGER (no refund row): amountPaid = computeBalance.paid = sum(SUCCESSFUL) = the ledger cash net; amountDue = computeBalance.remaining', async () => {
    const res = await view(TOKEN[ID.invLedger]);
    expect(res.status).toBe(200);
    const balance = await balanceOf(ID.invLedger);
    expect(balance.refunded).toBe(0);
    expect(res.body.balance.amountPaid).toBe(balance.paid);
    expect(res.body.balance.amountPaid).toBe(await successfulSum(ID.invLedger, ID.bizA));
    expect(res.body.balance.amountPaid).toBe(await ledgerCashNet(ID.invLedger, ID.bizA));
    expect(res.body.balance.amountDue).toBe(balance.remaining);
    expect(res.body.balance).toEqual({ amountPaid: 100, amountDue: 150, paidAt: null });
  });

  it('L-14 LEDGER (refund row, V1-29): the payload still equals computeBalance, which counts the separate refund row once; amountDue = total - the ledger cash net', async () => {
    const res = await view(TOKEN[ID.invRefund]);
    expect(res.status).toBe(200);
    const balance = await balanceOf(ID.invRefund);
    expect(res.body.balance.amountPaid).toBe(balance.paid);
    expect(res.body.balance.amountDue).toBe(balance.remaining);
    // 100 + 60 received, 60 refunded through the operator route: the ledger nets 100.
    const cashNet = await ledgerCashNet(ID.invRefund, ID.bizA);
    expect(cashNet).toBe(100);
    // computeBalance (V1-29, D-14): paid 160 (the refunded 60 stays SUCCESSFUL), refunded 60, net 100 = the ledger.
    expect(balance).toMatchObject({ paid: 160, refunded: 60, net: 100, remaining: 150 });
    expect(balance.net).toBe(cashNet);
    // The base read net 40, remaining 210 (M28). amountPaid is the gross paid (160):
    // characterization, the net display is V1-36 (one balance read contract).
    expect(res.body.balance).toEqual({ amountPaid: 160, amountDue: 150, paidAt: null });
    expect(res.body.balance.amountDue).toBe(TOTAL - cashNet);
  });

  it('L-15 read-only: viewing a link three times writes no FinancialTransaction, LedgerEntry or Payment and leaves the invoice row as it was', async () => {
    const countsA = await ledgerCounts(ID.bizA);
    const countsB = await ledgerCounts(ID.bizB);
    const paymentsBefore = await db.payment.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });
    const rowBefore = await invoiceRow(ID.invPartial);
    for (let i = 0; i < 3; i++) expect((await view(TOKEN[ID.invPartial])).status).toBe(200);
    expect(await ledgerCounts(ID.bizA)).toEqual(countsA);
    expect(await ledgerCounts(ID.bizB)).toEqual(countsB);
    expect(await db.payment.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(paymentsBefore);
    expect(await invoiceRow(ID.invPartial)).toEqual(rowBefore);
  });

  it("L-16 TENANT (M31): a SUCCESSFUL Payment row tagged with tenant B on tenant A's invoice is not counted: A's link shows 50 paid, 200 due", async () => {
    const res = await view(TOKEN[ID.invTenantA]);
    expect(res.status).toBe(200);
    expect(res.body.balance).toEqual({ amountPaid: 50, amountDue: 200, paidAt: null });
    expectNoCanary(res.body);
  });

  it("L-17 TENANT: tenant B's own link returns B's figures (30 paid, 220 due) and nothing of A's invoices", async () => {
    const res = await view(TOKEN[ID.invB]);
    expect(res.status).toBe(200);
    expect(res.body.invoice.id).toBe(ID.invB);
    expect(res.body.balance).toEqual({ amountPaid: 30, amountDue: 220, paidAt: null });
    const text = JSON.stringify(res.body);
    for (const inv of [ID.invPartial, ID.invTenantA, ID.invPaid]) expect(text).not.toContain(inv);
    expect(text).not.toContain('V48A Biz A');
  });
});

describe('ST-V48-1: a live link still carrying a cuid() token is rotated the next time it is handed out (V1-48 review)', () => {
  it('L-18: POST .../payment-link rotates a live legacy link in place: same row, a random token, the cuid answers unknown; a second POST hands out the same new token', async () => {
    const legacy = await seedLegacyLink(ID.invLegacy);
    // Until it is handed out again the legacy link keeps working.
    expect((await view(legacy.token)).body.ok).toBe(true);

    const res = await createLink(ID.invLegacy);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toBe(legacy.id);
    expect(res.body.token).toMatch(RANDOM_TOKEN);
    expect(res.body.token).not.toMatch(CUID_SHAPE);
    expect(res.body.expiresAt).toBeNull();
    expect((await view(legacy.token)).body).toEqual(unknownBody);
    const fresh = await view(res.body.token);
    expect(fresh.body.ok).toBe(true);
    expect(fresh.body.invoice.id).toBe(ID.invLegacy);

    const again = await createLink(ID.invLegacy);
    expect(again.status).toBe(201);
    expect(again.body.token).toBe(res.body.token);
    const stored = await linksOf(ID.invLegacy);
    expect(stored.map((l: any) => [l.id, l.token, l.active])).toEqual([[legacy.id, res.body.token, true]]);
  });

  it('L-19: POST with expiresInDays on a live legacy link rotates the token and applies the expiry in the same answer', async () => {
    const legacy = await seedLegacyLink(ID.invLegacyExpiry);
    const res = await createLink(ID.invLegacyExpiry, { expiresInDays: 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toBe(legacy.id);
    expect(res.body.token).toMatch(RANDOM_TOKEN);
    expectExpiryAbout(res.body.expiresAt, 7);
    const stored = await linksOf(ID.invLegacyExpiry);
    expect(stored).toHaveLength(1);
    expect(stored[0].token).toBe(res.body.token);
    expectExpiryAbout(stored[0].expiresAt, 7);
    expect((await view(legacy.token)).body).toEqual(unknownBody);
    expect((await view(res.body.token)).body.ok).toBe(true);
  });

  it('L-20: send-email and send-reminder put the rotated random token in the pay link, never the cuid', async () => {
    const sendLegacy = await seedLegacyLink(ID.invLegacySend);
    sentEmails.length = 0;
    const sent = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invLegacySend}/send-email`)
      .set(HEADER, ID.ownerA)
      .send({ recipientEmail: `${P}payer@test.local` });
    expect([200, 201], JSON.stringify(sent.body)).toContain(sent.status);
    const sentToken = linkTokenIn(sent.body.paymentUrl);
    expect(sentToken).toMatch(RANDOM_TOKEN);
    expect(sentEmails).toHaveLength(1);
    expect(linkTokenIn(sentEmails[0]!.htmlBody)).toBe(sentToken);
    expect(sentEmails[0]!.htmlBody).not.toContain(sendLegacy.token);
    expect((await linksOf(ID.invLegacySend)).map((l: any) => [l.id, l.token])).toEqual([[sendLegacy.id, sentToken]]);

    const remindLegacy = await seedLegacyLink(ID.invLegacyRemind);
    sentEmails.length = 0;
    const reminded = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invLegacyRemind}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ recipientEmail: `${P}payer@test.local`, channel: 'email' });
    expect([200, 201], JSON.stringify(reminded.body)).toContain(reminded.status);
    expect(reminded.body.delivered).toBe(true);
    const remindToken = linkTokenIn(reminded.body.paymentUrl);
    expect(remindToken).toMatch(RANDOM_TOKEN);
    expect(sentEmails).toHaveLength(1);
    expect(linkTokenIn(sentEmails[0]!.htmlBody)).toBe(remindToken);
    expect(sentEmails[0]!.htmlBody).not.toContain(remindLegacy.token);
    expect((await linksOf(ID.invLegacyRemind)).map((l: any) => [l.id, l.token])).toEqual([[remindLegacy.id, remindToken]]);
    expect((await view(remindLegacy.token)).body).toEqual(unknownBody);
    expect((await view(remindToken!)).body.ok).toBe(true);
  });

  it('L-21: resend-receipt on a PAID invoice (createPaymentLink refuses, the latest link is surfaced) hands out the rotated token, which opens the paid invoice', async () => {
    const legacy = await seedLegacyLink(ID.invLegacyPaid);
    await pay(ID.invLegacyPaid, TOTAL, 'cash', 'slip_legacy_paid');
    expect((await invoiceRow(ID.invLegacyPaid)).status).toBe('PAID');
    sentEmails.length = 0;
    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invLegacyPaid}/resend-receipt`)
      .set(HEADER, ID.ownerA)
      .send({ recipientEmail: `${P}payer@test.local` });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(sentEmails).toHaveLength(1);
    const token = linkTokenIn(sentEmails[0]!.htmlBody);
    expect(token).toMatch(RANDOM_TOKEN);
    expect(sentEmails[0]!.htmlBody).not.toContain(legacy.token);
    expect((await linksOf(ID.invLegacyPaid)).map((l: any) => [l.id, l.token, l.active])).toEqual([[legacy.id, token, true]]);
    const paid = await view(token!);
    expect(paid.body.ok).toBe(true);
    expect(paid.body.invoice.status).toBe('PAID');
    expect((await view(legacy.token)).body).toEqual(unknownBody);
  });

  it('L-22 control: an expired or inactive legacy link is not live, so it is left as it is (no write) and a fresh random link is minted beside it', async () => {
    const expired = await seedLegacyLink(ID.invLegacyDead, { expiresAt: new Date(Date.now() - DAY_MS), createdAt: new Date(Date.now() - 3 * DAY_MS) });
    const inactive = await seedLegacyLink(ID.invLegacyDead, { active: false, createdAt: new Date(Date.now() - 2 * DAY_MS) });
    const res = await createLink(ID.invLegacyDead);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.token).toMatch(RANDOM_TOKEN);
    expect([expired.id, inactive.id]).not.toContain(res.body.id);
    const stored = await linksOf(ID.invLegacyDead);
    expect(stored.map((l: any) => [l.id, l.token, l.active])).toEqual([
      [expired.id, expired.token, true],
      [inactive.id, inactive.token, false],
      [res.body.id, res.body.token, true],
    ]);
  });

  it('L-23 race: two concurrent POSTs on one live legacy link converge on a single random token on the same row', async () => {
    const legacy = await seedLegacyLink(ID.invLegacyRace);
    const [a, b] = await Promise.all([createLink(ID.invLegacyRace), createLink(ID.invLegacyRace)]);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.token).toMatch(RANDOM_TOKEN);
    expect(b.body.token).toBe(a.body.token);
    expect((await linksOf(ID.invLegacyRace)).map((l: any) => [l.id, l.token])).toEqual([[legacy.id, a.body.token]]);
  });
});
