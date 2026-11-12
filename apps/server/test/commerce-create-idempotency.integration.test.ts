/**
 * V1-45-DM-CREATE-IDEMPOTENCY — a retried invoice or quote create carries an
 * idempotency key, claimed on the existing idempotency_keys table (REAL
 * database, REAL CommerceService / InvoiceWorkflowService / ledger door; the
 * ledger case issues through the real route behind the real AuthGuard /
 * BusinessGuard / ModuleScopeGuard). No migration: IdempotencyKey already has
 * @@unique([businessId, idempotencyKey]), a status and a requestHash.
 *
 * M22; owner ruling D-15 (2026-11-02): the client sends an `Idempotency-Key`
 * HTTP header (not a body field) on invoice and quote create. At the base
 * (pkt/V1-43-DM-NUMBERING-repair 0fdac41d) create had no idempotency at all:
 * the same create sent twice (a network retry) wrote two documents with two
 * numbers, and issuing both posted revenue twice.
 *
 * The key is claimed under a namespaced slot ('commerce.invoice.create:<key>',
 * 'commerce.quote.create:<key>') inside the create's own transaction, so the
 * document and its idempotency_keys row commit together, and a concurrent
 * create holding the same key waits on the unique index and is then answered
 * with the document that won.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the base):
 *
 *   I-01 RED-BEFORE createInvoice twice with one key (a retry): the same id and number, one Invoice
 *                   row, one invoice.created, one completed idempotency_keys row
 *                   'commerce.invoice.create:<key>' carrying the request hash and the invoice id
 *   I-02 RED-BEFORE Promise.all of 6 createInvoice with one key: all answer one id; one more row only
 *   I-03 RED-BEFORE the same key with a different body (items, notes, contact) is a 409
 *                   idempotency_key_reused; nothing is written
 *   I-04 RED-BEFORE another tenant's identical key is independent: its own invoice and number, and each
 *                   tenant's retry answers its own invoice
 *   I-05 RED-BEFORE a key whose invoice was deleted since answers 409 idempotency_key_spent (never a
 *                   second invoice); a key longer than 255 characters or not a string is a 400 and
 *                   writes nothing
 *   I-06            control: without a key (or with a blank one) every create writes a new invoice and
 *                   no idempotency_keys row, as at the base
 *   Q-01 RED-BEFORE createQuote: a retry and a concurrent burst with one key answer one quote (one row,
 *                   one quote.created); a different body is a 409; the quote and invoice slots of one
 *                   key are independent
 *   L-01 RED-BEFORE LEDGER: after the retries above, issuing every invoice of the business posts one
 *                   invoice_finalized transaction per key, balanced; a create retried after its invoice
 *                   was issued answers that invoice and posts nothing more
 *   H-01..H-08      V1-45b-CREATE-IDEMPOTENCY-HTTP (V1-45 review SEC-V45-1, V45-CR-1, SEC-V45-2,
 *                   SEC-V45-3): the HTTP door. POST .../invoices and .../quotes forward the
 *                   Idempotency-Key header (H-01..H-03); the browser's CORS preflight allows it (H-04);
 *                   a replay writes no second team audit row (H-05, H-07: the quote route is audited
 *                   like the invoice route); a replay at the plan's invoice limit answers the existing
 *                   invoice, not PlanLimitGuard's 403 (H-06); another member of the business presenting
 *                   the same key and body is a 409, never the first member's document (H-08). See the
 *                   describe block at the end.
 *   H-09 RED-BEFORE V1-45b review SEC-V45b-2: the invoice create body (a first create and a keyed
 *                   replay) carries the contact projected as every other invoice write projects it
 *                   (id, businessId, firstName, lastName, email), never the whole Contact row; the
 *                   quote create twin already did (control, the OWNER's); the member's quote twin on
 *                   the now PRIVATE contact is refused 404 (D-64, W3-D64-COMMERCE-CREATE)
 *   H-10 RED-BEFORE W3-V1-45c-EVENT-REPLAY (V1-45b review SEC-V45b-1 / CR-V45b-1, D-15): with the
 *                   production BusinessEventInterceptor installed globally, a keyed replay of POST
 *                   invoices / POST quotes, and the losers of a 3-way concurrent burst, write no second
 *                   invoice.create / quote.create business event (one per document, by the member who
 *                   created it, as the invoice.created / quote.created domain events already are); an
 *                   unkeyed create is still audited once
 *   H-10b RED-BEFORE W3-V1-45c-EVENT-REPLAY review CR-V45c-1 (D-15): exactly one, not at most one.
 *                   A keyed create that commits its document and then fails (a 5xx after the
 *                   commit: the quote's contact timeline write, the invoice's stats cache) never
 *                   reaches the audit; its keyed retry, or a loser of the burst it won, writes the
 *                   document's one invoice.create / quote.create (none at the fix head 596d739c)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed per business), TeamAuditInterceptor,
 * BusinessEventInterceptor (global, as app.module.ts installs it; its emitter a recorder), CommerceService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService and
 * ChartOfAccountsSeederService write real rows, and the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-v45a-user`,
 * loads that seeded user row and attaches `{ id, email, role }` exactly as
 * the Supabase-verifying AuthMiddleware would. EventEmitter2 is a recording
 * stub; the contact timeline, stats cache and AI / Gmail / Drive services are
 * stubs off the boundary.
 *
 * Fixtures: prefix `v45a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency
 * order in beforeAll and afterAll; no $transaction wrapping of the cases. Rows
 * the server creates get server ids under the prefixed businesses and are
 * deleted through them. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v45a_';
const HEADER = 'x-v45a-user';

const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`, // I-01, I-02, L-01: retries and the ledger (ACCRUAL)
  bizB: `${P}bizB`, // I-04: another tenant with the same key
  bizC: `${P}bizC`, // I-03, I-05, I-06: conflicts, validation, no key
  bizQ: `${P}bizQ`, // Q-01: quotes
  contactA: `${P}contactA`,
  contactA2: `${P}contactA2`,
  contactB: `${P}contactB`,
  contactC: `${P}contactC`,
  contactC2: `${P}contactC2`,
  contactQ: `${P}contactQ`,
  // V1-45b: the HTTP door (H-01..H-08).
  member: `${P}member`, // H-08: a STAFF member of bizH with revenue:write
  bizH: `${P}bizH`, // H-01..H-05, H-07, H-08 (ACCRUAL, so the H-01 issue posts)
  bizH2: `${P}bizH2`, // H-01: another tenant with the same key
  bizL: `${P}bizL`, // H-06: at the plan's invoice limit
  contactH: `${P}contactH`,
  contactH2: `${P}contactH2`,
  contactHB: `${P}contactHB`,
  contactL: `${P}contactL`,
  // V1-45b review SEC-V45b-2: a contact with CRM-only fields, made PRIVATE mid-case (H-09).
  contactHP: `${P}contactHP`,
};

/** The client keys. One string is reused across tenants on purpose (I-04). */
const KEY = {
  retry: `${P}retry-7f3c`,
  burst: `${P}burst-19ad`,
  conflict: `${P}conflict-55e1`,
  deleted: `${P}deleted-a0b2`,
  quote: `${P}quote-c4d8`,
  quoteBurst: `${P}quote-burst-e6f0`,
  late: `${P}late-0b77`,
};

