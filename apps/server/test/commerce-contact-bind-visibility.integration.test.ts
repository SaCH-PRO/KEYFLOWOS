/**
 * FOLLOW3-D6-COMMERCE-CONTACT-BIND-VIS (V1-84, owner ruling D-64) — invoice and
 * quote create, update and convert refuse (404) a contact the acting member
 * cannot open under CRM visibility. REAL database, REAL guards.
 *
 * Item (R0-27 review ST-27-5): CommerceService.assertContactInBusiness checked
 * the contact against the tenant only ({ id, businessId }). Its callers are
 * createInvoice, createQuote, updateQuote, the convert re-check of the quote's
 * stored contact and updateInvoice, and every write route answers with the
 * bound contact projected to id, businessId, firstName, lastName and email
 * (toInvoiceWriteResponse, toQuoteWriteResponse). So a STAFF member holding
 * revenue:write with crm_view 'owned', who cannot open the owner's PRIVATE
 * contact on GET contacts/:id, bound it to an invoice or quote by id and read
 * its name and email back in the 201. Bookings create has refused the same
 * contact with 404 since V1-06. D-64: so do these writes, with the rule GET
 * contacts/:id applies (resolveCrmAccess + visibilityClause).
 *
 *   CB-01  STAFF (revenue:write, crm:read, crm_view:owned) on the owner's
 *          PRIVATE contact:
 *            c PATCH quotes/:id { contactId }
 *          RED-BEFORE: 200, the body carries the contact's firstName and
 *          email. GREEN-AFTER: 404 'Contact not found', the same body an
 *          unknown id answers; the quote keeps its contactId; nothing names
 *          the contact.
 *          BLOCKED (it.todo, each with its reason; D-64 is NOT closed):
 *            a POST invoices (with or without an Idempotency-Key),
 *            b POST quotes, d PATCH invoices/:id, e POST quotes/:id/convert,
 *            f POST invoices/from-time. Each bind is also reached by a granted
 *            KEY tool whose dispatcher passes no actor (commerce_create_invoice,
 *            commerce_create_quote, commerce_update_invoice,
 *            commerce_convert_quote). Refusing on HTTP while KEY binds breaks
 *            the KEY-never-exceeds-HTTP derivation that
 *            src/modules/structure/job-role-tool-families.spec.ts asserts
 *            (CRM_ROW_VISIBILITY_TOOLS, review CR-D6-1). It needs an owner
 *            decision: withhold those tools from KEY positions, or a
 *            holder-aware dispatcher. Both are outside this packet's write set,
 *            and so are the existing cases that pin the pre-D-64 201s
 *            (commerce-authorization.e2e CC-STRIP/CC-FORWARD/CC-BOUND,
 *            commerce-quote-errors RR-PROJECT-CREATE, commerce-create-idempotency
 *            H-09, quote-chain-finish QCF-07; review SEC-D6-1). Until then a
 *            member refused on PATCH quotes can still bind the contact through
 *            POST quotes, so the PATCH refusal alone is not a boundary.
 *            g POST recurring-invoices: RecurringInvoiceService checks the
 *            tenant only and answers the whole Contact row (review SEC-D6-2);
 *            outside this packet's write set, its own packet.
 *   CB-02  (review CR-D6-2) a PATCH that sends back the contactId the document
 *          already holds is not re-judged: STAFF and ADMIN edit notes on a
 *          quote, and STAFF on an invoice, already bound to the PRIVATE
 *          contact (the web edit flows always send it back): 200, notes
 *          written, the contact unchanged.
 *   CB-03  (review CR-D6-3) POST invoices answers the same with and without an
 *          Idempotency-Key: the bind does not depend on an optional header.
 *   CTL    controls, green before and after: the STAFF member's own TEAM
 *          contact and a PRIVATE contact shared with them answer 201/200 on
 *          every route; OWNER binds the PRIVATE contact with 201/200; KEY's
 *          commerce tools (CommerceAdapterService, and CommerceService with no
 *          member actor, as the flow dispatcher calls it) stay tenant-only and
 *          bind the PRIVATE contact; an unknown id and another tenant's
 *          contact keep their 404.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard, TeamAuditInterceptor, the controller's
 * D-46 revenue-authorization helper, GlobalHttpExceptionFilter,
 * ValidationPipe, CommerceService, InvoiceWorkflowService and TimeEntryService
 * write real rows. Identity attachment is the one stand-in: a test middleware
 * reads `x-v84f-user`, loads that seeded user row and attaches
 * `{ id, email, role }`. The event bus, CRM timeline, stats cache, Gmail and
 * vision are stubs off the boundary.
 *
 * Fixtures: prefix `v84f_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in beforeAll and
 * afterAll; no $transaction wrapping. Every string of the PRIVATE contact
 * carries the canary `V84F_PRIV_`. One document per mutating case.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84f_';
const HEADER = 'x-v84f-user';
const CANARY = 'V84F_PRIV_';

const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staff: `${P}staff`, // STAFF of bizA: revenue write, crm read, crm_view owned
  admin: `${P}admin`, // ADMIN of bizA, role defaults (sees TEAM and SHARED, not another member's PRIVATE)
  ownerB: `${P}ownerB`, // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`, // PRIVATE, owned by owner: the STAFF member cannot open it
  cTeam: `${P}cTeam`, // TEAM, owned by staff
  cShared: `${P}cShared`, // PRIVATE, owned by owner, shared with staff
  cB: `${P}cB`, // bizB's contact
  unknown: `${P}contact_unknown`,
};

const PRIV = { firstName: `${CANARY}first`, lastName: `${CANARY}last`, email: `${CANARY}${P}priv@test.local`, phone: `${CANARY}phone` };
const TEAM = { firstName: 'V84fTeam', lastName: 'Staffbook', email: `${P}team@test.local` };
const SHARED = { firstName: 'V84fShared', lastName: 'Shared', email: `${P}shared@test.local` };

const STAFF_SCOPES = { revenue: 'write', crm: 'read', crm_view: 'owned' };
const ITEMS = [{ description: 'V84F line', quantity: 2, unitPrice: 10 }];

let db: any;
let app: any;
let redis: any;
let commerce: any;
let keyAdapter: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM time_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE quotes SET invoice_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const agent = () => request(app.getHttpServer());
const as = (actor: string, req: request.Test) => req.set(HEADER, actor);

function postInvoice(actor: string, contactId: string, key?: string) {
  const req = as(actor, agent().post(`/commerce/businesses/${ID.bizA}/invoices`));
  return (key ? req.set('Idempotency-Key', key) : req).send({ contactId, items: ITEMS, notes: 'v84f invoice' });
}
function postQuote(actor: string, contactId: string, key?: string) {
  const req = as(actor, agent().post(`/commerce/businesses/${ID.bizA}/quotes`));
  return (key ? req.set('Idempotency-Key', key) : req).send({ contactId, items: ITEMS, notes: 'v84f quote' });
}
function patchQuote(actor: string, quoteId: string, contactId: string, extra: Record<string, unknown> = {}) {
  return as(actor, agent().patch(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}`)).send({ contactId, ...extra });
}
function patchInvoice(actor: string, invoiceId: string, contactId: string, extra: Record<string, unknown> = {}) {
  return as(actor, agent().patch(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}`)).send({ contactId, ...extra });
}
function convert(actor: string, quoteId: string) {
  return as(actor, agent().post(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}/convert`)).send({});
}
function fromTime(actor: string, projectId: string, contactId: string) {
  return as(actor, agent().post(`/commerce/businesses/${ID.bizA}/invoices/from-time`)).send({ projectId, contactId });
}

let docSeq = 0;
/** A quote of bizA bound to `contactId`, in `status`, with one line. */
async function seedQuote(tag: string, contactId: string, status = 'DRAFT'): Promise<string> {
  docSeq += 1;
  const id = `${P}q_${tag}`;
  await db.quote.create({
    data: {
      id,
      quoteNumber: `V84F-Q${String(docSeq).padStart(4, '0')}`,
      status,
      subtotal: 20,
      total: 20,
      currency: 'TTD',
      businessId: ID.bizA,
      contactId,
      items: { create: [{ id: `${id}_i1`, description: `V84F ${tag}`, quantity: 2, unitPrice: 10, total: 20 }] },
    },
  });
  return id;
}

