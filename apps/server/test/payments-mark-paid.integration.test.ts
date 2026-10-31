/**
 * R0-PL-04-MARK-PAID-POSTS-LEDGER — mark-paid records the remaining balance
 * through recordPayment, so every SUCCESSFUL payment it creates has a ledger
 * posting (REAL database, REAL ledger posting, REAL invoice workflow).
 *
 * Gap report G2 (docs/reconstruction/product/evidence/REVENUE-GAP-REPORT-001.md),
 * payments lane PK-PL-04 (PL-F05), build map CF-09 / R0-20:
 *
 *   G2   markInvoicePaid transitioned the invoice to PAID and then, when the
 *        invoice had no payment row at all, wrote a synthetic
 *        `payment.create` (SUCCESSFUL, provider 'manual') outside any
 *        transaction and with no ledger posting. Cash appeared on the invoice
 *        without a journal entry, and a refund of that row had nothing to
 *        reverse (payments-actor PA-13). An invoice that already held a
 *        partial payment was flipped to PAID with no balancing payment, so
 *        the next reconcile flipped it back to PARTIALLY_PAID.
 *
 * Contract pinned here:
 *
 *   PATCH /commerce/invoices/:id/paid { businessId } by a revenue:write member, SENT invoice, no payments
 *     -> 200; exactly one SUCCESSFUL Payment for the total (provider 'manual', method 'MANUAL',
 *        recordedBy = the acting user), one POSTED Payment:<id>:payment_recorded FinancialTransaction
 *        with balanced ledger entries (createdById = the acting user); invoice PAID with paidAt;
 *        invoice.paid emitted once, after commit
 *   the same after a 60 partial on a 100 invoice
 *     -> one 40 balancing payment with its posting; a later reconcile leaves PAID (no flip-back)
 *   the same on an invoice that is already PAID -> 200, idempotent: no Payment, posting, event or timeline entry
 *   the same on a DRAFT invoice                 -> 409; nothing written
 *   refund of the mark-paid payment             -> a reversal posting whose createdById is the refunder
 *   legacy Stripe webhook call shape markInvoicePaid(invoiceId) (no actor, no tenant; G16 stays DEFERRED)
 *                                               -> PAID through the same path; recordedBy null
 *   KEY (KEY_SYSTEM_ACTOR_ID + businessId)      -> PAID through the same path; recordedBy KEY
 *   KEY without a tenant                        -> 403; nothing written (system-actor contract unchanged)
 *   two concurrent mark-paids                   -> one payment, one posting, one invoice.paid (the invoice lock)
 *   a payment commits while mark-paid waits for the invoice lock:
 *     it settles the invoice                    -> 200 (already PAID: idempotent); mark-paid writes nothing
 *     it leaves a balance                       -> 409; mark-paid writes nothing (its remaining is stale)
 *
 * Review repairs (R0-PL-04 review):
 *   ST-PL04-1  a client record-payment whose idempotencyKey is the old mark-paid key shape
 *              -> mark-paid still records its own balancing payment and ends PAID (no replay of the client row)
 *   ST-PL04-2  a FAILED row the public WiPay callback wrote on the old predictable mark-paid slot
 *              -> mark-paid still ends PAID (its slot is random, server-built, never a client-key slot)
 *   CR-PL04-1  a manual refund (flipped REFUNDED row) on the invoice -> 409; nothing written, nothing posted
 *              (computeBalance counts the flipped row twice, V1-29; a provider refund row does not block)
 *   CR-PL04-2  paid, undone to DRAFT, total edited, re-issued, marked paid again -> 200 PAID with a second payment
 *   either     the write leaves the invoice short of PAID -> 409; no invoice.paid timeline entry
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows, and the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Identity attachment is the one stand-in: a test middleware reads
 * `x-pmp-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recording spy; the contact timeline is a recording stub; COGS, stats cache
 * and the AI / Gmail / Drive services are stubs off the boundary. The race
 * cases hold the request at the invoice lock with a barrier on
 * CommerceService.lockInvoiceForPayment and commit the competing payment by a
 * direct write in the gap.
 *
 * Fixtures: prefix `pmp_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { createHash } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'pmp_';
const HEADER = 'x-pmp-user';
/** Mirrors KEY_SYSTEM_ACTOR_ID (src/core/auth/system-actor.ts); asserted equal below. */
const KEY_ACTOR = 'key_ai';

