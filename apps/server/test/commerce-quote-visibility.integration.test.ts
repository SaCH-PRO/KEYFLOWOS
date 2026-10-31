/**
 * R0-PC-01-QUOTE-DETAIL-TENANT-ROUTE — quote detail visibility (REAL database).
 *
 * GET /commerce/quotes/:quoteId was unguarded and unthrottled: anyone holding a
 * quote id (cuid) received the full operator shape — DRAFT quotes included,
 * with the customer's email, the internal notes, the linked invoice row and
 * the business profile (public-commercial lane PC-F05 / BP-PC-01). It sits on
 * the Release 0 quote path. This file pins the two halves of the repair:
 *
 *   GET /commerce/businesses/:businessId/quotes/:quoteId
 *     AuthGuard + BusinessGuard + ModuleScopeGuard(revenue:read)
 *     The operator detail read, bound to the tenant in the path: a
 *     cross-tenant id, an unknown id and a soft-deleted row answer the same
 *     404; a non-member and revenue:none answer 403; anonymous answers 401.
 *
 *   GET /commerce/quotes/:quoteId  (the bare-id route)
 *     CHOICE: 404 for every id, every status, every caller — not a redacted
 *     projection. No web page reads it (the customer quote page reads the
 *     signed-token route, /commerce/public/quotes/:token, which is untouched),
 *     so a projection would keep a public surface alive for no reader. The
 *     answer is byte-identical (volatile envelope fields stripped) to an
 *     unknown id, so the route cannot be used to confirm that a quote exists,
 *     and it stays behind PublicRateLimitGuard at 20/min.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (real Redis at REDIS_URL),
 * CommerceService and the production GlobalHttpExceptionFilter +
 * ValidationPipe are real against DATABASE_URL. Identity attachment is the one
 * stand-in: a test middleware reads `x-cqv-user`, loads that seeded user row
 * and attaches `{ id, email, role }` exactly as the Supabase-verifying
 * AuthMiddleware would. Collaborators off the boundary (CRM timeline, stats
 * cache, Gmail, vision, ledger posting) are recorders.
 *
 * Fixtures: prefix `cqv_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping. Every fixture string that
 * must never leave the server on a denied or public answer carries the canary
 * `CQV_SECRET_`.
 *
 * Pre-fix: the tenant route is absent (Nest's catch-all 404), so its guard and
 * 200 cases fail by absence; the bare-id route answers 200 with the full shape
 * (contact email, notes, invoice link) to anonymous callers, so its 404 cases
 * fail on the defect itself, and its rate-limit case fails (no limit).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'cqv_';
const HEADER = 'x-cqv-user';
const CANARY = 'CQV_SECRET_';
const UNKNOWN_QUOTE = `${P}does_not_exist`;

const ID = {
  // identities
  ownerA: `${P}ownerA`,               // OWNER of bizA
  staffReadA: `${P}staffReadA`,       // STAFF of bizA, revenue: read (explicit)
  staffDefaultA: `${P}staffDefaultA`, // STAFF of bizA, no explicit scopes (role default)
  staffNoneA: `${P}staffNoneA`,       // STAFF of bizA, revenue: none
  noMember: `${P}noMember`,           // no membership anywhere
  ownerB: `${P}ownerB`,               // OWNER of bizB only
  superAdmin: `${P}superAdmin`,       // role SUPER_ADMIN, no membership
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // product the bizA line items reference
  productA: `${P}productA`,
  // bizA quotes
  qDraft: `${P}qDraft`,
  qSent: `${P}qSent`,
  qAccepted: `${P}qAccepted`,
  qDeleted: `${P}qDeleted`,
  // the invoice the ACCEPTED quote was converted into
  invFromQuote: `${P}invFromQuote`,
  // bizB quote (the cross-tenant id)
  qB: `${P}qB`,
};

const ACCEPTED_TOKEN = `${P}tok_accepted`;
const SENT_TOKEN = `${P}tok_sent`;

const STATUS_OF: Record<string, string> = {
  [ID.qDraft]: 'DRAFT',
  [ID.qSent]: 'SENT',
  [ID.qAccepted]: 'ACCEPTED',
};
const TOTAL_OF: Record<string, number> = {
  [ID.qDraft]: 50,
  [ID.qSent]: 100,
  [ID.qAccepted]: 75,
};
const bizAQuotes = Object.keys(STATUS_OF);

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

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_transactions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payments WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE '${P}%'`,
    `DELETE FROM invoices WHERE business_id LIKE '${P}%'`,
    `DELETE FROM quote_items WHERE quote_id LIKE '${P}%'`,
    `DELETE FROM quotes WHERE business_id LIKE '${P}%'`,
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

// The public routes are rate limited per IP and handler; the reads here share
// one IP with the other suites on this Redis db, so the keys are reset around
// every case.
async function clearPublicQuoteRouteRateLimits() {
  for (const pattern of ['pub_rate_limit:*:getQuote:*', 'pub_rate_limit:*:getPublicQuote:*']) {
    const keys: string[] = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
}

function agent() {
  return request(app.getHttpServer());
}

function withActor(req: request.Test, actor: string | null) {
  return actor ? req.set(HEADER, actor) : req;
}

/** The tenant-bound operator detail route under test. */
function detail(actor: string | null, quoteId: string, businessId = ID.bizA) {
  return withActor(agent().get(`/commerce/businesses/${businessId}/quotes/${quoteId}`), actor);
}

