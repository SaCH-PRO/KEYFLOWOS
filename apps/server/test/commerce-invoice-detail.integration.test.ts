/**
 * R0-QI-01-TENANT-INVOICE-DETAIL-ROUTE — tenant-bound operator invoice detail
 * (REAL database).
 *
 * The operator app's invoice detail and edit pages loaded their invoice through
 * the PUBLIC bare-id route (GET /commerce/invoices/:id). KF-REVENUE-AUTH-
 * PROJECTION-001 kept them working with a viewer-aware shape (RCR-01), but the
 * shareable gate on that route still answers 404 for DRAFT and VOID to
 * everyone, so the operator edit page could not open a draft, and the operator
 * UI depended on a public surface. This file pins the tenant-bound detail
 * route the pages read instead:
 *
 *   GET /commerce/businesses/:businessId/invoices/:invoiceId
 *     AuthGuard + BusinessGuard + ModuleScopeGuard(revenue:read)
 *
 * It serves the full operator shape (items with productId, contactId, the
 * contact with email, every payment row plus payments-derived paidAmount and
 * remaining, the business profile with its document templates) for EVERY
 * status, DRAFT and VOID included, bound to the tenant in the path: a
 * cross-tenant id and an unknown id answer the same 404; revenue:none and a
 * non-member answer 403; anonymous answers 401. The public bare-id route and
 * its viewer-aware shape are unchanged — the customer pay page still reads it.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (real Redis at REDIS_URL),
 * CommerceService, InvoiceWorkflowService and the production
 * GlobalHttpExceptionFilter + ValidationPipe are real against DATABASE_URL.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-cid-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. Collaborators off
 * the boundary (CRM timeline, stats cache, Gmail, vision, ledger posting) are
 * recorders.
 *
 * Fixtures: prefix `cid_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping. Every fixture string that
 * must never leave the server on a denied or public answer carries the canary
 * `CID_SECRET_`.
 *
 * Pre-fix (route absent) every tenant-route case answers 404 from Nest's
 * catch-all, so the guard cases (401/403) and the 200 cases fail by absence.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'cid_';
const HEADER = 'x-cid-user';
const CANARY = 'CID_SECRET_';
const UNKNOWN_INVOICE = `${P}does_not_exist`;

const ID = {
  // identities
  ownerA: `${P}ownerA`,             // OWNER of bizA
  staffReadA: `${P}staffReadA`,     // STAFF of bizA, revenue: read (explicit)
  staffDefaultA: `${P}staffDefaultA`, // STAFF of bizA, no explicit scopes (role default)
  staffNoneA: `${P}staffNoneA`,     // STAFF of bizA, revenue: none
  noMember: `${P}noMember`,         // no membership anywhere
  ownerB: `${P}ownerB`,             // OWNER of bizB only
  superAdmin: `${P}superAdmin`,     // role SUPER_ADMIN, no membership
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // product the bizA line items reference
  productA: `${P}productA`,
  // bizA invoices, one per status the operator pages must open
  invDraft: `${P}invDraft`,
  invSent: `${P}invSent`,
  invPaid: `${P}invPaid`,
  invOverdue: `${P}invOverdue`,
  invVoid: `${P}invVoid`,
  invPartial: `${P}invPartial`,
  invDeleted: `${P}invDeleted`,
  // bizB invoice (the cross-tenant id)
  invB: `${P}invB`,
};

const STATUS_OF: Record<string, string> = {
  [ID.invDraft]: 'DRAFT',
  [ID.invSent]: 'SENT',
  [ID.invPaid]: 'PAID',
  [ID.invOverdue]: 'OVERDUE',
  [ID.invVoid]: 'VOID',
  [ID.invPartial]: 'PARTIALLY_PAID',
};
const TOTAL_OF: Record<string, number> = {
  [ID.invDraft]: 50,
  [ID.invSent]: 100,
  [ID.invPaid]: 20,
  [ID.invOverdue]: 80,
  [ID.invVoid]: 30,
  [ID.invPartial]: 100,
};
const bizAInvoices = Object.keys(STATUS_OF);

let db: any;
let app: any;
let redis: any;

const recordedEvents: Array<{ name: string; payload: unknown }> = [];
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

const crmCalls: unknown[] = [];
const crmRecorder = {
  logContactEvent: async (input: unknown) => {
    crmCalls.push(input);
    return { id: `${P}evt_${crmCalls.length}` };
  },
};

const postingCalls: string[] = [];
const postingRecorder = {
  onPaymentRecorded: async (paymentId: string) => {
    postingCalls.push(`recorded:${paymentId}`);
  },
  onPaymentRefunded: async (paymentId: string) => {
    postingCalls.push(`refunded:${paymentId}`);
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_transactions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payments WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM payment_links WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE '${P}%'`,
    `DELETE FROM invoices WHERE business_id LIKE '${P}%'`,
    `DELETE FROM products WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%' OR user_id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

// The public bare-id route is limited at 20/min per IP (RR-ST4). The few
// public reads here share one IP with the other suites on this Redis db, so
// the key is reset around them.
async function clearPublicInvoiceRouteRateLimit() {
  const keys: string[] = await redis.keys('pub_rate_limit:*:getInvoice:*');
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

function withActor(req: request.Test, actor: string | null) {
  return actor ? req.set(HEADER, actor) : req;
}

/** The tenant-bound operator detail route under test. */
function detail(actor: string | null, invoiceId: string, businessId = ID.bizA) {
  return withActor(agent().get(`/commerce/businesses/${businessId}/invoices/${invoiceId}`), actor);
}