const ID = {
  owner: `${P}owner`,
  staff: `${P}staff`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  // one invoice per case so balances never bleed between cases
  invFull: `${P}invFull`,
  invPartial: `${P}invPartial`,
  invTwice: `${P}invTwice`,
  invDraft: `${P}invDraft`,
  invRefund: `${P}invRefund`,
  invWebhook: `${P}invWebhook`,
  invKey: `${P}invKey`,
  invKeyNoTenant: `${P}invKeyNoTenant`,
  invConcurrent: `${P}invConcurrent`,
  invRaceSettled: `${P}invRaceSettled`,
  invRaceMoved: `${P}invRaceMoved`,
  // R0-PL-04 review repairs
  invClientKey: `${P}invClientKey`,
  invSquat: `${P}invSquat`,
  invManualRefund: `${P}invManualRefund`,
  invManualRefundPart: `${P}invManualRefundPart`,
  invProviderRefund: `${P}invProviderRefund`,
  invReissue: `${P}invReissue`,
  invShort: `${P}invShort`,
};

const INVOICE_TOTAL = 100;
const DRAFT_INVOICES = new Set<string>([ID.invDraft]);
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_recorded']);

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
/** The CommerceService class itself: lockInvoiceForPayment is a static on it. */
let CommerceServiceClass: any;
let workflow: InvoiceWorkflowService;
/** Real PaymentsService: the public WiPay callback is the squatter in ST-PL04-2. */
let payments: any;
let systemActorId: string;

/**
 * Recording EventEmitter2. For the two invoice payment events it also starts a
 * fresh read of the invoice at emit time, on the shared client outside any
 * transaction: an event emitted before its transaction committed would not
 * see the new status or the payment.
 */
type Emitted = { name: string; payload: any; seen: Promise<{ status: string; paymentIds: string[] } | null> };
const emitted: Emitted[] = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    const invoiceId: string | undefined = payload?.invoice?.id;
    const seen = INVOICE_EVENTS.has(name) && invoiceId
      ? db.invoice
          .findUnique({ where: { id: invoiceId }, include: { payments: true } })
          .then((inv: any) => (inv ? { status: inv.status, paymentIds: inv.payments.map((p: any) => p.id) } : null))
      : Promise.resolve(null);
    emitted.push({ name, payload, seen });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Contact timeline entries (CrmService.logContactEvent is a recording stub). */
const contactEvents: any[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM webhook_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM ledger_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_transactions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payments WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM payment_links WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE '${P}%'`,
    `DELETE FROM invoices WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%' OR user_id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function markPaid(user: string, inv: string, body: Record<string, unknown> = { businessId: ID.biz }) {
  return agent().patch(`/commerce/invoices/${inv}/paid`).set(HEADER, user).send(body);
}

function pay(user: string, inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/payments`).set(HEADER, user).send(body);
}

function refund(user: string, paymentId: string, reason = 'pmp test refund') {
  return agent().post(`/commerce/businesses/${ID.biz}/payments/${paymentId}/refund`).set(HEADER, user).send({ reason });
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

/** The ledger transaction(s) posted for one payment row (FIN2 externalRef), with their entries. */
async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded` },
    include: { entries: true },
  });
}

