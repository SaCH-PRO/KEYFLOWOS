/**
 * KF-REVENUE-AUTH-PROJECTION-001 — revenue authorization and public projection (REAL database).
 *
 * Implements the L2 layer of the negative-control matrix
 * docs/reconstruction/product/evidence/REVENUE-AUTH-NEGATIVE-CONTROLS-001.md (revision 2):
 * every RA-* and PC-* case, grouped into the three lists of §5. Cases in
 * "List A: pre-fix failures" are the true negative controls — they MUST fail on
 * main b1948d27 and pass at the fix head. "List B: regression controls" pass
 * before and after. "List C: post-fix acceptance" assert behaviour that is
 * absent (not leaking) on main.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, PublicRateLimitGuard (real Redis at
 * REDIS_URL), CommerceService, InvoiceReceiptBuilderService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService,
 * ChartOfAccountsSeederService, ExpensePostingService, PaymentsService and
 * InvoiceReceiptListener are real against DATABASE_URL. Identity attachment
 * is the one stand-in: a test middleware reads `x-rva-user`, loads that seeded
 * user row and attaches `{ id, email, role }` exactly as the Supabase-verifying
 * AuthMiddleware would after token verification. Stubs exist only for
 * collaborators off the boundary (CrmService.logContactEvent, CommerceStatsService,
 * Gmail, vision, drive/AI, TimelineService) and EventEmitter2 is a recorder, so
 * listeners cannot mutate.
 *
 * Fixture preflight (§2.5): prefix `rva_`; one fresh `rva_invMut_<case>` copy per
 * mutating case; unique `providerPaymentId` values; a contact for every invoice;
 * hard-delete by raw SQL in the exact dependency order in beforeAll and afterAll;
 * no $transaction wrapping; the public-status rate-limit key is reset around
 * RA-G5-06. Business A is on ACCRUAL basis so the AR posting at SENT is an
 * observable ledger side effect.
 *
 * Every fixture string that must never leave the server carries the canary
 * `RVA_SECRET_`; every denied or public response is checked for it.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// R0-20b: the Stripe SDK the legacy WebhooksController builds is a stub, so no
// provider traffic is possible. constructEvent verifies the Stripe-Signature
// header the way the SDK does (t=<ts>,v1=<HMAC-SHA256(secret, `${t}.${payload}`)>)
// and returns the parsed payload; anything else throws, as the SDK does.
vi.mock('stripe', async () => {
  const { createHmac: hmac, timingSafeEqual } = await import('crypto');
  class Stripe {
    webhooks = {
      constructEvent: (payload: Buffer | string, header: string, secret: string) => {
        const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
        const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=').map((x) => x.trim())));
        const expected = Buffer.from(hmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex'));
        const given = Buffer.from(String(parts.v1 ?? ''));
        if (!parts.t || given.length !== expected.length || !timingSafeEqual(given, expected)) {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return JSON.parse(raw);
      },
    };
  }
  return { default: Stripe };
});

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'rva_';
const CANARY = 'RVA_SECRET_';

// R0-00-WT-ISOLATION: this suite's public rate-limit keys live under its own
// namespace (pub_rate_limit:rva_:<ip>:<handler>:<route>), and every reset below
// deletes only that namespace, so it can neither reset nor exhaust another
// suite's windows on the same Redis index. The guard reads the variable per
// request; the previous value is restored in afterAll.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  // identities (§2.1)
  ownerA: `${P}ownerA`,
  adminA: `${P}adminA`,
  staffWriteA: `${P}staffWriteA`,
  staffReadA: `${P}staffReadA`,
  staffNoneA: `${P}staffNoneA`,
  staffDefaultA: `${P}staffDefaultA`,
  noMember: `${P}noMember`,
  ownerB: `${P}ownerB`,
  superAdmin: `${P}superAdmin`,
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // invoices (§2.2)
  invSent: `${P}invSent`,
  invDraft: `${P}invDraft`,
  invPaid: `${P}invPaid`,
  invVoid: `${P}invVoid`,
  invB: `${P}invB`,
  // payments
  payS1: `${P}pay_s1`,
  payS2: `${P}pay_s2`,
  payP1: `${P}pay_p1`,
  // payment links
  linkSent: `${P}linkSent`,
  linkExpired: `${P}linkExpired`,
  tokSent: `${P}tok_sent`,
  tokExpired: `${P}tok_expired`,
};

const PAY_S1_CREATED_AT = new Date('2026-01-10T10:00:00.000Z');
const PAY_S2_CREATED_AT = new Date('2026-01-11T10:00:00.000Z');
const PAY_P1_CREATED_AT = new Date('2026-01-12T10:00:00.000Z');

const STATUS_ROUTE_KEY_PATTERN = `pub_rate_limit:${RATE_LIMIT_NS}:*getInvoicePaymentStatus*`;

let db: any;
let app: any;
let redis: any;
let commerce: any; // real CommerceService instance from the app
let workflow: any; // real InvoiceWorkflowService
let receiptListener: any; // real InvoiceReceiptListener
let CommerceAdapterServiceCtor: any;
let NotFoundExceptionCtor: any;
let ForbiddenExceptionCtor: any;
let KEY_SYSTEM_ACTOR: string;

// EventEmitter2 recorder — events are recorded, never dispatched.
const recordedEvents: Array<{ name: string; payload: any }> = [];
const eventRecorder = {
  emit: (name: string, payload: unknown) => {
    recordedEvents.push({ name, payload });
    return true;
  },
  emitAsync: async (name: string, payload: unknown) => {
    recordedEvents.push({ name, payload });
    return [];
  },
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

// CrmService stand-in — the contact timeline is off the boundary.
const crmCalls: any[] = [];
const crmRecorder = {
  logContactEvent: async (input: unknown) => {
    crmCalls.push(input);
    return { id: `${P}evt_${crmCalls.length}` };
  },
};

// Gmail stand-in — captures the rendered HTML instead of sending provider traffic.
const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];
const gmailRecorder = {
  sendEmail: async (params: { businessId: string; to: string; subject: string; htmlBody: string }) => {
    sentEmails.push(params);
    return { messageId: `${P}msg_${sentEmails.length}` };
  },
};

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension) in the §2.5
  // dependency order. Each statement is best-effort so a partial earlier run
  // cannot block this one.
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_transactions WHERE business_id LIKE '${P}%'`,
    // R0-SEC3: the RR-R002-04 bookings reference invoices, contacts, a service,
    // a staff member and an org unit (NoAction), so they go first.
    `DELETE FROM bookings WHERE business_id LIKE '${P}%'`,
    `DELETE FROM services WHERE business_id LIKE '${P}%'`,
    `DELETE FROM staff_members WHERE business_id LIKE '${P}%'`,
    `DELETE FROM org_units WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payments WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM payment_links WHERE business_id LIKE '${P}%'`,
    // R0-20b: the Stripe ledger door claims its events with no business (the event ids carry the prefix).
    `DELETE FROM webhook_events WHERE provider_event_id LIKE '${P}%'`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE '${P}%'`,
    `DELETE FROM invoices WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%' OR user_id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearStatusRouteRateLimit() {
  const keys: string[] = await redis.keys(STATUS_ROUTE_KEY_PATTERN);
  if (keys.length) await redis.del(...keys);
}

// Review repair ST-4: GET /commerce/invoices/:id is now limited at 20/min per
// IP like the status route. Every case in this file that reads the public view
// shares one IP, so the key is reset before each test; the RR-ST4 case below
// is the only one that counts hits within a single test.
const PUBLIC_INVOICE_ROUTE_KEY_PATTERN = `pub_rate_limit:${RATE_LIMIT_NS}:*:getInvoice:*`;

async function clearPublicInvoiceRouteRateLimit() {
  const keys: string[] = await redis.keys(PUBLIC_INVOICE_ROUTE_KEY_PATTERN);
  if (keys.length) await redis.del(...keys);
}

async function clearAllPublicRateLimits() {
  // Only this suite's namespace. At c2f6f46d this deleted every pub_rate_limit:*
  // key on the Redis index, including other suites' live windows.
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

function withActor(req: request.Test, actor: string | null) {
  return actor ? req.set('x-rva-user', actor) : req;
}

/** A denied or public response must carry no canary. */
function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {})).not.toContain(CANARY);
}

/** Error bodies differ only in volatile envelope fields; strip those before comparing. */
function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

async function invoiceStatus(id: string): Promise<string | null> {
  const row = await db.invoice.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

async function paymentCount(invoiceId: string): Promise<number> {
  return db.payment.count({ where: { invoiceId } });
}

async function postingsFor(invoiceId: string): Promise<Array<{ id: string; externalRef: string | null; status: string; type: string }>> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.bizA, OR: [{ externalRef: { startsWith: `Invoice:${invoiceId}:` } }, { sourceId: invoiceId }] },
    select: { id: true, externalRef: true, status: true, type: true },
  });
}

/**
 * R0-02 review repair SEC-R002-2: every FinancialTransaction of business A,
 * whatever its source. postingsFor() sees only the invoice's own postings
 * (externalRef Invoice:<id>: or sourceId = the invoice id); a mark-paid posts
 * with sourceType Payment, sourceId = the payment id and externalRef
 * Payment:<paymentId>:payment_recorded, which only this count and
 * paymentPostingsFor() observe. The cases of this file run one at a time and
 * rva_bizA is this suite's own tenant, so a change in the count is the case's
 * own write.
 */
async function ledgerCountA(): Promise<number> {
  return db.financialTransaction.count({ where: { businessId: ID.bizA } });
}

/** The postings of the invoice's payment rows (sourceType Payment), which postingsFor() cannot see. */
async function paymentPostingsFor(invoiceId: string): Promise<Array<{ id: string; externalRef: string | null; status: string; type: string }>> {
  const payments: Array<{ id: string }> = await db.payment.findMany({ where: { invoiceId }, select: { id: true } });
  if (payments.length === 0) return [];
  return db.financialTransaction.findMany({
    where: { businessId: ID.bizA, sourceType: 'Payment', sourceId: { in: payments.map((p) => p.id) } },
    select: { id: true, externalRef: true, status: true, type: true },
  });
}

/** The error a refused service call rejects with (undefined when it resolves). */
async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
    return undefined;
  } catch (err) {
    return err;
  }
}

function eventsFor(name: string, invoiceId: string) {
  return recordedEvents.filter((e) => e.name === name && e.payload?.invoice?.id === invoiceId);
}

/**
 * One fresh invoice copy per mutating case (§2.5). `viaWorkflow` moves a SENT
 * copy through the real transition so its AR posting exists (needed when a
 * case must observe a void reversal); otherwise the status is written directly.
 */
