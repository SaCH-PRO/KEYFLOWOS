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
 *                    form sends it) -> 200, total unchanged, stored productIds kept (in any line order); the
 *                    same with no discount in the web form's {discountType:null, discountValue:null} shape ->
 *                    200; a SENT line description edit, product swap or line split -> 409 (D-60: the lines
 *                    are fixed), a line naming its stored productId -> 200; SENT {currency} change -> 409
 *                    currency (CUR-08 as before);
 *                    PAID and PARTIALLY_PAID still 409 'Cannot edit a paid or partially paid invoice'
 *
 * Review repairs (SEC-B2-1 / B2-CR-1, SEC-B2-2 / B2-CR-2):
 *
 *   IA-07a an ACCRUAL SENT 100 returned to DRAFT by the AI undo (CommerceService.undoInvoice, recognition
 *          kept): PATCH items to 80, tax or currency -> 409 'an issued invoice returned to DRAFT', nothing
 *          written; notes and a restatement -> 200; re-sent and paid -> AR 100 then 0 (was 200, total 80,
 *          AR 20.00 stranded after mark-paid)
 *   IA-07b an ACCRUAL invoice marked paid and undone to DRAFT keeps its recognition: PATCH items to 70
 *          -> 409 (the undo no longer escapes the paid-invoice guard)
 *   IA-07c control: a CASH invoice sent and undone before any money arrived holds no posting or credit
 *          note: its DRAFT edit to 80 -> 200, and it is re-sent and paid at 80. (A CASH invoice paid and
 *          undone stays editable too: payments-mark-paid MP-16, R0-PL-04 review CR-PL04-2, pins paid ->
 *          undo -> edit to 200 -> re-issue -> mark-paid; on the CASH basis nothing is posted at the old total)
 *   IA-08a a Send that commits inside the edit's window (after its first read, before its writes) -> the
 *          edit reads SENT under the row lock and is refused 409; the invoice stays SENT at 100 with AR 100
 *          (was 200: SENT, total 80, AR 100)
 *   IA-08b ten concurrent {PATCH items to 80, Send} pairs on DRAFT 100: every invoice ends SENT with its
 *          ledger AR equal to its total (80 when the edit won, 100 when the Send won and the edit got 409)
 *
 * Owner ruling D-89 (W3-D89-OVERPAID-EDIT, the FOLLOW3-B2 residual): an invoice edit that would bring
 * its total below the money it holds (received net of refunds, its own tenant's Payment rows only,
 * D-75; integer cents, D-13) is refused with 409, including a DRAFT the AI undo returned from an issued
 * state. A CASH invoice holds no invoice-sourced posting, so D-60 (holdsIssuedMoney) leaves its
 * undone DRAFT editable; before D-89 it could be edited below the money received and left overpaid.
 *
 *   IA-09a RED-BEFORE a CASH invoice of 100 sent, paid 60, undone to DRAFT: PATCH items to 50, to 59.99,
 *          or a FIXED discount of 50 -> 409 'holds TTD 60.00', nothing written, no invoice.updated;
 *          PATCH items to 60 -> 200 (60), to 80 -> 200 (80), a FIXED discount of 20 on 80 -> 200 (60)
 *   IA-09b RED-BEFORE paid 20 and 40, the 40 refunded (net held 20), undone to DRAFT: PATCH items to 19.99
 *          -> 409 'holds TTD 20.00'; to 30 -> 200 and to 20 -> 200 (the refunded 40 is not held)
 *   IA-09c RED-BEFORE paid 20, undone to DRAFT, a SUCCESSFUL row of 70 under another business on the same
 *          invoice (M31: Payment has no FK to Business): PATCH items to 30 -> 200 (the foreign row is not
 *          this invoice's money, D-75); to 10 -> 409 'holds TTD 20.00'
 *
 * D-89 review repairs:
 *
 *   IA-09d SEC-D89-1: 1000 FAILED payment rows on the invoice whose ids sort before a cuid, under another
 *          business (M31) and then under its own: paid 60, undone: PATCH items to 10 -> 409 'holds TTD
 *          60.00', nothing written; to 60 -> 200 (was 200 at 10: the db client's default take of 1000 capped
 *          the guard's findMany, inside the transaction too, and the payment row was never read)
 *   IA-09e CR-D89-1: paid 120 on 100 (overpaid, recordPayment allows it), undone: the web form restating
 *          its items with a note, {taxRate:0}, items to 110 and to 130 -> 200 (none lowers the stored
 *          total, so none brings it below the money held); from 110, items to 100 or a FIXED discount of 5
 *          -> 409 'holds TTD 120.00', nothing written (was 409 on every items or tax edit)
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
/** The D-60 refusal of a DRAFT that holds issued money (the AI undo returned it to DRAFT). */
const RETURNED_REFUSED = /^Cannot change the amounts of an issued invoice returned to DRAFT: /;
const PAID_REFUSED = 'Cannot edit a paid or partially paid invoice';
/** The D-89 refusal: the edited total would be below the money the invoice holds (`held`, e.g. '60.00'). */
const HELD_REFUSED = (held: string) =>
  new RegExp(`^Cannot set the total of this invoice below the money it holds: it holds TTD ${held.replace('.', '\\.')} received net of refunds`);

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
async function expectRefused(res: request.Response, status: string | RegExp, before: unknown, invoiceId: string, events: string[]) {
  expect.soft(res.status, JSON.stringify(res.body)).toBe(409);
  expect.soft(String(res.body?.message ?? '')).toMatch(typeof status === 'string' ? AMOUNTS_REFUSED(status) : status);
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

    // Invoice reads return the lines unordered: the same lines in another order are a restatement too.
    const reordered = await patchInvoice(ID.acc, inv.id, {
      items: [...lines].reverse().map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
      taxRate: 10,
    });
    expect(reordered.status, JSON.stringify(reordered.body)).toBe(200);
    expect((await snapshot(inv.id)).items).toEqual(before.items);
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

  it('IA-06e: a SENT invoice\'s lines are fixed (D-60 "changes its lines"): a line description edit, a swapped product and a split line are each refused 409 and write nothing; a line with its stored productId named is a restatement (200)', async () => {
    const inv = await createDraft(ID.acc, [{ description: 'V82B placeholder', quantity: 1, unitPrice: 1 }]);
    const drafted = await patchInvoice(ID.acc, inv.id, { items: [{ description: 'V82B IA-06e', quantity: 2, unitPrice: 20, productId: ID.svc }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    await send(ID.acc, inv.id);
    const before = await snapshot(inv.id);

    for (const items of [
      [{ description: 'V82B IA-06e renamed', quantity: 2, unitPrice: 20 }],
      [{ description: 'V82B IA-06e', quantity: 2, unitPrice: 20, productId: ID.goods }],
      [{ description: 'V82B IA-06e', quantity: 1, unitPrice: 20 }, { description: 'V82B IA-06e', quantity: 1, unitPrice: 20 }],
    ]) {
      emitted.length = 0;
      const res = await patchInvoice(ID.acc, inv.id, { items });
      expect(res.status, `${JSON.stringify(items)}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.message).toMatch(AMOUNTS_REFUSED('SENT'));
      expect(await snapshot(inv.id)).toEqual(before);
      expect(emitted).not.toContain('invoice.updated');
    }
    const named = await patchInvoice(ID.acc, inv.id, { items: [{ description: 'V82B IA-06e', quantity: 2, unitPrice: 20, productId: ID.svc }] });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect((await snapshot(inv.id)).items).toEqual(before.items);
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

describe('V1-82 review repairs: an invoice issued and undone to DRAFT keeps its amounts (SEC-B2-1, B2-CR-1; real rows)', () => {
  it('IA-07a: an ACCRUAL invoice of 100 sent, then returned to DRAFT by the AI undo with its recognition kept: PATCH items to 80, tax or currency -> 409, nothing written; notes and a restatement -> 200; re-sent and paid -> AR 100, then 0', async () => {
    const id = await sent100(ID.acc, 'IA-07a');
    expect(await ledgerArCents(ID.acc, id), 'AR 100 posted at send').toBe(10_000);
    const undone = await commerce.undoInvoice(id, ID.acc);
    expect(undone.status).toBe('reverted_to_draft');
    const before = await snapshot(id);
    expect(before.status, 'the undo writes the status alone').toBe('DRAFT');
    expect(await ledgerArCents(ID.acc, id), 'the recognition stays posted').toBe(10_000);

    for (const body of [
      { items: [{ description: 'V82B IA-07a', quantity: 1, unitPrice: 80 }] },
      { taxRate: 10 },
      { discountType: 'FIXED', discountValue: 10 },
    ]) {
      emitted.length = 0;
      const res = await patchInvoice(ID.acc, id, body);
      await expectRefused(res, RETURNED_REFUSED, before, id, [...emitted]);
    }
    emitted.length = 0;
    const switched = await patchInvoice(ID.acc, id, { currency: 'USD' });
    expect.soft(switched.status, JSON.stringify(switched.body)).toBe(409);
    expect.soft(switched.body.message).toBe(
      'Cannot change the currency of an issued invoice returned to DRAFT: the currency is fixed once the invoice is issued',
    );
    expect.soft(await snapshot(id)).toEqual(before);
    expect.soft(emitted).not.toContain('invoice.updated');

    const restated = await patchInvoice(ID.acc, id, {
      contactId: ID.contactAcc,
      items: [{ description: 'V82B IA-07a', quantity: 1, unitPrice: 100 }],
      currency: 'TTD',
      notes: 'V82B reviewed after undo',
    });
    expect(restated.status, JSON.stringify(restated.body)).toBe(200);
    expect(restated.body.total).toBe(100);
    const after = await snapshot(id);
    expect(after.items, 'the lines are untouched').toEqual(before.items);
    expect(after.notes).toBe('V82B reviewed after undo');

    await send(ID.acc, id);
    const b = await balances(ID.acc, id);
    expect.soft(b, 'receivables, listPayments and the invoice agree at 100').toEqual({ total: 10_000, net: 0, remaining: 10_000, outstanding: 10_000 });
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR == remaining (posted once)').toBe(b.remaining);
    const paid = await markPaid(ID.acc, id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect.soft(await ledgerArCents(ID.acc, id), 'ledger AR closes at 0 (was 20.00 stranded)').toBe(0);
    expect.soft(await balances(ID.acc, id)).toEqual({ total: 10_000, net: 10_000, remaining: 0, outstanding: 0 });
  }, 60_000);

  it('IA-07b: an ACCRUAL invoice marked paid (PAID, AR closed at 0) and undone to DRAFT keeps its recognition: PATCH items to 70 -> 409, nothing written (the undo no longer escapes the paid-invoice guard)', async () => {
    const id = await sent100(ID.acc, 'IA-07b');
    const paid = await markPaid(ID.acc, id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(await ledgerArCents(ID.acc, id)).toBe(0);
    const undone = await commerce.undoInvoice(id, ID.acc);
    expect(undone.status).toBe('reverted_to_draft');
    const before = await snapshot(id);
    expect(before.status).toBe('DRAFT');

    emitted.length = 0;
    const res = await patchInvoice(ID.acc, id, { items: [{ description: 'V82B IA-07b', quantity: 1, unitPrice: 70 }] });
    await expectRefused(res, RETURNED_REFUSED, before, id, [...emitted]);
    expect.soft(await ledgerArCents(ID.acc, id), 'the settled receivable stays closed').toBe(0);
    expect.soft((await balances(ID.acc, id)).total, 'the total its payment settled is kept').toBe(10_000);
  }, 60_000);

  it('IA-07c control: a CASH invoice sent and undone before any money arrived holds no posting or credit note: its DRAFT edit to 80 -> 200; re-sent and paid 80 -> PAID', async () => {
    const id = await sent100(ID.cash, 'IA-07c');
    const undone = await commerce.undoInvoice(id, ID.cash);
    expect(undone.status).toBe('reverted_to_draft');
    expect(await db.financialTransaction.count({ where: { businessId: ID.cash, sourceId: id } })).toBe(0);

    const edited = await patchInvoice(ID.cash, id, { items: [{ description: 'V82B IA-07c', quantity: 1, unitPrice: 80 }] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.total).toBe(80);
    await send(ID.cash, id);
    await pay(ID.cash, id, 80);
    const row = await snapshot(id);
    expect({ status: row.status, total: row.total }).toEqual({ status: 'PAID', total: 80 });
    expect(await balances(ID.cash, id)).toEqual({ total: 8_000, net: 8_000, remaining: 0, outstanding: 0 });
  }, 60_000);
});

describe('V1-82 review repairs: an edit racing a Send cannot leave an issued total off its receivable (SEC-B2-2, B2-CR-2; real rows)', () => {
  it('IA-08a: a Send that commits after the edit\'s first read and before its writes -> the edit is refused 409 and the invoice stays SENT at 100 with AR 100', async () => {
    const inv = await createDraft(ID.acc, [{ description: 'V82B IA-08a', quantity: 1, unitPrice: 100 }]);
    // The window: the edit resolves the named contact after its first read of
    // the invoice and before any write. A second request (Send) lands there.
    const original = commerce.assertContactInBusiness;
    let sentInWindow = false;
    commerce.assertContactInBusiness = async function (...args: unknown[]) {
      if (!sentInWindow) {
        sentInWindow = true;
        await send(ID.acc, inv.id);
      }
      return original.apply(commerce, args);
    };
    emitted.length = 0;
    let res: request.Response;
    try {
      res = await patchInvoice(ID.acc, inv.id, {
        contactId: ID.contactAcc,
        items: [{ description: 'V82B IA-08a', quantity: 1, unitPrice: 80 }],
      });
    } finally {
      commerce.assertContactInBusiness = original;
    }
    expect(sentInWindow, 'the Send ran inside the edit').toBe(true);
    expect.soft(res.status, JSON.stringify(res.body)).toBe(409);
    expect.soft(String(res.body?.message ?? '')).toMatch(AMOUNTS_REFUSED('SENT'));
    expect.soft(emitted).not.toContain('invoice.updated');
    const row = await snapshot(inv.id);
    expect.soft({ status: row.status, total: row.total }, 'RED: SENT with total 80 and AR 100').toEqual({ status: 'SENT', total: 100 });
    expect.soft(await ledgerArCents(ID.acc, inv.id)).toBe(10_000);
  }, 60_000);

  it('IA-08b: ten concurrent {PATCH items to 80, Send} pairs on DRAFT 100: each invoice ends SENT with its ledger AR equal to its total', async () => {
    for (let n = 0; n < 10; n += 1) {
      const inv = await createDraft(ID.acc, [{ description: `V82B IA-08b ${n}`, quantity: 1, unitPrice: 100 }]);
      const [edit, sent] = await Promise.all([
        patchInvoice(ID.acc, inv.id, { items: [{ description: `V82B IA-08b ${n}`, quantity: 1, unitPrice: 80 }] }),
        as(agent().patch(`/commerce/invoices/${inv.id}/status/sent`)).send({ businessId: ID.acc, status: 'SENT' }),
      ]);
      // Both orders are legal: the edit commits first (the Send posts 80) or
      // the Send does (the edit reads SENT and is refused 409).
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect([200, 409], JSON.stringify(edit.body)).toContain(edit.status);
      const expected = edit.status === 200 ? 8_000 : 10_000;
      const row = await snapshot(inv.id);
      expect.soft(
        { status: row.status, total: cents(row.total), ar: await ledgerArCents(ID.acc, inv.id) },
        `pair ${n}: edit answered ${edit.status}`,
      ).toEqual({ status: 'SENT', total: expected, ar: expected });
    }
  }, 120_000);
});

describe('D-89: an invoice edit that would bring its total below the money it holds is refused (W3-D89-OVERPAID-EDIT; real rows)', () => {
  /** A CASH invoice of 100 sent and paid `amounts` in turn (CASH: no invoice-sourced posting). */
  async function paidCashInvoice(label: string, amounts: number[]) {
    const id = await sent100(ID.cash, label);
    const payments: string[] = [];
    for (const amount of amounts) {
      const res = await pay(ID.cash, id, amount);
      payments.push(res.body.payment.id);
    }
    return { id, payments };
  }
  /** The AI undo returns it to DRAFT; nothing invoice-sourced is posted, so D-60 (holdsIssuedMoney) leaves its amounts editable. */
  async function undo(id: string) {
    const undone = await commerce.undoInvoice(id, ID.cash);
    expect(undone.status).toBe('reverted_to_draft');
    const row = await snapshot(id);
    expect(row.status, 'the undo writes the status alone').toBe('DRAFT');
    expect(
      await db.financialTransaction.count({ where: { businessId: ID.cash, sourceType: 'Invoice', sourceId: id } }),
      'CASH: no invoice-sourced posting, so D-60 does not fix its amounts',
    ).toBe(0);
    return row;
  }
  const line = (label: string, unitPrice: number) => ({ items: [{ description: `V82B ${label}`, quantity: 1, unitPrice }] });

  it('IA-09a D-89 RED-BEFORE: a CASH invoice of 100 sent, paid 60 and undone to DRAFT: PATCH items to 50 or 59.99, or a FIXED discount of 50 -> 409, nothing written; items to 60 or 80 -> 200; a FIXED discount of 20 on 80 -> 200 at 60', async () => {
    const { id } = await paidCashInvoice('IA-09a', [60]);
    expect((await snapshot(id)).status).toBe('PARTIALLY_PAID');
    const before = await undo(id);
    expect(before.total).toBe(100);

    for (const body of [line('IA-09a', 50), line('IA-09a', 59.99), { discountType: 'FIXED', discountValue: 50 }]) {
      emitted.length = 0;
      const res = await patchInvoice(ID.cash, id, body);
      await expectRefused(res, HELD_REFUSED('60.00'), before, id, [...emitted]);
    }

    const at60 = await patchInvoice(ID.cash, id, line('IA-09a', 60));
    expect(at60.status, JSON.stringify(at60.body)).toBe(200);
    expect(at60.body.total, 'a total equal to the money held is allowed').toBe(60);
    const at80 = await patchInvoice(ID.cash, id, line('IA-09a', 80));
    expect(at80.status, JSON.stringify(at80.body)).toBe(200);
    expect(at80.body.total).toBe(80);
    const discounted = await patchInvoice(ID.cash, id, { discountType: 'FIXED', discountValue: 20 });
    expect(discounted.status, JSON.stringify(discounted.body)).toBe(200);
    expect(discounted.body.total, 'the tax/discount door is held to the same floor').toBe(60);
    const row = await snapshot(id);
    expect({ status: row.status, total: row.total }).toEqual({ status: 'DRAFT', total: 60 });
  }, 60_000);

  it('IA-09b D-89 RED-BEFORE: refunds net out: paid 20 and 40, the 40 refunded (net held 20), undone to DRAFT: PATCH items to 19.99 -> 409; to 30 -> 200 and to 20 -> 200', async () => {
    const { id, payments } = await paidCashInvoice('IA-09b', [20, 40]);
    const refund = await as(agent().post(`/commerce/businesses/${ID.cash}/payments/${payments[1]}/refund`)).send({ reason: 'V82B IA-09b' });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(Number(refund.body.amount)).toBe(-40);
    const before = await undo(id);

    emitted.length = 0;
    const short = await patchInvoice(ID.cash, id, line('IA-09b', 19.99));
    await expectRefused(short, HELD_REFUSED('20.00'), before, id, [...emitted]);

    const at30 = await patchInvoice(ID.cash, id, line('IA-09b', 30));
    expect(at30.status, `the refunded 40 is not held: ${JSON.stringify(at30.body)}`).toBe(200);
    expect(at30.body.total).toBe(30);
    const at20 = await patchInvoice(ID.cash, id, line('IA-09b', 20));
    expect(at20.status, JSON.stringify(at20.body)).toBe(200);
    expect(at20.body.total).toBe(20);
  }, 60_000);

  it('IA-09c D-89 RED-BEFORE (M31, D-75): another tenant\'s payment row on the invoice does not count toward the money it holds: paid 20, undone, a foreign SUCCESSFUL row of 70: PATCH items to 30 -> 200; to 10 -> 409', async () => {
    const { id } = await paidCashInvoice('IA-09c', [20]);
    await undo(id);
    // Payment sits outside the tenant extension and has no FK to Business (M31):
    // a row carrying another businessId on this invoice is not its money (D-75).
    await db.payment.create({
      data: {
        id: `${P}pay_foreign_09c`,
        amount: 70,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pay_foreign_09c`,
        businessId: ID.acc,
        invoiceId: id,
      },
    });

    const at30 = await patchInvoice(ID.cash, id, line('IA-09c', 30));
    expect(at30.status, `only the invoice's own 20 is held: ${JSON.stringify(at30.body)}`).toBe(200);
    expect(at30.body.total).toBe(30);

    const before = await snapshot(id);
    emitted.length = 0;
    const short = await patchInvoice(ID.cash, id, line('IA-09c', 10));
    await expectRefused(short, HELD_REFUSED('20.00'), before, id, [...emitted]);
  }, 60_000);

  it('IA-09d D-89 review repair (SEC-D89-1): 1000 FAILED payment rows on the invoice, under another business or its own, do not hide the money it holds from the guard: paid 60, undone, PATCH items to 10 -> 409; to 60 -> 200', async () => {
    for (const [tag, rowsBusiness] of [['foreign', ID.acc], ['own', ID.cash]] as const) {
      const id = await sent100(ID.cash, `IA-09d ${tag}`);
      // Planted before the payment, with ids that sort before a cuid: a capped
      // read (the db client's default take of 1000) returned only these. Not
      // money: FAILED rows (and another tenant's rows, M31, D-75) hold nothing.
      await db.$executeRawUnsafe(
        `INSERT INTO payments (id, amount, currency, status, provider, method, provider_payment_id, business_id, invoice_id)
         SELECT $1 || lpad(n::text, 4, '0'), 1, 'TTD', 'FAILED', 'cash', 'cash', $1 || lpad(n::text, 4, '0'), $2, $3
           FROM generate_series(1, 1000) AS n`,
        `a0_${P}pay_09d_${tag}_`, rowsBusiness, id,
      );
      await pay(ID.cash, id, 60);
      const before = await undo(id);

      emitted.length = 0;
      const short = await patchInvoice(ID.cash, id, line(`IA-09d ${tag}`, 10));
      await expectRefused(short, HELD_REFUSED('60.00'), before, id, [...emitted]);

      const at60 = await patchInvoice(ID.cash, id, line(`IA-09d ${tag}`, 60));
      expect(at60.status, `${tag}: ${JSON.stringify(at60.body)}`).toBe(200);
      expect(at60.body.total).toBe(60);
    }
  }, 120_000);

  it('IA-09e D-89 review repair (CR-D89-1): an edit that does not lower the total of an invoice already holding more than its total does not bring it below: paid 120 on 100, undone: the web form restating its items with a note, {taxRate:0}, items to 110 and to 130 -> 200; items back to 100 or a FIXED discount on 110 -> 409', async () => {
    const id = await sent100(ID.cash, 'IA-09e');
    await pay(ID.cash, id, 120);
    expect((await snapshot(id)).status, 'an overpayment is recorded as received (recordPayment allows it)').toBe('PAID');
    const undone = await undo(id);
    expect(undone.total).toBe(100);

    // The web edit form sends the items with every edit (invoices-panel.tsx).
    const restated = await patchInvoice(ID.cash, id, { ...line('IA-09e', 100), notes: 'V82B IA-09e note' });
    expect(restated.status, `a restated total of 100 is not brought below the 120 held: ${JSON.stringify(restated.body)}`).toBe(200);
    expect({ total: restated.body.total, notes: restated.body.notes }).toEqual({ total: 100, notes: 'V82B IA-09e note' });
    const taxOnly = await patchInvoice(ID.cash, id, { taxRate: 0 });
    expect(taxOnly.status, JSON.stringify(taxOnly.body)).toBe(200);
    expect(taxOnly.body.total).toBe(100);
    const raised = await patchInvoice(ID.cash, id, line('IA-09e', 110));
    expect(raised.status, `raising the total toward the money held: ${JSON.stringify(raised.body)}`).toBe(200);
    expect(raised.body.total).toBe(110);

    const before = await snapshot(id);
    for (const body of [line('IA-09e', 100), { discountType: 'FIXED', discountValue: 5 }]) {
      emitted.length = 0;
      const lowered = await patchInvoice(ID.cash, id, body);
      await expectRefused(lowered, HELD_REFUSED('120.00'), before, id, [...emitted]);
    }

    const above = await patchInvoice(ID.cash, id, line('IA-09e', 130));
    expect(above.status, JSON.stringify(above.body)).toBe(200);
    expect(above.body.total).toBe(130);
    const row = await snapshot(id);
    expect({ status: row.status, total: row.total }).toEqual({ status: 'DRAFT', total: 130 });
  }, 60_000);
});