async function reversalsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded:reversal` },
  });
}

/** Every FinancialTransaction for this invoice's payments (payment postings carry the invoice number as reference). */
async function paymentPostingsOf(invoiceId: string): Promise<any[]> {
  const inv = await invoiceRow(invoiceId);
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceType: 'Payment', reference: inv.invoiceNumber },
  });
}

function invoiceEventsFor(invoiceId: string, name?: string): Emitted[] {
  return emitted.filter((e) => INVOICE_EVENTS.has(e.name) && e.payload?.invoice?.id === invoiceId && (!name || e.name === name));
}

function timelineFor(invoiceId: string, type?: string): any[] {
  return contactEvents.filter((e) => e.data?.invoiceId === invoiceId && (!type || e.type === type));
}

const sum = (rows: any[], key: 'debit' | 'credit') => rows.reduce((s: number, e: any) => s + Number(e[key] ?? 0), 0);

/** Exactly one POSTED, balanced INCOME posting for this payment, for this amount, by `actor`. */
async function expectPostedOnce(paymentId: string, amount: number, actor: string | null) {
  const txns = await postingsFor(paymentId);
  expect(txns, `postings for ${paymentId}`).toHaveLength(1);
  expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
  expect(Number(txns[0].amount)).toBe(amount);
  expect(txns[0].entries.length, 'ledger entries').toBeGreaterThanOrEqual(2);
  expect(sum(txns[0].entries, 'debit'), 'debits').toBe(amount);
  expect(sum(txns[0].entries, 'credit'), 'credits').toBe(amount);
  expect(txns[0].createdById, `posting creator for ${paymentId}`).toBe(actor);
}

/** The mark-paid row: one SUCCESSFUL manual payment for `amount`, recorded by `actor`. */
function expectMarkPaidRow(row: any, invoiceId: string, amount: number, actor: string | null) {
  expect(row).toMatchObject({
    invoiceId,
    businessId: ID.biz,
    status: 'SUCCESSFUL',
    amount,
    provider: 'manual',
    method: 'MANUAL',
  });
  expect(row.recordedBy, 'recordedBy').toBe(actor);
}

/** Each event was emitted after its transaction committed: a fresh read at emit time already saw its status and payment. */
async function expectEmittedAfterCommit(event: Emitted, paymentId: string) {
  const seen = await event.seen;
  expect(seen, `${event.name} fresh read`).not.toBeNull();
  expect(seen!.status, `${event.name}: status visible at emit time`).toBe(event.payload.invoice.status);
  expect(seen!.paymentIds, `${event.name}: payment visible at emit time`).toContain(paymentId);
}

/** The invoice is exactly as seeded: no payment, no payment posting, status unchanged, no event. */
async function expectUntouched(invoiceId: string, status: string) {
  expect(await paymentsOf(invoiceId), `payments of ${invoiceId}`).toHaveLength(0);
  expect(await paymentPostingsOf(invoiceId), `postings of ${invoiceId}`).toHaveLength(0);
  expect((await invoiceRow(invoiceId)).status, `status of ${invoiceId}`).toBe(status);
  expect(invoiceEventsFor(invoiceId), `events of ${invoiceId}`).toHaveLength(0);
}

/**
 * Barrier on CommerceService.lockInvoiceForPayment, the first statement of the
 * payment transaction and so after every pre-transaction read: hold the call,
 * run `before` (a change another request commits in the gap), then take the
 * real lock.
 */
function holdAtLock(before: () => Promise<unknown>) {
  const original = CommerceServiceClass.lockInvoiceForPayment;
  let ran: Promise<unknown> | null = null;
  return vi.spyOn(CommerceServiceClass, 'lockInvoiceForPayment').mockImplementation(async (...args: any[]) => {
    ran ??= before();
    await ran;
    return original.apply(CommerceServiceClass, args);
  });
}

/** A payment another request committed: a SUCCESSFUL row written directly (no posting needed for the race). */
async function commitCompetingPayment(invoiceId: string, amount: number, settle: boolean) {
  await db.payment.create({
    data: {
      id: `${invoiceId}_competing`,
      businessId: ID.biz,
      invoiceId,
      amount,
      currency: 'TTD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      providerPaymentId: `${invoiceId}_competing`,
    },
  });
  await db.invoice.update({
    where: { id: invoiceId },
    data: settle ? { status: 'PAID', paidAt: new Date() } : { status: 'PARTIALLY_PAID' },
  });
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
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
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

  systemActorId = KEY_SYSTEM_ACTOR_ID;

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
      // Real ledger chain: the proof is the rows it posts (or does not).
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async (e: any) => { contactEvents.push(e); return null; } } },
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
  CommerceServiceClass = CommerceService;
  workflow = moduleRef.get(InvoiceWorkflowService);
  // Constructed directly with the real collaborators (no connectors: the WiPay
  // failure path only writes the FAILED row).
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  payments = new PaymentsService(moduleRef.get(PrismaService), commerce, workflow, moduleRef.get(RevenuePostingService));

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

  await db.user.create({ data: { id: ID.owner, email: `${ID.owner}@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${ID.staff}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'PMP Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  // A second human with revenue:write, so "the acting user" is never just "the owner".
  await db.membership.create({
    data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'write' } },
  });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Pmp', lastName: 'Customer', email: `${P}c@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `PMP-${String(n).padStart(3, '0')}`,
        status: DRAFT_INVOICES.has(id) ? 'DRAFT' : 'SENT',
        subtotal: INVOICE_TOTAL,
        total: INVOICE_TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `PMP item ${n}`, quantity: 1, unitPrice: INVOICE_TOTAL, total: INVOICE_TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  emitted.length = 0;
  contactEvents.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows)', () => {
  it('seeded an owner, a revenue:write staff member, a system chart of accounts, DRAFT and SENT invoices with no payments', async () => {
    expect(systemActorId).toBe(KEY_ACTOR);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } })).toBeGreaterThan(0);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
      expect((await invoiceRow(id)).status, id).toBe(DRAFT_INVOICES.has(id) ? 'DRAFT' : 'SENT');
    }
  });
});

