/**
 * V1-51-QUOTE-CONVERSION-JOURNEY — the quote branch of Release 0, end to end
 * (REAL database).
 *
 * M20 (IV-P08: the customer-visible document matches the persisted invoice
 * and amount). At this packet's base (pkt/V1-50 head 7f75ebcd; the packet text
 * cites 87ca2b90 lines 1274-1325, here commerce.service.ts:2129-2245)
 * convertQuoteToInvoice priced the invoice from the request body only:
 *
 *   const taxRate = input.taxRate ?? 0;            // the quote's taxRate ignored
 *   discount only when the body names one          // the quote's discount ignored
 *
 * so converting an accepted 100 + 12.5% quote (112.50) with an empty body (the
 * KEY tool commerce_convert_quote and any API caller) wrote an invoice of
 * 100.00: the customer accepted one amount and was invoiced another. A second
 * convert threw a plain Error (500).
 *
 * Contract pinned here:
 *
 *   QJ-01..04  create 100 @ 12.5% -> send -> public accept by token -> convert {} ->
 *              invoice 112.50 (subtotal 100, taxRate 12.5, taxAmount 12.5), items identical,
 *              quote.invoiceId set; a second public accept -> 400, a second convert -> 409
 *              quote_converted; still one invoice
 *   QJ-05      explicit taxRate 0 is honoured (invoice 100.00)
 *   QJ-06/07   the quote's PERCENT and FIXED discounts are carried
 *   QJ-08      a body discount overrides the quote's discount, the quote's tax still carried;
 *              discountValue 0 clears it
 *   QJ-09      D-13: a sub-cent quote (3 x 33.33 @ 12.5%) converts in integer cents (112.49)
 *   QJ-10      two concurrent converts of one quote -> one 201, one 409, one invoice
 *   LEDGER     ACCRUAL: issuing posts AR = 112.50; CASH: issuing posts nothing. A manual payment
 *              of 112.50 makes it PAID; every transaction balances; the deposit-side ledger net
 *              equals computeBalance.paid (= 112.50); ACCRUAL AR nets to zero
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (on this suite's Redis index),
 * CommerceService, InvoiceWorkflowService and the real ledger chain
 * (RevenuePostingService, PostingService, ChartOfAccountsSeederService) run
 * against DATABASE_URL behind the production GlobalHttpExceptionFilter and
 * ValidationPipe, with the app's TenantInterceptor. Identity attachment is the
 * one stand-in: a test middleware reads `x-v51a-user`, loads that seeded user
 * row and attaches `{ id, email, role }` as AuthMiddleware would.
 * Collaborators off the boundary (event bus, contact timeline, stats cache,
 * Gmail / AI / Drive) are recorders or stubs.
 *
 * Fixtures: prefix `v51a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Every quote is created through the HTTP route; the
 * journey cases of a tenant run in order on that tenant's quote.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v51a_';
const HEADER = 'x-v51a-user';

const ID = {
  ownerAcc: `${P}ownerAcc`,
  ownerCash: `${P}ownerCash`,
  bizAcc: `${P}bizAcc`,
  bizCash: `${P}bizCash`,
  contactAcc: `${P}contactAcc`,
  contactCash: `${P}contactCash`,
};

const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let previousNamespace: string | undefined;
let computeBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

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

const crmRecorder = {
  logContactEvent: async () => ({ id: `${P}evt` }),
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

const money = (n: number) => Math.round(n * 100) / 100;

type Line = { description: string; quantity: number; unitPrice: number };
type QuoteBody = { taxRate?: number; discountType?: 'PERCENT' | 'FIXED'; discountValue?: number; items?: Line[] };

let quoteSeq = 0;

/** POST /commerce/businesses/:biz/quotes as the tenant's owner; the quote number embeds the prefix. */
async function createQuote(owner: string, businessId: string, contactId: string, body: QuoteBody) {
  quoteSeq += 1;
  const res = await agent()
    .post(`/commerce/businesses/${businessId}/quotes`)
    .set(HEADER, owner)
    .send({
      contactId,
      quoteNumber: `${P}Q-${String(quoteSeq).padStart(3, '0')}`,
      items: body.items ?? [{ description: `V51A line ${quoteSeq}`, quantity: 1, unitPrice: 100 }],
      ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
      ...(body.discountType !== undefined ? { discountType: body.discountType } : {}),
      ...(body.discountValue !== undefined ? { discountValue: body.discountValue } : {}),
    });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body as { id: string; total: number; status: string };
}

