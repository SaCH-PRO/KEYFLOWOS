/**
 * V1-53-QUOTE-CREATE-ERRORS — the quote create contract and the quote edit,
 * delete and convert errors as HTTP exceptions (REAL database).
 *
 * M19 (quote half), split from R0-27: R0-27 gave POST .../invoices a DTO
 * (CreateInvoiceDto, DocumentLineItemDto) and mapped the invoice route errors
 * to 404/409/400 (R0-D3). The quote routes kept an inline body type, which the
 * global ValidationPipe cannot see (it validated nothing and stripped nothing),
 * and CommerceService answered their refusals with a plain Error, which
 * GlobalHttpExceptionFilter maps to 500.
 *
 * Contract pinned here:
 *
 *   QC-400     POST .../quotes with empty items, a missing items array, quantity
 *              0 or 1.5, a NaN (null) or negative price, a price above the
 *              ledger bound, an empty description, a missing contactId, a
 *              non-numeric taxRate, an unknown discountType, a malformed
 *              expiryDate or a 4-letter currency -> 400 with the field message;
 *              CommerceService.createQuote is never called; nothing is written
 *   QC-TOTALS  subtotal, taxAmount, discountAmount, total and items[].total are
 *              computed on the server; the client's values, status, viewToken
 *              and invoiceId are dropped
 *   QC-CONTACT (R0-04 review ST-R004-1, regression control) a foreign, unknown
 *              or soft-deleted contactId -> one 404, byte-identical; no Quote
 *   QC-PRODUCT a line's productId resolves inside the path tenant: foreign or
 *              unknown -> 404 'Product not found', byte-identical; no Quote
 *   QC-NUMBER  a quoteNumber already used in the business -> 409
 *              quote_number_taken (it was the unique index's P2002, a 500)
 *   QC-BOUND   a computed total above the ledger bound -> 400; no Quote
 *   QE-*       PATCH .../quotes/:id: an unknown, foreign-tenant or deleted id ->
 *              404 'Quote not found'; a malformed line -> 400 with the quote and
 *              its lines unchanged; a foreign contact or product -> 404, row
 *              unchanged; a converted quote -> 409 quote_converted
 *   QD-*       DELETE .../quotes/:id: unknown/foreign/deleted -> 404; a converted
 *              quote -> 409 quote_converted (message kept), the row stays
 *   QV-*       POST .../quotes/:id/convert: unknown/foreign/deleted -> 404; a
 *              DRAFT, SENT or REJECTED quote -> 409 quote_not_accepted (message
 *              kept); a repeat -> 409 quote_converted; four parallel converts ->
 *              one invoice, three 409; a malformed body -> 400 and
 *              convertQuoteToInvoice is never called
 *   QS-404     POST .../quotes/:id/send-email for an unknown or foreign id -> 404
 *   QR-LEGACY  (ST-R004-1, regression control) the operator detail of a quote
 *              stored with another tenant's contact serves contact null
 *   LEDGER     no refused create, edit, delete or convert writes an Invoice, a
 *              Quote or a FinancialTransaction (tenant B is ACCRUAL with a
 *              seeded chart of accounts, and the real ledger chain is wired)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService and the real
 * ledger chain run against DATABASE_URL behind the production
 * GlobalHttpExceptionFilter and ValidationPipe, with the app's
 * BusinessEventInterceptor (its emitter a recorder) and TenantInterceptor.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-v53a-user`, loads that seeded user row and attaches `{ id, email, role }`
 * as AuthMiddleware would. Collaborators off the boundary (event bus, contact
 * timeline, stats cache, Gmail) are recorders.
 *
 * Fixtures: prefix `v53a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v53a_';
const HEADER = 'x-v53a-user';
const MAX_QTY = 2147483647;
const MAX_AMOUNT = 99999999999999;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactGoneB: `${P}contactGoneB`,
  productA: `${P}productA`,
  productB: `${P}productB`,
  unknownQuote: `${P}quote_unknown`,
  unknownContact: `${P}contact_unknown`,
  unknownProduct: `${P}product_unknown`,
};

let db: any;
let app: any;
let redis: any;
let commerceSvc: any;

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

const auditRecorder = { emit: async () => undefined };

const crmCalls: Array<{ type: string }> = [];
const crmRecorder = {
  logContactEvent: async (input: { type: string }) => {
    crmCalls.push({ type: input.type });
    return { id: `${P}evt` };
  },
};

const gmailCalls: string[] = [];
const gmailRecorder = {
  sendEmail: async () => {
    gmailCalls.push('sendEmail');
    return { id: `${P}msg` };
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `UPDATE quotes SET invoice_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function as(actor: string, req: request.Test) {
  return req.set(HEADER, actor);
}

const routes = {
  create: (biz: string) => `/commerce/businesses/${biz}/quotes`,
  one: (biz: string, q: string) => `/commerce/businesses/${biz}/quotes/${q}`,
  convert: (biz: string, q: string) => `/commerce/businesses/${biz}/quotes/${q}/convert`,
  sendEmail: (biz: string, q: string) => `/commerce/businesses/${biz}/quotes/${q}/send-email`,
};

const line = (over: Record<string, unknown> = {}) => ({ description: 'V53A line', quantity: 1, unitPrice: 10, ...over });

function createOnB(body: Record<string, unknown>) {
  return as(ID.ownerB, agent().post(routes.create(ID.bizB))).send(body);
}
function patchOnB(quoteId: string, body: Record<string, unknown>) {
  return as(ID.ownerB, agent().patch(routes.one(ID.bizB, quoteId))).send(body);
}
function deleteOnB(quoteId: string) {
  return as(ID.ownerB, agent().delete(routes.one(ID.bizB, quoteId)));
}
function convertOnB(quoteId: string, body: Record<string, unknown> = {}) {
  return as(ID.ownerB, agent().post(routes.convert(ID.bizB, quoteId))).send(body);
}

/** The error body without the per-request fields (timestamp, path, correlation id). */
function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

