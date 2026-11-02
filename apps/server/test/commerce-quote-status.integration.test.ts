/**
 * V1-50-QUOTE-STATE-MACHINE — quote status transitions (REAL database).
 *
 * M21 / CF-15 (state-machine half). R0-28 closed the authorization half of
 * PATCH /commerce/quotes/:quoteId/status/:status (revenue:write, the guarded
 * tenant bound, 404 for a foreign id). At this packet's base the route still
 * wrote whatever status the path named:
 *
 *   - ACCEPTED -> DRAFT answered 200, REJECTED -> ACCEPTED answered 200, and a
 *     quote already converted to an invoice could be moved anywhere;
 *   - `/status/converted` wrote the CONVERTED enum value and `/status/bogus`
 *     reached Prisma as a 500;
 *   - repeating `sent` re-stamped sentAt and logged another quote.sent timeline
 *     entry, and two concurrent DRAFT -> SENT requests each minted a token;
 *   - bulkUpdateQuotes kept its own rules: `reject` skipped a DRAFT that the
 *     status route would reject, and wrote no rejectedAt.
 *
 * Contract pinned here (quote-workflow.ts is the one table):
 *
 *   illegal move (ACCEPTED->DRAFT, REJECTED->ACCEPTED, SENT->DRAFT, ...)  -> 409 quote_transition_not_allowed; row unchanged
 *   any move on a converted quote (invoiceId set)                          -> 409 quote_converted; row and invoice unchanged
 *   a status that is not DRAFT/SENT/ACCEPTED/REJECTED                      -> 400 quote_status_unknown; row unchanged
 *   a foreign quote, whatever the move                                     -> R0-28's 404, byte-identical to an unknown id
 *   DRAFT -> SENT                                                          -> one viewToken, minted once; a repeat is a no-op
 *   `sent` on a SENT quote with no viewToken                               -> its one token is minted (review CR-V150-2); nothing else
 *   bulk send / reject                                                     -> the same table, row by row; refused rows listed
 *   bulk reject on a DRAFT                                                 -> skipped quote_bulk_not_eligible (review CR-V150-3)
 *   bulk with an unknown/missing action, or missing/empty ids              -> 400 before any read or write (SEC-V50-1/2, CR-V150-1)
 *   a bulk move                                                            -> its event and a timeline entry naming the actor (SEC-V50-3)
 *   public accept by token, then convert                                   -> the positive control still passes
 *   LEDGER: no quote transition writes a FinancialTransaction or a LedgerEntry
 *
 * V1-QUOTE-CHAIN-finish (the two V1-50 it.todo cases, now real):
 *   QSM-15  a body `status` that disagrees with the path status          -> 400 quote_status_mismatch; row unchanged
 *   QSM-22  POST .../ai-execute send_quote / convert_quote (SEC-V50-4)   -> revenue:write (403 to revenue:none and
 *           revenue:read, nothing written); for a member who has it, the same transition table as the status route
 *           (409 on a REJECTED or converted quote, nothing written; a DRAFT sent gets its one view token and quote.sent)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (on this suite's Redis index),
 * CommerceService and the real ledger chain run against DATABASE_URL, behind
 * the production GlobalHttpExceptionFilter and ValidationPipe, and the app's
 * TenantInterceptor (APP_INTERCEPTOR in app.module.ts; the bulk route's actor
 * comes from its context). The Prisma tenant context provider (main.ts) is
 * not installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-v50a-user`, loads
 * that seeded user row and attaches `{ id, email, role }` as AuthMiddleware
 * would. Collaborators off the boundary (event bus, contact timeline, stats
 * cache, Gmail / AI / Drive) are recorders or stubs.
 *
 * Fixtures: prefix `v50a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. One quote per case, so no case reads another's write.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v50a_';
const HEADER = 'x-v50a-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  unknown: `${P}qNoSuchQuote`,
  staffNoneA: `${P}staffNoneA`, // STAFF of bizA: revenue none
  staffReadA: `${P}staffReadA`, // STAFF of bizA: revenue read
};

/** Quote ids, one per case. */
const Q = {
  acceptedToDraft: `${P}qAcceptedToDraft`,
  rejectedToAccepted: `${P}qRejectedToAccepted`,
  decidedMatrixAccepted: `${P}qMatrixAccepted`,
  decidedMatrixRejected: `${P}qMatrixRejected`,
  sentToDraft: `${P}qSentToDraft`,
  converted: `${P}qConverted`,
  unknownStatus: `${P}qUnknownStatus`,
  draftAccept: `${P}qDraftAccept`,
  draftReject: `${P}qDraftReject`,
  foreignAccepted: `${P}qForeignAccepted`,
  mintOnce: `${P}qMintOnce`,
  reserved: `${P}qReserved`,
  concurrent: `${P}qConcurrent`,
  bulkDraft: `${P}qBulkDraft`,
  bulkReserved: `${P}qBulkReserved`,
  bulkSent: `${P}qBulkSent`,
  bulkAccepted: `${P}qBulkAccepted`,
  bulkRejected: `${P}qBulkRejected`,
  bulkConverted: `${P}qBulkConverted`,
  rejDraft: `${P}qRejDraft`,
  rejSent: `${P}qRejSent`,
  rejAccepted: `${P}qRejAccepted`,
  rejConverted: `${P}qRejConverted`,
  bOwn: `${P}qBOwn`,
  journey: `${P}qJourney`,
  badActionSent: `${P}qBadActionSent`,
  badActionDraft: `${P}qBadActionDraft`,
  auditBulkSent: `${P}qAuditBulkSent`,
  auditBulkDraft: `${P}qAuditBulkDraft`,
  auditRouteSent: `${P}qAuditRouteSent`,
  sentNoToken: `${P}qSentNoToken`,
  sentNoTokenRace: `${P}qSentNoTokenRace`,
  mismatch: `${P}qMismatch`,
  aiRejected: `${P}qAiRejected`,
  aiConverted: `${P}qAiConverted`,
  aiDraft: `${P}qAiDraft`,
  aiSent: `${P}qAiSent`,
};