async function createCopy(
  caseKey: string,
  opts: { status: 'DRAFT' | 'SENT'; viaWorkflow?: boolean; payments?: Array<{ amount: number; status: string }> },
): Promise<string> {
  const id = `${P}invMut_${caseKey}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `RVA-${caseKey}`,
      status: opts.viaWorkflow ? 'DRAFT' : opts.status,
      subtotal: 100,
      total: 100,
      currency: 'TTD',
      businessId: ID.bizA,
      contactId: ID.contactA,
      items: { create: [{ id: `${id}_item1`, description: 'RVA line item', quantity: 1, unitPrice: 100, total: 100 }] },
    },
  });
  if (opts.viaWorkflow && opts.status === 'SENT') {
    await workflow.transition(id, 'SENT');
  }
  let n = 0;
  for (const p of opts.payments ?? []) {
    n += 1;
    await db.payment.create({
      data: {
        id: `${id}_pay${n}`,
        businessId: ID.bizA,
        invoiceId: id,
        amount: p.amount,
        currency: 'TTD',
        status: p.status,
        provider: 'manual',
        method: 'MANUAL',
        providerPaymentId: `${P}pp_${caseKey}_${n}`,
      },
    });
  }
  return id;
}

function markPaid(actor: string | null, invoiceId: string, body: Record<string, unknown>) {
  return withActor(agent().patch(`/commerce/invoices/${invoiceId}/paid`), actor).send(body);
}

function markFailed(actor: string | null, invoiceId: string, body: Record<string, unknown>) {
  return withActor(agent().patch(`/commerce/invoices/${invoiceId}/payment-failed`), actor).send(body);
}

function setStatus(actor: string | null, invoiceId: string, pathStatus: string, body: Record<string, unknown>) {
  return withActor(agent().patch(`/commerce/invoices/${invoiceId}/status/${pathStatus}`), actor).send(body);
}

function receipt(actor: string | null, invoiceId: string, businessId?: string) {
  const url = businessId
    ? `/commerce/invoices/${invoiceId}/receipt?businessId=${businessId}`
    : `/commerce/invoices/${invoiceId}/receipt`;
  return withActor(agent().get(url), actor);
}

function publicInvoice(invoiceId: string) {
  return agent().get(`/commerce/invoices/${invoiceId}`);
}

function publicStatus(invoiceId: string) {
  return agent().get(`/payments/invoice/${invoiceId}/status`);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, NotFoundException, ForbiddenException } = await import('@nestjs/common');
  NotFoundExceptionCtor = NotFoundException;
  ForbiddenExceptionCtor = ForbiddenException;
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
  const { InvoiceReceiptListener } = await import('../src/modules/commerce/invoice-receipt.listener');
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
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
  const { WebhooksController } = await import('../src/modules/webhooks/webhooks.controller');
  const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
  CommerceAdapterServiceCtor = CommerceAdapterService;
  KEY_SYSTEM_ACTOR = KEY_SYSTEM_ACTOR_ID;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // ---- the real HTTP path, wired before any row is seeded -----------------
  // R0-20b: WebhooksController builds its (stubbed) Stripe SDK client from
  // STRIPE_SECRET_KEY when it is constructed; the key is set for the compile only.
  const previousStripeKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = `sk_test_${P}stub`;
  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, PaymentsController, WebhooksController],
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
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      ExpensePostingService,
      InvoiceReceiptBuilderService,
      InvoiceReceiptListener,
      PaymentsService,
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: crmRecorder },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: gmailRecorder },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
      // R0-20b: the legacy Stripe route's other collaborator (its business webhook CRUD is not exercised here).
      { provide: WebhookDispatcherService, useValue: {} },
    ],
  }).compile();
  if (previousStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = previousStripeKey;

  // rawBody: the Stripe routes verify the exact bytes Stripe signed (as main.ts serves them).
  app = moduleRef.createNestApplication({ rawBody: true });
  // Identity attachment only (§2.3). No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-rva-user'];
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

  commerce = app.get(CommerceService);
  workflow = app.get(InvoiceWorkflowService);
  receiptListener = app.get(InvoiceReceiptListener);

  await cleanup(); // in case a prior run aborted
  await clearAllPublicRateLimits();

  // ---- identities ---------------------------------------------------------
  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.adminA, 'USER'], [ID.staffWriteA, 'USER'], [ID.staffReadA, 'USER'],
    [ID.staffNoneA, 'USER'], [ID.staffDefaultA, 'USER'], [ID.noMember, 'USER'], [ID.ownerB, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role } });
  }

  // ---- tenants (A on ACCRUAL so the AR posting at SENT is observable) ------
  // Business A carries the public profile the storefront already serves
  // (RCR-02) plus the fields no public route serves: a template choice and
  // bank details under metaData, the latter with a canary.
  await db.business.create({
    data: {
      id: ID.bizA, name: 'RVA Biz A', ownerId: ID.ownerA, accountingBasis: 'ACCRUAL', currency: 'TTD',
      address: '1 Harbour Street', city: 'Port of Spain', country: 'TT', website: 'https://rva.example',
      secondaryColor: '#123456', facebook: 'rva.fb', instagram: 'rva.ig', twitter: 'rva.tw', whatsapp: '+18680000000',
      invoiceTemplate: 'modern', metaData: { bankAccountNumber: `${CANARY}acct` },
    },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'RVA Biz B', ownerId: ID.ownerB, currency: 'TTD' } });

  // ---- real memberships (§2.1) --------------------------------------------
  const m = async (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: {
        id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`,
        userId: user,
        businessId: biz,
        role,
        permissionScopes: permissionScopes ?? undefined,
      },
    });
  await m(ID.ownerA, ID.bizA, 'OWNER');
  await m(ID.adminA, ID.bizA, 'ADMIN');
  await m(ID.staffWriteA, ID.bizA, 'STAFF', { revenue: 'write' });
  await m(ID.staffReadA, ID.bizA, 'STAFF', { revenue: 'read' });
  await m(ID.staffNoneA, ID.bizA, 'STAFF', { revenue: 'none', crm: 'read' });
  await m(ID.staffDefaultA, ID.bizA, 'STAFF');
  await m(ID.ownerB, ID.bizB, 'OWNER');

  // ---- contacts (Invoice.contactId is required) ---------------------------
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Rva', lastName: 'Customer', email: `${CANARY}customer@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Rva', lastName: 'CustomerB', email: 'b@test.local' } });

  // ---- invoices (§2.2) ----------------------------------------------------
  const inv = async (id: string, biz: string, contactId: string, status: string, total: number, number: string, extra: Record<string, unknown> = {}) =>
    db.invoice.create({
      data: {
        id,
        invoiceNumber: number,
        status,
        subtotal: total,
        total,
        currency: 'TTD',
        notes: 'Thank you for your business',
        businessId: biz,
        contactId,
        items: { create: [{ id: `${id}_item1`, description: `RVA item ${number}`, quantity: 1, unitPrice: total, total }] },
        ...extra,
      },
    });
  await inv(ID.invSent, ID.bizA, ID.contactA, 'DRAFT', 100, 'RVA-SENT');
  await inv(ID.invDraft, ID.bizA, ID.contactA, 'DRAFT', 50, 'RVA-DRAFT');
  await inv(ID.invPaid, ID.bizA, ID.contactA, 'PAID', 20, 'RVA-PAID', { paidAt: PAY_P1_CREATED_AT });
  await inv(ID.invVoid, ID.bizA, ID.contactA, 'VOID', 30, 'RVA-VOID');
  await inv(ID.invB, ID.bizB, ID.contactB, 'SENT', 70, 'RVA-B');

  // rva_invSent goes DRAFT -> SENT through the real workflow so its AR posting exists.
  await workflow.transition(ID.invSent, 'SENT');
  recordedEvents.length = 0;

  // ---- payments (unique providerPaymentId each; canaries on the SENT row) ---
  await db.payment.create({
    data: {
      id: ID.payS1, businessId: ID.bizA, invoiceId: ID.invSent, amount: 40, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'manual', method: 'MANUAL', providerPaymentId: `${P}pp_s1`,
      reference: `${CANARY}ref`, notes: `${CANARY}note`, evidenceUrl: `https://x/${CANARY}evidence.pdf`,
      evidenceMimeType: 'application/pdf', recordedBy: `${CANARY}recorder`, createdAt: PAY_S1_CREATED_AT,
    },
  });
  await db.payment.create({
    data: {
      id: ID.payS2, businessId: ID.bizA, invoiceId: ID.invSent, amount: 10, currency: 'TTD', status: 'PENDING',
      provider: 'bank_transfer', method: 'bank_transfer', providerPaymentId: `${P}pp_s2`, createdAt: PAY_S2_CREATED_AT,
    },
  });
  await db.payment.create({
    data: {
      id: ID.payP1, businessId: ID.bizA, invoiceId: ID.invPaid, amount: 20, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'manual', method: 'MANUAL', providerPaymentId: `${P}pp_p1`, createdAt: PAY_P1_CREATED_AT,
    },
  });

  // ---- payment links ------------------------------------------------------
  await db.paymentLink.create({ data: { id: ID.linkSent, token: ID.tokSent, invoiceId: ID.invSent, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: ID.linkExpired, token: ID.tokExpired, invoiceId: ID.invSent, businessId: ID.bizA, active: true, expiresAt: new Date('2020-01-01T00:00:00.000Z') } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearAllPublicRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

beforeEach(clearPublicInvoiceRouteRateLimit);

describe('fixture sanity (real rows)', () => {
  it('seeded the tenants, memberships, invoices, payments and the AR baseline for rva_invSent', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(6);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await invoiceStatus(ID.invSent)).toBe('SENT');
    expect(await paymentCount(ID.invSent)).toBe(2);
    const baseline = await postingsFor(ID.invSent);
    expect(baseline.map((t) => t.externalRef)).toContain(`Invoice:${ID.invSent}:invoice_finalized`);
  });
});