describe('mark-paid records the remaining balance as a posted payment (G2)', () => {
  it('MP-01: SENT, no payments -> one SUCCESSFUL payment for the total with a balanced Payment:<id>:payment_recorded posting; PAID with paidAt; invoice.paid once, after commit', async () => {
    const res = await markPaid(ID.owner, ID.invFull);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.invFull, status: 'PAID' });

    const rows = await paymentsOf(ID.invFull);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], ID.invFull, INVOICE_TOTAL, ID.owner);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, ID.owner);

    const inv = await invoiceRow(ID.invFull);
    expect(inv.status).toBe('PAID');
    expect(inv.paidAt).toBeTruthy();

    const paid = invoiceEventsFor(ID.invFull, 'invoice.paid');
    expect(paid).toHaveLength(1);
    await expectEmittedAfterCommit(paid[0], rows[0].id);
    // The operator's timeline keeps the invoice.paid entry, attributed to the actor.
    const timeline = timelineFor(ID.invFull, 'invoice.paid');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ actorId: ID.owner, actorType: 'USER' });
  });

  it('MP-02: after a 60 partial on a 100 invoice, mark-paid by a revenue:write staff member records one 40 balancing payment with its posting; a later reconcile leaves PAID', async () => {
    const partial = await pay(ID.owner, ID.invPartial, { amount: 60, method: 'cash', reference: 'PMP-P-1' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect((await invoiceRow(ID.invPartial)).status).toBe('PARTIALLY_PAID');
    emitted.length = 0;

    const res = await markPaid(ID.staff, ID.invPartial);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await paymentsOf(ID.invPartial);
    expect(rows).toHaveLength(2);
    const balancing = rows.find((r) => r.id !== partial.body.payment.id);
    expectMarkPaidRow(balancing, ID.invPartial, 40, ID.staff);
    await expectPostedOnce(balancing.id, 40, ID.staff);
    const inv = await invoiceRow(ID.invPartial);
    expect(inv.status).toBe('PAID');
    expect(inv.paidAt).toBeTruthy();
    expect(invoiceEventsFor(ID.invPartial, 'invoice.paid')).toHaveLength(1);

    // No flip-back: the payment rows now say PAID, so recomputing from them changes nothing.
    const again = await workflow.reconcileFromPayments(ID.invPartial);
    expect(again).toMatchObject({ status: 'PAID', changed: false });
    expect(again.balance).toMatchObject({ net: INVOICE_TOTAL, remaining: 0, isFullyPaid: true });
    expect((await invoiceRow(ID.invPartial)).status).toBe('PAID');
  });

  it('MP-03: mark-paid on an already PAID invoice is idempotent: 200, no new Payment, posting, event or timeline entry; paidAt unchanged', async () => {
    const first = await markPaid(ID.owner, ID.invTwice);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const rowsBefore = await paymentsOf(ID.invTwice);
    const postingsBefore = await paymentPostingsOf(ID.invTwice);
    const paidAtBefore = (await invoiceRow(ID.invTwice)).paidAt;
    expect(rowsBefore).toHaveLength(1);
    expect(postingsBefore).toHaveLength(1);
    emitted.length = 0;
    contactEvents.length = 0;

    const second = await markPaid(ID.owner, ID.invTwice);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: ID.invTwice, status: 'PAID' });

    expect((await paymentsOf(ID.invTwice)).map((r) => r.id)).toEqual(rowsBefore.map((r) => r.id));
    expect((await paymentPostingsOf(ID.invTwice)).map((t) => t.id)).toEqual(postingsBefore.map((t) => t.id));
    expect((await invoiceRow(ID.invTwice)).paidAt).toEqual(paidAtBefore);
    expect(invoiceEventsFor(ID.invTwice)).toHaveLength(0);
    expect(timelineFor(ID.invTwice)).toHaveLength(0);
  });

  it('MP-04: mark-paid on a DRAFT invoice -> 409; no payment, no posting, still DRAFT, no event', async () => {
    const res = await markPaid(ID.owner, ID.invDraft);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    await expectUntouched(ID.invDraft, 'DRAFT');
    expect(timelineFor(ID.invDraft)).toHaveLength(0);
  });

  // MP-12 (CR-PL04-1): mark-paid after a MANUAL refund is refused (409) and
  // writes nothing; proven in 'review repairs' below (MP-12a / MP-12b).
  it.todo(
    'MP-12 (V1-29, out of scope): settling an invoice by mark-paid after a MANUAL refund. computeBalance counts the flipped '
      + 'REFUNDED row twice (paid excludes it, refunded subtracts it), so no amount both matches the money and reconciles to PAID '
      + '(160 over-posts; the true 100 leaves PARTIALLY_PAID). Mark-paid refuses until the refund/balance convention is fixed '
      + '(V1-29: invoice-workflow.service.ts computeBalance / markPaymentRefunded), outside this write set.',
  );

  it('MP-05: a refund of the mark-paid payment reverses its posting and records the refunder on the reversal', async () => {
    const res = await markPaid(ID.owner, ID.invRefund);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [row] = await paymentsOf(ID.invRefund);
    expectMarkPaidRow(row, ID.invRefund, INVOICE_TOTAL, ID.owner);

    const refunded = await refund(ID.staff, row.id);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body.status).toBe('REFUNDED');

    const reversals = await reversalsFor(row.id);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ type: 'REVERSAL', status: 'POSTED', sourceType: 'Payment', sourceId: row.id });
    expect(reversals[0].createdById).toBe(ID.staff);
    const original = await postingsFor(row.id);
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ status: 'REVERSED', createdById: ID.owner });
    expect(reversals[0].reversalOfId).toBe(original[0].id);
    // Who recorded the receipt is not overwritten by the refund.
    expect((await db.payment.findUnique({ where: { id: row.id } })).recordedBy).toBe(ID.owner);
  });
});