function messages(body: { message?: unknown }): string[] {
  return [body.message].flat().map((m) => String(m));
}

let seq = 0;
const nextNumber = (tag: string) => `${P}${tag}-${String(++seq).padStart(3, '0')}`;

/** A quote written straight to the table, in a given state, with one 2 x 10 line. */
async function seedQuote(
  businessId: string,
  contactId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const number = nextNumber('SEED');
  const id = `${P}q_${number.slice(P.length)}`;
  await db.quote.create({
    data: {
      id,
      businessId,
      contactId,
      quoteNumber: number,
      status,
      subtotal: 20,
      total: 20,
      currency: 'TTD',
      items: { create: [{ id: `${id}_item1`, description: 'V53A seeded line', quantity: 2, unitPrice: 10, total: 20 }] },
      ...extra,
    },
  });
  return id;
}

/** Every column of a quote and its lines, read raw (the soft-delete extension hides deleted rows). */
async function quoteState(id: string): Promise<string> {
  const quote: any[] = await db.$queryRawUnsafe(`SELECT to_jsonb(q) AS row FROM quotes q WHERE id = $1`, id);
  const items: any[] = await db.$queryRawUnsafe(`SELECT to_jsonb(i) AS row FROM quote_items i WHERE quote_id = $1 ORDER BY id`, id);
  return JSON.stringify([quote.map((r) => r.row), items.map((r) => r.row)]);
}