const SENT_AT = new Date('2026-10-01T10:00:00.000Z');
const DECIDED_AT = new Date('2026-10-02T10:00:00.000Z');

let db: any;
let app: any;
let redis: any;
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
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The status route exactly as the web client calls it: lower-case status in the path, `{ businessId }` in the body. */
function setQuoteStatus(actor: string, quoteId: string, status: string, businessId: string = ID.bizA) {
  return agent().patch(`/commerce/quotes/${quoteId}/status/${status}`).set(HEADER, actor).send({ businessId });
}

function bulk(actor: string, businessId: string, ids: string[], action: 'send' | 'reject' | 'delete') {
  return bulkRaw(actor, businessId, { ids, action });
}

/** The bulk route with any body: the controller binds it to no DTO, so ValidationPipe checks nothing. */
function bulkRaw(actor: string, businessId: string, body: Record<string, unknown>) {
  return agent().patch(`/commerce/businesses/${businessId}/quotes/bulk`).set(HEADER, actor).send(body);
}

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
            rejected_at AS "rejectedAt", view_token AS "viewToken", invoice_id AS "invoiceId",
            updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM quotes WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function tenantQuotes(businessId: string): Promise<string> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, sent_at AS "sentAt", accepted_at AS "acceptedAt", rejected_at AS "rejectedAt",
            view_token AS "viewToken", invoice_id AS "invoiceId", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM quotes WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  return JSON.stringify(rows);
}