describe('every caller of markInvoicePaid takes the same posted path', () => {
  it('MP-06: the legacy Stripe webhook call shape markInvoicePaid(invoiceId) (no actor, no tenant; G16 deferred) -> PAID with a posted payment, recordedBy null', async () => {
    const invoice = await commerce.markInvoicePaid(ID.invWebhook);
    expect(invoice).toMatchObject({ id: ID.invWebhook, status: 'PAID' });
    const rows = await paymentsOf(ID.invWebhook);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], ID.invWebhook, INVOICE_TOTAL, null);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, null);
    expect((await invoiceRow(ID.invWebhook)).paidAt).toBeTruthy();
    expect(invoiceEventsFor(ID.invWebhook, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-07: KEY (KEY_SYSTEM_ACTOR_ID + businessId, the flow orchestrator and updateInvoice shape) -> PAID with a posted payment recorded by KEY', async () => {
    const invoice = await commerce.markInvoicePaid(ID.invKey, systemActorId, ID.biz);
    expect(invoice).toMatchObject({ id: ID.invKey, status: 'PAID' });
    const rows = await paymentsOf(ID.invKey);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], ID.invKey, INVOICE_TOTAL, KEY_ACTOR);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, KEY_ACTOR);
  });

  it('MP-08: KEY without a tenant is still refused (403) and nothing is written', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    await expect(commerce.markInvoicePaid(ID.invKeyNoTenant, systemActorId)).rejects.toBeInstanceOf(ForbiddenException);
    await expectUntouched(ID.invKeyNoTenant, 'SENT');
  });
});

