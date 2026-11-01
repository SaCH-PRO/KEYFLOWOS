/**
 * R0-04 / R0-CMF3-QUOTE-CONTACT-TENANT — a quote binds and serves only a
 * contact of its own tenant (REAL database).
 *
 * R0-04 review finding ST-R004-1 (should-fix, reproduced on a real DB): the
 * tenant-bound quote detail route (R0-PC-01) binds the QUOTE ROW to the path
 * tenant, but not the rows it joins. createQuote and updateQuote wrote
 * body.contactId with no tenant check, and OPERATOR_QUOTE_INCLUDE joins
 * `contact` with no tenant condition (neither Prisma extension filters a
 * nested include or a nested create). So tenant B's owner could point a B
 * quote at tenant A's contact, receive A's whole contact row (email, phone)
 * in the 201/200 body, and B's detail read then served A's customer name and
 * email.
 *
 * Contract pinned here:
 *
 *   POST  businesses/B/quotes { contactId: <A's contact> }   -> 404 'Contact not found', byte-identical
 *         (volatile envelope fields stripped) to an unknown contact; no Quote row written, nothing echoed
 *   PATCH businesses/B/quotes/:id { contactId: <A's contact> } -> the same 404; the quote row and its items
 *         are byte-identical (the refusal comes before the item rewrite)
 *   a soft-deleted contact of B                              -> the same 404 on create and patch
 *   GET   businesses/B/quotes/:id of a LEGACY B quote that already points at A's contact (written before
 *         the check) -> 200 with contact null; A's name and email never leave the server. Same for the two
 *         server-side readers of the operator include (getQuote, getQuoteForBusiness)
 *   PATCH of that legacy quote without a contactId          -> 200 with contact null (no echo of A's row);
 *         re-pointing it at a B contact repairs it
 *   same-tenant create, update and detail                    -> unchanged (positive controls)
 *   LEDGER: no refused create or patch writes a FinancialTransaction
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService and the production
 * GlobalHttpExceptionFilter + ValidationPipe run against DATABASE_URL.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-k04b-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. Collaborators off the
 * boundary (event bus, CRM timeline, stats cache, Gmail, vision, ledger
 * posting) are recorders or stubs, so a refused write can be shown to have
 * emitted nothing.
 *
 * Fixtures: prefix `k04b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Every string of A's contact carries the canary
 * `K04B_SECRET_`, which must never appear in an answer to B's owner. One quote
 * per mutating case, so no case reads another's write.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k04b_';
const HEADER = 'x-k04b-user';
const CANARY = 'K04B_SECRET_';

const ID = {
  // identities
  ownerA: `${P}ownerA`, // OWNER of bizA
  ownerB: `${P}ownerB`, // OWNER of bizB only
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts
  contactA: `${P}contactA`,               // A's customer: every string is a canary
  contactB: `${P}contactB`,               // B's customer
  contactB2: `${P}contactB2`,             // B's second customer (same-tenant re-point)
  contactBDeleted: `${P}contactBDeleted`, // B's soft-deleted customer
  unknownContact: `${P}contact_unknown`,  // no such row
  // quotes seeded directly (legacy rows bypass the service on purpose)
  qLegacyRead: `${P}qLegacyRead`,         // B quote pointing at A's contact (read cases)
  qLegacyPatch: `${P}qLegacyPatch`,       // B quote pointing at A's contact (patch case)
  qOwnB: `${P}qOwnB`,                     // B quote on B's own contact (read control)
};

const A_CONTACT = {
  firstName: `${CANARY}first`,
  lastName: `${CANARY}last`,
  email: `${CANARY}${P}customer@test.local`,
  phone: `${CANARY}phone`,
};
const B_CONTACT = { firstName: 'K04b', lastName: 'CustomerB', email: `${P}b@test.local` };
const B2_CONTACT = { firstName: 'K04b', lastName: 'CustomerB2', email: `${P}b2@test.local` };

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
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

function asOwnerB(req: request.Test) {
  return req.set(HEADER, ID.ownerB);
}

function createQuoteOnB(body: Record<string, unknown>) {
  return asOwnerB(agent().post(`/commerce/businesses/${ID.bizB}/quotes`)).send(body);
}

function patchQuoteOnB(quoteId: string, body: Record<string, unknown>) {
  return asOwnerB(agent().patch(`/commerce/businesses/${ID.bizB}/quotes/${quoteId}`)).send(body);
}

function detailOnB(quoteId: string) {
  return asOwnerB(agent().get(`/commerce/businesses/${ID.bizB}/quotes/${quoteId}`));
}

/** Error bodies differ only in volatile envelope fields; strip those before comparing. */
function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