/** The status route as the web client calls it: lower-case status in the path, `{ businessId }` in the body. */
function setQuoteStatus(owner: string, businessId: string, quoteId: string, status: string) {
  return agent().patch(`/commerce/quotes/${quoteId}/status/${status}`).set(HEADER, owner).send({ businessId });
}

function publicAccept(token: string) {
  return agent().post(`/commerce/public/quotes/${token}/accept`).send({});
}

function convert(owner: string, businessId: string, quoteId: string, body: Record<string, unknown> = {}) {
  return agent().post(`/commerce/businesses/${businessId}/quotes/${quoteId}/convert`).set(HEADER, owner).send(body);
}

/** Owner sends the quote (one viewToken minted), the customer accepts it through the signed link. */
async function sendAndAccept(owner: string, businessId: string, quoteId: string): Promise<string> {
  const sent = await setQuoteStatus(owner, businessId, quoteId, 'sent');
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const token = (await quoteRow(quoteId)).viewToken;
  expect(typeof token).toBe('string');
  const accepted = await publicAccept(token);
  expect([200, 201], JSON.stringify(accepted.body)).toContain(accepted.status);
  expect(accepted.body).toMatchObject({ id: quoteId, status: 'ACCEPTED' });
  return token;
}

/** A quote ready to convert: created, sent and accepted publicly. */
async function acceptedQuote(owner: string, businessId: string, contactId: string, body: QuoteBody) {
  const quote = await createQuote(owner, businessId, contactId, body);
  const token = await sendAndAccept(owner, businessId, quote.id);
  return { quote, token };
}

/** The quote row read raw (the soft-delete extension hides deleted rows). */
async function quoteRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, view_token AS "viewToken", invoice_id AS "invoiceId", subtotal, tax_rate AS "taxRate",
            tax_amount AS "taxAmount", discount_type AS "discountType", discount_value AS "discountValue",
            discount_amount AS "discountAmount", total, currency
       FROM quotes WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function invoiceRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, business_id AS "businessId", contact_id AS "contactId", quote_id AS "quoteId",
            subtotal, tax_rate AS "taxRate", tax_amount AS "taxAmount", discount_type AS "discountType",
            discount_value AS "discountValue", discount_amount AS "discountAmount", total, currency, paid_at AS "paidAt"
       FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function invoicesOfQuote(quoteId: string): Promise<any[]> {
  return db.$queryRawUnsafe(`SELECT id FROM invoices WHERE quote_id = $1`, quoteId);
}

async function itemsOf(table: 'quote_items' | 'invoice_items', column: 'quote_id' | 'invoice_id', id: string) {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT description, quantity, unit_price AS "unitPrice", total, product_id AS "productId"
       FROM ${table} WHERE ${column} = $1 ORDER BY description`,
    id,
  );
  return rows.map((r) => ({ ...r, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), total: Number(r.total) }));
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.$queryRawUnsafe(`SELECT id, status::text AS status, amount FROM payments WHERE invoice_id = $1`, invoiceId);
}

/** Every FinancialTransaction the invoice or its payments sourced, with entries and account system keys. */
async function ledgerOf(invoiceId: string, businessId: string) {
  const payments = await paymentsOf(invoiceId);
  return db.financialTransaction.findMany({
    where: {
      businessId,
      OR: [
        { sourceType: 'Invoice', sourceId: invoiceId },
        ...(payments.length ? [{ sourceType: 'Payment', sourceId: { in: payments.map((p: any) => p.id) } }] : []),
      ],
    },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
}

const sumOf = (entries: any[], side: 'debit' | 'credit') => money(entries.reduce((s, e) => s + Number(e[side] ?? 0), 0));

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
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceWorkflowService } = workflowMod;
  computeBalanceFn = workflowMod.computeBalance as typeof computeBalanceFn;
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

  // This suite's public rate-limit windows live under its own prefix (R0-00).
  previousNamespace = process.env.RATE_LIMIT_KEY_NAMESPACE;
  process.env.RATE_LIMIT_KEY_NAMESPACE = P;
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
      // Real ledger chain: issue and payment postings are real rows.
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
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.ownerAcc, ID.ownerCash]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizAcc, name: 'V51A Accrual Biz', ownerId: ID.ownerAcc, currency: 'TTD', accountingBasis: 'ACCRUAL' } });
  await db.business.create({ data: { id: ID.bizCash, name: 'V51A Cash Biz', ownerId: ID.ownerCash, currency: 'TTD', accountingBasis: 'CASH' } });
  for (const biz of [ID.bizAcc, ID.bizCash]) await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  await db.membership.create({ data: { id: `${P}m_ownerAcc`, userId: ID.ownerAcc, businessId: ID.bizAcc, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerCash`, userId: ID.ownerCash, businessId: ID.bizCash, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactAcc, businessId: ID.bizAcc, firstName: 'V51a', lastName: 'Accrual', email: `${P}contactAcc@test.local` } });
  await db.contact.create({ data: { id: ID.contactCash, businessId: ID.bizCash, firstName: 'V51a', lastName: 'Cash', email: `${P}contactCash@test.local` } });
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
});

