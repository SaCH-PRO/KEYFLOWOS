/**
 * R0-D3-INVOICE-ROUTE-ERROR-MAPPING — tenant-path invoice routes answer
 * 404/409/400, never 500 (REAL database).
 *
 * Journey harness D3 (release0-journey.integration.test.ts, step 6): with a
 * bizA invoice id under bizB's own path, GET/POST .../invoices/:id/payments,
 * PATCH .../invoices/:id and DELETE .../invoices/:id answered 500 because
 * CommerceService threw a plain Error('Invoice not found') that
 * GlobalHttpExceptionFilter maps to INTERNAL_SERVER_ERROR. The same filter
 * turned every plain Error('Cannot ...') state guard on those paths into a
 * 500 as well. This file pins the HTTP contract of those routes:
 *
 *   not found (cross-tenant or unknown id)   -> 404 NotFoundException
 *   state conflict ('Cannot ...')            -> 409 ConflictException
 *   invalid input (amount, tax, discount)    -> 400 BadRequestException
 *
 * with the existing messages preserved verbatim, and proves nothing is written
 * on any denied path.
 *
 * Review repairs (R0-D3 integration review) pinned here as well:
 *   ST-D3-1  PATCH contactId must resolve inside the caller's tenant   -> 404
 *   ST-D3-2  PATCH items[].productId must resolve inside the tenant    -> 404
 *   ST-D3-3  POST payments with a malformed amount or missing method   -> 400
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService and the production
 * GlobalHttpExceptionFilter + ValidationPipe are real against DATABASE_URL.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-cie-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. Collaborators off
 * the boundary (CRM timeline, stats cache, Gmail, vision, ledger posting) are
 * recorders so the test can assert they were never reached.
 *
 * R0-27-REVENUE-CREATE-CONTRACT (L2 half) pins POST .../invoices as well:
 *   CC-TENANT  a contactId outside the caller's tenant (foreign, unknown or
 *              soft-deleted) is one 404 'Contact not found'; no invoice row,
 *              and nothing of the foreign contact in the body
 *   CC-400     empty items, quantity 0, a null (NaN) price, a missing contactId
 *              -> 400 with field messages; CommerceService.createInvoice is
 *              never called and nothing is written
 *   CC-TOTALS  subtotal, taxAmount and total are computed on the server; the
 *              client's values (and items[].total) are dropped
 *   CC-LEDGER  a refused create writes no Invoice and no FinancialTransaction;
 *              an accepted create posts nothing (CASH and ACCRUAL alike) and,
 *              under ACCRUAL, issuing it posts AR once
 *              (Invoice:<id>:invoice_finalized)
 * For the ledger proof the invoice hooks of RevenuePostingService delegate to
 * the real ledger chain (RevenuePostingService, PostingService,
 * ChartOfAccountsSeederService); the payment hooks stay recorders.
 *
 * Fixtures: prefix `cie_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'cie_';
const HEADER = 'x-cie-user';
const UNKNOWN_INVOICE = `${P}does_not_exist`;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // bizA: the invoice whose id is used under bizB's path
  invSentA: `${P}invSentA`,
  // bizB: one invoice per state guard
  invDraftB: `${P}invDraftB`,
  invSentB: `${P}invSentB`,
  invPaidB: `${P}invPaidB`,
  invPartialB: `${P}invPartialB`,
  invVoidB: `${P}invVoidB`,
  // bizA: the product whose id is offered under bizB's path (ST-D3-2)
  productA: `${P}productA`,
  // bizB: same-tenant controls for the reference-binding cases (ST-D3-1/2)
  productB: `${P}productB`,
  invBindB: `${P}invBindB`,
  // bizB: the one invoice that receives a legal payment (ST-D3-3 positive control)
  invPayB: `${P}invPayB`,
  // R0-27: a soft-deleted contact of bizB (own tenant, but gone)
  contactGoneB: `${P}contactGoneB`,
  // R0-27: an ACCRUAL tenant for the ledger proof (bizB is CASH, the default)
  ownerC: `${P}ownerC`,
  bizC: `${P}bizC`,
  contactC: `${P}contactC`,
};

const ORIGINAL_NOTES = 'cie original notes';

let db: any;
let app: any;
let redis: any;
// R0-27: the real CommerceService instance (spied on) and the real ledger chain.
let commerceSvc: any;
let realLedger: any;

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

const crmCalls: unknown[] = [];
const crmRecorder = {
  logContactEvent: async (input: unknown) => {
    crmCalls.push(input);
    return { id: `${P}evt_${crmCalls.length}` };
  },
};

// Ledger posting is off this packet's boundary; every denied path must throw
// before it is reached, so the recorder doubles as a "nothing written" probe.
const postingCalls: string[] = [];
const postingRecorder = {
  onPaymentRecorded: async (paymentId: string) => {
    postingCalls.push(`recorded:${paymentId}`);
  },
  onPaymentRefunded: async (paymentId: string) => {
    postingCalls.push(`refunded:${paymentId}`);
  },
  // R0-27 LEDGER: issuing and voiding run the real accrual posting (a no-op on
  // CASH), so the proof is the financial_transactions rows themselves.
  onInvoiceFinalized: async (invoiceId: string, opts?: unknown) => {
    postingCalls.push(`finalized:${invoiceId}`);
    return realLedger.onInvoiceFinalized(invoiceId, opts);
  },
  onInvoiceVoided: async (invoiceId: string, opts?: unknown) => {
    postingCalls.push(`voided:${invoiceId}`);
    return realLedger.onInvoiceVoided(invoiceId, opts);
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
    `DELETE FROM products WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%' OR user_id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function as(actor: string, req: request.Test) {
  return req.set(HEADER, actor);
}

const routes = {
  listPayments: (biz: string, inv: string) => `/commerce/businesses/${biz}/invoices/${inv}/payments`,
  recordPayment: (biz: string, inv: string) => `/commerce/businesses/${biz}/invoices/${inv}/payments`,
  update: (biz: string, inv: string) => `/commerce/businesses/${biz}/invoices/${inv}`,
  remove: (biz: string, inv: string) => `/commerce/businesses/${biz}/invoices/${inv}`,
  paymentLink: (biz: string, inv: string) => `/commerce/businesses/${biz}/invoices/${inv}/payment-link`,
};

/** The four D3 routes, as the journey harness probes them, for one invoice id under one business path. */
function fourRoutes(actor: string, biz: string, inv: string) {
  return Promise.all([
    as(actor, agent().get(routes.listPayments(biz, inv))).then((r) => ({ label: `GET ${routes.listPayments(biz, inv)}`, status: r.status, body: r.body })),
    as(actor, agent().post(routes.recordPayment(biz, inv))).send({ amount: 1, method: 'cash' }).then((r) => ({ label: `POST ${routes.recordPayment(biz, inv)}`, status: r.status, body: r.body })),
    as(actor, agent().patch(routes.update(biz, inv))).send({ notes: 'hijacked' }).then((r) => ({ label: `PATCH ${routes.update(biz, inv)}`, status: r.status, body: r.body })),
    as(actor, agent().delete(routes.remove(biz, inv))).then((r) => ({ label: `DELETE ${routes.remove(biz, inv)}`, status: r.status, body: r.body })),
  ]);
}

