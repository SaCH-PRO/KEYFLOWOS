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
 * Fixtures: prefix `cie_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

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
};

const ORIGINAL_NOTES = 'cie original notes';

let db: any;
let app: any;
let redis: any;

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

  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'CIE Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'CIE Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA_bizA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB_bizB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Cie', lastName: 'CustomerA', email: `${P}a@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Cie', lastName: 'CustomerB', email: `${P}b@test.local` } });
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
