/**
 * V1-52-QUOTE-PUBLIC-LINK — a provider-free customer handoff for the quote
 * branch of Release 0 (CF-16) (REAL database).
 *
 * At this packet's base (pkt/V1-51-QUOTE-CONVERSION-JOURNEY-repair 60b2cc56)
 * the quote's viewToken reaches a customer only inside the Gmail send-email
 * message (commerce.controller.ts sendQuoteEmail builds `${appUrl}/quote/<token>`
 * and hands it to GmailService.sendEmail). A business with no mail provider
 * connected can mark a quote SENT, but has no way to give the customer the
 * link: there is no route that answers it, and the quotes panel's WhatsApp
 * share text (quotes-panel.tsx:597-603 at this base) carries no link.
 *
 * Contract pinned here:
 *
 *   PL-01  POST /commerce/businesses/:b/quotes/:id/public-link on a DRAFT -> 409
 *          quote_not_sent; no token minted, the row byte-identical. A DRAFT holding
 *          a token send-email reserved is refused the same way and the token is not
 *          disclosed.
 *   PL-02  SENT -> 201 { token, url }: token is the quote's viewToken (the one mint
 *          of V1-50) and url is `${appUrl()}/quote/<token>`, the path the web page
 *          /quote/[token] serves; nothing else in the body
 *   PL-03  idempotent: a repeat answers the same token and url; the row is not
 *          rewritten (updatedAt, sentAt unchanged); nothing is emitted or logged
 *   PL-04  tenant binding: A's quote under B's path -> 404, byte-identical to an
 *          unknown id; B's owner on A's path -> 403 (BusinessGuard); tenant A's
 *          state is byte-identical after the attempts
 *   PL-05  revenue:read is not enough (the route can mint a token): 403, no change
 *   PL-06  the copied url opens the customer view with no email provider: the token
 *          in its /quote/<token> path reads 200 on GET /commerce/public/quotes/:token
 *          (what the page calls), viewedAt is set once (one quote.viewed), a second
 *          view leaves it; GmailService is never called
 *   PL-07  an expired quote -> 400 quote_expired; no token change
 *   PL-08  a converted quote (invoiceId set) -> 400 quote_converted; no change
 *   PL-09  a SENT quote written with no token (the ai-execute send_quote path,
 *          V1-50 CR-V150-2) gets its one token minted by the link route,
 *          compare-and-set: two concurrent calls answer the same token
 *   LEDGER no FinancialTransaction (or ledger entry) is written by link creation or
 *          by a public view, on an ACCRUAL tenant with a seeded chart of accounts
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (on this suite's Redis index),
 * CommerceService, InvoiceWorkflowService and the real ledger chain run
 * against DATABASE_URL behind the production GlobalHttpExceptionFilter and
 * ValidationPipe, with the app's TenantInterceptor. Identity attachment is the
 * one stand-in: a test middleware reads `x-v52a-user`, loads that seeded user
 * row and attaches `{ id, email, role }` as AuthMiddleware would. Collaborators
 * off the boundary (event bus, contact timeline, stats cache, AI / Drive) are
 * recorders or stubs; GmailService is a recorder that refuses every send (no
 * email provider is configured for either tenant).
 *
 * Fixtures: prefix `v52a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Every quote is created through the HTTP route.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v52a_';
const HEADER = 'x-v52a-user';
const APP_URL = 'https://v52a-app.example.test';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  staffReadA: `${P}staffReadA`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  unknown: `${P}quote_unknown`,
};

let db: any;
let app: any;
let redis: any;
let previousNamespace: string | undefined;
let previousAppUrl: string | undefined;

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

const crmCalls: Array<{ type: string }> = [];
const crmRecorder = {
  logContactEvent: async (input: { type: string }) => {
    crmCalls.push({ type: input.type });
    return { id: `${P}evt` };
  },
};

/** No mail provider: every Gmail call is recorded and refused. */
const gmailCalls: string[] = [];
const refuse = (name: string) => async () => {
  gmailCalls.push(name);
  throw new Error('no email provider configured');
};
const gmailRecorder = {
  sendEmail: refuse('sendEmail'),
  getAuthUrl: refuse('getAuthUrl'),
  getStatus: refuse('getStatus'),
  isConnected: refuse('isConnected'),
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `UPDATE quotes SET invoice_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** This suite's public rate-limit windows live under its own namespace (P), reset before every case. */
async function clearOwnRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${P}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

let quoteSeq = 0;

/** POST /commerce/businesses/:biz/quotes as the tenant's owner; the quote number embeds the prefix. */
async function createQuote(owner: string, businessId: string, contactId: string) {
  quoteSeq += 1;
  const res = await agent()
    .post(`/commerce/businesses/${businessId}/quotes`)
    .set(HEADER, owner)
    .send({
      contactId,
      quoteNumber: `${P}Q-${String(quoteSeq).padStart(3, '0')}`,
      items: [{ description: `V52A line ${quoteSeq}`, quantity: 1, unitPrice: 100 }],
    });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body as { id: string; status: string };
}

/** The status route as the web client calls it ("Mark as sent": no email provider involved). */
function setQuoteStatus(owner: string, businessId: string, quoteId: string, status: string) {
  return agent().patch(`/commerce/quotes/${quoteId}/status/${status}`).set(HEADER, owner).send({ businessId });
}

async function sentQuote(owner: string, businessId: string, contactId: string) {
  const quote = await createQuote(owner, businessId, contactId);
  const sent = await setQuoteStatus(owner, businessId, quote.id, 'sent');
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  return quote.id;
}

function publicLink(user: string, businessId: string, quoteId: string) {
  return agent().post(`/commerce/businesses/${businessId}/quotes/${quoteId}/public-link`).set(HEADER, user).send({});
}

function publicView(token: string) {
  return agent().get(`/commerce/public/quotes/${encodeURIComponent(token)}`);
}

/** Every column of the quote, read raw (the soft-delete extension hides deleted rows). */
async function quoteRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT to_jsonb(q) AS row FROM quotes q WHERE id = $1`, id);
  return rows[0]?.row ?? null;
}