/** V1-45b: the keys the HTTP door cases send in the Idempotency-Key header. */
const HKEY = {
  http: `${P}h-http-3a91`,
  conflict: `${P}h-conflict-77c2`,
  quote: `${P}h-quote-0d4e`,
  audit: `${P}h-audit-5b18`,
  auditBurst: `${P}h-audit-burst-c3f7`,
  quoteAudit: `${P}h-quote-audit-91aa`,
  limit: `${P}h-limit-e20b`,
  limitNew: `${P}h-limit-new-6d35`,
  member: `${P}h-member-a7c0`,
  memberOwn: `${P}h-member-own-4f19`,
  projection: `${P}h-projection-2e6b`,
  projectionQuote: `${P}h-projection-quote-8c41`,
  // W3-V1-45c-EVENT-REPLAY (H-10).
  event: `${P}h-event-1c5d`,
  eventBurst: `${P}h-event-burst-7e2a`,
  quoteEvent: `${P}h-quote-event-4b90`,
  quoteEventBurst: `${P}h-quote-event-burst-d36f`,
  // W3-V1-45c-EVENT-REPLAY review CR-V45c-1 (H-10b): creates that fail after their commit.
  failedInvoice: `${P}h-failed-invoice-2d81`,
  failedInvoiceBurst: `${P}h-failed-invoice-burst-6a3e`,
  failedQuote: `${P}h-failed-quote-91aa`,
  failedQuoteBurst: `${P}h-failed-quote-burst-c07b`,
};

/** V1-45b (H-06): the businesses whose stubbed plan answers that the invoice limit is reached. */
const planLimited = new Set<string>();

let db: any;
let app: any;
let redis: any;
let commerce: any;
/** V1-45b (H-04): a second app configured by the production bootstrap (configureNestApp), for the CORS preflight. */
let corsApp: any;

const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/**
 * W3-V1-45c-EVENT-REPLAY (H-10): every business event the real
 * BusinessEventInterceptor (installed as APP_INTERCEPTOR, as app.module.ts
 * does) hands its emitter. The emitter is this recorder: the BullMQ write
 * behind it is evidence-feed.integration.test.ts's concern.
 */
const businessEvents: Array<{ businessId: string; eventType: string; subjectType: string; subjectId: string; actorType: string; actorId: string }> = [];
const businessEventRecorder = {
  emit: async (job: any) => {
    businessEvents.push({
      businessId: job.businessId,
      eventType: job.eventType,
      subjectType: job.subjectType,
      subjectId: String(job.subjectId),
      actorType: job.actorType,
      actorId: job.actorId,
    });
  },
};

/**
 * W3-V1-45c-EVENT-REPLAY review CR-V45c-1 (H-10b): the two services a create
 * calls after its document committed, stubs off the boundary as before, made
 * replaceable so a case can fail one call after the commit (failOnce).
 */
const crmStub: { logContactEvent: (input: any) => Promise<unknown> } = { logContactEvent: async () => null };
const statsStub: { invalidateCache: (businessId: string) => void } = { invalidateCache: () => undefined };