describe('fixture sanity (real rows)', () => {
  it('two tenants (ACCRUAL and CASH) with an owner each and a system chart of accounts', async () => {
    expect((await db.business.findUnique({ where: { id: ID.bizAcc } })).accountingBasis).toBe('ACCRUAL');
    expect((await db.business.findUnique({ where: { id: ID.bizCash } })).accountingBasis).toBe('CASH');
    for (const biz of [ID.bizAcc, ID.bizCash]) {
      expect(await db.membership.count({ where: { businessId: biz } })).toBe(1);
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } })).toBeGreaterThan(0);
      expect(await db.financialTransaction.count({ where: { businessId: biz } })).toBe(0);
    }
  });
});

/**
 * One journey per accounting basis, in order: create, send, accept, convert,
 * repeat accept/convert, issue, pay. `S[basis]` carries the ids forward.
 */
const JOURNEYS = [
  { basis: 'ACCRUAL' as const, owner: ID.ownerAcc, biz: ID.bizAcc, contact: ID.contactAcc },
  { basis: 'CASH' as const, owner: ID.ownerCash, biz: ID.bizCash, contact: ID.contactCash },
];
const S: Record<string, { quoteId?: string; token?: string; invoiceId?: string }> = { ACCRUAL: {}, CASH: {} };

