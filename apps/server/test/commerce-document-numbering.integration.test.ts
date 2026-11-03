/**
 * V1-43-DM-NUMBERING — per-business sequential invoice and quote numbers,
 * allocated under the existing unique index with a P2002 retry (REAL database,
 * REAL routes behind the real AuthGuard / BusinessGuard / ModuleScopeGuard, REAL
 * ledger door). No migration: the unique (business_id, invoice_number) and
 * (business_id, quote_number) indexes are the only guard.
 *
 * M22 / CF-37; owner ruling D-15 (2026-11-02): invoice and quote numbers are
 * sequential per business, continuing from its current highest number;
 * existing numbers are never renumbered. At the V1-42 head three numbering
 * schemes existed and none was safe under concurrency:
 *
 *   - CommerceService numbered invoices INV-<Date.now()> (createInvoice,
 *     createInvoiceForService for booking invoices, convertQuoteToInvoice) and
 *     quotes QT-<Date.now()>: two creates in one millisecond in one business
 *     hit the unique index (P2002);
 *   - RecurringInvoiceService numbered INV-<Date.now()> too;
 *   - KEY's commerce_create_invoice / commerce_create_quote numbered
 *     INV-<count+1> / QT-<count+1> from a count that skips soft-deleted rows,
 *     so after one soft delete the next number was one already taken.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the base,
 * pkt/V1-44-DM-CREDIT-NOTE-repair 6db72ae9):
 *
 *   N-01 RED-BEFORE Promise.all of 10 POST invoices in one business, all inside one millisecond
 *                   (Date.now pinned): all 201 with INV-0001..INV-0010, 10 rows, one invoice.created each;
 *                   LEDGER: issuing each posts exactly one invoice_finalized transaction, balanced
 *   N-02 RED-BEFORE two tenants number independently (bizB starts at INV-0001; bizA continues at INV-0011)
 *   N-03 RED-BEFORE an explicit invoiceNumber (internal callers) and quoteNumber (POST quotes) are honoured
 *                   as given; the sequence continues from the highest number (INV-0500 -> INV-0501); an
 *                   explicit quote number already taken stays a 409 quote_number_taken (V1-53 control)
 *   N-04 RED-BEFORE existing rows are never renumbered: a legacy business holding INV-<timestamp>,
 *                   INV-0042, a storefront INV-ORD-* and a soft-deleted INV-<timestamp+5> continues at
 *                   INV-<timestamp+6>; its quotes (QT-0007, soft-deleted QT-0009) at QT-0010; every legacy
 *                   number is unchanged
 *   N-05 RED-BEFORE KEY commerce_create_invoice after a soft-deleted invoice draws the next number
 *                   (the base computed INV-<count+1> and collided); commerce_create_quote likewise
 *   N-06 RED-BEFORE one sequence per business: the HTTP route, KEY, booking invoices
 *                   (createInvoiceForService), quote conversion and recurring invoices draw from the
 *                   same allocator
 *   N-07 RED-BEFORE Promise.all of 6 POST quotes inside one millisecond: QT-0001..QT-0006, all 201
 *   L-01 RED-BEFORE LEDGER: a real collision (a row holding the next number, committed while the create
 *                   waits on the unique index) is retried with the following number; the retry leaves
 *                   one Invoice, and issuing it posts once. The same for a recurring run: one invoice for
 *                   the period, one invoice_finalized posting, the schedule advanced once, one
 *                   invoice.created
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed), CommerceService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService and
 * ChartOfAccountsSeederService write real rows, and the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-v43a-user`,
 * loads that seeded user row and attaches `{ id, email, role }` exactly as
 * the Supabase-verifying AuthMiddleware would. KEY's dispatcher is the real
 * FlowOrchestratorService.executeToolAction over the real CommerceService (no
 * constructor, as test/key-dispatcher-tenant.integration.test.ts composes it).
 * The recurring runner is the real RecurringInvoiceService over the real
 * workflow, its due-schedule scan scoped to this suite's business. EventEmitter2
 * is a recording stub; the contact timeline, stats cache and AI / Gmail /
 * Drive services are stubs off the boundary.
 *
 * Fixtures: prefix `v43a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency
 * order in beforeAll and afterAll; no $transaction wrapping of the cases (the
 * one transaction here is L-01's deliberate holder of the next number). Rows
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

const P = 'v43a_';
const HEADER = 'x-v43a-user';

const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`, // N-01, N-02: concurrency (ACCRUAL)
  bizB: `${P}bizB`, // N-02, N-03: another tenant, explicit numbers
  bizL: `${P}bizL`, // N-04: legacy numbers
  bizK: `${P}bizK`, // N-05, N-06: KEY and the shared sequence (ACCRUAL)
  bizQ: `${P}bizQ`, // N-07: quotes
  bizR: `${P}bizR`, // L-01: forced collisions (ACCRUAL)
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactL: `${P}contactL`,
  contactK: `${P}contactK`,
  contactQ: `${P}contactQ`,
  contactR: `${P}contactR`,
  scheduleK: `${P}schedK`,
  scheduleR: `${P}schedR`,
};

/** The one millisecond every create of a burst is pinned to (N-01, N-07). */
const T = 4102444800777;
/** A legacy INV-<Date.now()> number of bizL. */
const LEGACY_TS = 1730000000000;

