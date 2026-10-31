/**
 * R0-28-QUOTE-STATUS-AUTH — the quote status route (REAL database).
 *
 * M21 / CF-15 (authorization half). PATCH /commerce/quotes/:quoteId/status/:status
 * is a bare-id write the operator app calls with `{ businessId }` in the body
 * (apps/web/src/lib/client.ts updateQuoteStatus). At its base it ran AuthGuard
 * and BusinessGuard on that body tenant and nothing else:
 *
 *   - no ModuleScopeGuard, so a STAFF member with revenue:read (or the STAFF
 *     role default, or an explicit revenue:none) sent, accepted or rejected a
 *     quote — 200 and the status changed, while every other revenue write on
 *     the controller requires revenue:write;
 *   - the handler read the body tenant and dropped it; the service looked the
 *     quote up by id alone and then required a Membership of the QUOTE's
 *     tenant with a plain Error, so a member of B naming B on A's quote got a
 *     500 (nothing written, but a 500 where an unknown id must be answered),
 *     and an unknown or soft-deleted id was a 500 too.
 *
 * Contract pinned here (no state machine: the transition table, the single
 * viewToken mint and bulk updates are V1-50, behind D-04):
 *
 *   revenue:read / STAFF default / revenue:none   -> 403 Insufficient permissions; the quote is byte-identical
 *   a member of B, body B, on A's quote           -> 404, byte-identical to an unknown id; A's quote unchanged
 *   unknown or soft-deleted id                    -> the same 404
 *   SUPER_ADMIN naming a tenant it is not in      -> 403 (the service's membership refusal), never 500
 *   no tenant anywhere                            -> 403 businessId is required
 *   OWNER / revenue:write naming its own tenant   -> 200 and the status changes (path and body unchanged)
 *   LEDGER: no quote transition writes a FinancialTransaction or a LedgerEntry
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService and the real ledger chain
 * (RevenuePostingService, PostingService, ChartOfAccountsSeederService) run
 * against DATABASE_URL, behind the production GlobalHttpExceptionFilter and
 * ValidationPipe. Identity attachment is the one stand-in: a test middleware
 * reads `x-k28a-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 * Collaborators off the boundary (event bus, contact timeline, stats cache,
 * Gmail / AI / Drive) are recorders or stubs, so the cases can assert that a
 * refused request emitted nothing.
 *
 * Fixtures: prefix `k28a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. One quote per case, so no case reads another's write.
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

const P = 'k28a_';
const HEADER = 'x-k28a-user';

const ID = {
  // identities
  ownerA: `${P}ownerA`,               // OWNER of bizA
  staffWriteA: `${P}staffWriteA`,     // STAFF of bizA, revenue: write
  staffReadA: `${P}staffReadA`,       // STAFF of bizA, revenue: read (explicit)
  staffDefaultA: `${P}staffDefaultA`, // STAFF of bizA, no explicit scopes (role default: revenue read)
  staffNoneA: `${P}staffNoneA`,       // STAFF of bizA, revenue: none
  noMember: `${P}noMember`,           // no membership anywhere
  ownerB: `${P}ownerB`,               // OWNER of bizB only
  superAdmin: `${P}superAdmin`,       // role SUPER_ADMIN, no membership
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // tenant A quotes, one per case
  qRead: `${P}qRead`,
  qScopes: `${P}qScopes`,
  qCross: `${P}qCross`,
  qCrossQuery: `${P}qCrossQuery`,
  qDeleted: `${P}qDeleted`,
  qSuper: `${P}qSuper`,
  qNoTenant: `${P}qNoTenant`,
  qNonMember: `${P}qNonMember`,
  qOwnerSend: `${P}qOwnerSend`,
  qWriteAccept: `${P}qWriteAccept`,
  qOwnerReject: `${P}qOwnerReject`,
  // tenant B
  qB: `${P}qB`,
  qBOwn: `${P}qBOwn`,
  unknown: `${P}qNoSuchQuote`,
};

/** Seeded status per quote (everything else is DRAFT). */
const SEEDED_STATUS: Record<string, string> = {
  [ID.qWriteAccept]: 'SENT',
  [ID.qOwnerReject]: 'SENT',
  [ID.qScopes]: 'SENT',
};

const TENANT_B_QUOTES = new Set<string>([ID.qB, ID.qBOwn]);

let db: any;
let app: any;

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