/** The public bare-id route (regression control: unchanged by this packet). */
function bareId(actor: string | null, invoiceId: string) {
  return withActor(agent().get(`/commerce/invoices/${invoiceId}`), actor);
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

/**
 * The full operator shape the detail and edit pages consume:
 * header/summary (payments-derived paidAmount/remaining), the reminder
 * composer (contact.email), the edit form (contactId, items[].productId) and
 * the document rendering (business profile incl. templates).
 */
function expectOperatorShape(body: any, invoiceId: string) {
  expect(body.id).toBe(invoiceId);
  expect(body.status).toBe(STATUS_OF[invoiceId]);
  expect(body.businessId).toBe(ID.bizA);
  expect(body.contactId).toBe(ID.contactA);
  expect(body.contact).toEqual({ firstName: 'Cid', lastName: 'Customer', email: `${CANARY}customer@test.local` });
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({ id: `${invoiceId}_item1`, productId: ID.productA, quantity: 1 });
  expect(Array.isArray(body.payments)).toBe(true);
  expect(typeof body.paidAmount).toBe('number');
  expect(typeof body.remaining).toBe('number');
  expect(body.business).toMatchObject({
    id: ID.bizA,
    name: 'CID Biz A',
    address: '1 Harbour Street',
    city: 'Port of Spain',
    country: 'TT',
    invoiceTemplate: 'modern',
    quoteTemplate: 'classic',
  });
  expect(Number(body.total)).toBe(TOTAL_OF[invoiceId]);
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
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // ---- the real HTTP path, wired before any row is seeded -----------------
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
      { provide: RevenuePostingService, useValue: postingRecorder },
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: crmRecorder },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

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
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearPublicInvoiceRouteRateLimit();

  // ---- identities ---------------------------------------------------------
  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.staffReadA, 'USER'], [ID.staffDefaultA, 'USER'], [ID.staffNoneA, 'USER'],
    [ID.noMember, 'USER'], [ID.ownerB, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role } });
  }

  // ---- tenants: A carries the profile and the private template choices ----
  await db.business.create({
    data: {
      id: ID.bizA, name: 'CID Biz A', ownerId: ID.ownerA, currency: 'TTD',
      address: '1 Harbour Street', city: 'Port of Spain', country: 'TT', phone: '+18680000001',
      email: 'billing@cid-a.example', website: 'https://cid-a.example',
      primaryColor: '#112233', secondaryColor: '#445566',
      invoiceTemplate: 'modern', quoteTemplate: 'classic',
      metaData: { bankAccountNumber: `${CANARY}acct` },
    },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'CID Biz B', ownerId: ID.ownerB, currency: 'TTD' } });

  // ---- real memberships ---------------------------------------------------
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
  await m(ID.staffReadA, ID.bizA, 'STAFF', { revenue: 'read' });
  await m(ID.staffDefaultA, ID.bizA, 'STAFF');
  await m(ID.staffNoneA, ID.bizA, 'STAFF', { revenue: 'none', crm: 'read' });
  await m(ID.ownerB, ID.bizB, 'OWNER');

  // ---- contacts (Invoice.contactId is required); A's email is a canary -----
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Cid', lastName: 'Customer', email: `${CANARY}customer@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Cid', lastName: 'CustomerB', email: 'b@test.local' } });

  // ---- product the bizA line items point at (edit form reads productId) ---
  await db.product.create({ data: { id: ID.productA, businessId: ID.bizA, name: 'CID Product A', price: 5 } });

  // ---- invoices -----------------------------------------------------------
  const inv = async (id: string, biz: string, contactId: string, status: string, total: number, number: string, extra: Record<string, unknown> = {}) =>
    db.invoice.create({
      data: {
        id,
        invoiceNumber: number,
        status,
        subtotal: total,
        total,
        currency: 'TTD',
        notes: `${CANARY}notes ${number}`,
        businessId: biz,
        contactId,
        items: {
          create: [{
            id: `${id}_item1`, description: `CID item ${number}`, quantity: 1, unitPrice: total, total,
            ...(biz === ID.bizA ? { productId: ID.productA } : {}),
          }],
        },
        ...extra,
      },
    });
  await inv(ID.invDraft, ID.bizA, ID.contactA, 'DRAFT', TOTAL_OF[ID.invDraft], 'CID-DRAFT');
  await inv(ID.invSent, ID.bizA, ID.contactA, 'SENT', TOTAL_OF[ID.invSent], 'CID-SENT');
  await inv(ID.invPaid, ID.bizA, ID.contactA, 'PAID', TOTAL_OF[ID.invPaid], 'CID-PAID', { paidAt: new Date('2026-01-12T10:00:00.000Z') });
  await inv(ID.invOverdue, ID.bizA, ID.contactA, 'OVERDUE', TOTAL_OF[ID.invOverdue], 'CID-OVERDUE', { dueDate: new Date('2020-01-01T00:00:00.000Z') });
  await inv(ID.invVoid, ID.bizA, ID.contactA, 'VOID', TOTAL_OF[ID.invVoid], 'CID-VOID');
  await inv(ID.invPartial, ID.bizA, ID.contactA, 'PARTIALLY_PAID', TOTAL_OF[ID.invPartial], 'CID-PARTIAL');
  await inv(ID.invDeleted, ID.bizA, ID.contactA, 'SENT', 10, 'CID-DELETED', { deletedAt: new Date() });
  await inv(ID.invB, ID.bizB, ID.contactB, 'SENT', 70, 'CID-B');

  // ---- payments: the rows the Payment Summary derives paid/remaining from ---
  const pay = async (id: string, invoiceId: string, amount: number, status: string, extra: Record<string, unknown> = {}) =>
    db.payment.create({
      data: {
        id, businessId: ID.bizA, invoiceId, amount, currency: 'TTD', status,
        provider: 'manual', method: 'MANUAL', providerPaymentId: `${P}pp_${id.slice(P.length)}`,
        ...extra,
      },
    });
  await pay(`${P}pay_partial1`, ID.invPartial, 40, 'SUCCESSFUL', {
    reference: `${CANARY}ref`, notes: `${CANARY}paynote`, recordedBy: ID.ownerA,
    createdAt: new Date('2026-01-10T10:00:00.000Z'),
  });
  await pay(`${P}pay_partial2`, ID.invPartial, 10, 'PENDING', { createdAt: new Date('2026-01-11T10:00:00.000Z') });
  await pay(`${P}pay_paid1`, ID.invPaid, 20, 'SUCCESSFUL', { createdAt: new Date('2026-01-12T10:00:00.000Z') });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearPublicInvoiceRouteRateLimit(); } catch { /* best-effort */ }
    await redis.quit();
  }
});