let db: any;
let app: any;
let redis: any;
let commerce: any;
let workflow: any;
let dispatcher: any;
let recurringRunner: (businessId: string) => any;

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

const stub = (): any => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : vi.fn(async () => undefined)) });

async function cleanup() {
  for (const sql of [
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
    `DELETE FROM recurring_invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const items = [{ description: 'v43a line', quantity: 1, unitPrice: 40 }];

/** POST an invoice through the real route; the returned promise starts the request. */
async function createInvoice(businessId: string, contactId: string) {
  return agent().post(`/commerce/businesses/${businessId}/invoices`).set(HEADER, ID.owner).send({ contactId, items });
}
async function createQuote(businessId: string, contactId: string, extra: Record<string, unknown> = {}) {
  return agent().post(`/commerce/businesses/${businessId}/quotes`).set(HEADER, ID.owner).send({ contactId, items, ...extra });
}
function issue(businessId: string, invoiceId: string) {
  return agent().patch(`/commerce/invoices/${invoiceId}/status/sent`).set(HEADER, ID.owner).send({ businessId, status: 'SENT' });
}

/** Every create of `run` sees the same Date.now(): the burst lands inside one millisecond. */
async function inOneMillisecond<R>(run: () => Promise<R>): Promise<R> {
  const now = vi.spyOn(Date, 'now').mockReturnValue(T);
  try {
    return await run();
  } finally {
    now.mockRestore();
  }
}

async function invoiceNumbers(businessId: string, includeDeleted = true): Promise<string[]> {
  const rows: Array<{ invoice_number: string }> = await db.$queryRawUnsafe(
    `SELECT invoice_number FROM invoices WHERE business_id = $1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY invoice_number`,
    businessId,
  );
  return rows.map((r) => r.invoice_number);
}
async function quoteNumbers(businessId: string): Promise<string[]> {
  const rows: Array<{ quote_number: string }> = await db.$queryRawUnsafe(
    'SELECT quote_number FROM quotes WHERE business_id = $1 ORDER BY quote_number',
    businessId,
  );
  return rows.map((r) => r.quote_number);
}
const seq = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(4, '0')}`);

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

/**
 * L-01: another connection inserts `invoiceNumber` and holds it uncommitted, so
 * a create that draws that number waits on the unique index; `release` commits
 * it, and the waiting insert then fails with P2002, as two writers drawing one
 * number meet in production.
 */
async function holdUncommitted(businessId: string, contactId: string, invoiceNumber: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let inserted!: () => void;
  const ready = new Promise<void>((r) => { inserted = r; });
  const done = db.$transaction(async (tx: any) => {
    await tx.invoice.create({ data: { id: `${P}hold_${businessId}_${invoiceNumber}`, businessId, contactId, invoiceNumber, total: 1 } });
    inserted();
    await gate;
  }, { timeout: 60_000, maxWait: 10_000 });
  await Promise.race([ready, done]);
  return { release, done };
}

/** True once a backend of this database waits on a lock while inserting into `table`. */
async function waitForBlockedInsert(table: 'invoices', ms = 5000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'INSERT INTO "public"."${table}"%'`,
    );
    if (rows[0].n > 0) return true;
    await sleep(20);
  }
  return false;
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
  const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
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
  workflow = moduleRef.get(InvoiceWorkflowService);
  const prismaService = moduleRef.get(PrismaService);

  // KEY's dispatcher: the real executeToolAction over the real CommerceService.
  dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma: prismaService,
    moduleRef: { get: (token: unknown) => (token === CommerceService ? commerce : stub()) },
  });

  // The real recurring runner over the real workflow; its due scan is scoped
  // to one of this suite's businesses so a run never bills another suite's schedules.
  recurringRunner = (businessId: string) => {
    const scoped = new Proxy(db, {
      get(target: any, prop: string | symbol) {
        if (prop === 'recurringInvoice') {
          const delegate = Reflect.get(target, prop);
          return new Proxy(delegate, {
            get(d: any, method: string | symbol) {
              const orig = Reflect.get(d, method);
              if (method !== 'findMany' || typeof orig !== 'function') return typeof orig === 'function' ? orig.bind(d) : orig;
              return (args: any = {}) => orig.call(d, { ...args, where: { AND: [args.where ?? {}, { businessId }] } });
            },
          });
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    return new RecurringInvoiceService({ client: scoped } as any, eventStub as any, workflow);
  };

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
  const businesses: Array<[string, string, 'ACCRUAL' | 'CASH']> = [
    [ID.bizA, ID.contactA, 'ACCRUAL'],
    [ID.bizB, ID.contactB, 'CASH'],
    [ID.bizL, ID.contactL, 'CASH'],
    [ID.bizK, ID.contactK, 'ACCRUAL'],
    [ID.bizQ, ID.contactQ, 'CASH'],
    [ID.bizR, ID.contactR, 'ACCRUAL'],
  ];
  const coa = moduleRef.get(ChartOfAccountsSeederService);
  for (const [biz, contact, basis] of businesses) {
    await db.business.create({
      data: { id: biz, name: `V43A ${biz}`, slug: biz, ownerId: ID.owner, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${biz}_m_owner`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V43A', lastName: biz, email: `${contact}@test.local` } });
    if (basis === 'ACCRUAL') await coa.ensureDefaults(biz);
  }

  // bizL: rows numbered before this packet, by every earlier scheme.
  const legacy: Array<{ id: string; invoiceNumber: string; deletedAt?: Date }> = [
    { id: `${P}legTs`, invoiceNumber: `INV-${LEGACY_TS}` },
    { id: `${P}leg42`, invoiceNumber: 'INV-0042' },
    { id: `${P}legOrd`, invoiceNumber: `INV-ORD-${P}X1` },
    { id: `${P}legDel`, invoiceNumber: `INV-${LEGACY_TS + 5}`, deletedAt: new Date() },
  ];
  for (const l of legacy) {
    await db.invoice.create({
      data: { id: l.id, businessId: ID.bizL, contactId: ID.contactL, invoiceNumber: l.invoiceNumber, total: 10, deletedAt: l.deletedAt ?? null },
    });
  }
  await db.quote.create({ data: { id: `${P}legQ7`, businessId: ID.bizL, contactId: ID.contactL, quoteNumber: 'QT-0007', total: 10 } });
  await db.quote.create({ data: { id: `${P}legQ9`, businessId: ID.bizL, contactId: ID.contactL, quoteNumber: 'QT-0009', total: 10, deletedAt: new Date() } });

  // Monthly schedules due now (they never fall due on a fixed date).
  const due = new Date(Date.now() - 60_000);
  for (const [id, biz, contact] of [[ID.scheduleK, ID.bizK, ID.contactK], [ID.scheduleR, ID.bizR, ID.contactR]]) {
    await db.recurringInvoice.create({
      data: {
        id,
        businessId: biz,
        contactId: contact,
        name: `V43A ${id}`,
        description: 'v43a retainer',
        frequency: 'MONTHLY',
        amount: 150,
        currency: 'TTD',
        startDate: new Date(due.getTime() - 86_400_000),
        nextRunDate: due,
        status: 'ACTIVE',
      },
    });
  }
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (db) await cleanup();
  if (app) await app.close();
  if (redis) redis.disconnect();
}, 60_000);

