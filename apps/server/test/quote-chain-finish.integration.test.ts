/**
 * V1-QUOTE-CHAIN-finish — the review findings left on the V1-50..V1-53 quote
 * chain (REAL database).
 *
 * At this packet's base (ab4527b1, the V1-53 review repairs):
 *
 *   SEC-1   updateQuote checked the quote's status when it read it, then wrote
 *           by id alone: an edit that read a SENT quote overwrote the price, tax
 *           and lines of a quote the customer accepted (or the operator
 *           converted) in between, and convert {} then invoiced terms nobody
 *           accepted.
 *   SEC-5   the public accept carried nothing of what the customer saw: an
 *           operator edit between the view and the click recorded acceptance of
 *           terms the customer never saw.
 *   SEC-2   POST .../quotes/:id/convert returned the invoice with the whole
 *           Contact row (internal notes, phone, owner, visibility) to a
 *           revenue:write member with crm:none (SEC-V51-3).
 *   SEC-6   POST .../quotes/:id/follow-up returned the quote with the whole
 *           Contact row, the same class.
 *   SEC-4 / CR-W10-1
 *           bulk delete soft-deleted a quote converted to an invoice (a legacy
 *           row, or one ai-execute send_quote re-opened), which the single
 *           DELETE refuses with 409 quote_converted.
 *   CR-W10-2
 *           the quote follow-up job emailed the customer and opened an
 *           "unconverted" task for a quote the customer had REJECTED, and
 *           quote.rejected never cancelled the scheduled jobs.
 *
 * Contract pinned here:
 *
 *   QCF-01  an edit that read a SENT quote, racing an accept that commits first,
 *           answers 409 quote_accepted and writes nothing; convert {} invoices
 *           the accepted total
 *   QCF-02  the same edit racing an accept and a convert answers 409
 *           quote_converted; the quote and its invoice keep the accepted terms
 *   QCF-03  ten edit/accept pairs sent together: exactly one of each pair
 *           succeeds; an ACCEPTED quote always holds the total its quote.accepted
 *           event carried, never the edit's
 *   QCF-04  the signed-token view serves termsVersion; an accept carrying the
 *           version of terms an operator has since edited answers 409
 *           quote_terms_changed (nothing written, no event, convert refused);
 *           the fresh version accepts and converts the new terms
 *   QCF-05  an accept with no termsVersion answers 400
 *           quote_terms_version_required; an unknown one 409; a reject needs none
 *   QCF-06  an accept racing a terms edit that commits first answers 409
 *           quote_terms_changed; the quote stays SENT with the edited terms
 *   QCF-07  convert by a revenue:write, crm:none member of a quote on a PRIVATE
 *           contact: 404 Contact not found, nothing written (D-64,
 *           W3-D64-COMMERCE-CREATE); the OWNER's convert: 201 with contact
 *           { id, businessId, firstName, lastName, email } only (SEC-2 /
 *           SEC-V51-3)
 *   QCF-08  follow-up by the same member: 201 with the same projection (SEC-6)
 *   QCF-09  bulk delete skips a converted quote (quote_converted) whatever its
 *           stored status, and deletes the rest (SEC-4 / CR-W10-1)
 *   QCF-10  the follow-up job skips a REJECTED quote and a converted one (no
 *           task, no email, no activity); an open SENT quote still gets both
 *           (CR-W10-2)
 *   QCF-11  quote.rejected cancels the quote's pending follow-up jobs only
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (on this suite's Redis index),
 * CommerceService, InvoiceWorkflowService and the real ledger chain run
 * against DATABASE_URL behind the production GlobalHttpExceptionFilter and
 * ValidationPipe, with the app's TenantInterceptor. Identity attachment is
 * the one stand-in: a test middleware reads `x-v53b-user`, loads that seeded
 * user row and attaches `{ id, email, role }` as AuthMiddleware would.
 * Collaborators off the boundary (event bus, contact timeline, stats cache,
 * Gmail) are recorders; the follow-up job's Gmail, task, activity and
 * transactional-email collaborators are recorders (no provider traffic).
 *
 * Fixtures: prefix `v53b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 * The races hold a real transaction open with the other side's write and
 * release it once the request under test queues on its row lock.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v53b_';
const HEADER = 'x-v53b-user';

const ID = {
  ownerA: `${P}ownerA`,
  staffW: `${P}staffW`, // STAFF of bizA: revenue write, crm none
  bizA: `${P}bizA`,
  contactA: `${P}contactA`,
  contactPrivate: `${P}contactPrivate`, // PRIVATE contact of bizA, owned by ownerA
};

const CANARY_NOTE = `${P}SECRET_NOTE`;
const CANARY_PHONE = '+18685550199';
const WRITE_CONTACT_KEYS = ['businessId', 'email', 'firstName', 'id', 'lastName'];
const EDIT = { taxRate: 50, items: [{ description: 'V53B edited line', quantity: 9, unitPrice: 100 }] };

let db: any;
let app: any;
let redis: any;
let prismaService: any;
let CrossModuleAgent: any;
let previousNamespace: string | undefined;

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

async function cleanup() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cross_module_workflows WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

let quoteSeq = 0;

/** POST /commerce/businesses/:biz/quotes as the owner: one line 1 x 100, no tax, total 100. */
async function createQuote(contactId: string = ID.contactA): Promise<string> {
  quoteSeq += 1;
  const res = await agent()
    .post(`/commerce/businesses/${ID.bizA}/quotes`)
    .set(HEADER, ID.ownerA)
    .send({
      contactId,
      quoteNumber: `${P}Q-${String(quoteSeq).padStart(3, '0')}`,
      items: [{ description: `V53B line ${quoteSeq}`, quantity: 1, unitPrice: 100 }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

function setQuoteStatus(quoteId: string, status: string) {
  return agent().patch(`/commerce/quotes/${quoteId}/status/${status}`).set(HEADER, ID.ownerA).send({ businessId: ID.bizA });
}

function patchQuote(actor: string, quoteId: string, body: Record<string, unknown>) {
  return agent().patch(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}`).set(HEADER, actor).send(body);
}

function publicView(token: string) {
  return agent().get(`/commerce/public/quotes/${encodeURIComponent(token)}`);
}

function publicAccept(token: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/public/quotes/${encodeURIComponent(token)}/accept`).send(body);
}

function convert(actor: string, quoteId: string) {
  return agent().post(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}/convert`).set(HEADER, actor).send({});
}

/** A sent quote whose customer opened the link: its id, token and the termsVersion the view served. */
async function sentAndViewed(contactId: string = ID.contactA) {
  const id = await createQuote(contactId);
  const sent = await setQuoteStatus(id, 'sent');
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const token = (await quoteRow(id)).view_token as string;
  expect(typeof token).toBe('string');
  const view = await publicView(token);
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  return { id, token, termsVersion: view.body.termsVersion as string | undefined };
}

/** A quote the customer accepted through the signed link (the version the view served). */
async function acceptedQuote(contactId: string = ID.contactA) {
  const q = await sentAndViewed(contactId);
  const accepted = await publicAccept(q.token, { termsVersion: q.termsVersion });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  return q;
}

/** Every column of the quote, read raw (the soft-delete extension hides deleted rows). */
async function quoteRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT to_jsonb(q) AS row FROM quotes q WHERE id = $1`, id);
  return rows[0]?.row ?? null;
}

async function quoteItems(id: string): Promise<any[]> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT description, quantity, unit_price AS "unitPrice", total FROM quote_items WHERE quote_id = $1 ORDER BY description`,
    id,
  );
  return rows.map((r) => ({ ...r, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), total: Number(r.total) }));
}

async function invoiceRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT to_jsonb(i) AS row FROM invoices i WHERE id = $1`, id);
  return rows[0]?.row ?? null;
}