const crmCalls: any[] = [];
const crmRecorder = {
  logContactEvent: async (input: unknown) => {
    crmCalls.push(input);
    return { id: `${P}evt_${crmCalls.length}` };
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id LIKE ${sqlLikePrefix(P)}`,
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

/**
 * The route under test, exactly as the web client calls it: lower-case status
 * in the path, `{ businessId }` in the body. `query` adds a query string.
 */
function setQuoteStatus(actor: string | null, quoteId: string, status: string, body: Record<string, unknown>, query = '') {
  const req = agent().patch(`/commerce/quotes/${quoteId}/status/${status}${query}`);
  return (actor ? req.set(HEADER, actor) : req).send(body);
}

/** Error bodies differ only in volatile envelope fields; strip those before comparing. */
function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

/** Every column a status change can touch, read raw (the soft-delete extension hides deleted rows). */
async function quoteRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, business_id AS "businessId", sent_at AS "sentAt", accepted_at AS "acceptedAt",
            rejected_at AS "rejectedAt", view_token AS "viewToken", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM quotes WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

/** Every quote row of a tenant, as plain JSON (byte-for-byte comparable). */
async function tenantQuotes(businessId: string): Promise<string> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, sent_at AS "sentAt", accepted_at AS "acceptedAt", rejected_at AS "rejectedAt",
            view_token AS "viewToken", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM quotes WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  return JSON.stringify(rows);
}

async function ledgerCounts(businessId: string) {
  return {
    transactions: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

/** The refused request wrote nothing: the row is byte-identical and nothing was emitted or logged. */
async function expectUntouched(quoteId: string, before: unknown, eventsBefore: number, crmBefore: number) {
  expect(await quoteRow(quoteId), `row of ${quoteId}`).toEqual(before);
  expect(recordedEvents.length, `events after a refused request on ${quoteId}`).toBe(eventsBefore);
  expect(crmCalls.length, `timeline entries after a refused request on ${quoteId}`).toBe(crmBefore);
}

let ledgerAtStart: { a: { transactions: number; entries: number }; b: { transactions: number; entries: number } };

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
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

  // ---- the real HTTP path, wired before any row is seeded -----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // Present only because the controller's public routes declare it; no case here reaches it.
      PublicRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: {} },
      PlanLimitGuard,
      TeamAuditInterceptor,
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: had a quote transition posted, the LEDGER case would see real rows.
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

  // ---- identities ---------------------------------------------------------
  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.staffWriteA, 'USER'], [ID.staffReadA, 'USER'], [ID.staffDefaultA, 'USER'],
    [ID.staffNoneA, 'USER'], [ID.noMember, 'USER'], [ID.ownerB, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }

  // ---- tenants, each with a system chart of accounts ----------------------
  await db.business.create({ data: { id: ID.bizA, name: 'K28A Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'K28A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  for (const biz of [ID.bizA, ID.bizB]) await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);

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
  await m(ID.staffWriteA, ID.bizA, 'STAFF', { revenue: 'write' });
  await m(ID.staffReadA, ID.bizA, 'STAFF', { revenue: 'read' });
  await m(ID.staffDefaultA, ID.bizA, 'STAFF');
  await m(ID.staffNoneA, ID.bizA, 'STAFF', { revenue: 'none', crm: 'read' });
  await m(ID.ownerB, ID.bizB, 'OWNER');

  // ---- contacts (Quote.contactId is required) ------------------------------
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'K28a', lastName: 'CustomerA', email: `${P}contactA@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'K28a', lastName: 'CustomerB', email: `${P}contactB@test.local` } });

  // ---- quotes, one per case -----------------------------------------------
  let n = 0;
  const quoteIds = Object.values(ID).filter((v) => v.startsWith(`${P}q`) && v !== ID.unknown);
  for (const id of quoteIds) {
    n += 1;
    const biz = TENANT_B_QUOTES.has(id) ? ID.bizB : ID.bizA;
    const status = SEEDED_STATUS[id] ?? 'DRAFT';
    await db.quote.create({
      data: {
        id,
        quoteNumber: `K28A-${String(n).padStart(3, '0')}`,
        status,
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        businessId: biz,
        contactId: biz === ID.bizA ? ID.contactA : ID.contactB,
        ...(status === 'SENT' ? { sentAt: new Date('2026-10-01T10:00:00.000Z'), viewToken: `${P}tok_${id.slice(P.length)}` } : {}),
        ...(id === ID.qDeleted ? { deletedAt: new Date() } : {}),
        items: { create: [{ id: `${id}_item1`, description: `K28A item ${n}`, quantity: 1, unitPrice: 100, total: 100 }] },
      },
    });
  }

  ledgerAtStart = { a: await ledgerCounts(ID.bizA), b: await ledgerCounts(ID.bizB) };
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('two tenants with real memberships and a system chart of accounts; every quote seeded in its status, the soft-deleted one included', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(5);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizA, isSystem: true } })).toBeGreaterThan(0);
    expect((await quoteRow(ID.qRead)).status).toBe('DRAFT');
    expect((await quoteRow(ID.qWriteAccept)).status).toBe('SENT');
    expect((await quoteRow(ID.qB)).businessId).toBe(ID.bizB);
    expect((await quoteRow(ID.qDeleted)).deletedAt).toBeTruthy();
    expect(await quoteRow(ID.unknown)).toBeNull();
  });
});