// ---------------------------------------------------------------------------
// List A: true negative controls — expected to FAIL on main b1948d27.
// ---------------------------------------------------------------------------
describe('List A: pre-fix failures', () => {
  describe('G1 — PAID without a payment through the path parameter', () => {
    it('RA-G1-01: status comes from the validated body, never the URL (path paid, body SENT -> 400, nothing changes)', async () => {
      const copy = await createCopy('g1_01', { status: 'SENT' });
      const ledgerBefore = await ledgerCountA();
      const res = await setStatus(ID.ownerA, copy, 'paid', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(400);
      expect(await invoiceStatus(copy)).toBe('SENT');
      // The cogs filter alone cannot fail: the copy's line has no productId, so
      // a PAID transition posts no COGS leg (invoice-workflow.service.ts
      // postCogsForPaidInvoice returns early). The ledger observation is
      // business A's FinancialTransaction count (R0-02 review SEC-R002-2).
      const cogs = (await postingsFor(copy)).filter((t) => /cogs/i.test(t.externalRef ?? ''));
      expect(cogs).toHaveLength(0);
      expect(await ledgerCountA()).toBe(ledgerBefore);
      expect(eventsFor('invoice.paid', copy)).toHaveLength(0);
    });

    it('RA-G1-02: every path value outside the DTO set is refused with 400 and the status is unchanged', async () => {
      const values = ['partially_paid', 'pending', 'failed', 'draft', 'PAID', 'Paid', 'void%20'];
      for (let i = 0; i < values.length; i += 1) {
        const copy = await createCopy(`g1_02_${i}`, { status: 'SENT' });
        const res = await setStatus(ID.ownerA, copy, values[i]!, { businessId: ID.bizA, status: 'SENT' });
        expect(res.status, `path ${values[i]}`).toBe(400);
        expect(await invoiceStatus(copy), `path ${values[i]}`).toBe('SENT');
      }
    });

    it('RA-G1-04: body and path disagree on two legal values -> 400 status mismatch; the guard still read the body businessId', async () => {
      const copy = await createCopy('g1_04', { status: 'DRAFT' });
      const res = await setStatus(ID.ownerA, copy, 'void', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/status mismatch/i);
      expect(await invoiceStatus(copy)).toBe('DRAFT');
      expect(await postingsFor(copy)).toHaveLength(0);
    });
  });

  describe('G4 — scope on the three bare-id status routes', () => {
    it('RA-G4-01: revenue:read cannot mark paid (403 Insufficient permissions; status and payment rows unchanged)', async () => {
      const copy = await createCopy('g4_01', { status: 'SENT', payments: [{ amount: 40, status: 'SUCCESSFUL' }] });
      const res = await markPaid(ID.staffReadA, copy, { businessId: ID.bizA });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Insufficient permissions/);
      expect(await invoiceStatus(copy)).toBe('SENT');
      expect(await paymentCount(copy)).toBe(1);
    });

    it('RA-G4-02: explicit revenue:none cannot mark paid', async () => {
      const copy = await createCopy('g4_02', { status: 'SENT' });
      const res = await markPaid(ID.staffNoneA, copy, { businessId: ID.bizA });
      expect(res.status).toBe(403);
      expect(await invoiceStatus(copy)).toBe('SENT');
      expect(await paymentCount(copy)).toBe(0);
    });

    it('RA-G4-03: STAFF default (read) cannot mark paid', async () => {
      const copy = await createCopy('g4_03', { status: 'SENT' });
      const res = await markPaid(ID.staffDefaultA, copy, { businessId: ID.bizA });
      expect(res.status).toBe(403);
      expect(await invoiceStatus(copy)).toBe('SENT');
      expect(await paymentCount(copy)).toBe(0);
    });

    it('RA-G4-05: revenue:read cannot mark failed (403; no invoice.payment_failed event)', async () => {
      const copy = await createCopy('g4_05', { status: 'SENT' });
      const res = await markFailed(ID.staffReadA, copy, { businessId: ID.bizA, reason: 'x' });
      expect(res.status).toBe(403);
      expect(await invoiceStatus(copy)).toBe('SENT');
      expect(eventsFor('invoice.payment_failed', copy)).toHaveLength(0);
    });

    it('RA-G4-06: revenue:read cannot send (403; no FinancialTransaction is created)', async () => {
      const copy = await createCopy('g4_06', { status: 'DRAFT' });
      const ledgerBefore = await ledgerCountA();
      const res = await setStatus(ID.staffReadA, copy, 'sent', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(403);
      expect(await invoiceStatus(copy)).toBe('DRAFT');
      expect(await postingsFor(copy)).toHaveLength(0);
      expect(await ledgerCountA()).toBe(ledgerBefore);
    });
  });

  describe('G4 — tenant from the guard is bound to the invoice', () => {
    it('RA-G4-07: a member of B marking an invoice of A paid with businessId B gets 404, not 500; nothing changes', async () => {
      const copy = await createCopy('g4_07', { status: 'SENT' });
      const res = await markPaid(ID.ownerB, copy, { businessId: ID.bizB });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Invoice not found/);
      expectNoCanary(res.body);
      expect(await invoiceStatus(copy)).toBe('SENT');
      expect(await paymentCount(copy)).toBe(0);
    });

    it('RA-G4-08: same on the status route (void with businessId B -> 404; no void posting)', async () => {
      const copy = await createCopy('g4_08', { status: 'SENT' });
      const res = await setStatus(ID.ownerB, copy, 'void', { businessId: ID.bizB, status: 'VOID' });
      expect(res.status).toBe(404);
      expectNoCanary(res.body);
      expect(await invoiceStatus(copy)).toBe('SENT');
      expect(await postingsFor(copy)).toHaveLength(0);
    });

    it('RA-G4-09: same on payment-failed (-> 404; unchanged)', async () => {
      const copy = await createCopy('g4_09', { status: 'SENT' });
      const res = await markFailed(ID.ownerB, copy, { businessId: ID.bizB });
      expect(res.status).toBe(404);
      expect(await invoiceStatus(copy)).toBe('SENT');
    });

    it('RA-G4-12: the controller forwards the guard-validated tenant to the service (real service spied)', async () => {
      const paidSpy = vi.spyOn(commerce, 'markInvoicePaid');
      const statusSpy = vi.spyOn(commerce, 'updateInvoiceStatus');
      try {
        const copy = await createCopy('g4_12', { status: 'SENT' });
        await markPaid(ID.ownerA, copy, { businessId: ID.bizA });
        expect(paidSpy).toHaveBeenCalledWith(copy, ID.ownerA, ID.bizA);
        const copy2 = await createCopy('g4_12b', { status: 'DRAFT' });
        await setStatus(ID.ownerA, copy2, 'sent', { businessId: ID.bizA, status: 'SENT' });
        expect(statusSpy).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: copy2, status: 'SENT', actorId: ID.ownerA, businessId: ID.bizA }));
      } finally {
        paidSpy.mockRestore();
        statusSpy.mockRestore();
      }
    });

    it('RA-G4-14: plain service errors become HTTP errors (unknown id -> 404, not 500)', async () => {
      const res = await markPaid(ID.ownerA, `${P}does_not_exist`, { businessId: ID.bizA });
      expect(res.status).toBe(404);
    });
  });

  describe('G5 — public disclosure', () => {
    it('RA-G5-01: the public invoice view carries no payment rows, no contact email, no private business fields, and no canary', async () => {
      const res = await publicInvoice(ID.invSent);
      expect(res.status).toBe(200);
      expect(res.body.paid).toBe(40);
      expect(res.body.remaining).toBe(60);
      expect(res.body).not.toHaveProperty('payments');
      expect(res.body).not.toHaveProperty('contactId');
      expect(res.body.contact).not.toHaveProperty('email');
      // Review RCR-02: the exclusion list is the genuinely private fields — the
      // ones no public route serves. The public profile (address, website, the
      // social handles, secondaryColor) is the storefront's and is asserted
      // present in RR-RCR2-01.
      for (const key of ['id', 'ownerId', 'invoiceTemplate', 'quoteTemplate', 'metaData', 'slug']) {
        expect(res.body.business ?? {}, `business.${key}`).not.toHaveProperty(key);
      }
      expectNoCanary(res.body);
    });

    it('RA-G5-02: PENDING rows never appear publicly and paid excludes PENDING', async () => {
      const res = await publicInvoice(ID.invSent);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('PENDING');
      expect(res.body.paid).toBe(40);
    });

    it('RA-G5-03: non-shareable statuses answer 404, not 200 null', async () => {
      for (const id of [ID.invDraft, ID.invVoid]) {
        const res = await publicInvoice(id);
        expect(res.status, id).toBe(404);
        expectNoCanary(res.body);
        expect(JSON.stringify(res.body)).not.toContain('RVA-');
      }
    });

    it('RA-G5-04: an unknown id answers 404 with a body identical to the non-shareable case', async () => {
      const unknown = await publicInvoice(`${P}nope`);
      const draft = await publicInvoice(ID.invDraft);
      expect(unknown.status).toBe(404);
      expect(stripVolatile(unknown.body)).toEqual(stripVolatile(draft.body));
    });

    it('RA-G5-05: the public status route carries exactly { status, paid, remaining, currency, lastPaymentAt } and no rows', async () => {
      await clearStatusRouteRateLimit();
      const res = await publicStatus(ID.invSent);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
      expect(res.body).toEqual({
        status: 'SENT',
        paid: 40,
        remaining: 60,
        currency: 'TTD',
        lastPaymentAt: PAY_S1_CREATED_AT.toISOString(),
      });
      for (const col of ['providerPaymentId', 'reference', 'notes', 'evidenceUrl', 'evidenceMimeType', 'recordedBy', 'amount', 'provider', 'method']) {
        expect(JSON.stringify(res.body)).not.toContain(`"${col}"`);
      }
      expectNoCanary(res.body);
    });

    describe('RA-G5-06: the public status route is rate limited at 20 per minute per IP (real guard, real Redis)', () => {
      beforeEach(clearStatusRouteRateLimit);
      afterEach(clearStatusRouteRateLimit);

      it('answers 200 twenty times and 429 on the twenty-first', async () => {
        for (let i = 1; i <= 20; i += 1) {
          const res = await publicStatus(ID.invSent);
          expect(res.status, `request ${i}`).toBe(200);
        }
        const blocked = await publicStatus(ID.invSent);
        expect(blocked.status).toBe(429);
      });
    });

    it('RA-G5-09: the cross-tenant payments route stays closed and answers 404, not 500', async () => {
      const res = withActor(agent().get(`/commerce/businesses/${ID.bizB}/invoices/${ID.invSent}/payments`), ID.ownerB);
      const out = await res;
      expect(out.status).toBe(404);
      expectNoCanary(out.body);
    });
  });

  describe('G7 — receipt tenant binding and read scope', () => {
    it('RA-G7-01: a receipt is bound to the guard tenant (member of B with businessId B reading an invoice of A -> 404, indistinguishable from an unknown id)', async () => {
      const res = await receipt(ID.ownerB, ID.invSent, ID.bizB);
      expect(res.status).toBe(404);
      for (const key of ['contact', 'items', 'business']) expect(res.body).not.toHaveProperty(key);
      expectNoCanary(res.body);
      const unknown = await receipt(ID.ownerA, `${P}nope`, ID.bizA);
      expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
    });

    it('RA-G7-04: explicit revenue:none is refused a receipt (403 Insufficient permissions)', async () => {
      const res = await receipt(ID.staffNoneA, ID.invSent, ID.bizA);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Insufficient permissions/);
      for (const key of ['contact', 'items']) expect(res.body).not.toHaveProperty(key);
      expectNoCanary(res.body);
    });
  });

  describe('G16 — guard tenant and service tenant must agree (error mapping)', () => {
    it('RA-G16-02: supplying the wrong tenant with a valid actor throws NotFoundException, not a plain Error', async () => {
      const copy = await createCopy('g16_02', { status: 'SENT' });
      await expect(commerce.markInvoicePaid(copy, ID.ownerA, ID.bizB)).rejects.toBeInstanceOf(NotFoundExceptionCtor);
      expect(await invoiceStatus(copy)).toBe('SENT');
    });

    it('RA-G16-04: the system actor without a tenant throws ForbiddenException, not a plain Error', async () => {
      const copy = await createCopy('g16_04', { status: 'SENT' });
      await expect(commerce.markInvoicePaid(copy, KEY_SYSTEM_ACTOR)).rejects.toBeInstanceOf(ForbiddenExceptionCtor);
      expect(await invoiceStatus(copy)).toBe('SENT');
    });
  });
});