async function invoiceRows(businessId: string): Promise<string> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, quote_id AS "quoteId", total, updated_at AS "updatedAt"
       FROM invoices WHERE business_id = $1 ORDER BY id`,
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

let quoteSeq = 0;
type SeedStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';

/** A quote of `businessId` in `status`, with the timestamps and token that status carries. */
async function seedQuote(id: string, status: SeedStatus, opts: { businessId?: string; viewToken?: string | null; converted?: boolean } = {}) {
  quoteSeq += 1;
  const businessId = opts.businessId ?? ID.bizA;
  const sent = status !== 'DRAFT';
  const viewToken = opts.viewToken !== undefined ? opts.viewToken : sent ? `${P}tok_${id.slice(P.length)}` : null;
  await db.quote.create({
    data: {
      id,
      quoteNumber: `V50A-${String(quoteSeq).padStart(3, '0')}`,
      status,
      subtotal: 100,
      total: 100,
      currency: 'TTD',
      businessId,
      contactId: businessId === ID.bizA ? ID.contactA : ID.contactB,
      viewToken,
      ...(sent ? { sentAt: SENT_AT } : {}),
      ...(status === 'ACCEPTED' ? { acceptedAt: DECIDED_AT } : {}),
      ...(status === 'REJECTED' ? { rejectedAt: DECIDED_AT } : {}),
      items: { create: [{ id: `${id}_item1`, description: `V50A item ${quoteSeq}`, quantity: 1, unitPrice: 100, total: 100 }] },
    },
  });
  if (opts.converted) {
    const invoiceId = `${id}_inv`;
    await db.invoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: `V50A-INV-${String(quoteSeq).padStart(3, '0')}`,
        status: 'DRAFT',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        businessId,
        contactId: businessId === ID.bizA ? ID.contactA : ID.contactB,
        quoteId: id,
      },
    });
    await db.$executeRawUnsafe(`UPDATE quotes SET invoice_id = $1 WHERE id = $2`, invoiceId, id);
  }
}

let ledgerAtStart: { a: { transactions: number; entries: number }; b: { transactions: number; entries: number } };

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
  // QSM-22: the ai-execute route (its controller and service are real; the AI model is never called).
  const { CommerceAiController } = await import('../src/modules/commerce/commerce-ai.controller');
  const { CommerceAiService } = await import('../src/modules/commerce/commerce-ai.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');

  // This suite's public rate-limit windows live under its own prefix (R0-00).
  previousNamespace = process.env.RATE_LIMIT_KEY_NAMESPACE;
  process.env.RATE_LIMIT_KEY_NAMESPACE = P;
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, CommerceAiController],
    providers: [
      CommerceAiService,
      { provide: AiUsageService, useValue: {} },
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
      // Real ledger chain: had a quote transition or the conversion posted, the LEDGER case would see real rows.
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The app's TenantInterceptor (APP_INTERCEPTOR), installed where Nest runs it: after the guards.
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V50A Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V50A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  for (const biz of [ID.bizA, ID.bizB]) await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V50a', lastName: 'CustomerA', email: `${P}contactA@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V50a', lastName: 'CustomerB', email: `${P}contactB@test.local` } });
  for (const [id, revenue] of [[ID.staffNoneA, 'none'], [ID.staffReadA, 'read']] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_${id.slice(P.length)}`, userId: id, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue } },
    });
  }

  // ---- one quote per case ---------------------------------------------------
  await seedQuote(Q.acceptedToDraft, 'ACCEPTED');
  await seedQuote(Q.rejectedToAccepted, 'REJECTED');
  await seedQuote(Q.decidedMatrixAccepted, 'ACCEPTED');
  await seedQuote(Q.decidedMatrixRejected, 'REJECTED');
  await seedQuote(Q.sentToDraft, 'SENT');
  await seedQuote(Q.converted, 'ACCEPTED', { converted: true });
  await seedQuote(Q.unknownStatus, 'SENT');
  await seedQuote(Q.draftAccept, 'DRAFT');
  await seedQuote(Q.draftReject, 'DRAFT');
  await seedQuote(Q.foreignAccepted, 'ACCEPTED');
  await seedQuote(Q.mintOnce, 'DRAFT');
  // A DRAFT whose token send-email already reserved (R0-CMF4): DRAFT with a token.
  await seedQuote(Q.reserved, 'DRAFT', { viewToken: `${P}tok_reserved` });
  await seedQuote(Q.concurrent, 'DRAFT');
  await seedQuote(Q.bulkDraft, 'DRAFT');
  await seedQuote(Q.bulkReserved, 'DRAFT', { viewToken: `${P}tok_bulkReserved` });
  await seedQuote(Q.bulkSent, 'SENT');
  await seedQuote(Q.bulkAccepted, 'ACCEPTED');
  await seedQuote(Q.bulkRejected, 'REJECTED');
  await seedQuote(Q.bulkConverted, 'ACCEPTED', { converted: true });
  await seedQuote(Q.rejDraft, 'DRAFT');
  await seedQuote(Q.rejSent, 'SENT');
  await seedQuote(Q.rejAccepted, 'ACCEPTED');
  await seedQuote(Q.rejConverted, 'ACCEPTED', { converted: true });
  await seedQuote(Q.bOwn, 'DRAFT', { businessId: ID.bizB });
  await seedQuote(Q.journey, 'DRAFT');
  await seedQuote(Q.badActionSent, 'SENT');
  await seedQuote(Q.badActionDraft, 'DRAFT');
  await seedQuote(Q.auditBulkSent, 'SENT');
  await seedQuote(Q.auditBulkDraft, 'DRAFT');
  await seedQuote(Q.auditRouteSent, 'SENT');
  // A SENT quote written without a view token, as the ai-execute send_quote action writes one (review CR-V150-2).
  await seedQuote(Q.sentNoToken, 'SENT', { viewToken: null });
  await seedQuote(Q.sentNoTokenRace, 'SENT', { viewToken: null });
  await seedQuote(Q.mismatch, 'DRAFT');
  await seedQuote(Q.aiRejected, 'REJECTED');
  await seedQuote(Q.aiConverted, 'ACCEPTED', { converted: true });
  await seedQuote(Q.aiDraft, 'DRAFT');
  await seedQuote(Q.aiSent, 'SENT');

  ledgerAtStart = { a: await ledgerCounts(ID.bizA), b: await ledgerCounts(ID.bizB) };
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
  if (previousNamespace === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = previousNamespace;
});

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('two tenants with an owner each and a system chart of accounts; every quote seeded in its status, the converted ones linked to an invoice', async () => {
    // The owner, and the revenue:none and revenue:read STAFF members QSM-22 calls ai-execute as.
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(3);
    expect(await db.membership.count({ where: { businessId: ID.bizA, role: 'OWNER' } })).toBe(1);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizA, isSystem: true } })).toBeGreaterThan(0);
    expect((await quoteRow(Q.acceptedToDraft)).status).toBe('ACCEPTED');
    expect((await quoteRow(Q.rejectedToAccepted)).status).toBe('REJECTED');
    expect((await quoteRow(Q.converted)).invoiceId).toBe(`${Q.converted}_inv`);
    expect((await quoteRow(Q.reserved)).viewToken).toBe(`${P}tok_reserved`);
    expect((await quoteRow(Q.bOwn)).businessId).toBe(ID.bizB);
    expect(await quoteRow(ID.unknown)).toBeNull();
  });
});

describe('the transition table on PATCH /commerce/quotes/:quoteId/status/:status (V1-50)', () => {
  it('QSM-01: ACCEPTED -> DRAFT answers 409 quote_transition_not_allowed; the quote is byte-identical and nothing is emitted or logged', async () => {
    const before = await quoteRow(Q.acceptedToDraft);
    const res = await setQuoteStatus(ID.ownerA, Q.acceptedToDraft, 'draft');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_transition_not_allowed');
    expect(res.body.details).toMatchObject({ quoteStatus: 'ACCEPTED', requestedStatus: 'DRAFT' });
    expect(await quoteRow(Q.acceptedToDraft)).toEqual(before);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-02: REJECTED -> ACCEPTED answers 409 quote_transition_not_allowed; the quote is byte-identical and no quote.accepted is emitted', async () => {
    const before = await quoteRow(Q.rejectedToAccepted);
    const res = await setQuoteStatus(ID.ownerA, Q.rejectedToAccepted, 'accepted');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_transition_not_allowed');
    expect(res.body.details).toMatchObject({ quoteStatus: 'REJECTED', requestedStatus: 'ACCEPTED' });
    expect(await quoteRow(Q.rejectedToAccepted)).toEqual(before);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-03: a decided quote cannot be re-opened, re-sent or flipped (ACCEPTED -> SENT/REJECTED, REJECTED -> SENT/DRAFT), and a SENT quote cannot go back to DRAFT: 409 each, rows byte-identical', async () => {
    const cases: Array<[string, string, string]> = [
      [Q.decidedMatrixAccepted, 'sent', 'ACCEPTED'],
      [Q.decidedMatrixAccepted, 'rejected', 'ACCEPTED'],
      [Q.decidedMatrixRejected, 'sent', 'REJECTED'],
      [Q.decidedMatrixRejected, 'draft', 'REJECTED'],
      [Q.sentToDraft, 'draft', 'SENT'],
    ];
    const before = new Map<string, unknown>();
    for (const [id] of cases) before.set(id, await quoteRow(id));
    for (const [id, status, from] of cases) {
      const res = await setQuoteStatus(ID.ownerA, id, status);
      expect(res.status, `${from} -> ${status}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.code, `${from} -> ${status}`).toBe('quote_transition_not_allowed');
      expect(res.body.details, `${from} -> ${status}`).toMatchObject({ quoteStatus: from, requestedStatus: status.toUpperCase() });
    }
    for (const [id] of cases) expect(await quoteRow(id), id).toEqual(before.get(id));
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-04: a quote converted to an invoice answers 409 quote_converted on draft, sent, accepted and rejected; the quote and its invoice are byte-identical', async () => {
    const before = await quoteRow(Q.converted);
    const invoicesBefore = await invoiceRows(ID.bizA);
    for (const status of ['draft', 'sent', 'accepted', 'rejected']) {
      const res = await setQuoteStatus(ID.ownerA, Q.converted, status);
      expect(res.status, `converted -> ${status}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.code, status).toBe('quote_converted');
      expect(res.body.details, status).toMatchObject({ quoteStatus: 'ACCEPTED', requestedStatus: status.toUpperCase() });
    }
    expect(await quoteRow(Q.converted)).toEqual(before);
    expect(await invoiceRows(ID.bizA)).toBe(invoicesBefore);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-05: a path status that is not DRAFT, SENT, ACCEPTED or REJECTED (other enum values included) answers 400 quote_status_unknown, never a write or a 500', async () => {
    const before = await quoteRow(Q.unknownStatus);
    for (const status of ['converted', 'paid', 'invoiced', 'expired', 'viewed', 'bogus']) {
      const res = await setQuoteStatus(ID.ownerA, Q.unknownStatus, status);
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, status).toBe('quote_status_unknown');
    }
    expect(await quoteRow(Q.unknownStatus)).toEqual(before);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-06: positive controls: the operator records a decision on a DRAFT (DRAFT -> ACCEPTED with acceptedAt, DRAFT -> REJECTED with rejectedAt), 200 with one event and one timeline entry each', async () => {
    const accepted = await setQuoteStatus(ID.ownerA, Q.draftAccept, 'accepted');
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ id: Q.draftAccept, status: 'ACCEPTED' });
    const acceptedRow = await quoteRow(Q.draftAccept);
    expect(acceptedRow.status).toBe('ACCEPTED');
    expect(acceptedRow.acceptedAt).toBeInstanceOf(Date);
    expect(acceptedRow.viewToken).toBeNull();

    const rejected = await setQuoteStatus(ID.ownerA, Q.draftReject, 'rejected');
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const rejectedRow = await quoteRow(Q.draftReject);
    expect(rejectedRow.status).toBe('REJECTED');
    expect(rejectedRow.rejectedAt).toBeInstanceOf(Date);

    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.accepted', 'quote.rejected']);
    expect(crmCalls.map((c) => c.type)).toEqual(['quote.accepted', 'quote.rejected']);
    expect(crmCalls.map((c) => c.actorId)).toEqual([ID.ownerA, ID.ownerA]);
  });

  it("QSM-07: tenant binding still comes first: B's owner asking for an illegal move on A's quote gets R0-28's 404, byte-identical to an unknown id, never a 409 that would confirm the quote's state", async () => {
    const tenantABefore = await tenantQuotes(ID.bizA);
    const unknown = await setQuoteStatus(ID.ownerB, ID.unknown, 'draft', ID.bizB);
    const cross = await setQuoteStatus(ID.ownerB, Q.foreignAccepted, 'draft', ID.bizB);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(cross.status, JSON.stringify(cross.body)).toBe(404);
    expect(stripVolatile(cross.body)).toEqual(stripVolatile(unknown.body));
    expect(await tenantQuotes(ID.bizA)).toBe(tenantABefore);
    expect(recordedEvents).toHaveLength(0);
  });
});

describe('the single view-token mint (V1-50)', () => {
  it('QSM-08: DRAFT -> SENT mints one viewToken; a repeated `sent` answers 200 and is a no-op: same token, same sentAt, the row not rewritten, nothing emitted or logged', async () => {
    const first = await setQuoteStatus(ID.ownerA, Q.mintOnce, 'sent');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const afterFirst = await quoteRow(Q.mintOnce);
    expect(afterFirst.status).toBe('SENT');
    expect(afterFirst.viewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(afterFirst.sentAt).toBeInstanceOf(Date);
    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.sent']);
    expect(crmCalls.map((c) => c.type)).toEqual(['quote.sent']);

    recordedEvents.length = 0;
    crmCalls.length = 0;
    const again = await setQuoteStatus(ID.ownerA, Q.mintOnce, 'sent');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ id: Q.mintOnce, status: 'SENT', viewToken: afterFirst.viewToken });
    expect(await quoteRow(Q.mintOnce)).toEqual(afterFirst);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-09: "mark sent" on a DRAFT whose token send-email already reserved keeps that token (R0-CMF4): no second mint', async () => {
    const res = await setQuoteStatus(ID.ownerA, Q.reserved, 'sent');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await quoteRow(Q.reserved);
    expect(row.status).toBe('SENT');
    expect(row.viewToken).toBe(`${P}tok_reserved`);
    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.sent']);
  });

  it('QSM-10: two concurrent DRAFT -> SENT requests both answer 200 with the one token the quote stores; quote.sent is emitted and logged once', async () => {
    const [a, b] = await Promise.all([
      setQuoteStatus(ID.ownerA, Q.concurrent, 'sent'),
      setQuoteStatus(ID.ownerA, Q.concurrent, 'sent'),
    ]);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const row = await quoteRow(Q.concurrent);
    expect(row.status).toBe('SENT');
    expect(a.body.viewToken).toBe(row.viewToken);
    expect(b.body.viewToken).toBe(row.viewToken);
    expect(recordedEvents.filter((e) => e.name === 'quote.sent')).toHaveLength(1);
    expect(crmCalls.filter((c) => c.type === 'quote.sent')).toHaveLength(1);
  });
});

describe('bulkUpdateQuotes goes through the same table (V1-50)', () => {
  it('QSM-11: bulk send moves only the DRAFTs (a reserved token kept, a fresh one minted once), leaves SENT untouched, and lists the decided and converted quotes it refused', async () => {
    const untouched = [Q.bulkSent, Q.bulkAccepted, Q.bulkRejected, Q.bulkConverted];
    const before = new Map<string, unknown>();
    for (const id of untouched) before.set(id, await quoteRow(id));
    const ids = [Q.bulkDraft, Q.bulkReserved, ...untouched];
    const res = await bulk(ID.ownerA, ID.bizA, ids, 'send');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ updated: 2, action: 'send' });
    expect([...res.body.skipped].sort((x: any, y: any) => x.id.localeCompare(y.id))).toEqual(
      [
        { id: Q.bulkAccepted, quoteStatus: 'ACCEPTED', code: 'quote_transition_not_allowed' },
        { id: Q.bulkConverted, quoteStatus: 'ACCEPTED', code: 'quote_converted' },
        { id: Q.bulkRejected, quoteStatus: 'REJECTED', code: 'quote_transition_not_allowed' },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
    const draft = await quoteRow(Q.bulkDraft);
    expect(draft.status).toBe('SENT');
    expect(draft.sentAt).toBeInstanceOf(Date);
    expect(draft.viewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const reserved = await quoteRow(Q.bulkReserved);
    expect(reserved.status).toBe('SENT');
    expect(reserved.viewToken).toBe(`${P}tok_bulkReserved`);
    for (const id of untouched) expect(await quoteRow(id), id).toEqual(before.get(id));
    expect(recordedEvents.filter((e) => e.name === 'quote.sent').map((e) => e.payload.quote.id).sort()).toEqual([Q.bulkDraft, Q.bulkReserved].sort());
  });

  it('QSM-12: bulk reject rejects a SENT quote (with rejectedAt), leaves a DRAFT as it is (quote_bulk_not_eligible: bulk reject moves only a quote whose link is out, as before V1-50 and as the web bulk consumers expect, review CR-V150-3), and refuses the ACCEPTED and the converted quote; the skipped rows stay byte-identical', async () => {
    const draftBefore = await quoteRow(Q.rejDraft);
    const acceptedBefore = await quoteRow(Q.rejAccepted);
    const convertedBefore = await quoteRow(Q.rejConverted);
    const res = await bulk(ID.ownerA, ID.bizA, [Q.rejDraft, Q.rejSent, Q.rejAccepted, Q.rejConverted], 'reject');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ updated: 1, action: 'reject', skippedCount: 3 });
    expect([...res.body.skipped].sort((x: any, y: any) => x.id.localeCompare(y.id))).toEqual(
      [
        { id: Q.rejDraft, quoteStatus: 'DRAFT', code: 'quote_bulk_not_eligible' },
        { id: Q.rejAccepted, quoteStatus: 'ACCEPTED', code: 'quote_transition_not_allowed' },
        { id: Q.rejConverted, quoteStatus: 'ACCEPTED', code: 'quote_converted' },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
    const sent = await quoteRow(Q.rejSent);
    expect(sent.status).toBe('REJECTED');
    expect(sent.rejectedAt).toBeInstanceOf(Date);
    expect(await quoteRow(Q.rejDraft)).toEqual(draftBefore);
    expect(await quoteRow(Q.rejAccepted)).toEqual(acceptedBefore);
    expect(await quoteRow(Q.rejConverted)).toEqual(convertedBefore);
    expect(recordedEvents.map((e) => `${e.name}:${e.payload.quote.id}`)).toEqual([`quote.rejected:${Q.rejSent}`]);
  });

  it("QSM-13: bulk under A's path naming B's quote touches nothing of B's", async () => {
    const tenantBBefore = await tenantQuotes(ID.bizB);
    for (const action of ['send', 'reject'] as const) {
      const res = await bulk(ID.ownerA, ID.bizA, [Q.bOwn], action);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.updated, action).toBe(0);
    }
    expect(await tenantQuotes(ID.bizB)).toBe(tenantBBefore);
    expect(recordedEvents).toHaveLength(0);
  });
});

describe('the bulk route body is checked before any read or write (V1-50 review SEC-V50-1, SEC-V50-2, CR-V150-1)', () => {
  it("QSM-17: an action that is not send, reject or delete ('accept', a misspelling, a wrong case, a number, none) answers 400 quote_bulk_action_unknown; the SENT and DRAFT quotes named stay byte-identical and nothing is emitted or logged", async () => {
    const sentBefore = await quoteRow(Q.badActionSent);
    const draftBefore = await quoteRow(Q.badActionDraft);
    const bodies: Array<Record<string, unknown>> = [
      { ids: [Q.badActionSent], action: 'accept' },
      { ids: [Q.badActionDraft] },
      { ids: [Q.badActionSent, Q.badActionDraft], action: 'Reject' },
      { ids: [Q.badActionSent, Q.badActionDraft], action: 'rejected' },
      { ids: [Q.badActionSent], action: 1 },
      { ids: [Q.badActionSent], action: null },
    ];
    for (const body of bodies) {
      const res = await bulkRaw(ID.ownerA, ID.bizA, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, JSON.stringify(body)).toBe('quote_bulk_action_unknown');
    }
    expect(await quoteRow(Q.badActionSent)).toEqual(sentBefore);
    expect(await quoteRow(Q.badActionDraft)).toEqual(draftBefore);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-18: missing, empty or malformed ids answer 400 quote_bulk_ids_required for send, reject and delete alike; no quote of the tenant changes (without the check, `id: { in: undefined }` reached every quote of the tenant)', async () => {
    const tenantABefore = await tenantQuotes(ID.bizA);
    const bodies: Array<Record<string, unknown>> = [];
    for (const action of ['send', 'reject', 'delete']) {
      bodies.push({ action }, { ids: [], action }, { ids: Q.badActionSent, action }, { ids: [{ not: 'x' }], action }, { ids: [''], action });
    }
    for (const body of bodies) {
      const res = await bulkRaw(ID.ownerA, ID.bizA, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, JSON.stringify(body)).toBe('quote_bulk_ids_required');
    }
    // An empty body names neither: the action is reported first.
    const empty = await bulkRaw(ID.ownerA, ID.bizA, {});
    expect(empty.status, JSON.stringify(empty.body)).toBe(400);
    expect(empty.body.code).toBe('quote_bulk_action_unknown');
    expect(await tenantQuotes(ID.bizA)).toBe(tenantABefore);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });
});

describe('a bulk move is recorded as the status route records it (V1-50 review SEC-V50-3)', () => {
  it("QSM-19: bulk reject emits quote.rejected (source internal, the quote's contact) and logs quote.rejected naming A's owner as a USER, exactly as the status route does; bulk send logs quote.sent naming A's owner and keeps its minimal quote.sent payload (no contact, so no customer email)", async () => {
    const route = await setQuoteStatus(ID.ownerA, Q.auditRouteSent, 'rejected');
    expect(route.status, JSON.stringify(route.body)).toBe(200);
    const routeEvents = recordedEvents.map((e) => ({ name: e.name, source: e.payload.source, contactId: e.payload.quote.contactId }));
    const routeCrm = crmCalls.map((c) => ({ type: c.type, actorType: c.actorType, actorId: c.actorId, contactId: c.contactId, source: c.data.source }));

    recordedEvents.length = 0;
    crmCalls.length = 0;
    const rejected = await bulk(ID.ownerA, ID.bizA, [Q.auditBulkSent], 'reject');
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body).toMatchObject({ updated: 1, action: 'reject' });
    expect((await quoteRow(Q.auditBulkSent)).status).toBe('REJECTED');
    const bulkEvents = recordedEvents.map((e) => ({ name: e.name, source: e.payload.source, contactId: e.payload.quote.contactId }));
    const bulkCrm = crmCalls.map((c) => ({ type: c.type, actorType: c.actorType, actorId: c.actorId, contactId: c.contactId, source: c.data.source }));
    expect(bulkEvents).toEqual([{ name: 'quote.rejected', source: 'internal', contactId: ID.contactA }]);
    expect(bulkCrm).toEqual([{ type: 'quote.rejected', actorType: 'USER', actorId: ID.ownerA, contactId: ID.contactA, source: 'internal' }]);
    expect(bulkEvents).toEqual(routeEvents);
    expect(bulkCrm).toEqual(routeCrm);
    expect(crmCalls[0].data.quoteId).toBe(Q.auditBulkSent);

    recordedEvents.length = 0;
    crmCalls.length = 0;
    const sent = await bulk(ID.ownerA, ID.bizA, [Q.auditBulkDraft], 'send');
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ updated: 1, action: 'send' });
    const sentRow = await quoteRow(Q.auditBulkDraft);
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0].name).toBe('quote.sent');
    expect(recordedEvents[0].payload.quote).toEqual({ id: Q.auditBulkDraft, status: 'SENT', sentAt: sentRow.sentAt, viewToken: sentRow.viewToken });
    expect(crmCalls.map((c) => ({ type: c.type, actorType: c.actorType, actorId: c.actorId, contactId: c.contactId }))).toEqual([
      { type: 'quote.sent', actorType: 'USER', actorId: ID.ownerA, contactId: ID.contactA },
    ]);
  });
});

describe('the view-token repair of a SENT quote without one (V1-50 review CR-V150-2)', () => {
  it('QSM-20: `sent` on a SENT quote with no viewToken mints its one token (sentAt and status unchanged, nothing emitted or logged); a repeat keeps it, and the public accept link then works', async () => {
    const before = await quoteRow(Q.sentNoToken);
    expect(before.viewToken).toBeNull();
    const first = await setQuoteStatus(ID.ownerA, Q.sentNoToken, 'sent');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const row = await quoteRow(Q.sentNoToken);
    expect(row.viewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.body).toMatchObject({ id: Q.sentNoToken, status: 'SENT', viewToken: row.viewToken });
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toEqual(before.sentAt);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);

    const again = await setQuoteStatus(ID.ownerA, Q.sentNoToken, 'sent');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.viewToken).toBe(row.viewToken);
    expect(await quoteRow(Q.sentNoToken)).toEqual(row);

    const accepted = await agent().post(`/commerce/public/quotes/${row.viewToken}/accept`).send({});
    expect([200, 201], JSON.stringify(accepted.body)).toContain(accepted.status);
    expect((await quoteRow(Q.sentNoToken)).status).toBe('ACCEPTED');
  });

  it('QSM-21: two concurrent `sent` requests on a SENT quote with no viewToken store one token, and both answer it', async () => {
    const [a, b] = await Promise.all([
      setQuoteStatus(ID.ownerA, Q.sentNoTokenRace, 'sent'),
      setQuoteStatus(ID.ownerA, Q.sentNoTokenRace, 'sent'),
    ]);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const row = await quoteRow(Q.sentNoTokenRace);
    expect(row.viewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.body.viewToken).toBe(row.viewToken);
    expect(b.body.viewToken).toBe(row.viewToken);
  });
});

describe('ai-execute send_quote / convert_quote (review SEC-V50-4, V1-QUOTE-CHAIN-finish)', () => {
  function aiExecute(actor: string, action: string, params: Record<string, unknown>) {
    return agent().post(`/commerce/businesses/${ID.bizA}/ai-execute`).set(HEADER, actor).send({ action, params });
  }

  async function quoteNumberOf(id: string): Promise<string> {
    const [row] = await db.$queryRawUnsafe(`SELECT quote_number AS n FROM quotes WHERE id = $1`, id);
    return row.n as string;
  }

  it('QSM-22a: a revenue:none or revenue:read member is refused both actions (403) before anything is read or written: the REJECTED quote stays REJECTED, the converted one stays ACCEPTED and linked, nothing is emitted or logged', async () => {
    const rejectedNumber = await quoteNumberOf(Q.aiRejected);
    const convertedNumber = await quoteNumberOf(Q.aiConverted);
    const before = await tenantQuotes(ID.bizA);
    for (const actor of [ID.staffNoneA, ID.staffReadA]) {
      for (const [action, quoteNumber] of [['convert_quote', rejectedNumber], ['send_quote', convertedNumber]]) {
        const res = await aiExecute(actor, action, { quoteNumber });
        expect(res.status, `${actor} ${action}: ${JSON.stringify(res.body)}`).toBe(403);
      }
    }
    expect(await tenantQuotes(ID.bizA)).toBe(before);
    expect(recordedEvents).toHaveLength(0);
    expect(crmCalls).toHaveLength(0);
  });

  it('QSM-22b: for the owner the actions go through the transition table: convert_quote on a REJECTED quote answers 409 quote_transition_not_allowed and send_quote on a converted quote 409 quote_converted; neither row moves and nothing is emitted', async () => {
    const before = await tenantQuotes(ID.bizA);
    const accept = await aiExecute(ID.ownerA, 'convert_quote', { quoteNumber: await quoteNumberOf(Q.aiRejected) });
    expect(accept.status, JSON.stringify(accept.body)).toBe(409);
    expect(accept.body.code).toBe('quote_transition_not_allowed');
    const reopen = await aiExecute(ID.ownerA, 'send_quote', { quoteNumber: await quoteNumberOf(Q.aiConverted) });
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(409);
    expect(reopen.body.code).toBe('quote_converted');
    expect(await tenantQuotes(ID.bizA)).toBe(before);
    expect((await quoteRow(Q.aiConverted)).invoiceId).toBe(`${Q.aiConverted}_inv`);
    expect(recordedEvents).toHaveLength(0);
  });

  it('QSM-22c: send_quote on a DRAFT moves it as the status route does (SENT, its one view token minted, quote.sent, a timeline entry naming the owner); convert_quote on a SENT quote records ACCEPTED with quote.accepted', async () => {
    const sent = await aiExecute(ID.ownerA, 'send_quote', { quoteNumber: await quoteNumberOf(Q.aiDraft) });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body).toMatchObject({ success: true, quoteId: Q.aiDraft });
    const row = await quoteRow(Q.aiDraft);
    expect(row.status).toBe('SENT');
    expect(row.viewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(row.sentAt).not.toBeNull();

    const accepted = await aiExecute(ID.ownerA, 'convert_quote', { quoteNumber: await quoteNumberOf(Q.aiSent) });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body).toMatchObject({ success: true, quoteId: Q.aiSent });
    expect((await quoteRow(Q.aiSent)).status).toBe('ACCEPTED');

    expect(recordedEvents.map((e) => [e.name, e.payload.quote.id])).toEqual([
      ['quote.sent', Q.aiDraft],
      ['quote.accepted', Q.aiSent],
    ]);
    expect(crmCalls.map((c) => [c.type, c.actorId])).toEqual([
      ['quote.sent', ID.ownerA],
      ['quote.accepted', ID.ownerA],
    ]);
  });
});

describe('positive control: send, public accept by token, convert (V1-50)', () => {
  it('QSM-14: the owner sends a DRAFT, the customer accepts it through the signed link, and the owner converts it: one invoice linked to the quote; a second public accept answers 400', async () => {
    const sent = await setQuoteStatus(ID.ownerA, Q.journey, 'sent');
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const token = (await quoteRow(Q.journey)).viewToken;
    expect(typeof token).toBe('string');

    const accepted = await agent().post(`/commerce/public/quotes/${token}/accept`).send({});
    expect([200, 201], JSON.stringify(accepted.body)).toContain(accepted.status);
    expect(accepted.body).toMatchObject({ id: Q.journey, status: 'ACCEPTED' });
    expect((await quoteRow(Q.journey)).status).toBe('ACCEPTED');

    const converted = await agent()
      .post(`/commerce/businesses/${ID.bizA}/quotes/${Q.journey}/convert`)
      .set(HEADER, ID.ownerA)
      .send({});
    expect([200, 201], JSON.stringify(converted.body)).toContain(converted.status);
    expect(converted.body).toMatchObject({ businessId: ID.bizA, quoteId: Q.journey, status: 'DRAFT' });
    const row = await quoteRow(Q.journey);
    expect(row.invoiceId).toBe(converted.body.id);
    expect(row.status).toBe('ACCEPTED');

    const again = await agent().post(`/commerce/public/quotes/${token}/accept`).send({});
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    expect(recordedEvents.map((e) => e.name)).toEqual(['quote.sent', 'quote.accepted', 'quote.converted', 'invoice.created']);
  });
});

describe('path and body disagreement (V1-50, V1-QUOTE-CHAIN-finish)', () => {
  it('QSM-15: a body `status` that disagrees with the path status answers 400 quote_status_mismatch and the DRAFT stays byte-identical; a body status that agrees (any case) moves it', async () => {
    const before = await quoteRow(Q.mismatch);
    for (const status of ['accepted', 'REJECTED', 'bogus', 7]) {
      const res = await agent().patch(`/commerce/quotes/${Q.mismatch}/status/sent`).set(HEADER, ID.ownerA).send({ businessId: ID.bizA, status });
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code).toBe('quote_status_mismatch');
    }
    expect(await quoteRow(Q.mismatch)).toEqual(before);
    expect(recordedEvents).toHaveLength(0);

    const agreed = await agent().patch(`/commerce/quotes/${Q.mismatch}/status/sent`).set(HEADER, ID.ownerA).send({ businessId: ID.bizA, status: 'SENT' });
    expect(agreed.status, JSON.stringify(agreed.body)).toBe(200);
    expect((await quoteRow(Q.mismatch)).status).toBe('SENT');
  });
});

describe('LEDGER (V1-50)', () => {
  it('QSM-16: no quote transition above (refused, no-op, moved, bulk, public accept or the conversion to a DRAFT invoice) wrote a FinancialTransaction or a LedgerEntry in either tenant', async () => {
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerAtStart.a);
    expect(await ledgerCounts(ID.bizB)).toEqual(ledgerAtStart.b);
    expect(ledgerAtStart.a.transactions).toBe(0);
    expect(ledgerAtStart.b.transactions).toBe(0);
  });
});