/** A DRAFT invoice of bizA bound to `contactId`, with one line. */
async function seedInvoice(tag: string, contactId: string): Promise<string> {
  docSeq += 1;
  const id = `${P}inv_${tag}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V84F-${String(docSeq).padStart(4, '0')}`,
      status: 'DRAFT',
      subtotal: 20,
      total: 20,
      currency: 'TTD',
      businessId: ID.bizA,
      contactId,
      items: { create: [{ id: `${id}_i1`, description: `V84F ${tag}`, quantity: 2, unitPrice: 10, total: 20 }] },
    },
  });
  return id;
}

/** A project of bizA with one unbilled, rated, billable hour on it (from-time cases). */
async function seedBillableHour(tag: string): Promise<{ projectId: string; entryId: string }> {
  const projectId = `${P}proj_${tag}`;
  const entryId = `${P}te_${tag}`;
  await db.project.create({ data: { id: projectId, name: `V84F ${tag}`, businessId: ID.bizA } });
  await db.timeEntry.create({
    data: {
      id: entryId,
      description: `V84F hour ${tag}`,
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 60 * 1000),
      durationMinutes: 60,
      billable: true,
      billed: false,
      hourlyRate: 50,
      userId: ID.staff,
      businessId: ID.bizA,
      projectId,
    },
  });
  return { projectId, entryId };
}