/** The bare-id route under test (retired to a uniform 404). */
function bareId(actor: string | null, quoteId: string) {
  return withActor(agent().get(`/commerce/quotes/${quoteId}`), actor);
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

/** The full operator shape a quote detail reader consumes. */
function expectOperatorShape(body: any, quoteId: string) {
  expect(body.id).toBe(quoteId);
  expect(body.status).toBe(STATUS_OF[quoteId]);
  expect(body.businessId).toBe(ID.bizA);
  expect(body.contactId).toBe(ID.contactA);
  expect(body.contact).toEqual({ firstName: 'Cqv', lastName: 'Customer', email: `${CANARY}customer@test.local` });
  expect(body.notes).toBe(`${CANARY}notes ${quoteId}`);
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({ id: `${quoteId}_item1`, productId: ID.productA, quantity: 1 });
  expect(body.business).toMatchObject({ id: ID.bizA, name: 'CQV Biz A', address: '1 Harbour Street' });
  expect(Number(body.total)).toBe(TOTAL_OF[quoteId]);
  // Server-decorated lifecycle flags, as the list route serves them.
  expect(typeof body.isStale).toBe('boolean');
  expect(typeof body.isExpired).toBe('boolean');
  expect(typeof body.lifecycleStep).toBe('string');
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
      { provide: RevenuePostingService, useValue: { onPaymentRecorded: async () => undefined, onPaymentRefunded: async () => undefined } },
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: crmRecorder },
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
  await clearPublicQuoteRouteRateLimits();

  // ---- identities ---------------------------------------------------------
  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.staffReadA, 'USER'], [ID.staffDefaultA, 'USER'], [ID.staffNoneA, 'USER'],
    [ID.noMember, 'USER'], [ID.ownerB, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role } });
  }

  // ---- tenants: A carries the profile and a private metaData canary --------
  await db.business.create({
    data: {
      id: ID.bizA, name: 'CQV Biz A', ownerId: ID.ownerA, currency: 'TTD',
      address: '1 Harbour Street', city: 'Port of Spain', country: 'TT', phone: '+18680000001',
      email: 'billing@cqv-a.example', website: 'https://cqv-a.example', primaryColor: '#112233',
      invoiceTemplate: 'modern', quoteTemplate: 'classic',
      metaData: { bankAccountNumber: `${CANARY}acct` },
    },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'CQV Biz B', ownerId: ID.ownerB, currency: 'TTD' } });

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

  // ---- contacts (Quote.contactId is required); A's email/phone are canaries --
  await db.contact.create({
    data: {
      id: ID.contactA, businessId: ID.bizA, firstName: 'Cqv', lastName: 'Customer',
      email: `${CANARY}customer@test.local`, phone: `${CANARY}phone`,
    },
  });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Cqv', lastName: 'CustomerB', email: 'b@test.local' } });

  // ---- product the bizA line items point at --------------------------------
  await db.product.create({ data: { id: ID.productA, businessId: ID.bizA, name: 'CQV Product A', price: 5 } });

  // ---- quotes -------------------------------------------------------------
  const quote = async (id: string, biz: string, contactId: string, status: string, total: number, number: string, extra: Record<string, unknown> = {}) =>
    db.quote.create({
      data: {
        id,
        quoteNumber: number,
        status,
        subtotal: total,
        total,
        currency: 'TTD',
        notes: `${CANARY}notes ${id}`,
        businessId: biz,
        contactId,
        items: {
          create: [{
            id: `${id}_item1`, description: `CQV item ${number}`, quantity: 1, unitPrice: total, total,
            ...(biz === ID.bizA ? { productId: ID.productA } : {}),
          }],
        },
        ...extra,
      },
    });
  await quote(ID.qDraft, ID.bizA, ID.contactA, 'DRAFT', TOTAL_OF[ID.qDraft], 'CQV-DRAFT');
  await quote(ID.qSent, ID.bizA, ID.contactA, 'SENT', TOTAL_OF[ID.qSent], 'CQV-SENT', {
    viewToken: SENT_TOKEN, sentAt: new Date(),
  });
  await quote(ID.qAccepted, ID.bizA, ID.contactA, 'ACCEPTED', TOTAL_OF[ID.qAccepted], 'CQV-ACCEPTED', {
    viewToken: ACCEPTED_TOKEN, sentAt: new Date('2026-01-01T10:00:00.000Z'), acceptedAt: new Date('2026-01-02T10:00:00.000Z'),
    invoiceId: ID.invFromQuote,
  });
  await quote(ID.qDeleted, ID.bizA, ID.contactA, 'SENT', 10, 'CQV-DELETED', { deletedAt: new Date() });
  await quote(ID.qB, ID.bizB, ID.contactB, 'SENT', 70, 'CQV-B');

  // ---- the invoice the ACCEPTED quote converted into (Invoice.quoteId) ------
  await db.invoice.create({
    data: {
      id: ID.invFromQuote, invoiceNumber: 'CQV-INV-1', status: 'SENT', subtotal: 75, total: 75, currency: 'TTD',
      notes: `${CANARY}invoice notes`, businessId: ID.bizA, contactId: ID.contactA, quoteId: ID.qAccepted,
    },
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearPublicQuoteRouteRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
});

