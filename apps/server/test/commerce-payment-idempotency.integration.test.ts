/**
 * R0-D2-MANUAL-PAYMENT-IDEMPOTENCY — manual payment recording is idempotent
 * (REAL database, REAL ledger posting).
 *
 * Journey harness D2 (release0-journey.integration.test.ts, step 4) and the
 * PAYMENTS lane PK-PL-02 / PL-P03: providerPaymentId was minted as
 * manual_<now>_<random> per call and `reference` was not a key, so a double
 * submit of the same offline payment landed as a second SUCCESSFUL Payment
 * row, posted a second ledger transaction and doubled paidAmount.
 *
 * Contract pinned here for POST /commerce/businesses/:b/invoices/:id/payments:
 *
 *   idempotencyKey (new optional body field, scoped to the invoice)
 *     same key, same amount         -> the existing payment, 201, one row, one posting
 *     same key, different amount    -> 409 CONFLICT, nothing written
 *     different keys                -> two payments
 *     same key on another invoice   -> its own payment (the key is per invoice)
 *     concurrent duplicate submits  -> exactly one payment (Payment.providerPaymentId @unique)
 *     blank key                     -> treated as no key
 *     non-string key                -> 400 (DTO), nothing written
 *   reference, no key (policy chosen by this packet; the HTTP route only, review CR-1)
 *     same non-empty reference AND same amount on the same invoice -> the existing payment
 *     same reference, different amount                              -> a new payment
 *   neither key nor reference       -> every submit is a new payment (nothing to key on)
 *   review repairs
 *     slot held by another tenant's row (ST-D2-1) -> 409, nothing written, never the foreign row
 *     slot whose payment was refunded (ST-D2-2)   -> 409 naming the refund; a new key/reference records again
 *     internal callers (CR-1)                     -> a document-derived `reference` never keys the row:
 *                                                    PaymentEvidenceService / drive intake / Key cortex keep
 *                                                    one row per call and may opt in with their own idempotencyKey
 *
 * The response envelope is unchanged ({ payment, invoice, paidAmount, remaining })
 * and a replay answers with the current, not doubled, balance even once the
 * first submit settled the invoice to PAID.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService post
 * into the real ledger tables, and the production GlobalHttpExceptionFilter +
 * ValidationPipe are installed. Identity attachment is the one stand-in: a test
 * middleware reads `x-cpi-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 * CRM timeline, stats cache, Gmail, vision and the activity timeline are stubs
 * off the boundary (the CRM recorder doubles as a "was this a fresh record or a
 * replay" probe).
 *
 * Fixtures: prefix `cpi_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'crypto';
// Type-only: erased at runtime, so the dynamic-import order below (dotenv
// before anything that reads DATABASE_URL) is unchanged.
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { PaymentEvidenceService } from '../src/modules/commerce/payment-evidence.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'cpi_';
const HEADER = 'x-cpi-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  // one invoice per case so balances never bleed between cases
  invKey: `${P}invKey`,
  invKeySettled: `${P}invKeySettled`,
  invKeyMismatch: `${P}invKeyMismatch`,
  invDiffKeys: `${P}invDiffKeys`,
  invScopeA: `${P}invScopeA`,
  invScopeB: `${P}invScopeB`,
  invRaceKey: `${P}invRaceKey`,
  invRaceRef: `${P}invRaceRef`,
  invRef: `${P}invRef`,
  invRefAmount: `${P}invRefAmount`,
  invNoKey: `${P}invNoKey`,
  invBlankKey: `${P}invBlankKey`,
  invBadKey: `${P}invBadKey`,
  // review repairs
  invPlantKey: `${P}invPlantKey`, // ST-D2-1: a foreign row holds this invoice's key slot
  invPlantRef: `${P}invPlantRef`, // ST-D2-1: a foreign row holds this invoice's reference slot
  invEvidence: `${P}invEvidence`, // CR-1: two receipts through the real PaymentEvidenceService
  invInternalRef: `${P}invInternalRef`, // CR-1: internal caller, same reference + amount twice
  invInternalKey: `${P}invInternalKey`, // CR-1: internal caller opting in with its own key
};

/** ST-D2-1: another tenant whose rows are planted straight into the payments table. */
const FOREIGN = { owner: `${P}ownerB`, biz: `${P}bizB`, contact: `${P}contactB`, inv: `${P}invB` };