// ---------------------------------------------------------------------------
// List B: regression controls — pass before and after.
// ---------------------------------------------------------------------------
describe('List B: regression controls', () => {
  describe('G1 — legal, agreeing transitions still work', () => {
    it('RA-G1-03: legal body values still work and post AR (DRAFT -> SENT creates Invoice:<copy>:invoice_finalized)', async () => {
      const copy = await createCopy('g1_03', { status: 'DRAFT' });
      const res = await setStatus(ID.ownerA, copy, 'sent', { businessId: ID.bizA, status: 'SENT', sentAt: new Date().toISOString() });
      expect(res.status).toBe(200);
      expect(await invoiceStatus(copy)).toBe('SENT');
      const postings = await postingsFor(copy);
      expect(postings.filter((t) => t.externalRef === `Invoice:${copy}:invoice_finalized`)).toHaveLength(1);
    });

    it('RA-G1-05: path and body agree on a legal value -> 200 (pins the agreement rule)', async () => {
      const copy = await createCopy('g1_05', { status: 'DRAFT' });
      const res = await setStatus(ID.ownerA, copy, 'sent', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(200);
      expect(await invoiceStatus(copy)).toBe('SENT');
    });
  });

  describe('G4 — admitted actors and guard refusals', () => {
    it('RA-G4-04: write scope may mark paid (200)', async () => {
      const copy = await createCopy('g4_04', { status: 'SENT' });
      const res = await markPaid(ID.staffWriteA, copy, { businessId: ID.bizA });
      expect(res.status).toBe(200);
      expect(await invoiceStatus(copy)).toBe('PAID');
    });

    it('RA-G4-10: a non-member is refused at the guard on all three routes (403 No access to this business)', async () => {
      const copy = await createCopy('g4_10', { status: 'SENT' });
      for (const call of [
        () => markPaid(ID.noMember, copy, { businessId: ID.bizA }),
        () => markFailed(ID.noMember, copy, { businessId: ID.bizA }),
        () => setStatus(ID.noMember, copy, 'void', { businessId: ID.bizA, status: 'VOID' }),
      ]) {
        const res = await call();
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/No access to this business/);
      }
      expect(await invoiceStatus(copy)).toBe('SENT');
    });

    it('RA-G4-11: a missing businessId is refused, not defaulted (403 businessId is required)', async () => {
      const copy = await createCopy('g4_11', { status: 'SENT' });
      const res = await markPaid(ID.ownerA, copy, {});
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/businessId is required/);
      expect(await invoiceStatus(copy)).toBe('SENT');
    });

    // Kept as a visible todo with its CONTRADICTION text (R0-02 review
    // CR-R002-1). The packet allows conversion only "per decision D-11", and
    // D-11 is not ruled on this question: the question is BUILD-MAP-001.md 910
    // ("should the service admit SUPER_ADMIN instead?"), the 2026-10-31 ruling
    // (BUILD-MAP-001.md 950, BUILD-QUEUE-001.json R0-09 "ruling") covers
    // business-profile editing only. Pinning either answer for SUPER_ADMIN here
    // would decide it. The guard half is required at L1; the service membership
    // check itself is pinned for every write route, without deciding the
    // SUPER_ADMIN question, by RR-R002-01..03 below.
    it.todo(
      'RA-G4-13: SUPER_ADMIN still passes (matrix: 200 before and after). CONTRADICTION measured on main b1948d27: ' +
        'both guards bypass SUPER_ADMIN, but CommerceService.markInvoicePaid then requires a Membership row for every ' +
        'non-system actor (service 482-489) and rva_superAdmin has none, so the request answers 500 on main and 403 after ' +
        'the error-mapping fix. Admitting SUPER_ADMIN inside the service is an authority widening outside the released ' +
        'scope of KF-REVENUE-AUTH-PROJECTION-001; the guard half is pinned at L1 (commerce-authorization.e2e.test.ts). ' +
        'AWAITING an owner ruling on the D-11 RA-G4-13 question (the 2026-10-31 D-11 ruling covers business-profile editing only).',
    );
  });

  describe('G5 — tenant routes keep their full shape', () => {
    it('RA-G5-07: the authenticated owner still gets payments on the tenant invoice list', async () => {
      const res = await withActor(agent().get(`/commerce/businesses/${ID.bizA}/invoices?pageSize=100`), ID.ownerA);
      expect(res.status).toBe(200);
      const row = (res.body.data as any[]).find((i) => i.id === ID.invSent);
      expect(row).toBeTruthy();
      expect(Array.isArray(row.payments)).toBe(true);
      expect(row.payments).toHaveLength(2);
    });

    it('RA-G5-08: the tenant payments route is unchanged (rows, paidAmount 40, remaining 60)', async () => {
      const res = await withActor(agent().get(`/commerce/businesses/${ID.bizA}/invoices/${ID.invSent}/payments`), ID.staffReadA);
      expect(res.status).toBe(200);
      expect(res.body.payments).toHaveLength(2);
      expect(res.body.paidAmount).toBe(40);
      expect(res.body.remaining).toBe(60);
    });
  });

  describe('G7 — receipt positives and guard refusals', () => {
    it('RA-G7-02: the own-tenant receipt works with the same shape as today', async () => {
      const res = await receipt(ID.ownerA, ID.invSent, ID.bizA);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['business', 'contact', 'currency', 'invoiceNumber', 'issuedAt', 'items', 'paidAt', 'status', 'total'].sort(),
      );
      expect(res.body.invoiceNumber).toBe('RVA-SENT');
    });

    it('RA-G7-03: revenue:read (explicit and STAFF default) is sufficient for a receipt', async () => {
      for (const actor of [ID.staffReadA, ID.staffDefaultA]) {
        const res = await receipt(actor, ID.invSent, ID.bizA);
        expect(res.status, actor).toBe(200);
        expect(res.body.invoiceNumber).toBe('RVA-SENT');
      }
    });

    it('RA-G7-05: an unauthenticated receipt stays closed (401)', async () => {
      const res = await receipt(null, ID.invSent);
      expect(res.status).toBe(401);
      expectNoCanary(res.body);
    });

    it('RA-G7-06: a receipt for a non-existent id is 404 and discloses nothing (RA-G7-01 pins that the cross-tenant body is identical)', async () => {
      const unknown = await receipt(ID.ownerA, `${P}nope`, ID.bizA);
      expect(unknown.status).toBe(404);
      for (const key of ['contact', 'items', 'business']) expect(unknown.body).not.toHaveProperty(key);
      expectNoCanary(unknown.body);
    });

    it('RA-G7-07: a non-member cannot read a receipt even with the right tenant id (403 No access)', async () => {
      const res = await receipt(ID.noMember, ID.invSent, ID.bizA);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/No access to this business/);
      expectNoCanary(res.body);
    });
  });

  describe('Positive controls that must keep working', () => {
    it('PC-02: the token public view is unchanged (ok:true body; expired token -> ok:false invalid_or_expired)', async () => {
      const ok = await agent().get(`/commerce/public/invoice-link/${ID.tokSent}`);
      expect(ok.status).toBe(200);
      expect(ok.body.ok).toBe(true);
      expect(ok.body.token).toBe(ID.tokSent);
      expect(Object.keys(ok.body.invoice).sort()).toEqual(
        ['business', 'contact', 'currency', 'dueDate', 'id', 'invoiceNumber', 'issueDate', 'items', 'notes', 'status', 'total'].sort(),
      );
      expect(ok.body.invoice.contact).toEqual({ firstName: 'Rva', lastName: 'Customer' });
      expectNoCanary(ok.body);

      const expired = await agent().get(`/commerce/public/invoice-link/${ID.tokExpired}`);
      expect(expired.status).toBe(200);
      expect(expired.body).toEqual({ ok: false, reason: 'invalid_or_expired' });
    });

    it('PC-03: invoice email generation is unchanged (captured HTML as today; the token pay link and totals render; status untouched)', async () => {
      // Matrix text expects "paid 40.00 and remaining 60.00" in this HTML. On
      // main the `invoice` variant of invoice-email.template.ts renders neither
      // (only `reminder` shows "Balance due" and `receipt` shows "Paid"), so the
      // paid-dependent amounts are pinned by PC-04 below; this case pins the
      // invoice variant exactly as it renders today.
      sentEmails.length = 0;
      const res = await withActor(
        agent().post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invSent}/send-email`),
        ID.ownerA,
      ).send({ recipientEmail: 'c@test.local' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expect(res.body.paymentUrl).toContain(`/public/invoice/${ID.tokSent}`);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe('c@test.local');
      expect(sentEmails[0]!.subject).toBe('Invoice #RVA-SENT from RVA Biz A');
      expect(sentEmails[0]!.htmlBody).toContain('TT$100.00');
      expect(sentEmails[0]!.htmlBody).toContain(`/public/invoice/${ID.tokSent}`);
      expect(await invoiceStatus(ID.invSent)).toBe('SENT');
    });

    it('PC-04: reminder and receipt emails are unchanged', async () => {
      sentEmails.length = 0;
      const reminder = await withActor(
        agent().post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invSent}/send-reminder`),
        ID.ownerA,
      ).send({ recipientEmail: 'c@test.local', channel: 'email' });
      expect([200, 201]).toContain(reminder.status);
      expect(reminder.body.delivered).toBe(true);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.subject).toMatch(/Reminder/);
      // "Balance due TT$60.00" exists only because getInvoiceWithBusiness still includes payments.
      expect(sentEmails[0]!.htmlBody).toContain('TT$60.00');

      sentEmails.length = 0;
      const receiptMail = await withActor(
        agent().post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invPaid}/resend-receipt`),
        ID.ownerA,
      ).send({ recipientEmail: 'c@test.local' });
      expect([200, 201]).toContain(receiptMail.status);
      expect(receiptMail.body.success).toBe(true);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.subject).toMatch(/Receipt/);
      expect(sentEmails[0]!.htmlBody).toContain('TT$20.00');
    });

    it('PC-05: the receipt listener is unchanged (calls getInvoiceWithBusiness(id, true) and sends)', async () => {
      sentEmails.length = 0;
      const spy = vi.spyOn(commerce, 'getInvoiceWithBusiness');
      try {
        await receiptListener.onInvoicePaid({ invoice: { id: ID.invPaid }, businessId: ID.bizA });
        expect(spy).toHaveBeenCalledWith(ID.invPaid, true);
      } finally {
        spy.mockRestore();
      }
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe(`${CANARY}customer@test.local`);
      expect(sentEmails[0]!.subject).toMatch(/Receipt/);
    });

    it('PC-06: the KEY commerce adapter is unchanged (returns the full shape incl. payments)', async () => {
      const adapter = new CommerceAdapterServiceCtor(commerce);
      const invoice = await adapter.getInvoice({ businessId: ID.bizA, invoiceId: ID.invSent });
      expect(invoice.id).toBe(ID.invSent);
      expect(Array.isArray(invoice.payments)).toBe(true);
      expect(invoice.payments).toHaveLength(2);
      expect(invoice.contact.email).toBe(`${CANARY}customer@test.local`);
    });

    // R0-22-PUBLIC-INTENT-HARDEN (CF-12): the intent no longer flips the
    // invoice to PENDING, which is not shareable and made the customer's own
    // pay link answer 404. Full contract: public-payment-intent.integration.test.ts.
    it('PC-08: a customer payment intent still works from a public page and leaves the invoice SENT and shareable (fresh copy; R0-22 no-status-flip contract)', async () => {
      const copy = await createCopy('pc_08', { status: 'SENT' });
      // V1-46 (D-07) retired the bare-id intent route: the customer reaches it
      // through the invoice's live pay link.
      const token = `${P}tok_pc_08`;
      await db.paymentLink.create({ data: { id: `${P}link_pc_08`, token, invoiceId: copy, businessId: ID.bizA, active: true } });
      const intentPath = `/commerce/public/invoice-link/${token}/payment-intent`;
      const res = await agent().post(intentPath).send({ method: 'bank_transfer' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expectNoCanary(res.body);
      const rows = await db.payment.findMany({ where: { invoiceId: copy } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('PENDING');
      expect(rows[0].businessId).toBe(ID.bizA);
      expect(await invoiceStatus(copy)).toBe('SENT');
      const reload = await publicInvoice(copy);
      expect(reload.status).toBe(200);
      expect(reload.body).toMatchObject({ id: copy, status: 'SENT' });
      // The same intent again is the same intent: still one PENDING row.
      const again = await agent().post(intentPath).send({ method: 'bank_transfer' });
      expect([200, 201]).toContain(again.status);
      expect(await paymentCount(copy)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// List C: post-fix acceptance — absent (not leaking) on main.
// ---------------------------------------------------------------------------
describe('List C: post-fix acceptance', () => {
  it('PC-01: the public payment page renders from the projection (every field the page reads is present) and gateways answer', async () => {
    const res = await publicInvoice(ID.invSent);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: ID.invSent,
        businessId: ID.bizA, // pickBusinessId() for the page's PresenceTracker
        invoiceNumber: 'RVA-SENT',
        status: 'SENT',
        total: 100,
        notes: 'Thank you for your business',
        currency: 'TTD',
        paid: 40,
        remaining: 60,
      }),
    );
    expect(res.body).toHaveProperty('issueDate');
    expect(res.body).toHaveProperty('dueDate');
    // The pay page also renders the invoice's own arithmetic (page.tsx 505-508).
    for (const key of ['subtotal', 'taxRate', 'taxAmount', 'discountType', 'discountValue', 'discountAmount']) {
      expect(res.body, key).toHaveProperty(key);
    }
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({ description: 'RVA item RVA-SENT', quantity: 1, unitPrice: 100, total: 100 }),
    );
    expect(res.body.items[0]).toHaveProperty('id');
    expect(res.body.contact).toEqual({ firstName: 'Rva', lastName: 'Customer' });
    // The business block is the public profile the pay page renders (RCR-02):
    // header gradient, address under the name, cash block, footer links.
    expect(Object.keys(res.body.business).sort()).toEqual([
      'address', 'city', 'country', 'email', 'facebook', 'instagram', 'logoUrl', 'name', 'phone',
      'primaryColor', 'secondaryColor', 'twitter', 'website', 'whatsapp',
    ]);
    expect(res.body.business.name).toBe('RVA Biz A');

    const gateways = await agent().get(`/payments/invoice/${ID.invSent}/gateways`);
    expect(gateways.status).toBe(200);
  });

  it('PC-07: authorised mark-paid, send and void still work through the new guard and tenant plumbing', async () => {
    for (const actor of [ID.ownerA, ID.staffWriteA]) {
      const tag = actor === ID.ownerA ? 'owner' : 'write';

      const paidCopy = await createCopy(`pc_07_paid_${tag}`, { status: 'SENT' });
      const paid = await markPaid(actor, paidCopy, { businessId: ID.bizA });
      expect(paid.status, `${tag} paid`).toBe(200);
      expect(await invoiceStatus(paidCopy)).toBe('PAID');
      expect(eventsFor('invoice.paid', paidCopy)).toHaveLength(1);

      const sendCopy = await createCopy(`pc_07_send_${tag}`, { status: 'DRAFT' });
      const sent = await setStatus(actor, sendCopy, 'sent', { businessId: ID.bizA, status: 'SENT' });
      expect(sent.status, `${tag} send`).toBe(200);
      expect(await invoiceStatus(sendCopy)).toBe('SENT');
      expect(eventsFor('invoice.sent', sendCopy)).toHaveLength(1);
      expect((await postingsFor(sendCopy)).filter((t) => t.externalRef === `Invoice:${sendCopy}:invoice_finalized`)).toHaveLength(1);

      const voidCopy = await createCopy(`pc_07_void_${tag}`, { status: 'SENT', viaWorkflow: true });
      const voided = await setStatus(actor, voidCopy, 'void', { businessId: ID.bizA, status: 'VOID' });
      expect(voided.status, `${tag} void`).toBe(200);
      expect(await invoiceStatus(voidCopy)).toBe('VOID');
      expect(eventsFor('invoice.void', voidCopy)).toHaveLength(1);
      const postings = await postingsFor(voidCopy);
      const finalized = postings.find((t) => t.externalRef === `Invoice:${voidCopy}:invoice_finalized`);
      expect(finalized?.status).toBe('REVERSED');
      expect(postings.some((t) => t.type === 'REVERSAL')).toBe(true);
    }
  });

  it('PC-09: the operator gets a receipt with paidAt after marking paid (fresh copy)', async () => {
    const copy = await createCopy('pc_09', { status: 'SENT' });
    const paid = await markPaid(ID.ownerA, copy, { businessId: ID.bizA });
    expect(paid.status).toBe(200);
    const res = await receipt(ID.ownerA, copy, ID.bizA);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAID');
    expect(res.body.paidAt).toBeTruthy();
  });

  it('PC-10: the public status route still answers the pay page poll with the five keys', async () => {
    await clearStatusRouteRateLimit();
    const res = await publicStatus(ID.invSent);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
  });
});

// =============================================================================
// Review repairs — KF-REVENUE-AUTH-PROJECTION-001 integration review of the fix
// head bd66cde0. Every RR-* case below failed at that head (the review probe
// that found it is named) and passes at the repair head; the controls that
// must keep working sit beside them.
// =============================================================================
describe('Review repairs: the guards and the handler read one tenant source (ST-1, ST-2)', () => {
  // staffReadA holds revenue:read in A and — for this block only — revenue:write
  // in B: the multi-tenant member the ST-2 probe used.
  beforeAll(async () => {
    await db.membership.create({
      data: { id: `${P}m_staffReadA_bizB`, userId: ID.staffReadA, businessId: ID.bizB, role: 'STAFF', permissionScopes: { revenue: 'write' } },
    });
  });
  afterAll(async () => {
    await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = '${P}m_staffReadA_bizB'`);
  });

  it('RR-ST1-01: a GET carrying a JSON body naming the caller\'s own tenant with another tenant in the query cannot read that tenant\'s receipt (PROBE-1)', async () => {
    const res = await withActor(agent().get(`/commerce/invoices/${ID.invSent}/receipt?businessId=${ID.bizA}`), ID.ownerB)
      .set('Content-Type', 'application/json')
      .send({ businessId: ID.bizB });
    expect(res.status).toBe(404);
    for (const key of ['contact', 'items', 'business']) expect(res.body).not.toHaveProperty(key);
    expectNoCanary(res.body);
    const unknown = await receipt(ID.ownerA, `${P}nope`, ID.bizA);
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
  });

  it('RR-ST1-02: the handler applies the guards\' precedence in the admitting direction too (body wins over query; the owner reads their own receipt)', async () => {
    const res = await withActor(agent().get(`/commerce/invoices/${ID.invSent}/receipt?businessId=${ID.bizB}`), ID.ownerA)
      .set('Content-Type', 'application/json')
      .send({ businessId: ID.bizA });
    expect(res.status).toBe(200);
    expect(res.body.invoiceNumber).toBe('RVA-SENT');
  });

  it('RR-ST2-01: revenue:read in A plus revenue:write in B cannot mark an invoice of A paid with the tenant only in the query string (PROBE-2)', async () => {
    const copy = await createCopy('rr_st2_01', { status: 'SENT' });
    const res = await withActor(agent().patch(`/commerce/invoices/${copy}/paid?businessId=${ID.bizB}`), ID.staffReadA).send({});
    expect(res.status).toBe(404);
    expect(await invoiceStatus(copy)).toBe('SENT');
    expect(await paymentCount(copy)).toBe(0);
    expect(eventsFor('invoice.paid', copy)).toHaveLength(0);
    const unknown = await markPaid(ID.ownerA, `${P}nope`, { businessId: ID.bizA });
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
  });

  it('RR-ST2-02: the same on the status route (no void, no reversal) and on payment-failed (PROBE-2b)', async () => {
    const v = await createCopy('rr_st2_02v', { status: 'SENT', viaWorkflow: true });
    const rv = await withActor(agent().patch(`/commerce/invoices/${v}/status/void?businessId=${ID.bizB}`), ID.staffReadA).send({ status: 'VOID' });
    expect(rv.status).toBe(404);
    expect(await invoiceStatus(v)).toBe('SENT');
    expect(eventsFor('invoice.void', v)).toHaveLength(0);
    expect((await postingsFor(v)).some((t) => t.type === 'REVERSAL')).toBe(false);

    const f = await createCopy('rr_st2_02f', { status: 'SENT' });
    const rf = await withActor(agent().patch(`/commerce/invoices/${f}/payment-failed?businessId=${ID.bizB}`), ID.staffReadA).send({ reason: 'x' });
    expect(rf.status).toBe(404);
    expect(await invoiceStatus(f)).toBe('SENT');
    expect(eventsFor('invoice.payment_failed', f)).toHaveLength(0);
  });

  it('RR-ST2-03: a pure non-member via the query string is stopped by the tenant binding (404), not only by the service membership check (PROBE-2c)', async () => {
    const copy = await createCopy('rr_st2_03', { status: 'SENT' });
    const res = await withActor(agent().patch(`/commerce/invoices/${copy}/paid?businessId=${ID.bizB}`), ID.ownerB).send({});
    expect(res.status).toBe(404);
    expect(await invoiceStatus(copy)).toBe('SENT');
    expect(await paymentCount(copy)).toBe(0);
  });

  it('RR-ST2-04: an admitted actor naming the tenant only in the query string is forwarded that tenant (real service spied) and the write succeeds', async () => {
    const paidSpy = vi.spyOn(commerce, 'markInvoicePaid');
    try {
      const copy = await createCopy('rr_st2_04', { status: 'SENT' });
      const res = await withActor(agent().patch(`/commerce/invoices/${copy}/paid?businessId=${ID.bizA}`), ID.ownerA).send({});
      expect(res.status).toBe(200);
      expect(paidSpy).toHaveBeenCalledWith(copy, ID.ownerA, ID.bizA);
      expect(await invoiceStatus(copy)).toBe('PAID');
    } finally {
      paidSpy.mockRestore();
    }
  });

  it('RR-ST2-05: SUPER_ADMIN, who bypasses both guards, is refused at the handler when no request field names a tenant (403 businessId is required; no service call)', async () => {
    const paidSpy = vi.spyOn(commerce, 'markInvoicePaid');
    const failedSpy = vi.spyOn(commerce, 'markInvoicePaymentFailed');
    const statusSpy = vi.spyOn(commerce, 'updateInvoiceStatus');
    try {
      const copy = await createCopy('rr_st2_05', { status: 'SENT' });
      const responses = [
        await markPaid(ID.superAdmin, copy, {}),
        await markFailed(ID.superAdmin, copy, { reason: 'x' }),
        await setStatus(ID.superAdmin, copy, 'void', { status: 'VOID' }),
        await receipt(ID.superAdmin, copy),
      ];
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/businessId is required/);
        expectNoCanary(res.body);
      }
      expect(paidSpy).not.toHaveBeenCalled();
      expect(failedSpy).not.toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
      expect(await invoiceStatus(copy)).toBe('SENT');
    } finally {
      paidSpy.mockRestore();
      failedSpy.mockRestore();
      statusSpy.mockRestore();
    }
  });
});