/** A tenant's commercial state, every column, as one string: quotes, their items, invoices, payments, ledger. */
async function tenantState(businessId: string): Promise<string> {
  const parts: unknown[] = [];
  for (const sql of [
    `SELECT to_jsonb(q) AS row FROM quotes q WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(i) AS row FROM quote_items i WHERE quote_id IN (SELECT id FROM quotes WHERE business_id = $1) ORDER BY id`,
    `SELECT to_jsonb(v) AS row FROM invoices v WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(p) AS row FROM payments p WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(t) AS row FROM financial_transactions t WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(e) AS row FROM ledger_entries e WHERE business_id = $1 ORDER BY id`,
  ]) {
    const rows: any[] = await db.$queryRawUnsafe(sql, businessId);
    parts.push(rows.map((r) => r.row));
  }
  return JSON.stringify(parts);
}

async function ledgerCounts(businessId: string) {
  const [tx] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM financial_transactions WHERE business_id = $1`, businessId);
  const [entries] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_entries WHERE business_id = $1`, businessId);
  return { transactions: tx.n as number, entries: entries.n as number };
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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');

  previousNamespace = process.env.RATE_LIMIT_KEY_NAMESPACE;
  process.env.RATE_LIMIT_KEY_NAMESPACE = P;
  // The web app's public URL the link is built on (runtime-urls appUrl()).
  previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = APP_URL;
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      PlanLimitGuard,
      TeamAuditInterceptor,
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: any posting would be a real row.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: crmRecorder },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.ownerA, ID.ownerB, ID.staffReadA]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V52A Accrual Biz', ownerId: ID.ownerA, currency: 'TTD', accountingBasis: 'ACCRUAL' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V52A Other Biz', ownerId: ID.ownerB, currency: 'TTD', accountingBasis: 'CASH' } });
  for (const biz of [ID.bizA, ID.bizB]) await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_staffReadA`, userId: ID.staffReadA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
  });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V52a', lastName: 'Customer', email: `${P}contactA@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V52a', lastName: 'Other', email: `${P}contactB@test.local` } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
  if (previousNamespace === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = previousNamespace;
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

beforeEach(async () => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
  gmailCalls.length = 0;
  await clearOwnRateLimits();
});

describe('fixture sanity (real rows)', () => {
  it('two tenants with an owner each, a revenue:read member in A, a seeded chart of accounts and no ledger rows', async () => {
    expect((await db.business.findUnique({ where: { id: ID.bizA } })).accountingBasis).toBe('ACCRUAL');
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    for (const biz of [ID.bizA, ID.bizB]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } })).toBeGreaterThan(0);
      expect(await ledgerCounts(biz)).toEqual({ transactions: 0, entries: 0 });
    }
    expect(await quoteRow(ID.unknown)).toBeNull();
  });
});