async function invoiceRow(id: string) {
  return db.invoice.findUnique({ where: { id }, select: { status: true, deletedAt: true, notes: true, taxRate: true, businessId: true } });
}

/** Raw columns of an invoice row, as the database holds them. */
async function rawInvoice(id: string): Promise<{ contact_id: string; subtotal: number; total: number }> {
  const rows: Array<{ contact_id: string; subtotal: number; total: number }> =
    await db.$queryRawUnsafe(`SELECT contact_id, subtotal, total FROM invoices WHERE id = '${id}'`);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Raw invoice_items rows (id, product_id) for an invoice, in id order. */
async function rawItems(invoiceId: string): Promise<Array<{ id: string; product_id: string | null }>> {
  return db.$queryRawUnsafe(`SELECT id, product_id FROM invoice_items WHERE invoice_id = '${invoiceId}' ORDER BY id`);
}

async function paymentCount(invoiceId: string): Promise<number> {
  return db.payment.count({ where: { invoiceId } });
}

async function paymentLinkCount(invoiceId: string): Promise<number> {
  return db.paymentLink.count({ where: { invoiceId } });
}

function expectErrorEnvelope(body: Record<string, unknown>, statusCode: number, code: string, message: string | RegExp) {
  expect(body.statusCode).toBe(statusCode);
  expect(body.code).toBe(code);
  if (typeof message === 'string') expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
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
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');

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
      { provide: RevenuePostingService, useValue: postingRecorder },
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
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  commerceSvc = moduleRef.get(CommerceService);
  const prismaSvc = moduleRef.get(PrismaService);
  const coaSeeder = new ChartOfAccountsSeederService(prismaSvc);
  realLedger = new RevenuePostingService(prismaSvc, new PostingService(prismaSvc), coaSeeder, { recordEvent: async () => null } as any);

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

  for (const id of [ID.ownerA, ID.ownerB, ID.ownerC]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'CIE Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'CIE Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA_bizA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB_bizB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Cie', lastName: 'CustomerA', email: `${P}a@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Cie', lastName: 'CustomerB', email: `${P}b@test.local` } });
  await db.contact.create({
    data: { id: ID.contactGoneB, businessId: ID.bizB, firstName: 'Cie', lastName: 'GoneB', email: `${P}gone@test.local`, deletedAt: new Date() },
  });
  await db.business.create({ data: { id: ID.bizC, name: 'CIE Biz C', ownerId: ID.ownerC, currency: 'TTD', accountingBasis: 'ACCRUAL' } });
  await db.membership.create({ data: { id: `${P}m_ownerC_bizC`, userId: ID.ownerC, businessId: ID.bizC, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactC, businessId: ID.bizC, firstName: 'Cie', lastName: 'CustomerC', email: `${P}c@test.local` } });
  await coaSeeder.ensureDefaults(ID.bizC);
  await db.product.create({ data: { id: ID.productA, businessId: ID.bizA, name: 'CIE Product A', price: 5 } });
  await db.product.create({ data: { id: ID.productB, businessId: ID.bizB, name: 'CIE Product B', price: 7 } });

  const inv = async (id: string, biz: string, contactId: string, status: string, total: number, number: string) =>
    db.invoice.create({
      data: {
        id,
        invoiceNumber: number,
        status,
        subtotal: total,
        total,
        currency: 'TTD',
        notes: ORIGINAL_NOTES,
        businessId: biz,
        contactId,
        items: { create: [{ id: `${id}_item1`, description: `CIE item ${number}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  await inv(ID.invSentA, ID.bizA, ID.contactA, 'SENT', 100, 'CIE-A-SENT');
  await inv(ID.invDraftB, ID.bizB, ID.contactB, 'DRAFT', 50, 'CIE-B-DRAFT');
  await inv(ID.invSentB, ID.bizB, ID.contactB, 'SENT', 80, 'CIE-B-SENT');
  await inv(ID.invPaidB, ID.bizB, ID.contactB, 'PAID', 20, 'CIE-B-PAID');
  await inv(ID.invPartialB, ID.bizB, ID.contactB, 'PARTIALLY_PAID', 60, 'CIE-B-PARTIAL');
  await inv(ID.invVoidB, ID.bizB, ID.contactB, 'VOID', 30, 'CIE-B-VOID');
  await inv(ID.invBindB, ID.bizB, ID.contactB, 'DRAFT', 40, 'CIE-B-BIND');
  await inv(ID.invPayB, ID.bizB, ID.contactB, 'SENT', 80, 'CIE-B-PAY');

  // Payments, not labels, determine paid state: back the PAID and
  // PARTIALLY_PAID rows with real SUCCESSFUL payments.
  await db.payment.create({
    data: {
      id: `${P}pay_paidB`, businessId: ID.bizB, invoiceId: ID.invPaidB, amount: 20, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'manual', method: 'MANUAL', providerPaymentId: `${P}pp_paidB`,
    },
  });
  await db.payment.create({
    data: {
      id: `${P}pay_partialB`, businessId: ID.bizB, invoiceId: ID.invPartialB, amount: 25, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'manual', method: 'MANUAL', providerPaymentId: `${P}pp_partialB`,
    },
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
  postingCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('seeded two tenants, one owner each, and the invoices under test', async () => {
    expect((await invoiceRow(ID.invSentA)).businessId).toBe(ID.bizA);
    for (const id of [ID.invDraftB, ID.invSentB, ID.invPaidB, ID.invPartialB, ID.invVoidB, ID.invBindB, ID.invPayB]) {
      expect((await invoiceRow(id)).businessId).toBe(ID.bizB);
    }
    expect((await db.product.findUnique({ where: { id: ID.productA } })).businessId).toBe(ID.bizA);
    expect((await db.product.findUnique({ where: { id: ID.productB } })).businessId).toBe(ID.bizB);
    expect(await paymentCount(ID.invPaidB)).toBe(1);
    expect(await paymentCount(ID.invPartialB)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D3 proof 1: a bizA invoice id under bizB's own path, by bizB's owner.
// ---------------------------------------------------------------------------
describe("cross-tenant: bizA's invoice id under bizB's own path (owner of B)", () => {
  it('GET/POST .../invoices/:id/payments, PATCH and DELETE .../invoices/:id all answer 404 (never 500) and write nothing', async () => {
    const before = await invoiceRow(ID.invSentA);
    const rows = await fourRoutes(ID.ownerB, ID.bizB, ID.invSentA);

    expect(rows.map((r) => `${r.status} ${r.label}`).filter((s) => s.startsWith('5'))).toEqual([]);
    for (const r of rows) {
      expect(r.status, r.label).toBe(404);
      expectErrorEnvelope(r.body, 404, 'NOT_FOUND', 'Invoice not found');
    }

    // Nothing crossed the tenant line: the bizA row is byte-for-byte unchanged.
    expect(await invoiceRow(ID.invSentA)).toEqual(before);
    expect(before).toMatchObject({ status: 'SENT', deletedAt: null, notes: ORIGINAL_NOTES });
    expect(await paymentCount(ID.invSentA)).toBe(0);
    expect(postingCalls).toEqual([]);
    expect(crmCalls).toEqual([]);
    expect(recordedEvents).toEqual([]);
  });

  it('POST .../invoices/:id/payment-link answers 404 and creates no link', async () => {
    const res = await as(ID.ownerB, agent().post(routes.paymentLink(ID.bizB, ID.invSentA))).send({});
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Invoice not found');
    expect(await paymentLinkCount(ID.invSentA)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D3 proof 2: an unknown invoice id under the caller's own path.
// ---------------------------------------------------------------------------
describe('unknown invoice id under own path (owner of B)', () => {
  it('the same four routes answer 404 (never 500)', async () => {
    const rows = await fourRoutes(ID.ownerB, ID.bizB, UNKNOWN_INVOICE);
    expect(rows.map((r) => `${r.status} ${r.label}`).filter((s) => s.startsWith('5'))).toEqual([]);
    for (const r of rows) {
      expect(r.status, r.label).toBe(404);
      expectErrorEnvelope(r.body, 404, 'NOT_FOUND', 'Invoice not found');
    }
    expect(postingCalls).toEqual([]);
    expect(crmCalls).toEqual([]);
  });

  it('POST .../invoices/:id/payment-link answers 404', async () => {
    const res = await as(ID.ownerB, agent().post(routes.paymentLink(ID.bizB, UNKNOWN_INVOICE))).send({});
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Invoice not found');
  });
});

// ---------------------------------------------------------------------------
// D3 proof 3: state guards on these paths answer 409 / 400 with the exact
// message preserved, and write nothing.
// ---------------------------------------------------------------------------
describe('state conflicts answer 409 CONFLICT with the exact message', () => {
  it('POST payments on a PAID invoice -> 409 "Cannot record payment on a PAID invoice"; no payment row, no posting', async () => {
    const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invPaidB))).send({ amount: 5, method: 'cash' });
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot record payment on a PAID invoice');
    expect(await paymentCount(ID.invPaidB)).toBe(1);
    expect(postingCalls).toEqual([]);
    expect(crmCalls).toEqual([]);
  });

  it('POST payments on a VOID invoice -> 409 "Cannot record payment on a VOID invoice"; no payment row', async () => {
    const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invVoidB))).send({ amount: 5, method: 'cash' });
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot record payment on a VOID invoice');
    expect(await paymentCount(ID.invVoidB)).toBe(0);
    expect(postingCalls).toEqual([]);
  });

  it('PATCH a PAID invoice -> 409 "Cannot edit a paid or partially paid invoice"; notes unchanged', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invPaidB))).send({ notes: 'edited' });
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot edit a paid or partially paid invoice');
    expect((await invoiceRow(ID.invPaidB)).notes).toBe(ORIGINAL_NOTES);
  });

  it('PATCH a PARTIALLY_PAID invoice -> 409 "Cannot edit a paid or partially paid invoice"; notes unchanged', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invPartialB))).send({ notes: 'edited' });
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot edit a paid or partially paid invoice');
    expect((await invoiceRow(ID.invPartialB)).notes).toBe(ORIGINAL_NOTES);
  });

  it('DELETE a PAID invoice -> 409 "Cannot delete a paid or partially paid invoice"; row not soft-deleted', async () => {
    const res = await as(ID.ownerB, agent().delete(routes.remove(ID.bizB, ID.invPaidB)));
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot delete a paid or partially paid invoice');
    expect((await invoiceRow(ID.invPaidB)).deletedAt).toBeNull();
    expect(recordedEvents.filter((e) => e.name === 'invoice.deleted')).toEqual([]);
  });

  it('DELETE a PARTIALLY_PAID invoice -> 409 "Cannot delete a paid or partially paid invoice"; row not soft-deleted', async () => {
    const res = await as(ID.ownerB, agent().delete(routes.remove(ID.bizB, ID.invPartialB)));
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot delete a paid or partially paid invoice');
    expect((await invoiceRow(ID.invPartialB)).deletedAt).toBeNull();
  });

  it('POST payment-link on a PAID invoice -> 409 "Cannot create payment link for a paid or voided invoice"; no link', async () => {
    const res = await as(ID.ownerB, agent().post(routes.paymentLink(ID.bizB, ID.invPaidB))).send({});
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot create payment link for a paid or voided invoice');
    expect(await paymentLinkCount(ID.invPaidB)).toBe(0);
  });

  it('POST payment-link on a VOID invoice -> 409 with the same message; no link', async () => {
    const res = await as(ID.ownerB, agent().post(routes.paymentLink(ID.bizB, ID.invVoidB))).send({});
    expect(res.status).toBe(409);
    expectErrorEnvelope(res.body, 409, 'CONFLICT', 'Cannot create payment link for a paid or voided invoice');
    expect(await paymentLinkCount(ID.invVoidB)).toBe(0);
  });
});

describe('invalid input answers 400 BAD_REQUEST with the exact message', () => {
  it('POST payments with amount 0 -> 400 "Payment amount must be positive"; no payment row, no posting', async () => {
    const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invSentB))).send({ amount: 0, method: 'cash' });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Payment amount must be positive');
    expect(await paymentCount(ID.invSentB)).toBe(0);
    expect(postingCalls).toEqual([]);
  });

  it('POST payments with a negative amount -> 400 "Payment amount must be positive"; no payment row', async () => {
    const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invSentB))).send({ amount: -5, method: 'cash' });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Payment amount must be positive');
    expect(await paymentCount(ID.invSentB)).toBe(0);
  });

  it('PATCH with taxRate 150 -> 400 "Tax rate must be between 0 and 100"; invoice unchanged', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ taxRate: 150 });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Tax rate must be between 0 and 100');
    expect(await invoiceRow(ID.invDraftB)).toMatchObject({ status: 'DRAFT', notes: ORIGINAL_NOTES });
  });

  it('PATCH with a negative discount -> 400 "Discount value must be non-negative"', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ discountType: 'FIXED', discountValue: -1 });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Discount value must be non-negative');
  });

  it('PATCH with a 150% discount -> 400 "Percentage discount cannot exceed 100%"', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ discountType: 'PERCENT', discountValue: 150 });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Percentage discount cannot exceed 100%');
  });
});

// ---------------------------------------------------------------------------
// Review repairs ST-D3-1 / ST-D3-2: PATCH .../invoices/:id binds contactId and
// items[].productId and answers with `include: { contact: true }`. Both ids
// must resolve inside the caller's tenant. A foreign id and an unknown id are
// the same 404 (no existence disclosure) and nothing is written: no bind, no
// item rewrite, no event.
// ---------------------------------------------------------------------------
describe("cross-tenant reference binding on PATCH .../invoices/:id (owner of B, own DRAFT invoice)", () => {
  it("contactId of bizA's contact -> 404 'Contact not found'; contact_id unchanged; no contact row in the body", async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ contactId: ID.contactA });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Contact not found');
    expect(res.body).not.toHaveProperty('contact');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('CustomerA');
    expect(text).not.toContain(`${P}a@test.local`);
    expect(text).not.toContain(ID.bizA);
    expect((await rawInvoice(ID.invDraftB)).contact_id).toBe(ID.contactB);
    expect(recordedEvents.filter((e) => e.name === 'invoice.updated')).toEqual([]);
  });

  it("an unknown contactId -> the same 404 'Contact not found'; contact_id unchanged", async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ contactId: `${P}no_such_contact` });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Contact not found');
    expect((await rawInvoice(ID.invDraftB)).contact_id).toBe(ID.contactB);
  });

  it('a null contactId -> 400 (Invoice.contactId is required), never 500; contact_id unchanged', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ contactId: null });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'contactId must be a non-empty string');
    expect((await rawInvoice(ID.invDraftB)).contact_id).toBe(ID.contactB);
  });

  it("items[].productId of bizA's product -> 404 'Product not found'; the existing item row and totals are untouched", async () => {
    const itemsBefore = await rawItems(ID.invDraftB);
    const rowBefore = await rawInvoice(ID.invDraftB);
    expect(itemsBefore).toEqual([{ id: `${ID.invDraftB}_item1`, product_id: null }]);
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({
      items: [{ description: 'x', quantity: 1, unitPrice: 5, productId: ID.productA }],
    });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Product not found');
    expect(await rawItems(ID.invDraftB)).toEqual(itemsBefore);
    expect(await rawInvoice(ID.invDraftB)).toEqual(rowBefore);
    expect(recordedEvents.filter((e) => e.name === 'invoice.updated')).toEqual([]);
  });

  it("one foreign productId among own ones -> 404 'Product not found'; nothing written", async () => {
    const itemsBefore = await rawItems(ID.invDraftB);
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({
      items: [
        { description: 'own', quantity: 1, unitPrice: 5, productId: ID.productB },
        { description: 'foreign', quantity: 1, unitPrice: 5, productId: ID.productA },
      ],
    });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Product not found');
    expect(await rawItems(ID.invDraftB)).toEqual(itemsBefore);
  });

  it("an unknown productId -> the same 404 'Product not found'; nothing written", async () => {
    const itemsBefore = await rawItems(ID.invDraftB);
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({
      items: [{ description: 'x', quantity: 1, unitPrice: 5, productId: `${P}no_such_product` }],
    });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Product not found');
    expect(await rawItems(ID.invDraftB)).toEqual(itemsBefore);
  });

  it('positive control: own contactId and own productId -> 200, both bound, the response contact is the own-tenant row', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invBindB))).send({
      contactId: ID.contactB,
      items: [
        { description: 'own product line', quantity: 2, unitPrice: 7, productId: ID.productB },
        { description: 'free-text line', quantity: 1, unitPrice: 1 },
        { description: 'empty productId is no product', quantity: 1, unitPrice: 1, productId: '' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.contact).toMatchObject({ id: ID.contactB, businessId: ID.bizB });
    expect(res.body.total).toBe(16);
    expect((await rawInvoice(ID.invBindB)).contact_id).toBe(ID.contactB);
    const productIds = (await rawItems(ID.invBindB)).map((r) => r.product_id).sort();
    expect(productIds).toEqual([null, null, ID.productB].sort());
    expect(recordedEvents.filter((e) => e.name === 'invoice.updated')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Review repair ST-D3-3: the record-payment body is an inline type, so the
// ValidationPipe cannot reject a malformed amount or a missing method. Those
// reached tx.payment.create and answered 500 INTERNAL_SERVER_ERROR. They are
// 400 now, with no payment row and no posting on any of them.
// ---------------------------------------------------------------------------
describe('malformed payment input answers 400 BAD_REQUEST, never 500 (owner of B, own SENT invoice)', () => {
  const amountCases: Array<[string, Record<string, unknown>]> = [
    ['missing amount', { method: 'cash' }],
    ['null amount', { amount: null, method: 'cash' }],
    ['numeric-string amount', { amount: '5', method: 'cash' }],
    ['non-numeric string amount', { amount: 'abc', method: 'cash' }],
    ['object amount', { amount: { gt: 0 }, method: 'cash' }],
    ['boolean amount', { amount: true, method: 'cash' }],
  ];
  for (const [label, body] of amountCases) {
    it(`${label} -> 400 "Payment amount must be a number"; no payment row, no posting`, async () => {
      const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invSentB))).send(body);
      expect(res.status, label).toBe(400);
      expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Payment amount must be a number');
      expect(await paymentCount(ID.invSentB)).toBe(0);
      expect(postingCalls).toEqual([]);
      expect(crmCalls).toEqual([]);
    });
  }

  const methodCases: Array<[string, Record<string, unknown>]> = [
    ['missing method', { amount: 1 }],
    ['empty method', { amount: 1, method: '' }],
    ['blank method', { amount: 1, method: '   ' }],
    ['non-string method', { amount: 1, method: 7 }],
  ];
  for (const [label, body] of methodCases) {
    it(`${label} -> 400 "Payment method is required"; no payment row, no posting`, async () => {
      const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invSentB))).send(body);
      expect(res.status, label).toBe(400);
      expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', 'Payment method is required');
      expect(await paymentCount(ID.invSentB)).toBe(0);
      expect(postingCalls).toEqual([]);
    });
  }

  it('the tenant check still runs first: a malformed body for a foreign invoice id answers 404, not 400', async () => {
    const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invSentA))).send({ method: 'cash' });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Invoice not found');
    expect(await paymentCount(ID.invSentA)).toBe(0);
  });

  it('positive control: a well-formed payment on an own SENT invoice -> 201, one SUCCESSFUL row, posting reached, PARTIALLY_PAID', async () => {
    const res = await as(ID.ownerB, agent().post(routes.recordPayment(ID.bizB, ID.invPayB))).send({ amount: 5, method: 'cash', reference: 'cie-ref-1' });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ invoiceId: ID.invPayB, businessId: ID.bizB, amount: 5, status: 'SUCCESSFUL', method: 'cash' });
    expect(res.body.paidAmount).toBe(5);
    expect(res.body.remaining).toBe(75);
    expect(await paymentCount(ID.invPayB)).toBe(1);
    expect(postingCalls).toEqual([`recorded:${res.body.payment.id}`]);
    expect((await invoiceRow(ID.invPayB)).status).toBe('PARTIALLY_PAID');
  });
});

// ---------------------------------------------------------------------------
// Positive controls: the mapping narrows only the error path; the happy path
// of the same routes under the caller's own tenant still succeeds.
// ---------------------------------------------------------------------------
describe('positive controls (own tenant, legal state)', () => {
  it('GET .../invoices/:id/payments on an own PAID invoice -> 200 with the payment list', async () => {
    const res = await as(ID.ownerB, agent().get(routes.listPayments(ID.bizB, ID.invPaidB)));
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.paidAmount).toBe(20);
  });

  it('PATCH an own DRAFT invoice with valid notes -> 200 and the row is updated', async () => {
    const res = await as(ID.ownerB, agent().patch(routes.update(ID.bizB, ID.invDraftB))).send({ notes: 'cie edited' });
    expect(res.status).toBe(200);
    expect((await invoiceRow(ID.invDraftB)).notes).toBe('cie edited');
    // restore for any later case
    await db.invoice.update({ where: { id: ID.invDraftB }, data: { notes: ORIGINAL_NOTES } });
  });

  it('DELETE an own DRAFT invoice -> 200 and the row is soft-deleted', async () => {
    const id = `${P}invDel`;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: 'CIE-B-DEL',
        status: 'DRAFT',
        subtotal: 10,
        total: 10,
        currency: 'TTD',
        businessId: ID.bizB,
        contactId: ID.contactB,
        items: { create: [{ id: `${id}_item1`, description: 'CIE del item', quantity: 1, unitPrice: 10, total: 10 }] },
      },
    });
    const res = await as(ID.ownerB, agent().delete(routes.remove(ID.bizB, id)));
    expect(res.status).toBe(200);
    // Raw SQL: the Prisma soft-delete extension hides the row from findUnique once deleted_at is set.
    const rows: Array<{ deleted_at: Date | null }> = await db.$queryRawUnsafe(`SELECT deleted_at FROM invoices WHERE id = '${id}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(recordedEvents.filter((e) => e.name === 'invoice.deleted')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// R0-27-REVENUE-CREATE-CONTRACT (L2 half): POST .../invoices validates its
// body, computes totals on the server and resolves contactId inside the
// caller's tenant. At c2f6f46d createInvoice set data.contactId with no tenant
// check and answered with `include: { contact: true }`, so bizA's contactId
// under bizB's path created bizB's invoice linked to bizA's contact and echoed
// that contact's row (journey step 6). The L1 half (field messages, what the
// controller forwards) is test/commerce-authorization.e2e.test.ts.
// ---------------------------------------------------------------------------
describe('R0-27: POST /commerce/businesses/:businessId/invoices create contract (real rows)', () => {
  const createRoute = (biz: string) => `/commerce/businesses/${biz}/invoices`;
  const issueRoute = (inv: string) => `/commerce/invoices/${inv}/status/sent`;
  const line = (over: Record<string, unknown> = {}) => ({ description: 'CIE line', quantity: 1, unitPrice: 10, ...over });
  const create = (actor: string, biz: string, body: Record<string, unknown>) => as(actor, agent().post(createRoute(biz))).send(body);

  /** Invoice rows (soft-deleted included) and financial_transactions of one tenant. */
  async function writes(biz: string): Promise<{ invoices: number; transactions: number }> {
    const inv: Array<{ n: number }> = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM invoices WHERE business_id = '${biz}'`);
    const ft: Array<{ n: number }> = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM financial_transactions WHERE business_id = '${biz}'`);
    return { invoices: inv[0].n, transactions: ft[0].n };
  }

  async function linkedToContact(contactId: string): Promise<number> {
    const rows: Array<{ n: number }> = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM invoices WHERE contact_id = '${contactId}'`);
    return rows[0].n;
  }

  /** The ledger rows posted for one invoice. */
  async function invoicePostings(invoiceId: string): Promise<Array<{ external_ref: string; amount: number }>> {
    return db.$queryRawUnsafe(
      `SELECT external_ref, amount::float8 AS amount FROM financial_transactions WHERE source_type = 'Invoice' AND source_id = '${invoiceId}' ORDER BY created_at`,
    );
  }

  /** Error bodies differ only in volatile envelope fields; strip those before comparing. */
  function stripVolatile(body: Record<string, unknown>) {
    const copy = { ...body };
    delete copy.timestamp;
    delete copy.path;
    delete copy.correlationId;
    return copy;
  }

  it("CC-TENANT foreign: bizA's contactId under bizB's path -> 404 'Contact not found'; no invoice row, no FinancialTransaction, no event, nothing of A's contact in the body", async () => {
    const before = await writes(ID.bizB);
    const linkedA = await linkedToContact(ID.contactA);
    const res = await create(ID.ownerB, ID.bizB, { contactId: ID.contactA, items: [line()] });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404, 'NOT_FOUND', 'Contact not found');
    expect(res.body).not.toHaveProperty('contact');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('CustomerA');
    expect(text).not.toContain(`${P}a@test.local`);
    expect(text).not.toContain(ID.bizA);
    expect(await writes(ID.bizB)).toEqual(before);
    expect(await linkedToContact(ID.contactA)).toBe(linkedA);
    expect(recordedEvents.filter((e) => e.name === 'invoice.created')).toEqual([]);
    expect(postingCalls).toEqual([]);
  });

  it('CC-TENANT unknown and soft-deleted: an unknown contactId and an own soft-deleted contact get the same 404, byte-identical (volatile fields stripped) to the foreign one; no invoice row', async () => {
    const before = await writes(ID.bizB);
    const foreign = await create(ID.ownerB, ID.bizB, { contactId: ID.contactA, items: [line()] });
    const unknown = await create(ID.ownerB, ID.bizB, { contactId: `${P}no_such_contact`, items: [line()] });
    const gone = await create(ID.ownerB, ID.bizB, { contactId: ID.contactGoneB, items: [line()] });
    for (const r of [foreign, unknown, gone]) expect(r.status).toBe(404);
    expect(stripVolatile(unknown.body)).toEqual(stripVolatile(foreign.body));
    expect(stripVolatile(gone.body)).toEqual(stripVolatile(foreign.body));
    expect(await writes(ID.bizB)).toEqual(before);
    expect(await linkedToContact(ID.contactGoneB)).toBe(0);
  });

  const invalid: Array<[string, () => Record<string, unknown>, RegExp]> = [
    ['empty items', () => ({ contactId: ID.contactB, items: [] }), /^items must contain at least 1 elements$/],
    ['quantity 0', () => ({ contactId: ID.contactB, items: [line({ quantity: 0 })] }), /^items\.0\.quantity must be a positive number$/],
    // InvoiceItem.quantity is an Int column: before R0-27, 1.5 x 40 was stored as quantity 1 under a line and invoice total of 60.
    ['fractional quantity 1.5', () => ({ contactId: ID.contactB, items: [line({ quantity: 1.5, unitPrice: 40 })] }), /^items\.0\.quantity must be an integer number$/],
    ['NaN price (serialised as null)', () => ({ contactId: ID.contactB, items: [line({ unitPrice: Number.NaN })] }), /^items\.0\.unitPrice must be a number/],
    ['missing contactId', () => ({ items: [line()] }), /^contactId should not be empty$/],
  ];
  for (const [label, body, field] of invalid) {
    it(`CC-400 ${label} -> 400 with the field message; CommerceService.createInvoice is never called; no Invoice, no FinancialTransaction`, async () => {
      const spy = vi.spyOn(commerceSvc, 'createInvoice');
      try {
        const before = await writes(ID.bizB);
        const res = await create(ID.ownerB, ID.bizB, body());
        expect(res.status, label).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
        expect([res.body.message].flat().some((m: unknown) => field.test(String(m))), JSON.stringify(res.body.message)).toBe(true);
        expect(spy).not.toHaveBeenCalled();
        expect(await writes(ID.bizB)).toEqual(before);
        expect(recordedEvents).toEqual([]);
        expect(postingCalls).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  }

  it('CC-TOTALS: subtotal, taxAmount, discountAmount and total are computed on the server; the client total, subtotal, taxAmount and items[].total are dropped', async () => {
    const res = await create(ID.ownerB, ID.bizB, {
      contactId: ID.contactB,
      items: [
        line({ description: 'Two hours', quantity: 2, unitPrice: 10, total: 1 }),
        line({ description: 'Setup', quantity: 1, unitPrice: 5, total: 1 }),
      ],
      taxRate: 10,
      discountType: 'FIXED',
      discountValue: 2,
      subtotal: 1,
      taxAmount: 0,
      discountAmount: 0,
      total: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizB, status: 'DRAFT', subtotal: 25, taxRate: 10, taxAmount: 2.5, discountAmount: 2, total: 25.5 });
    expect(res.body.contact).toMatchObject({ id: ID.contactB, businessId: ID.bizB });
    const rows: Array<Record<string, unknown>> = await db.$queryRawUnsafe(
      `SELECT subtotal, tax_amount, discount_amount, total, status, contact_id FROM invoices WHERE id = '${res.body.id}'`,
    );
    expect(rows).toEqual([{ subtotal: 25, tax_amount: 2.5, discount_amount: 2, total: 25.5, status: 'DRAFT', contact_id: ID.contactB }]);
    const items: Array<{ total: number }> = await db.$queryRawUnsafe(`SELECT total FROM invoice_items WHERE invoice_id = '${res.body.id}' ORDER BY total`);
    expect(items.map((i) => i.total)).toEqual([5, 20]);
    expect(recordedEvents.filter((e) => e.name === 'invoice.created')).toHaveLength(1);
  });

  it('CC-POSITIVE (control): a valid create by the owner of B -> 201 DRAFT invoice with its items and fields, linked to the own-tenant contact', async () => {
    const res = await create(ID.ownerB, ID.bizB, {
      contactId: ID.contactB,
      items: [line({ description: 'Consulting', quantity: 2, unitPrice: 40 })],
      currency: 'USD',
      dueDate: '2026-12-01',
      notes: 'cie r0-27 notes',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizB, contactId: ID.contactB, status: 'DRAFT', currency: 'USD', subtotal: 80, total: 80, notes: 'cie r0-27 notes' });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ description: 'Consulting', quantity: 2, unitPrice: 40, total: 80 });
    expect(new Date(res.body.dueDate).toISOString().slice(0, 10)).toBe('2026-12-01');
    expect((await rawInvoice(res.body.id)).contact_id).toBe(ID.contactB);
  });

  it('CC-LEDGER CASH: an accepted create posts nothing, and issuing it on the CASH tenant posts nothing either', async () => {
    const res = await create(ID.ownerB, ID.bizB, { contactId: ID.contactB, items: [line({ quantity: 3 })] });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(await invoicePostings(id)).toEqual([]);
    expect(postingCalls).toEqual([]);

    const sent = await as(ID.ownerB, agent().patch(issueRoute(id))).send({ businessId: ID.bizB, status: 'SENT' });
    expect(sent.status).toBe(200);
    expect(postingCalls).toEqual([`finalized:${id}`]);
    expect(await invoicePostings(id)).toEqual([]);
  });

  it('CC-LEDGER ACCRUAL: an accepted create posts nothing; issuing it posts AR once (one Invoice:<id>:invoice_finalized) for the server-computed total, not the client total', async () => {
    const res = await create(ID.ownerC, ID.bizC, { contactId: ID.contactC, items: [line({ quantity: 3 })], subtotal: 1, total: 1 });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(res.body.total).toBe(30);
    expect(await invoicePostings(id)).toEqual([]);

    const sent = await as(ID.ownerC, agent().patch(issueRoute(id))).send({ businessId: ID.bizC, status: 'SENT' });
    expect(sent.status).toBe(200);
    expect(await invoicePostings(id)).toEqual([{ external_ref: `Invoice:${id}:invoice_finalized`, amount: 30 }]);
  });

  it('CC-LEDGER refused: on the ACCRUAL tenant a foreign contact (404) and an invalid body (400) write no Invoice and no FinancialTransaction', async () => {
    const before = await writes(ID.bizC);
    const foreign = await create(ID.ownerC, ID.bizC, { contactId: ID.contactB, items: [line()] });
    const empty = await create(ID.ownerC, ID.bizC, { contactId: ID.contactC, items: [] });
    expect(foreign.status).toBe(404);
    expectErrorEnvelope(foreign.body, 404, 'NOT_FOUND', 'Contact not found');
    expect(empty.status).toBe(400);
    expect(await writes(ID.bizC)).toEqual(before);
    expect(postingCalls).toEqual([]);
  });

  it('CC-D3 (control): the R0-D3 contract on create is unchanged: taxRate 150, a negative discount and a 150% discount -> 400 with the exact service message; no invoice row', async () => {
    const before = await writes(ID.bizB);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ taxRate: 150 }, 'Tax rate must be between 0 and 100'],
      [{ discountType: 'FIXED', discountValue: -1 }, 'Discount value must be non-negative'],
      [{ discountType: 'PERCENT', discountValue: 150 }, 'Percentage discount cannot exceed 100%'],
    ];
    for (const [extra, message] of cases) {
      const res = await create(ID.ownerB, ID.bizB, { contactId: ID.contactB, items: [line()], ...extra });
      expect(res.status, message).toBe(400);
      expectErrorEnvelope(res.body, 400, 'BAD_REQUEST', message);
    }
    expect(await writes(ID.bizB)).toEqual(before);
  });

  it('CC-SERVICE (control): createInvoiceForService (booking deposit) is unchanged: one DRAFT line for the deposit amount, linked to the contact it is given, nothing posted', async () => {
    const inv = await commerceSvc.createInvoiceForService(ID.bizB, ID.contactB, { name: 'CIE Service', price: 40 }, { kind: 'DEPOSIT', amountOverride: 10 });
    expect(inv).toMatchObject({ businessId: ID.bizB, contactId: ID.contactB, status: 'DRAFT', subtotal: 10, total: 10, currency: 'TTD', notes: 'Deposit for service "CIE Service"' });
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0]).toMatchObject({ description: 'Deposit — CIE Service', quantity: 1, unitPrice: 10, total: 10 });
    expect(inv.contact).toMatchObject({ id: ID.contactB });
    expect(await invoicePostings(inv.id)).toEqual([]);
  });
});
