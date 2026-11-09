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
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed per business), TeamAuditInterceptor, CommerceService,
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
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      {
        provide: SubscriptionsService,
        useValue: {
          checkLimit: async (businessId: string) =>
            planLimited.has(businessId) ? { allowed: false, current: 1, limit: 1, upgradeTo: 'PRO' } : { allowed: true },
        },
      },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
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
});
