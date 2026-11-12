/**
 * V1-82 (FOLLOW3-B3-ACCRUAL-SPLIT-DISCOUNT) — accrual recognition of an
 * invoice whose lines span revenue categories apportions a document discount
 * across those categories, so no credit leg goes negative (REAL database, REAL
 * ledger posting, REAL invoice workflow).
 *
 * At bb6b86d4 RevenuePostingService.resolveRevenueSplits bucketed the line
 * totals by Product.category and put the whole drift (total - sum of lines) on
 * the largest split. A document discount is a negative drift, so a discount
 * larger than the largest split made that split's credit negative. Issuing the
 * invoice (onInvoiceFinalized, inside the transition transaction) then failed
 * validatePosting with 400 'Entry 1: debit/credit must be non-negative': the
 * send rolled back and the invoice stayed DRAFT. A caller reaches it with
 * product lines of two categories through PATCH invoice items or quote convert.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the base):
 *
 *   RS-01 RED-BEFORE invoice PATCH path: svc 10 + goods 10, PERCENT 60 (total 8) -> send 200 SENT; one
 *                    invoice_finalized posting: AR Dr 8.00, REVENUE_SERVICE Cr 4.00, REVENUE_PRODUCT Cr 4.00
 *   RS-02 RED-BEFORE quote convert path: the same lines and discount on a quote, accepted, converted {}, sent
 *   RS-03 RED-BEFORE uneven: svc 10 + goods 5, FIXED 12 (total 3.00) -> credits 2.00 / 1.00
 *   RS-04 RED-BEFORE cent remainder: svc 1 + goods 1 + package 1, FIXED 2 (total 1.00) -> 0.34 / 0.33 / 0.33
 *                    (the leftover cent goes to the largest remainder, ties broken by split order)
 *   RS-05 controls:  one category at PERCENT 60 -> one credit equal to the total; two categories with no
 *                    discount -> 120 / 80; two categories at 10% tax (svc 100, goods 50, total 165) -> the
 *                    positive drift stays on the largest split as before (svc 115, goods 50)
 *   RS-06 RED-BEFORE voiding the RS-01 invoice reverses every leg (AR 0, each revenue account 0)
 *   Every case: each leg is >= 0 with exactly one side set, and the credits sum to the total in integer cents.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed: the plan allows
 * invoices and quotes), CommerceController, CommerceService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService and
 * ChartOfAccountsSeederService write real rows behind the production
 * GlobalHttpExceptionFilter, ValidationPipe and TenantInterceptor. Identity
 * attachment is the one stand-in: a test middleware reads `x-v82c-user`,
 * loads that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. The event bus, contact timeline,
 * TimelineService, stats cache and the AI / Gmail / Drive services are stubs
 * off the boundary; ExpensePostingService (COGS on PAID) is a no-op stub (no
 * invoice here is paid).
 *
 * Fixtures: prefix `v82c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in
 * beforeAll and afterAll; no $transaction wrapping. Rows the server creates get
 * server ids under the prefixed business and are deleted through it.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82c_';
const HEADER = 'x-v82c-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  svc: `${P}prod_svc`,
  goods: `${P}prod_goods`,
  pkg: `${P}prod_pkg`,
};

let db: any;
let app: any;
let redis: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `UPDATE quotes SET invoice_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
function as(req: request.Test) {
  return req.set(HEADER, ID.owner);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

type Line = { description: string; quantity: number; unitPrice: number; productId?: string };
type Terms = { discountType?: 'PERCENT' | 'FIXED'; discountValue?: number; taxRate?: number };

const svc = (unitPrice: number, n = 1): Line => ({ description: `V82C service ${n}`, quantity: 1, unitPrice, productId: ID.svc });
const goods = (unitPrice: number): Line => ({ description: 'V82C goods', quantity: 1, unitPrice, productId: ID.goods });
const pkg = (unitPrice: number): Line => ({ description: 'V82C package', quantity: 1, unitPrice, productId: ID.pkg });

/**
 * The invoice PATCH path (commerce.service.ts updateInvoice): a DRAFT invoice
 * is created with a plain line (create does not carry productId), then its
 * lines are replaced with product lines and the document terms. Invoice
 * numbers default to INV-<ms>, unique per tenant (V1-43): space the creates.
 */