for (const J of JOURNEYS) {
  describe(`quote journey on a ${J.basis} tenant (V1-51)`, () => {
    it(`QJ-01 ${J.basis}: the owner creates 100 @ 12.5% (accepted total 112.50), sends it, and the customer accepts it through the signed link`, async () => {
      const quote = await createQuote(J.owner, J.biz, J.contact, { taxRate: 12.5 });
      expect(quote.status).toBe('DRAFT');
      expect(Number(quote.total)).toBe(112.5);
      S[J.basis].quoteId = quote.id;
      S[J.basis].token = await sendAndAccept(J.owner, J.biz, quote.id);
      const row = await quoteRow(quote.id);
      expect(row).toMatchObject({ status: 'ACCEPTED', invoiceId: null });
      expect([Number(row.subtotal), Number(row.taxRate), Number(row.taxAmount), Number(row.total)]).toEqual([100, 12.5, 12.5, 112.5]);
    });

    it(`QJ-02 ${J.basis}: convert with an empty body -> one DRAFT invoice of 112.50 (the accepted total, M20), items identical, quote.invoiceId set`, async () => {
      const quoteId = S[J.basis].quoteId!;
      expect(quoteId).toBeTruthy();
      const res = await convert(J.owner, J.biz, quoteId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ businessId: J.biz, contactId: J.contact, quoteId, status: 'DRAFT' });
      S[J.basis].invoiceId = res.body.id;

      const accepted = await quoteRow(quoteId);
      const invoice = await invoiceRow(res.body.id);
      expect(Number(invoice.total), 'invoice total = the total the customer accepted').toBe(Number(accepted.total));
      expect(Number(invoice.total)).toBe(112.5);
      expect(Number(invoice.subtotal)).toBe(100);
      expect(Number(invoice.taxRate)).toBe(12.5);
      expect(Number(invoice.taxAmount)).toBe(12.5);
      expect(Number(invoice.discountAmount ?? 0)).toBe(0);
      expect(Number(res.body.total)).toBe(112.5);
      expect(invoice.currency).toBe(accepted.currency);
      expect(await itemsOf('invoice_items', 'invoice_id', res.body.id)).toEqual(await itemsOf('quote_items', 'quote_id', quoteId));
      expect(accepted.invoiceId).toBe(res.body.id);
      expect(accepted.status).toBe('ACCEPTED');
      expect(recordedEvents.map((e) => e.name)).toEqual(['quote.converted', 'invoice.created']);
    });

    it(`QJ-03 ${J.basis}: a second public accept answers 400 and changes nothing`, async () => {
      const before = await quoteRow(S[J.basis].quoteId!);
      const again = await publicAccept(S[J.basis].token!);
      expect(again.status, JSON.stringify(again.body)).toBe(400);
      expect(await quoteRow(S[J.basis].quoteId!)).toEqual(before);
    });

    it(`QJ-04 ${J.basis}: a second convert answers 409 quote_converted; still one invoice, the first unchanged, no event`, async () => {
      const quoteId = S[J.basis].quoteId!;
      const invoiceBefore = await invoiceRow(S[J.basis].invoiceId!);
      const again = await convert(J.owner, J.biz, quoteId);
      expect(again.status, JSON.stringify(again.body)).toBe(409);
      expect(again.body.code).toBe('quote_converted');
      expect(await invoicesOfQuote(quoteId)).toHaveLength(1);
      expect(await invoiceRow(S[J.basis].invoiceId!)).toEqual(invoiceBefore);
      expect((await quoteRow(quoteId)).invoiceId).toBe(S[J.basis].invoiceId);
      expect(recordedEvents).toEqual([]);
    });

    it(`LEDGER-1 ${J.basis}: issuing the converted invoice posts ${J.basis === 'ACCRUAL' ? 'AR = 112.50 (Dr AR / Cr revenue, balanced)' : 'nothing (cash basis recognises on payment)'}`, async () => {
      const invoiceId = S[J.basis].invoiceId!;
      expect(invoiceId).toBeTruthy();
      const res = await agent()
        .patch(`/commerce/invoices/${invoiceId}/status/sent`)
        .set(HEADER, J.owner)
        .send({ businessId: J.biz, status: 'SENT' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await invoiceRow(invoiceId)).status).toBe('SENT');

      const txns = await db.financialTransaction.findMany({
        where: { businessId: J.biz, sourceType: 'Invoice', sourceId: invoiceId },
        include: { entries: { include: { account: { select: { systemKey: true } } } } },
      });
      if (J.basis === 'ACCRUAL') {
        expect(txns).toHaveLength(1);
        const entries = txns[0].entries;
        expect(sumOf(entries, 'debit')).toBe(112.5);
        expect(sumOf(entries, 'credit')).toBe(112.5);
        const ar = entries.filter((e: any) => e.account?.systemKey === 'ACCOUNTS_RECEIVABLE');
        expect(sumOf(ar, 'debit') - sumOf(ar, 'credit'), 'AR posted on issue').toBe(112.5);
      } else {
        expect(txns).toHaveLength(0);
      }
    });

    it(`LEDGER-2 ${J.basis}: a manual payment of 112.50 makes it PAID; every transaction balances; deposit-side ledger net = computeBalance.paid = 112.50${J.basis === 'ACCRUAL' ? '; AR nets to zero' : ''}`, async () => {
      const invoiceId = S[J.basis].invoiceId!;
      const res = await agent()
        .post(`/commerce/businesses/${J.biz}/invoices/${invoiceId}/payments`)
        .set(HEADER, J.owner)
        .send({ amount: 112.5, method: 'cash', reference: `${P}ref_${J.basis}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.invoice.status).toBe('PAID');
      expect(Number(res.body.remaining)).toBe(0);

      const invoice = await invoiceRow(invoiceId);
      expect(invoice.status).toBe('PAID');
      expect(invoice.paidAt).not.toBeNull();

      const payments = await paymentsOf(invoiceId);
      const balance = computeBalanceFn(
        Number(invoice.total),
        payments.map((p: any) => ({ amount: Number(p.amount), status: p.status })),
        invoice.currency,
      );
      // Paid exactly: the invoice is the accepted 112.50, so 112.50 settles it with no overpayment.
      expect(Number(invoice.total)).toBe(112.5);
      expect(balance).toMatchObject({ total: 112.5, paid: 112.5, remaining: 0, isFullyPaid: true, isOverpaid: false });

      const txns = await ledgerOf(invoiceId, J.biz);
      expect(txns.length).toBe(J.basis === 'ACCRUAL' ? 2 : 1);
      for (const t of txns) {
        expect(sumOf(t.entries, 'debit'), `${t.externalRef}: debits = credits`).toBe(sumOf(t.entries, 'credit'));
      }
      const entries = txns.flatMap((t: any) => t.entries);
      const deposit = entries.filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey));
      expect(money(sumOf(deposit, 'debit') - sumOf(deposit, 'credit')), 'deposit-side ledger net = computeBalance.paid').toBe(balance.paid);
      if (J.basis === 'ACCRUAL') {
        const ar = entries.filter((e: any) => e.account?.systemKey === 'ACCOUNTS_RECEIVABLE');
        expect(money(sumOf(ar, 'debit') - sumOf(ar, 'credit')), 'AR nets to zero once paid').toBe(0);
      }
    });
  });
}

describe('conversion carries the accepted quote, overrides are honoured (V1-51)', () => {
  it('QJ-05: an explicit taxRate 0 is honoured: invoice 100.00 with no tax', async () => {
    const { quote } = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, { taxRate: 12.5 });
    const res = await convert(ID.ownerCash, ID.bizCash, quote.id, { taxRate: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invoice = await invoiceRow(res.body.id);
    expect([Number(invoice.subtotal), Number(invoice.taxRate), Number(invoice.taxAmount), Number(invoice.total)]).toEqual([100, 0, 0, 100]);
  });

  it('QJ-06: the quote\'s PERCENT discount is carried (200 @ 12.5% less 10% = 205.00)', async () => {
    const { quote } = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, {
      taxRate: 12.5,
      discountType: 'PERCENT',
      discountValue: 10,
      items: [{ description: 'V51A pct line', quantity: 2, unitPrice: 100 }],
    });
    expect(Number(quote.total)).toBe(205);
    const res = await convert(ID.ownerCash, ID.bizCash, quote.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invoice = await invoiceRow(res.body.id);
    expect(invoice).toMatchObject({ discountType: 'PERCENT' });
    expect([Number(invoice.subtotal), Number(invoice.taxAmount), Number(invoice.discountValue), Number(invoice.discountAmount), Number(invoice.total)])
      .toEqual([200, 25, 10, 20, 205]);
  });

  it('QJ-07: the quote\'s FIXED discount is carried (200 @ 0% less 15 = 185.00)', async () => {
    const { quote } = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, {
      taxRate: 0,
      discountType: 'FIXED',
      discountValue: 15,
      items: [{ description: 'V51A fixed line', quantity: 1, unitPrice: 200 }],
    });
    expect(Number(quote.total)).toBe(185);
    const res = await convert(ID.ownerCash, ID.bizCash, quote.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invoice = await invoiceRow(res.body.id);
    expect(invoice).toMatchObject({ discountType: 'FIXED' });
    expect([Number(invoice.discountValue), Number(invoice.discountAmount), Number(invoice.total)]).toEqual([15, 15, 185]);
  });

  it('QJ-08: a body discount replaces the quote\'s discount while the quote\'s tax is still carried; discountValue 0 clears it', async () => {
    const body: QuoteBody = { taxRate: 12.5, discountType: 'PERCENT', discountValue: 10, items: [{ description: 'V51A override line', quantity: 2, unitPrice: 100 }] };
    const first = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, body);
    const fixed = await convert(ID.ownerCash, ID.bizCash, first.quote.id, { discountType: 'FIXED', discountValue: 5 });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(201);
    const a = await invoiceRow(fixed.body.id);
    expect([Number(a.taxAmount), Number(a.discountAmount), Number(a.total)]).toEqual([25, 5, 220]);

    const second = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, body);
    const cleared = await convert(ID.ownerCash, ID.bizCash, second.quote.id, { discountValue: 0 });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(201);
    const b = await invoiceRow(cleared.body.id);
    expect([Number(b.taxAmount), Number(b.discountAmount ?? 0), Number(b.total)]).toEqual([25, 0, 225]);
  });

  it('QJ-09 (D-13): a sub-cent quote (3 x 33.33 @ 12.5%) converts in integer cents: 99.99 + 12.50 = 112.49, the accepted total to the cent', async () => {
    const { quote } = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, {
      taxRate: 12.5,
      items: [{ description: 'V51A cents line', quantity: 3, unitPrice: 33.33 }],
    });
    const res = await convert(ID.ownerCash, ID.bizCash, quote.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invoice = await invoiceRow(res.body.id);
    expect([Number(invoice.subtotal), Number(invoice.taxAmount), Number(invoice.total)]).toEqual([99.99, 12.5, 112.49]);
    expect(Number(invoice.total)).toBe(money(Number((await quoteRow(quote.id)).total)));
  });

  it('QJ-10: two concurrent converts of one accepted quote -> one 201 and one 409 quote_converted; exactly one invoice, linked both ways', async () => {
    const { quote } = await acceptedQuote(ID.ownerCash, ID.bizCash, ID.contactCash, { taxRate: 12.5 });
    const results = await Promise.all([convert(ID.ownerCash, ID.bizCash, quote.id), convert(ID.ownerCash, ID.bizCash, quote.id)]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.code).toBe('quote_converted');
    const winner = results.find((r) => r.status === 201)!;
    const invoices = await invoicesOfQuote(quote.id);
    expect(invoices.map((i: any) => i.id)).toEqual([winner.body.id]);
    expect((await quoteRow(quote.id)).invoiceId).toBe(winner.body.id);
    expect(Number((await invoiceRow(winner.body.id)).total)).toBe(112.5);
  });
});