beforeEach(clearPublicInvoiceRouteRateLimit);

describe('fixture sanity (real rows)', () => {
  it('seeded the tenants, memberships, invoices and payments', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(4);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.invoice.count({ where: { businessId: ID.bizA } })).toBe(6); // the soft-deleted row is hidden
    expect(await db.payment.count({ where: { invoiceId: ID.invPartial } })).toBe(2);
    expect(await db.payment.count({ where: { invoiceId: ID.invPaid } })).toBe(1);
    const rows = await db.$queryRawUnsafe(`SELECT id, deleted_at FROM invoices WHERE id = '${ID.invDeleted}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });
});

describe('GET /commerce/businesses/:businessId/invoices/:invoiceId through the real guard path', () => {
  it('rejects a request with no identity (401) and discloses nothing', async () => {
    const res = await detail(null, ID.invSent);
    expect(res.status).toBe(401);
    expectNoCanary(res.body);
  });

  it('rejects a user with no membership at BusinessGuard (403 No access to this business)', async () => {
    const res = await detail(ID.noMember, ID.invSent);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/No access to this business/);
    expectNoCanary(res.body);
  });

  it('rejects a member of another tenant on this tenant path (403), and the reverse', async () => {
    const res = await detail(ID.ownerB, ID.invSent);
    expect(res.status).toBe(403);
    expectNoCanary(res.body);
    const reverse = await detail(ID.ownerA, ID.invB, ID.bizB);
    expect(reverse.status).toBe(403);
    expectNoCanary(reverse.body);
  });

  it('rejects a member whose revenue scope is explicitly none (403 Insufficient permissions)', async () => {
    const res = await detail(ID.staffNoneA, ID.invSent);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Insufficient permissions/);
    expectNoCanary(res.body);
  });

  it("another tenant's invoice id under this tenant path is not found (404) for the owner, exactly like an unknown id", async () => {
    const cross = await detail(ID.ownerA, ID.invB);
    const unknown = await detail(ID.ownerA, UNKNOWN_INVOICE);
    expect(cross.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(cross.body.message).toBe('Invoice not found');
    expect(stripVolatile(cross.body)).toEqual(stripVolatile(unknown.body));
    expectNoCanary(cross.body);
  });

  it('positive control: the other tenant opens its own invoice on its own path (200)', async () => {
    const res = await detail(ID.ownerB, ID.invB, ID.bizB);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID.invB);
    expect(res.body.businessId).toBe(ID.bizB);
    expect(res.body.contactId).toBe(ID.contactB);
  });

  it('a soft-deleted invoice is not found for anyone, owner and SUPER_ADMIN included (404)', async () => {
    for (const actor of [ID.ownerA, ID.superAdmin, ID.staffReadA]) {
      const res = await detail(actor, ID.invDeleted);
      expect(res.status, `actor ${actor}`).toBe(404);
      expectNoCanary(res.body);
    }
  });

  it('OWNER, revenue:read (explicit and STAFF default) and SUPER_ADMIN open every status with the full operator shape, DRAFT and VOID included', async () => {
    for (const actor of [ID.ownerA, ID.staffReadA, ID.staffDefaultA, ID.superAdmin]) {
      for (const invoiceId of bizAInvoices) {
        const res = await detail(actor, invoiceId);
        expect(res.status, `actor ${actor} invoice ${invoiceId}`).toBe(200);
        expectOperatorShape(res.body, invoiceId);
      }
    }
  });

  it('DRAFT and VOID open on the tenant route while the public bare-id route still answers 404 for them to the same operator', async () => {
    for (const invoiceId of [ID.invDraft, ID.invVoid]) {
      const tenant = await detail(ID.ownerA, invoiceId);
      expect(tenant.status, `tenant ${invoiceId}`).toBe(200);
      expect(tenant.body.status).toBe(STATUS_OF[invoiceId]);
      const bare = await bareId(ID.ownerA, invoiceId);
      expect(bare.status, `bare ${invoiceId}`).toBe(404);
    }
  });

  it('payments are the rows, and paidAmount/remaining are derived from the SUCCESSFUL ones (part-paid, paid, unpaid)', async () => {
    const partial = await detail(ID.ownerA, ID.invPartial);
    expect(partial.status).toBe(200);
    expect(partial.body.payments.map((p: any) => p.id).sort()).toEqual([`${P}pay_partial1`, `${P}pay_partial2`]);
    expect(partial.body.payments.find((p: any) => p.id === `${P}pay_partial1`)).toMatchObject({
      amount: 40, status: 'SUCCESSFUL', reference: `${CANARY}ref`, notes: `${CANARY}paynote`,
    });
    expect(partial.body.paidAmount).toBe(40);
    expect(partial.body.remaining).toBe(60);

    const paid = await detail(ID.ownerA, ID.invPaid);
    expect(paid.status).toBe(200);
    expect(paid.body.payments).toHaveLength(1);
    expect(paid.body.paidAmount).toBe(20);
    expect(paid.body.remaining).toBe(0);

    const draft = await detail(ID.ownerA, ID.invDraft);
    expect(draft.status).toBe(200);
    expect(draft.body.payments).toEqual([]);
    expect(draft.body.paidAmount).toBe(0);
    expect(draft.body.remaining).toBe(TOTAL_OF[ID.invDraft]);
  });

  it('denied reads mutate nothing', async () => {
    const before = await db.invoice.findUnique({ where: { id: ID.invSent }, select: { updatedAt: true, status: true, notes: true } });
    await detail(null, ID.invSent);
    await detail(ID.noMember, ID.invSent);
    await detail(ID.staffNoneA, ID.invSent);
    await detail(ID.ownerB, ID.invSent);
    const after = await db.invoice.findUnique({ where: { id: ID.invSent }, select: { updatedAt: true, status: true, notes: true } });
    expect(after).toEqual(before);
    expect(await db.payment.count({ where: { businessId: ID.bizA } })).toBe(3);
  });
});

describe('regression control: the public bare-id route and its viewer-aware shape are unchanged', () => {
  it('anonymous: a SENT invoice is served as the public projection (no payment rows, no customer email, no canary)', async () => {
    const res = await bareId(null, ID.invSent);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID.invSent);
    expect(res.body).not.toHaveProperty('payments');
    expect(res.body.contact).toEqual({ firstName: 'Cid', lastName: 'Customer' });
    expect(res.body.business).not.toHaveProperty('invoiceTemplate');
    expect(res.body.paid).toBe(0);
    expect(res.body.remaining).toBe(TOTAL_OF[ID.invSent]);
    // The notes carry a canary by fixture design and are printed on the
    // invoice, so the only canary check here is the fields the projection
    // withholds.
    expect(JSON.stringify(res.body)).not.toContain(`${CANARY}customer`);
    expect(JSON.stringify(res.body)).not.toContain(`${CANARY}acct`);
  });

  it('anonymous: DRAFT and VOID are not shareable (404) on the public route, as before', async () => {
    for (const invoiceId of [ID.invDraft, ID.invVoid]) {
      const res = await bareId(null, invoiceId);
      expect(res.status, invoiceId).toBe(404);
      expectNoCanary(res.body);
    }
  });

  it('operator: a shareable invoice on the public route still gets the operator shape (RCR-01), a revenue:none member the projection', async () => {
    const operator = await bareId(ID.ownerA, ID.invPartial);
    expect(operator.status).toBe(200);
    expect(operator.body.payments).toHaveLength(2);
    expect(operator.body.contact.email).toBe(`${CANARY}customer@test.local`);

    const none = await bareId(ID.staffNoneA, ID.invPartial);
    expect(none.status).toBe(200);
    expect(none.body).not.toHaveProperty('payments');
    expect(none.body.contact).toEqual({ firstName: 'Cid', lastName: 'Customer' });
  });
});