async function quoteRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT to_jsonb(q) AS row FROM quotes q WHERE id = $1`, id);
  return rows[0]?.row ?? null;
}

/** A tenant's commercial state, every column, as one string: quotes, lines, invoices, lines, payments, ledger. */
async function tenantState(businessId: string): Promise<string> {
  const parts: unknown[] = [];
  for (const sql of [
    `SELECT to_jsonb(q) AS row FROM quotes q WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(i) AS row FROM quote_items i WHERE quote_id IN (SELECT id FROM quotes WHERE business_id = $1) ORDER BY id`,
    `SELECT to_jsonb(v) AS row FROM invoices v WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(i) AS row FROM invoice_items i WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1) ORDER BY id`,
    `SELECT to_jsonb(p) AS row FROM payments p WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(t) AS row FROM financial_transactions t WHERE business_id = $1 ORDER BY id`,
    `SELECT to_jsonb(e) AS row FROM ledger_entries e WHERE business_id = $1 ORDER BY id`,
  ]) {
    const rows: any[] = await db.$queryRawUnsafe(sql, businessId);
    parts.push(rows.map((r) => r.row));
  }
  return JSON.stringify(parts);
}

async function counts(businessId: string) {
  const one = async (sql: string) => ((await db.$queryRawUnsafe(sql, businessId)) as Array<{ n: number }>)[0].n;
  return {
    quotes: await one(`SELECT count(*)::int AS n FROM quotes WHERE business_id = $1`),
    invoices: await one(`SELECT count(*)::int AS n FROM invoices WHERE business_id = $1`),
    transactions: await one(`SELECT count(*)::int AS n FROM financial_transactions WHERE business_id = $1`),
  };
}

function expectNothingOfTenantA(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(ID.bizA);
  expect(text).not.toContain('V53aForeign');
  expect(text).not.toContain(`${P}contactA@test.local`);
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
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
  const { Reflector } = await import('@nestjs/core');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
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
      // Real ledger chain: any posting would be a real row.
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
      { provide: GmailService, useValue: gmailRecorder },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  commerceSvc = moduleRef.get(CommerceService);

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
  app.useGlobalInterceptors(
    new BusinessEventInterceptor(auditRecorder as any, new Reflector()),
    new TenantInterceptor(moduleRef.get(PrismaService)),
  );
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V53A Foreign Biz', ownerId: ID.ownerA, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V53A Accrual Biz', ownerId: ID.ownerB, currency: 'TTD', accountingBasis: 'ACCRUAL' } });
  for (const biz of [ID.bizA, ID.bizB]) await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V53aForeign', lastName: 'Customer', email: `${P}contactA@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V53a', lastName: 'Customer', email: `${P}contactB@test.local` } });
  await db.contact.create({
    data: { id: ID.contactGoneB, businessId: ID.bizB, firstName: 'V53a', lastName: 'Gone', email: `${P}gone@test.local`, deletedAt: new Date() },
  });
  await db.product.create({ data: { id: ID.productA, businessId: ID.bizA, name: 'V53A Foreign Product', price: 5 } });
  await db.product.create({ data: { id: ID.productB, businessId: ID.bizB, name: 'V53A Own Product', price: 7 } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
  gmailCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('two tenants, B on ACCRUAL with a seeded chart of accounts, no quotes, invoices or ledger rows yet', async () => {
    expect((await db.business.findUnique({ where: { id: ID.bizB } })).accountingBasis).toBe('ACCRUAL');
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizB, isSystem: true } })).toBeGreaterThan(0);
    for (const biz of [ID.bizA, ID.bizB]) expect(await counts(biz)).toEqual({ quotes: 0, invoices: 0, transactions: 0 });
    expect(await quoteRow(ID.unknownQuote)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /commerce/businesses/:businessId/quotes — the CreateQuoteDto contract
// ---------------------------------------------------------------------------
describe('POST /commerce/businesses/:businessId/quotes (create contract)', () => {
  const invalid: Array<[string, () => Record<string, unknown>, RegExp]> = [
    ['empty items', () => ({ contactId: ID.contactB, items: [] }), /^items must contain at least 1 elements$/],
    ['no items array', () => ({ contactId: ID.contactB }), /^items must be an array$/],
    ['quantity 0', () => ({ contactId: ID.contactB, items: [line({ quantity: 0 })] }), /^items\.0\.quantity must be a positive number$/],
    ['fractional quantity 1.5', () => ({ contactId: ID.contactB, items: [line({ quantity: 1.5 })] }), /^items\.0\.quantity must be an integer number$/],
    ['quantity above int4', () => ({ contactId: ID.contactB, items: [line({ quantity: MAX_QTY + 1 })] }), /^items\.0\.quantity must not be greater than 2147483647$/],
    ['NaN price (serialised as null)', () => ({ contactId: ID.contactB, items: [line({ unitPrice: Number.NaN })] }), /^items\.0\.unitPrice must be a number/],
    ['negative price', () => ({ contactId: ID.contactB, items: [line({ unitPrice: -1 })] }), /^items\.0\.unitPrice must not be less than 0$/],
    ['price above the ledger bound', () => ({ contactId: ID.contactB, items: [line({ unitPrice: MAX_AMOUNT + 1 })] }), /^items\.0\.unitPrice must not be greater than 99999999999999$/],
    ['empty description', () => ({ contactId: ID.contactB, items: [line({ description: '' })] }), /^items\.0\.description should not be empty$/],
    ['missing contactId', () => ({ items: [line()] }), /^contactId should not be empty$/],
    ['non-numeric taxRate', () => ({ contactId: ID.contactB, items: [line()], taxRate: 'abc' }), /^taxRate must be a number/],
    ['unknown discountType', () => ({ contactId: ID.contactB, items: [line()], discountType: 'BOGUS', discountValue: 1 }), /^discountType must be one of the following values: PERCENT, FIXED$/],
    ['malformed expiryDate', () => ({ contactId: ID.contactB, items: [line()], expiryDate: 'not-a-date' }), /^expiryDate must be a valid ISO 8601 date string$/],
    ['4-letter currency', () => ({ contactId: ID.contactB, items: [line()], currency: 'TTDX' }), /^currency must be shorter than or equal to 3 characters$/],
  ];
  for (const [label, body, field] of invalid) {
    it(`QC-400 ${label} -> 400 with the field message; CommerceService.createQuote is never called; no Quote, Invoice or FinancialTransaction`, async () => {
      const spy = vi.spyOn(commerceSvc, 'createQuote');
      try {
        const before = await tenantState(ID.bizB);
        const res = await createOnB(body());
        expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
        expect(messages(res.body).some((m) => field.test(m)), JSON.stringify(res.body.message)).toBe(true);
        expect(spy).not.toHaveBeenCalled();
        expect(await tenantState(ID.bizB)).toBe(before);
        expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
        expect(crmCalls).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  }

  it('QC-TOTALS: subtotal, taxAmount, discountAmount, total and items[].total are computed on the server; the client totals, status, viewToken and invoiceId are dropped', async () => {
    const res = await createOnB({
      contactId: ID.contactB,
      quoteNumber: nextNumber('TOTALS'),
      items: [
        line({ description: 'Two hours', quantity: 2, unitPrice: 10, total: 999 }),
        line({ description: 'Setup', quantity: 1, unitPrice: 5, total: 999 }),
      ],
      taxRate: 10,
      discountType: 'FIXED',
      discountValue: 2,
      subtotal: 1,
      taxAmount: 0,
      discountAmount: 0,
      total: 1,
      status: 'ACCEPTED',
      viewToken: `${P}forged_token`,
      invoiceId: `${P}forged_invoice`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizB, contactId: ID.contactB, status: 'DRAFT', subtotal: 25, taxRate: 10, taxAmount: 2.5, discountAmount: 2, total: 25.5 });
    const row = await quoteRow(res.body.id);
    expect(row).toMatchObject({ status: 'DRAFT', subtotal: 25, tax_amount: 2.5, discount_amount: 2, total: 25.5, view_token: null, invoice_id: null });
    const items: Array<{ total: number }> = await db.$queryRawUnsafe(`SELECT total FROM quote_items WHERE quote_id = $1 ORDER BY total`, res.body.id);
    expect(items.map((i) => i.total)).toEqual([5, 20]);
    expect(recordedEvents.filter((e) => e.name === 'quote.created')).toHaveLength(1);
    expect((await counts(ID.bizB)).transactions).toBe(0);
  });

  it('QC-CONTACT (ST-R004-1, regression control): a foreign, unknown or soft-deleted contactId -> one 404 "Contact not found", byte-identical; no Quote row; nothing of tenant A in the body', async () => {
    const before = await tenantState(ID.bizB);
    const beforeA = await tenantState(ID.bizA);
    const foreign = await createOnB({ contactId: ID.contactA, quoteNumber: nextNumber('C-FOREIGN'), items: [line()] });
    const unknown = await createOnB({ contactId: ID.unknownContact, quoteNumber: nextNumber('C-UNKNOWN'), items: [line()] });
    const gone = await createOnB({ contactId: ID.contactGoneB, quoteNumber: nextNumber('C-GONE'), items: [line()] });
    for (const r of [foreign, unknown, gone]) expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(foreign.body.message).toBe('Contact not found');
    expect(stripVolatile(unknown.body)).toEqual(stripVolatile(foreign.body));
    expect(stripVolatile(gone.body)).toEqual(stripVolatile(foreign.body));
    expectNothingOfTenantA(foreign.body);
    expect(await tenantState(ID.bizB)).toBe(before);
    expect(await tenantState(ID.bizA)).toBe(beforeA);
    expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
  });

  it("QC-PRODUCT: a line naming tenant A's product or an unknown product -> one 404 'Product not found', byte-identical; no Quote row; the own product is the control", async () => {
    const before = await tenantState(ID.bizB);
    const beforeA = await tenantState(ID.bizA);
    const foreign = await createOnB({ contactId: ID.contactB, quoteNumber: nextNumber('P-FOREIGN'), items: [line({ productId: ID.productA })] });
    const unknown = await createOnB({ contactId: ID.contactB, quoteNumber: nextNumber('P-UNKNOWN'), items: [line({ productId: ID.unknownProduct })] });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(foreign.body.message).toBe('Product not found');
    expect(stripVolatile(unknown.body)).toEqual(stripVolatile(foreign.body));
    expect(await tenantState(ID.bizB)).toBe(before);
    expect(await tenantState(ID.bizA)).toBe(beforeA);

    const own = await createOnB({ contactId: ID.contactB, quoteNumber: nextNumber('P-OWN'), items: [line({ productId: ID.productB }), line({ productId: '' })] });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    const rows: Array<{ product_id: string | null }> = await db.$queryRawUnsafe(
      `SELECT product_id FROM quote_items WHERE quote_id = $1 ORDER BY product_id NULLS LAST`,
      own.body.id,
    );
    expect(rows.map((r) => r.product_id)).toEqual([ID.productB, null]);
  });

  it('QC-NUMBER: a quoteNumber already used in the business -> 409 quote_number_taken; one row with that number', async () => {
    const number = nextNumber('DUP');
    const first = await createOnB({ contactId: ID.contactB, quoteNumber: number, items: [line()] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const before = await tenantState(ID.bizB);
    recordedEvents.length = 0;
    const second = await createOnB({ contactId: ID.contactB, quoteNumber: number, items: [line()] });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.code).toBe('quote_number_taken');
    expect(await tenantState(ID.bizB)).toBe(before);
    expect(await db.quote.count({ where: { businessId: ID.bizB, quoteNumber: number } })).toBe(1);
    expect(recordedEvents).toEqual([]);
  });

  it('QC-BOUND: a computed total above the ledger bound (int4 quantity x the largest price) -> 400; no Quote row', async () => {
    const before = await tenantState(ID.bizB);
    const res = await createOnB({ contactId: ID.contactB, quoteNumber: nextNumber('BOUND'), items: [line({ quantity: MAX_QTY, unitPrice: MAX_AMOUNT })] });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe(`Quote amount cannot exceed ${MAX_AMOUNT}`);
    expect(await tenantState(ID.bizB)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// PATCH /commerce/businesses/:businessId/quotes/:quoteId
// ---------------------------------------------------------------------------
describe('PATCH /commerce/businesses/:businessId/quotes/:quoteId (edit errors)', () => {
  it("QE-404: an unknown id, tenant A's quote under B's path, or a deleted quote -> 404 'Quote not found', byte-identical; tenant A's quote unchanged", async () => {
    const quoteA = await seedQuote(ID.bizA, ID.contactA, 'DRAFT');
    const deletedB = await seedQuote(ID.bizB, ID.contactB, 'DRAFT', { deletedAt: new Date() });
    const beforeA = await tenantState(ID.bizA);
    const beforeB = await tenantState(ID.bizB);
    const results = [];
    for (const id of [ID.unknownQuote, quoteA, deletedB]) {
      const res = await patchOnB(id, { notes: `${P}hijacked` });
      expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Quote not found' });
      results.push(stripVolatile(res.body));
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expectNothingOfTenantA(results[1]);
    expect(await tenantState(ID.bizA)).toBe(beforeA);
    expect(await tenantState(ID.bizB)).toBe(beforeB);
    expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
  });

  const invalidEdits: Array<[string, Record<string, unknown>, RegExp]> = [
    ['NaN price (serialised as null)', { items: [line({ unitPrice: Number.NaN })] }, /^items\.0\.unitPrice must be a number/],
    ['empty items', { items: [] }, /^items must contain at least 1 elements$/],
    ['quantity 0', { items: [line({ quantity: 0 })] }, /^items\.0\.quantity must be a positive number$/],
    ['non-numeric taxRate', { taxRate: 'abc' }, /^taxRate must be a number/],
    ['malformed expiryDate', { expiryDate: 'not-a-date' }, /^expiryDate must be a valid ISO 8601 date string$/],
  ];
  for (const [label, body, field] of invalidEdits) {
    it(`QE-400 ${label} -> 400 with the field message; the quote and its lines are byte-identical; updateQuote is never called`, async () => {
      const quoteId = await seedQuote(ID.bizB, ID.contactB, 'DRAFT');
      const before = await quoteState(quoteId);
      const spy = vi.spyOn(commerceSvc, 'updateQuote');
      try {
        const res = await patchOnB(quoteId, body);
        expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
        expect(messages(res.body).some((m) => field.test(m)), JSON.stringify(res.body.message)).toBe(true);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      expect(await quoteState(quoteId)).toBe(before);
      expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
    });
  }

  it("QE-CONTACT (ST-R004-1, regression control): re-pointing a B quote at A's contact -> 404, byte-identical to an unknown contact; the quote row and its lines are byte-identical", async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'DRAFT');
    const before = await quoteState(quoteId);
    const body = { items: [line({ description: 'V53A replaced', quantity: 9, unitPrice: 9 })], notes: `${P}changed` };
    const foreign = await patchOnB(quoteId, { ...body, contactId: ID.contactA });
    const unknown = await patchOnB(quoteId, { ...body, contactId: ID.unknownContact });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(foreign.body.message).toBe('Contact not found');
    expect(stripVolatile(unknown.body)).toEqual(stripVolatile(foreign.body));
    expectNothingOfTenantA(foreign.body);
    expect(await quoteState(quoteId)).toBe(before);
    expect(recordedEvents.filter((e) => e.name.startsWith('quote.'))).toEqual([]);
  });

  it("QE-PRODUCT: a replacement line naming tenant A's product -> 404 'Product not found'; the quote and its lines are byte-identical", async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'DRAFT');
    const before = await quoteState(quoteId);
    const res = await patchOnB(quoteId, { items: [line({ productId: ID.productA })] });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.message).toBe('Product not found');
    expect(await quoteState(quoteId)).toBe(before);
  });

  it('QE-409 (V1-51, regression control): editing a converted quote -> 409 quote_converted; nothing written', async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'ACCEPTED');
    const converted = await convertOnB(quoteId);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const before = await tenantState(ID.bizB);
    const res = await patchOnB(quoteId, { notes: `${P}too late` });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('quote_converted');
    expect(await tenantState(ID.bizB)).toBe(before);
  });

  it('QE-OK (control): a valid edit of a DRAFT answers 200 with server-computed totals', async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'DRAFT');
    const res = await patchOnB(quoteId, { items: [line({ quantity: 3, unitPrice: 10, total: 1 })], taxRate: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: quoteId, subtotal: 30, taxAmount: 3, total: 33 });
    const items: Array<{ total: number }> = await db.$queryRawUnsafe(`SELECT total FROM quote_items WHERE quote_id = $1`, quoteId);
    expect(items.map((i) => i.total)).toEqual([30]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /commerce/businesses/:businessId/quotes/:quoteId
// ---------------------------------------------------------------------------
describe('DELETE /commerce/businesses/:businessId/quotes/:quoteId (delete errors)', () => {
  it("QD-404: an unknown id, tenant A's quote under B's path, or an already deleted quote -> 404 'Quote not found', byte-identical; nothing deleted", async () => {
    const quoteA = await seedQuote(ID.bizA, ID.contactA, 'DRAFT');
    const deletedB = await seedQuote(ID.bizB, ID.contactB, 'DRAFT', { deletedAt: new Date('2026-10-01T00:00:00.000Z') });
    const beforeA = await tenantState(ID.bizA);
    const beforeB = await tenantState(ID.bizB);
    const results = [];
    for (const id of [ID.unknownQuote, quoteA, deletedB]) {
      const res = await deleteOnB(id);
      expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Quote not found' });
      results.push(stripVolatile(res.body));
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await tenantState(ID.bizA)).toBe(beforeA);
    expect(await tenantState(ID.bizB)).toBe(beforeB);
    expect(recordedEvents.filter((e) => e.name === 'quote.deleted')).toEqual([]);
  });

  it('QD-409: deleting a converted quote -> 409 quote_converted with the existing message; the quote and its invoice stay', async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'ACCEPTED');
    const converted = await convertOnB(quoteId);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const before = await tenantState(ID.bizB);
    recordedEvents.length = 0;
    const res = await deleteOnB(quoteId);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, code: 'quote_converted', message: 'Cannot delete a quote that has been converted to an invoice' });
    expect(await tenantState(ID.bizB)).toBe(before);
    expect((await quoteRow(quoteId)).deleted_at).toBeNull();
    expect(recordedEvents).toEqual([]);
  });

  it('QD-OK (control): deleting an own DRAFT answers 200 and soft-deletes it', async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'DRAFT');
    const res = await deleteOnB(quoteId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await quoteRow(quoteId)).deleted_at).not.toBeNull();
    expect(recordedEvents.filter((e) => e.name === 'quote.deleted')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /commerce/businesses/:businessId/quotes/:quoteId/convert
// ---------------------------------------------------------------------------
describe('POST /commerce/businesses/:businessId/quotes/:quoteId/convert (convert errors)', () => {
  it("QV-404: an unknown id, tenant A's ACCEPTED quote under B's path, or a deleted ACCEPTED quote -> 404 'Quote not found', byte-identical; no Invoice, no FinancialTransaction", async () => {
    const quoteA = await seedQuote(ID.bizA, ID.contactA, 'ACCEPTED');
    const deletedB = await seedQuote(ID.bizB, ID.contactB, 'ACCEPTED', { deletedAt: new Date() });
    const beforeA = await tenantState(ID.bizA);
    const beforeB = await tenantState(ID.bizB);
    const results = [];
    for (const id of [ID.unknownQuote, quoteA, deletedB]) {
      const res = await convertOnB(id);
      expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Quote not found' });
      results.push(stripVolatile(res.body));
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expectNothingOfTenantA(results[1]);
    expect(await tenantState(ID.bizA)).toBe(beforeA);
    expect(await tenantState(ID.bizB)).toBe(beforeB);
    expect(recordedEvents.filter((e) => e.name === 'invoice.created' || e.name === 'quote.converted')).toEqual([]);
  });

  for (const status of ['DRAFT', 'SENT', 'REJECTED'] as const) {
    it(`QV-409 a ${status} quote -> 409 quote_not_accepted with the existing message; no Invoice, Quote change or FinancialTransaction`, async () => {
      const quoteId = await seedQuote(ID.bizB, ID.contactB, status);
      const before = await tenantState(ID.bizB);
      const res = await convertOnB(quoteId);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body).toMatchObject({ statusCode: 409, code: 'quote_not_accepted', message: 'Only accepted quotes can be converted to invoices' });
      expect(await tenantState(ID.bizB)).toBe(before);
      expect(recordedEvents.filter((e) => e.name === 'invoice.created' || e.name === 'quote.converted')).toEqual([]);
    });
  }

  it('QV-409 (V1-51, regression control): converting a converted quote again -> 409 quote_converted; still one invoice', async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'ACCEPTED');
    const first = await convertOnB(quoteId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const before = await tenantState(ID.bizB);
    const again = await convertOnB(quoteId);
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.code).toBe('quote_converted');
    expect(await tenantState(ID.bizB)).toBe(before);
  });

  it('QV-RACE (V1-51, regression control): four parallel converts of one ACCEPTED quote -> one 201 and three 409 quote_converted; exactly one invoice, linked both ways; nothing posted', async () => {
    const quoteId = await seedQuote(ID.bizB, ID.contactB, 'ACCEPTED');
    const results = await Promise.all([1, 2, 3, 4].map(() => convertOnB(quoteId)));
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409, 409, 409]);
    for (const loser of results.filter((r) => r.status === 409)) expect(loser.body.code).toBe('quote_converted');
    const winner = results.find((r) => r.status === 201)!;
    const invoices: Array<{ id: string }> = await db.$queryRawUnsafe(`SELECT id FROM invoices WHERE quote_id = $1`, quoteId);
    expect(invoices.map((i) => i.id)).toEqual([winner.body.id]);
    expect((await quoteRow(quoteId)).invoice_id).toBe(winner.body.id);
    expect(winner.body).toMatchObject({ status: 'DRAFT', total: 20, quoteId });
    const tx: Array<{ n: number }> = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM financial_transactions WHERE source_id = $1`, winner.body.id);
    expect(tx[0].n).toBe(0);
  });

  const invalidBodies: Array<[string, Record<string, unknown>, RegExp]> = [
    ['non-numeric taxRate', { taxRate: 'abc' }, /^taxRate must be a number/],
    ['malformed dueDate', { dueDate: 'not-a-date' }, /^dueDate must be a valid ISO 8601 date string$/],
    ['unknown discountType', { discountType: 'BOGUS', discountValue: 1 }, /^discountType must be one of the following values: PERCENT, FIXED$/],
    ['non-string notes', { notes: 123 }, /^notes must be a string$/],
  ];
  for (const [label, body, field] of invalidBodies) {
    it(`QV-400 ${label} -> 400 with the field message; convertQuoteToInvoice is never called; no Invoice, no FinancialTransaction`, async () => {
      const quoteId = await seedQuote(ID.bizB, ID.contactB, 'ACCEPTED');
      const before = await tenantState(ID.bizB);
      const spy = vi.spyOn(commerceSvc, 'convertQuoteToInvoice');
      try {
        const res = await convertOnB(quoteId, body);
        expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
        expect(messages(res.body).some((m) => field.test(m)), JSON.stringify(res.body.message)).toBe(true);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      expect(await tenantState(ID.bizB)).toBe(before);
    });
  }
});

// ---------------------------------------------------------------------------
// POST .../quotes/:quoteId/send-email and the operator read
// ---------------------------------------------------------------------------
describe('send-email and the operator read', () => {
  it("QS-404: send-email for an unknown id or tenant A's quote under B's path -> 404 'Quote not found', byte-identical; Gmail is never called", async () => {
    const quoteA = await seedQuote(ID.bizA, ID.contactA, 'DRAFT');
    const beforeA = await tenantState(ID.bizA);
    const results = [];
    for (const id of [ID.unknownQuote, quoteA]) {
      const res = await as(ID.ownerB, agent().post(routes.sendEmail(ID.bizB, id))).send({ recipientEmail: `${P}to@test.local` });
      expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Quote not found' });
      results.push(stripVolatile(res.body));
    }
    expect(results[1]).toEqual(results[0]);
    expect(gmailCalls).toEqual([]);
    expect(await tenantState(ID.bizA)).toBe(beforeA);
  });

  it("QR-LEGACY (ST-R004-1, regression control): the operator detail of a B quote stored with A's contact serves contact null, nothing of A", async () => {
    const legacy = await seedQuote(ID.bizB, ID.contactA, 'DRAFT');
    const res = await as(ID.ownerB, agent().get(routes.one(ID.bizB, legacy)));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contact).toBeNull();
    expectNothingOfTenantA({ ...res.body, contactId: undefined });
  });
});
