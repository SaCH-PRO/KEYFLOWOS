/**
 * V1-82 (FOLLOW3-B2-ISSUED-INVOICE-AMOUNTS) — an issued invoice's lines, tax,
 * discount and total cannot drift from its posted recognition and its
 * reconciled status (REAL database, REAL ledger posting, REAL invoice
 * workflow, REAL receivables).
 *
 * At bb6b86d4 CommerceService.updateInvoice refused only PAID and
 * PARTIALLY_PAID. The currency of a non-DRAFT invoice was fixed (V1-37
 * ST-V37-1); its amounts were not. An items edit deleted and recreated the
 * lines and rewrote subtotal, tax, discount and total, and a tax- or
 * discount-only edit rewrote the total, on SENT, OVERDUE, FAILED, PENDING and
 * even VOID invoices. Neither re-posted the recognition (onInvoiceFinalized is
 * idempotent per invoice) nor re-ran the payment reconcile. So an ACCRUAL
 * receivable of 100 stayed at 20 after the invoice was edited to 80 and paid,
 * went to -50 after an edit to 150 and payment, and a CASH invoice paid 60 and
 * edited to 50 stayed OVERDUE with paidAt null.
 *
 * Owner ruling D-60: once an invoice has left DRAFT, a PATCH that changes its
 * lines, tax or discount (and so its total) is refused with 409; corrections
 * go through void-and-reissue or a credit note (D-28). Restating the stored
 * amounts unchanged, notes, due date and contact edits stay allowed.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the base):
 *
 *   IA-01 RED-BEFORE ACCRUAL SENT 100, PATCH items to 80 -> 409, nothing written, no invoice.updated;
 *                    receivables outstanding == listPayments remaining == ledger AR == 100; mark-paid -> AR 0
 *   IA-02 RED-BEFORE the same, edited to 150 -> 409; mark-paid -> AR 0 (was -50)
 *   IA-03 RED-BEFORE CASH SENT 100, paid 60, PATCH status/overdue 200, PATCH items to 50 -> 409; total 100,
 *                    net 60, remaining 40, status OVERDUE (was total 50, net 60, OVERDUE, paidAt null)
 *   IA-04 RED-BEFORE SENT PATCH {taxRate:10}, then {discountType:'FIXED', discountValue:10} -> 409 each;
 *                    a VOID invoice's {taxRate:10} -> 409
 *   IA-05 RED-BEFORE CommerceService.updateInvoice({invoiceId, businessId, items}) on a SENT invoice with no
 *                    actor (the commerce_update_invoice shape) -> ConflictException 409, nothing written
 *   IA-06 controls:  a DRAFT edit to 80, send, mark-paid -> AR 80 then 0; SENT {notes, dueDate} -> 200;
 *                    SENT restating its stored lines and tax/discount (productId omitted, as the web edit
 *                    form sends it) -> 200, total unchanged, stored productIds kept; the same with no
 *                    discount in the web form's {discountType:null, discountValue:null} shape -> 200; a
 *                    SENT line description edit with the amounts restated -> 200 (description written, money
 *                    and productIds kept); SENT {currency} change -> 409 currency (CUR-08 as before);
 *                    PAID and PARTIALLY_PAID still 409 'Cannot edit a paid or partially paid invoice'
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed: the plan allows
 * invoices), CommerceController, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService and
 * ReceivablesService read and write real rows behind the production
 * GlobalHttpExceptionFilter, ValidationPipe and TenantInterceptor. Identity
 * attachment is the one stand-in: a test middleware reads `x-v82b-user`,
 * loads that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. The event bus is a recording stub
 * (so a refused edit is shown to emit no invoice.updated); the contact
 * timeline, TimelineService, stats cache and the AI / Gmail / Drive services
 * are stubs off the boundary; ExpensePostingService (COGS on PAID) is a no-op
 * stub (no invoice with product lines is paid here).
 *
 * Fixtures: prefix `v82b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in
 * beforeAll and afterAll; no $transaction wrapping. Rows the server creates get
 * server ids under the prefixed businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82b_';
const HEADER = 'x-v82b-user';

const ID = {
  owner: `${P}owner`,
  acc: `${P}biz_acc`,
  cash: `${P}biz_cash`,
  contactAcc: `${P}contact_acc`,
  contactCash: `${P}contact_cash`,
  svc: `${P}prod_svc`,
  goods: `${P}prod_goods`,
};

const AMOUNTS_REFUSED = (status: string) => new RegExp(`^Cannot change the amounts of a ${status} invoice: `);
const PAID_REFUSED = 'Cannot edit a paid or partially paid invoice';

let db: any;
let app: any;
let redis: any;
let commerce: any;
let receivables: any;
let coa: any;

/** The event bus: records every emit, so a refused edit is shown to emit nothing. */
const emitted: string[] = [];
const eventStub = {
  emit: (name: string) => {
    emitted.push(name);
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
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
const contactOf = (biz: string) => (biz === ID.acc ? ID.contactAcc : ID.contactCash);

/** POST a DRAFT invoice. Invoice numbers default to INV-<ms>, unique per tenant (V1-43): space the creates. */
async function createDraft(biz: string, items: Line[], terms: Record<string, unknown> = {}) {
  await sleep(3);
  const res = await as(agent().post(`/commerce/businesses/${biz}/invoices`)).send({ contactId: contactOf(biz), items, ...terms });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.status).toBe('DRAFT');
  return res.body as { id: string; total: number };
}
function patchInvoice(biz: string, invoiceId: string, body: Record<string, unknown>) {
  return as(agent().patch(`/commerce/businesses/${biz}/invoices/${invoiceId}`)).send(body);
}
async function send(biz: string, invoiceId: string) {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/status/sent`)).send({ businessId: biz, status: 'SENT' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('SENT');
}
async function overdue(biz: string, invoiceId: string) {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/status/overdue`)).send({ businessId: biz, status: 'OVERDUE' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('OVERDUE');
}
async function voidIt(biz: string, invoiceId: string) {
  const res = await as(agent().patch(`/commerce/invoices/${invoiceId}/status/void`)).send({ businessId: biz, status: 'VOID' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('VOID');
}
async function pay(biz: string, invoiceId: string, amount: number) {
  const res = await as(agent().post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)).send({ amount, method: 'cash' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res;
}
function markPaid(biz: string, invoiceId: string) {
  return as(agent().patch(`/commerce/invoices/${invoiceId}/paid`)).send({ businessId: biz });
}

/** A sent invoice of one line of 100 (ACCRUAL: its receivable of 100 is posted). */
async function sent100(biz: string, label: string) {
  const inv = await createDraft(biz, [{ description: `V82B ${label}`, quantity: 1, unitPrice: 100 }]);
  expect(inv.total).toBe(100);
  await send(biz, inv.id);
  return inv.id;
}

/** The invoice row and its lines as stored, read raw (updated_at included: a refused edit writes nothing). */
async function snapshot(invoiceId: string) {
  const [row]: any[] = await db.$queryRawUnsafe(
    `SELECT status::text AS status, subtotal, tax_rate AS "taxRate", tax_amount AS "taxAmount",
            discount_type AS "discountType", discount_value AS "discountValue", discount_amount AS "discountAmount",
            total, currency, notes, due_date::text AS "dueDate", paid_at::text AS "paidAt", updated_at::text AS "updatedAt"
       FROM invoices WHERE id = $1`,
    invoiceId,
  );
  const items: any[] = await db.$queryRawUnsafe(
    `SELECT id, description, quantity, unit_price AS "unitPrice", total, product_id AS "productId"
       FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
    invoiceId,
  );
  return { ...row, items };
}

/** Ledger AR for one invoice, in cents: its own postings plus those of its payments. */
async function ledgerArCents(biz: string, invoiceId: string): Promise<number> {
  const ar = await coa.getBySystemKey(biz, 'ACCOUNTS_RECEIVABLE');
  const rows: Array<{ d: string | null; c: string | null }> = await db.$queryRawUnsafe(
    `SELECT SUM(le.debit)::text AS d, SUM(le.credit)::text AS c
       FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
      WHERE le.business_id = $1 AND le.account_id = $2
        AND (ft.source_id = $3 OR ft.source_id IN (SELECT id FROM payments WHERE invoice_id = $3))`,
    biz, ar.id, invoiceId,
  );
  return cents(rows[0]?.d) - cents(rows[0]?.c);
}

/** listPayments (GET .../payments) and ReceivablesService.getCustomerBalance for one invoice, in cents. */
async function balances(biz: string, invoiceId: string) {
  const listed = await as(agent().get(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`));
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  const customer = await receivables.getCustomerBalance(biz, contactOf(biz));
  const row = customer.invoices.find((i: any) => i.id === invoiceId);
  expect(row, 'the invoice is in the customer balance').toBeTruthy();
  return {
    total: cents(listed.body.invoiceTotal),
    net: cents(listed.body.paidAmount),
    remaining: cents(listed.body.remaining),
    outstanding: cents(row.outstanding),
  };
}

/**
 * The refused-edit contract: 409 with the D-60 message, the row and its lines
 * byte-identical, no invoice.updated event. Soft assertions, so a RED run
 * reports every drift at once.
 */
async function expectRefused(res: request.Response, status: string, before: unknown, invoiceId: string, events: string[]) {
  expect.soft(res.status, JSON.stringify(res.body)).toBe(409);
  expect.soft(String(res.body?.message ?? '')).toMatch(AMOUNTS_REFUSED(status));
  expect.soft(await snapshot(invoiceId), 'items, subtotal, tax, discount and total byte-identical on reload').toEqual(before);
  expect.soft(events, 'no invoice.updated event').not.toContain('invoice.updated');
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
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
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
      // Real ledger chain and receivables: the recognition, payments and the AR read are real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      ReceivablesService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      // The plan answer: invoices are within the plan.
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      // Gmail is stubbed: nothing here emails.
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  receivables = moduleRef.get(ReceivablesService);
  coa = moduleRef.get(ChartOfAccountsSeederService);

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
  // ACCRUAL: issuing posts the receivable (Dr AR / Cr revenue). CASH: nothing posts until money arrives.
  for (const [id, basis] of [[ID.acc, 'ACCRUAL'], [ID.cash, 'CASH']] as const) {
    await db.business.create({
      data: { id, name: `V82B ${basis}`, slug: `${P}${basis.toLowerCase()}`, ownerId: ID.owner, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${P}m_${basis.toLowerCase()}`, userId: ID.owner, businessId: id, role: 'OWNER' } });
    await db.contact.create({
      data: { id: contactOf(id), businessId: id, firstName: 'V82B', lastName: basis, email: `${P}${basis.toLowerCase()}@test.local` },
    });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(id);
  }
  for (const [id, category] of [[ID.svc, 'SERVICE'], [ID.goods, 'PRODUCT']] as const) {
    await db.product.create({ data: { id, businessId: ID.acc, name: `V82B ${category}`, price: 1, currency: 'TTD', category } });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('an ACCRUAL and a CASH TTD business with an owner, a contact each, the AR account, and two products', async () => {
    const rows = await db.business.findMany({ where: { id: { in: [ID.acc, ID.cash] } }, select: { id: true, accountingBasis: true, currency: true } });
    expect(rows.map((b: any) => [b.id, b.accountingBasis, b.currency]).sort()).toEqual([
      [ID.acc, 'ACCRUAL', 'TTD'],
      [ID.cash, 'CASH', 'TTD'],
    ]);
    expect(await coa.getBySystemKey(ID.acc, 'ACCOUNTS_RECEIVABLE')).toBeTruthy();
    expect(await db.product.count({ where: { businessId: ID.acc } })).toBe(2);
    expect(await db.financialTransaction.count({ where: { businessId: { in: [ID.acc, ID.cash] } } })).toBe(0);
  });
});

describe('V1-82 D-60: an issued invoice refuses an edit that changes its amounts (real rows)', () => {
  it('IA-01 RED-BEFORE (S6): an ACCRUAL invoice of 100 sent (AR 100), PATCH items to 80 -> 409, nothing written; receivables, listPayments and ledger AR agree at 100, then 0 after mark-paid', async () => {
    const id = await sent100(ID.acc, 'IA-01');
    expect(await ledgerArCents(ID.acc, id), 'AR 100 posted at send').toBe(10_000);
    const before = await snapshot(id);

    emitted.length = 0;
    const res = await patchInvoice(ID.acc, id, { items: [{ description: 'V82B IA-01', quantity: 1, unitPrice: 80 }] });
    await expectRefused(res, 'SENT', before, id, [...emitted]);

    const b = await balances(ID.acc, id);
    expect.soft(b, 'receivables outstanding == listPayments remaining == total').toEqual({ total: 10_000, net: 0, remaining: 10_000, outstanding: 10_000 });
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR == remaining').toBe(b.remaining);

    const paid = await markPaid(ID.acc, id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR after mark-paid (RED: 20.00 stranded)').toBe(0);
    const after = await balances(ID.acc, id);
    expect.soft(after.remaining).toBe(0);
    expect.soft(after.outstanding, 'receivables outstanding == listPayments remaining').toBe(after.remaining);
  }, 60_000);

  it('IA-02 RED-BEFORE (S6 up): the same edited to 150 -> 409; mark-paid settles 100 and the ledger AR closes at 0 (RED: -50)', async () => {
    const id = await sent100(ID.acc, 'IA-02');
    const before = await snapshot(id);

    emitted.length = 0;
    const res = await patchInvoice(ID.acc, id, { items: [{ description: 'V82B IA-02', quantity: 1, unitPrice: 150 }] });
    await expectRefused(res, 'SENT', before, id, [...emitted]);
    const b = await balances(ID.acc, id);
    expect.soft(b.outstanding, 'receivables outstanding == listPayments remaining').toBe(b.remaining);
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR == remaining').toBe(b.remaining);

    const paid = await markPaid(ID.acc, id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR after mark-paid (RED: -50.00)').toBe(0);
    const after = await balances(ID.acc, id);
    expect.soft(after, 'paid in full at 100').toEqual({ total: 10_000, net: 10_000, remaining: 0, outstanding: 0 });
  }, 60_000);

  it('IA-03 RED-BEFORE (S7a): a CASH invoice of 100 sent, paid 60, made OVERDUE (200), then PATCH items to 50 -> 409; total 100, net 60, remaining 40, OVERDUE', async () => {
    const id = await sent100(ID.cash, 'IA-03');
    await pay(ID.cash, id, 60);
    expect((await snapshot(id)).status).toBe('PARTIALLY_PAID');
    await overdue(ID.cash, id);
    const before = await snapshot(id);
    expect(before.status).toBe('OVERDUE');

    emitted.length = 0;
    const res = await patchInvoice(ID.cash, id, { items: [{ description: 'V82B IA-03', quantity: 1, unitPrice: 50 }] });
    await expectRefused(res, 'OVERDUE', before, id, [...emitted]);

    const row = await snapshot(id);
    expect.soft({ total: row.total, status: row.status }, 'RED: total 50 with 60 received, still OVERDUE and paidAt null').toEqual({ total: 100, status: 'OVERDUE' });
    const b = await balances(ID.cash, id);
    expect.soft(b).toEqual({ total: 10_000, net: 6_000, remaining: 4_000, outstanding: 4_000 });
  }, 60_000);

  it('IA-04 RED-BEFORE: a SENT invoice receives PATCH {taxRate:10}, then {discountType:"FIXED", discountValue:10}: each -> 409; a VOID invoice\'s {taxRate:10} -> 409', async () => {
    const id = await sent100(ID.acc, 'IA-04');
    const before = await snapshot(id);

    for (const body of [{ taxRate: 10 }, { discountType: 'FIXED', discountValue: 10 }]) {
      emitted.length = 0;
      const res = await patchInvoice(ID.acc, id, body);
      await expectRefused(res, 'SENT', before, id, [...emitted]);
    }
    const b = await balances(ID.acc, id);
    expect.soft(b).toEqual({ total: 10_000, net: 0, remaining: 10_000, outstanding: 10_000 });
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR == remaining').toBe(b.remaining);

    const voided = await sent100(ID.acc, 'IA-04 void');
    await voidIt(ID.acc, voided);
    const voidBefore = await snapshot(voided);
    emitted.length = 0;
    const res = await patchInvoice(ID.acc, voided, { taxRate: 10 });
    await expectRefused(res, 'VOID', voidBefore, voided, [...emitted]);
    expect.soft(await ledgerArCents(ID.acc, voided), 'the voided receivable stays reversed').toBe(0);
  }, 60_000);

  it('IA-05 RED-BEFORE: CommerceService.updateInvoice({invoiceId, businessId, items}) on a SENT invoice with no actor (the commerce_update_invoice shape) -> ConflictException 409, nothing written', async () => {
    const id = await sent100(ID.acc, 'IA-05');
    const before = await snapshot(id);

    emitted.length = 0;
    let caught: any;
    try {
      await commerce.updateInvoice({ invoiceId: id, businessId: ID.acc, items: [{ description: 'V82B IA-05', quantity: 2, unitPrice: 30 }] });
    } catch (err) {
      caught = err;
    }
    expect.soft(caught?.getStatus?.(), `answered ${caught ? String(caught.message) : 'without error'}`).toBe(409);
    expect.soft(String(caught?.message ?? '')).toMatch(AMOUNTS_REFUSED('SENT'));
    expect.soft(await snapshot(id)).toEqual(before);
    expect.soft(emitted).not.toContain('invoice.updated');
    const b = await balances(ID.acc, id);
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR == remaining').toBe(b.remaining);
    expect.soft(b.outstanding).toBe(b.remaining);
  }, 60_000);
});

describe('V1-82 D-60 controls: DRAFT edits, restatements and non-money edits stay allowed (real rows)', () => {
  it('IA-06a: a DRAFT edited to 80, then sent, then marked paid -> AR 80, then 0', async () => {
    const inv = await createDraft(ID.acc, [{ description: 'V82B IA-06a', quantity: 1, unitPrice: 100 }]);
    const edited = await patchInvoice(ID.acc, inv.id, { items: [{ description: 'V82B IA-06a', quantity: 1, unitPrice: 80 }] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.total).toBe(80);
    await send(ID.acc, inv.id);
    expect(await ledgerArCents(ID.acc, inv.id)).toBe(8_000);
    const b = await balances(ID.acc, inv.id);
    expect(b).toEqual({ total: 8_000, net: 0, remaining: 8_000, outstanding: 8_000 });
    const paid = await markPaid(ID.acc, inv.id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(await ledgerArCents(ID.acc, inv.id)).toBe(0);
    expect(await balances(ID.acc, inv.id)).toEqual({ total: 8_000, net: 8_000, remaining: 0, outstanding: 0 });
  }, 60_000);

  it('IA-06b: a SENT invoice with PATCH {notes, dueDate} -> 200, both written, the amounts unchanged', async () => {
    const id = await sent100(ID.acc, 'IA-06b');
    const before = await snapshot(id);
    const res = await patchInvoice(ID.acc, id, { notes: 'V82B note', dueDate: '2026-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.notes).toBe('V82B note');
    expect(String(res.body.dueDate)).toMatch(/^2026-12-31/);
    const after = await snapshot(id);
    const money = (s: any) => ({ subtotal: s.subtotal, taxAmount: s.taxAmount, discountAmount: s.discountAmount, total: s.total, items: s.items });
    expect(money(after)).toEqual(money(before));
  }, 60_000);

  it('IA-06c: a SENT invoice with product lines, tax and a discount, PATCH restating its stored lines and terms as the web edit form sends them (productId omitted) -> 200, total unchanged, stored productIds kept', async () => {
    const inv = await createDraft(ID.acc, [{ description: 'V82B placeholder', quantity: 1, unitPrice: 1 }]);
    const lines: Line[] = [
      { description: 'V82B IA-06c service', quantity: 2, unitPrice: 25, productId: ID.svc },
      { description: 'V82B IA-06c goods', quantity: 1, unitPrice: 50, productId: ID.goods },
    ];
    const drafted = await patchInvoice(ID.acc, inv.id, { items: lines, taxRate: 10, discountType: 'PERCENT', discountValue: 10 });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    // subtotal 100, tax 10, discount 10: total 100.
    expect(drafted.body.total).toBe(100);
    await send(ID.acc, inv.id);
    const before = await snapshot(inv.id);
    expect(before.items.map((i: any) => i.productId).sort()).toEqual([ID.goods, ID.svc].sort());

    // The web edit form (apps/web/src/app/app/commerce/invoices/[id]/edit/page.tsx) sends every line without productId.
    const res = await patchInvoice(ID.acc, inv.id, {
      contactId: ID.contactAcc,
      items: lines.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
      dueDate: null,
      taxRate: 10,
      discountType: 'PERCENT',
      discountValue: 10,
      notes: 'V82B restated',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.total).toBe(100);
    const after = await snapshot(inv.id);
    expect(after.items, 'the lines are untouched: ids, amounts and productIds kept').toEqual(before.items);
    const money = (s: any) => ({ subtotal: s.subtotal, taxRate: s.taxRate, taxAmount: s.taxAmount, discountType: s.discountType, discountValue: s.discountValue, discountAmount: s.discountAmount, total: s.total });
    expect(money(after)).toEqual(money(before));
    expect(after.notes).toBe('V82B restated');
    expect(await ledgerArCents(ID.acc, inv.id)).toBe(10_000);
  }, 60_000);

  it('IA-06d: a SENT invoice with no tax or discount, restated in the web form\'s shape ({taxRate omitted, discountType:null, discountValue:null}) -> 200, nothing in its money changes', async () => {
    const id = await sent100(ID.acc, 'IA-06d');
    const before = await snapshot(id);
    const res = await patchInvoice(ID.acc, id, {
      contactId: ID.contactAcc,
      items: [{ description: 'V82B IA-06d', quantity: 1, unitPrice: 100 }],
      dueDate: null,
      discountType: null,
      discountValue: null,
      notes: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.total).toBe(100);
    const after = await snapshot(id);
    const money = (s: any) => ({ subtotal: s.subtotal, taxAmount: s.taxAmount, discountAmount: s.discountAmount, total: s.total, items: s.items });
    expect(money(after)).toEqual(money(before));
  }, 60_000);

  it('IA-06e: a SENT invoice whose line description is edited with the amounts restated -> 200; the description is written, the money, line ids and productIds are kept', async () => {
    const inv = await createDraft(ID.acc, [{ description: 'V82B placeholder', quantity: 1, unitPrice: 1 }]);
    const drafted = await patchInvoice(ID.acc, inv.id, { items: [{ description: 'V82B IA-06e typo', quantity: 1, unitPrice: 40, productId: ID.svc }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    await send(ID.acc, inv.id);
    const before = await snapshot(inv.id);

    const res = await patchInvoice(ID.acc, inv.id, { items: [{ description: 'V82B IA-06e fixed', quantity: 1, unitPrice: 40 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await snapshot(inv.id);
    expect(after.items).toEqual([{ ...before.items[0], description: 'V82B IA-06e fixed' }]);
    expect(after.total).toBe(before.total);
    expect(await ledgerArCents(ID.acc, inv.id)).toBe(4_000);
  }, 60_000);

  it('IA-06f: CUR-08 as before: a SENT invoice\'s currency change -> 409 currency; restating it stays 200', async () => {
    const id = await sent100(ID.acc, 'IA-06f');
    const switched = await patchInvoice(ID.acc, id, { currency: 'USD' });
    expect(switched.status, JSON.stringify(switched.body)).toBe(409);
    expect(switched.body.message).toBe('Cannot change the currency of a SENT invoice: the currency is fixed once the invoice is issued');
    const restated = await patchInvoice(ID.acc, id, { currency: 'ttd' });
    expect(restated.status, JSON.stringify(restated.body)).toBe(200);
    expect(restated.body.currency).toBe('TTD');
  }, 60_000);

  it(`IA-06g: PAID and PARTIALLY_PAID still answer 409 '${PAID_REFUSED}', even when the amounts are restated`, async () => {
    const partly = await sent100(ID.cash, 'IA-06g partly');
    await pay(ID.cash, partly, 30);
    const paid = await sent100(ID.cash, 'IA-06g paid');
    await pay(ID.cash, paid, 100);
    for (const [id, status] of [[partly, 'PARTIALLY_PAID'], [paid, 'PAID']] as const) {
      expect((await snapshot(id)).status).toBe(status);
      for (const body of [{ items: [{ description: 'V82B changed', quantity: 1, unitPrice: 70 }] }, { items: [{ description: `V82B IA-06g ${status === 'PAID' ? 'paid' : 'partly'}`, quantity: 1, unitPrice: 100 }] }, { notes: 'x' }]) {
        const res = await patchInvoice(ID.cash, id, body);
        expect(res.status, `${status} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(409);
        expect(res.body.message).toBe(PAID_REFUSED);
      }
    }
  }, 60_000);
});
