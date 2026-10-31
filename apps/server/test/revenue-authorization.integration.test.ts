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
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'rva_';
const CANARY = 'RVA_SECRET_';

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

const STATUS_ROUTE_KEY_PATTERN = 'pub_rate_limit:*getInvoicePaymentStatus*';

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
    `DELETE FROM payments WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM payment_links WHERE business_id LIKE '${P}%'`,
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
const PUBLIC_INVOICE_ROUTE_KEY_PATTERN = 'pub_rate_limit:*:getInvoice:*';

async function clearPublicInvoiceRouteRateLimit() {
  const keys: string[] = await redis.keys(PUBLIC_INVOICE_ROUTE_KEY_PATTERN);
  if (keys.length) await redis.del(...keys);
}

async function clearAllPublicRateLimits() {
  const keys: string[] = await redis.keys('pub_rate_limit:*');
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
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
  CommerceAdapterServiceCtor = CommerceAdapterService;
  KEY_SYSTEM_ACTOR = KEY_SYSTEM_ACTOR_ID;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // ---- the real HTTP path, wired before any row is seeded -----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, PaymentsController],
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
    ],
  }).compile();

  app = moduleRef.createNestApplication();
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
      const res = await setStatus(ID.ownerA, copy, 'paid', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(400);
      expect(await invoiceStatus(copy)).toBe('SENT');
      const cogs = (await postingsFor(copy)).filter((t) => /cogs/i.test(t.externalRef ?? ''));
      expect(cogs).toHaveLength(0);
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
      const res = await setStatus(ID.staffReadA, copy, 'sent', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(403);
      expect(await invoiceStatus(copy)).toBe('DRAFT');
      expect(await postingsFor(copy)).toHaveLength(0);
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

    it.todo(
      'RA-G4-13: SUPER_ADMIN still passes (matrix: 200 before and after). CONTRADICTION measured on main b1948d27: ' +
        'both guards bypass SUPER_ADMIN, but CommerceService.markInvoicePaid then requires a Membership row for every ' +
        'non-system actor (service 482-489) and rva_superAdmin has none, so the request answers 500 on main and 403 after ' +
        'the error-mapping fix. Admitting SUPER_ADMIN inside the service is an authority widening outside the released ' +
        'scope of KF-REVENUE-AUTH-PROJECTION-001; the guard half is pinned at L1 (commerce-authorization.e2e.test.ts).',
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

  describe('G16 — deferred service-level tightening', () => {
    it.todo(
      'RA-G16-01: a caller with no actor and no tenant cannot mark paid through the service. ' +
        'DEFERRED: KF-REVENUE-FINANCIAL-INTEGRITY (webhooks.controller.ts 86-91) — the deprecated Stripe handler calls ' +
        'commerce.markInvoicePaid(invoiceId) with no actor and no tenant and depends on both checks being skipped; ' +
        'tightening the service is not released in KF-REVENUE-AUTH-PROJECTION-001.',
    );
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

    it('PC-08: a customer payment intent still works from a public page (fresh copy; G6 is a later packet)', async () => {
      const copy = await createCopy('pc_08', { status: 'SENT' });
      const res = await agent().post(`/commerce/invoices/${copy}/payment-intent`).send({ method: 'bank_transfer' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      const rows = await db.payment.findMany({ where: { invoiceId: copy } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('PENDING');
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