/** Every invoice and quote of bizA, soft-deleted ones included. */
async function documentCounts(): Promise<{ invoices: number; quotes: number }> {
  const [inv] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM invoices WHERE business_id = $1', ID.bizA);
  const [quo] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM quotes WHERE business_id = $1', ID.bizA);
  return { invoices: inv.n, quotes: quo.n };
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
 * The refusal D-64 sets: 404 'Contact not found', the body an unknown id
 * answers on the same route, and nothing of the PRIVATE contact in it. A RED
 * run fails here with the 201/200 and the contact it disclosed.
 */
function expectRefused(res: request.Response, unknownRes: request.Response, label: string) {
  expect(
    res.status,
    `${label}: answered ${res.status} with contact ${JSON.stringify(res.body?.contact ?? res.body?.invoiceId ?? null)}`,
  ).toBe(404);
  expect(res.body.message, label).toBe('Contact not found');
  expect(stripVolatile(res.body), `${label}: indistinguishable from an unknown id`).toEqual(stripVolatile(unknownRes.body));
  expect(JSON.stringify(res.body), label).not.toContain(CANARY);
  expect(JSON.stringify(res.body), label).not.toContain(ID.cPriv);
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
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');

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
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      TimeEntryService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  // KEY's commerce tools, as KeyCortexConnectorService reaches them: no member actor.
  keyAdapter = new CommerceAdapterService(commerce);

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
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.staff, ID.admin, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84F Biz A', slug: ID.bizA, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84F Biz B', slug: ID.bizB, ownerId: ID.ownerB, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.bizA, role: 'STAFF', permissionScopes: STAFF_SCOPES } });
  await db.membership.create({ data: { id: `${P}m_admin`, userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await db.contact.create({ data: { id: ID.cPriv, businessId: ID.bizA, ...PRIV, visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cTeam, businessId: ID.bizA, ...TEAM, visibility: 'TEAM', ownerId: ID.staff } });
  await db.contact.create({ data: { id: ID.cShared, businessId: ID.bizA, ...SHARED, visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contactShare.create({ data: { id: `${P}share_staff`, businessId: ID.bizA, contactId: ID.cShared, userId: ID.staff, createdBy: ID.owner } });
  await db.contact.create({ data: { id: ID.cB, businessId: ID.bizB, firstName: 'V84fB', lastName: 'Other', email: `${P}b@test.local` } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it("the STAFF member's CRM view (as GET contacts/:id decides it) opens the TEAM contact they own and the PRIVATE contact shared with them, not the owner's PRIVATE contact; ADMIN's opens the TEAM contact only", async () => {
    const { resolveCrmAccess, visibilityClause } = await import('../src/modules/crm/crm-permissions.helper');
    const prismaLike = { client: db } as any;
    const access = await resolveCrmAccess(prismaLike, ID.bizA, ID.staff);
    expect(access).toMatchObject({ isOwner: false, viewAll: false, level: 'read' });
    const clause = visibilityClause(access, ID.staff)!;
    const visible = await db.contact.findMany({ where: { businessId: ID.bizA, AND: [clause] }, select: { id: true }, orderBy: { id: 'asc' } });
    expect(visible.map((c: any) => c.id).sort()).toEqual([ID.cShared, ID.cTeam].sort());
    const membership = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.staff, businessId: ID.bizA } } });
    expect(membership.permissionScopes).toEqual(STAFF_SCOPES);
    // ADMIN (role defaults: crm admin, view all) opens the TEAM contact, not another member's PRIVATE one
    const adminAccess = await resolveCrmAccess(prismaLike, ID.bizA, ID.admin);
    expect(adminAccess).toMatchObject({ isOwner: false, viewAll: true });
    const adminVisible = await db.contact.findMany({
      where: { businessId: ID.bizA, AND: [visibilityClause(adminAccess, ID.admin)!] },
      select: { id: true },
    });
    expect(adminVisible.map((c: any) => c.id)).toEqual([ID.cTeam]);
  });
});

/**
 * Why each bind other than PATCH quotes is an it.todo (review CR-D6-1, SEC-D6-1):
 * the bind is also reached by a KEY tool a revenue:write position is granted,
 * and the flow dispatcher (and CommerceAdapterService, CTL-04) calls it with no
 * member actor. Applying the clause there refuses on HTTP what KEY still binds,
 * so job-role-tool-families.spec.ts ('CRM_ROW_VISIBILITY_TOOLS is exactly the
 * granted write tools whose service reaches the clause') fails: KEY would
 * exceed HTTP. The way forward is an owner decision (add the tool to
 * CRM_ROW_VISIBILITY_TOOLS, withholding it from every KEY position but the
 * OWNER's, or a holder-aware dispatcher that passes the member), plus the
 * existing cases that pin the pre-D-64 201s. All are outside this packet's
 * write set. Restore each body below as an `it` with that change.
 */
const K2_BLOCKED =
  'BLOCKED: a granted KEY tool reaches the same bind with no actor, so refusing it on HTTP breaks the K2 derivation ' +
  'in src/modules/structure/job-role-tool-families.spec.ts (CRM_ROW_VISIBILITY_TOOLS; owner decision: withhold the tool from KEY ' +
  'positions or a holder-aware dispatcher)';

describe('CB-01 STAFF (revenue:write, crm_view owned) binds the owner\'s PRIVATE contact: 404, nothing written, nothing disclosed (D-64)', () => {
  // KEY tool commerce_create_invoice (CommerceService.createInvoice). Also
  // pinned: test/commerce-authorization.e2e.test.ts CC-STRIP, CC-FORWARD and
  // CC-BOUND assert the exact object the route forwards, which forwards the
  // member only with an Idempotency-Key (createIdempotency); the route must
  // forward it always, so the refusal does not depend on the header (CB-03).
  //   for (const key of [undefined, `${P}key-inv-priv`]) {
  //     const unknown = await postInvoice(ID.staff, ID.unknown, key && `${key}-unknown`);
  //     const before = await documentCounts();
  //     const res = await postInvoice(ID.staff, ID.cPriv, key);
  //     expectRefused(res, unknown, `POST invoices (key ${key ?? 'none'})`);
  //     expect(await documentCounts()).toEqual(before);
  //   }
  it.todo(
    `CB-01a POST businesses/A/invoices, with and without an Idempotency-Key: 404 Contact not found, no Invoice and no key slot written (${K2_BLOCKED}: ` +
      'commerce_create_invoice; also commerce-authorization.e2e CC-STRIP/CC-FORWARD/CC-BOUND pin the forwarded object)',
  );

  // KEY tool commerce_create_quote (CommerceService.createQuote). Also pinned:
  // test/commerce-quote-errors.integration.test.ts RR-PROJECT-CREATE (STAFF
  // crm:none on a PRIVATE contact) and test/commerce-create-idempotency
  // .integration.test.ts H-09 (its quote twin) expect 201 with the projected
  // contact; under D-64 both are 404.
  //   const unknown = await postQuote(ID.staff, ID.unknown);
  //   const before = await documentCounts();
  //   const res = await postQuote(ID.staff, ID.cPriv);
  //   expectRefused(res, unknown, 'POST quotes');
  //   expect(await documentCounts()).toEqual(before);
  it.todo(
    `CB-01b POST businesses/A/quotes: 404 Contact not found, no Quote written (${K2_BLOCKED}: commerce_create_quote; ` +
      'also commerce-quote-errors RR-PROJECT-CREATE and commerce-create-idempotency H-09 pin 201)',
  );

  it('CB-01c PATCH businesses/A/quotes/:id { contactId: PRIVATE }: 404 Contact not found, the quote keeps its contact', async () => {
    const quoteId = await seedQuote('cb01c', ID.cTeam);
    const unknown = await patchQuote(ID.staff, quoteId, ID.unknown);
    const before = await db.quote.findUnique({ where: { id: quoteId } });
    const res = await patchQuote(ID.staff, quoteId, ID.cPriv);
    expectRefused(res, unknown, 'PATCH quotes/:id');
    const after = await db.quote.findUnique({ where: { id: quoteId } });
    expect(after.contactId).toBe(ID.cTeam);
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
  });

  // KEY tool commerce_update_invoice (CommerceService.updateInvoice). The
  // restated stored contact must stay allowed (CB-02).
  //   const invoiceId = await seedInvoice('cb01d', ID.cTeam);
  //   const unknown = await patchInvoice(ID.staff, invoiceId, ID.unknown);
  //   const before = await db.invoice.findUnique({ where: { id: invoiceId } });
  //   const res = await patchInvoice(ID.staff, invoiceId, ID.cPriv);
  //   expectRefused(res, unknown, 'PATCH invoices/:id');
  //   const after = await db.invoice.findUnique({ where: { id: invoiceId } });
  //   expect(after.contactId).toBe(ID.cTeam);
  //   expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
  it.todo(
    `CB-01d PATCH businesses/A/invoices/:id { contactId: PRIVATE }: 404 Contact not found, the invoice keeps its contact (${K2_BLOCKED}: commerce_update_invoice)`,
  );

  // KEY tool commerce_convert_quote (CommerceService.convertQuoteToInvoice and
  // its re-check of the quote's stored contact). Also pinned:
  // test/quote-chain-finish.integration.test.ts QCF-07 (a revenue:write,
  // crm:none member converting a quote on a PRIVATE contact gets 201).
  //   const quoteId = await seedQuote('cb01e', ID.cPriv, 'ACCEPTED');
  //   const unknownQuote = await seedQuote('cb01e_unknown', ID.cTeam, 'ACCEPTED');
  //   // A stored contact outside the tenant (a legacy row) answers the convert re-check's 404 (R0-27 ST-27-2).
  //   await db.$executeRawUnsafe('UPDATE quotes SET contact_id = $1 WHERE id = $2', ID.cB, unknownQuote);
  //   const unknown = await convert(ID.staff, unknownQuote);
  //   const before = await documentCounts();
  //   const res = await convert(ID.staff, quoteId);
  //   expectRefused(res, unknown, 'POST quotes/:id/convert');
  //   expect(await documentCounts()).toEqual(before);
  //   const quote = await db.quote.findUnique({ where: { id: quoteId } });
  //   expect(quote).toMatchObject({ status: 'ACCEPTED', invoiceId: null, contactId: ID.cPriv });
  it.todo(
    'CB-01e POST businesses/A/quotes/:id/convert of an ACCEPTED quote bound to the PRIVATE contact: 404 Contact not found, ' +
      `no Invoice, the quote stays unconverted (${K2_BLOCKED}: commerce_convert_quote; also quote-chain-finish QCF-07 pins 201)`,
  );

  // KEY tool commerce_create_invoice: from-time binds through
  // CommerceService.createInvoice (TimeEntryService.invoiceUnbilledTime's
  // createInvoice callback, which the controller must hand the member).
  //   const unknownHour = await seedBillableHour('cb01f_unknown');
  //   const unknown = await fromTime(ID.staff, unknownHour.projectId, ID.unknown);
  //   const { projectId, entryId } = await seedBillableHour('cb01f');
  //   const before = await documentCounts();
  //   const res = await fromTime(ID.staff, projectId, ID.cPriv);
  //   expectRefused(res, unknown, 'POST invoices/from-time');
  //   expect(await documentCounts()).toEqual(before);
  //   expect(await db.timeEntry.findUnique({ where: { id: entryId } })).toMatchObject({ billed: false, invoiceId: null });
  it.todo(
    `CB-01f POST businesses/A/invoices/from-time { contactId: PRIVATE }: 404 Contact not found, no Invoice, the hour stays unbilled (${K2_BLOCKED}: ` +
      'commerce_create_invoice, through CommerceService.createInvoice)',
  );

  // Review SEC-D6-2: RecurringInvoiceService.createRecurringInvoice checks the
  // contact against the tenant only (its own private assertContactInBusiness)
  // and answers the schedule with `include: { contact: true }`, which
  // RecurringInvoiceController returns unprojected (notesInternal, phone,
  // ownerId, visibility, every CRM field). Every invoice the schedule issues is
  // bound to that contact. recurring-invoice.service.ts and
  // recurring-invoice.controller.ts are outside this packet's write set.
  it.todo(
    'CB-01g POST businesses/A/recurring-invoices { contactId: PRIVATE }: 404 Contact not found, no schedule written, and the ' +
      'schedule write answers a projected contact (BLOCKED: RecurringInvoiceService/Controller outside this write set; its own packet)',
  );
});

describe('CB-02 a PATCH that sends back the stored contactId is not re-judged (review CR-D6-2)', () => {
  it('CB-02 STAFF and ADMIN edit notes on a quote bound to the PRIVATE contact, sending its contactId back: 200, notes written, contact unchanged; the invoice twin answers 200 too', async () => {
    for (const actor of [ID.staff, ID.admin]) {
      const quoteId = await seedQuote(`cb02_${actor.slice(P.length)}`, ID.cPriv);
      const res = await patchQuote(actor, quoteId, ID.cPriv, { notes: `v84f edited by ${actor}` });
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      const after = await db.quote.findUnique({ where: { id: quoteId } });
      expect(after).toMatchObject({ contactId: ID.cPriv, notes: `v84f edited by ${actor}` });
      // the answer is what the same PATCH without contactId answers: the projected contact
      const withoutContact = await as(actor, agent().patch(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}`)).send({ notes: 'v84f again' });
      expect(withoutContact.status).toBe(200);
      expect(res.body.contact).toEqual(withoutContact.body.contact);
    }
    // web edit flows (invoices/[id]/edit, invoices-panel, revenue-composer) send the invoice's contactId back too
    const invoiceId = await seedInvoice('cb02', ID.cPriv);
    const res = await patchInvoice(ID.staff, invoiceId, ID.cPriv, { notes: 'v84f invoice edited' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await db.invoice.findUnique({ where: { id: invoiceId } })).toMatchObject({ contactId: ID.cPriv, notes: 'v84f invoice edited' });
  });

  it("CB-02b ADMIN (sees TEAM and SHARED, not another member's PRIVATE) binding the owner's PRIVATE contact to a quote by a new contactId: 404 Contact not found, the quote keeps its contact", async () => {
    const quoteId = await seedQuote('cb02b', ID.cTeam);
    const unknown = await patchQuote(ID.admin, quoteId, ID.unknown);
    const res = await patchQuote(ID.admin, quoteId, ID.cPriv);
    expectRefused(res, unknown, 'ADMIN PATCH quotes/:id');
    expect((await db.quote.findUnique({ where: { id: quoteId } })).contactId).toBe(ID.cTeam);
  });
});

describe('CB-03 POST invoices binds alike with and without an Idempotency-Key (review CR-D6-3)', () => {
  it('CB-03 the same member and contact get the same status keyed and unkeyed, for the PRIVATE, TEAM and unknown contacts', async () => {
    for (const contactId of [ID.cPriv, ID.cTeam, ID.unknown]) {
      const unkeyed = await postInvoice(ID.staff, contactId);
      const keyed = await postInvoice(ID.staff, contactId, `${P}key-cb03-${contactId.slice(P.length)}`);
      expect(keyed.status, `${contactId}: keyed ${keyed.status}, unkeyed ${unkeyed.status}`).toBe(unkeyed.status);
      expect(keyed.body.message, contactId).toBe(unkeyed.body.message);
    }
  });
});

describe('CTL controls (pass before and after)', () => {
  it('CTL-01 STAFF binds the TEAM contact they own: POST invoices 201 (unkeyed and keyed), POST quotes 201, PATCH quotes 200, PATCH invoices 200, convert 201, from-time 201', async () => {
    for (const res of [await postInvoice(ID.staff, ID.cTeam), await postInvoice(ID.staff, ID.cTeam, `${P}key-inv-team`)]) {
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.contact).toMatchObject({ id: ID.cTeam, firstName: TEAM.firstName, email: TEAM.email });
    }
    const quote = await postQuote(ID.staff, ID.cTeam);
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.contact).toMatchObject({ firstName: TEAM.firstName, email: TEAM.email });

    const quoteId = await seedQuote('ctl01_patch', ID.cShared);
    const patchedQuote = await patchQuote(ID.staff, quoteId, ID.cTeam);
    expect(patchedQuote.status, JSON.stringify(patchedQuote.body)).toBe(200);
    expect((await db.quote.findUnique({ where: { id: quoteId } })).contactId).toBe(ID.cTeam);

    const invoiceId = await seedInvoice('ctl01_patch', ID.cShared);
    const patchedInvoice = await patchInvoice(ID.staff, invoiceId, ID.cTeam);
    expect(patchedInvoice.status, JSON.stringify(patchedInvoice.body)).toBe(200);
    expect((await db.invoice.findUnique({ where: { id: invoiceId } })).contactId).toBe(ID.cTeam);

    const accepted = await seedQuote('ctl01_convert', ID.cTeam, 'ACCEPTED');
    const converted = await convert(ID.staff, accepted);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(converted.body).toMatchObject({ contactId: ID.cTeam, contact: { firstName: TEAM.firstName } });

    const { projectId, entryId } = await seedBillableHour('ctl01');
    const billed = await fromTime(ID.staff, projectId, ID.cTeam);
    expect(billed.status, JSON.stringify(billed.body)).toBe(201);
    expect((await db.invoice.findUnique({ where: { id: billed.body.invoiceId } })).contactId).toBe(ID.cTeam);
    expect((await db.timeEntry.findUnique({ where: { id: entryId } })).billed).toBe(true);
  });

  it('CTL-02 STAFF binds a PRIVATE contact the owner shared with them: POST invoices 201, POST quotes 201', async () => {
    const invoice = await postInvoice(ID.staff, ID.cShared);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect(invoice.body.contact).toMatchObject({ id: ID.cShared, firstName: SHARED.firstName });
    const quote = await postQuote(ID.staff, ID.cShared);
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.contact).toMatchObject({ firstName: SHARED.firstName });
  });

  it('CTL-03 OWNER binds the PRIVATE contact: POST invoices 201, POST quotes 201, PATCH quotes 200, PATCH invoices 200, convert 201, from-time 201', async () => {
    const invoice = await postInvoice(ID.owner, ID.cPriv);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect(invoice.body.contact).toMatchObject({ id: ID.cPriv, firstName: PRIV.firstName, email: PRIV.email });
    const quote = await postQuote(ID.owner, ID.cPriv);
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.contact).toMatchObject({ firstName: PRIV.firstName });

    const quoteId = await seedQuote('ctl03_patch', ID.cTeam);
    expect((await patchQuote(ID.owner, quoteId, ID.cPriv)).status).toBe(200);
    expect((await db.quote.findUnique({ where: { id: quoteId } })).contactId).toBe(ID.cPriv);
    const invoiceId = await seedInvoice('ctl03_patch', ID.cTeam);
    expect((await patchInvoice(ID.owner, invoiceId, ID.cPriv)).status).toBe(200);
    expect((await db.invoice.findUnique({ where: { id: invoiceId } })).contactId).toBe(ID.cPriv);

    const accepted = await seedQuote('ctl03_convert', ID.cPriv, 'ACCEPTED');
    const converted = await convert(ID.owner, accepted);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(converted.body).toMatchObject({ contactId: ID.cPriv });

    const { projectId } = await seedBillableHour('ctl03');
    const billed = await fromTime(ID.owner, projectId, ID.cPriv);
    expect(billed.status, JSON.stringify(billed.body)).toBe(201);
    expect((await db.invoice.findUnique({ where: { id: billed.body.invoiceId } })).contactId).toBe(ID.cPriv);
  });

  it('CTL-04 KEY commerce tools (no member actor) stay tenant-only: the adapter creates an invoice and a quote on the PRIVATE contact; CommerceService update and convert with no actor bind it', async () => {
    const invoice = await keyAdapter.createInvoice({ businessId: ID.bizA, contactId: ID.cPriv, items: ITEMS });
    expect(invoice.contactId).toBe(ID.cPriv);
    const quote = await keyAdapter.createQuote({ businessId: ID.bizA, contactId: ID.cPriv, items: ITEMS });
    expect(quote.contactId).toBe(ID.cPriv);

    const invoiceId = await seedInvoice('ctl04_patch', ID.cTeam);
    const updated = await commerce.updateInvoice({ invoiceId, businessId: ID.bizA, contactId: ID.cPriv });
    expect(updated.contactId).toBe(ID.cPriv);
    const quoteId = await seedQuote('ctl04_patch', ID.cTeam);
    const updatedQuote = await commerce.updateQuote({ quoteId, businessId: ID.bizA, contactId: ID.cPriv });
    expect(updatedQuote.contactId).toBe(ID.cPriv);
    const accepted = await seedQuote('ctl04_convert', ID.cPriv, 'ACCEPTED');
    const converted = await commerce.convertQuoteToInvoice({ quoteId: accepted, businessId: ID.bizA });
    expect(converted.contactId).toBe(ID.cPriv);

    // The tenant check is unchanged on that path: another tenant's contact is a 404.
    await expect(keyAdapter.createInvoice({ businessId: ID.bizA, contactId: ID.cB, items: ITEMS })).rejects.toMatchObject({ status: 404 });
  });

  it("CTL-05 an unknown id and another tenant's contact keep their 404 'Contact not found' for STAFF and OWNER, and nothing is written", async () => {
    const before = await documentCounts();
    for (const actor of [ID.staff, ID.owner]) {
      for (const contactId of [ID.unknown, ID.cB]) {
        for (const res of [await postInvoice(actor, contactId), await postQuote(actor, contactId)]) {
          expect(res.status, `${actor} ${contactId}`).toBe(404);
          expect(res.body.message).toBe('Contact not found');
          expect(JSON.stringify(res.body)).not.toContain('V84fB');
        }
      }
    }
    expect(await documentCounts()).toEqual(before);
  });
});