async function draftWithLines(items: Line[], terms: Terms) {
  await sleep(3);
  const created = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices`)).send({
    contactId: ID.contact,
    items: [{ description: 'V82C placeholder', quantity: 1, unitPrice: 1 }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.status).toBe('DRAFT');
  const patched = await as(agent().patch(`/commerce/businesses/${ID.biz}/invoices/${created.body.id}`)).send({ items, ...terms });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  expect(patched.body.status).toBe('DRAFT');
  return patched.body as { id: string; total: number; status: string };
}

/** Rows read raw, so a RED run reports what the refused send left behind. */
async function invoiceStatus(id: string): Promise<string | null> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT status::text AS status FROM invoices WHERE id = $1`, id);
  return rows[0]?.status ?? null;
}

/** Every FinancialTransaction the invoice sourced (its recognition and any reversal), with entries and account keys. */
async function invoicePostings(invoiceId: string) {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceType: 'Invoice', sourceId: invoiceId },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * PATCH /commerce/invoices/:id/status/sent as the web client calls it. A
 * refused send reports the invoice's status and its Invoice-sourced postings
 * in the failure message (the RED-BEFORE evidence).
 */
async function send(invoiceId: string) {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/status/sent`)).send({ businessId: ID.biz, status: 'SENT' });
  if (res.status !== 200) {
    const after = `invoice ${await invoiceStatus(invoiceId)}, Invoice-sourced postings ${(await invoicePostings(invoiceId)).length}`;
    expect(res.status, `${res.status} ${JSON.stringify(res.body)} (${after})`).toBe(200);
  }
  expect(res.body.status).toBe('SENT');
  return res;
}

/** Legs of a posting as [systemKey, debit cents, credit cents], sorted by key. */
function legs(tx: any): Array<[string, number, number]> {
  return tx.entries
    .map((e: any) => [e.account.systemKey, cents(e.debit), cents(e.credit)] as [string, number, number])
    .sort((a: [string, number, number], b: [string, number, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] - b[2]));
}

/**
 * The one invoice_finalized posting of a sent invoice, held to the leg rules:
 * every leg non-negative with exactly one side set, AR debits the total and
 * the credits sum to the total, in integer cents.
 */
async function finalizedPosting(invoiceId: string, totalCents: number) {
  const txs = await invoicePostings(invoiceId);
  const finalized = txs.filter((t: any) => t.externalRef === `Invoice:${invoiceId}:invoice_finalized`);
  expect(finalized, 'one invoice_finalized posting').toHaveLength(1);
  const tx = finalized[0];
  expect(tx.type).toBe('INCOME');
  expect(cents(tx.amount)).toBe(totalCents);
  for (const [key, debit, credit] of legs(tx)) {
    expect(debit, `${key} debit >= 0`).toBeGreaterThanOrEqual(0);
    expect(credit, `${key} credit >= 0`).toBeGreaterThanOrEqual(0);
    expect((debit > 0) !== (credit > 0), `${key}: exactly one side set`).toBe(true);
  }
  const l = legs(tx);
  expect(l.reduce((s, x) => s + x[1], 0), 'debits == total').toBe(totalCents);
  expect(l.reduce((s, x) => s + x[2], 0), 'credits == total').toBe(totalCents);
  expect(l.filter((x) => x[0] === 'ACCOUNTS_RECEIVABLE')).toEqual([['ACCOUNTS_RECEIVABLE', totalCents, 0]]);
  return tx;
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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
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
      // Real ledger chain: the recognition and its reversal are real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      // The plan answer: invoices and quotes are within the plan.
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

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  // ACCRUAL, so issuing an invoice posts the recognition (Dr AR / Cr revenue by category).
  await db.business.create({
    data: { id: ID.biz, name: 'V82C Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'ACCRUAL' },
  });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V82C', lastName: 'Customer', email: `${P}c@test.local` } });
  for (const [id, category] of [[ID.svc, 'SERVICE'], [ID.goods, 'PRODUCT'], [ID.pkg, 'PACKAGE']] as const) {
    await db.product.create({ data: { id, businessId: ID.biz, name: `V82C ${category}`, price: 1, currency: 'TTD', category } });
  }
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('an ACCRUAL TTD business with an owner, SERVICE / PRODUCT / PACKAGE products and the per-category revenue accounts', async () => {
    const biz = await db.business.findUnique({ where: { id: ID.biz } });
    expect([biz.accountingBasis, biz.currency]).toEqual(['ACCRUAL', 'TTD']);
    const keys = (await db.chartOfAccount.findMany({ where: { businessId: ID.biz, isSystem: true }, select: { systemKey: true } })).map(
      (a: any) => a.systemKey,
    );
    expect(keys).toEqual(expect.arrayContaining(['ACCOUNTS_RECEIVABLE', 'REVENUE', 'REVENUE_SERVICE', 'REVENUE_PRODUCT', 'REVENUE_PACKAGE']));
    expect(await db.product.count({ where: { businessId: ID.biz } })).toBe(3);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz } })).toBe(0);
  });
});

/** Carried from RS-01 to RS-06. */
let rs01InvoiceId: string | undefined;

describe('V1-82 accrual recognition apportions a document discount across revenue categories (real rows)', () => {
  it('RS-01 RED-BEFORE (invoice PATCH path): svc 10 + goods 10 at PERCENT 60 (total 8) sends 200 SENT and posts AR Dr 8.00 / REVENUE_SERVICE Cr 4.00 / REVENUE_PRODUCT Cr 4.00', async () => {
    const inv = await draftWithLines([svc(10), goods(10)], { discountType: 'PERCENT', discountValue: 60 });
    expect(inv.total).toBe(8);
    rs01InvoiceId = inv.id;
    await send(inv.id);
    const tx = await finalizedPosting(inv.id, 800);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 800, 0],
      ['REVENUE_PRODUCT', 0, 400],
      ['REVENUE_SERVICE', 0, 400],
    ]);
  });

  it('RS-02 RED-BEFORE (quote convert path): a quote with the same lines at PERCENT 60, accepted and converted {}, sends 200 SENT with the same posting', async () => {
    const created = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes`)).send({
      contactId: ID.contact,
      quoteNumber: `${P}Q-001`,
      items: [svc(10), goods(10)],
      discountType: 'PERCENT',
      discountValue: 60,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.total).toBe(8);
    const accepted = await as(agent().patch(`/commerce/quotes/${created.body.id}/status/accepted`)).send({ businessId: ID.biz });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.status).toBe('ACCEPTED');
    const converted = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes/${created.body.id}/convert`)).send({});
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(converted.body).toMatchObject({ status: 'DRAFT', total: 8 });
    const lines: any[] = await db.$queryRawUnsafe(`SELECT product_id AS "productId" FROM invoice_items WHERE invoice_id = $1`, converted.body.id);
    expect(lines.map((l) => l.productId).sort()).toEqual([ID.goods, ID.svc].sort());

    await send(converted.body.id);
    const tx = await finalizedPosting(converted.body.id, 800);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 800, 0],
      ['REVENUE_PRODUCT', 0, 400],
      ['REVENUE_SERVICE', 0, 400],
    ]);
  });

  it('RS-03 RED-BEFORE (uneven): svc 10 + goods 5 with a FIXED discount of 12 (total 3.00) credits 2.00 and 1.00', async () => {
    const inv = await draftWithLines([svc(10), goods(5)], { discountType: 'FIXED', discountValue: 12 });
    expect(inv.total).toBe(3);
    await send(inv.id);
    const tx = await finalizedPosting(inv.id, 300);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 300, 0],
      ['REVENUE_PRODUCT', 0, 100],
      ['REVENUE_SERVICE', 0, 200],
    ]);
  });

  it('RS-04 RED-BEFORE (cent remainder): svc 1 + goods 1 + package 1 with a FIXED discount of 2 (total 1.00) credits 0.34 / 0.33 / 0.33, the leftover cent on the first split', async () => {
    const inv = await draftWithLines([svc(1), goods(1), pkg(1)], { discountType: 'FIXED', discountValue: 2 });
    expect(inv.total).toBe(1);
    await send(inv.id);
    const tx = await finalizedPosting(inv.id, 100);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 100, 0],
      ['REVENUE_PACKAGE', 0, 33],
      ['REVENUE_PRODUCT', 0, 33],
      ['REVENUE_SERVICE', 0, 34],
    ]);
  });

  it('RS-05 control: one category at PERCENT 60 (svc 10 + svc 10, total 8) posts one credit equal to the total', async () => {
    const inv = await draftWithLines([svc(10, 1), svc(10, 2)], { discountType: 'PERCENT', discountValue: 60 });
    expect(inv.total).toBe(8);
    await send(inv.id);
    const tx = await finalizedPosting(inv.id, 800);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 800, 0],
      ['REVENUE_SERVICE', 0, 800],
    ]);
  });

  it('RS-05 control: two categories with no discount (svc 120, goods 80) post 120 / 80', async () => {
    const inv = await draftWithLines([svc(120), goods(80)], {});
    expect(inv.total).toBe(200);
    await send(inv.id);
    const tx = await finalizedPosting(inv.id, 20000);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 20000, 0],
      ['REVENUE_PRODUCT', 0, 8000],
      ['REVENUE_SERVICE', 0, 12000],
    ]);
  });

  it('RS-05 control: two categories at 10% tax (svc 100, goods 50, total 165) keep the positive drift on the largest split (svc 115, goods 50)', async () => {
    const inv = await draftWithLines([svc(100), goods(50)], { taxRate: 10 });
    expect(inv.total).toBe(165);
    await send(inv.id);
    const tx = await finalizedPosting(inv.id, 16500);
    expect(legs(tx)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 16500, 0],
      ['REVENUE_PRODUCT', 0, 5000],
      ['REVENUE_SERVICE', 0, 11500],
    ]);
  });

  it('RS-06 RED-BEFORE: voiding the RS-01 invoice reverses every leg (AR 0, each revenue account 0)', async () => {
    expect(rs01InvoiceId, 'RS-01 sent its invoice').toBeTruthy();
    const id = rs01InvoiceId!;
    const res = await as(agent().patch(`/commerce/invoices/${id}/status/void`)).send({ businessId: ID.biz, status: 'VOID' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('VOID');

    const txs = await invoicePostings(id);
    expect(txs).toHaveLength(2);
    const original = txs.find((t: any) => t.reversalOfId == null);
    const reversal = txs.find((t: any) => t.reversalOfId != null);
    expect(original.status).toBe('REVERSED');
    expect(reversal).toMatchObject({ type: 'REVERSAL', reversalOfId: original.id });
    // Each leg flipped exactly.
    expect(legs(reversal)).toEqual([
      ['ACCOUNTS_RECEIVABLE', 0, 800],
      ['REVENUE_PRODUCT', 400, 0],
      ['REVENUE_SERVICE', 400, 0],
    ]);
    const net = new Map<string, number>();
    for (const t of txs) for (const [key, debit, credit] of legs(t)) net.set(key, (net.get(key) ?? 0) + debit - credit);
    expect(Object.fromEntries(net)).toEqual({ ACCOUNTS_RECEIVABLE: 0, REVENUE_PRODUCT: 0, REVENUE_SERVICE: 0 });
  });
});