beforeEach(clearPublicQuoteRouteRateLimits);

describe('fixture sanity (real rows)', () => {
  it('seeded the tenants, memberships, quotes and the converted invoice', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(4);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.quote.count({ where: { businessId: ID.bizA, deletedAt: null } })).toBe(3);
    expect(await db.quote.count({ where: { businessId: ID.bizB } })).toBe(1);
    const inv = await db.invoice.findUnique({ where: { id: ID.invFromQuote }, select: { quoteId: true } });
    expect(inv?.quoteId).toBe(ID.qAccepted);
    const rows = await db.$queryRawUnsafe(`SELECT id, deleted_at FROM quotes WHERE id = '${ID.qDeleted}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });
});

describe('GET /commerce/businesses/:businessId/quotes/:quoteId through the real guard path', () => {
  it('rejects a request with no identity (401) and discloses nothing', async () => {
    const res = await detail(null, ID.qDraft);
    expect(res.status).toBe(401);
    expectNoCanary(res.body);
  });

  it('rejects a user with no membership at BusinessGuard (403 No access to this business)', async () => {
    const res = await detail(ID.noMember, ID.qDraft);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/No access to this business/);
    expectNoCanary(res.body);
  });

  it('rejects a member of another tenant on this tenant path (403)', async () => {
    const res = await detail(ID.ownerB, ID.qDraft);
    expect(res.status).toBe(403);
    expectNoCanary(res.body);
  });

  it('rejects a member whose revenue scope is explicitly none (403 Insufficient permissions)', async () => {
    const res = await detail(ID.staffNoneA, ID.qDraft);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Insufficient permissions/);
    expectNoCanary(res.body);
  });

  it("the owner of B asking for A's quote id on B's own path gets 404, byte-identical to an unknown id", async () => {
    for (const quoteId of [ID.qDraft, ID.qSent, ID.qAccepted]) {
      const cross = await detail(ID.ownerB, quoteId, ID.bizB);
      const unknown = await detail(ID.ownerB, UNKNOWN_QUOTE, ID.bizB);
      expect(cross.status, quoteId).toBe(404);
      expect(unknown.status).toBe(404);
      expect(cross.body.message).toBe('Quote not found');
      expect(stripVolatile(cross.body)).toEqual(stripVolatile(unknown.body));
      expectNoCanary(cross.body);
    }
  });

  it('positive control: the other tenant opens its own quote on its own path (200)', async () => {
    const res = await detail(ID.ownerB, ID.qB, ID.bizB);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID.qB);
    expect(res.body.businessId).toBe(ID.bizB);
    expect(res.body.contactId).toBe(ID.contactB);
  });

  it('a soft-deleted quote is not found for anyone, owner and SUPER_ADMIN included (404)', async () => {
    for (const actor of [ID.ownerA, ID.superAdmin, ID.staffReadA]) {
      const res = await detail(actor, ID.qDeleted);
      expect(res.status, `actor ${actor}`).toBe(404);
      expect(res.body.message).toBe('Quote not found');
      expectNoCanary(res.body);
    }
  });

  it('OWNER, revenue:read (explicit and STAFF default) and SUPER_ADMIN open DRAFT, SENT and ACCEPTED with the full operator detail incl. contact', async () => {
    for (const actor of [ID.ownerA, ID.staffReadA, ID.staffDefaultA, ID.superAdmin]) {
      for (const quoteId of bizAQuotes) {
        const res = await detail(actor, quoteId);
        expect(res.status, `actor ${actor} quote ${quoteId}`).toBe(200);
        expectOperatorShape(res.body, quoteId);
      }
    }
  });

  it('the ACCEPTED quote carries its converted invoice for the operator, and the lifecycle step says so', async () => {
    const res = await detail(ID.ownerA, ID.qAccepted);
    expect(res.status).toBe(200);
    expect(res.body.invoiceId).toBe(ID.invFromQuote);
    expect(res.body.invoice).toMatchObject({ id: ID.invFromQuote, invoiceNumber: 'CQV-INV-1', status: 'SENT' });
    expect(res.body.lifecycleStep).toBe('INVOICED');

    const draft = await detail(ID.ownerA, ID.qDraft);
    expect(draft.body.lifecycleStep).toBe('DRAFT');
    expect(draft.body.invoice).toBeNull();
  });

  it('denied and operator reads mutate nothing (no view stamp, no event, no timeline entry)', async () => {
    const before = await db.quote.findUnique({ where: { id: ID.qSent }, select: { updatedAt: true, status: true, viewedAt: true } });
    const eventsBefore = recordedEvents.length;
    const crmBefore = crmCalls.length;
    await detail(null, ID.qSent);
    await detail(ID.noMember, ID.qSent);
    await detail(ID.staffNoneA, ID.qSent);
    await detail(ID.ownerB, ID.qSent);
    await detail(ID.ownerA, ID.qSent);
    const after = await db.quote.findUnique({ where: { id: ID.qSent }, select: { updatedAt: true, status: true, viewedAt: true } });
    expect(after).toEqual(before);
    expect(after.viewedAt).toBeNull();
    expect(recordedEvents.length).toBe(eventsBefore);
    expect(crmCalls.length).toBe(crmBefore);
  });
});

describe('GET /commerce/quotes/:quoteId (bare id) — CHOICE: 404 for every quote and caller, no projection, behind @PublicRateLimit(20/min)', () => {
  it('unauthenticated and non-member GET of a DRAFT quote id -> 404, body byte-identical to an unknown id (volatile fields stripped)', async () => {
    const unknownAnon = await bareId(null, UNKNOWN_QUOTE);
    expect(unknownAnon.status).toBe(404);
    for (const actor of [null, ID.noMember]) {
      const draft = await bareId(actor, ID.qDraft);
      const unknown = await bareId(actor, UNKNOWN_QUOTE);
      expect(draft.status, `actor ${actor}`).toBe(404);
      expect(unknown.status).toBe(404);
      expect(stripVolatile(draft.body)).toEqual(stripVolatile(unknown.body));
      expect(stripVolatile(draft.body)).toEqual(stripVolatile(unknownAnon.body));
      expectNoCanary(draft.body);
    }
  });

  it('SENT and ACCEPTED quotes answer 404 too (the pinned choice, not a redacted projection): no contact email/phone, notes, business private fields or invoice link leave the server', async () => {
    const unknown = await bareId(null, UNKNOWN_QUOTE);
    for (const quoteId of [ID.qSent, ID.qAccepted]) {
      for (const actor of [null, ID.noMember, ID.ownerB, ID.staffNoneA]) {
        const res = await bareId(actor, quoteId);
        expect(res.status, `actor ${actor} quote ${quoteId}`).toBe(404);
        expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(CANARY);
        expect(text).not.toContain(ID.invFromQuote);
        expect(text).not.toContain(ID.contactA);
        expect(res.body).not.toHaveProperty('contact');
        expect(res.body).not.toHaveProperty('notes');
        expect(res.body).not.toHaveProperty('invoice');
        expect(res.body).not.toHaveProperty('business');
      }
    }
  });

  it('the owner gets the same 404 on the bare-id route: operators read the tenant route, which serves the same quote', async () => {
    const unknown = await bareId(ID.ownerA, UNKNOWN_QUOTE);
    for (const quoteId of [ID.qDraft, ID.qSent, ID.qAccepted, ID.qDeleted]) {
      const bare = await bareId(ID.ownerA, quoteId);
      expect(bare.status, quoteId).toBe(404);
      expect(stripVolatile(bare.body)).toEqual(stripVolatile(unknown.body));
    }
    const tenant = await detail(ID.ownerA, ID.qSent);
    expect(tenant.status).toBe(200);
  });

  it('the bare-id route is throttled: the 21st anonymous read inside one minute is 429', async () => {
    for (let i = 1; i <= 20; i += 1) {
      const res = await bareId(null, `${P}probe_${i}`);
      expect(res.status, `request ${i}`).toBe(404);
    }
    const blocked = await bareId(null, ID.qSent);
    expect(blocked.status).toBe(429);
    expectNoCanary(blocked.body);
  });

  it('bare-id reads mutate nothing (a SENT quote is not stamped viewed)', async () => {
    const before = await db.quote.findUnique({ where: { id: ID.qSent }, select: { updatedAt: true, viewedAt: true } });
    await bareId(null, ID.qSent);
    await bareId(ID.ownerA, ID.qSent);
    const after = await db.quote.findUnique({ where: { id: ID.qSent }, select: { updatedAt: true, viewedAt: true } });
    expect(after).toEqual(before);
  });
});

describe('regression control: the signed-token public quote route is unchanged', () => {
  it('GET /commerce/public/quotes/:token still serves the shared quote to an anonymous holder of the token', async () => {
    // The ACCEPTED quote is past SENT, so the read stamps nothing.
    const res = await agent().get(`/commerce/public/quotes/${ACCEPTED_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID.qAccepted);
    expect(res.body.status).toBe('ACCEPTED');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('an unknown token is still refused (403), as before', async () => {
    const res = await agent().get(`/commerce/public/quotes/${P}tok_unknown`);
    expect(res.status).toBe(403);
    expectNoCanary(res.body);
  });
});

// ST-PC01-1 (review): the KEY commerce adapter's getQuoteStatus still reads the
// tenant-unbound CommerceService.getQuote(id) and ignores input.businessId, so
// a KEY command for one tenant can read another tenant's DRAFT quote, customer
// email, notes and invoice link (reproduced against this harness). The fix
// belongs in commerce-adapter.service.ts, outside the R0-PC-01 write set; it is
// a follow-up packet. Pinned here: the service-level replacement read it needs.
describe('ST-PC01-1: the tenant-bound server-side quote read a KEY caller must use (service level, real DB)', () => {
  it('getQuoteForBusiness called directly binds the read to the tenant: another tenant\'s id, an unknown id and a soft-deleted row read as null', async () => {
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const commerce = app.get(CommerceService);
    expect(await commerce.getQuoteForBusiness(ID.qDraft, ID.bizB)).toBeNull();
    expect(await commerce.getQuoteForBusiness(ID.qB, ID.bizA)).toBeNull();
    expect(await commerce.getQuoteForBusiness(UNKNOWN_QUOTE, ID.bizA)).toBeNull();
    expect(await commerce.getQuoteForBusiness(ID.qDeleted, ID.bizA)).toBeNull();
    // Positive control: the owning tenant reads its DRAFT in the full operator shape.
    const own = JSON.parse(JSON.stringify(await commerce.getQuoteForBusiness(ID.qDraft, ID.bizA)));
    expectOperatorShape(own, ID.qDraft);
  });

  it('KEY CommerceAdapterService.getQuoteStatus({ businessId: bizB, quoteId: <bizA DRAFT> }) throws NotFound and leaks nothing; the owning tenant still reads it (ST-PC01-1)', async () => {
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
    const adapter = new CommerceAdapterService(app.get(CommerceService));
    let thrown: any = null;
    try {
      await adapter.getQuoteStatus({ businessId: ID.bizB, quoteId: ID.qDraft });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.constructor?.name).toBe('NotFoundException');
    const text = JSON.stringify(thrown?.getResponse?.() ?? {});
    expect(text).not.toContain(ID.bizA);
    expect(text).not.toContain('@');
    // Positive control: the owning tenant reads its own DRAFT through the adapter.
    const own = await adapter.getQuoteStatus({ businessId: ID.bizA, quoteId: ID.qDraft });
    expect((own as any).id).toBe(ID.qDraft);
    expect((own as any).businessId).toBe(ID.bizA);
  });
});

// ---------------------------------------------------------------------------
// OPEN DEFECT ST-R004-1 (review of R0-04-QT-DETAIL-ROUTE) — reproduced, NOT
// fixed here.
//
// The cases above prove that the tenant detail route binds the QUOTE ROW to
// the path tenant. They do not prove that the rows the route joins belong to
// that tenant, and today they need not: createQuote (commerce.service.ts:1404)
// and updateQuote (:1471) write body.contactId with no check that the contact
// belongs to the path tenant, and OPERATOR_QUOTE_INCLUDE (:76) joins `contact`
// with no tenant condition (neither Prisma extension filters a nested include
// or a nested create). A tenant-B owner can point a B quote at A's contact,
// and B's detail read then serves A's customer name and email.
//
// The case below pins TODAY's observed behaviour so the defect is recorded by
// an executing test, not by prose; it is NOT a certification of that
// behaviour. It turns red when the fix lands, and the fix packet replaces it
// with the required behaviour: a contactId of another tenant on quote create
// or patch answers 404, byte-identical to an unknown contact, and writes or
// changes no Quote row; the operator detail never serves another tenant's
// contact. The fix is in commerce.service.ts (and the quote create DTO),
// outside this proof packet's write set (the manifest only). It belongs with
// V1-53-QUOTE-CREATE-ERRORS, the quote half of R0-27's tenant-checked contact.
// Until it lands, this suite is not joined-row tenancy evidence (Release 0
// journey step 6).
// ---------------------------------------------------------------------------
describe("ST-R004-1 — quote create and patch bind only a contact of the path tenant (fixed by R0-27 review ST-27-2)", () => {
  // R0-27's repair routed createQuote, updateQuote and quote convert through
  // CommerceService.assertContactInBusiness, so the create and patch halves of
  // ST-R004-1 are closed: another tenant's contactId answers exactly what an
  // unknown contactId answers and nothing is written. What remains open is the
  // read half for rows written BEFORE that fix (pinned below).
  const strip = (b: Record<string, unknown>) => {
    const { timestamp: _t, path: _p, ...rest } = b;
    return rest;
  };

  it("create on B's path with A's contactId answers the unknown-contact 404 and writes no quote", async () => {
    const before = await db.quote.count({ where: { businessId: ID.bizB } });
    const foreign = await withActor(agent().post(`/commerce/businesses/${ID.bizB}/quotes`), ID.ownerB).send({
      contactId: ID.contactA,
      items: [{ description: 'CQV probe', quantity: 1, unitPrice: 1 }],
    });
    const unknown = await withActor(agent().post(`/commerce/businesses/${ID.bizB}/quotes`), ID.ownerB).send({
      contactId: `${P}no_such_contact`,
      items: [{ description: 'CQV probe', quantity: 1, unitPrice: 1 }],
    });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(strip(foreign.body)).toEqual(strip(unknown.body));
    expect(JSON.stringify(foreign.body)).not.toContain(CANARY);
    expect(await db.quote.count({ where: { businessId: ID.bizB } })).toBe(before);
    expect(await db.quote.count({ where: { businessId: ID.bizB, contactId: ID.contactA } })).toBe(0);
  });

  it("patch of a B quote to A's contactId answers the unknown-contact 404 and leaves the quote on B's contact", async () => {
    const own = await withActor(agent().post(`/commerce/businesses/${ID.bizB}/quotes`), ID.ownerB).send({
      contactId: ID.contactB,
      items: [{ description: 'CQV probe', quantity: 1, unitPrice: 1 }],
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    try {
      const foreign = await withActor(agent().patch(`/commerce/businesses/${ID.bizB}/quotes/${own.body.id}`), ID.ownerB).send({
        contactId: ID.contactA,
      });
      const unknown = await withActor(agent().patch(`/commerce/businesses/${ID.bizB}/quotes/${own.body.id}`), ID.ownerB).send({
        contactId: `${P}no_such_contact`,
      });
      expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
      expect(JSON.stringify(foreign.body)).not.toContain(CANARY);
      expect((await db.quote.findUnique({ where: { id: own.body.id } }))?.contactId).toBe(ID.contactB);
    } finally {
      await db.$executeRawUnsafe('DELETE FROM quotes WHERE id = $1', own.body.id);
    }
  });

  // OPEN DEFECT (legacy rows; R0-CMF3-QUOTE-CONTACT-TENANT): OPERATOR_QUOTE_INCLUDE
  // still joins `contact` with no tenant condition, so a B quote that already
  // points at A's contact (written before R0-27's fix) still serves A's customer
  // email on B's detail route. This case pins TODAY's behaviour; CMF3 replaces it
  // with the required one (the detail returns contact null for a foreign row).
  it("OPEN DEFECT ST-R004-1 (legacy row) reproduced — a B quote written before the fix with A's contactId still serves A's customer email on B's detail route", async () => {
    const legacyId = `${P}q_legacy_foreign_contact`;
    await db.quote.create({
      data: {
        id: legacyId,
        quoteNumber: 'CQV-ST-R004-1-legacy',
        status: 'DRAFT',
        subtotal: 1,
        total: 1,
        currency: 'TTD',
        businessId: ID.bizB,
        contactId: ID.contactA,
        items: { create: [{ id: `${legacyId}_item1`, description: 'CQV legacy', quantity: 1, unitPrice: 1, total: 1 }] },
      },
    });
    try {
      const read = await detail(ID.ownerB, legacyId, ID.bizB);
      expect(read.status).toBe(200);
      expect(read.body.businessId).toBe(ID.bizB);
      expect(read.body.contact?.email).toBe(`${CANARY}customer@test.local`);
    } finally {
      await db.$executeRawUnsafe('DELETE FROM quotes WHERE id = $1', legacyId);
    }
  });
});