describe('Review repairs: the public status route hides non-shareable invoices (ST-3)', () => {
  beforeEach(clearStatusRouteRateLimit);
  afterEach(clearStatusRouteRateLimit);

  it('RR-ST3-01: DRAFT and VOID ids answer 404 with the unknown-id body; no status, number or balance leaves (PROBE-3)', async () => {
    const unknown = await publicStatus(`${P}nope`);
    expect(unknown.status).toBe(404);
    for (const id of [ID.invDraft, ID.invVoid]) {
      const res = await publicStatus(id);
      expect(res.status, id).toBe(404);
      expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
      const text = JSON.stringify(stripVolatile(res.body));
      for (const needle of ['DRAFT', 'VOID', 'remaining', 'paid', 'RVA-']) expect(text, `${id} ${needle}`).not.toContain(needle);
      expectNoCanary(res.body);
    }
  });

  it('RR-ST3-02: shareable statuses still answer the poll (SENT and PAID)', async () => {
    const sent = await publicStatus(ID.invSent);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('SENT');
    const paid = await publicStatus(ID.invPaid);
    expect(paid.status).toBe(200);
    expect(paid.body).toEqual({ status: 'PAID', paid: 20, remaining: 0, currency: 'TTD', lastPaymentAt: PAY_P1_CREATED_AT.toISOString() });
  });
});