describe('write scope: revenue:write is required (R0-28)', () => {
  it('QS-01: a STAFF member with revenue:read sending a DRAFT quote is refused 403 (Insufficient permissions); the quote is byte-identical and nothing is emitted', async () => {
    const before = await quoteRow(ID.qRead);
    const res = await setQuoteStatus(ID.staffReadA, ID.qRead, 'sent', { businessId: ID.bizA });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toMatch(/Insufficient permissions: revenue requires write access \(you have read\)/);
    await expectUntouched(ID.qRead, before, 0, 0);
    expect(before.status).toBe('DRAFT');
    expect(before.viewToken).toBeNull();
  });

  it('QS-02: the STAFF role default and an explicit revenue:none are refused 403 on sent, accepted, rejected and draft; the quote is byte-identical', async () => {
    const before = await quoteRow(ID.qScopes);
    for (const actor of [ID.staffDefaultA, ID.staffNoneA, ID.staffReadA]) {
      for (const status of ['sent', 'accepted', 'rejected', 'draft']) {
        const res = await setQuoteStatus(actor, ID.qScopes, status, { businessId: ID.bizA });
        expect(res.status, `${actor} -> ${status}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.message, `${actor} -> ${status}`).toMatch(/Insufficient permissions/);
      }
    }
    await expectUntouched(ID.qScopes, before, 0, 0);
  });
});

describe('tenant binding: a foreign or unknown quote answers 404 (R0-28)', () => {
  it("QS-03: a member of B naming B in the body on A's quote answers 404, byte-identical to an unknown id; A's quotes are byte-identical", async () => {
    const tenantABefore = await tenantQuotes(ID.bizA);
    const unknown = await setQuoteStatus(ID.ownerB, ID.unknown, 'sent', { businessId: ID.bizB });
    const cross = await setQuoteStatus(ID.ownerB, ID.qCross, 'sent', { businessId: ID.bizB });
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(cross.status, JSON.stringify(cross.body)).toBe(404);
    expect(cross.body).toMatchObject({ statusCode: 404, message: 'Quote not found' });
    expect(stripVolatile(cross.body)).toEqual(stripVolatile(unknown.body));
    expect(await tenantQuotes(ID.bizA)).toBe(tenantABefore);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it("QS-04: B in the body and A in the query string binds B, the tenant the guards checked, and answers the same 404 on A's quote", async () => {
    const before = await quoteRow(ID.qCrossQuery);
    const unknown = await setQuoteStatus(ID.ownerB, ID.unknown, 'accepted', { businessId: ID.bizB });
    const res = await setQuoteStatus(ID.ownerB, ID.qCrossQuery, 'accepted', { businessId: ID.bizB }, `?businessId=${ID.bizA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
    await expectUntouched(ID.qCrossQuery, before, 0, 0);
  });

  it("QS-05: the owner of A naming A on B's quote answers the same 404; B's quotes are byte-identical", async () => {
    const tenantBBefore = await tenantQuotes(ID.bizB);
    const unknown = await setQuoteStatus(ID.ownerA, ID.unknown, 'rejected', { businessId: ID.bizA });
    const res = await setQuoteStatus(ID.ownerA, ID.qB, 'rejected', { businessId: ID.bizA });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
    expect(await tenantQuotes(ID.bizB)).toBe(tenantBBefore);
    expect(recordedEvents).toHaveLength(0);
  });

  it("QS-06: a soft-deleted quote of the caller's own tenant answers the same 404; the row is unchanged", async () => {
    const before = await quoteRow(ID.qDeleted);
    const unknown = await setQuoteStatus(ID.ownerA, ID.unknown, 'sent', { businessId: ID.bizA });
    const res = await setQuoteStatus(ID.ownerA, ID.qDeleted, 'sent', { businessId: ID.bizA });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknown.body));
    await expectUntouched(ID.qDeleted, before, 0, 0);
  });

  it('QS-07: SUPER_ADMIN (no membership) naming A on A\'s quote answers 403, not 500; the quote is byte-identical', async () => {
    const before = await quoteRow(ID.qSuper);
    const res = await setQuoteStatus(ID.superAdmin, ID.qSuper, 'sent', { businessId: ID.bizA });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toBe('Not authorized to update this quote');
    await expectUntouched(ID.qSuper, before, 0, 0);
  });

  it('QS-08: no tenant anywhere answers 403 businessId is required (owner at BusinessGuard, SUPER_ADMIN at the handler); unauthenticated answers 401; a non-member is refused at BusinessGuard', async () => {
    const before = await quoteRow(ID.qNoTenant);
    for (const actor of [ID.ownerA, ID.superAdmin]) {
      const res = await setQuoteStatus(actor, ID.qNoTenant, 'sent', {});
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message, actor).toBe('businessId is required');
    }
    const anonymous = await setQuoteStatus(null, ID.qNoTenant, 'sent', { businessId: ID.bizA });
    expect(anonymous.status).toBe(401);
    await expectUntouched(ID.qNoTenant, before, 0, 0);

    const nonMemberBefore = await quoteRow(ID.qNonMember);
    for (const [actor, biz] of [[ID.noMember, ID.bizA], [ID.ownerB, ID.bizA]] as const) {
      const res = await setQuoteStatus(actor, ID.qNonMember, 'sent', { businessId: biz });
      expect(res.status, actor).toBe(403);
      expect(res.body.message, actor).toBe('No access to this business');
    }
    await expectUntouched(ID.qNonMember, nonMemberBefore, 0, 0);
  });
});

describe('positive controls: the web client contract is unchanged (R0-28)', () => {
  it('QS-09: the owner sends a DRAFT quote with the body the web client sends: 200, SENT with sentAt and a minted viewToken, quote.sent emitted once, a timeline entry with the actor', async () => {
    const res = await setQuoteStatus(ID.ownerA, ID.qOwnerSend, 'sent', { businessId: ID.bizA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.qOwnerSend, businessId: ID.bizA, status: 'SENT' });
    const row = await quoteRow(ID.qOwnerSend);
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toBeTruthy();
    expect(typeof row.viewToken).toBe('string');
    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.sent']);
    expect(recordedEvents[0]!.payload.businessId).toBe(ID.bizA);
    expect(crmCalls).toHaveLength(1);
    expect(crmCalls[0]).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA, type: 'quote.sent', actorType: 'USER', actorId: ID.ownerA });
  });

  it('QS-10: a STAFF member with revenue:write accepts a SENT quote (200, ACCEPTED, acceptedAt) and the owner rejects one (200, REJECTED, rejectedAt)', async () => {
    const accepted = await setQuoteStatus(ID.staffWriteA, ID.qWriteAccept, 'accepted', { businessId: ID.bizA });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const acceptedRow = await quoteRow(ID.qWriteAccept);
    expect(acceptedRow.status).toBe('ACCEPTED');
    expect(acceptedRow.acceptedAt).toBeTruthy();

    const rejected = await setQuoteStatus(ID.ownerA, ID.qOwnerReject, 'rejected', { businessId: ID.bizA });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const rejectedRow = await quoteRow(ID.qOwnerReject);
    expect(rejectedRow.status).toBe('REJECTED');
    expect(rejectedRow.rejectedAt).toBeTruthy();

    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.accepted', 'quote.rejected']);
    expect(crmCalls.map((c) => c.actorId)).toEqual([ID.staffWriteA, ID.ownerA]);
  });

  it("QS-11: the owner of B sends B's own quote (200, SENT); the tenant it acted on is B's", async () => {
    const res = await setQuoteStatus(ID.ownerB, ID.qBOwn, 'sent', { businessId: ID.bizB });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.qBOwn, businessId: ID.bizB, status: 'SENT' });
    expect((await quoteRow(ID.qBOwn)).status).toBe('SENT');
  });
});

describe('LEDGER (R0-28)', () => {
  it('QS-12: no quote transition above (sent, accepted, rejected, refused or not found) wrote a FinancialTransaction or a LedgerEntry in either tenant', async () => {
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerAtStart.a);
    expect(await ledgerCounts(ID.bizB)).toEqual(ledgerAtStart.b);
    expect(ledgerAtStart.a.transactions).toBe(0);
    expect(ledgerAtStart.b.transactions).toBe(0);
  });
});
