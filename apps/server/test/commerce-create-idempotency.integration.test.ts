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
 *   H-01..H-03      TODO the HTTP door: POST .../invoices and .../quotes with an Idempotency-Key header.
 *                   commerce.controller.ts (outside the V1-45 write set) does not forward the header
 *                   to the service yet; see the describe block at the end.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed), CommerceService,
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

let db: any;
let app: any;
let redis: any;
let commerce: any;

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
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
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
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (db) await cleanup();
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

// The HTTP door is outside the V1-45 write set. CommerceController.createInvoice
// and .createQuote forward only the DTO's declared fields to the service, so the
// Idempotency-Key header never reaches it; the claim above is live for every
// caller that passes `idempotencyKey`, but the routes need two handler lines
// each: read `req.headers['idempotency-key']` (as SiteController's
// checkoutIdempotencyKey does) and forward it as `idempotencyKey`. These cases
// ran red before and after this packet's service change (tests-first commit
// 22a378b6 holds their bodies) and wait on a packet that releases
// commerce.controller.ts.
describe('V1-45 create idempotency — the HTTP door (Idempotency-Key header, D-15)', () => {
  it.todo('H-01 RED-BEFORE: POST invoices twice with one Idempotency-Key answers one invoice (201, same id and number, one row) — needs commerce.controller.ts, outside the V1-45 write set');
  it.todo('H-02 RED-BEFORE: POST invoices with a used Idempotency-Key and a different body is a 409 idempotency_key_reused, nothing written — needs commerce.controller.ts, outside the V1-45 write set');
  it.todo('H-03 RED-BEFORE: POST quotes twice with one Idempotency-Key answers one quote (201, same id, one row) — needs commerce.controller.ts, outside the V1-45 write set');
});
