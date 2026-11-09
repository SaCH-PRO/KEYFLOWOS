/**
 * V1-82 (FOLLOW3-B1-VOID-NET-RECEIVED) — no path voids an invoice that still
 * holds money received net (REAL database, REAL ledger posting, REAL invoice
 * workflow).
 *
 * VL-02: the transition map lets PARTIALLY_PAID move to OVERDUE and FAILED,
 * and OVERDUE and FAILED move to VOID (invoice-workflow.service.ts ALLOWED_TRANSITIONS).
 * transition() read only the status, wrote VOID compare-and-set and then
 * called RevenuePostingService.onInvoiceVoided, which reverses the whole
 * invoice_finalized recognition. Nothing read the Payment rows on the way, so
 * a part-paid invoice moved to OVERDUE (or FAILED) and then voided ended VOID
 * with its payment still SUCCESSFUL: on ACCRUAL the ledger read AR -40,
 * income 0 and cash 40; on CASH income 40 stayed on a VOID invoice. Only the
 * direct PARTIALLY_PAID -> VOID move was refused, because the map lacks it.
 *
 * Contract pinned here (D-14: money received is returned by a refund row
 * first; after it nothing is received net and VOID is allowed. D-27: PENDING
 * and FAILED rows are not money received). RED-BEFORE marks a case that fails
 * at the base:
 *
 *   VN-01 RED-BEFORE (ACCRUAL/USD) 100 sent, 40 paid (PARTIALLY_PAID), PATCH status/overdue 200, then
 *         PATCH status/void -> 409 naming the 40 received and saying to refund first; the invoice
 *         stays OVERDUE with paidAt unchanged, the payment rows stay [SUCCESSFUL 40], no invoice.void
 *         is emitted, invoice_finalized stays POSTED, the ledger reads AR 60, income 100, cash 40,
 *         and ledger AR = listPayments remaining = 60
 *   VN-02 RED-BEFORE (CASH/TTD) the same sequence -> 409; income stays 40 on a non-VOID invoice
 *   VN-03 RED-BEFORE (ACCRUAL) PATCH payment-failed 200 FAILED, then void -> 409; FAILED kept, ledger as VN-01
 *   VN-04 RED-BEFORE CommerceService.bulkUpdateInvoices(b, [id], 'void') on the OVERDUE part-paid row
 *         (the KEY bulk path) -> updated 0, the row in failed[] with that reason, nothing reversed
 *   VN-05 controls: an OVERDUE invoice never paid voids 200 and its AR is reversed to 0; an OVERDUE
 *         invoice with 40 paid and 40 refunded (net 0) voids 200; DRAFT -> VOID answers 200;
 *         PARTIALLY_PAID -> VOID answers 409 'Illegal invoice status transition: PARTIALLY_PAID -> VOID';
 *         a PAID invoice cannot reach VOID (void, overdue, payment-failed and bulk void all refused)
 *   VN-06 race: rounds of Promise.allSettled([POST payment 40, PATCH status/void]) on a fresh SENT
 *         invoice. Invariant: never VOID with net received > 0. Either the void wins and the payment is
 *         refused 4xx with no SUCCESSFUL row, or the payment wins and the void answers 409. Recorded
 *         either way; not required to go red at the base (the compare-and-set already catches it there).
 *   VN-07 the void's lock orders it against the doors that take the same invoice row lock, pinned
 *         deterministically (review SEC-V82-1 / CR-B1-1 narrowed the claim to these doors):
 *         (a) POST payment (recordPayment) sent while transition(VOID) holds the lock, after its payment
 *             read: it is still waiting 1.5 s later, then answers 409 'Cannot record payment on a VOID
 *             invoice'; the invoice ends VOID, net 0, ledger all 0 / REVERSED
 *         (b) a transaction that takes the lock first (SELECT ... FOR NO KEY UPDATE, as
 *             PaymentsService.lockInvoice) and records a SUCCESSFUL 40 with its posting: PATCH status/void
 *             sent while it is open is still waiting 1.5 s later, then answers 409 naming the 40; after
 *             reconcileFromPayments the invoice is PARTIALLY_PAID with AR 60 / income 100 / cash 40
 *   VN-08 W3-VOID-PROVIDER-RACE (FOLLOW4; the todo SEC-V82-1 / CR-B1-1 left; the D-76 pattern): the
 *         provider settlement doors (PaymentsService.createPaymentWithPosting: the Stripe charge / session
 *         webhook, the PayPal capture webhook, the WiPay callback, capturePaypalOrder) took no invoice
 *         lock and did not re-check VOID in their transaction, so a provider payment that arrived after
 *         the void, or committed while the void decided, ended on the VOID invoice (net 40, ledger
 *         AR -40 / income 0 / cash 40 / REVERSED). Pinned now: each door takes PaymentsService.lockInvoice
 *         inside its transaction and re-reads the status; a VOID invoice's payment is not recorded as money
 *         on it (no Payment row, no posting), the delivery's webhook_events row is kept marked
 *         'refused:invoice_void' with the invoice's business (a redelivery is a no-op), and the owner gets
 *         one 'payment.refused' notification per payment to settle it by hand.
 *         (a) serial Stripe, (b) serial PayPal webhook, (c) serial WiPay (CASH/TTD) after the void;
 *         (d) race: a Stripe delivery sent while transition(VOID) holds the lock waits on it (nothing
 *             committed while the void decides) and is then refused;
 *         (e) race: capturePaypalOrder, PayPal capturing while the void decides, waits on the lock, is
 *             refused 409, and PayPal's own capture webhook for it later is refused with no second notice;
 *         (f) control: a Stripe and a PayPal success for a SENT invoice record as before.
 *         Review repairs: (g) / (h) SEC-VN08-1 (D-76: a refusal is kept insert-only): a WiPay refusal
 *             before the claim, and a Stripe delivery with no event id, never rewrite a webhook_events
 *             row another business holds under the key they chose;
 *         (i) CR-VPR-1: PayPal's refund of a refused capture records no REFUNDED row on the VOID
 *             invoice (net stays 0, ledger 0) and its event is kept refused:invoice_void.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed: the plan allows
 * invoices), PublicRateLimitGuard (real Redis, keys namespaced to this run),
 * CommerceController, PaymentsController, PaymentsService, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows behind the production GlobalHttpExceptionFilter, ValidationPipe and
 * TenantInterceptor. Identity attachment is the one stand-in: a test middleware
 * reads `x-v82a-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 * The event bus is a recorder; the contact timeline, TimelineService, stats
 * cache and the AI / Gmail / Drive services are stubs off the boundary;
 * ExpensePostingService (COGS on PAID) is a no-op stub (no line is a product).
 * VN-08's provider edges are the stand-ins (no provider traffic): Stripe
 * deliveries are signed with the ACCRUAL business's own webhook secret, WiPay's
 * hash is computed as WiPay computes it with the CASH business's own key,
 * PayPal's signature verification (a network call) is stubbed, and the PayPal
 * SDK client is stubbed at getPaypalClient.
 *
 * Fixtures: prefix `v82a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in beforeAll
 * and afterAll; no $transaction wrapping. Rows the server creates get server
 * ids under the prefixed businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82a_';
const HEADER = 'x-v82a-user';
/** VN-08: the ACCRUAL business's own Stripe webhook secret and the CASH business's own WiPay key (business.metaData). */
const STRIPE_SECRET = `whsec_${P}stripe`;
const WIPAY_KEY = `${P}wipay_key`;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;