async function invoicesOfQuote(quoteId: string): Promise<any[]> {
  return db.$queryRawUnsafe(`SELECT id, total FROM invoices WHERE quote_id = $1`, quoteId);
}

/** The server backend running a transaction client. */
async function backendPid(tx: any): Promise<number> {
  const [row] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
  return Number(row.pid);
}

/** Resolves once some backend waits on a lock held by the backend `holderPid`; throws if none does in time. */
async function waitForLockWaiter(holderPid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND $1::int = ANY(pg_blocking_pids(pid))`,
      holderPid,
    );
    if (row.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`no backend queued on a lock held by backend ${holderPid} within ${timeoutMs}ms`);
}

/**
 * Runs `work` in a real transaction that stays open, holding its row locks,
 * until `release()`: the other side of a race, stopped between its write and
 * its commit.
 */
function holdTransaction(work: (tx: any) => Promise<void>) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let announce!: (pid: number) => void;
  let fail!: (err: unknown) => void;
  const pid = new Promise<number>((resolve, reject) => { announce = resolve; fail = reject; });
  const done = db
    .$transaction(async (tx: any) => {
      await work(tx);
      announce(await backendPid(tx));
      await held;
    }, { maxWait: 10_000, timeout: 60_000 })
    .catch((err: unknown) => {
      fail(err);
      throw err;
    });
  return { pid, release: () => release(), done };
}

/** The decision a public accept writes, as its own transaction would (status, acceptedAt, updatedAt). */
async function acceptInside(tx: any, quoteId: string) {
  await tx.$executeRawUnsafe(
    `UPDATE quotes SET status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = $1`,
    quoteId,
  );
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
  CrossModuleAgent = (await import('../src/modules/flow/cross-module-agent.service')).CrossModuleAgentService;

  previousNamespace = process.env.RATE_LIMIT_KEY_NAMESPACE;
  process.env.RATE_LIMIT_KEY_NAMESPACE = P;
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
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  prismaService = moduleRef.get(PrismaService);
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

  for (const id of [ID.ownerA, ID.staffW]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V53B Biz', ownerId: ID.ownerA, currency: 'TTD', accountingBasis: 'CASH' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_staffW`, userId: ID.staffW, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'write', crm: 'none' } },
  });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V53b', lastName: 'Customer', email: `${P}contactA@test.local` } });
  await db.contact.create({
    data: {
      id: ID.contactPrivate,
      businessId: ID.bizA,
      firstName: 'V53bPrivate',
      lastName: 'Customer',
      email: `${P}private@test.local`,
      phone: CANARY_PHONE,
      visibility: 'PRIVATE',
      ownerId: ID.ownerA,
      notesInternal: CANARY_NOTE,
    },
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
  if (previousNamespace === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = previousNamespace;
});

beforeEach(async () => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
  await clearOwnRateLimits();
});