describe('Review repairs: the public invoice route is rate limited (ST-4)', () => {
  it('RR-ST4-01: answers 200 twenty times and 429 on the twenty-first (real guard, real Redis; PROBE-5)', async () => {
    for (let i = 1; i <= 20; i += 1) {
      const res = await publicInvoice(ID.invSent);
      expect(res.status, `request ${i}`).toBe(200);
    }
    const blocked = await publicInvoice(ID.invSent);
    expect(blocked.status).toBe(429);
    expectNoCanary(blocked.body);
    const keys: string[] = await redis.keys(PUBLIC_INVOICE_ROUTE_KEY_PATTERN);
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe('Review repairs: operators keep the full invoice shape on GET /commerce/invoices/:id (RCR-01)', () => {
  it('RR-RCR1-01: the owner, an admin, a revenue:read member, a STAFF default and SUPER_ADMIN get payments, contact.email and contactId (what the detail and edit pages read)', async () => {
    for (const actor of [ID.ownerA, ID.adminA, ID.staffReadA, ID.staffDefaultA, ID.superAdmin]) {
      const res = await withActor(publicInvoice(ID.invSent), actor);
      expect(res.status, actor).toBe(200);
      expect(res.body.contactId, actor).toBe(ID.contactA);
      expect(res.body.contact?.email, actor).toBe(`${CANARY}customer@test.local`);
      expect(res.body.payments?.map((p: { id: string }) => p.id).sort(), actor).toEqual([ID.payS1, ID.payS2].sort());
      expect(res.body.business?.invoiceTemplate, actor).toBe('modern');
      // paidAmount exactly as the detail page computes it (SUCCESSFUL rows only).
      const paid = res.body.payments
        .filter((p: { status: string }) => p.status === 'SUCCESSFUL')
        .reduce((s: number, p: { amount: number }) => s + p.amount, 0);
      expect(paid, actor).toBe(40);
    }
  });

  it('RR-RCR1-02: a revenue:none member, a member of another tenant, a non-member and an anonymous caller get the projection', async () => {
    for (const actor of [ID.staffNoneA, ID.ownerB, ID.noMember, null]) {
      const res = await withActor(publicInvoice(ID.invSent), actor);
      expect(res.status, String(actor)).toBe(200);
      for (const key of ['payments', 'contactId']) expect(res.body, `${actor} ${key}`).not.toHaveProperty(key);
      expect(res.body.contact, String(actor)).toEqual({ firstName: 'Rva', lastName: 'Customer' });
      expect(res.body.business, String(actor)).not.toHaveProperty('invoiceTemplate');
      expect(res.body.paid, String(actor)).toBe(40);
      expectNoCanary(res.body);
    }
  });

  it('RR-RCR1-03: the shareable gate is unchanged for the operator — DRAFT and VOID answer 404 as on main b1948d27 (not widened by this packet)', async () => {
    for (const id of [ID.invDraft, ID.invVoid]) {
      const res = await withActor(publicInvoice(id), ID.ownerA);
      expect(res.status, id).toBe(404);
    }
  });
});

describe('Review repairs: the projection carries the public business profile (RCR-02)', () => {
  it('RR-RCR2-01: address, city, country, website, secondaryColor and the social handles are served; the template choice and bank details are not', async () => {
    const res = await publicInvoice(ID.invSent);
    expect(res.status).toBe(200);
    expect(res.body.business).toEqual(
      expect.objectContaining({
        name: 'RVA Biz A',
        address: '1 Harbour Street',
        city: 'Port of Spain',
        country: 'TT',
        website: 'https://rva.example',
        secondaryColor: '#123456',
        facebook: 'rva.fb',
        instagram: 'rva.ig',
        twitter: 'rva.tw',
        whatsapp: '+18680000000',
      }),
    );
    for (const key of ['invoiceTemplate', 'quoteTemplate', 'metaData', 'id', 'ownerId']) expect(res.body.business).not.toHaveProperty(key);
    expectNoCanary(res.body);
  });
});

// =============================================================================
// V1-46b-TOKEN-PAY-COMPLETE (M34; D-07, ruled 2026-10-31 by the owner: token
// links only, the bare-id pay page is retired). No pin above changed: the
// anonymous bare-id cases (RA-G5-01..06, PC-01, PC-10, RR-ST3-*, RR-ST4-01,
// RR-RCR1-02, RR-RCR2-01) read rva_invSent, which has a live link (tokSent)
// beside its expired one, or invoices with no own-tenant link at all (invPaid,
// the DRAFT and VOID fixtures, unknown ids), and the new contract still
// answers those exactly as before. What it adds is the case none of them
// covered: an invoice whose every link is revoked or expired is closed on the
// bare-id public routes, so the id alone no longer outlives the link.
// =============================================================================
describe('V1-46b: the anonymous bare-id branch closes behind revoked links (D-07)', () => {
  it('RA-V46B-01: an invoice whose only link was deactivated, or whose links have all expired, answers the unknown-id 404 on the public view, the status poll and the gateway list; the owner still reads the full shape', async () => {
    await clearStatusRouteRateLimit();
    const unknownView = await publicInvoice(`${P}nope_v46b`);
    const unknownStatus = await publicStatus(`${P}nope_v46b`);
    const unknownGateways = await agent().get(`/payments/invoice/${P}nope_v46b/gateways`);
    for (const res of [unknownView, unknownStatus, unknownGateways]) expect(res.status).toBe(404);

    for (const [tag, link] of [
      ['v46b_revoked', { active: false }],
      ['v46b_expired', { active: true, expiresAt: new Date('2020-01-01T00:00:00.000Z') }],
    ] as const) {
      const copy = await createCopy(tag, { status: 'SENT' });
      // Open while it has no link (the KF-REVENUE-AUTH-PROJECTION-001 answer, unchanged).
      expect((await publicInvoice(copy)).status, `${tag}: no link yet`).toBe(200);
      await db.paymentLink.create({ data: { id: `${P}link_${tag}`, token: `${P}tok_${tag}`, invoiceId: copy, businessId: ID.bizA, ...link } });

      const view = await publicInvoice(copy);
      expect(view.status, `${tag}: view`).toBe(404);
      expect(stripVolatile(view.body), `${tag}: view body`).toEqual(stripVolatile(unknownView.body));
      const status = await publicStatus(copy);
      expect(status.status, `${tag}: status`).toBe(404);
      expect(stripVolatile(status.body), `${tag}: status body`).toEqual(stripVolatile(unknownStatus.body));
      const gateways = await agent().get(`/payments/invoice/${copy}/gateways`);
      expect(gateways.status, `${tag}: gateways`).toBe(404);
      expect(stripVolatile(gateways.body), `${tag}: gateways body`).toEqual(stripVolatile(unknownGateways.body));

      // The operator (revenue:read on the invoice's tenant) is unchanged.
      const asOwner = await withActor(agent().get(`/commerce/invoices/${copy}`), ID.ownerA);
      expect(asOwner.status, `${tag}: owner`).toBe(200);
      expect(Array.isArray(asOwner.body.payments), `${tag}: owner shape`).toBe(true);
      expect(await invoiceStatus(copy)).toBe('SENT');
    }
  });
});

// =============================================================================
// Review repairs — R0-02-REV-AUTH-CONFORM review of 108fc253.
// =============================================================================
describe('Review repairs (R0-02): the service membership check holds on all three bare-id write routes (SEC-R002-1, SEC-R002-2)', () => {
  // SUPER_ADMIN bypasses BusinessGuard and ModuleScopeGuard on mark-paid,
  // payment-failed and the status route (L1 'RA-G4-13 (L1 guard half)'), so
  // over HTTP the service's membership check is that role's only barrier, and
  // at 108fc253 no required case failed when the payment-failed and status
  // checks were removed. Whether the service should admit SUPER_ADMIN is the
  // unruled D-11 RA-G4-13 question (see the RA-G4-13 it.todo), so these cases
  // pin the check itself without answering it: the real service is called
  // with a real USER who holds no membership in A (rva_noMember) and the
  // invoice's own tenant, the arguments the controller forwards (RA-G4-12),
  // and must refuse before anything is written. The owner's identical call
  // then succeeds on the same copy, so the refusal is the membership check's
  // and each ledger observation is shown to see the write it guards.
  it('RR-R002-01 (SEC-R002-1, SEC-R002-2): markInvoicePaid refuses an actor with no membership in the invoice\'s tenant even when handed that tenant (ForbiddenException Not authorized to update this invoice): no payment, no invoice.paid, business A\'s ledger unchanged; the owner\'s identical call then records the payment and its Payment:<id>:payment_recorded posting', async () => {
    const copy = await createCopy('rr_r002_01', { status: 'SENT' });
    const ledgerBefore = await ledgerCountA();
    const err = await rejectionOf(commerce.markInvoicePaid(copy, ID.noMember, ID.bizA));
    expect(err).toBeInstanceOf(ForbiddenExceptionCtor);
    expect((err as Error).message).toMatch(/Not authorized to update this invoice/);
    expect(await invoiceStatus(copy)).toBe('SENT');
    expect(await paymentCount(copy)).toBe(0);
    expect(await postingsFor(copy)).toHaveLength(0);
    expect(await ledgerCountA()).toBe(ledgerBefore);
    expect(eventsFor('invoice.paid', copy)).toHaveLength(0);

    await commerce.markInvoicePaid(copy, ID.ownerA, ID.bizA);
    expect(await invoiceStatus(copy)).toBe('PAID');
    const payments: Array<{ id: string }> = await db.payment.findMany({ where: { invoiceId: copy }, select: { id: true } });
    expect(payments).toHaveLength(1);
    expect((await paymentPostingsFor(copy)).map((t) => t.externalRef)).toContain(`Payment:${payments[0]!.id}:payment_recorded`);
    // postingsFor() alone cannot see that write; the business-wide count does.
    expect(await ledgerCountA()).toBeGreaterThan(ledgerBefore);
    expect(eventsFor('invoice.paid', copy)).toHaveLength(1);
  });

  it('RR-R002-02 (SEC-R002-1): markInvoicePaymentFailed refuses the same actor with the same tenant (ForbiddenException Not authorized to update this invoice; status SENT, no invoice.payment_failed, business A\'s ledger unchanged); the owner\'s identical call moves the invoice to FAILED', async () => {
    const copy = await createCopy('rr_r002_02', { status: 'SENT' });
    const ledgerBefore = await ledgerCountA();
    const err = await rejectionOf(commerce.markInvoicePaymentFailed(copy, ID.noMember, 'x', ID.bizA));
    expect(err).toBeInstanceOf(ForbiddenExceptionCtor);
    expect((err as Error).message).toMatch(/Not authorized to update this invoice/);
    expect(await invoiceStatus(copy)).toBe('SENT');
    expect(eventsFor('invoice.payment_failed', copy)).toHaveLength(0);
    expect(await ledgerCountA()).toBe(ledgerBefore);

    await commerce.markInvoicePaymentFailed(copy, ID.ownerA, 'x', ID.bizA);
    expect(await invoiceStatus(copy)).toBe('FAILED');
    expect(eventsFor('invoice.payment_failed', copy)).toHaveLength(1);
  });

  it('RR-R002-03 (SEC-R002-1, SEC-R002-2): updateInvoiceStatus refuses the same actor with the same tenant on void and on send (ForbiddenException Not authorized to update this invoice; no void, no REVERSAL, no AR posting, business A\'s ledger unchanged); the owner\'s identical calls void with the REVERSAL and send with the Invoice:<copy>:invoice_finalized posting', async () => {
    const voidCopy = await createCopy('rr_r002_03v', { status: 'SENT', viaWorkflow: true });
    const sendCopy = await createCopy('rr_r002_03s', { status: 'DRAFT' });
    const ledgerBefore = await ledgerCountA();
    for (const [copy, status] of [[voidCopy, 'VOID'], [sendCopy, 'SENT']] as const) {
      const err = await rejectionOf(commerce.updateInvoiceStatus({ invoiceId: copy, status, actorId: ID.noMember, businessId: ID.bizA }));
      expect(err, status).toBeInstanceOf(ForbiddenExceptionCtor);
      expect((err as Error).message, status).toMatch(/Not authorized to update this invoice/);
    }
    expect(await invoiceStatus(voidCopy)).toBe('SENT');
    expect(await invoiceStatus(sendCopy)).toBe('DRAFT');
    expect(eventsFor('invoice.void', voidCopy)).toHaveLength(0);
    expect(eventsFor('invoice.sent', sendCopy)).toHaveLength(0);
    const voidPostings = await postingsFor(voidCopy);
    expect(voidPostings.find((t) => t.externalRef === `Invoice:${voidCopy}:invoice_finalized`)?.status).not.toBe('REVERSED');
    expect(voidPostings.some((t) => t.type === 'REVERSAL')).toBe(false);
    expect(await postingsFor(sendCopy)).toHaveLength(0);
    expect(await ledgerCountA()).toBe(ledgerBefore);

    await commerce.updateInvoiceStatus({ invoiceId: voidCopy, status: 'VOID', actorId: ID.ownerA, businessId: ID.bizA });
    expect(await invoiceStatus(voidCopy)).toBe('VOID');
    expect((await postingsFor(voidCopy)).some((t) => t.type === 'REVERSAL')).toBe(true);
    await commerce.updateInvoiceStatus({ invoiceId: sendCopy, status: 'SENT', actorId: ID.ownerA, businessId: ID.bizA });
    expect(await invoiceStatus(sendCopy)).toBe('SENT');
    expect((await postingsFor(sendCopy)).filter((t) => t.externalRef === `Invoice:${sendCopy}:invoice_finalized`)).toHaveLength(1);
    expect(await ledgerCountA()).toBeGreaterThan(ledgerBefore);
  });
});

describe('Review repairs (R0-02): invoice write responses and the linked booking (SEC-R002-3)', () => {
  // R0-SEC3-INVOICE-WRITE-PROJECTION closes the deferral R0-02 recorded here.
  // markInvoicePaid reloads the invoice with `booking: true`
  // (commerce.service.ts reload), and InvoiceWorkflowService.transition, behind
  // payment-failed, the status route and PATCH {status}, updates with the same
  // include, so the write routes handed a revenue:write member the whole
  // linked Booking row: notes, location, calendarEventId, staffId, orgUnitId.
  // rva_staffWriteA's scope map is explicit ({ revenue: 'write' }), so its
  // bookings scope is the absent-key default 'none' (EXPLICIT_MAP_MISSING_KEY);
  // and the operator invoice read (OPERATOR_INVOICE_INCLUDE) carries no booking
  // at all. toInvoiceWriteResponse now drops the relation on every write route,
  // so the write answers what the read discloses. The service return is
  // unchanged: the invoice listeners still receive the booking.
  const BOOKING_CANARY = 'RVA_BKG_';
  const BKG = {
    service: `${P}svc_bkg`,
    staff: `${P}staff_bkg`,
    orgUnit: `${P}ou_bkg`,
  };

  beforeAll(async () => {
    await db.service.create({ data: { id: BKG.service, businessId: ID.bizA, name: 'RVA consultation', duration: 60, price: 100 } });
    await db.staffMember.create({ data: { id: BKG.staff, businessId: ID.bizA, name: `${BOOKING_CANARY}stylist`, hourlyRate: 55 } });
    await db.orgUnit.create({ data: { id: BKG.orgUnit, businessId: ID.bizA, name: `${BOOKING_CANARY}branch`, type: 'BRANCH' } });
  });

  /** A booking linked to the invoice copy; every value a write must not leak is returned. */
  async function linkBooking(invoiceId: string, tag: string): Promise<{ id: string; secrets: string[] }> {
    const id = `${P}bkg_${tag}`;
    const values = {
      notes: `${BOOKING_CANARY}notes ${tag}: gate code 4411`,
      location: `${BOOKING_CANARY}location ${tag}: 7 Private Lane`,
      calendarEventId: `${BOOKING_CANARY}cal_${tag}`,
    };
    await db.booking.create({
      data: {
        id,
        businessId: ID.bizA,
        contactId: ID.contactA,
        serviceId: BKG.service,
        staffId: BKG.staff,
        orgUnitId: BKG.orgUnit,
        invoiceId,
        status: 'CONFIRMED',
        startTime: new Date('2026-03-02T14:00:00.000Z'),
        endTime: new Date('2026-03-02T15:00:00.000Z'),
        ...values,
      },
    });
    return { id, secrets: [id, BKG.staff, BKG.orgUnit, BOOKING_CANARY, ...Object.values(values)] };
  }

  function patchInvoice(actor: string, invoiceId: string, body: Record<string, unknown>) {
    return withActor(agent().patch(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}`), actor).send(body);
  }

  it('RR-R002-04 (SEC-R002-3): every invoice write route (mark-paid, payment-failed, the status route on void and send, PATCH {status:"PAID"}, PATCH {status:"VOID"} and a PATCH edit) answers a revenue:write member with no bookings scope without the linked Booking row (no notes, location, calendarEventId, staffId or orgUnitId), as the operator invoice read does; the write lands and the booking row is unchanged', async () => {
    const actor = ID.staffWriteA;
    const routes: Array<{ label: string; status: 'SENT' | 'DRAFT'; viaWorkflow?: boolean; call: (copy: string) => request.Test; expect: string }> = [
      { label: 'mark-paid', status: 'SENT', call: (c) => markPaid(actor, c, { businessId: ID.bizA }), expect: 'PAID' },
      { label: 'payment-failed', status: 'SENT', call: (c) => markFailed(actor, c, { businessId: ID.bizA, reason: 'x' }), expect: 'FAILED' },
      { label: 'status route VOID', status: 'SENT', viaWorkflow: true, call: (c) => setStatus(actor, c, 'void', { businessId: ID.bizA, status: 'VOID' }), expect: 'VOID' },
      { label: 'status route SENT', status: 'DRAFT', call: (c) => setStatus(actor, c, 'sent', { businessId: ID.bizA, status: 'SENT' }), expect: 'SENT' },
      { label: 'PATCH status PAID', status: 'SENT', call: (c) => patchInvoice(actor, c, { status: 'PAID' }), expect: 'PAID' },
      { label: 'PATCH status VOID', status: 'SENT', viaWorkflow: true, call: (c) => patchInvoice(actor, c, { status: 'VOID' }), expect: 'VOID' },
      { label: 'PATCH edit', status: 'SENT', call: (c) => patchInvoice(actor, c, { notes: 'RVA edited' }), expect: 'SENT' },
    ];

    const leaking: string[] = [];
    for (const [i, route] of routes.entries()) {
      const copy = await createCopy(`rr_r002_04_${i}`, { status: route.status, viaWorkflow: route.viaWorkflow });
      const booking = await linkBooking(copy, `r002_04_${i}`);

      const res = await route.call(copy);
      expect(res.status, `${route.label}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.id, route.label).toBe(copy);
      expect(res.body.status, route.label).toBe(route.expect);
      expect(await invoiceStatus(copy), route.label).toBe(route.expect);
      // The SEC-CMF1-2 contact projection is unchanged beside the booking drop.
      expect(Object.keys(res.body.contact ?? {}).sort(), route.label).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);

      const text = JSON.stringify(res.body);
      const leaked = Object.prototype.hasOwnProperty.call(res.body, 'booking') || booking.secrets.some((s) => text.includes(s));
      if (leaked) leaking.push(route.label);

      // Only the HTTP body changes: the booking is still linked to the invoice.
      const row = await db.booking.findUnique({ where: { id: booking.id }, select: { invoiceId: true, notes: true, staffId: true, orgUnitId: true } });
      expect(row, route.label).toMatchObject({ invoiceId: copy, staffId: BKG.staff, orgUnitId: BKG.orgUnit });
      expect(row?.notes, route.label).toContain(BOOKING_CANARY);

      // The reference: the operator invoice read of the same copy by the same member.
      const read = await withActor(agent().get(`/commerce/businesses/${ID.bizA}/invoices/${copy}`), actor);
      expect(read.status, `${route.label}: operator read`).toBe(200);
      expect(read.body, `${route.label}: operator read`).not.toHaveProperty('booking');
      expect(booking.secrets.filter((s) => JSON.stringify(read.body).includes(s)), `${route.label}: operator read`).toEqual([]);
    }
    // Every write route answers what the read discloses: no route leaks.
    expect(leaking, `write routes answering with the linked Booking row: ${leaking.join(', ')}`).toEqual([]);
  });
});

describe('Review repairs (R0-SEC3): the record-payment route projects the invoice contact (SEC3-ST-1)', () => {
  // R0-SEC3 review SEC3-ST-1 (the SEC-CMF1-2 class, on the one invoice write
  // route of this controller that did not answer through
  // toInvoiceWriteResponse): CommerceService.recordPayment reloads the invoice
  // with `contact: true` (and its keyed replay with the same include), and
  // POST .../payments handed the reload back, so a revenue:write member with
  // no CRM scope received the whole Contact row (notesInternal, phone, ownerId,
  // visibility). The route now answers the invoice through
  // toInvoiceWriteResponse; the service return, which KEY and the evidence
  // flow read, is unchanged.
  const PRIV_CANARY = 'RVA_PRIV_';
  const PRIV = {
    contact: `${P}contactPriv`,
    notesInternal: `${PRIV_CANARY}notes internal`,
    phone: '+18685550199',
  };

  beforeAll(async () => {
    await db.contact.create({
      data: {
        id: PRIV.contact,
        businessId: ID.bizA,
        firstName: 'Rva',
        lastName: 'Private',
        email: 'rva.private@test.local',
        phone: PRIV.phone,
        notesInternal: PRIV.notesInternal,
        ownerId: ID.ownerA,
        visibility: 'PRIVATE',
      },
    });
  });

  function recordPayment(actor: string, invoiceId: string, body: Record<string, unknown>) {
    return withActor(agent().post(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}/payments`), actor).send(body);
  }

  it('RR-SEC3-01 (SEC3-ST-1): POST /commerce/businesses/:businessId/invoices/:invoiceId/payments answers a revenue:write member with no CRM scope with the invoice contact projected to id, businessId, email, firstName and lastName (no notesInternal, phone, ownerId or visibility) and no booking, on the fresh record and on its keyed replay, as the operator invoice read discloses; the payment lands once and the contact row is unchanged', async () => {
    const actor = ID.staffWriteA;
    const copy = await createCopy('rr_sec3_01', { status: 'SENT' });
    await db.invoice.update({ where: { id: copy }, data: { contactId: PRIV.contact } });
    const secrets = [PRIV.notesInternal, PRIV_CANARY, PRIV.phone];
    const body = { amount: 40, method: 'CASH', idempotencyKey: 'rr-sec3-01' };

    const fresh = await recordPayment(actor, copy, body);
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.payment).toMatchObject({ invoiceId: copy, status: 'SUCCESSFUL' });
    expect(Number(fresh.body.payment.amount)).toBe(40);
    expect(fresh.body.paidAmount).toBe(40);
    expect(fresh.body.remaining).toBe(60);
    expect(fresh.body.invoice).toMatchObject({ id: copy, businessId: ID.bizA, contactId: PRIV.contact, status: 'PARTIALLY_PAID' });
    expect(Array.isArray(fresh.body.invoice.payments)).toBe(true);
    expect(Array.isArray(fresh.body.invoice.items)).toBe(true);
    expect(Object.keys(fresh.body.invoice.contact ?? {}).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    expect(fresh.body.invoice.contact).toEqual({
      id: PRIV.contact, businessId: ID.bizA, email: 'rva.private@test.local', firstName: 'Rva', lastName: 'Private',
    });
    expect(fresh.body.invoice).not.toHaveProperty('booking');
    expect(secrets.filter((s) => JSON.stringify(fresh.body).includes(s)), 'fresh record').toEqual([]);
    expect(await paymentCount(copy)).toBe(1);

    // The keyed replay (replayRecordedPayment, the same include) answers the same projection and writes nothing.
    const replay = await recordPayment(actor, copy, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.payment.id).toBe(fresh.body.payment.id);
    expect(Object.keys(replay.body.invoice.contact ?? {}).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    expect(replay.body.invoice).not.toHaveProperty('booking');
    expect(secrets.filter((s) => JSON.stringify(replay.body).includes(s)), 'keyed replay').toEqual([]);
    expect(await paymentCount(copy)).toBe(1);

    // Only the HTTP body changes: the contact row keeps its private fields.
    const row = await db.contact.findUnique({
      where: { id: PRIV.contact },
      select: { notesInternal: true, phone: true, ownerId: true, visibility: true },
    });
    expect(row).toEqual({ notesInternal: PRIV.notesInternal, phone: PRIV.phone, ownerId: ID.ownerA, visibility: 'PRIVATE' });

    // The reference: the operator invoice read of the same copy by the same member.
    const read = await withActor(agent().get(`/commerce/businesses/${ID.bizA}/invoices/${copy}`), actor);
    expect(read.status, 'operator read').toBe(200);
    expect(Object.keys(read.body.contact ?? {}).sort(), 'operator read').toEqual(['email', 'firstName', 'lastName']);
    expect(secrets.filter((s) => JSON.stringify(read.body).includes(s)), 'operator read').toEqual([]);
  });

  // W7-KEY-MARK-PAID-PROJECTION (R0-SEC3 review SEC3-ST-2): the same
  // disclosure through KEY. FlowOrchestratorService.executeToolAction, the
  // dispatcher every KEY surface reaches (member chat, plans, monitors, the
  // staff bridge), runs commerce_mark_invoice_paid as
  // CommerceService.markInvoicePaid(invoiceId, KEY, businessId), whose reload
  // includes `booking: true` and `contact: true` (the invoice listeners need
  // both). executeTool wraps that answer (wrapToolResult) and hands it to the
  // model, to the chat HTTP client, into the FlowSession and to the execution
  // log GET ai/execution-logs serves every member. The tool answers the write
  // projection PATCH .../paid answers since R0-SEC3 (toInvoiceWriteResponse):
  // no booking, the contact's id, businessId, email, firstName and lastName.
  // Real CommerceService, InvoiceWorkflowService, RevenuePostingService and
  // PostingService (the app's); the dispatcher is the real prototype method
  // (as test/key-dispatcher-tenant.integration.test.ts composes it) with the
  // collaborators off the path recorded: the execution log keeps the
  // envelope it was handed, no row is written.
  //
  // What the case does not prove (W7-KEY-MARK-PAID-PROJECTION review
  // SEC-W7KMP-1, SEC-W7KMP-2), proved since W8-KEY-REVENUE-GATE (owner ruling
  // D-98) by W7KMP-01 and W7KMP-02 in
  // test/key-dispatcher-tenant.integration.test.ts and payments-actor PA-16i
  // and PA-16s:
  // - the member's { revenue: 'write' } is PATCH .../paid's precondition,
  //   mirrored so the two answers compare like for like; the KEY path now
  //   checks it on member chat too (D-98), so a revenue:read or revenue:none
  //   member is refused there as the route refuses them;
  // - markInvoicePaid now takes initiatedBy, so this tool's payment entries
  //   keep the member beside KEY, as commerce_update_invoice {status: 'PAID'}
  //   does (SEC-W7IAR-2, D-90).
  describe('W7-KEY-MARK-PAID-PROJECTION: the KEY tool answers the write projection (SEC3-ST-2)', () => {
    let keyDispatcher: any;
    const loggedEnvelopes: any[] = [];

    beforeAll(async () => {
      const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
      const { CommerceService } = await import('../src/modules/commerce/commerce.service');
      const { PrismaService } = await import('../src/core/prisma/prisma.service');
      keyDispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
        prisma: app.get(PrismaService),
        moduleRef: { get: (token: unknown) => (token === CommerceService ? commerce : undefined) },
        governance: { getToolTier: () => 3 },
        executionLog: {
          logToolExecution: async (_businessId: string, _tool: string, _args: unknown, envelope: unknown) => {
            loggedEnvelopes.push(envelope);
            return undefined;
          },
        },
        businessGraph: { invalidateCache: () => undefined },
        logger: { error: () => undefined, warn: () => undefined, log: () => undefined },
      });
    }, 180_000);

    it('RR-SEC3-02 (SEC3-ST-2): the KEY tool commerce_mark_invoice_paid answers a revenue:write member with no bookings or CRM scope with the invoice write projection PATCH /commerce/invoices/:invoiceId/paid answers (no linked Booking row; the contact projected to id, businessId, email, firstName and lastName, no notesInternal, phone, ownerId or visibility), in the tool result and in the envelope the execution log keeps; the invoice is PAID with one payment and the booking and contact rows are unchanged', async () => {
      // rva_staffWriteA's scope map is explicit ({ revenue: 'write' }), so bookings and crm are the absent-key default none.
      const actor = ID.staffWriteA;
      const service = `${P}svc_sec3_02`;
      await db.service.create({ data: { id: service, businessId: ID.bizA, name: 'RVA sec3-02 consultation', duration: 30, price: 100 } });
      const BOOKING = {
        notes: `${PRIV_CANARY}booking notes: gate code 7720`,
        location: `${PRIV_CANARY}booking location: 9 Private Lane`,
        calendarEventId: `${PRIV_CANARY}cal_sec3_02`,
      };
      /** A SENT copy on the PRIVATE contact with a linked booking; returns the copy and its booking id. */
      const privateCopy = async (tag: string) => {
        const copy = await createCopy(`rr_sec3_02_${tag}`, { status: 'SENT' });
        await db.invoice.update({ where: { id: copy }, data: { contactId: PRIV.contact } });
        const booking = `${P}bkg_sec3_02_${tag}`;
        await db.booking.create({
          data: {
            id: booking, businessId: ID.bizA, contactId: PRIV.contact, serviceId: service, invoiceId: copy, status: 'CONFIRMED',
            startTime: new Date('2026-03-03T14:00:00.000Z'), endTime: new Date('2026-03-03T14:30:00.000Z'), ...BOOKING,
          },
        });
        return { copy, booking };
      };
      const secrets = [PRIV_CANARY, PRIV.notesInternal, PRIV.phone, ...Object.values(BOOKING)];
      const CONTACT = { id: PRIV.contact, businessId: ID.bizA, email: 'rva.private@test.local', firstName: 'Rva', lastName: 'Private' };

      // The reference: PATCH .../paid by the same member on a copy shaped the same way.
      const viaHttp = await privateCopy('http');
      const http = await markPaid(actor, viaHttp.copy, { businessId: ID.bizA });
      expect(http.status, JSON.stringify(http.body)).toBe(200);
      expect(http.body).toMatchObject({ id: viaHttp.copy, status: 'PAID' });
      expect(http.body).not.toHaveProperty('booking');
      expect(http.body.contact).toEqual(CONTACT);

      // The KEY tool, through executeTool (the envelope the chat path, the FlowSession and the execution log receive).
      const viaKey = await privateCopy('key');
      loggedEnvelopes.length = 0;
      const out = await keyDispatcher.executeToolDirectly(ID.bizA, 'commerce_mark_invoice_paid', { invoiceId: viaKey.copy }, undefined, {
        surface: 'CHAT',
        principalUserId: actor,
      });
      expect(out.id).toBe(viaKey.copy);
      expect(out.invoice).toMatchObject({ id: viaKey.copy, businessId: ID.bizA, contactId: PRIV.contact, status: 'PAID' });
      expect(Array.isArray(out.invoice.items)).toBe(true);
      expect(out.invoice).not.toHaveProperty('booking');
      expect(Object.keys(out.invoice.contact ?? {}).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
      expect(out.invoice.contact).toEqual(CONTACT);
      // The same projection as the HTTP write: the same invoice keys and the same contact.
      expect(Object.keys(JSON.parse(JSON.stringify(out.invoice))).sort()).toEqual(Object.keys(http.body).sort());
      expect(out.invoice.contact).toEqual(http.body.contact);
      expect(secrets.filter((s) => JSON.stringify(out).includes(s)), 'KEY tool result').toEqual([]);
      // The execution log row is written from the same envelope: nothing private there either.
      expect(loggedEnvelopes).toHaveLength(1);
      expect(loggedEnvelopes[0].result).toBe(out);
      expect(secrets.filter((s) => JSON.stringify(loggedEnvelopes).includes(s)), 'execution log envelope').toEqual([]);

      // The write landed once, and only the answer changed: the booking and contact rows keep their fields.
      expect(await invoiceStatus(viaKey.copy)).toBe('PAID');
      expect(await paymentCount(viaKey.copy)).toBe(1);
      expect(await db.booking.findUnique({ where: { id: viaKey.booking }, select: { invoiceId: true, notes: true, location: true, calendarEventId: true } }))
        .toEqual({ invoiceId: viaKey.copy, ...BOOKING });
      expect(await db.contact.findUnique({ where: { id: PRIV.contact }, select: { notesInternal: true, phone: true, ownerId: true, visibility: true } }))
        .toEqual({ notesInternal: PRIV.notesInternal, phone: PRIV.phone, ownerId: ID.ownerA, visibility: 'PRIVATE' });
    }, 60_000);
  });
});

// ---------------------------------------------------------------------------
// R0-20b-LEGACY-STRIPE-WEBHOOK-DOOR (D-05, ruled 2026-11-02): RA-G16-01 leaves
// deferral. The contract (§4.5) recorded one dependency: the deprecated POST
// /webhooks/stripe called commerce.markInvoicePaid(invoiceId) with no actor and
// no tenant, the only production caller of that shape. D-05 authorizes the
// bounded change to that handler: after signature verification it hands the
// verified event to the Stripe ledger door (PaymentsService.handleStripeWebhook,
// what POST /payments/stripe/webhook runs), bound to the invoice's business and
// currency with a positive amount, recorded as carried (R0-20b review
// CR-R020B-1), and never calls markInvoicePaid.
// ---------------------------------------------------------------------------
describe('R0-20b-LEGACY-STRIPE-WEBHOOK-DOOR: G16 — the anonymous, tenantless caller (D-05; RA-G16-01 leaves deferral)', () => {
  const SECRET = `whsec_${P}legacy`;
  const HINT = { deprecated: true, use: '/payments/stripe/webhook' };
  let previousSecret: string | undefined;

  beforeAll(() => {
    previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sign(raw: string) {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`;
  }

  function sessionEvent(tag: string, invoiceId: string, businessId: string) {
    return JSON.stringify({
      id: `${P}evt_${tag}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `${P}cs_${tag}`,
          object: 'checkout.session',
          amount_total: 10000,
          currency: 'ttd',
          client_reference_id: invoiceId,
          metadata: { invoiceId, businessId },
          payment_intent: `${P}pi_${tag}`,
        },
      },
    });
  }

  function post(path: '/webhooks/stripe' | '/payments/stripe/webhook', raw: string, signed = true) {
    const req = agent().post(path).set('content-type', 'application/json');
    return (signed ? req.set('stripe-signature', sign(raw)) : req).send(raw);
  }

  it('RA-G16-01: a caller with no actor and no tenant cannot mark paid through the service: the deprecated POST /webhooks/stripe (no actor, no tenant) never reaches CommerceService.markInvoicePaid; unsigned, or signed naming another business, it writes nothing; signed for the invoice\'s own business it records the receipt once through the Stripe ledger door (provider stripe, recordedBy null), and the same event on POST /payments/stripe/webhook writes nothing more', async () => {
    const copy = await createCopy('g16_01', { status: 'SENT' });
    const markPaidSpy = vi.spyOn(commerce, 'markInvoicePaid');
    const ledgerBefore = await ledgerCountA();

    const unsigned = await post('/webhooks/stripe', sessionEvent('g16_01_unsigned', copy, ID.bizA), false);
    expect(unsigned.status).toBe(400);
    const foreign = await post('/webhooks/stripe', sessionEvent('g16_01_foreign', copy, ID.bizB));
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(400);
    expectNoCanary(foreign.body);
    expect(await invoiceStatus(copy)).toBe('SENT');
    expect(await paymentCount(copy)).toBe(0);
    expect(await ledgerCountA()).toBe(ledgerBefore);

    const raw = sessionEvent('g16_01', copy, ID.bizA);
    const res = await post('/webhooks/stripe', raw);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ received: true, processed: 'checkout.session.completed', ...HINT });
    expectNoCanary(res.body);
    const rows = await db.payment.findMany({ where: { invoiceId: copy } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: ID.bizA,
      status: 'SUCCESSFUL',
      amount: 100,
      provider: 'stripe',
      providerPaymentId: `${P}cs_g16_01`,
      recordedBy: null,
    });
    expect(await invoiceStatus(copy)).toBe('PAID');
    const postings = await paymentPostingsFor(copy);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ externalRef: `Payment:${rows[0].id}:payment_recorded`, status: 'POSTED' });

    const replay = await post('/payments/stripe/webhook', raw);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body).toMatchObject({ ok: true, received: true });
    expect(await paymentCount(copy)).toBe(1);
    expect((await paymentPostingsFor(copy)).map((t) => t.id)).toEqual(postings.map((t) => t.id));
    expect(markPaidSpy).not.toHaveBeenCalled();
  });

  it('RA-G16-01 (census): no production caller of CommerceService.markInvoicePaid passes neither actor nor tenant: every call site in apps/server/src names a tenant (third argument), and the deprecated Stripe handler calls it nowhere', async () => {
    const ts = (await import('typescript')).default;
    const src = path.resolve(__dirname, '../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) files.push(p);
      }
    };
    walk(src);
    // Call expressions only (comments and strings that name the method do not count).
    const sites: Array<{ file: string; args: string[] }> = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('markInvoicePaid')) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (n: import('typescript').Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'markInvoicePaid') {
          sites.push({ file: path.relative(src, file).split(path.sep).join('/'), args: n.arguments.map((a) => a.getText(sf)) });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(sites.length, 'the census is not vacuous').toBeGreaterThanOrEqual(4);
    expect(sites.map((s) => s.file)).not.toContain('modules/webhooks/webhooks.controller.ts');
    for (const s of sites) {
      // W8-KEY-REVENUE-GATE (review SEC-W7KMP-1; D-88, D-90): KEY's commerce_mark_invoice_paid and
      // bulk PAID hand markInvoicePaid a fourth argument, `{ initiatedBy }` (the member KEY ran for,
      // audit data beside KEY). The census still pins the shape: actor and tenant always named, and
      // a fourth argument only ever that options object, never one that could stand for a tenant.
      expect(s.args.length, `${s.file}: markInvoicePaid(${s.args.join(', ')})`).toBeGreaterThanOrEqual(3);
      expect(s.args.length, `${s.file}: markInvoicePaid(${s.args.join(', ')})`).toBeLessThanOrEqual(4);
      expect(s.args[2], `${s.file}: the tenant argument`).not.toMatch(/^(undefined|null)$/);
      if (s.args.length === 4) expect(s.args[3], `${s.file}: the options argument`).toBe('{ initiatedBy }');
    }
  });

  // W10-MARKPAID-ACTOR-REQUIRED (D-05; RA-G16-01 service half, was it.todo):
  // the contract's request is the direct call itself. A call that names
  // neither an actor nor a tenant is refused at markInvoicePaid's entry,
  // before the invoice is read: an unknown id gets the same 403 as a real one
  // (a lookup would answer 404). Naming either still reaches the lookup, so
  // every production caller (the census above: all name the tenant) is
  // unchanged, and the legacy POST /webhooks/stripe never calls it (RA-G16-01).
  it('RA-G16-01 (service half): commerce.markInvoicePaid(<copy>) called directly with no actor and no tenant is refused (ForbiddenException Not authorized to update this invoice) before any read or write: the copy stays SENT with no payment, no posting, no invoice.paid and business A\'s ledger unchanged; an unknown id gets the same 403, not the lookup\'s 404, while naming only a tenant or only an actor still reaches the lookup (404); the owner\'s call with its tenant then marks the copy PAID (W10-MARKPAID-ACTOR-REQUIRED, D-05, was it.todo)', async () => {
    const copy = await createCopy('g16_01_svc', { status: 'SENT' });
    const ledgerBefore = await ledgerCountA();

    for (const call of [
      () => commerce.markInvoicePaid(copy),
      () => commerce.markInvoicePaid(copy, undefined, undefined),
      () => commerce.markInvoicePaid(copy, null, undefined),
      () => commerce.markInvoicePaid(copy, '', ''),
    ]) {
      const err = await rejectionOf(call());
      expect(err).toBeInstanceOf(ForbiddenExceptionCtor);
      expect((err as Error).message).toMatch(/Not authorized to update this invoice/);
    }
    expect(await invoiceStatus(copy)).toBe('SENT');
    expect(await paymentCount(copy)).toBe(0);
    expect(await postingsFor(copy)).toHaveLength(0);
    expect(await paymentPostingsFor(copy)).toHaveLength(0);
    expect(await ledgerCountA()).toBe(ledgerBefore);
    expect(eventsFor('invoice.paid', copy)).toHaveLength(0);

    // Before any read: an id no invoice has is refused the same way. A guard
    // after the lookup would answer the lookup's NotFoundException here.
    const unknown = `${P}invMut_g16_01_svc_unknown`;
    const unknownErr = await rejectionOf(commerce.markInvoicePaid(unknown));
    expect(unknownErr).toBeInstanceOf(ForbiddenExceptionCtor);
    expect(unknownErr).not.toBeInstanceOf(NotFoundExceptionCtor);
    // Naming either one still reaches the lookup (only the no-actor, no-tenant shape is refused).
    expect(await rejectionOf(commerce.markInvoicePaid(unknown, undefined, ID.bizA))).toBeInstanceOf(NotFoundExceptionCtor);
    expect(await rejectionOf(commerce.markInvoicePaid(unknown, ID.ownerA))).toBeInstanceOf(NotFoundExceptionCtor);

    // Control: the refusal is the entry guard's; the owner's call with its tenant writes.
    await commerce.markInvoicePaid(copy, ID.ownerA, ID.bizA);
    expect(await invoiceStatus(copy)).toBe('PAID');
    expect(await paymentCount(copy)).toBe(1);
    expect(eventsFor('invoice.paid', copy)).toHaveLength(1);
  });
});