const ID = {
  owner: `${P}owner`,
  bizAcc: `${P}biz_acc`,
  bizCash: `${P}biz_cash`,
  contactAcc: `${P}contact_acc`,
  contactCash: `${P}contact_cash`,
};
const CONTACT: Record<string, string> = { [ID.bizAcc]: ID.contactAcc, [ID.bizCash]: ID.contactCash };

const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let commerce: any;
let workflow: any;
let revenuePosting: any;
let payments: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string | null) => any;

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

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

let refSeq = 0;
function pay(biz: string, invoiceId: string, amount: number) {
  refSeq += 1;
  return as(agent().post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)).send({
    amount,
    method: 'cash',
    reference: `${P}ref_${refSeq}`,
  });
}
function setStatus(biz: string, invoiceId: string, status: 'SENT' | 'OVERDUE' | 'VOID') {
  return as(agent().patch(`/commerce/invoices/${invoiceId}/status/${status.toLowerCase()}`)).send({ businessId: biz, status });
}
function paymentFailed(biz: string, invoiceId: string) {
  return as(agent().patch(`/commerce/invoices/${invoiceId}/payment-failed`)).send({ businessId: biz, reason: 'v82a card declined' });
}
function listPayments(biz: string, invoiceId: string) {
  return as(agent().get(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`));
}
function refund(biz: string, paymentId: string) {
  return as(agent().post(`/commerce/businesses/${biz}/payments/${paymentId}/refund`)).send({ reason: 'v82a refund' });
}

async function invoiceRow(id: string): Promise<any> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT status::text AS status, paid_at AS "paidAt", total, currency, business_id AS "businessId" FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function paymentRows(invoiceId: string): Promise<Array<{ id: string; status: string; amount: number; businessId: string }>> {
  const rows: any[] = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, status: r.status, amount: Number(r.amount), businessId: r.businessId }));
}

/** The invoice's net received over its own-tenant stored rows (balanceOfStoredRows, D-14 / D-27). */
async function netReceived(invoiceId: string): Promise<number> {
  const inv = await invoiceRow(invoiceId);
  const rows = (await paymentRows(invoiceId)).filter((r) => r.businessId === inv.businessId);
  return storedBalanceFn(Number(inv.total), rows, inv.currency).net;
}

/**
 * The invoice's ledger: every FinancialTransaction it sourced (its recognition
 * and any reversal) plus those of its payments (the payment postings and any
 * refund reversal). AR = debit - credit on ACCOUNTS_RECEIVABLE, income =
 * credit - debit on every REVENUE* account, cash = debit - credit on the
 * deposit accounts. `finalized` is the invoice_finalized posting's status
 * (null on CASH, which recognises nothing on issue).
 */
async function ledgerOf(biz: string, invoiceId: string) {
  const payIds = (await paymentRows(invoiceId)).map((p) => p.id);
  const txs: any[] = await db.financialTransaction.findMany({
    where: {
      businessId: biz,
      OR: [
        { sourceType: 'Invoice', sourceId: invoiceId },
        { sourceType: 'Payment', sourceId: { in: payIds } },
      ],
    },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  let ar = 0;
  let income = 0;
  let cash = 0;
  for (const t of txs) {
    for (const e of t.entries) {
      const key: string = e.account?.systemKey ?? '';
      const d = cents(e.debit);
      const c = cents(e.credit);
      if (key === 'ACCOUNTS_RECEIVABLE') ar += d - c;
      else if (key.startsWith('REVENUE')) income += c - d;
      else if (DEPOSIT_KEYS.has(key)) cash += d - c;
    }
  }
  const finalized = txs.find((t) => t.externalRef === `Invoice:${invoiceId}:invoice_finalized`);
  return { ar: ar / 100, income: income / 100, cash: cash / 100, finalized: (finalized?.status as string | undefined) ?? null };
}

function voidEventsFor(invoiceId: string) {
  return emitted.filter((e) => e.name === 'invoice.void' && e.payload?.invoice?.id === invoiceId);
}

/**
 * The transaction client `tx`, with `hook` run once right after
 * transition(VOID) has read the invoice's payments (assertNothingReceivedNet),
 * while the void holds the invoice row lock and has not written VOID yet.
 * Every other call goes to `tx` unchanged.
 */
function afterPaymentRead(tx: any, hook: () => Promise<void>) {
  const bound = (target: any, key: PropertyKey) => {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  let fired = false;
  return new Proxy(tx, {
    get(target, key) {
      if (key !== 'payment') return bound(target, key);
      return new Proxy(target.payment, {
        get(delegate, k) {
          if (k !== 'findMany') return bound(delegate, k);
          return async (args: unknown) => {
            const rows = await delegate.findMany(args);
            if (!fired) {
              fired = true;
              await hook();
            }
            return rows;
          };
        },
      });
    },
  });
}

/** A DRAFT invoice of 100 in the business's currency. Invoice numbers default to INV-<ms>: space the creates. */
async function draft(biz: string) {
  await sleep(3);
  const res = await as(agent().post(`/commerce/businesses/${biz}/invoices`)).send({
    contactId: CONTACT[biz],
    items: [{ description: 'V82A work', quantity: 1, unitPrice: 100 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body).toMatchObject({ status: 'DRAFT', total: 100 });
  return res.body.id as string;
}

async function sent(biz: string) {
  const id = await draft(biz);
  const res = await setStatus(biz, id, 'SENT');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('SENT');
  return id;
}

/** DRAFT 100, sent, paid 40: PARTIALLY_PAID with one SUCCESSFUL 40 row. */
async function partPaid(biz: string) {
  const id = await sent(biz);
  const res = await pay(biz, id, 40);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect((await invoiceRow(id)).status).toBe('PARTIALLY_PAID');
  return { id, paymentId: res.body.payment.id as string };
}

async function overdue(biz: string, id: string) {
  const res = await setStatus(biz, id, 'OVERDUE');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('OVERDUE');
}

/**
 * PATCH status/void expected to be refused 409. A void that went through
 * reports the status and the ledger it left behind (the RED-BEFORE evidence).
 */
async function expectVoidRefused(biz: string, id: string) {
  const res = await setStatus(biz, id, 'VOID');
  if (res.status !== 409) {
    const after = {
      invoice: (await invoiceRow(id))?.status,
      ledger: await ledgerOf(biz, id),
      payments: (await paymentRows(id)).map((p) => [p.status, p.amount]),
    };
    const answer = res.status < 400 ? `status ${res.body?.status}` : `message ${JSON.stringify(res.body?.message)}`;
    expect(res.status, `void answered ${res.status} (${answer}); left ${JSON.stringify(after)}`).toBe(409);
  }
  return res;
}

/** The refusal message names the net received and says to refund it first. */
function expectNetReceivedRefusal(message: unknown) {
  expect(typeof message).toBe('string');
  expect(message as string).toMatch(/40\.00/);
  expect(message as string).toMatch(/received/i);
  expect(message as string).toMatch(/refund .*first/i);
}

/** What a refused void must leave: the status held, paidAt unchanged, [SUCCESSFUL 40], no invoice.void. */
async function expectUntouched(id: string, status: string, paidAtBefore: unknown) {
  const inv = await invoiceRow(id);
  expect(inv.status).toBe(status);
  expect(inv.paidAt).toEqual(paidAtBefore);
  expect((await paymentRows(id)).map((p) => [p.status, p.amount])).toEqual([['SUCCESSFUL', 40]]);
  expect(voidEventsFor(id)).toHaveLength(0);
}

/** ACCRUAL after a refused void: the recognition stays POSTED; AR 60, income 100, cash 40; ledger AR = listPayments remaining. */
async function expectAccrualPartPaidLedger(id: string) {
  const ledger = await ledgerOf(ID.bizAcc, id);
  expect(ledger).toEqual({ ar: 60, income: 100, cash: 40, finalized: 'POSTED' });
  const listed = await listPayments(ID.bizAcc, id);
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body).toMatchObject({ paidAmount: 40, remaining: 60 });
  expect(ledger.ar).toBe(listed.body.remaining);
}

beforeAll(async () => {
  // This run's own rate-limit keys (PublicRateLimitGuard reads it in NODE_ENV=test).
  process.env.RATE_LIMIT_KEY_NAMESPACE = `${P}${Date.now()}`;
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
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
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
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, PaymentsController],
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
      // VN-08: the provider settlement doors (the Stripe and PayPal webhooks, the WiPay callback, capturePaypalOrder).
      PaymentsService,
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: the recognition, the payment postings and every reversal are real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
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
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  workflow = moduleRef.get(workflowMod.InvoiceWorkflowService);
  revenuePosting = moduleRef.get(RevenuePostingService);
  payments = moduleRef.get(PaymentsService);
  // PayPal's verify-webhook-signature is a network call: the provider edge is stubbed.
  vi.spyOn(payments, 'verifyPaypalSignature').mockResolvedValue(true);

  // rawBody: the Stripe and PayPal webhooks read the raw payload, as in app-bootstrap.
  app = moduleRef.createNestApplication({ rawBody: true });
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
  // ACCRUAL/USD: issuing posts the recognition (Dr AR / Cr revenue), a payment clears AR.
  await db.business.create({
    data: {
      id: ID.bizAcc,
      name: 'V82A Accrual',
      slug: `${P}biz_acc`,
      ownerId: ID.owner,
      currency: 'USD',
      accountingBasis: 'ACCRUAL',
      metaData: { stripeWebhookSecret: STRIPE_SECRET },
    },
  });
  // CASH/TTD: issuing posts nothing, a payment posts Dr cash / Cr revenue.
  await db.business.create({
    data: {
      id: ID.bizCash,
      name: 'V82A Cash',
      slug: `${P}biz_cash`,
      ownerId: ID.owner,
      currency: 'TTD',
      accountingBasis: 'CASH',
      metaData: { wipayApiKey: WIPAY_KEY },
    },
  });
  for (const biz of [ID.bizAcc, ID.bizCash]) {
    await db.membership.create({ data: { id: `${P}m_${biz}`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({
      data: { id: CONTACT[biz], businessId: biz, firstName: 'V82A', lastName: 'Customer', email: `${P}c_${biz.slice(P.length)}@test.local` },
    });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  }
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

describe('fixture sanity (real rows)', () => {
  it('an ACCRUAL/USD and a CASH/TTD business, each with an owner, a contact and its system accounts; a part-paid invoice reads PARTIALLY_PAID with AR 60 on ACCRUAL', async () => {
    const acc = await db.business.findUnique({ where: { id: ID.bizAcc } });
    const cashBiz = await db.business.findUnique({ where: { id: ID.bizCash } });
    expect([acc.accountingBasis, acc.currency]).toEqual(['ACCRUAL', 'USD']);
    expect([cashBiz.accountingBasis, cashBiz.currency]).toEqual(['CASH', 'TTD']);
    for (const biz of [ID.bizAcc, ID.bizCash]) {
      const keys = (await db.chartOfAccount.findMany({ where: { businessId: biz, isSystem: true }, select: { systemKey: true } })).map(
        (a: any) => a.systemKey,
      );
      expect(keys).toEqual(expect.arrayContaining(['ACCOUNTS_RECEIVABLE', 'REVENUE', 'CASH']));
    }
    const { id } = await partPaid(ID.bizAcc);
    expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 60, income: 100, cash: 40, finalized: 'POSTED' });
    expect((await invoiceRow(id)).currency).toBe('USD');
  });
});

describe('V1-82 no path voids an invoice that still holds money received net (real rows)', () => {
  it('VN-01 RED-BEFORE (ACCRUAL/USD): part-paid 40, PATCH status/overdue 200, then PATCH status/void -> 409 naming the 40 received; OVERDUE kept, [SUCCESSFUL 40], no invoice.void, recognition POSTED, AR 60 / income 100 / cash 40 = listPayments remaining', async () => {
    const { id } = await partPaid(ID.bizAcc);
    await overdue(ID.bizAcc, id);
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const res = await expectVoidRefused(ID.bizAcc, id);
    expectNetReceivedRefusal(res.body.message);

    await expectUntouched(id, 'OVERDUE', paidAtBefore);
    await expectAccrualPartPaidLedger(id);
  });

  it('VN-02 RED-BEFORE (CASH/TTD): the same sequence -> 409; OVERDUE kept, [SUCCESSFUL 40], no invoice.void, income stays 40 on a non-VOID invoice', async () => {
    const { id } = await partPaid(ID.bizCash);
    await overdue(ID.bizCash, id);
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const res = await expectVoidRefused(ID.bizCash, id);
    expectNetReceivedRefusal(res.body.message);

    await expectUntouched(id, 'OVERDUE', paidAtBefore);
    expect(await ledgerOf(ID.bizCash, id)).toEqual({ ar: 0, income: 40, cash: 40, finalized: null });
    const listed = await listPayments(ID.bizCash, id);
    expect(listed.body).toMatchObject({ paidAmount: 40, remaining: 60 });
  });

  it('VN-03 RED-BEFORE (ACCRUAL): PATCH payment-failed answers 200 FAILED, then void -> 409; FAILED kept, the ledger as VN-01', async () => {
    const { id } = await partPaid(ID.bizAcc);
    const failed = await paymentFailed(ID.bizAcc, id);
    expect(failed.status, JSON.stringify(failed.body)).toBe(200);
    expect(failed.body.status).toBe('FAILED');
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const res = await expectVoidRefused(ID.bizAcc, id);
    expectNetReceivedRefusal(res.body.message);

    await expectUntouched(id, 'FAILED', paidAtBefore);
    await expectAccrualPartPaidLedger(id);
  });

  it('VN-04 RED-BEFORE: CommerceService.bulkUpdateInvoices(b, [id], "void") on the OVERDUE part-paid row (the KEY bulk path) -> updated 0, the row in failed[] with the refusal, nothing reversed', async () => {
    const { id } = await partPaid(ID.bizAcc);
    await overdue(ID.bizAcc, id);
    const paidAtBefore = (await invoiceRow(id)).paidAt;

    const result = await commerce.bulkUpdateInvoices(ID.bizAcc, [id], 'void');
    if (result.updated !== 0) {
      const after = { invoice: (await invoiceRow(id))?.status, ledger: await ledgerOf(ID.bizAcc, id) };
      expect(result.updated, `bulk ${JSON.stringify(result)}; left ${JSON.stringify(after)}`).toBe(0);
    }
    expect(result).toMatchObject({ updated: 0, action: 'void', failedCount: 1 });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(id);
    expectNetReceivedRefusal(result.failed[0].reason);

    await expectUntouched(id, 'OVERDUE', paidAtBefore);
    await expectAccrualPartPaidLedger(id);
  });

  describe('VN-05 controls', () => {
    it('an OVERDUE invoice that was never paid voids 200 and its AR is reversed to 0 (one invoice.void)', async () => {
      const id = await sent(ID.bizAcc);
      await overdue(ID.bizAcc, id);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 100, income: 100, cash: 0, finalized: 'POSTED' });

      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('VOID');
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      expect(voidEventsFor(id)).toHaveLength(1);
    });

    it('an OVERDUE invoice with 40 paid and 40 refunded (net 0) voids 200: AR, income and cash all 0', async () => {
      const { id, paymentId } = await partPaid(ID.bizAcc);
      await overdue(ID.bizAcc, id);
      const refunded = await refund(ID.bizAcc, paymentId);
      expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
      expect((await invoiceRow(id)).status, 'a refund does not reopen OVERDUE').toBe('OVERDUE');
      expect((await paymentRows(id)).map((p) => [p.status, p.amount])).toEqual([
        ['SUCCESSFUL', 40],
        ['REFUNDED', -40],
      ]);
      expect(await netReceived(id)).toBe(0);

      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('VOID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      expect(voidEventsFor(id)).toHaveLength(1);
    });

    it('DRAFT -> VOID answers 200', async () => {
      const id = await draft(ID.bizAcc);
      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('VOID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: null });
    });

    it("PARTIALLY_PAID -> VOID answers 409 with the unchanged message 'Illegal invoice status transition: PARTIALLY_PAID -> VOID'", async () => {
      const { id } = await partPaid(ID.bizAcc);
      const res = await setStatus(ID.bizAcc, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.message).toBe('Illegal invoice status transition: PARTIALLY_PAID -> VOID');
      await expectUntouched(id, 'PARTIALLY_PAID', null);
      await expectAccrualPartPaidLedger(id);
    });

    it('a PAID invoice cannot reach VOID: void, overdue and payment-failed are refused 409 and bulk void lists it failed; it stays PAID', async () => {
      const id = await sent(ID.bizAcc);
      const settled = await pay(ID.bizAcc, id, 100);
      expect(settled.status, JSON.stringify(settled.body)).toBe(201);
      const before = await invoiceRow(id);
      expect(before.status).toBe('PAID');

      const voided = await setStatus(ID.bizAcc, id, 'VOID');
      expect(voided.status, JSON.stringify(voided.body)).toBe(409);
      expect(voided.body.message).toBe('Illegal invoice status transition: PAID -> VOID');
      expect((await setStatus(ID.bizAcc, id, 'OVERDUE')).status).toBe(409);
      expect((await paymentFailed(ID.bizAcc, id)).status).toBe(409);
      const bulk = await commerce.bulkUpdateInvoices(ID.bizAcc, [id], 'void');
      expect(bulk).toMatchObject({ updated: 0, failedCount: 1 });

      const after = await invoiceRow(id);
      expect(after.status).toBe('PAID');
      expect(after.paidAt).toEqual(before.paidAt);
      expect(voidEventsFor(id)).toHaveLength(0);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 100, cash: 100, finalized: 'POSTED' });
    });
  });

  it('VN-06 race: Promise.allSettled([POST payment 40, PATCH status/void]) on a fresh SENT invoice never ends VOID with net received > 0; exactly one side wins each round', async () => {
    const ROUNDS = 8;
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const id = await sent(ID.bizAcc);
      const calls = [pay(ID.bizAcc, id, 40), setStatus(ID.bizAcc, id, 'VOID')];
      // Alternate which request is put on the wire first.
      const settled = await Promise.allSettled(round % 2 === 0 ? calls : [calls[1], calls[0]]);
      const [payRes, voidRes] = (round % 2 === 0 ? settled : [settled[1], settled[0]]).map((s) =>
        s.status === 'fulfilled' ? s.value : ({ status: 0, body: { error: String(s.reason) } } as any),
      );
      const inv = await invoiceRow(id);
      const net = await netReceived(id);
      const successful = (await paymentRows(id)).filter((p) => p.status === 'SUCCESSFUL');
      const line = `round ${round}: payment ${payRes.status}, void ${voidRes.status}, final ${inv.status}, net ${net}`;
      outcomes.push(line);

      // The invariant.
      expect(inv.status === 'VOID' && net > 0, `${line}: VOID with money received net`).toBe(false);
      if (voidRes.status === 200) {
        // The void won: the payment is refused 4xx and wrote no SUCCESSFUL row; the recognition is reversed.
        expect(payRes.status, line).toBeGreaterThanOrEqual(400);
        expect(payRes.status, line).toBeLessThan(500);
        expect(successful, line).toHaveLength(0);
        expect(inv.status, line).toBe('VOID');
        expect(await ledgerOf(ID.bizAcc, id), line).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      } else {
        // The payment won: the void is refused 409.
        expect(payRes.status, line).toBe(201);
        expect(voidRes.status, line).toBe(409);
        expect(successful.map((p) => p.amount), line).toEqual([40]);
        expect(inv.status, line).toBe('PARTIALLY_PAID');
        expect(await ledgerOf(ID.bizAcc, id), line).toEqual({ ar: 60, income: 100, cash: 40, finalized: 'POSTED' });
      }
    }
    // Recorded for the packet evidence either way.
    console.log(`[v82a VN-06]\n${outcomes.join('\n')}`);
  });

  describe('VN-07 the void is ordered against the doors that take the invoice row lock (review SEC-V82-1 / CR-B1-1)', () => {
    it('(a) POST payment sent while transition(VOID) holds the lock, after its payment read, waits for the decision, then answers 409 on the VOID invoice; VOID, no payment row, net 0, ledger all 0 / REVERSED', async () => {
      const id = await sent(ID.bizAcc);
      let payment: Promise<any> | undefined;
      let whileVoidDecides: unknown;
      await db.$transaction(
        async (tx: any) => {
          await workflow.transition(id, 'VOID', {
            tx: afterPaymentRead(tx, async () => {
              payment = pay(ID.bizAcc, id, 40).then((r) => r);
              whileVoidDecides = await Promise.race([
                payment.then((r: any) => `answered ${r.status}`),
                sleep(1500).then(() => 'waiting'),
              ]);
            }),
          });
        },
        { timeout: 30_000 },
      );
      expect(whileVoidDecides, 'the payment door waits on the invoice row lock the void holds').toBe('waiting');

      const res = await payment!;
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.message).toBe('Cannot record payment on a VOID invoice');
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await paymentRows(id)).toEqual([]);
      expect(await netReceived(id)).toBe(0);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
    });

    it('(b) a payment transaction that took the lock first (as PaymentsService.lockInvoice) and holds an uncommitted SUCCESSFUL 40 with its posting: PATCH status/void waits for it, then answers 409 naming the 40; no invoice.void, and after reconcileFromPayments PARTIALLY_PAID with AR 60 / income 100 / cash 40', async () => {
      const id = await sent(ID.bizAcc);
      let voided: Promise<any> | undefined;
      let whilePaymentOpen: unknown;
      await db.$transaction(
        async (tx: any) => {
          await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR NO KEY UPDATE`;
          const row = await tx.payment.create({
            data: {
              provider: 'stripe',
              providerPaymentId: `${P}pi_${id}`,
              amount: 40,
              currency: 'USD',
              status: 'SUCCESSFUL',
              invoiceId: id,
              businessId: ID.bizAcc,
            },
          });
          await revenuePosting.onPaymentRecorded(row.id, { tx });
          voided = setStatus(ID.bizAcc, id, 'VOID').then((r) => r);
          whilePaymentOpen = await Promise.race([
            voided.then((r: any) => `answered ${r.status}`),
            sleep(1500).then(() => 'waiting'),
          ]);
        },
        { timeout: 30_000 },
      );
      expect(whilePaymentOpen, 'the void waits on the invoice row lock the payment holds').toBe('waiting');

      const res = await voided!;
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expectNetReceivedRefusal(res.body.message);
      expect(voidEventsFor(id)).toHaveLength(0);

      await workflow.reconcileFromPayments(id);
      expect((await invoiceRow(id)).status).toBe('PARTIALLY_PAID');
      expect(await netReceived(id)).toBe(40);
      await expectAccrualPartPaidLedger(id);
    });
  });

  describe('VN-08 W3-VOID-PROVIDER-RACE: a provider payment for a VOID invoice is not recorded as money on it (the D-76 pattern; review SEC-V82-1 / CR-B1-1)', () => {
    let seq = 0;
    const next = () => (seq += 1);

    /** A Stripe checkout.session.completed that took `amount` for `invoiceId` (a session the ACCRUAL business made). */
    function stripeEvent(invoiceId: string, amount: number) {
      const n = next();
      return {
        id: `${P}evt_${n}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `${P}cs_${n}`,
            object: 'checkout.session',
            payment_status: 'paid',
            amount_total: Math.round(amount * 100),
            currency: 'usd',
            payment_intent: `${P}pi_${n}`,
            metadata: { invoiceId, businessId: ID.bizAcc },
          },
        },
      };
    }
    /** A Stripe delivery of `event`, signed with the ACCRUAL business's own webhook secret as Stripe signs it. */
    function stripeDeliver(event: Record<string, unknown>) {
      const raw = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const signature = `t=${t},v1=${createHmac('sha256', STRIPE_SECRET).update(`${t}.${raw}`).digest('hex')}`;
      return agent().post('/payments/stripe/webhook').set('content-type', 'application/json').set('stripe-signature', signature).send(raw);
    }
    /** PayPal's PAYMENT.CAPTURE.COMPLETED for `captureId` on `invoiceId`. */
    function paypalCaptureEvent(invoiceId: string, captureId: string, amount: number) {
      const n = next();
      return {
        id: `${P}WH_${n}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: captureId, custom_id: invoiceId, amount: { value: amount.toFixed(2), currency_code: 'USD' } },
      };
    }
    /** A PayPal delivery of `event` (its signature verification, a network call, is stubbed). */
    function paypalDeliver(event: Record<string, unknown>) {
      return agent().post('/payments/paypal/webhook').set('content-type', 'application/json').send(JSON.stringify(event));
    }
    /** A WiPay success callback, hashed as WiPay hashes it: md5(transaction_id + the requested total + the CASH business's key). */
    function wipayCallback(invoiceId: string, transactionId: string, total: number) {
      const hash = createHash('md5').update(`${transactionId}${total.toFixed(2)}${WIPAY_KEY}`).digest('hex');
      return agent()
        .get('/payments/wipay/callback')
        .query({ order_id: invoiceId, status: 'success', transaction_id: transactionId, total: total.toFixed(2), hash });
    }
    /**
     * The PayPal SDK client, stubbed at getPaypalClient: the order is this
     * invoice's (100 USD) and PayPal captures it as `captureId`.
     */
    function stubPaypalClient(invoiceId: string, orderId: string, captureId: string) {
      return vi.spyOn(payments, 'getPaypalClient').mockReturnValue({
        client: {},
        ordersController: {
          getOrder: async () => ({ result: { purchaseUnits: [{ customId: invoiceId, amount: { value: '100.00', currencyCode: 'USD' } }] } }),
          captureOrder: async () => ({
            result: { id: orderId, status: 'COMPLETED', purchaseUnits: [{ payments: { captures: [{ id: captureId }] } }], payer: {} },
          }),
        },
      });
    }

    async function webhookRow(provider: string, providerEventId: string) {
      return db.webhookEvent.findFirst({ where: { provider, providerEventId }, select: { eventType: true, businessId: true } });
    }

    /** The 'payment.refused' notifications `biz` got for `invoiceId`. */
    async function refusalNotices(biz: string, invoiceId: string): Promise<any[]> {
      const rows: any[] = await db.notification.findMany({ where: { businessId: biz, type: 'payment.refused' }, orderBy: { createdAt: 'asc' } });
      return rows.filter((r) => r.data?.payableId === invoiceId);
    }

    /**
     * What a refused provider payment leaves: no payment row, the invoice VOID
     * with nothing received net, the delivery's webhook_events row kept marked
     * refused:invoice_void with the invoice's business, and exactly one owner
     * notification for the payment telling them to settle it by hand.
     */
    async function expectRefused(biz: string, id: string, provider: string, eventId: string, providerPaymentId: string) {
      expect(await paymentRows(id)).toEqual([]);
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await netReceived(id)).toBe(0);
      expect(await webhookRow(provider, eventId)).toEqual({ eventType: 'refused:invoice_void', businessId: biz });
      const notices = await refusalNotices(biz, id);
      expect(notices).toHaveLength(1);
      expect(notices[0].data).toMatchObject({
        provider,
        transactionId: providerPaymentId,
        payableType: 'invoice',
        payableId: id,
        reason: 'invoice_void',
      });
      expect(notices[0].body).toMatch(/void/i);
      expect(notices[0].body).toMatch(/by hand/i);
    }

    /** A SENT invoice of 100, voided (200). */
    async function voided(biz: string) {
      const id = await sent(biz);
      const res = await setStatus(biz, id, 'VOID');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return id;
    }

    it('VN-08 (a) serial, Stripe: a checkout.session.completed for 40 delivered after the void is acked 201 and records nothing (no payment row, VOID, net 0, ledger all 0 / REVERSED); its event is kept refused:invoice_void and the owner is told once; a redelivery is a duplicate and adds nothing', async () => {
      const id = await voided(ID.bizAcc);
      const event = stripeEvent(id, 40);

      const res = await stripeDeliver(event);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ ok: true, received: true });
      await expectRefused(ID.bizAcc, id, 'stripe', event.id, event.data.object.id);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });

      const again = await stripeDeliver(event);
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      await expectRefused(ID.bizAcc, id, 'stripe', event.id, event.data.object.id);
    });

    it('VN-08 (b) serial, PayPal: a PAYMENT.CAPTURE.COMPLETED for 40 delivered after the void is acked 201 and records nothing; its event is kept refused:invoice_void and the owner is told once', async () => {
      const id = await voided(ID.bizAcc);
      const captureId = `${P}cap_b`;
      const event = paypalCaptureEvent(id, captureId, 40);

      const res = await paypalDeliver(event);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ ok: true, received: true });
      await expectRefused(ID.bizAcc, id, 'paypal', event.id, captureId);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
    });

    it('VN-08 (c) serial, WiPay (CASH/TTD): a verified success callback after the void answers { success: false } naming the void and records nothing; the transaction is kept refused:invoice_void, the owner is told once, and a repeat callback is refused the same way with no second notice', async () => {
      const id = await voided(ID.bizCash);
      const transactionId = `${P}wipay_c`;

      const res = await wipayCallback(id, transactionId, 100);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ success: false, invoiceId: id });
      expect(res.body.message).toMatch(/void/i);
      await expectRefused(ID.bizCash, id, 'wipay', transactionId, transactionId);
      expect(await ledgerOf(ID.bizCash, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: null });

      const again = await wipayCallback(id, transactionId, 100);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({ success: false, invoiceId: id });
      await expectRefused(ID.bizCash, id, 'wipay', transactionId, transactionId);
    });

    it('VN-08 (d) race, Stripe: a delivery sent while transition(VOID) holds the invoice lock (after its payment read) commits no payment while the void decides and waits on the lock; once the void commits it is acked 201 and refused: VOID, net 0, ledger all 0 / REVERSED, event refused:invoice_void, one owner notice', async () => {
      const id = await sent(ID.bizAcc);
      const event = stripeEvent(id, 40);
      let delivery: Promise<any> | undefined;
      let whileVoidDecides: unknown;
      let committedWhileVoidDecides: unknown;
      await db.$transaction(
        async (tx: any) => {
          await workflow.transition(id, 'VOID', {
            tx: afterPaymentRead(tx, async () => {
              delivery = stripeDeliver(event).then((r) => r);
              whileVoidDecides = await Promise.race([
                delivery.then((r: any) => `answered ${r.status}`),
                sleep(1500).then(() => 'waiting'),
              ]);
              committedWhileVoidDecides = (await paymentRows(id)).map((p) => [p.status, p.amount]);
            }),
          });
        },
        { timeout: 30_000 },
      );
      expect(committedWhileVoidDecides, 'no provider payment commits on the invoice while the void decides').toEqual([]);
      expect(whileVoidDecides, 'the Stripe door waits on the invoice row lock the void holds').toBe('waiting');

      const res = await delivery!;
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(voidEventsFor(id)).toHaveLength(1);
      await expectRefused(ID.bizAcc, id, 'stripe', event.id, event.data.object.id);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
    });

    it('VN-08 (e) race, capturePaypalOrder: PayPal captures while transition(VOID) decides; recording the capture waits on the invoice lock, then is refused 409 naming the void: VOID, net 0, ledger all 0 / REVERSED, the capture kept refused:invoice_void, one owner notice; PayPal\'s own capture webhook for it later is refused too with no second notice', async () => {
      const id = await sent(ID.bizAcc);
      const orderId = `${P}order_e`;
      const captureId = `${P}cap_e`;
      const client = stubPaypalClient(id, orderId, captureId);
      try {
        let capture: Promise<{ ok?: unknown; error?: any }> | undefined;
        let whileVoidDecides: unknown;
        let committedWhileVoidDecides: unknown;
        await db.$transaction(
          async (tx: any) => {
            await workflow.transition(id, 'VOID', {
              tx: afterPaymentRead(tx, async () => {
                capture = payments.capturePaypalOrder(orderId, id).then(
                  (ok: unknown) => ({ ok }),
                  (error: unknown) => ({ error }),
                );
                whileVoidDecides = await Promise.race([capture!.then(() => 'answered'), sleep(1500).then(() => 'waiting')]);
                committedWhileVoidDecides = (await paymentRows(id)).map((p) => [p.status, p.amount]);
              }),
            });
          },
          { timeout: 30_000 },
        );
        expect(committedWhileVoidDecides, 'no captured payment commits on the invoice while the void decides').toEqual([]);
        expect(whileVoidDecides, 'recording the capture waits on the invoice row lock the void holds').toBe('waiting');

        const outcome = await capture!;
        expect(outcome.error, `capture answered ${JSON.stringify(outcome.ok ?? null)}`).toBeDefined();
        expect(outcome.error.getStatus?.()).toBe(409);
        expect(outcome.error.message).toMatch(/void/i);
        await expectRefused(ID.bizAcc, id, 'paypal', captureId, captureId);
        expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });

        const event = paypalCaptureEvent(id, captureId, 100);
        const res = await paypalDeliver(event);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        await expectRefused(ID.bizAcc, id, 'paypal', event.id, captureId);
      } finally {
        client.mockRestore();
      }
    });

    it('VN-08 (f) control: a Stripe success (40) and a PayPal capture webhook (40) for a SENT invoice record as before: [SUCCESSFUL 40, SUCCESSFUL 40], PARTIALLY_PAID, AR 20 / income 100 / cash 80, their events kept under their own type, no owner notice', async () => {
      const id = await sent(ID.bizAcc);
      const stripeEvt = stripeEvent(id, 40);
      const stripeRes = await stripeDeliver(stripeEvt);
      expect(stripeRes.status, JSON.stringify(stripeRes.body)).toBe(201);
      const paypalEvt = paypalCaptureEvent(id, `${P}cap_f`, 40);
      const paypalRes = await paypalDeliver(paypalEvt);
      expect(paypalRes.status, JSON.stringify(paypalRes.body)).toBe(201);

      expect((await paymentRows(id)).map((p) => [p.status, p.amount])).toEqual([
        ['SUCCESSFUL', 40],
        ['SUCCESSFUL', 40],
      ]);
      expect((await invoiceRow(id)).status).toBe('PARTIALLY_PAID');
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 20, income: 100, cash: 80, finalized: 'POSTED' });
      expect(await webhookRow('stripe', stripeEvt.id)).toMatchObject({ eventType: 'checkout.session.completed' });
      expect(await webhookRow('paypal', paypalEvt.id)).toMatchObject({ eventType: 'PAYMENT.CAPTURE.COMPLETED' });
      expect(await refusalNotices(ID.bizAcc, id)).toEqual([]);
    });

    /** A webhook_events row another business holds (as a delivery of its own left it). */
    async function seedForeignWebhookRow(provider: string, providerEventId: string, eventType: string, businessId: string) {
      await db.webhookEvent.create({ data: { provider, providerEventId, eventType, businessId } });
      return { eventType, businessId };
    }

    it('VN-08 (g) review SEC-VN08-1 (D-76: the refusal is insert-only): a WiPay success for a VOID invoice whose transaction id another business\'s webhook_events row already holds is refused and records nothing, and that row is left as it was (no cross-tenant overwrite of its type or business)', async () => {
      const transactionId = `${P}victim_wipay_g`;
      const victim = await seedForeignWebhookRow('wipay', transactionId, 'refused:currency:USD', ID.bizAcc);
      const id = await voided(ID.bizCash);

      const res = await wipayCallback(id, transactionId, 100);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ success: false, invoiceId: id });
      expect(await paymentRows(id)).toEqual([]);
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await netReceived(id)).toBe(0);
      expect(await webhookRow('wipay', transactionId), 'another business\'s row is not taken over').toEqual(victim);
    });

    it('VN-08 (h) review SEC-VN08-1 (D-76: the refusal is insert-only): a Stripe delivery with no event id for a VOID invoice, signed with its business\'s own secret, whose session id another business\'s webhook_events row holds, is acked and records nothing, and that row is left as it was', async () => {
      const victimEventId = `${P}evt_victim_h`;
      const victim = await seedForeignWebhookRow('stripe', victimEventId, 'checkout.session.completed', ID.bizCash);
      const id = await voided(ID.bizAcc);
      // No top-level event id (the dedupe claim writes no row); the session id is the other business's event id.
      const event: { id?: string; data: { object: { id: string } } } = stripeEvent(id, 40);
      delete event.id;
      event.data.object.id = victimEventId;

      const res = await stripeDeliver(event);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await paymentRows(id)).toEqual([]);
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await netReceived(id)).toBe(0);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      expect(await webhookRow('stripe', victimEventId), 'another business\'s row is not taken over').toEqual(victim);
    });

    it('VN-08 (i) review CR-VPR-1 (D-76 pattern, D-14): PayPal\'s refund of a capture refused for a VOID invoice (the refund the owner notice asks for, naming the invoice in custom_id) records nothing on it: no REFUNDED row, net 0, ledger all 0 / REVERSED; its event is kept refused:invoice_void with the invoice\'s business, no second owner notice, and a redelivery adds nothing', async () => {
      const id = await voided(ID.bizAcc);
      const captureId = `${P}cap_i`;
      const capture = paypalCaptureEvent(id, captureId, 40);
      const captured = await paypalDeliver(capture);
      expect(captured.status, JSON.stringify(captured.body)).toBe(201);
      await expectRefused(ID.bizAcc, id, 'paypal', capture.id, captureId);

      const refundEvent = {
        id: `${P}WH_refund_i`,
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: `${P}RF_i`,
          custom_id: id,
          amount: { value: '40.00', currency_code: 'USD' },
          supplementary_data: { related_ids: { capture_id: captureId } },
        },
      };
      const res = await paypalDeliver(refundEvent);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await paymentRows(id)).map((p) => [p.status, p.amount]), 'no refund row without the payment it returns').toEqual([]);
      expect((await invoiceRow(id)).status).toBe('VOID');
      expect(await netReceived(id)).toBe(0);
      expect(await ledgerOf(ID.bizAcc, id)).toEqual({ ar: 0, income: 0, cash: 0, finalized: 'REVERSED' });
      expect(await webhookRow('paypal', refundEvent.id)).toEqual({ eventType: 'refused:invoice_void', businessId: ID.bizAcc });
      expect(await refusalNotices(ID.bizAcc, id)).toHaveLength(1);

      const again = await paypalDeliver(refundEvent);
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      expect(await paymentRows(id)).toEqual([]);
      expect(await refusalNotices(ID.bizAcc, id)).toHaveLength(1);
    });
  });
});