/** The next call of stub[method] throws (the first create past its commit fails); later calls run the stub. */
function failOnce<T extends object>(stub: T, method: keyof T & string, message: string): () => void {
  const original = stub[method] as unknown as (...args: unknown[]) => unknown;
  let failed = false;
  (stub as Record<string, unknown>)[method] = (...args: unknown[]) => {
    if (failed) return original(...args);
    failed = true;
    throw new Error(message);
  };
  return () => {
    (stub as Record<string, unknown>)[method] = original;
  };
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE quotes SET invoice_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE invoices SET quote_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

const items = [{ description: 'v45a line', quantity: 2, unitPrice: 40 }];
const otherItems = [{ description: 'v45a line', quantity: 3, unitPrice: 40 }];

function invoiceInput(businessId: string, contactId: string, extra: Record<string, unknown> = {}) {
  return { businessId, contactId, items, currency: 'TTD', notes: 'v45a invoice', ...extra };
}
function quoteInput(businessId: string, contactId: string, extra: Record<string, unknown> = {}) {
  return { businessId, contactId, items, currency: 'TTD', notes: 'v45a quote', ...extra };
}

/** Every invoice row of the business, soft-deleted ones included. */
async function invoiceRows(businessId: string): Promise<Array<{ id: string; invoice_number: string }>> {
  return db.$queryRawUnsafe('SELECT id, invoice_number FROM invoices WHERE business_id = $1 ORDER BY invoice_number', businessId);
}
async function quoteRows(businessId: string): Promise<Array<{ id: string; quote_number: string }>> {
  return db.$queryRawUnsafe('SELECT id, quote_number FROM quotes WHERE business_id = $1 ORDER BY quote_number', businessId);
}
async function keyRows(businessId: string): Promise<Array<{ idempotency_key: string; status: string; request_hash: string | null; response: any }>> {
  return db.$queryRawUnsafe(
    'SELECT idempotency_key, status, request_hash, response FROM idempotency_keys WHERE business_id = $1 ORDER BY idempotency_key',
    businessId,
  );
}
function createdEvents(name: 'invoice.created' | 'quote.created', businessId: string) {
  return emitted.filter((e) => e.name === name && e.payload?.businessId === businessId);
}

function issue(businessId: string, invoiceId: string) {
  return agent().patch(`/commerce/invoices/${invoiceId}/status/sent`).set(HEADER, ID.owner).send({ businessId, status: 'SENT' });
}

/** The invoice's own postings (sourceType Invoice). */
function postingsOf(invoiceId: string) {
  return db.financialTransaction.findMany({
    where: { sourceType: 'Invoice', sourceId: invoiceId },
    include: { entries: true },
  });
}
async function expectPostedOnce(invoiceId: string) {
  const txs = await postingsOf(invoiceId);
  expect(txs.map((t: any) => t.externalRef), `invoice ${invoiceId} postings`).toEqual([`Invoice:${invoiceId}:invoice_finalized`]);
  const debit = txs[0].entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
  const credit = txs[0].entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
  expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
}

/** The HTTP status and code a service rejection maps to (ConflictException / BadRequestException). */
async function rejectionOf(run: () => Promise<unknown>): Promise<{ status: number | undefined; body: string }> {
  try {
    await run();
  } catch (err: any) {
    return { status: typeof err?.getStatus === 'function' ? err.getStatus() : undefined, body: JSON.stringify(err?.getResponse?.() ?? err?.message) };
  }
  return { status: undefined, body: 'resolved' };
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
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
  const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');

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
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: crmStub },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      {
        provide: SubscriptionsService,
        useValue: {
          checkLimit: async (businessId: string) =>
            planLimited.has(businessId) ? { allowed: false, current: 1, limit: 1, upgradeTo: 'PRO' } : { allowed: true },
        },
      },
      { provide: CommerceStatsService, useValue: statsStub },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
      // W3-V1-45c-EVENT-REPLAY (H-10): the real business event interceptor,
      // global as in app.module.ts; its emitter is the recorder above.
      { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
      { provide: ResilientEmitterService, useValue: businessEventRecorder },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);

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
  // Listening before a burst, so concurrent requests share one server address.
  await new Promise<void>((resolve) => app.getHttpServer().listen(0, resolve));

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  const businesses: Array<[string, string[], 'ACCRUAL' | 'CASH']> = [
    [ID.bizA, [ID.contactA, ID.contactA2], 'ACCRUAL'],
    [ID.bizB, [ID.contactB], 'CASH'],
    [ID.bizC, [ID.contactC, ID.contactC2], 'CASH'],
    [ID.bizQ, [ID.contactQ], 'CASH'],
  ];
  const coa = moduleRef.get(ChartOfAccountsSeederService);
  for (const [biz, contacts, basis] of businesses) {
    await db.business.create({
      data: { id: biz, name: `V45A ${biz}`, slug: biz, ownerId: ID.owner, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${biz}_m_owner`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    for (const contact of contacts) {
      await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V45A', lastName: biz, email: `${P}${contact.slice(P.length)}@test.local` } });
    }
    if (basis === 'ACCRUAL') await coa.ensureDefaults(biz);
  }

  // V1-45b: the HTTP door's businesses, and a second member of bizH (H-08).
  const httpBusinesses: Array<[string, string[], 'ACCRUAL' | 'CASH']> = [
    [ID.bizH, [ID.contactH, ID.contactH2], 'ACCRUAL'],
    [ID.bizH2, [ID.contactHB], 'CASH'],
    [ID.bizL, [ID.contactL], 'CASH'],
  ];
  for (const [biz, contacts, basis] of httpBusinesses) {
    await db.business.create({
      data: { id: biz, name: `V45A ${biz}`, slug: biz, ownerId: ID.owner, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${biz}_m_owner`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    for (const contact of contacts) {
      await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V45A', lastName: biz, email: `${P}${contact.slice(P.length)}@test.local` } });
    }
    if (basis === 'ACCRUAL') await coa.ensureDefaults(biz);
  }
  await db.contact.create({
    data: {
      id: ID.contactHP,
      businessId: ID.bizH,
      firstName: 'V45A',
      lastName: 'Projected',
      email: `${P}contactHP@test.local`,
      phone: '+18685550100',
      notesInternal: `${P}first internal note`,
    },
  });
  await db.user.create({ data: { id: ID.member, email: `${P}member@test.local`, role: 'USER' } });
  await db.membership.create({
    data: { id: `${ID.bizH}_m_member`, userId: ID.member, businessId: ID.bizH, role: 'STAFF', permissionScopes: { revenue: 'write' } },
  });
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (db) await cleanup();
  if (corsApp) await corsApp.close();
  if (app) await app.close();
  if (redis) redis.disconnect();
}, 60_000);

describe('V1-45 create idempotency — invoices (M22, D-15)', () => {
  it('I-01 RED-BEFORE: the same create retried with one key answers the same invoice; one row, one event, one completed key row', async () => {
    const first = await commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA), idempotencyKey: KEY.retry });
    const retry = await commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA), idempotencyKey: KEY.retry });

    expect(retry.id, 'a retry answers the invoice the first call created').toBe(first.id);
    expect(retry.invoiceNumber).toBe(first.invoiceNumber);
    expect(retry.businessId).toBe(ID.bizA);
    // The same shape the first call answered: its lines and its contact.
    expect(retry.items.map((i: any) => i.id).sort()).toEqual(first.items.map((i: any) => i.id).sort());
    expect(retry.contact?.id).toBe(ID.contactA);

    expect((await invoiceRows(ID.bizA)).map((r) => r.id)).toEqual([first.id]);
    expect(createdEvents('invoice.created', ID.bizA), 'a replay emits nothing').toHaveLength(1);

    const keys = await keyRows(ID.bizA);
    expect(keys.map((k) => k.idempotency_key)).toEqual([`commerce.invoice.create:${KEY.retry}`]);
    expect(keys[0].status).toBe('completed');
    expect(keys[0].request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(keys[0].response).toMatchObject({ invoiceId: first.id });
  });

  it('I-02 RED-BEFORE: a burst of 6 concurrent creates with one key answers one invoice', async () => {
    const before = (await invoiceRows(ID.bizA)).length;
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () => commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA), idempotencyKey: KEY.burst })),
    );
    const failures = settled.filter((s) => s.status === 'rejected').map((s: any) => String(s.reason?.message ?? s.reason));
    expect(failures, 'every concurrent retry is answered').toEqual([]);
    const ids = new Set(settled.map((s: any) => s.value.id));
    expect(ids.size, 'one invoice for the key').toBe(1);
    expect((await invoiceRows(ID.bizA)).length).toBe(before + 1);
    expect(createdEvents('invoice.created', ID.bizA)).toHaveLength(2);
    expect((await keyRows(ID.bizA)).map((k) => k.idempotency_key)).toEqual(
      [`commerce.invoice.create:${KEY.burst}`, `commerce.invoice.create:${KEY.retry}`].sort(),
    );
  }, 60_000);

  it('I-03 RED-BEFORE: the same key with a different body is a 409 idempotency_key_reused and writes nothing', async () => {
    const first = await commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC), idempotencyKey: KEY.conflict });
    const variants: Array<Record<string, unknown>> = [
      { items: otherItems },
      { notes: 'v45a another invoice' },
      { contactId: ID.contactC2 },
      { taxRate: 12.5 },
    ];
    for (const extra of variants) {
      const r = await rejectionOf(() => commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC, extra), idempotencyKey: KEY.conflict }));
      expect(r.status, `variant ${JSON.stringify(extra)}`).toBe(409);
      expect(r.body).toContain('idempotency_key_reused');
    }
    expect((await invoiceRows(ID.bizC)).map((r) => r.id)).toEqual([first.id]);
    // The identical body is still a replay.
    const again = await commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC), idempotencyKey: KEY.conflict });
    expect(again.id).toBe(first.id);
  });

  it('I-04 RED-BEFORE: another tenant\'s identical key is independent', async () => {
    const [a] = await invoiceRows(ID.bizA).then((rows) => rows.filter((r) => r.invoice_number === 'INV-0001'));
    const b = await commerce.createInvoice({ ...invoiceInput(ID.bizB, ID.contactB), idempotencyKey: KEY.retry });
    expect(b.id).not.toBe(a.id);
    expect(b.businessId).toBe(ID.bizB);
    expect(b.invoiceNumber, 'bizB numbers its own').toBe('INV-0001');

    const bRetry = await commerce.createInvoice({ ...invoiceInput(ID.bizB, ID.contactB), idempotencyKey: KEY.retry });
    expect(bRetry.id).toBe(b.id);
    const aRetry = await commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA), idempotencyKey: KEY.retry });
    expect(aRetry.id, "bizA's key still answers bizA's invoice").toBe(a.id);
    expect(aRetry.businessId).toBe(ID.bizA);

    expect((await invoiceRows(ID.bizB)).map((r) => r.id)).toEqual([b.id]);
    expect((await keyRows(ID.bizB)).map((k) => k.idempotency_key)).toEqual([`commerce.invoice.create:${KEY.retry}`]);
  });

  it('I-05 RED-BEFORE: a key whose invoice was deleted is spent (409); an over-long or non-string key is a 400 and writes nothing', async () => {
    const first = await commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC, { notes: 'v45a deleted' }), idempotencyKey: KEY.deleted });
    await db.$executeRawUnsafe('UPDATE invoices SET deleted_at = now() WHERE id = $1', first.id);
    const spent = await rejectionOf(() =>
      commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC, { notes: 'v45a deleted' }), idempotencyKey: KEY.deleted }),
    );
    expect(spent.status).toBe(409);
    expect(spent.body).toContain('idempotency_key_spent');

    const before = (await invoiceRows(ID.bizC)).length;
    const keysBefore = (await keyRows(ID.bizC)).length;
    const long = await rejectionOf(() => commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC), idempotencyKey: `${P}${'x'.repeat(256)}` }));
    expect(long.status).toBe(400);
    const notString = await rejectionOf(() => commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC), idempotencyKey: 42 }));
    expect(notString.status).toBe(400);
    expect((await invoiceRows(ID.bizC)).length).toBe(before);
    expect((await keyRows(ID.bizC)).length).toBe(keysBefore);
  });

  it('I-06 control: without a key, or with a blank one, every create writes a new invoice and no key row', async () => {
    const before = (await invoiceRows(ID.bizC)).length;
    const keysBefore = (await keyRows(ID.bizC)).length;
    const one = await commerce.createInvoice(invoiceInput(ID.bizC, ID.contactC, { notes: 'v45a no key' }));
    const two = await commerce.createInvoice(invoiceInput(ID.bizC, ID.contactC, { notes: 'v45a no key' }));
    const blank = await commerce.createInvoice({ ...invoiceInput(ID.bizC, ID.contactC, { notes: 'v45a no key' }), idempotencyKey: '   ' });
    expect(new Set([one.id, two.id, blank.id]).size).toBe(3);
    expect((await invoiceRows(ID.bizC)).length).toBe(before + 3);
    expect((await keyRows(ID.bizC)).length).toBe(keysBefore);
  });
});