describe('POST /commerce/businesses/:businessId/quotes/:quoteId/public-link (V1-52)', () => {
  it('PL-01: a DRAFT answers 409 quote_not_sent and no token is minted; a DRAFT holding a reserved send-email token is refused the same way without disclosing it', async () => {
    const draft = await createQuote(ID.ownerA, ID.bizA, ID.contactA);
    expect(draft.status).toBe('DRAFT');
    const before = await quoteRow(draft.id);
    expect(before.view_token).toBeNull();

    const res = await publicLink(ID.ownerA, ID.bizA, draft.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_not_sent');
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('url');
    expect(await quoteRow(draft.id)).toEqual(before);

    // send-email reserves a token on the DRAFT while Gmail has the message (R0-CMF4).
    const reserved = await createQuote(ID.ownerA, ID.bizA, ID.contactA);
    await db.$executeRawUnsafe(`UPDATE quotes SET view_token = $1 WHERE id = $2`, `${P}tok_reserved`, reserved.id);
    const reservedBefore = await quoteRow(reserved.id);
    const res2 = await publicLink(ID.ownerA, ID.bizA, reserved.id);
    expect(res2.status, JSON.stringify(res2.body)).toBe(409);
    expect(res2.body.code).toBe('quote_not_sent');
    expect(JSON.stringify(res2.body)).not.toContain(`${P}tok_reserved`);
    expect(await quoteRow(reserved.id)).toEqual(reservedBefore);

    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
    expect(gmailCalls).toHaveLength(0);
  });

  it('PL-02 + PL-03: a SENT quote answers 201 { token, url } with token = its viewToken and url = appUrl()/quote/<token>; a repeat answers the same link and rewrites nothing', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    const sentRow = await quoteRow(quoteId);
    expect(sentRow.status).toBe('SENT');
    expect(typeof sentRow.view_token).toBe('string');
    recordedEvents.length = 0;
    crmCalls.length = 0;

    const first = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toEqual({ token: sentRow.view_token, url: `${APP_URL}/quote/${sentRow.view_token}` });

    const second = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body).toEqual(first.body);

    // Idempotent: the quote is not rewritten (same token, sentAt, updatedAt), nothing emitted or logged.
    expect(await quoteRow(quoteId)).toEqual(sentRow);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
    expect(gmailCalls).toHaveLength(0);
  });

  it("PL-04: A's quote under B's path answers 404, byte-identical to an unknown id; B's owner on A's path gets 403; tenant A's state is byte-identical afterwards", async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    const stateA = await tenantState(ID.bizA);
    const stateB = await tenantState(ID.bizB);

    const unknown = await publicLink(ID.ownerB, ID.bizB, ID.unknown);
    const cross = await publicLink(ID.ownerB, ID.bizB, quoteId);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(cross.status, JSON.stringify(cross.body)).toBe(404);
    expect(stripVolatile(cross.body)).toEqual(stripVolatile(unknown.body));
    expect(JSON.stringify(cross.body)).not.toContain(String((await quoteRow(quoteId)).view_token));

    const foreignPath = await publicLink(ID.ownerB, ID.bizA, quoteId);
    expect(foreignPath.status, JSON.stringify(foreignPath.body)).toBe(403);
    expect(foreignPath.body).not.toHaveProperty('token');

    const anonymous = await agent().post(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}/public-link`).send({});
    expect([401, 403]).toContain(anonymous.status);
    expect(anonymous.body).not.toHaveProperty('token');

    expect(await tenantState(ID.bizA)).toBe(stateA);
    expect(await tenantState(ID.bizB)).toBe(stateB);
    expect(recordedEvents).toHaveLength(0);
  });

  it('PL-05: a revenue:read member cannot create the link (403; the route can mint a token); the quote is unchanged', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    const before = await quoteRow(quoteId);
    const res = await publicLink(ID.staffReadA, ID.bizA, quoteId);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).not.toHaveProperty('token');
    expect(await quoteRow(quoteId)).toEqual(before);
  });

  it('PL-06: the copied url opens the customer view with no email provider: its /quote/<token> token reads 200 on the public route, viewedAt is set once (one quote.viewed), a second view leaves it; Gmail is never called', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    const link = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const url = new URL(link.body.url);
    expect(`${url.protocol}//${url.host}`).toBe(APP_URL);
    const match = /^\/quote\/([^/]+)$/.exec(url.pathname);
    expect(match, url.pathname).not.toBeNull();
    const token = decodeURIComponent(match![1]!);
    expect(token).toBe(link.body.token);
    expect((await quoteRow(quoteId)).viewed_at).toBeNull();
    recordedEvents.length = 0;

    const firstView = await publicView(token);
    expect(firstView.status, JSON.stringify(firstView.body)).toBe(200);
    expect(firstView.body).toMatchObject({ id: quoteId, status: 'SENT' });
    const afterFirst = await quoteRow(quoteId);
    expect(afterFirst.viewed_at).not.toBeNull();
    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.viewed']);

    const secondView = await publicView(token);
    expect(secondView.status, JSON.stringify(secondView.body)).toBe(200);
    expect(await quoteRow(quoteId)).toEqual(afterFirst);
    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.viewed']);

    expect(gmailCalls).toHaveLength(0);
  });

  it('PL-07: an expired quote answers 400 quote_expired and its token is untouched', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    await db.$executeRawUnsafe(`UPDATE quotes SET expiry_date = now() - interval '2 days' WHERE id = $1`, quoteId);
    const before = await quoteRow(quoteId);
    const res = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('quote_expired');
    expect(JSON.stringify(res.body)).not.toContain(String(before.view_token));
    expect(await quoteRow(quoteId)).toEqual(before);
    // Regression control: the token holder cannot respond to it either (respondToQuoteByToken).
    const accept = await agent().post(`/commerce/public/quotes/${before.view_token}/accept`).send({});
    expect(accept.status, JSON.stringify(accept.body)).toBe(400);
    expect(await quoteRow(quoteId)).toEqual(before);
  });

  it('PL-08: a converted quote answers 400 quote_converted; the quote and its invoice are unchanged', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    const token = (await quoteRow(quoteId)).view_token;
    const accepted = await agent().post(`/commerce/public/quotes/${token}/accept`).send({});
    expect([200, 201], JSON.stringify(accepted.body)).toContain(accepted.status);
    const converted = await agent().post(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}/convert`).set(HEADER, ID.ownerA).send({});
    expect([200, 201], JSON.stringify(converted.body)).toContain(converted.status);
    const before = await quoteRow(quoteId);
    expect(before.invoice_id).toBeTruthy();
    const stateA = await tenantState(ID.bizA);

    const res = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('quote_converted');
    expect(res.body).not.toHaveProperty('token');
    expect(await tenantState(ID.bizA)).toBe(stateA);
  });

  it('PL-09: a SENT quote written with no token gets its one token from the link route (compare-and-set: two concurrent calls answer the same token), then the link is stable', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    // The ai-execute send_quote action writes SENT with no token (V1-50 review CR-V150-2).
    await db.$executeRawUnsafe(`UPDATE quotes SET view_token = NULL WHERE id = $1`, quoteId);
    const before = await quoteRow(quoteId);
    recordedEvents.length = 0;

    const [a, b] = await Promise.all([publicLink(ID.ownerA, ID.bizA, quoteId), publicLink(ID.ownerA, ID.bizA, quoteId)]);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(b.body).toEqual(a.body);
    const after = await quoteRow(quoteId);
    expect(after.view_token).toBe(a.body.token);
    expect(after.status).toBe('SENT');
    expect(after.sent_at).toBe(before.sent_at);
    expect(recordedEvents).toHaveLength(0);

    const again = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(again.body).toEqual(a.body);
    expect(await quoteRow(quoteId)).toEqual(after);
  });
});

describe('LEDGER (V1-52)', () => {
  it('no FinancialTransaction or ledger entry is written by link creation or a public view on an ACCRUAL tenant', async () => {
    const quoteId = await sentQuote(ID.ownerA, ID.bizA, ID.contactA);
    const ledgerA = await ledgerCounts(ID.bizA);
    const ledgerB = await ledgerCounts(ID.bizB);

    const link = await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    await publicLink(ID.ownerA, ID.bizA, quoteId);
    expect((await publicView(link.body.token)).status).toBe(200);
    expect((await publicView(link.body.token)).status).toBe(200);
    await publicLink(ID.ownerB, ID.bizB, quoteId);

    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerA);
    expect(await ledgerCounts(ID.bizB)).toEqual(ledgerB);
    expect(gmailCalls).toHaveLength(0);
  });
});
