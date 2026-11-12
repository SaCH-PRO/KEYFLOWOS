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
 * R0-CMF3 review (ST-CMF3-1/2/3, CR-CMF3-1): every other reader in
 * commerce.service.ts that joins the quote's contact, on the same legacy rows:
 *
 *   PATCH /commerce/quotes/:id/status/sent, POST businesses/B/quotes/:id/send-email (updateQuoteStatus)
 *         -> contact null in the answer; quote.sent carries neither A's contact nor its id (flow.listener
 *         emails quote.contact; the CRM listeners log quote.contactId), no timeline write names A's contact
 *   GET public/quotes/:token, POST public/quotes/:token/accept|reject
 *         -> contact null; quote.viewed / accepted / rejected, the timeline and the visitor stitch never
 *         name A's contact; on B's own quote accept/reject answers only { firstName, lastName, email }
 *         (it answered the whole Contact row, phone and internal notes included, to an anonymous caller)
 *   GET businesses/B/quotes, quotes/stale, POST quotes/:id/follow-up
 *         -> contact null for the legacy row; quote.stale and the follow-up timeline write never name A's
 *         contact; B's own rows keep their contact (the list shape is otherwise unchanged)
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
import { quoteTermsVersion } from '../src/modules/commerce/quote-workflow';

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