describe('V1-45 create idempotency — quotes (M22, D-15)', () => {
  it('Q-01 RED-BEFORE: a retried and a concurrent quote create with one key answer one quote; a different body is a 409; quote and invoice slots are independent', async () => {
    const first = await commerce.createQuote({ ...quoteInput(ID.bizQ, ID.contactQ), idempotencyKey: KEY.quote });
    const retry = await commerce.createQuote({ ...quoteInput(ID.bizQ, ID.contactQ), idempotencyKey: KEY.quote });
    expect(retry.id).toBe(first.id);
    expect(retry.quoteNumber).toBe(first.quoteNumber);
    expect(retry.items.map((i: any) => i.id).sort()).toEqual(first.items.map((i: any) => i.id).sort());
    expect(retry.contact?.id).toBe(ID.contactQ);

    const settled = await Promise.allSettled(
      Array.from({ length: 4 }, () => commerce.createQuote({ ...quoteInput(ID.bizQ, ID.contactQ), idempotencyKey: KEY.quoteBurst })),
    );
    expect(settled.filter((s) => s.status === 'rejected').map((s: any) => String(s.reason?.message ?? s.reason))).toEqual([]);
    expect(new Set(settled.map((s: any) => s.value.id)).size).toBe(1);

    expect((await quoteRows(ID.bizQ)).length, 'one quote per key').toBe(2);
    expect(createdEvents('quote.created', ID.bizQ)).toHaveLength(2);

    const reused = await rejectionOf(() => commerce.createQuote({ ...quoteInput(ID.bizQ, ID.contactQ, { items: otherItems }), idempotencyKey: KEY.quote }));
    expect(reused.status).toBe(409);
    expect(reused.body).toContain('idempotency_key_reused');
    expect((await quoteRows(ID.bizQ)).length).toBe(2);

    // The invoice slot of the same key is its own.
    const invoice = await commerce.createInvoice({ ...invoiceInput(ID.bizQ, ID.contactQ), idempotencyKey: KEY.quote });
    expect(invoice.businessId).toBe(ID.bizQ);
    expect((await keyRows(ID.bizQ)).map((k) => k.idempotency_key)).toEqual(
      [`commerce.invoice.create:${KEY.quote}`, `commerce.quote.create:${KEY.quote}`, `commerce.quote.create:${KEY.quoteBurst}`].sort(),
    );
    const quoteKey = (await keyRows(ID.bizQ)).find((k) => k.idempotency_key === `commerce.quote.create:${KEY.quote}`)!;
    expect(quoteKey.status).toBe('completed');
    expect(quoteKey.response).toMatchObject({ quoteId: first.id });
  }, 60_000);
});

describe('V1-45 create idempotency — ledger', () => {
  it('L-01 RED-BEFORE: issuing every invoice of the business posts one invoice_finalized per key; a late retry posts nothing more', async () => {
    const rows = await invoiceRows(ID.bizA);
    for (const r of rows) {
      const sent = await issue(ID.bizA, r.id);
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    }
    const keyed = (await keyRows(ID.bizA)).map((k) => k.response.invoiceId);
    expect(new Set(keyed).size).toBe(2);
    for (const id of keyed) await expectPostedOnce(id);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA, sourceType: 'Invoice' } }), 'one posting per key').toBe(2);

    // A retry that arrives after its invoice was issued answers that invoice.
    const late = await commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA), idempotencyKey: KEY.retry });
    expect(keyed).toContain(late.id);
    expect(late.status).toBe('SENT');
    expect((await invoiceRows(ID.bizA)).length).toBe(rows.length);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA, sourceType: 'Invoice' } })).toBe(2);

    // And a key first used on an issued business's new invoice still posts once.
    const fresh = await commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA2), idempotencyKey: KEY.late });
    const again = await commerce.createInvoice({ ...invoiceInput(ID.bizA, ID.contactA2), idempotencyKey: KEY.late });
    expect(again.id).toBe(fresh.id);
    expect((await issue(ID.bizA, fresh.id)).status).toBe(200);
    await expectPostedOnce(fresh.id);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA, sourceType: 'Invoice' } })).toBe(3);
  }, 60_000);
});

// V1-45b-CREATE-IDEMPOTENCY-HTTP: the HTTP door. CommerceController.createInvoice
// and .createQuote read the Idempotency-Key header (as SiteController's
// checkoutIdempotencyKey does) and forward it, with the acting member, to the
// claim above. At the base (int/trial-O 9f09d6c8) the routes forwarded only
// the DTO's declared fields, so the header never reached the service
// (SEC-V45-2), the browser's preflight refused it (SEC-V45-1 / V45-CR-1), the
// door's audit and plan guard saw a replay as a new create, and the quote
// route had no audit at all.

const idempotencyHeader = 'Idempotency-Key';

function httpInvoiceBody(contactId: string, extra: Record<string, unknown> = {}) {
  return { contactId, items, currency: 'TTD', notes: 'v45a http invoice', ...extra };
}
function httpQuoteBody(contactId: string, extra: Record<string, unknown> = {}) {
  return { contactId, items, currency: 'TTD', notes: 'v45a http quote', ...extra };
}