describe('concurrency: the remaining balance is the one under the invoice lock', () => {
  it('MP-09: two concurrent mark-paids -> both 200; one payment, one posting, one invoice.paid', async () => {
    const results = await Promise.all([markPaid(ID.owner, ID.invConcurrent), markPaid(ID.staff, ID.invConcurrent)]);
    expect(results.map((r) => r.status), JSON.stringify(results.map((r) => r.body))).toEqual([200, 200]);
    const rows = await paymentsOf(ID.invConcurrent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SUCCESSFUL', amount: INVOICE_TOTAL, provider: 'manual' });
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, rows[0].recordedBy);
    expect((await invoiceRow(ID.invConcurrent)).status).toBe('PAID');
    expect(invoiceEventsFor(ID.invConcurrent, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-10: a payment that settles the invoice commits while mark-paid waits for the lock -> 200 (already PAID); mark-paid writes nothing', async () => {
    holdAtLock(() => commitCompetingPayment(ID.invRaceSettled, INVOICE_TOTAL, true));
    const res = await markPaid(ID.owner, ID.invRaceSettled);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.invRaceSettled, status: 'PAID' });
    const rows = await paymentsOf(ID.invRaceSettled);
    expect(rows.map((r) => r.id)).toEqual([`${ID.invRaceSettled}_competing`]);
    expect(await paymentPostingsOf(ID.invRaceSettled)).toHaveLength(0);
    expect(invoiceEventsFor(ID.invRaceSettled)).toHaveLength(0);
    expect(timelineFor(ID.invRaceSettled)).toHaveLength(0);
  });

  it('MP-11: a partial payment commits while mark-paid waits for the lock -> 409; mark-paid records no stale remaining (no over-payment)', async () => {
    holdAtLock(() => commitCompetingPayment(ID.invRaceMoved, 30, false));
    const res = await markPaid(ID.owner, ID.invRaceMoved);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    const rows = await paymentsOf(ID.invRaceMoved);
    expect(rows.map((r) => r.id)).toEqual([`${ID.invRaceMoved}_competing`]);
    expect(await paymentPostingsOf(ID.invRaceMoved)).toHaveLength(0);
    expect((await invoiceRow(ID.invRaceMoved)).status).toBe('PARTIALLY_PAID');
    expect(invoiceEventsFor(ID.invRaceMoved)).toHaveLength(0);

    // The operator retries against the balance as it now stands: 70 settles it.
    const retry = await markPaid(ID.owner, ID.invRaceMoved);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    const after = await paymentsOf(ID.invRaceMoved);
    expect(after).toHaveLength(2);
    const balancing = after.find((r) => r.id !== `${ID.invRaceMoved}_competing`);
    expectMarkPaidRow(balancing, ID.invRaceMoved, 70, ID.owner);
    await expectPostedOnce(balancing.id, 70, ID.owner);
    expect((await invoiceRow(ID.invRaceMoved)).status).toBe('PAID');
  });
});