// R0-CMF3 review: the visitor stitch and the outbound email are recorded too,
// so a case can show that nothing was attached to (or sent about) A's contact.
const visitorAttaches: unknown[] = [];
const publicEventsRecorder = {
  attachVisitorToContact: async (input: unknown) => {
    visitorAttaches.push(input);
    return undefined;
  },
};
const gmailCalls: unknown[] = [];
const gmailRecorder = {
  sendEmail: async (input: unknown) => {
    gmailCalls.push(input);
    return { id: `${P}mail_${gmailCalls.length}` };
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Seed one SENT B quote with a signed view token (the public and stale cases). */
async function seedSentQuote(id: string, contactId: string, opts: { token?: string; sentDaysAgo?: number } = {}) {
  return db.quote.create({
    data: {
      id,
      quoteNumber: `${P}${id.slice(P.length)}`,
      status: 'SENT',
      subtotal: 20,
      total: 20,
      currency: 'TTD',
      businessId: ID.bizB,
      contactId,
      viewToken: opts.token ?? null,
      sentAt: new Date(Date.now() - (opts.sentDaysAgo ?? 0) * DAY_MS),
      items: { create: [{ id: `${id}_item1`, description: `K04B item ${id}`, quantity: 2, unitPrice: 10, total: 20 }] },
    },
  });
}

/**
 * Nothing that leaves the request (an event, a timeline write, a visitor
 * stitch, an email) names A's contact: neither its id nor any of its fields.
 */
function expectNoForeignContactSideEffects() {
  const sideEffects = JSON.stringify({ recordedEvents, crmCalls, visitorAttaches, gmailCalls });
  expect(sideEffects).not.toContain(CANARY);
  expect(sideEffects).not.toContain(ID.contactA);
}

/** The recorded events of one name, by quote id. */
function eventsFor(name: string, quoteId: string) {
  return recordedEvents
    .filter((e) => e.name === name && (e.payload as { quote?: { id?: string } }).quote?.id === quoteId)
    .map((e) => e.payload as { quote: { id: string; contactId: string | null; contact: Record<string, unknown> | null } });
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
      { provide: PublicEventsService, useValue: publicEventsRecorder },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: gmailRecorder },
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
  visitorAttaches.length = 0;
  gmailCalls.length = 0;
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

// R0-CMF3 review (ST-CMF3-1, CR-CMF3-1): updateQuoteStatus, behind the status
// route, send-email and the public accept/reject, joined the contact with no
// tenant condition: A's name and email in the 200, A's whole row in quote.sent
// (which flow.listener uses to email the customer), and a timeline write naming
// A's contact under B.
describe("PATCH /commerce/quotes/:quoteId/status/:status and send-email (updateQuoteStatus) act only on a contact of the quote's tenant", () => {
  it("the status route on a legacy B quote joined to A's contact answers 200 with contact null; quote.sent carries neither A's contact nor its id, and nothing is logged against it", async () => {
    const qid = `${P}qStatusLegacy`;
    await seedQuote(qid, ID.contactA, 'STATUS-LEGACY');
    const res = await asOwnerB(agent().patch(`/commerce/quotes/${qid}/status/sent`)).send({ businessId: ID.bizB });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(qid);
    expect(res.body.status).toBe('SENT');
    expect(res.body.contact).toBeNull();
    expectNoCanary(res.body);

    const sent = eventsFor('quote.sent', qid);
    expect(sent).toHaveLength(1);
    expect(sent[0].quote.contact).toBeNull();
    expect(sent[0].quote.contactId).toBeNull();
    expect(crmCalls).toEqual([]);
    expectNoForeignContactSideEffects();

    // The status change itself is written; the stored contact is not re-pointed behind the operator's back.
    const row = await db.quote.findUnique({ where: { id: qid }, select: { status: true, contactId: true } });
    expect(row).toEqual({ status: 'SENT', contactId: ID.contactA });
  });

  it("send-email on a legacy DRAFT B quote joined to A's contact answers 201 with contact null; the quote.sent it emits and the email it sends never name A's contact", async () => {
    const qid = `${P}qSendLegacy`;
    await seedQuote(qid, ID.contactA, 'SEND-LEGACY');
    const res = await asOwnerB(agent().post(`/commerce/businesses/${ID.bizB}/quotes/${qid}/send-email`)).send({ recipientEmail: `${P}operator-choice@test.local` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.quote.contact).toBeNull();
    expectNoCanary(res.body);

    const sent = eventsFor('quote.sent', qid);
    expect(sent).toHaveLength(1);
    expect(sent[0].quote.contact).toBeNull();
    expect(sent[0].quote.contactId).toBeNull();
    // Only the address the operator typed is emailed.
    expect(gmailCalls).toHaveLength(1);
    expect((gmailCalls[0] as { to: string }).to).toBe(`${P}operator-choice@test.local`);
    expect(crmCalls).toEqual([]);
    expectNoForeignContactSideEffects();
  });

  it("positive control: the status route on B's own quote answers exactly { firstName, lastName, email } of B's contact, and quote.sent and the timeline still name B's contact", async () => {
    const qid = `${P}qStatusOwn`;
    await seedQuote(qid, ID.contactB, 'STATUS-OWN');
    const res = await asOwnerB(agent().patch(`/commerce/quotes/${qid}/status/sent`)).send({ businessId: ID.bizB });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contact).toEqual(B_CONTACT);

    const sent = eventsFor('quote.sent', qid);
    expect(sent).toHaveLength(1);
    expect(sent[0].quote.contactId).toBe(ID.contactB);
    expect(sent[0].quote.contact).toMatchObject({ id: ID.contactB, email: B_CONTACT.email });
    expect(crmCalls).toEqual([expect.objectContaining({ businessId: ID.bizB, contactId: ID.contactB, type: 'quote.sent' })]);
  });
});

// R0-CMF3 review (ST-CMF3-2, CR-CMF3-1): the signed-token readers served A's
// name and email to the link holder, and accept/reject answered A's WHOLE
// Contact row (phone, internal notes, owner, visibility) to an anonymous
// caller; the whole-row answer was a disclosure for B's own contacts too.
describe("the signed-token public quote routes serve and act on only a contact of the quote's tenant", () => {
  it("GET /commerce/public/quotes/:token of a legacy B quote joined to A's contact answers 200 with contact null; quote.viewed, the timeline and the visitor stitch never name A's contact", async () => {
    const qid = `${P}qPubViewLegacy`;
    const token = `${P}tok_view_legacy_0123456789`;
    await seedSentQuote(qid, ID.contactA, { token });
    const res = await agent().get(`/commerce/public/quotes/${token}`).set('x-visitor-id', `${P}visitor_view`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(qid);
    expect(res.body.contact).toBeNull();
    expectNoCanary(res.body);

    const viewed = eventsFor('quote.viewed', qid);
    expect(viewed).toHaveLength(1);
    expect(viewed[0].quote.contact).toBeNull();
    expect(viewed[0].quote.contactId).toBeNull();
    expect(crmCalls).toEqual([]);
    expect(visitorAttaches).toEqual([]);
    expectNoForeignContactSideEffects();
  });

  it("POST accept and reject of legacy B quotes joined to A's contact answer 201 with contact null; the decision is recorded, and quote.accepted / quote.rejected, the timeline and the visitor stitch never name A's contact", async () => {
    const accepted = `${P}qPubAcceptLegacy`;
    const rejected = `${P}qPubRejectLegacy`;
    await seedSentQuote(accepted, ID.contactA, { token: `${P}tok_accept_legacy_0123456789` });
    await seedSentQuote(rejected, ID.contactA, { token: `${P}tok_reject_legacy_0123456789` });

    // V1-QUOTE-CHAIN-finish (SEC-5): the accept names the terms version the view serves (read from the row: no view stamped).
    const legacyTerms = quoteTermsVersion(await db.quote.findUnique({ where: { id: accepted }, include: { items: true } }));
    const acc = await agent()
      .post(`/commerce/public/quotes/${P}tok_accept_legacy_0123456789/accept`)
      .send({ visitorId: `${P}visitor_acc`, termsVersion: legacyTerms });
    const rej = await agent().post(`/commerce/public/quotes/${P}tok_reject_legacy_0123456789/reject`).send({ reason: 'no', visitorId: `${P}visitor_rej` });
    for (const [res, id, status] of [[acc, accepted, 'ACCEPTED'], [rej, rejected, 'REJECTED']] as const) {
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBe(id);
      expect(res.body.status).toBe(status);
      expect(res.body.contact).toBeNull();
      expectNoCanary(res.body);
      expect((await db.quote.findUnique({ where: { id }, select: { status: true } })).status).toBe(status);
    }

    for (const [name, id] of [['quote.accepted', accepted], ['quote.rejected', rejected]]) {
      const emitted = eventsFor(name, id);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].quote.contact).toBeNull();
      expect(emitted[0].quote.contactId).toBeNull();
    }
    expect(crmCalls).toEqual([]);
    expect(visitorAttaches).toEqual([]);
    expectNoForeignContactSideEffects();
  });

  it("positive control: on B's own quote the token view and the accept answer exactly { firstName, lastName, email } (never the contact's phone or internal notes), and quote.accepted, the timeline and the visitor stitch still name B's contact", async () => {
    const contactId = `${P}contactBPrivate`;
    const PRIVATE = 'K04B_BPRIVATE_';
    const named = { firstName: 'K04b', lastName: 'CustomerBPrivate', email: `${P}bprivate@test.local` };
    await db.contact.create({
      data: { id: contactId, businessId: ID.bizB, ...named, phone: `${PRIVATE}phone`, notesInternal: `${PRIVATE}notes` },
    });
    const qid = `${P}qPubOwn`;
    const token = `${P}tok_own_0123456789abcdef`;
    await seedSentQuote(qid, contactId, { token });

    const view = await agent().get(`/commerce/public/quotes/${token}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.contact).toEqual(named);

    // V1-QUOTE-CHAIN-finish (SEC-5): the accept names the terms version the view served.
    expect(typeof view.body.termsVersion).toBe('string');
    const acc = await agent().post(`/commerce/public/quotes/${token}/accept`).send({ visitorId: `${P}visitor_own`, termsVersion: view.body.termsVersion });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    expect(acc.body.status).toBe('ACCEPTED');
    expect(acc.body.contact).toEqual(named);
    expect(JSON.stringify(acc.body)).not.toContain(PRIVATE);

    const emitted = eventsFor('quote.accepted', qid);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].quote.contactId).toBe(contactId);
    expect(emitted[0].quote.contact).toMatchObject({ id: contactId, email: named.email });
    expect(crmCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ businessId: ID.bizB, contactId, type: 'quote.accepted' })]),
    );
    expect(visitorAttaches).toEqual(
      expect.arrayContaining([expect.objectContaining({ businessId: ID.bizB, contactId, visitorId: `${P}visitor_own` })]),
    );
  });
});

// R0-CMF3 review (ST-CMF3-3): the list, stale and follow-up readers joined the
// contact's whole row with no tenant condition, and the stale scan and the
// follow-up named A's contact in an event and a timeline write under B.
describe("GET businesses/:businessId/quotes, quotes/stale and POST quotes/:quoteId/follow-up serve and act on only a contact of the quote's tenant", () => {
  it("the quote list serves a legacy B quote joined to A's contact with contact null, and nothing of A's contact anywhere in the page; B's own quote keeps its contact", async () => {
    const res = await asOwnerB(agent().get(`/commerce/businesses/${ID.bizB}/quotes`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map<string, any>(res.body.data.map((q: any) => [q.id, q]));
    expect(byId.has(ID.qLegacyRead)).toBe(true);
    expect(byId.get(ID.qLegacyRead).contact).toBeNull();
    expectNoCanary(res.body);
    expect(byId.get(ID.qOwnB)?.contact).toMatchObject({ id: ID.contactB, email: B_CONTACT.email });
  });

  it("the stale list serves a stale legacy B quote with contact null, and its quote.stale event carries neither A's contact nor its id; B's own stale quote keeps its contact", async () => {
    const legacy = `${P}qStaleLegacy`;
    const own = `${P}qStaleOwn`;
    await seedSentQuote(legacy, ID.contactA, { sentDaysAgo: 30 });
    await seedSentQuote(own, ID.contactB, { sentDaysAgo: 30 });
    const res = await asOwnerB(agent().get(`/commerce/businesses/${ID.bizB}/quotes/stale`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map<string, any>(res.body.map((q: any) => [q.id, q]));
    expect(byId.has(legacy)).toBe(true);
    expect(byId.get(legacy).contact).toBeNull();
    expectNoCanary(res.body);

    const legacyEvents = eventsFor('quote.stale', legacy);
    expect(legacyEvents).toHaveLength(1);
    expect(legacyEvents[0].quote.contact).toBeNull();
    expect(legacyEvents[0].quote.contactId).toBeNull();
    expectNoForeignContactSideEffects();

    expect(byId.get(own).contact).toMatchObject({ id: ID.contactB });
    expect(eventsFor('quote.stale', own)[0]?.quote.contactId).toBe(ID.contactB);
  });

  it("the follow-up of a stale legacy B quote answers with contact null and logs nothing against A's contact; B's own quote is still logged against B's contact", async () => {
    const legacy = `${P}qFollowLegacy`;
    const own = `${P}qFollowOwn`;
    await seedSentQuote(legacy, ID.contactA, { sentDaysAgo: 30 });
    await seedSentQuote(own, ID.contactB, { sentDaysAgo: 30 });

    const res = await asOwnerB(agent().post(`/commerce/businesses/${ID.bizB}/quotes/${legacy}/follow-up`)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.quote.id).toBe(legacy);
    expect(res.body.quote.contact).toBeNull();
    expect(res.body.quote.lastFollowUpAt).toBeTruthy();
    expectNoCanary(res.body);
    expect(crmCalls).toEqual([]);
    expectNoForeignContactSideEffects();

    const ownRes = await asOwnerB(agent().post(`/commerce/businesses/${ID.bizB}/quotes/${own}/follow-up`)).send({});
    expect(ownRes.status, JSON.stringify(ownRes.body)).toBe(201);
    expect(ownRes.body.quote.contact).toMatchObject({ id: ID.contactB });
    expect(crmCalls).toEqual([expect.objectContaining({ businessId: ID.bizB, contactId: ID.contactB, type: 'quote.follow_up_sent' })]);
  });
});