function postInvoice(businessId: string, body: Record<string, unknown>, opts: { key?: string; user?: string } = {}) {
  const req = agent().post(`/commerce/businesses/${businessId}/invoices`).set(HEADER, opts.user ?? ID.owner);
  return (opts.key === undefined ? req : req.set(idempotencyHeader, opts.key)).send(body);
}
function postQuote(businessId: string, body: Record<string, unknown>, opts: { key?: string; user?: string } = {}) {
  const req = agent().post(`/commerce/businesses/${businessId}/quotes`).set(HEADER, opts.user ?? ID.owner);
  return (opts.key === undefined ? req : req.set(idempotencyHeader, opts.key)).send(body);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function auditRows(businessId: string, action: string, entityId: string): Promise<Array<{ user_id: string; entity_type: string | null }>> {
  return db.$queryRawUnsafe(
    'SELECT user_id, entity_type FROM team_activity_logs WHERE business_id = $1 AND action = $2 AND entity_id = $3',
    businessId,
    action,
    entityId,
  );
}

/**
 * The audit rows of one entity once the interceptor's write has landed. The
 * interceptor writes after the response, so wait for the first row, then long
 * enough for a late second one to show.
 */
async function settledAuditRows(businessId: string, action: string, entityId: string) {
  const deadline = Date.now() + 5_000;
  while ((await auditRows(businessId, action, entityId)).length === 0 && Date.now() < deadline) await sleep(50);
  await sleep(500);
  return auditRows(businessId, action, entityId);
}

describe('V1-45b create idempotency — the HTTP door (Idempotency-Key header, D-15)', () => {
  it('H-01 RED-BEFORE: POST invoices twice with one Idempotency-Key answers one invoice; issued, a late replay posts nothing more; another tenant is independent', async () => {
    const before = (await invoiceRows(ID.bizH)).length;
    const first = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH), { key: HKEY.http });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const retry = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH), { key: HKEY.http });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.id, 'a retried POST answers the invoice the first one created').toBe(first.body.id);
    expect(retry.body.invoiceNumber).toBe(first.body.invoiceNumber);
    expect((await invoiceRows(ID.bizH)).length).toBe(before + 1);
    const keys = (await keyRows(ID.bizH)).filter((k) => k.idempotency_key === `commerce.invoice.create:${HKEY.http}`);
    expect(keys).toHaveLength(1);
    expect(keys[0].status).toBe('completed');
    expect(keys[0].response).toMatchObject({ invoiceId: first.body.id });

    // Issued (ACCRUAL: one invoice_finalized posting), then replayed once more.
    expect((await issue(ID.bizH, first.body.id)).status).toBe(200);
    const late = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH), { key: HKEY.http });
    expect(late.status).toBe(201);
    expect(late.body.id).toBe(first.body.id);
    expect(late.body.status).toBe('SENT');
    await expectPostedOnce(first.body.id);
    expect((await invoiceRows(ID.bizH)).length).toBe(before + 1);

    // The same key in another tenant is that tenant's own create.
    const other = await postInvoice(ID.bizH2, httpInvoiceBody(ID.contactHB), { key: HKEY.http });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    expect(other.body.id).not.toBe(first.body.id);
    expect(other.body.businessId).toBe(ID.bizH2);
    const otherRetry = await postInvoice(ID.bizH2, httpInvoiceBody(ID.contactHB), { key: HKEY.http });
    expect(otherRetry.body.id).toBe(other.body.id);
    expect((await invoiceRows(ID.bizH2)).map((r) => r.id)).toEqual([other.body.id]);
  }, 60_000);

  it('H-02 RED-BEFORE: POST invoices with a used Idempotency-Key and a different body is a 409 idempotency_key_reused; nothing is written', async () => {
    const first = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-02' }), { key: HKEY.conflict });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const before = (await invoiceRows(ID.bizH)).length;
    for (const extra of [{ notes: 'v45a h-02 another' }, { items: otherItems, notes: 'v45a h-02' }, { contactId: ID.contactH2, notes: 'v45a h-02' }]) {
      const reused = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, extra), { key: HKEY.conflict });
      expect(reused.status, `variant ${JSON.stringify(extra)}: ${JSON.stringify(reused.body)}`).toBe(409);
      expect(JSON.stringify(reused.body)).toContain('idempotency_key_reused');
    }
    expect((await invoiceRows(ID.bizH)).length).toBe(before);
  });

  it('H-03 RED-BEFORE: POST quotes twice with one Idempotency-Key answers one quote; a different body is a 409', async () => {
    const before = (await quoteRows(ID.bizH)).length;
    const first = await postQuote(ID.bizH, httpQuoteBody(ID.contactH), { key: HKEY.quote });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const retry = await postQuote(ID.bizH, httpQuoteBody(ID.contactH), { key: HKEY.quote });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.quoteNumber).toBe(first.body.quoteNumber);
    expect((await quoteRows(ID.bizH)).length).toBe(before + 1);

    const reused = await postQuote(ID.bizH, httpQuoteBody(ID.contactH, { items: otherItems }), { key: HKEY.quote });
    expect(reused.status).toBe(409);
    expect(JSON.stringify(reused.body)).toContain('idempotency_key_reused');
    expect((await quoteRows(ID.bizH)).length).toBe(before + 1);
  });

  // Probe (V1-45 review): configureNestApp(app), then OPTIONS the route with an Origin header.
  it('H-04 RED-BEFORE: the CORS preflight for POST invoices and POST quotes allows the Idempotency-Key request header (and the public-route list names it)', async () => {
    const { Test } = await import('@nestjs/testing');
    const { configureNestApp } = await import('../src/app-bootstrap');
    const bare = await Test.createTestingModule({}).compile();
    corsApp = bare.createNestApplication();
    configureNestApp(corsApp);
    await corsApp.init();

    for (const route of [`/commerce/businesses/${ID.bizH}/invoices`, `/commerce/businesses/${ID.bizH}/quotes`]) {
      const preflight = await request(corsApp.getHttpServer())
        .options(route)
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
      expect(preflight.status, route).toBe(204);
      const allowed = String(preflight.headers['access-control-allow-headers'] ?? '').toLowerCase().split(/\s*,\s*/);
      expect(allowed, `${route} preflight allows`).toContain('idempotency-key');
      expect(allowed).toEqual(expect.arrayContaining(['content-type', 'authorization', 'x-business-id']));
    }

    // The public widget routes (storefront checkout reads the header too) answer with their own list.
    const publicRoute = await request(corsApp.getHttpServer()).get('/widgets/v45a-probe').set('Origin', 'https://shop.example');
    const publicAllowed = String(publicRoute.headers['access-control-allow-headers'] ?? '').toLowerCase().split(/\s*,\s*/);
    expect(publicAllowed).toContain('idempotency-key');
  });

  it('H-05 RED-BEFORE: a replayed POST invoices writes no second invoice_created team audit row; a concurrent burst writes one', async () => {
    const first = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-05' }), { key: HKEY.audit });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const rows = await settledAuditRows(ID.bizH, 'invoice_created', first.body.id);
    expect(rows.map((r) => [r.user_id, r.entity_type])).toEqual([[ID.owner, 'invoice']]);

    const replay = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-05' }), { key: HKEY.audit });
    expect(replay.body.id).toBe(first.body.id);
    expect(await settledAuditRows(ID.bizH, 'invoice_created', first.body.id), 'a replay is not audited again').toHaveLength(1);

    const burst = await Promise.all(
      Array.from({ length: 3 }, () => postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-05 burst' }), { key: HKEY.auditBurst })),
    );
    expect(burst.map((r) => r.status)).toEqual([201, 201, 201]);
    const ids = new Set(burst.map((r) => r.body.id));
    expect(ids.size, 'one invoice for the key').toBe(1);
    expect(await settledAuditRows(ID.bizH, 'invoice_created', [...ids][0] as string), 'one audit row for the burst').toHaveLength(1);
  }, 60_000);

  it("H-06 RED-BEFORE: a replayed POST invoices at the plan's invoice limit answers the existing invoice, not PlanLimitGuard's 403; a new create is still refused", async () => {
    const first = await postInvoice(ID.bizL, httpInvoiceBody(ID.contactL), { key: HKEY.limit });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    planLimited.add(ID.bizL);
    try {
      const replay = await postInvoice(ID.bizL, httpInvoiceBody(ID.contactL), { key: HKEY.limit });
      expect(replay.status, JSON.stringify(replay.body)).toBe(201);
      expect(replay.body.id).toBe(first.body.id);

      const fresh = await postInvoice(ID.bizL, httpInvoiceBody(ID.contactL), { key: HKEY.limitNew });
      expect(fresh.status).toBe(403);
      expect(JSON.stringify(fresh.body)).toContain('PLAN_LIMIT_REACHED');
      const unkeyed = await postInvoice(ID.bizL, httpInvoiceBody(ID.contactL));
      expect(unkeyed.status).toBe(403);
      expect(JSON.stringify(unkeyed.body)).toContain('PLAN_LIMIT_REACHED');
      // The used key with another body creates nothing either.
      const reused = await postInvoice(ID.bizL, httpInvoiceBody(ID.contactL, { notes: 'v45a h-06 other' }), { key: HKEY.limit });
      expect(reused.status).toBe(409);

      expect((await invoiceRows(ID.bizL)).map((r) => r.id)).toEqual([first.body.id]);
      expect((await keyRows(ID.bizL)).map((k) => k.idempotency_key)).toEqual([`commerce.invoice.create:${HKEY.limit}`]);
    } finally {
      planLimited.delete(ID.bizL);
    }
  });

  it('H-07 RED-BEFORE: POST quotes writes one quote_created team audit row and a replay writes none', async () => {
    const first = await postQuote(ID.bizH, httpQuoteBody(ID.contactH, { notes: 'v45a h-07' }), { key: HKEY.quoteAudit });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const rows = await settledAuditRows(ID.bizH, 'quote_created', first.body.id);
    expect(rows.map((r) => [r.user_id, r.entity_type])).toEqual([[ID.owner, 'quote']]);

    const replay = await postQuote(ID.bizH, httpQuoteBody(ID.contactH, { notes: 'v45a h-07' }), { key: HKEY.quoteAudit });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await settledAuditRows(ID.bizH, 'quote_created', first.body.id)).toHaveLength(1);
  }, 30_000);

  it("H-08 RED-BEFORE (SEC-V45-3): another member presenting the same key and body is a 409, never the first member's document", async () => {
    // The member can create: their own key answers their own invoice.
    const own = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-08 member' }), { key: HKEY.memberOwn, user: ID.member });
    expect(own.status, JSON.stringify(own.body)).toBe(201);

    const ownerDoc = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-08' }), { key: HKEY.member });
    expect(ownerDoc.status, JSON.stringify(ownerDoc.body)).toBe(201);
    const before = (await invoiceRows(ID.bizH)).length;

    const memberTry = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-08' }), { key: HKEY.member, user: ID.member });
    expect(memberTry.status, JSON.stringify(memberTry.body)).toBe(409);
    expect(JSON.stringify(memberTry.body)).toContain('idempotency_key_reused');
    expect(JSON.stringify(memberTry.body)).not.toContain(ownerDoc.body.id);
    expect((await invoiceRows(ID.bizH)).length).toBe(before);

    // The owner's retry still answers the owner's invoice; the member's own retry answers theirs.
    const ownerRetry = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-08' }), { key: HKEY.member });
    expect(ownerRetry.body.id).toBe(ownerDoc.body.id);
    const ownRetry = await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-08 member' }), { key: HKEY.memberOwn, user: ID.member });
    expect(ownRetry.body.id).toBe(own.body.id);

    // The same for quotes.
    const ownerQuote = await postQuote(ID.bizH, httpQuoteBody(ID.contactH, { notes: 'v45a h-08' }), { key: HKEY.member });
    expect(ownerQuote.status, JSON.stringify(ownerQuote.body)).toBe(201);
    const memberQuote = await postQuote(ID.bizH, httpQuoteBody(ID.contactH, { notes: 'v45a h-08' }), { key: HKEY.member, user: ID.member });
    expect(memberQuote.status).toBe(409);
    expect(JSON.stringify(memberQuote.body)).not.toContain(ownerQuote.body.id);
  });

  // V1-45b review SEC-V45b-2 (the R28-ST-01 / SEC-CMF1-2 class): the service
  // answers a create, and a keyed replay, with the whole Contact row as it
  // stands now (`include: { contact: true }`), and the invoice route handed it
  // back unprojected, so a revenue:write member with no CRM scope read a
  // PRIVATE contact's internal notes, phone, owner and visibility.
  it('H-09 RED-BEFORE (SEC-V45b-2, D-64): the invoice create body, first and replayed, carries only the projected contact; the quote create twin is the control, the OWNER first and replayed, and the member who cannot open the now PRIVATE contact is refused 404', async () => {
    const projected = { id: ID.contactHP, businessId: ID.bizH, firstName: 'V45A', lastName: 'Projected', email: `${P}contactHP@test.local` };
    const body = httpInvoiceBody(ID.contactHP, { notes: 'v45a h-09' });
    const first = await postInvoice(ID.bizH, body, { key: HKEY.projection, user: ID.member });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.contact, 'a first create').toEqual(projected);
    expect(first.body.contactId).toBe(ID.contactHP);
    expect(first.body.items).toHaveLength(1);
    expect(JSON.stringify(first.body)).not.toContain('first internal note');
    expect(JSON.stringify(first.body)).not.toContain('+18685550100');

    // The owner makes the contact PRIVATE and records CRM-only fields.
    await db.contact.update({
      where: { id: ID.contactHP },
      data: { visibility: 'PRIVATE', ownerId: ID.owner, notesInternal: `${P}secret internal note`, phone: '+18685550123' },
    });

    const replay = await postInvoice(ID.bizH, body, { key: HKEY.projection, user: ID.member });
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.contact, 'a keyed replay').toEqual(projected);
    for (const leaked of ['secret internal note', '+18685550123', 'PRIVATE', 'notesInternal', 'ownerId']) {
      expect(JSON.stringify(replay.body), leaked).not.toContain(leaked);
    }
    // The same member's own read of the invoice discloses no more than that.
    const read = await agent().get(`/commerce/businesses/${ID.bizH}/invoices/${first.body.id}`).set(HEADER, ID.member);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(Object.keys(replay.body.contact)).toEqual(expect.arrayContaining(Object.keys(read.body.contact)));

    // W3-D64-COMMERCE-CREATE (owner ruling D-64): quote create refuses (404) a
    // contact the acting member cannot open, so the member's quote twin on the
    // now PRIVATE contact (it answered 201) is refused, keyed and repeated,
    // and writes no quote and no key slot.
    const quoteBody = httpQuoteBody(ID.contactHP, { notes: 'v45a h-09' });
    const quotesBefore = await db.quote.count({ where: { businessId: ID.bizH } });
    for (const attempt of ['first', 'repeated']) {
      const refused = await postQuote(ID.bizH, quoteBody, { key: HKEY.projectionQuote, user: ID.member });
      expect(refused.status, `${attempt}: ${JSON.stringify(refused.body)}`).toBe(404);
      expect(refused.body.message).toBe('Contact not found');
      expect(JSON.stringify(refused.body)).not.toContain('secret internal note');
    }
    expect(await db.quote.count({ where: { businessId: ID.bizH } })).toBe(quotesBefore);
    const slot = await db.idempotencyKey.findFirst({ where: { businessId: ID.bizH, idempotencyKey: { endsWith: HKEY.projectionQuote } } });
    expect(slot).toBeNull();

    // Control: the quote create twin projects, first and replayed, for a member who may open the contact (the OWNER).
    const quote = await postQuote(ID.bizH, quoteBody, { key: HKEY.projectionQuote, user: ID.owner });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    const quoteReplay = await postQuote(ID.bizH, quoteBody, { key: HKEY.projectionQuote, user: ID.owner });
    expect(quoteReplay.body.id).toBe(quote.body.id);
    for (const res of [quote, quoteReplay]) {
      expect(res.body.contact).toEqual(projected);
      expect(JSON.stringify(res.body)).not.toContain('secret internal note');
    }
  }, 30_000);

  // V1-45b review SEC-V45b-1 / CR-V45b-1 (confirmed by a probe with the
  // production BusinessEventInterceptor installed globally: three keyed POSTs
  // of one invoice emitted three invoice.create events, a Promise.all burst of
  // three emitted three for one invoice, two keyed POST quotes emitted two
  // quote.create). The global BusinessEventInterceptor (APP_INTERCEPTOR) had
  // an isReplay rule only for the payment routes (R19-ST-1); a lost burst race
  // (whose startedAt precedes the winner's createdAt) is invisible to a
  // createdAt rule, so the handler hands the audit a claim on the document's
  // one event (W3-V1-45c-EVENT-REPLAY; review CR-V45c-1: the first request
  // answered with the document to reach the audit wins it, see H-10b).
  it('H-10 RED-BEFORE (W3-V1-45c-EVENT-REPLAY, SEC-V45b-1 / CR-V45b-1): a keyed replay and a 3-way concurrent burst each leave exactly one invoice.create / quote.create business event; an unkeyed create is still audited', async () => {
    const eventsOf = (eventType: string, subjectId: string) =>
      businessEvents
        .filter((e) => e.businessId === ID.bizH && e.eventType === eventType && e.subjectId === subjectId)
        .map((e) => [e.subjectType, e.actorType, e.actorId]);
    const domainEventsOf = (name: 'invoice.created' | 'quote.created', id: string) =>
      emitted.filter((e) => e.name === name && (name === 'invoice.created' ? e.payload?.invoice?.id : e.payload?.quote?.id) === id);

    // Invoices: a create and its keyed replay, then a 3-way concurrent burst on another key.
    const invoiceBody = httpInvoiceBody(ID.contactH, { notes: 'v45a h-10' });
    const invoice = await postInvoice(ID.bizH, invoiceBody, { key: HKEY.event });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const invoiceReplay = await postInvoice(ID.bizH, invoiceBody, { key: HKEY.event });
    expect(invoiceReplay.status, JSON.stringify(invoiceReplay.body)).toBe(201);
    expect(invoiceReplay.body.id).toBe(invoice.body.id);
    const invoiceBurst = await Promise.all(
      Array.from({ length: 3 }, () => postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-10 burst' }), { key: HKEY.eventBurst })),
    );
    expect(invoiceBurst.map((r) => r.status)).toEqual([201, 201, 201]);
    const invoiceBurstIds = new Set(invoiceBurst.map((r) => r.body.id));
    expect(invoiceBurstIds.size, 'one invoice for the burst key').toBe(1);
    const invoiceBurstId = [...invoiceBurstIds][0] as string;

    // Quotes: the same.
    const quoteBody = httpQuoteBody(ID.contactH, { notes: 'v45a h-10' });
    const quote = await postQuote(ID.bizH, quoteBody, { key: HKEY.quoteEvent });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    const quoteReplay = await postQuote(ID.bizH, quoteBody, { key: HKEY.quoteEvent });
    expect(quoteReplay.status, JSON.stringify(quoteReplay.body)).toBe(201);
    expect(quoteReplay.body.id).toBe(quote.body.id);
    const quoteBurst = await Promise.all(
      Array.from({ length: 3 }, () => postQuote(ID.bizH, httpQuoteBody(ID.contactH, { notes: 'v45a h-10 burst' }), { key: HKEY.quoteEventBurst })),
    );
    expect(quoteBurst.map((r) => r.status)).toEqual([201, 201, 201]);
    const quoteBurstIds = new Set(quoteBurst.map((r) => r.body.id));
    expect(quoteBurstIds.size, 'one quote for the burst key').toBe(1);
    const quoteBurstId = [...quoteBurstIds][0] as string;

    // The interceptor's write is a tap after the handler; let it land.
    await sleep(300);
    const counts = {
      invoiceReplay: eventsOf('invoice.create', invoice.body.id).length,
      invoiceBurst: eventsOf('invoice.create', invoiceBurstId).length,
      quoteReplay: eventsOf('quote.create', quote.body.id).length,
      quoteBurst: eventsOf('quote.create', quoteBurstId).length,
    };
    expect(counts, 'one business event per created document').toEqual({ invoiceReplay: 1, invoiceBurst: 1, quoteReplay: 1, quoteBurst: 1 });
    // The one event names the document and the member who created it.
    for (const [eventType, id] of [
      ['invoice.create', invoice.body.id],
      ['invoice.create', invoiceBurstId],
      ['quote.create', quote.body.id],
      ['quote.create', quoteBurstId],
    ] as const) {
      expect(eventsOf(eventType, id), `${eventType} ${id}`).toEqual([[eventType.split('.')[0], 'human', ID.owner]]);
    }
    // As the domain events already were (I-01, Q-01): one invoice.created / quote.created per document.
    for (const id of [invoice.body.id, invoiceBurstId]) expect(domainEventsOf('invoice.created', id), `invoice.created ${id}`).toHaveLength(1);
    for (const id of [quote.body.id, quoteBurstId]) expect(domainEventsOf('quote.created', id), `quote.created ${id}`).toHaveLength(1);

    // Control: a create without a key is audited as before, once per document.
    const unkeyed = [
      await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-10 unkeyed' })),
      await postInvoice(ID.bizH, httpInvoiceBody(ID.contactH, { notes: 'v45a h-10 unkeyed' })),
    ];
    const unkeyedQuote = await postQuote(ID.bizH, httpQuoteBody(ID.contactH, { notes: 'v45a h-10 unkeyed' }));
    expect([...unkeyed, unkeyedQuote].map((r) => r.status)).toEqual([201, 201, 201]);
    expect(unkeyed[0].body.id).not.toBe(unkeyed[1].body.id);
    await sleep(300);
    for (const r of unkeyed) expect(eventsOf('invoice.create', r.body.id)).toEqual([['invoice', 'human', ID.owner]]);
    expect(eventsOf('quote.create', unkeyedQuote.body.id)).toEqual([['quote', 'human', ID.owner]]);
  }, 60_000);

  // W3-V1-45c-EVENT-REPLAY review CR-V45c-1 (confirmed by a probe at the fix
  // head 596d739c: a keyed POST quotes whose contact timeline write failed
  // after the commit answered 500, its keyed retry answered 201 with the
  // committed quote, and no quote.create business event was ever written; the
  // base wrote exactly one). Marking every answer from a used slot a replay
  // made the event at most one per document: the request that created it
  // never reached the audit, and every later answer was skipped. D-15: the
  // document gets exactly one, written by the first request answered with it
  // that reaches the audit.
  it('H-10b RED-BEFORE (W3-V1-45c-EVENT-REPLAY review CR-V45c-1, D-15): a keyed create that commits and then fails leaves its one invoice.create / quote.create business event to its keyed retry, or to a loser of the burst it won; never none, never two', async () => {
    const eventsOf = (eventType: string, subjectId: string) =>
      businessEvents
        .filter((e) => e.businessId === ID.bizH && e.eventType === eventType && e.subjectId === subjectId)
        .map((e) => [e.subjectType, e.actorType, e.actorId]);
    const committed = async (table: 'invoices' | 'quotes', notes: string): Promise<string[]> =>
      (await db.$queryRawUnsafe(`SELECT id FROM ${table} WHERE business_id = $1 AND notes = $2`, ID.bizH, notes)).map((r: { id: string }) => r.id);

    // 1. Quote, one request then its keyed retry: the contact timeline write fails after the commit.
    const quoteBody = httpQuoteBody(ID.contactH, { notes: 'v45a h-10b quote' });
    let restore = failOnce(crmStub, 'logContactEvent', 'v45a h-10b: contact timeline write failed after the commit');
    const failedQuote = await postQuote(ID.bizH, quoteBody, { key: HKEY.failedQuote });
    restore();
    expect(failedQuote.status, JSON.stringify(failedQuote.body)).toBe(500);
    const [quoteId, ...extraQuotes] = await committed('quotes', 'v45a h-10b quote');
    expect(extraQuotes, 'the failed request committed one quote').toEqual([]);
    const quoteRetry = await postQuote(ID.bizH, quoteBody, { key: HKEY.failedQuote });
    expect(quoteRetry.status, JSON.stringify(quoteRetry.body)).toBe(201);
    expect(quoteRetry.body.id, 'the keyed retry answers the committed quote').toBe(quoteId);

    // 2. Invoice, the same: the stats cache call after the commit fails.
    const invoiceBody = httpInvoiceBody(ID.contactH, { notes: 'v45a h-10b invoice' });
    restore = failOnce(statsStub, 'invalidateCache', 'v45a h-10b: stats cache failed after the commit');
    const failedInvoice = await postInvoice(ID.bizH, invoiceBody, { key: HKEY.failedInvoice });
    restore();
    expect(failedInvoice.status, JSON.stringify(failedInvoice.body)).toBe(500);
    const [invoiceId, ...extraInvoices] = await committed('invoices', 'v45a h-10b invoice');
    expect(extraInvoices, 'the failed request committed one invoice').toEqual([]);
    const invoiceRetry = await postInvoice(ID.bizH, invoiceBody, { key: HKEY.failedInvoice });
    expect(invoiceRetry.status, JSON.stringify(invoiceRetry.body)).toBe(201);
    expect(invoiceRetry.body.id, 'the keyed retry answers the committed invoice').toBe(invoiceId);

    // 3. A 3-way burst whose winner (the one request past the commit) fails: the losers answer its document.
    const quoteBurstBody = httpQuoteBody(ID.contactH, { notes: 'v45a h-10b quote burst' });
    restore = failOnce(crmStub, 'logContactEvent', 'v45a h-10b: the burst winner failed after the commit');
    const quoteBurst = await Promise.all(Array.from({ length: 3 }, () => postQuote(ID.bizH, quoteBurstBody, { key: HKEY.failedQuoteBurst })));
    restore();
    expect(quoteBurst.map((r) => r.status).sort(), JSON.stringify(quoteBurst.map((r) => r.body))).toEqual([201, 201, 500]);
    const [quoteBurstId, ...extraBurstQuotes] = await committed('quotes', 'v45a h-10b quote burst');
    expect(extraBurstQuotes).toEqual([]);
    for (const r of quoteBurst.filter((res) => res.status === 201)) expect(r.body.id).toBe(quoteBurstId);

    const invoiceBurstBody = httpInvoiceBody(ID.contactH, { notes: 'v45a h-10b invoice burst' });
    restore = failOnce(statsStub, 'invalidateCache', 'v45a h-10b: the burst winner failed after the commit');
    const invoiceBurst = await Promise.all(Array.from({ length: 3 }, () => postInvoice(ID.bizH, invoiceBurstBody, { key: HKEY.failedInvoiceBurst })));
    restore();
    expect(invoiceBurst.map((r) => r.status).sort(), JSON.stringify(invoiceBurst.map((r) => r.body))).toEqual([201, 201, 500]);
    const [invoiceBurstId, ...extraBurstInvoices] = await committed('invoices', 'v45a h-10b invoice burst');
    expect(extraBurstInvoices).toEqual([]);
    for (const r of invoiceBurst.filter((res) => res.status === 201)) expect(r.body.id).toBe(invoiceBurstId);

    // The interceptor's write is a tap after the handler; let it land.
    await sleep(300);
    const counts = () => ({
      quoteRetry: eventsOf('quote.create', quoteId).length,
      invoiceRetry: eventsOf('invoice.create', invoiceId).length,
      quoteBurst: eventsOf('quote.create', quoteBurstId).length,
      invoiceBurst: eventsOf('invoice.create', invoiceBurstId).length,
    });
    expect(counts(), 'exactly one business event per committed document').toEqual({ quoteRetry: 1, invoiceRetry: 1, quoteBurst: 1, invoiceBurst: 1 });
    for (const [eventType, id] of [
      ['quote.create', quoteId],
      ['invoice.create', invoiceId],
      ['quote.create', quoteBurstId],
      ['invoice.create', invoiceBurstId],
    ] as const) {
      expect(eventsOf(eventType, id), `${eventType} ${id}`).toEqual([[eventType.split('.')[0], 'human', ID.owner]]);
    }

    // The event was written once: a further keyed replay of each writes none.
    for (const replay of [
      await postQuote(ID.bizH, quoteBody, { key: HKEY.failedQuote }),
      await postInvoice(ID.bizH, invoiceBody, { key: HKEY.failedInvoice }),
      await postQuote(ID.bizH, quoteBurstBody, { key: HKEY.failedQuoteBurst }),
      await postInvoice(ID.bizH, invoiceBurstBody, { key: HKEY.failedInvoiceBurst }),
    ]) {
      expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    }
    await sleep(300);
    expect(counts(), 'a later replay writes no second event').toEqual({ quoteRetry: 1, invoiceRetry: 1, quoteBurst: 1, invoiceBurst: 1 });
  }, 60_000);
});