/** Nothing of A's contact (name, email, phone) reaches B's owner. */
function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {})).not.toContain(CANARY);
}

const ITEMS = [{ description: 'K04B line', quantity: 2, unitPrice: 10 }];

/** Seed one B quote directly (one per mutating case), with one item. */
async function seedQuote(id: string, contactId: string, number: string) {
  return db.quote.create({
    data: {
      id,
      quoteNumber: `${P}${number}`,
      status: 'DRAFT',
      subtotal: 20,
      total: 20,
      currency: 'TTD',
      notes: `${P}notes ${number}`,
      businessId: ID.bizB,
      contactId,
      items: { create: [{ id: `${id}_item1`, description: `K04B item ${number}`, quantity: 2, unitPrice: 10, total: 20 }] },
    },
  });
}

/** The full stored state of one quote and its items, for byte-identity checks. */
async function quoteState(id: string) {
  const quote = await db.quote.findUnique({ where: { id } });
  const items = await db.quoteItem.findMany({ where: { quoteId: id }, orderBy: { id: 'asc' } });
  return JSON.parse(JSON.stringify({ quote, items }));
}

async function ledgerCount() {
  return db.financialTransaction.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });
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

  // ---- identities, tenants, memberships -----------------------------------
  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K04B Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'K04B Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // ---- contacts ------------------------------------------------------------
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, ...A_CONTACT } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, ...B_CONTACT } });
  await db.contact.create({ data: { id: ID.contactB2, businessId: ID.bizB, ...B2_CONTACT } });
  await db.contact.create({
    data: { id: ID.contactBDeleted, businessId: ID.bizB, firstName: 'K04b', lastName: 'Gone', email: `${P}gone@test.local`, deletedAt: new Date() },
  });

  // ---- quotes: B's own, and two LEGACY B quotes already joined to A's contact
  // (written straight to the table, as rows created before the tenant check were).
  await seedQuote(ID.qOwnB, ID.contactB, 'OWN-B');
  await seedQuote(ID.qLegacyRead, ID.contactA, 'LEGACY-READ');
  await seedQuote(ID.qLegacyPatch, ID.contactA, 'LEGACY-PATCH');
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it("seeded two tenants, B's live and soft-deleted contacts, A's canary contact, B's own quote and two legacy B quotes joined to A's contact", async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    const a = await db.contact.findUnique({ where: { id: ID.contactA }, select: { businessId: true, email: true } });
    expect(a).toEqual({ businessId: ID.bizA, email: A_CONTACT.email });
    const rows = await db.$queryRawUnsafe(`SELECT id, deleted_at FROM contacts WHERE id = '${ID.contactBDeleted}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
    // The legacy rows really are B quotes pointing at A's contact.
    expect(await db.quote.count({ where: { businessId: ID.bizB, contactId: ID.contactA } })).toBe(2);
    expect(await db.quote.count({ where: { businessId: ID.bizB, contactId: ID.contactB } })).toBe(1);
  });
});

describe("POST /commerce/businesses/:businessId/quotes resolves contactId inside the path tenant", () => {
  it("B's owner naming A's contact gets 404, byte-identical to an unknown contact; no Quote row is written, A's contact is not echoed, nothing is emitted", async () => {
    const quotesBefore = await db.quote.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });
    const ledgerBefore = await ledgerCount();

    const foreign = await createQuoteOnB({ contactId: ID.contactA, quoteNumber: `${P}POST-FOREIGN`, items: ITEMS });
    const unknown = await createQuoteOnB({ contactId: ID.unknownContact, quoteNumber: `${P}POST-UNKNOWN`, items: ITEMS });

    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(foreign.body.message).toBe('Contact not found');
    expect(stripVolatile(foreign.body)).toEqual(stripVolatile(unknown.body));
    expectNoCanary(foreign.body);
    expect(JSON.stringify(foreign.body)).not.toContain(ID.bizA);

    expect(await db.quote.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(quotesBefore);
    expect(await db.quote.count({ where: { quoteNumber: { in: [`${P}POST-FOREIGN`, `${P}POST-UNKNOWN`] } } })).toBe(0);
    expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
    expect(crmCalls).toEqual([]);
    expect(await ledgerCount()).toBe(ledgerBefore);
  });

  it("a soft-deleted contact of B answers the same 404 on create, and nothing is written", async () => {
    const quotesBefore = await db.quote.count({ where: { businessId: ID.bizB } });
    const deleted = await createQuoteOnB({ contactId: ID.contactBDeleted, quoteNumber: `${P}POST-DELETED`, items: ITEMS });
    const unknown = await createQuoteOnB({ contactId: ID.unknownContact, quoteNumber: `${P}POST-UNKNOWN-2`, items: ITEMS });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(404);
    expect(stripVolatile(deleted.body)).toEqual(stripVolatile(unknown.body));
    expect(await db.quote.count({ where: { businessId: ID.bizB } })).toBe(quotesBefore);
  });

  it("positive control: B's owner creating with B's own contact gets 201 with B's contact, and B's detail route serves it", async () => {
    const res = await createQuoteOnB({ contactId: ID.contactB, quoteNumber: `${P}POST-OWN`, items: ITEMS });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.businessId).toBe(ID.bizB);
    expect(res.body.contactId).toBe(ID.contactB);
    expect(res.body.contact).toMatchObject({ id: ID.contactB, businessId: ID.bizB, email: B_CONTACT.email });
    expect(Number(res.body.total)).toBe(20);
    expect(recordedEvents.map((e) => e.name)).toContain('quote.created');

    const detail = await detailOnB(res.body.id);
    expect(detail.status).toBe(200);
    expect(detail.body.contact).toEqual(B_CONTACT);
  });
});

describe('PATCH /commerce/businesses/:businessId/quotes/:quoteId resolves contactId inside the path tenant', () => {
  it("B's owner re-pointing a B quote at A's contact (with new items and notes) gets 404, byte-identical to an unknown contact; the quote row and its items are byte-identical", async () => {
    const qid = `${P}qPatchForeign`;
    await seedQuote(qid, ID.contactB, 'PATCH-FOREIGN');
    const before = await quoteState(qid);
    const ledgerBefore = await ledgerCount();

    const body = { items: [{ description: 'K04B replaced', quantity: 9, unitPrice: 9 }], notes: `${P}changed` };
    const foreign = await patchQuoteOnB(qid, { ...body, contactId: ID.contactA });
    const unknown = await patchQuoteOnB(qid, { ...body, contactId: ID.unknownContact });

    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(foreign.body.message).toBe('Contact not found');
    expect(stripVolatile(foreign.body)).toEqual(stripVolatile(unknown.body));
    expectNoCanary(foreign.body);

    expect(await quoteState(qid)).toEqual(before);
    expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
    expect(await ledgerCount()).toBe(ledgerBefore);
  });

  it("a soft-deleted contact of B answers the same 404 on patch, and the quote is unchanged", async () => {
    const qid = `${P}qPatchDeleted`;
    await seedQuote(qid, ID.contactB, 'PATCH-DELETED');
    const before = await quoteState(qid);
    const deleted = await patchQuoteOnB(qid, { contactId: ID.contactBDeleted });
    const unknown = await patchQuoteOnB(qid, { contactId: ID.unknownContact });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(404);
    expect(stripVolatile(deleted.body)).toEqual(stripVolatile(unknown.body));
    expect(await quoteState(qid)).toEqual(before);
  });

  it("positive control: B's owner re-pointing a B quote at another B contact gets 200, and B's detail route serves the new contact", async () => {
    const qid = `${P}qPatchOwn`;
    await seedQuote(qid, ID.contactB, 'PATCH-OWN');
    const res = await patchQuoteOnB(qid, { contactId: ID.contactB2, notes: `${P}repointed` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contactId).toBe(ID.contactB2);
    expect(res.body.contact).toMatchObject({ id: ID.contactB2, businessId: ID.bizB, lastName: 'CustomerB2' });
    expect(res.body.notes).toBe(`${P}repointed`);

    const detail = await detailOnB(qid);
    expect(detail.status).toBe(200);
    expect(detail.body.contact).toEqual(B2_CONTACT);
  });

  it("a PATCH of a legacy B quote already joined to A's contact (no contactId in the body) answers 200 with contact null, never A's row; re-pointing it at B's contact repairs it", async () => {
    const res = await patchQuoteOnB(ID.qLegacyPatch, { notes: `${P}legacy edit` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(ID.qLegacyPatch);
    expect(res.body.notes).toBe(`${P}legacy edit`);
    expect(res.body.contact).toBeNull();
    expectNoCanary(res.body);
    // The event listeners receive the same tenant-bound shape.
    const updated = recordedEvents.filter((e) => e.name === 'quote.updated');
    expect(updated).toHaveLength(1);
    expectNoCanary(updated[0].payload);

    const repaired = await patchQuoteOnB(ID.qLegacyPatch, { contactId: ID.contactB });
    expect(repaired.status, JSON.stringify(repaired.body)).toBe(200);
    expect(repaired.body.contactId).toBe(ID.contactB);
    expect(repaired.body.contact).toMatchObject({ id: ID.contactB, businessId: ID.bizB });
    const detail = await detailOnB(ID.qLegacyPatch);
    expect(detail.body.contact).toEqual(B_CONTACT);
  });
});

describe("GET /commerce/businesses/:businessId/quotes/:quoteId: the operator include joins only a contact of the quote's tenant", () => {
  it("a legacy B quote already joined to A's contact answers 200 with contact null: A's customer name and email are not served, and the read writes nothing", async () => {
    const before = await quoteState(ID.qLegacyRead);
    const res = await detailOnB(ID.qLegacyRead);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(ID.qLegacyRead);
    expect(res.body.businessId).toBe(ID.bizB);
    expect(res.body.contact).toBeNull();
    expectNoCanary(res.body);
    // The rest of the operator shape is served as before.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.business).toMatchObject({ id: ID.bizB, name: 'K04B Biz B' });
    expect(typeof res.body.lifecycleStep).toBe('string');
    expect(await quoteState(ID.qLegacyRead)).toEqual(before);
  });

  it("the server-side readers of the operator include, getQuote (sendQuoteEmail) and getQuoteForBusiness (KEY getQuoteStatus), answer contact null for the legacy row too", async () => {
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const commerce = app.get(CommerceService);
    const bare = JSON.parse(JSON.stringify(await commerce.getQuote(ID.qLegacyRead)));
    const bound = JSON.parse(JSON.stringify(await commerce.getQuoteForBusiness(ID.qLegacyRead, ID.bizB)));
    for (const quote of [bare, bound]) {
      expect(quote.id).toBe(ID.qLegacyRead);
      expect(quote.contact).toBeNull();
      expectNoCanary(quote);
    }
  });

  it("positive control: B's own quote still carries exactly { firstName, lastName, email } of its contact (shape unchanged), and A's owner still reads A's contact on A's own quotes", async () => {
    const res = await detailOnB(ID.qOwnB);
    expect(res.status).toBe(200);
    expect(res.body.contactId).toBe(ID.contactB);
    expect(res.body.contact).toEqual(B_CONTACT);

    const qid = `${P}qOwnA`;
    await db.quote.create({
      data: { id: qid, quoteNumber: `${P}OWN-A`, status: 'DRAFT', subtotal: 5, total: 5, currency: 'TTD', businessId: ID.bizA, contactId: ID.contactA },
    });
    const own = await agent().get(`/commerce/businesses/${ID.bizA}/quotes/${qid}`).set(HEADER, ID.ownerA);
    expect(own.status).toBe(200);
    expect(own.body.contact).toEqual({ firstName: A_CONTACT.firstName, lastName: A_CONTACT.lastName, email: A_CONTACT.email });
  });
});