describe('review repairs (R0-PL-04 review)', () => {
  /** The pre-repair mark-paid slot: the client-key path's hash of 'markpaid:<inv>:<remaining>:<refunded>'. */
  const oldMarkPaidSlot = (inv: string, remaining: string, refunded = '0.00') =>
    `manual_${inv}_key_${createHash('sha256').update(`markpaid:${inv}:${remaining}:${refunded}`, 'utf8').digest('hex').slice(0, 32)}`;
  /** Mark-paid's own slot: random, server-built, never a client-key or reference slot. */
  const markPaidSlot = (inv: string) => new RegExp(`^manual_${inv}_markpaid_[0-9a-f]{32}$`);

  it('MP-13 (ST-PL04-1): a client payment keyed with the old mark-paid key shape does not capture mark-paid: it records its own 50 balancing payment and ends PAID', async () => {
    const inv = ID.invClientKey;
    const client = await pay(ID.staff, inv, { amount: 50, method: 'cash', idempotencyKey: `markpaid:${inv}:50.00:0.00` });
    expect(client.status, JSON.stringify(client.body)).toBe(201);
    expect(client.body.payment.providerPaymentId).toBe(oldMarkPaidSlot(inv, '50.00'));
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const balancing = rows.find((r) => r.id !== client.body.payment.id);
    expectMarkPaidRow(balancing, inv, 50, ID.owner);
    expect(balancing.providerPaymentId).toMatch(markPaidSlot(inv));
    await expectPostedOnce(balancing.id, 50, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
    const timeline = timelineFor(inv, 'invoice.paid');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ actorId: ID.owner, actorType: 'USER' });
  });

  it('MP-14 (ST-PL04-2): a FAILED row the unauthenticated WiPay failure callback wrote on the old predictable slot does not block mark-paid', async () => {
    const inv = ID.invSquat;
    const squat = oldMarkPaidSlot(inv, '100.00');
    const cb = await payments.handleWipayCallback({ order_id: inv, status: 'failed', transaction_id: squat, total: '100' });
    expect(cb, JSON.stringify(cb)).toMatchObject({ invoiceId: inv });
    const before = await paymentsOf(inv);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ providerPaymentId: squat, status: 'FAILED', businessId: ID.biz, invoiceId: inv });

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const marked = rows.find((r) => r.providerPaymentId !== squat);
    expectMarkPaidRow(marked, inv, INVOICE_TOTAL, ID.owner);
    expect(marked.providerPaymentId).toMatch(markPaidSlot(inv));
    await expectPostedOnce(marked.id, INVOICE_TOTAL, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-12a (CR-PL04-1): 60 paid then refunded (manual flip) on a 100 invoice -> mark-paid 409; no payment, no posting, status unchanged, no event or timeline entry', async () => {
    const inv = ID.invManualRefund;
    const paid = await pay(ID.owner, inv, { amount: 60, method: 'cash', reference: 'PMP-MR-1' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const refunded = await refund(ID.owner, paid.body.payment.id);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    // The operator's own projection reads remaining 100; computeBalance reads 160 (V1-29).
    expect(await commerce.getInvoiceForBusiness(inv, ID.biz)).toMatchObject({ paidAmount: 0, remaining: INVOICE_TOTAL });
    const statusBefore = (await invoiceRow(inv)).status;
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(409);

    const rows = await paymentsOf(inv);
    expect(rows.map((r) => [r.id, Number(r.amount), r.status])).toEqual([[paid.body.payment.id, 60, 'REFUNDED']]);
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    expect((await invoiceRow(inv)).status).toBe(statusBefore);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
  });

  it('MP-12b (CR-PL04-1): a manual refund that leaves remaining below the total still blocks (30 refunded, 50 paid: computeBalance 80, true 50) -> 409; nothing written', async () => {
    const inv = ID.invManualRefundPart;
    const a = await pay(ID.owner, inv, { amount: 30, method: 'cash', reference: 'PMP-MRP-A' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await pay(ID.owner, inv, { amount: 50, method: 'cash', reference: 'PMP-MRP-B' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const refunded = await refund(ID.owner, a.body.payment.id);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    const statusBefore = (await invoiceRow(inv)).status;
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(409);

    expect((await paymentsOf(inv)).map((r) => r.id).sort()).toEqual([a.body.payment.id, b.body.payment.id].sort());
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    expect((await invoiceRow(inv)).status).toBe(statusBefore);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
  });

  it('MP-15 (CR-PL04-1, narrow): a provider refund (a separate negative REFUNDED row beside a SUCCESSFUL original) does not block: mark-paid records the 40 net balance and ends PAID', async () => {
    const inv = ID.invProviderRefund;
    await db.payment.create({
      data: {
        id: `${inv}_charge`, businessId: ID.biz, invoiceId: inv, amount: INVOICE_TOTAL, currency: 'TTD',
        status: 'SUCCESSFUL', provider: 'stripe', method: 'card', providerPaymentId: `${inv}_charge`,
      },
    });
    await db.payment.create({
      data: {
        id: `${inv}_refund`, businessId: ID.biz, invoiceId: inv, amount: -40, currency: 'TTD',
        status: 'REFUNDED', provider: 'stripe', providerPaymentId: `${inv}_refund`, reference: `${inv}_charge`,
      },
    });
    await db.invoice.update({ where: { id: inv }, data: { status: 'PARTIALLY_PAID' } });

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(3);
    const marked = rows.find((r) => r.id !== `${inv}_charge` && r.id !== `${inv}_refund`);
    expectMarkPaidRow(marked, inv, 40, ID.owner);
    await expectPostedOnce(marked.id, 40, ID.owner);
  });

  it('MP-16 (CR-PL04-2): paid, undone to DRAFT, total edited to 200, re-issued, marked paid again -> 200 PAID with a second 100 payment and invoice.paid', async () => {
    const inv = ID.invReissue;
    const first = await markPaid(ID.owner, inv);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const [firstRow] = await paymentsOf(inv);
    expectMarkPaidRow(firstRow, inv, INVOICE_TOTAL, ID.owner);

    expect(await commerce.undoInvoice(inv, ID.biz)).toMatchObject({ status: 'reverted_to_draft' });
    await commerce.updateInvoice({
      invoiceId: inv,
      businessId: ID.biz,
      items: [
        { description: 'PMP reissue 1', quantity: 1, unitPrice: 100 },
        { description: 'PMP reissue 2', quantity: 1, unitPrice: 100 },
      ],
    });
    expect(Number((await invoiceRow(inv)).total)).toBe(200);
    await workflow.transition(inv, 'SENT');
    expect((await invoiceRow(inv)).status).toBe('SENT');
    emitted.length = 0;
    contactEvents.length = 0;

    const second = await markPaid(ID.owner, inv);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: inv, status: 'PAID' });
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const secondRow = rows.find((r) => r.id !== firstRow.id);
    expectMarkPaidRow(secondRow, inv, 100, ID.owner);
    expect(secondRow.providerPaymentId).not.toBe(firstRow.providerPaymentId);
    await expectPostedOnce(secondRow.id, 100, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
    expect(timelineFor(inv, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-17 (ST-PL04-1 / CR-PL04-2): when the write leaves the invoice short of PAID, mark-paid answers 409 and logs no invoice.paid', async () => {
    const inv = ID.invShort;
    // Stand-in for a write that did not settle the invoice (the pre-repair
    // replay of another row): it resolves and changes nothing.
    const spy = vi.spyOn(commerce, 'recordPayment').mockResolvedValue({} as any);

    const res = await markPaid(ID.owner, inv);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(timelineFor(inv)).toHaveLength(0);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
  });
});