// ---------------------------------------------------------------------------
// SEC-1: an edit writes only the quote it read
// ---------------------------------------------------------------------------
describe('SEC-1: a quote edit is a compare-and-set on the quote it read', () => {
  it('QCF-01: an edit that read a SENT quote, racing a customer accept that commits first, answers 409 quote_accepted; the accepted price, tax and lines stay, and convert {} invoices the accepted 100', async () => {
    const { id } = await sentAndViewed();
    const accept = holdTransaction((tx) => acceptInside(tx, id));
    const holder = await accept.pid;
    recordedEvents.length = 0;

    const edit = patchQuote(ID.ownerA, id, { contactId: ID.contactA, ...EDIT }).then((r) => r);
    await waitForLockWaiter(holder);
    accept.release();
    await accept.done;
    const res = await edit;

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_accepted');
    const row = await quoteRow(id);
    expect(row.status).toBe('ACCEPTED');
    expect([Number(row.subtotal), Number(row.tax_rate), Number(row.total)]).toEqual([100, 0, 100]);
    expect(await quoteItems(id)).toEqual([{ description: expect.stringMatching(/^V53B line /), quantity: 1, unitPrice: 100, total: 100 }]);
    expect(recordedEvents.map((e) => e.name)).not.toContain('quote.updated');

    const converted = await convert(ID.ownerA, id);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(Number((await invoiceRow(converted.body.id)).total)).toBe(100);
  }, 30_000);

  it('QCF-02: the same edit racing an accept and a convert answers 409 quote_converted; the quote keeps its accepted terms and its invoice is untouched', async () => {
    const { id } = await sentAndViewed();
    const invoiceId = `${id}_inv`;
    const acceptAndConvert = holdTransaction(async (tx) => {
      await acceptInside(tx, id);
      await tx.invoice.create({
        data: { id: invoiceId, businessId: ID.bizA, contactId: ID.contactA, invoiceNumber: invoiceId, status: 'DRAFT', subtotal: 100, total: 100, quoteId: id },
      });
      await tx.$executeRawUnsafe(`UPDATE quotes SET invoice_id = $1, updated_at = now() WHERE id = $2`, invoiceId, id);
    });
    const holder = await acceptAndConvert.pid;

    const edit = patchQuote(ID.ownerA, id, { contactId: ID.contactA, ...EDIT }).then((r) => r);
    await waitForLockWaiter(holder);
    acceptAndConvert.release();
    await acceptAndConvert.done;
    const res = await edit;

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_converted');
    const row = await quoteRow(id);
    expect(row.invoice_id).toBe(invoiceId);
    expect([row.status, Number(row.total)]).toEqual(['ACCEPTED', 100]);
    expect(await quoteItems(id)).toHaveLength(1);
    expect(Number((await invoiceRow(invoiceId)).total)).toBe(100);
  }, 30_000);

  it('QCF-03: ten edit/accept pairs sent together: exactly one side of each pair succeeds, and an ACCEPTED quote always holds the total its quote.accepted event carried (100), never the edited 1350', async () => {
    const quotes = [];
    for (let i = 0; i < 10; i += 1) quotes.push(await sentAndViewed());
    recordedEvents.length = 0;

    const outcomes = await Promise.all(
      quotes.map(async (q) => {
        const [edit, accept] = await Promise.all([
          patchQuote(ID.ownerA, q.id, EDIT),
          publicAccept(q.token, { termsVersion: q.termsVersion }),
        ]);
        return { q, edit, accept };
      }),
    );

    for (const { q, edit, accept } of outcomes) {
      const label = `${q.id}: edit ${edit.status} ${JSON.stringify(edit.body)} / accept ${accept.status} ${JSON.stringify(accept.body)}`;
      expect([edit.status === 200, accept.status === 201].filter(Boolean), label).toHaveLength(1);
      const row = await quoteRow(q.id);
      const acceptedEvents = recordedEvents.filter((e) => e.name === 'quote.accepted' && e.payload.quote.id === q.id);
      if (row.status === 'ACCEPTED') {
        expect(accept.status, label).toBe(201);
        expect(edit.status, label).toBe(409);
        expect(edit.body.code, label).toBe('quote_accepted');
        expect(Number(row.total), label).toBe(100);
        expect(acceptedEvents.map((e) => Number(e.payload.quote.total)), label).toEqual([100]);
      } else {
        expect(row.status, label).toBe('SENT');
        expect(edit.status, label).toBe(200);
        expect(accept.status, label).toBe(409);
        expect(accept.body.code, label).toBe('quote_terms_changed');
        expect(Number(row.total), label).toBe(1350);
        expect(acceptedEvents, label).toHaveLength(0);
      }
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// SEC-5: the public accept binds the terms the customer saw
// ---------------------------------------------------------------------------
describe('SEC-5: the public accept carries the version of the terms the customer saw', () => {
  it('QCF-04: the view serves termsVersion; after an operator edit the old version answers 409 quote_terms_changed (nothing written, no event, convert refused); the fresh version accepts and converts the edited terms', async () => {
    const { id, token, termsVersion } = await sentAndViewed();
    expect(typeof termsVersion, 'GET public/quotes/:token serves termsVersion').toBe('string');
    expect((termsVersion as string).length).toBeGreaterThanOrEqual(20);

    const edited = await patchQuote(ID.ownerA, id, { items: [{ description: 'V53B nine', quantity: 9, unitPrice: 100 }] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const before = await quoteRow(id);
    expect(Number(before.total)).toBe(900);
    recordedEvents.length = 0;

    const stale = await publicAccept(token, { termsVersion });
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(stale.body.code).toBe('quote_terms_changed');
    expect(await quoteRow(id)).toEqual(before);
    expect(recordedEvents.map((e) => e.name)).toEqual([]);
    const refused = await convert(ID.ownerA, id);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.code).toBe('quote_not_accepted');

    const reread = await publicView(token);
    expect(reread.status).toBe(200);
    expect(reread.body.termsVersion).not.toBe(termsVersion);
    expect(Number(reread.body.total)).toBe(900);
    const accepted = await publicAccept(token, { termsVersion: reread.body.termsVersion });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.status).toBe('ACCEPTED');
    const converted = await convert(ID.ownerA, id);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(Number((await invoiceRow(converted.body.id)).total)).toBe(900);
  }, 30_000);

  it('QCF-05: an accept with no termsVersion answers 400 quote_terms_version_required and an unknown one 409 quote_terms_changed, the quote byte-identical and nothing emitted; a reject needs no version', async () => {
    const { id, token } = await sentAndViewed();
    const before = await quoteRow(id);
    recordedEvents.length = 0;

    const missing = await publicAccept(token, {});
    expect(missing.status, JSON.stringify(missing.body)).toBe(400);
    expect(missing.body.code).toBe('quote_terms_version_required');
    const unknown = await publicAccept(token, { termsVersion: 'not-a-version-of-these-terms' });
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(409);
    expect(unknown.body.code).toBe('quote_terms_changed');
    expect(await quoteRow(id)).toEqual(before);
    expect(recordedEvents).toHaveLength(0);

    const rejected = await agent().post(`/commerce/public/quotes/${encodeURIComponent(token)}/reject`).send({ reason: 'no' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
    expect((await quoteRow(id)).status).toBe('REJECTED');
  });

  it('QCF-06: an accept racing a terms edit that commits first answers 409 quote_terms_changed; the quote stays SENT with the edited terms and no quote.accepted is emitted', async () => {
    const { id, token, termsVersion } = await sentAndViewed();
    const editTx = holdTransaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE quote_items SET quantity = 9, total = 900 WHERE quote_id = $1`, id);
      await tx.$executeRawUnsafe(`UPDATE quotes SET subtotal = 900, total = 900, updated_at = now() WHERE id = $1`, id);
    });
    const holder = await editTx.pid;
    recordedEvents.length = 0;

    const accept = publicAccept(token, { termsVersion }).then((r) => r);
    await waitForLockWaiter(holder);
    editTx.release();
    await editTx.done;
    const res = await accept;

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_terms_changed');
    const row = await quoteRow(id);
    expect([row.status, Number(row.total), row.accepted_at]).toEqual(['SENT', 900, null]);
    expect(recordedEvents.map((e) => e.name)).not.toContain('quote.accepted');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// SEC-2 (SEC-V51-3) and SEC-6: quote write responses carry the projected contact
// ---------------------------------------------------------------------------
describe('SEC-2 / SEC-6: convert and follow-up answer with the projected contact', () => {
  function expectWriteProjection(contact: any) {
    expect(Object.keys(contact ?? {}).sort(), JSON.stringify(contact)).toEqual(WRITE_CONTACT_KEYS);
    expect(contact).toMatchObject({ id: ID.contactPrivate, businessId: ID.bizA, firstName: 'V53bPrivate' });
  }

  function expectNothingPrivate(body: unknown) {
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(CANARY_NOTE);
    expect(raw).not.toContain(CANARY_PHONE);
    expect(raw).not.toContain('PRIVATE');
  }

  // W3-D64-COMMERCE-CREATE (owner ruling D-64): convert refuses (404) a quote
  // whose contact the acting member cannot open under CRM visibility, so the
  // crm:none member no longer converts it (it answered 201 with the projected
  // contact). The SEC-2 projection stays proven on the convert of a member who
  // may open the contact: the OWNER.
  it('QCF-07 (SEC-2 / SEC-V51-3, D-64): a revenue:write, crm:none member converting a quote on a PRIVATE contact gets 404 Contact not found, no invoice and the quote stays unconverted; the OWNER converting it gets 201 with contact { id, businessId, firstName, lastName, email } only; the invoice.created listener still receives the whole contact', async () => {
    const { id } = await acceptedQuote(ID.contactPrivate);
    recordedEvents.length = 0;

    const invoicesBefore = await db.invoice.count({ where: { businessId: ID.bizA } });
    const refused = await convert(ID.staffW, id);
    expect(refused.status, JSON.stringify(refused.body)).toBe(404);
    expect(refused.body.message).toBe('Contact not found');
    expectNothingPrivate(refused.body);
    expect(JSON.stringify(refused.body)).not.toContain('V53bPrivate');
    expect(await db.invoice.count({ where: { businessId: ID.bizA } })).toBe(invoicesBefore);
    expect(await db.quote.findUnique({ where: { id } })).toMatchObject({ status: 'ACCEPTED', invoiceId: null });
    expect(recordedEvents.filter((e) => e.name === 'invoice.created')).toEqual([]);

    const res = await convert(ID.ownerA, id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ quoteId: id, contactId: ID.contactPrivate, status: 'DRAFT' });
    expectWriteProjection(res.body.contact);
    expectNothingPrivate(res.body);
    const created = recordedEvents.filter((e) => e.name === 'invoice.created');
    expect(created).toHaveLength(1);
    expect(created[0].payload.invoice.contact).toMatchObject({ id: ID.contactPrivate, phone: CANARY_PHONE });

    const detail = await agent().get(`/commerce/businesses/${ID.bizA}/quotes/${id}`).set(HEADER, ID.staffW);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const { firstName, lastName, email } = res.body.contact;
    expect(detail.body.contact).toEqual({ firstName, lastName, email });
  });

  it('QCF-08 (SEC-6): the same member sending the follow-up of a SENT quote on that PRIVATE contact gets 201 with the same projection', async () => {
    const id = await createQuote(ID.contactPrivate);
    expect((await setQuoteStatus(id, 'sent')).status).toBe(200);

    const res = await agent().post(`/commerce/businesses/${ID.bizA}/quotes/${id}/follow-up`).set(HEADER, ID.staffW).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.quote).toMatchObject({ id, status: 'SENT' });
    expectWriteProjection(res.body.quote.contact);
    expectNothingPrivate(res.body);
    expect((await quoteRow(id)).last_follow_up_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SEC-4 / CR-W10-1: bulk delete refuses a converted quote
// ---------------------------------------------------------------------------
describe('SEC-4 / CR-W10-1: bulk delete never deletes a converted quote', () => {
  it('QCF-09: a converted quote stored SENT (a legacy row) is refused by the single DELETE and skipped by bulk delete (quote_converted, still linked, not deleted); so is one stored ACCEPTED; the unconverted SENT quote in the same request is deleted', async () => {
    const legacy = await acceptedQuote();
    const conv = await convert(ID.ownerA, legacy.id);
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    // Before V1-50 the status route moved a converted quote anywhere; ai-execute send_quote did too.
    await db.$executeRawUnsafe(`UPDATE quotes SET status = 'SENT' WHERE id = $1`, legacy.id);
    const convertedAccepted = await acceptedQuote();
    const conv2 = await convert(ID.ownerA, convertedAccepted.id);
    expect(conv2.status, JSON.stringify(conv2.body)).toBe(201);
    const control = await createQuote();
    expect((await setQuoteStatus(control, 'sent')).status).toBe(200);

    const single = await agent().delete(`/commerce/businesses/${ID.bizA}/quotes/${legacy.id}`).set(HEADER, ID.ownerA);
    expect(single.status, JSON.stringify(single.body)).toBe(409);
    expect(single.body.code).toBe('quote_converted');

    const res = await agent()
      .patch(`/commerce/businesses/${ID.bizA}/quotes/bulk`)
      .set(HEADER, ID.ownerA)
      .send({ ids: [legacy.id, convertedAccepted.id, control], action: 'delete' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: legacy.id, code: 'quote_converted' }),
        expect.objectContaining({ id: convertedAccepted.id, code: 'quote_converted' }),
      ]),
    );
    for (const id of [legacy.id, convertedAccepted.id]) {
      const row = await quoteRow(id);
      expect(row.deleted_at, id).toBeNull();
      expect(row.invoice_id, id).not.toBeNull();
      expect(await invoicesOfQuote(id), id).toHaveLength(1);
    }
    expect((await quoteRow(control)).deleted_at).not.toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// CR-W10-2: the quote follow-up job
// ---------------------------------------------------------------------------
describe('CR-W10-2: the quote follow-up job acts only on an open, unconverted offer', () => {
  const tasks: any[] = [];
  const emails: any[] = [];
  const activities: any[] = [];
  let agentSvc: any;

  beforeAll(() => {
    agentSvc = new CrossModuleAgent(
      prismaService,
      { log: async (input: unknown) => { activities.push(input); return null; } },
      { addTask: async (input: unknown) => { tasks.push(input); return { id: `${P}task` }; }, completeTask: async () => null },
      { sendEmail: async (input: unknown) => { emails.push(input); return { id: `${P}mail` }; } },
      { send: async () => { throw new Error('no transactional email in this suite'); } },
    );
    // The constructor starts the 60 s job poller; stop it so it never runs another suite's jobs.
    agentSvc.onModuleDestroy();
  });

  beforeEach(() => {
    tasks.length = 0;
    emails.length = 0;
    activities.length = 0;
  });

  function followUpJob(quoteId: string) {
    return {
      businessId: ID.bizA,
      entityId: quoteId,
      checkpoint: 'day_first',
      payload: { contactId: ID.contactA, quoteRef: quoteId, days: 3, autoSendEmail: true, contactName: 'V53b', contactEmail: `${P}contactA@test.local` },
    };
  }

  it('QCF-10: a REJECTED quote and a converted one (stored ACCEPTED, or legacy SENT) get no task, no email and no activity; an open SENT quote still gets its task and its email (to the recorder)', async () => {
    const rejected = await sentAndViewed();
    const rej = await agent().post(`/commerce/public/quotes/${encodeURIComponent(rejected.token)}/reject`).send({ reason: 'no' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    const converted = await acceptedQuote();
    expect((await convert(ID.ownerA, converted.id)).status).toBe(201);
    const legacy = await acceptedQuote();
    expect((await convert(ID.ownerA, legacy.id)).status).toBe(201);
    await db.$executeRawUnsafe(`UPDATE quotes SET status = 'SENT' WHERE id = $1`, legacy.id);

    for (const id of [rejected.id, converted.id, legacy.id]) {
      await agentSvc.executeQuoteFollowUpJob(followUpJob(id));
      expect({ id, tasks: tasks.length, emails: emails.length, activities: activities.length }).toEqual({ id, tasks: 0, emails: 0, activities: 0 });
    }

    const open = await createQuote();
    expect((await setQuoteStatus(open, 'sent')).status).toBe(200);
    await agentSvc.executeQuoteFollowUpJob(followUpJob(open));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toMatch(/^Follow up on quote .* still unconverted after 3 days$/);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: `${P}contactA@test.local`, subject: expect.stringMatching(/^Following up on your quote /) });
  }, 30_000);

  it("QCF-11: quote.rejected cancels that quote's pending follow-up jobs and leaves another quote's pending", async () => {
    const rejected = await createQuote();
    const other = await createQuote();
    const due = new Date(Date.now() + 3 * 86_400_000);
    for (const [entityId, checkpoint] of [[rejected, 'day_first'], [rejected, 'day_second'], [other, 'day_first']]) {
      await db.scheduledAgentJob.create({
        data: { businessId: ID.bizA, jobType: 'quote_followup', entityId, checkpoint, scheduledFor: due, payload: {} },
      });
    }

    await agentSvc.handleQuoteRejected({ quote: { id: rejected, businessId: ID.bizA }, businessId: ID.bizA, rejectedAt: new Date(), source: 'public', reason: null });

    const jobs = await db.scheduledAgentJob.findMany({ where: { businessId: ID.bizA, entityId: { in: [rejected, other] } }, orderBy: [{ entityId: 'asc' }, { checkpoint: 'asc' }] });
    expect(jobs.map((j: any) => [j.entityId, j.checkpoint, j.status])).toEqual(
      [
        [rejected, 'day_first', 'CANCELLED'],
        [rejected, 'day_second', 'CANCELLED'],
        [other, 'day_first', 'PENDING'],
      ].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
    );
  });
});