/**
 * ST-D2-2: the refund cases live in the owner's second tenant so the ledger
 * invariant at the end (one posting per SUCCESSFUL row in ID.biz) is not
 * disturbed by refund reversals.
 */
const REFUND = { biz: `${P}bizRefund`, contact: `${P}contactRefund`, invRef: `${P}invRefundRef`, invKey: `${P}invRefundKey` };

const INVOICE_TOTAL = 100;

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
let evidence: PaymentEvidenceService;

// CR-1: PaymentEvidenceService is the real one over the real CommerceService;
// document intelligence (the AI boundary) is the stub and returns what the
// next receipt "says".
let nextExtraction: Record<string, unknown> = {};
const docIntelStub = { extractFromDocument: async () => nextExtraction };

const recordedEvents: Array<{ name: string; payload: unknown }> = [];
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

// Every fresh manual record logs exactly one `invoice.payment_recorded` CRM
// event; a replay logs none. The recorder therefore counts fresh records.
const crmCalls: Array<Record<string, unknown>> = [];
const crmRecorder = {
  logContactEvent: async (input: Record<string, unknown>) => {
    crmCalls.push(input);
    return { id: `${P}evt_${crmCalls.length}` };
  },
};

async function cleanup() {
  for (const sql of [
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

const route = (inv: string) => `/commerce/businesses/${ID.biz}/invoices/${inv}/payments`;

function post(inv: string, body: Record<string, unknown>) {
  return agent().post(route(inv)).set(HEADER, ID.owner).send(body);
}

function balance(inv: string) {
  return agent().get(route(inv)).set(HEADER, ID.owner);
}

const routeIn = (biz: string, inv: string) => `/commerce/businesses/${biz}/invoices/${inv}/payments`;

function postIn(biz: string, inv: string, body: Record<string, unknown>) {
  return agent().post(routeIn(biz, inv)).set(HEADER, ID.owner).send(body);
}

function balanceIn(biz: string, inv: string) {
  return agent().get(routeIn(biz, inv)).set(HEADER, ID.owner);
}

/** The real refund route, through the same guards. */
function refund(biz: string, paymentId: string) {
  return agent().post(`/commerce/businesses/${biz}/payments/${paymentId}/refund`).set(HEADER, ID.owner).send({ reason: 'cpi test refund' });
}

/** Mirrors CommerceService.manualProviderPaymentId's digest so a test can occupy a slot. */
const digest = (material: string) => createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);

async function seedInvoice(id: string, invoiceNumber: string, businessId: string, contactId: string) {
  await db.invoice.create({
    data: {
      id,
      invoiceNumber,
      status: 'SENT',
      subtotal: INVOICE_TOTAL,
      total: INVOICE_TOTAL,
      currency: 'TTD',
      businessId,
      contactId,
      items: { create: [{ id: `${id}_item1`, description: `CPI item ${invoiceNumber}`, quantity: 1, unitPrice: INVOICE_TOTAL, total: INVOICE_TOTAL }] },
    },
  });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

async function invoiceStatus(id: string): Promise<string> {
  return (await db.invoice.findUnique({ where: { id }, select: { status: true } })).status;
}

/** Ledger transactions posted for one payment row, with their entries. */
async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded` },
    include: { entries: true },
  });
}

function sumDebits(txn: any): number {
  return txn.entries.reduce((s: number, e: any) => s + Number(e.debit ?? 0), 0);
}

function sumCredits(txn: any): number {
  return txn.entries.reduce((s: number, e: any) => s + Number(e.credit ?? 0), 0);
}

/** Exactly one POSTED, balanced ledger transaction for this payment, for this amount. */
async function expectPostedOnce(paymentId: string, amount: number) {
  const txns = await postingsFor(paymentId);
  expect(txns, `postings for ${paymentId}`).toHaveLength(1);
  expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
  expect(Number(txns[0].amount)).toBe(amount);
  expect(sumDebits(txns[0])).toBe(amount);
  expect(sumCredits(txns[0])).toBe(amount);
}

function expectEnvelope(body: Record<string, any>, invoiceId: string, paidAmount: number) {
  expect(body.payment).toMatchObject({ invoiceId, businessId: ID.biz, status: 'SUCCESSFUL' });
  expect(body.payment.providerPaymentId).toMatch(/^manual_/);
  expect(body.invoice).toMatchObject({ id: invoiceId, businessId: ID.biz });
  expect(Array.isArray(body.invoice.payments)).toBe(true);
  expect(Array.isArray(body.invoice.items)).toBe(true);
  expect(body.paidAmount).toBe(paidAmount);
  expect(body.remaining).toBe(Math.max(0, INVOICE_TOTAL - paidAmount));
}

function expectErrorEnvelope(body: Record<string, unknown>, statusCode: number, code: string) {
  expect(body.statusCode).toBe(statusCode);
  expect(body.code).toBe(code);
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
      // Real ledger chain: the proof is that one Payment posts exactly once.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: crmRecorder },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      // CR-1: the real PaymentEvidenceService over the real CommerceService;
      // AI extraction and the Drive download are the stubs.
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: docIntelStub },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  evidence = moduleRef.get(PaymentEvidenceService);

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
  await db.business.create({ data: { id: ID.biz, name: 'CPI Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner_biz`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Cpi', lastName: 'Customer', email: `${P}c@test.local` } });
  // The posting chain resolves system accounts by key and does not seed them
  // lazily (that is R0-D1's lane); seed the chart once, deterministically.
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `CPI-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: INVOICE_TOTAL,
        total: INVOICE_TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `CPI item ${n}`, quantity: 1, unitPrice: INVOICE_TOTAL, total: INVOICE_TOTAL }] },
      },
    });
  }

  // ST-D2-1: a second tenant with one invoice of its own.
  await db.user.create({ data: { id: FOREIGN.owner, email: `${FOREIGN.owner}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: FOREIGN.biz, name: 'CPI Foreign', ownerId: FOREIGN.owner, currency: 'TTD' } });
  await db.contact.create({ data: { id: FOREIGN.contact, businessId: FOREIGN.biz, firstName: 'Cpi', lastName: 'Foreign', email: `${P}f@test.local` } });
  await seedInvoice(FOREIGN.inv, 'CPI-B-001', FOREIGN.biz, FOREIGN.contact);

  // ST-D2-2: the owner's second tenant, with its own chart, for the refund cases.
  await db.business.create({ data: { id: REFUND.biz, name: 'CPI Refund', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner_refund`, userId: ID.owner, businessId: REFUND.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: REFUND.contact, businessId: REFUND.biz, firstName: 'Cpi', lastName: 'Refund', email: `${P}r@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(REFUND.biz);
  await seedInvoice(REFUND.invRef, 'CPI-R-001', REFUND.biz, REFUND.contact);
  await seedInvoice(REFUND.invKey, 'CPI-R-002', REFUND.biz, REFUND.contact);
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('seeded one tenant, its system chart of accounts and one SENT invoice per case', async () => {
    const coa = await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } });
    expect(coa).toBeGreaterThan(0);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await invoiceStatus(id), id).toBe('SENT');
      expect(await paymentsOf(id)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// D2 proof 1: the same idempotencyKey twice is one payment, one posting, one
// balance — and both calls answer 201 with the same payment id.
// ---------------------------------------------------------------------------
describe('idempotencyKey: two identical submits with the same key', () => {
  const body = { amount: 40, method: 'cash', reference: 'cpi-ref-key', notes: 'cash at counter', idempotencyKey: 'cpi-key-1' };

  it('create exactly one Payment, one balanced posting, and both answer 201 with the same payment id; balance counted once', async () => {
    const first = await post(ID.invKey, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expectEnvelope(first.body, ID.invKey, 40);
    expect(first.body.payment).toMatchObject({ amount: 40, method: 'cash', reference: 'cpi-ref-key', notes: 'cash at counter' });
    expect(crmCalls).toHaveLength(1);

    const second = await post(ID.invKey, body);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expectEnvelope(second.body, ID.invKey, 40);
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expect(second.body.payment.providerPaymentId).toBe(first.body.payment.providerPaymentId);
    // The replay did not record anything: no second CRM event.
    expect(crmCalls).toHaveLength(1);

    const rows = await paymentsOf(ID.invKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.body.payment.id, amount: 40, status: 'SUCCESSFUL' });
    await expectPostedOnce(first.body.payment.id, 40);

    const bal = await balance(ID.invKey);
    expect(bal.status).toBe(200);
    expect(bal.body).toMatchObject({ paidAmount: 40, remaining: 60, invoiceTotal: INVOICE_TOTAL });
    expect(bal.body.payments).toHaveLength(1);
    expect(await invoiceStatus(ID.invKey)).toBe('PARTIALLY_PAID');
  });

  it('a replay of the key after the first submit settled the invoice to PAID still answers 201 with the existing payment, not the 409 state guard', async () => {
    const body = { amount: INVOICE_TOTAL, method: 'bank_transfer', reference: 'cpi-ref-settle', idempotencyKey: 'cpi-key-settle' };
    const first = await post(ID.invKeySettled, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.invoice.status).toBe('PAID');
    expect(await invoiceStatus(ID.invKeySettled)).toBe('PAID');

    const replay = await post(ID.invKeySettled, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expectEnvelope(replay.body, ID.invKeySettled, INVOICE_TOTAL);
    expect(replay.body.invoice.status).toBe('PAID');

    expect(await paymentsOf(ID.invKeySettled)).toHaveLength(1);
    await expectPostedOnce(first.body.payment.id, INVOICE_TOTAL);
    // Still a state guard for a genuinely new payment on the PAID invoice.
    const fresh = await post(ID.invKeySettled, { amount: 1, method: 'cash', idempotencyKey: 'cpi-key-settle-other' });
    expect(fresh.status).toBe(409);
    expectErrorEnvelope(fresh.body, 409, 'CONFLICT');
    expect(fresh.body.message).toBe('Cannot record payment on a PAID invoice');
    expect(await paymentsOf(ID.invKeySettled)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// D2 proof 3: different keys create two payments; a key reused with a
// different amount answers 409 and writes nothing.
// ---------------------------------------------------------------------------
describe('idempotencyKey: distinct keys and conflicting replays', () => {
  it('different keys create two payments, each posted once; balance is their sum', async () => {
    const a = await post(ID.invDiffKeys, { amount: 30, method: 'cash', idempotencyKey: 'cpi-key-a' });
    const b = await post(ID.invDiffKeys, { amount: 20, method: 'cash', idempotencyKey: 'cpi-key-b' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.payment.id).not.toBe(b.body.payment.id);
    expect(a.body.payment.providerPaymentId).not.toBe(b.body.payment.providerPaymentId);
    expect(b.body.paidAmount).toBe(50);
    expect(b.body.remaining).toBe(50);

    expect(await paymentsOf(ID.invDiffKeys)).toHaveLength(2);
    await expectPostedOnce(a.body.payment.id, 30);
    await expectPostedOnce(b.body.payment.id, 20);
    expect(crmCalls).toHaveLength(2);
  });

  it('a key reused with a different amount answers 409 CONFLICT; no second row, no second posting, balance unchanged', async () => {
    const first = await post(ID.invKeyMismatch, { amount: 25, method: 'cash', idempotencyKey: 'cpi-key-mismatch' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    crmCalls.length = 0;

    const conflict = await post(ID.invKeyMismatch, { amount: 26, method: 'cash', idempotencyKey: 'cpi-key-mismatch' });
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409);
    expectErrorEnvelope(conflict.body, 409, 'CONFLICT');
    expect(conflict.body.message).toMatch(/idempotency key/i);

    const rows = await paymentsOf(ID.invKeyMismatch);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(25);
    await expectPostedOnce(first.body.payment.id, 25);
    expect(crmCalls).toEqual([]);
    const bal = await balance(ID.invKeyMismatch);
    expect(bal.body).toMatchObject({ paidAmount: 25, remaining: 75 });
  });

  it('the key is scoped to the invoice: the same key on two invoices records one payment on each', async () => {
    const a = await post(ID.invScopeA, { amount: 10, method: 'cash', idempotencyKey: 'cpi-key-shared' });
    const b = await post(ID.invScopeB, { amount: 10, method: 'cash', idempotencyKey: 'cpi-key-shared' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.payment.id).not.toBe(b.body.payment.id);
    expect(a.body.payment.invoiceId).toBe(ID.invScopeA);
    expect(b.body.payment.invoiceId).toBe(ID.invScopeB);
    expect(await paymentsOf(ID.invScopeA)).toHaveLength(1);
    expect(await paymentsOf(ID.invScopeB)).toHaveLength(1);
  });

  it('a blank key is no key: two submits with whitespace keys and no reference are two payments', async () => {
    const a = await post(ID.invBlankKey, { amount: 5, method: 'cash', idempotencyKey: '   ' });
    const b = await post(ID.invBlankKey, { amount: 5, method: 'cash', idempotencyKey: '   ' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.payment.id).not.toBe(b.body.payment.id);
    expect(await paymentsOf(ID.invBlankKey)).toHaveLength(2);
  });

  it('a non-string key answers 400 BAD_REQUEST from the body contract; nothing written', async () => {
    const res = await post(ID.invBadKey, { amount: 5, method: 'cash', idempotencyKey: 123 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST');
    expect(await paymentsOf(ID.invBadKey)).toHaveLength(0);
    expect(crmCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D2 proof 4: concurrent duplicate submits yield one Payment. Both requests
// pass the pre-check, both try to insert; Payment.providerPaymentId @unique
// lets exactly one win and the loser returns the winner's row.
// ---------------------------------------------------------------------------
describe('concurrent duplicate submits (Promise.all x2)', () => {
  it('with the same key: exactly one Payment, one posting, both answer 201 with the same id', async () => {
    const body = { amount: 35, method: 'cash', reference: 'cpi-ref-race', idempotencyKey: 'cpi-key-race' };
    const [a, b] = await Promise.all([post(ID.invRaceKey, body), post(ID.invRaceKey, body)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect(a.body.payment.id).toBe(b.body.payment.id);

    const rows = await paymentsOf(ID.invRaceKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: a.body.payment.id, amount: 35, status: 'SUCCESSFUL' });
    await expectPostedOnce(a.body.payment.id, 35);
    // One fresh record, one replay.
    expect(crmCalls).toHaveLength(1);
    const bal = await balance(ID.invRaceKey);
    expect(bal.body).toMatchObject({ paidAmount: 35, remaining: 65 });
    expect(await invoiceStatus(ID.invRaceKey)).toBe('PARTIALLY_PAID');
  });

  it('with the same reference and amount and no key: exactly one Payment, one posting', async () => {
    const body = { amount: 45, method: 'cash', reference: 'cpi-ref-race-only' };
    const [a, b] = await Promise.all([post(ID.invRaceRef, body), post(ID.invRaceRef, body)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect(a.body.payment.id).toBe(b.body.payment.id);

    const rows = await paymentsOf(ID.invRaceRef);
    expect(rows).toHaveLength(1);
    await expectPostedOnce(a.body.payment.id, 45);
    expect(crmCalls).toHaveLength(1);
    const bal = await balance(ID.invRaceRef);
    expect(bal.body).toMatchObject({ paidAmount: 45, remaining: 55 });
  });
});

// ---------------------------------------------------------------------------
// D2 proof 2: the reference policy, pinned. Without a key, a non-empty
// reference together with the amount identifies the manual payment inside
// one invoice (the journey's "same offline payment" is the same slip for the
// same amount). The same reference with a different amount is a different
// payment, and with neither key nor reference nothing can be keyed on.
// ---------------------------------------------------------------------------
describe('reference without idempotencyKey (policy: same invoice + same non-empty reference + same amount = same payment)', () => {
  it('two submits with the same reference and amount return the existing payment: one row, one posting, balance counted once', async () => {
    const body = { amount: 60, method: 'cash', reference: 'cpi-slip-001', notes: 'offline slip' };
    const first = await post(ID.invRef, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expectEnvelope(first.body, ID.invRef, 60);

    const second = await post(ID.invRef, body);
    expect([200, 201]).toContain(second.status);
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expectEnvelope(second.body, ID.invRef, 60);
    expect(crmCalls).toHaveLength(1);

    expect(await paymentsOf(ID.invRef)).toHaveLength(1);
    await expectPostedOnce(first.body.payment.id, 60);
    const bal = await balance(ID.invRef);
    expect(bal.body).toMatchObject({ paidAmount: 60, remaining: 40 });
  });

  it('the same reference with a different amount is a new payment (two rows, two postings, balance is the sum)', async () => {
    const a = await post(ID.invRefAmount, { amount: 30, method: 'cash', reference: 'cpi-slip-002' });
    const b = await post(ID.invRefAmount, { amount: 20, method: 'cash', reference: 'cpi-slip-002' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.payment.id).not.toBe(b.body.payment.id);
    expect(b.body.paidAmount).toBe(50);
    expect(await paymentsOf(ID.invRefAmount)).toHaveLength(2);
    await expectPostedOnce(a.body.payment.id, 30);
    await expectPostedOnce(b.body.payment.id, 20);
    expect(crmCalls).toHaveLength(2);
  });

  it('with neither key nor reference every submit is a new payment (nothing to key on); providerPaymentId stays manual_ and unique', async () => {
    const a = await post(ID.invNoKey, { amount: 15, method: 'cash' });
    const b = await post(ID.invNoKey, { amount: 15, method: 'cash' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.payment.id).not.toBe(b.body.payment.id);
    expect(a.body.payment.providerPaymentId).toMatch(/^manual_/);
    expect(b.body.payment.providerPaymentId).toMatch(/^manual_/);
    expect(a.body.payment.providerPaymentId).not.toBe(b.body.payment.providerPaymentId);
    expect(b.body.paidAmount).toBe(30);
    expect(await paymentsOf(ID.invNoKey)).toHaveLength(2);
    await expectPostedOnce(a.body.payment.id, 15);
    await expectPostedOnce(b.body.payment.id, 15);
  });
});

// ---------------------------------------------------------------------------
// Review ST-D2-1: the idempotency lookup is scoped to the caller's tenant and
// invoice. providerPaymentId is unique table-wide and client-chosen on other
// surfaces, so a foreign row sitting in this invoice's slot must never come
// back as a "replay" (that handed tenant B's payment to tenant A as a 201 and
// silently dropped A's genuine receipt). It answers 409 and writes nothing.
// ---------------------------------------------------------------------------
describe('review ST-D2-1: a providerPaymentId slot held by another tenant is never a replay', () => {
  async function plant(id: string, providerPaymentId: string, amount: number) {
    return db.payment.create({
      data: { id, amount, currency: 'TTD', status: 'SUCCESSFUL', provider: 'wipay', method: 'card', providerPaymentId, businessId: FOREIGN.biz, invoiceId: FOREIGN.inv },
    });
  }

  it('key slot: tenant A answers 409 CONFLICT and records nothing; the foreign row is untouched; another key still records', async () => {
    const planted = await plant(`${P}pay_plant_key`, `manual_${ID.invPlantKey}_key_${digest('plant')}`, 10);

    const res = await post(ID.invPlantKey, { idempotencyKey: 'plant', amount: 10, method: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT');
    expect(res.body.payment).toBeUndefined();
    expect(await paymentsOf(ID.invPlantKey)).toHaveLength(0);
    expect(crmCalls).toEqual([]);
    const bal = await balance(ID.invPlantKey);
    expect(bal.body).toMatchObject({ paidAmount: 0, remaining: INVOICE_TOTAL });
    expect(await db.payment.findUnique({ where: { id: planted.id } })).toMatchObject({
      businessId: FOREIGN.biz, invoiceId: FOREIGN.inv, amount: 10, status: 'SUCCESSFUL',
    });

    const ok = await post(ID.invPlantKey, { idempotencyKey: 'plant-2', amount: 10, method: 'cash' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.payment).toMatchObject({ businessId: ID.biz, invoiceId: ID.invPlantKey, amount: 10 });
    expect(await paymentsOf(ID.invPlantKey)).toHaveLength(1);
  });

  it('reference slot: the same 409, nothing recorded for tenant A, invoice still SENT', async () => {
    await plant(`${P}pay_plant_ref`, `manual_${ID.invPlantRef}_ref_${digest('cash\n100.00')}`, 100);

    const res = await post(ID.invPlantRef, { reference: 'cash', amount: 100, method: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT');
    expect(res.body.payment).toBeUndefined();
    expect(await paymentsOf(ID.invPlantRef)).toHaveLength(0);
    expect(crmCalls).toEqual([]);
    expect(await invoiceStatus(ID.invPlantRef)).toBe('SENT');
  });
});

// ---------------------------------------------------------------------------
// Review ST-D2-2: a slot whose payment was refunded is not a replay. Before
// the repair the same key / reference + amount answered 201 with the REFUNDED
// row, paidAmount 0, wrote nothing, and the slot was permanently dead. Now it
// is 409 naming the refund, and a new reference/key records the new receipt.
// ---------------------------------------------------------------------------
describe('review ST-D2-2: a refunded payment in the slot answers 409, never a silent no-op', () => {
  it('reference + amount: record, refund through the real route, same body -> 409; a new reference records again', async () => {
    const body = { amount: 20, method: 'bank_transfer', reference: 'EFT-9' };
    const first = await postIn(REFUND.biz, REFUND.invRef, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const refunded = await refund(REFUND.biz, first.body.payment.id);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body.status).toBe('REFUNDED');
    crmCalls.length = 0;

    const again = await postIn(REFUND.biz, REFUND.invRef, body);
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expectErrorEnvelope(again.body, 409, 'CONFLICT');
    expect(again.body.message).toMatch(/refunded/i);
    expect(again.body.payment).toBeUndefined();
    expect(await paymentsOf(REFUND.invRef)).toHaveLength(1);
    expect(crmCalls).toEqual([]);
    const bal = await balanceIn(REFUND.biz, REFUND.invRef);
    expect(bal.body).toMatchObject({ paidAmount: 0, remaining: INVOICE_TOTAL });

    // The invoice is not dead: a new reference records the new receipt.
    const fresh = await postIn(REFUND.biz, REFUND.invRef, { ...body, reference: 'EFT-10' });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.payment.id).not.toBe(first.body.payment.id);
    expect(fresh.body.paidAmount).toBe(20);
    expect(await paymentsOf(REFUND.invRef)).toHaveLength(2);
    expect(crmCalls).toHaveLength(1);
  });

  it('idempotencyKey: the same key after the refund -> 409 naming the key and the refund; a new key records again', async () => {
    const body = { amount: 20, method: 'cash', idempotencyKey: 'kk' };
    const first = await postIn(REFUND.biz, REFUND.invKey, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await refund(REFUND.biz, first.body.payment.id)).body.status).toBe('REFUNDED');

    const again = await postIn(REFUND.biz, REFUND.invKey, body);
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expectErrorEnvelope(again.body, 409, 'CONFLICT');
    expect(again.body.message).toMatch(/idempotency key/i);
    expect(again.body.message).toMatch(/refunded/i);
    expect(await paymentsOf(REFUND.invKey)).toHaveLength(1);

    const fresh = await postIn(REFUND.biz, REFUND.invKey, { ...body, idempotencyKey: 'kk-2' });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.payment.id).not.toBe(first.body.payment.id);
    expect(fresh.body.paidAmount).toBe(20);
    expect(await paymentsOf(REFUND.invKey)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Review CR-1: the reference + amount heuristic belongs to the HTTP route
// only. PaymentEvidenceService.processEvidence passes the invoice number the
// document cites as `reference`, so with the heuristic at service level a
// split payment documented by two receipts collapsed onto the first Payment
// (one row, the second receipt's evidence dropped, success reported, invoice
// stuck PARTIALLY_PAID). Internal callers get one row per call, as at the
// merge base, and may opt in with an idempotencyKey of their own identity.
// ---------------------------------------------------------------------------
describe('review CR-1: internal callers are not keyed on a document-derived reference', () => {
  const receipt = (filename: string) => ({
    businessId: ID.biz,
    invoiceId: ID.invEvidence,
    evidenceUrl: `https://evidence.test/${filename}`,
    evidenceMimeType: 'application/pdf',
    filename,
    source: 'upload' as const,
  });

  it('two receipts citing the invoice number for the same amount record two payments through the real PaymentEvidenceService; the invoice settles', async () => {
    nextExtraction = { documentType: 'receipt', confidence: 0.9, invoiceData: { invoiceNumber: 'CPI-EVID-001', total: 50, notes: 'bank transfer' } };

    const first = await evidence.processEvidence(receipt('receipt-deposit.pdf'));
    expect(first.payment).toMatchObject({ amount: 50, reference: 'CPI-EVID-001', evidenceUrl: 'https://evidence.test/receipt-deposit.pdf' });
    expect(first.invoiceStatus).toBe('PARTIALLY_PAID');

    const second = await evidence.processEvidence(receipt('receipt-balance.pdf'));
    expect(second.payment.id).not.toBe(first.payment.id);
    expect(second.payment).toMatchObject({ amount: 50, reference: 'CPI-EVID-001', evidenceUrl: 'https://evidence.test/receipt-balance.pdf' });
    expect(second.invoiceStatus).toBe('PAID');

    const rows = await paymentsOf(ID.invEvidence);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.evidenceUrl).sort()).toEqual(['https://evidence.test/receipt-balance.pdf', 'https://evidence.test/receipt-deposit.pdf']);
    expect(new Set(rows.map((r) => r.providerPaymentId)).size).toBe(2);
    await expectPostedOnce(first.payment.id, 50);
    await expectPostedOnce(second.payment.id, 50);
    expect(await invoiceStatus(ID.invEvidence)).toBe('PAID');
    expect(crmCalls).toHaveLength(2);
  });

  it('a direct service call (the drive-intake / Key cortex shape) with the same reference and amount twice records two payments', async () => {
    const input = { amount: 30, method: 'cash', reference: 'INV-CITED' };
    const a = await commerce.recordPayment(ID.invInternalRef, ID.biz, input);
    const b = await commerce.recordPayment(ID.invInternalRef, ID.biz, input);
    expect(a.payment.id).not.toBe(b.payment.id);
    expect(b.paidAmount).toBe(60);
    expect(await paymentsOf(ID.invInternalRef)).toHaveLength(2);
    await expectPostedOnce(a.payment.id, 30);
    await expectPostedOnce(b.payment.id, 30);
    expect(crmCalls).toHaveLength(2);
  });

  it('an internal caller opts in with an idempotencyKey of its own identity: the second call replays, one row', async () => {
    const input = { amount: 30, method: 'cash', reference: 'INV-CITED', idempotencyKey: 'evidence:https://evidence.test/one.pdf' };
    const a = await commerce.recordPayment(ID.invInternalKey, ID.biz, input);
    const b = await commerce.recordPayment(ID.invInternalKey, ID.biz, input);
    expect(b.payment.id).toBe(a.payment.id);
    expect(b.paidAmount).toBe(30);
    expect(await paymentsOf(ID.invInternalKey)).toHaveLength(1);
    await expectPostedOnce(a.payment.id, 30);
    expect(crmCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// D2 proof 5: the ledger stays balanced across everything above — one POSTED
// transaction per SUCCESSFUL Payment row, debits equal credits overall.
// ---------------------------------------------------------------------------
describe('ledger invariant across all cases', () => {
  it('one POSTED transaction per SUCCESSFUL payment row; tenant-wide debits equal credits equal paid total', async () => {
    const payments = await db.payment.findMany({ where: { businessId: ID.biz, status: 'SUCCESSFUL' } });
    expect(payments.length).toBeGreaterThan(0);
    const txns = await db.financialTransaction.findMany({
      where: { businessId: ID.biz, sourceType: 'Payment' },
      include: { entries: true },
    });
    expect(txns).toHaveLength(payments.length);
    expect(new Set(txns.map((t: any) => t.externalRef)).size).toBe(payments.length);
    for (const p of payments) {
      expect(txns.map((t: any) => t.externalRef)).toContain(`Payment:${p.id}:payment_recorded`);
    }
    const paid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const debits = txns.reduce((s: number, t: any) => s + sumDebits(t), 0);
    const credits = txns.reduce((s: number, t: any) => s + sumCredits(t), 0);
    expect(debits).toBe(paid);
    expect(credits).toBe(paid);
  });
});