describe('V1-43 numbering — sequential per business, safe under concurrency (M22, CF-37, D-15)', () => {
  it('N-01 RED-BEFORE: 10 creates inside one millisecond in one business all succeed with INV-0001..INV-0010; each posts once on issue', async () => {
    const res = await inOneMillisecond(() =>
      Promise.all(Array.from({ length: 10 }, () => createInvoice(ID.bizA, ID.contactA))),
    );
    expect(res.map((r) => r.status), JSON.stringify(res.filter((r) => r.status !== 201).map((r) => r.body))).toEqual(Array(10).fill(201));
    const numbers = res.map((r) => r.body.invoiceNumber).sort();
    expect(numbers).toEqual(seq('INV-', 1, 10));
    expect(await invoiceNumbers(ID.bizA)).toEqual(seq('INV-', 1, 10));
    // One invoice.created per invoice: a retried attempt emits nothing.
    const created = emitted.filter((e) => e.name === 'invoice.created' && e.payload?.businessId === ID.bizA);
    expect(created.map((e) => e.payload.invoice.invoiceNumber).sort()).toEqual(seq('INV-', 1, 10));

    // LEDGER: each allocated invoice posts once on issue, balanced.
    for (const r of res) {
      const sent = await issue(ID.bizA, r.body.id);
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    }
    for (const r of res) await expectPostedOnce(r.body.id);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA } })).toBe(10);
  }, 60_000);

  it('N-02 RED-BEFORE: two tenants number independently', async () => {
    const b1 = await createInvoice(ID.bizB, ID.contactB);
    expect(b1.status, JSON.stringify(b1.body)).toBe(201);
    expect(b1.body.invoiceNumber, 'bizB starts its own sequence').toBe('INV-0001');
    const a11 = await createInvoice(ID.bizA, ID.contactA);
    expect(a11.status, JSON.stringify(a11.body)).toBe(201);
    expect(a11.body.invoiceNumber, 'bizA continues its own').toBe('INV-0011');
    const b2 = await createInvoice(ID.bizB, ID.contactB);
    expect(b2.body.invoiceNumber).toBe('INV-0002');
  });

  it('N-03 RED-BEFORE: an explicit number is honoured as given; the sequence continues from the highest', async () => {
    // Internal callers (document intake) name the number the source document carries.
    const external = await commerce.createInvoice({ businessId: ID.bizB, contactId: ID.contactB, items, invoiceNumber: `${P}EXT-77` });
    expect(external.invoiceNumber).toBe(`${P}EXT-77`);
    const high = await commerce.createInvoice({ businessId: ID.bizB, contactId: ID.contactB, items, invoiceNumber: 'INV-0500' });
    expect(high.invoiceNumber).toBe('INV-0500');
    const next = await createInvoice(ID.bizB, ID.contactB);
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body.invoiceNumber, 'continues from the highest number (D-15)').toBe('INV-0501');

    // POST quotes may name its number (CreateQuoteDto.quoteNumber).
    const named = await createQuote(ID.bizB, ID.contactB, { quoteNumber: `${P}Q-CUSTOM` });
    expect(named.status, JSON.stringify(named.body)).toBe(201);
    expect(named.body.quoteNumber).toBe(`${P}Q-CUSTOM`);
    const auto = await createQuote(ID.bizB, ID.contactB);
    expect(auto.status, JSON.stringify(auto.body)).toBe(201);
    expect(auto.body.quoteNumber).toBe('QT-0001');
    // V1-53 control: a named number already used is a 409, never renumbered.
    const taken = await createQuote(ID.bizB, ID.contactB, { quoteNumber: 'QT-0001' });
    expect(taken.status, JSON.stringify(taken.body)).toBe(409);
    expect(JSON.stringify(taken.body)).toContain('quote_number_taken');
    expect(await quoteNumbers(ID.bizB)).toEqual(['QT-0001', `${P}Q-CUSTOM`].sort());
  });

  it('N-04 RED-BEFORE: existing rows are never renumbered; a legacy business continues from its highest number, soft-deleted rows included', async () => {
    const before = await invoiceNumbers(ID.bizL);
    const inv = await createInvoice(ID.bizL, ID.contactL);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.invoiceNumber).toBe(`INV-${LEGACY_TS + 6}`);
    const qt = await createQuote(ID.bizL, ID.contactL);
    expect(qt.status, JSON.stringify(qt.body)).toBe(201);
    expect(qt.body.quoteNumber).toBe('QT-0010');
    // Every legacy row keeps its number.
    expect(await invoiceNumbers(ID.bizL)).toEqual([...before, `INV-${LEGACY_TS + 6}`].sort());
    const legacy = await db.$queryRawUnsafe(
      `SELECT id, invoice_number FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}leg`)} ORDER BY id`,
    );
    expect(legacy).toEqual([
      { id: `${P}leg42`, invoice_number: 'INV-0042' },
      { id: `${P}legDel`, invoice_number: `INV-${LEGACY_TS + 5}` },
      { id: `${P}legOrd`, invoice_number: `INV-ORD-${P}X1` },
      { id: `${P}legTs`, invoice_number: `INV-${LEGACY_TS}` },
    ]);
    expect(await quoteNumbers(ID.bizL)).toEqual(['QT-0007', 'QT-0009', 'QT-0010']);
  });

  it('N-05 RED-BEFORE: KEY commerce_create_invoice / commerce_create_quote after a soft delete draw the next number (the base reused count+1)', async () => {
    const run = (tool: string, args: Record<string, unknown>) => dispatcher.executeToolAction(ID.bizK, tool, args);
    const first = await run('commerce_create_invoice', { contactId: ID.contactK, items });
    const second = await run('commerce_create_invoice', { contactId: ID.contactK, items });
    expect([first.invoiceNumber, second.invoiceNumber]).toEqual(['INV-0001', 'INV-0002']);
    await run('commerce_delete_invoice', { invoiceId: first.id });
    expect(await invoiceNumbers(ID.bizK, false)).toEqual(['INV-0002']);

    let third: any;
    let error: any = null;
    try {
      third = await run('commerce_create_invoice', { contactId: ID.contactK, items });
    } catch (e) {
      error = e;
    }
    expect(error?.message ?? null, 'the base collided on INV-<count+1>').toBeNull();
    expect(third.invoiceNumber).toBe('INV-0003');
    expect(await invoiceNumbers(ID.bizK)).toEqual(seq('INV-', 1, 3));

    const q1 = await run('commerce_create_quote', { contactId: ID.contactK, items });
    const q2 = await run('commerce_create_quote', { contactId: ID.contactK, items });
    expect([q1.quoteNumber, q2.quoteNumber]).toEqual(['QT-0001', 'QT-0002']);
    await db.quote.update({ where: { id: q1.id }, data: { deletedAt: new Date() } });
    let q3: any;
    let qError: any = null;
    try {
      q3 = await run('commerce_create_quote', { contactId: ID.contactK, items });
    } catch (e) {
      qError = e;
    }
    expect(qError?.message ?? null, 'the base collided on QT-<count+1>').toBeNull();
    expect(q3.quoteNumber).toBe('QT-0003');
  });

  it('N-06 RED-BEFORE: the HTTP route, KEY, booking invoices, quote conversion and recurring invoices draw from one sequence', async () => {
    // bizK holds INV-0001..INV-0003 (N-05).
    const http = await createInvoice(ID.bizK, ID.contactK);
    expect(http.status, JSON.stringify(http.body)).toBe(201);
    expect(http.body.invoiceNumber).toBe('INV-0004');

    // Booking invoices (deposit, booking-time and completion) are drawn up by createInvoiceForService.
    const booking = await commerce.createInvoiceForService(ID.bizK, ID.contactK, { name: 'V43A service', price: 80 } as any);
    expect(booking.invoiceNumber).toBe('INV-0005');
    const deposit = await commerce.createInvoiceForService(ID.bizK, ID.contactK, { name: 'V43A service', price: 80 } as any, { kind: 'DEPOSIT', amountOverride: 20 });
    expect(deposit.invoiceNumber).toBe('INV-0006');

    // Quote conversion.
    const quote = await createQuote(ID.bizK, ID.contactK);
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    await db.quote.update({ where: { id: quote.body.id }, data: { status: 'ACCEPTED' } });
    const converted = await agent()
      .post(`/commerce/businesses/${ID.bizK}/quotes/${quote.body.id}/convert`)
      .set(HEADER, ID.owner)
      .send({});
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(converted.body.invoiceNumber).toBe('INV-0007');

    // KEY.
    const key = await dispatcher.executeToolAction(ID.bizK, 'commerce_create_invoice', { contactId: ID.contactK, items });
    expect(key.invoiceNumber).toBe('INV-0008');

    // Recurring.
    const generated = await recurringRunner(ID.bizK).processRecurringInvoices();
    expect(generated.map((g: any) => g.invoiceNumber)).toEqual(['INV-0009']);
    const recurring = await db.invoice.findMany({ where: { recurringInvoiceId: ID.scheduleK } });
    expect(recurring.map((i: any) => [i.invoiceNumber, i.status])).toEqual([['INV-0009', 'SENT']]);
    await expectPostedOnce(recurring[0].id);

    expect(await invoiceNumbers(ID.bizK)).toEqual(seq('INV-', 1, 9));
  }, 60_000);

  it('N-07 RED-BEFORE: 6 quote creates inside one millisecond all succeed with QT-0001..QT-0006', async () => {
    const res = await inOneMillisecond(() =>
      Promise.all(Array.from({ length: 6 }, () => createQuote(ID.bizQ, ID.contactQ))),
    );
    expect(res.map((r) => r.status), JSON.stringify(res.filter((r) => r.status !== 201).map((r) => r.body))).toEqual(Array(6).fill(201));
    expect(res.map((r) => r.body.quoteNumber).sort()).toEqual(seq('QT-', 1, 6));
    expect(await quoteNumbers(ID.bizQ)).toEqual(seq('QT-', 1, 6));
  }, 60_000);
});

describe('V1-43 LEDGER — a retried allocation never writes a second Invoice or FinancialTransaction', () => {
  it('L-01 RED-BEFORE: a create that meets a committed collision is retried with the following number; one Invoice, posted once on issue', async () => {
    const hold = await holdUncommitted(ID.bizR, ID.contactR, 'INV-0001');
    const pending = createInvoice(ID.bizR, ID.contactR).then((r) => r);
    let blocked = false;
    try {
      blocked = await waitForBlockedInsert('invoices');
    } finally {
      hold.release();
      await hold.done;
    }
    const res = await pending;
    expect(blocked, 'the create drew INV-0001 and waited on the unique index').toBe(true);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.invoiceNumber, 'the retry drew the following number').toBe('INV-0002');
    expect(await invoiceNumbers(ID.bizR)).toEqual(['INV-0001', 'INV-0002']);
    expect(emitted.filter((e) => e.name === 'invoice.created' && e.payload?.businessId === ID.bizR)).toHaveLength(1);

    const sent = await issue(ID.bizR, res.body.id);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    await expectPostedOnce(res.body.id);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizR } })).toBe(1);
  }, 60_000);

  it('L-01b RED-BEFORE: a recurring run that meets a collision bills the period once: one invoice, one posting, the schedule advanced once', async () => {
    const before = await db.recurringInvoice.findUnique({ where: { id: ID.scheduleR } });
    const createdBefore = emitted.filter((e) => e.name === 'invoice.created' && e.payload?.businessId === ID.bizR).length;
    const hold = await holdUncommitted(ID.bizR, ID.contactR, 'INV-0003');
    const pending = recurringRunner(ID.bizR).processRecurringInvoices();
    let blocked = false;
    try {
      blocked = await waitForBlockedInsert('invoices');
    } finally {
      hold.release();
      await hold.done;
    }
    const generated = await pending;
    expect(blocked, 'the run drew INV-0003 and waited on the unique index').toBe(true);
    expect(generated.map((g: any) => g.invoiceNumber)).toEqual(['INV-0004']);

    const invoices = await db.invoice.findMany({ where: { recurringInvoiceId: ID.scheduleR } });
    expect(invoices.map((i: any) => [i.invoiceNumber, i.status])).toEqual([['INV-0004', 'SENT']]);
    await expectPostedOnce(invoices[0].id);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizR } })).toBe(2);

    const after = await db.recurringInvoice.findUnique({ where: { id: ID.scheduleR } });
    expect(after.generatedCount).toBe(before.generatedCount + 1);
    expect(after.failureCount).toBe(0);
    expect(after.lastError).toBeNull();
    const advanced = new Date(before.nextRunDate);
    advanced.setMonth(advanced.getMonth() + 1);
    expect(after.nextRunDate.getTime(), 'advanced exactly one period').toBe(advanced.getTime());
    expect(emitted.filter((e) => e.name === 'invoice.created' && e.payload?.businessId === ID.bizR).length).toBe(createdBefore + 1);
    expect(await invoiceNumbers(ID.bizR)).toEqual(seq('INV-', 1, 4));
  }, 60_000);
});
