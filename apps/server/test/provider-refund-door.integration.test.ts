/**
 * V1-29c-REFUND-WRITE-DOOR — provider refunds link to the payment they refund,
 * are never duplicated, and post the refunded amount (REAL database, REAL
 * ledger posting, REAL invoice workflow, REAL webhook dedupe).
 *
 * V1-MONEY review residuals, left as it.todo where the files were outside the
 * V1-29 / V1-36 write sets:
 *
 *   SEC-V29-1 / CR-V29-5  processStripeRefund wrote the refund row with
 *          reference = the charge id, not the original payment's
 *          providerPaymentId. A Checkout Session payment (cs_, its pi_ in
 *          reference) then has no linked refund, and V1-29's reader
 *          (refundableOf) counts that unmatched Stripe refund against EVERY
 *          Stripe payment on the invoice: a second, unrefunded payment reads
 *          under-refunded.
 *   BR-08 (review ST-V36-1)  one Stripe refund was two rows: charge.refunded
 *          without refunds.data (Stripe API 2022-11-15 and later) was stored
 *          under re_synth_<charge> for the whole cumulative amount_refunded,
 *          refund.created for the same refund under its re_ id, and the dedupe
 *          looked at providerPaymentId alone.
 *   BR-07  RevenuePostingService.onPaymentRefunded reversed the WHOLE payment
 *          posting for a partial refund: every balance read net 60 while the
 *          ledger cash net of the invoice read 0.
 *   SEC-V29-2  the FINANCE payment_refunded audit row of a manual refund named
 *          the original's amount (100), not the amount refunded (60), and not
 *          the refund row.
 *
 * Contract pinned here (each case its own invoice; Stripe and PayPal events are
 * stubbed objects, no network):
 *
 *   PRD-01  (SEC-V29-1) Stripe refund.created of 40 of a Checkout Session payment
 *           (cs_A, 50) -> one REFUNDED -40 row whose reference is cs_A (linked);
 *           the other Stripe payment of the invoice (cs_B, 50) refunds in full
 *           (-50), then cs_A refunds what is left (-10); a third refund is 409
 *   PRD-02  (BR-07) refund.created 40 of a 100 PaymentIntent payment posts a
 *           REFUND of 40 (the payment posting stays POSTED): ledger cash net 60
 *           = balance net 60, PARTIALLY_PAID; the second refund (60) completes
 *           it: the payment posting is REVERSED once and the partial refund is
 *           reversed (review CRR-V29C-2), ledger cash net 0, SENT
 *   PRD-03  (BR-08) charge.refunded {amount_refunded 4000, no refunds list}, then
 *           refund.created for the same refund -> ONE -40 row; the same event
 *           redelivered, a new charge.refunded with the same cumulative and
 *           charge.refund.updated write nothing; the cumulative 10000 writes the
 *           delta (-60), not the whole (-100); refund.created for that refund
 *           writes nothing
 *   PRD-04  (BR-08, the other order) refund.created 30 then charge.refunded
 *           {amount_refunded 3000, no list} -> one row; refund.created 20 then
 *           {amount_refunded 5000} -> one more; a charge.refunded that lists both
 *           refunds writes nothing
 *   PRD-05  TENANT: a refund signed with tenant A's own webhook secret naming
 *           tenant B's charge (refund.created and charge.refunded) changes
 *           nothing on either tenant; B's own refund of that charge is recorded
 *           (control)
 *   PRD-06  (SEC-V29-2) after a Stripe refund of 40, the manual refund of what is
 *           left (60): its FINANCE payment_refunded audit row names amount 60
 *           and the refund row; the ledger nets the payment to zero
 *   PRD-07  (BR-07, PayPal) PAYMENT.CAPTURE.REFUNDED 30 of a 100 capture posts 30,
 *           the second (70) completes it; a PayPal refund without the capture
 *           id is linked to the invoice's PayPal payment (reference = its
 *           capture id) and posts its amount
 *
 *   Review repairs (V1-29c-REFUND-WRITE-DOOR review):
 *
 *   PRD-08  (SEC-V29C-1) a refund verified by the deployment's own secret whose
 *           ids match payments of two businesses (tenant A stored tenant B's
 *           pi_ in the reference of a payment it signed for itself) is refused:
 *           nothing written on either tenant; matching one business it is
 *           recorded (control)
 *   PRD-09  (SEC-V29C-2) never more than the payment: a manual refund of the
 *           whole payment, then Stripe's refund.created and charge.refunded of
 *           the same money write nothing; a second refund.created beyond the
 *           payment writes nothing; a manual refund of 30, then Stripe's 70,
 *           records the 70; PayPal after a manual refund writes nothing; the
 *           ledger agrees after each step
 *   PRD-10  (SEC-V29C-3) a charge.refunded tenant A signs naming tenant B's
 *           charge id (with A's own payment_intent) does not take the id of B's
 *           own charge.refunded of that charge: B's refund is recorded; a refund
 *           id an event supplies under the re_synth_ prefix writes nothing
 *   PRD-11  (CRR-V29C-1) a linked refund row that was never posted (the row
 *           payments-ops refundCharge writes) counts: the refund of what is left
 *           after it (manual, or Stripe refund.created) reverses the recording,
 *           ledger cash net 0 = balance net 0
 *   PRD-12  (CRR-V29C-2) ACCRUAL business, cash-basis P&L: a payment refunded in
 *           full in two parts (provider, or provider then manual) reads revenue
 *           0 and operating cash in 100 / out 100 at the end; the partial REFUND
 *           postings are reversed, not folded back with an ADJUSTMENT
 *
 *   LEDGER after every step: each transaction balances, the ledger cash net of
 *          the invoice's Payment-sourced transactions = balanceOfStoredRows.net,
 *          each REVERSAL's original is REVERSED, and the tenant's trial balance
 *          balances
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService (webhook claims
 * included), PaymentsService, RevenuePostingService, PostingService and
 * ChartOfAccountsSeederService write real rows, and the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed for the manual
 * refund route. Identity attachment is the one stand-in: a test middleware
 * reads `x-v29c-user`, loads that seeded user row and attaches
 * `{ id, email, role }` as the Supabase-verifying AuthMiddleware would. Stripe
 * deliveries are signed with the business's own webhook secret
 * (business.metaData.stripeWebhookSecret, so no global env is touched) and go
 * through PaymentsService.handleStripeWebhook; PayPal deliveries enter at the
 * handlers behind the signature check (a network call). EventEmitter2 is a
 * recording stub; ExpensePostingService, the contact timeline, the stats cache
 * and the AI / Gmail / Drive services are stubs off the boundary.
 *
 * Fixtures: prefix `v29c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v29c_';
const HEADER = 'x-v29c-user';
const SECRET_A = `whsec_${P}a`;
const SECRET_B = `whsec_${P}b`;
const SECRET_C = `whsec_${P}c`;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  invSession: `${P}invSession`,
  invIntent: `${P}invIntent`,
  invSynth: `${P}invSynth`,
  invRealFirst: `${P}invRealFirst`,
  invForge: `${P}invForge`,
  invAudit: `${P}invAudit`,
  invPaypal: `${P}invPaypal`,
  invPaypalNoCap: `${P}invPaypalNoCap`,
  // review repairs (tenant A)
  invAmbig: `${P}invAmbig`,
  invPlatformOk: `${P}invPlatformOk`,
  invManualFirst: `${P}invManualFirst`,
  invManualFirstCh: `${P}invManualFirstCh`,
  invManualPart: `${P}invManualPart`,
  invOverRefund: `${P}invOverRefund`,
  invPaypalManual: `${P}invPaypalManual`,
  invSynthOwn: `${P}invSynthOwn`,
  invOpsManual: `${P}invOpsManual`,
  invOpsStripe: `${P}invOpsStripe`,
  // tenant B
  invVictim: `${P}invVictim`,
  invAmbigVictim: `${P}invAmbigVictim`,
  invSynthVictim: `${P}invSynthVictim`,
  // business C (ACCRUAL)
  ownerC: `${P}ownerC`,
  bizC: `${P}bizC`,
  contactC: `${P}contactC`,
  invAccrual: `${P}invAccrual`,
  invAccrualManual: `${P}invAccrualManual`,
};
const TENANT_B_INVOICES = new Set([ID.invVictim, ID.invAmbigVictim, ID.invSynthVictim]);
const BUSINESS_C_INVOICES = new Set([ID.invAccrual, ID.invAccrualManual]);

const TOTAL = 100;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let paymentsSvc: any;
let revenuePostingSvc: any;
let ledgerReporting: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

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
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** A Stripe delivery, signed with a business's own webhook secret as Stripe signs it. */
async function stripe(id: string, type: string, object: Record<string, unknown>, secret = SECRET_A) {
  const raw = JSON.stringify({ id: `${P}${id}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  return paymentsSvc.handleStripeWebhook(raw, signature);
}

/**
 * A PaymentIntent payment of `amount` (stored as pi_, its charge in reference). `businessId`, when
 * given, is named in its metadata, as a platform-signed payment event must (R0-20c review SEC-R020C-1).
 */
function payByIntent(inv: string, n: string, amount: number, secret = SECRET_A, businessId?: string) {
  return stripe(`evt_pi_${n}`, 'payment_intent.succeeded', {
    id: `${P}pi_${n}`, amount_received: amount * 100, currency: 'ttd', latest_charge: `${P}ch_${n}`, metadata: { invoiceId: inv, ...(businessId ? { businessId } : {}) },
  }, secret);
}

/** A Checkout Session payment of `amount` (stored as cs_, its pi_ in reference). */
function payBySession(inv: string, n: string, amount: number, secret = SECRET_A) {
  return stripe(`evt_cs_${n}`, 'checkout.session.completed', {
    id: `${P}cs_${n}`, client_reference_id: inv, amount_total: amount * 100, currency: 'ttd', payment_intent: `${P}pi_${n}`, metadata: { invoiceId: inv },
  }, secret);
}

/** refund.created: the Refund object itself. */
function refundCreated(evt: string, inv: string, n: string, re: string, amount: number, secret = SECRET_A, type = 'refund.created') {
  return stripe(evt, type, {
    id: `${P}${re}`, amount: amount * 100, currency: 'ttd', charge: `${P}ch_${n}`, payment_intent: `${P}pi_${n}`, status: 'succeeded', metadata: { invoiceId: inv },
  }, secret);
}

/** charge.refunded: the Charge, cumulative amount_refunded; refunds.data omitted unless given (Stripe API 2022-11-15+). */
function chargeRefunded(evt: string, inv: string, n: string, amountRefunded: number, refunds?: Array<{ re: string; amount: number }>, secret = SECRET_A) {
  return stripe(evt, 'charge.refunded', {
    id: `${P}ch_${n}`, payment_intent: `${P}pi_${n}`, amount: 10000, amount_refunded: amountRefunded * 100, currency: 'ttd', metadata: { invoiceId: inv },
    ...(refunds
      ? { refunds: { data: refunds.map((r) => ({ id: `${P}${r.re}`, amount: r.amount * 100, currency: 'ttd', charge: `${P}ch_${n}`, payment_intent: `${P}pi_${n}`, status: 'succeeded' })) } }
      : {}),
  }, secret);
}

function refund(paymentId: string, reason = 'v29c refund', business = ID.bizA, owner = ID.ownerA) {
  return request(app.getHttpServer())
    .post(`/commerce/businesses/${business}/payments/${paymentId}/refund`)
    .set(HEADER, owner)
    .send({ reason });
}

/** With the deployment's own Stripe webhook secret configured (Stripe's alone; no tenant binding). */
async function withPlatformSecret<T>(secret: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  }
}

/** The row payments-ops refundCharge writes: provider 'stripe', its re_ id, reference = the payment's providerPaymentId, no posting. */
async function refundChargeRow(original: any, re: string, amount: number) {
  return db.payment.create({
    data: {
      businessId: original.businessId, invoiceId: original.invoiceId, amount: -amount, currency: 'TTD', status: 'REFUNDED',
      provider: 'stripe', providerPaymentId: `${P}${re}`, reference: original.providerPaymentId, notes: 'refundCharge',
    },
  });
}

/** Cash-basis revenue and operating cash of a business over the whole test window. */
async function cashBasis(businessId: string) {
  const from = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  const to = new Date(Date.now() + 24 * 3600 * 1000);
  const pnl = await ledgerReporting.getPnl(businessId, from, to, 'cash');
  const cash = await ledgerReporting.computeCashBasisPnl(businessId, from, to);
  return { revenue: pnl.revenue.total, cashIn: cash.operatingCashIn, cashOut: cash.operatingCashOut };
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** `provider:providerPaymentId:status:amount:reference`, in write order. */
async function rowsOf(invoiceId: string): Promise<string[]> {
  return (await paymentsOf(invoiceId)).map((r) => `${r.provider}:${r.providerPaymentId}:${r.status}:${Number(r.amount)}:${r.reference}`);
}

async function paymentBy(providerPaymentId: string): Promise<any> {
  return db.payment.findUnique({ where: { providerPaymentId } });
}

/** The refund rows linked to one original payment (reference = the original's providerPaymentId). */
async function refundRowsOf(original: { invoiceId: string; providerPaymentId: string }): Promise<any[]> {
  return db.payment.findMany({
    where: { invoiceId: original.invoiceId, status: 'REFUNDED', amount: { lt: 0 }, reference: original.providerPaymentId },
  });
}

async function balanceOf(invoiceId: string) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  return storedBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
}

/** `type:status:amount` of the transactions one payment sourced, in posting order. */
async function postingsOf(paymentId: string): Promise<string[]> {
  const txns = await db.financialTransaction.findMany({
    where: { sourceType: 'Payment', sourceId: paymentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`);
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/**
 * LEDGER: every transaction the invoice's payments sourced balances; their
 * deposit-side (cash) net equals the stored balance net (and `net`); each
 * REVERSAL's original is REVERSED; the tenant's trial balance balances.
 */
async function expectLedgerAgrees(invoiceId: string, net: number) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  const txns = await db.financialTransaction.findMany({
    where: { businessId: inv.businessId, sourceType: 'Payment', sourceId: { in: rows.map((r) => r.id) } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  for (const t of txns) {
    expect(money(sum(t.entries, 'debit')), `${invoiceId} ${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
  }
  const cashNet = money(
    txns
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const balance = await balanceOf(invoiceId);
  expect(cashNet, `${invoiceId}: ledger cash net = balance net`).toBe(balance.net);
  expect(balance.net, `${invoiceId}: balance net`).toBe(net);
  for (const r of txns.filter((t: any) => t.type === 'REVERSAL')) {
    expect(txns.find((t: any) => t.id === r.reversalOfId)?.status, `${invoiceId}: the reversed original is REVERSED`).toBe('REVERSED');
  }
  const totals = await db.ledgerEntry.aggregate({ where: { businessId: inv.businessId }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance').toBe(money(Number(totals._sum.credit ?? 0)));
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
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
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
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

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
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
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
  const commerce = moduleRef.get(CommerceService);
  const workflow = moduleRef.get(workflowMod.InvoiceWorkflowService);
  paymentsSvc = new PaymentsService(moduleRef.get(PrismaService), commerce, workflow, moduleRef.get(RevenuePostingService));
  revenuePostingSvc = moduleRef.get(RevenuePostingService);
  const { LedgerReportingService } = await import('../src/modules/reports/ledger-reporting.service');
  ledgerReporting = new LedgerReportingService(moduleRef.get(PrismaService), {} as any, {} as any);

  app = moduleRef.createNestApplication();
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
  await app.init();

  await cleanup();

  for (const [user, biz, contact, secret, name, email, contactEmail, accountingBasis] of [
    [ID.ownerA, ID.bizA, ID.contactA, SECRET_A, 'V29C Biz A', `${P}owner_a@test.local`, `${P}c_a@test.local`, 'CASH'],
    [ID.ownerB, ID.bizB, ID.contactB, SECRET_B, 'V29C Biz B', `${P}owner_b@test.local`, `${P}c_b@test.local`, 'CASH'],
    [ID.ownerC, ID.bizC, ID.contactC, SECRET_C, 'V29C Biz C', `${P}owner_c@test.local`, `${P}c_c@test.local`, 'ACCRUAL'],
  ] as const) {
    await db.user.create({ data: { id: user, email, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD', accountingBasis, metaData: { stripeWebhookSecret: secret } } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V29c', lastName: name, email: contactEmail } });
  }

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const tenantB = TENANT_B_INVOICES.has(id);
    const businessC = BUSINESS_C_INVOICES.has(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V29C-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: tenantB ? ID.bizB : businessC ? ID.bizC : ID.bizA,
        contactId: tenantB ? ID.contactB : businessC ? ID.contactC : ID.contactA,
        items: { create: [{ id: `${id}_item1`, description: `V29C item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('SEC-V29-1 / CR-V29-5: a Stripe refund row links to the payment it refunds', () => {
  it('PRD-01: refund.created 40 of a Checkout Session payment (cs_A) -> one -40 row with reference cs_A; the second Stripe payment (cs_B) refunds in full (-50), cs_A then refunds what is left (-10), a third refund is 409; the ledger agrees after each step', async () => {
    const inv = ID.invSession;
    await payBySession(inv, 'A', 50);
    await payBySession(inv, 'B', 50);
    const a = await paymentBy(`${P}cs_A`);
    const b = await paymentBy(`${P}cs_B`);
    expect(a).toMatchObject({ reference: `${P}pi_A`, amount: 50, status: 'SUCCESSFUL' });
    expect((await invoiceRow(inv)).status).toBe('PAID');
    await expectLedgerAgrees(inv, 100);

    const res = await refundCreated('evt_re_A', inv, 'A', 're_A', 40);
    expect(res).toEqual({ ok: true, received: true, processed: 'refund.created' });
    // RED-BEFORE: reference = the charge id (ch_A), which links to no payment of the invoice.
    expect(await paymentBy(`${P}re_A`)).toMatchObject({ provider: 'stripe', status: 'REFUNDED', amount: -40, reference: `${P}cs_A`, invoiceId: inv, businessId: ID.bizA });
    expect(await refundRowsOf(a)).toHaveLength(1);
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 40, net: 60, remaining: 40 });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    await expectLedgerAgrees(inv, 60);

    // RED-BEFORE: the unmatched -40 was counted against cs_B too: -10, not -50.
    const whole = await refund(b.id, 'second stripe payment');
    expect(whole.status, JSON.stringify(whole.body)).toBe(201);
    expect(whole.body).toMatchObject({ amount: -50, refundOfPaymentId: b.id, invoiceStatus: 'PARTIALLY_PAID' });
    expect(whole.body.balance).toMatchObject({ net: 10, remaining: 90 });
    await expectLedgerAgrees(inv, 10);

    const rest = await refund(a.id, 'rest of cs_A');
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body).toMatchObject({ amount: -10, refundOfPaymentId: a.id, invoiceStatus: 'SENT' });
    expect((await refundRowsOf(a)).map((r) => Number(r.amount)).sort((x, y) => x - y)).toEqual([-40, -10]);
    expect((await invoiceRow(inv)).paidAt).toBeNull();
    // cs_A: its partial refund posted 40, the manual rest reversed the posting once and reversed the partial
    // refund (review CRR-V29C-2: an ADJUSTMENT folding it back read as a new collection in the cash-basis P&L).
    expect(await postingsOf(a.id)).toEqual(['INCOME:REVERSED:50', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:50', 'REVERSAL:POSTED:40']);
    expect(await postingsOf(b.id)).toEqual(['INCOME:REVERSED:50', 'REVERSAL:POSTED:50']);
    await expectLedgerAgrees(inv, 0);

    const again = await refund(a.id, 'again');
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.message).toMatch(/already refunded/i);
    await expectLedgerAgrees(inv, 0);
  });
});

describe('BR-07: a partial provider refund posts the refunded amount, not the whole payment', () => {
  it('PRD-02: refund.created 40 of a 100 PaymentIntent payment posts a REFUND of 40 (ledger cash net 60 = balance net 60, PARTIALLY_PAID); refund.created 60 completes it: the payment posting is REVERSED once and the partial refund reversed (ledger cash net 0, SENT)', async () => {
    const inv = ID.invIntent;
    await payByIntent(inv, 'X', 100);
    const pi = await paymentBy(`${P}pi_X`);
    expect(pi).toMatchObject({ reference: `${P}ch_X`, amount: 100 });
    await expectLedgerAgrees(inv, 100);

    await refundCreated('evt_re_X1', inv, 'X', 're_X1', 40);
    expect(await paymentBy(`${P}re_X1`)).toMatchObject({ amount: -40, reference: `${P}pi_X`, status: 'REFUNDED' });
    expect(await balanceOf(inv)).toMatchObject({ net: 60, remaining: 40 });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    // RED-BEFORE: ['INCOME:REVERSED:100', 'REVERSAL:POSTED:100'] (ledger cash net 0 against a balance net of 60).
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
    await expectLedgerAgrees(inv, 60);

    await refundCreated('evt_re_X2', inv, 'X', 're_X2', 60);
    expect(await balanceOf(inv)).toMatchObject({ net: 0, remaining: 100 });
    const row = await invoiceRow(inv);
    expect(row.status).toBe('SENT');
    expect(row.paidAt).toBeNull();
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:40']);
    await expectLedgerAgrees(inv, 0);
  });
});

describe('BR-08 (review ST-V36-1): one Stripe refund is one row', () => {
  it('PRD-03: charge.refunded {amount_refunded 4000, no refunds list} then refund.created for the same refund -> ONE -40 row; redeliveries and repeats write nothing; the cumulative 10000 writes the delta (-60); the ledger agrees after each step', async () => {
    const inv = ID.invSynth;
    await payByIntent(inv, 'S', 100);
    const pi = await paymentBy(`${P}pi_S`);

    expect(await chargeRefunded('evt_ch_S1', inv, 'S', 40)).toEqual({ ok: true, received: true, processed: 'charge.refunded' });
    expect(await rowsOf(inv)).toHaveLength(2);
    expect(await refundRowsOf(pi)).toHaveLength(1);
    await expectLedgerAgrees(inv, 60);

    await refundCreated('evt_re_S1', inv, 'S', 're_S1', 40);
    // RED-BEFORE: a second -40 row (re_S1 beside re_synth_ch_S): net 20, remaining 80.
    const rows = await paymentsOf(inv);
    expect(rows.map((r) => [r.status, Number(r.amount)])).toEqual([['SUCCESSFUL', 100], ['REFUNDED', -40]]);
    expect(await balanceOf(inv)).toMatchObject({ net: 60, remaining: 40 });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    await expectLedgerAgrees(inv, 60);

    // The same delivery again (acked by its claim), a new charge.refunded with the same cumulative, charge.refund.updated.
    expect(await chargeRefunded('evt_ch_S1', inv, 'S', 40)).toEqual({ ok: true, received: true });
    await chargeRefunded('evt_ch_S1b', inv, 'S', 40);
    await refundCreated('evt_re_S1u', inv, 'S', 're_S1', 40, SECRET_A, 'charge.refund.updated');
    expect(await paymentsOf(inv)).toEqual(rows);
    await expectLedgerAgrees(inv, 60);

    // A second refund of 60: the cumulative is 10000; the delta is written, then its refund.created is already covered.
    await chargeRefunded('evt_ch_S2', inv, 'S', 100);
    expect((await paymentsOf(inv)).map((r) => [r.status, Number(r.amount)])).toEqual([['SUCCESSFUL', 100], ['REFUNDED', -40], ['REFUNDED', -60]]);
    await refundCreated('evt_re_S2', inv, 'S', 're_S2', 60);
    expect((await paymentsOf(inv)).map((r) => [r.status, Number(r.amount)])).toEqual([['SUCCESSFUL', 100], ['REFUNDED', -40], ['REFUNDED', -60]]);
    expect((await refundRowsOf(pi)).every((r) => r.reference === `${P}pi_S`)).toBe(true);
    expect(await balanceOf(inv)).toMatchObject({ net: 0, remaining: 100 });
    expect((await invoiceRow(inv)).status).toBe('SENT');
    await expectLedgerAgrees(inv, 0);
  });

  it('PRD-04: the other order: refund.created 30 then charge.refunded {amount_refunded 3000, no list} -> one row; refund.created 20 then {amount_refunded 5000} -> one more; a charge.refunded listing both refunds writes nothing; net 50, PARTIALLY_PAID; the ledger agrees', async () => {
    const inv = ID.invRealFirst;
    await payByIntent(inv, 'R', 100);
    const pi = await paymentBy(`${P}pi_R`);

    await refundCreated('evt_re_R1', inv, 'R', 're_R1', 30);
    await chargeRefunded('evt_ch_R1', inv, 'R', 30);
    // RED-BEFORE: re_synth_ch_R -30 beside re_R1 -30.
    expect(await rowsOf(inv)).toEqual([
      `stripe:${P}pi_R:SUCCESSFUL:100:${P}ch_R`,
      `stripe:${P}re_R1:REFUNDED:-30:${P}pi_R`,
    ]);
    await expectLedgerAgrees(inv, 70);

    await refundCreated('evt_re_R2', inv, 'R', 're_R2', 20);
    await chargeRefunded('evt_ch_R2', inv, 'R', 50);
    await chargeRefunded('evt_ch_R3', inv, 'R', 50, [{ re: 're_R1', amount: 30 }, { re: 're_R2', amount: 20 }]);
    expect(await rowsOf(inv)).toEqual([
      `stripe:${P}pi_R:SUCCESSFUL:100:${P}ch_R`,
      `stripe:${P}re_R1:REFUNDED:-30:${P}pi_R`,
      `stripe:${P}re_R2:REFUNDED:-20:${P}pi_R`,
    ]);
    expect(await balanceOf(inv)).toMatchObject({ net: 50, remaining: 50 });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30', 'REFUND:POSTED:20']);
    await expectLedgerAgrees(inv, 50);
  });
});

describe('TENANT: a refund event naming another business\'s payment changes nothing', () => {
  it("PRD-05: signed with tenant A's own secret, refund.created and charge.refunded naming tenant B's charge write and post nothing on either tenant; B's own refund of that charge is recorded and posts its amount", async () => {
    await payByIntent(ID.invVictim, 'V', 100, SECRET_B);
    const victim = await paymentBy(`${P}pi_V`);
    expect(victim).toMatchObject({ businessId: ID.bizB, status: 'SUCCESSFUL', amount: 100 });
    const before = await rowsOf(ID.invVictim);
    const postingsBefore = await postingsOf(victim.id);

    await refundCreated('evt_forge_1', ID.invForge, 'V', 're_forged', 100, SECRET_A);
    await chargeRefunded('evt_forge_2', ID.invForge, 'V', 100, undefined, SECRET_A);
    expect(await rowsOf(ID.invVictim)).toEqual(before);
    expect(await postingsOf(victim.id)).toEqual(postingsBefore);
    expect((await invoiceRow(ID.invVictim)).status).toBe('PAID');
    expect(await paymentsOf(ID.invForge)).toEqual([]);
    expect(await db.payment.count({ where: { businessId: ID.bizA, invoiceId: ID.invVictim } })).toBe(0);
    await expectLedgerAgrees(ID.invVictim, 100);

    // Control: B's own secret, its own invoice and charge.
    await refundCreated('evt_victim_own', ID.invVictim, 'V', 're_victim', 25, SECRET_B);
    expect(await paymentBy(`${P}re_victim`)).toMatchObject({ businessId: ID.bizB, amount: -25, reference: `${P}pi_V` });
    expect(await postingsOf(victim.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:25']);
    await expectLedgerAgrees(ID.invVictim, 75);
  });
});

describe('SEC-V29-2: the manual refund audit row names the amount refunded and the refund row', () => {
  it('PRD-06: after a Stripe refund of 40, the manual refund of what is left (60) writes one FINANCE payment_refunded row with amount 60 and the refund row id; the ledger nets the payment to zero', async () => {
    const inv = ID.invAudit;
    await payByIntent(inv, 'U', 100);
    const pi = await paymentBy(`${P}pi_U`);
    await refundCreated('evt_re_U', inv, 'U', 're_U', 40);
    await expectLedgerAgrees(inv, 60);

    const res = await refund(pi.id, 'what is left');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ amount: -60, refundOfPaymentId: pi.id, invoiceStatus: 'SENT' });
    const audit = await db.activity.findMany({ where: { businessId: ID.bizA, module: 'FINANCE', action: 'payment_refunded', entityId: pi.id } });
    expect(audit).toHaveLength(1);
    // RED-BEFORE: data.amount 100 (the original's amount), and no refund row named.
    expect(audit[0].data).toMatchObject({ invoiceId: inv, amount: 60, refundPaymentId: res.body.id, currency: 'TTD', ledgerReversed: true, refundedBy: ID.ownerA });
    expect(audit[0].actorId).toBe(ID.ownerA);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:40']);
    await expectLedgerAgrees(inv, 0);
  });
});

describe('BR-07 (PayPal): PayPal refunds post their amount and link to the capture they refund', () => {
  it('PRD-07: PAYMENT.CAPTURE.REFUNDED 30 of a 100 capture posts 30, the second (70) completes it; a refund without the capture id is linked to the invoice\'s PayPal payment and posts its amount', async () => {
    const inv = ID.invPaypal;
    await paymentsSvc.processPaypalCaptureCompleted({ id: `${P}CAP_P`, custom_id: inv, amount: { value: '100.00', currency_code: 'TTD' } });
    const cap = await paymentBy(`${P}CAP_P`);
    expect(cap).toMatchObject({ provider: 'paypal', amount: 100, status: 'SUCCESSFUL' });

    await paymentsSvc.processPaypalRefund({ id: `${P}RF_P1`, amount: { value: '30.00', currency_code: 'TTD' }, supplementary_data: { related_ids: { capture_id: `${P}CAP_P` } } });
    expect(await paymentBy(`${P}RF_P1`)).toMatchObject({ provider: 'paypal', amount: -30, reference: `${P}CAP_P`, status: 'REFUNDED' });
    // RED-BEFORE: ['INCOME:REVERSED:100', 'REVERSAL:POSTED:100'].
    expect(await postingsOf(cap.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30']);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    await expectLedgerAgrees(inv, 70);
    // A redelivery of the same refund writes nothing.
    await paymentsSvc.processPaypalRefund({ id: `${P}RF_P1`, amount: { value: '30.00', currency_code: 'TTD' }, supplementary_data: { related_ids: { capture_id: `${P}CAP_P` } } });
    await paymentsSvc.processPaypalRefund({ id: `${P}RF_P2`, amount: { value: '70.00', currency_code: 'TTD' }, supplementary_data: { related_ids: { capture_id: `${P}CAP_P` } } });
    expect(await postingsOf(cap.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:30', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:30']);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    await expectLedgerAgrees(inv, 0);

    const noCap = ID.invPaypalNoCap;
    await paymentsSvc.processPaypalCaptureCompleted({ id: `${P}CAP_Q`, custom_id: noCap, amount: { value: '100.00', currency_code: 'TTD' } });
    const q = await paymentBy(`${P}CAP_Q`);
    await paymentsSvc.processPaypalRefund({ id: `${P}RF_Q1`, custom_id: noCap, amount: { value: '25.00', currency_code: 'TTD' } });
    // RED-BEFORE: reference null (linked to no payment), and the whole posting reversed.
    expect(await paymentBy(`${P}RF_Q1`)).toMatchObject({ provider: 'paypal', amount: -25, reference: `${P}CAP_Q`, invoiceId: noCap });
    expect(await refundRowsOf(q)).toHaveLength(1);
    expect(await postingsOf(q.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:25']);
    await expectLedgerAgrees(noCap, 75);
  });
});

describe('Review SEC-V29C-1: a refund verified by the deployment secret whose ids match payments of two businesses is refused', () => {
  it("PRD-08: tenant A stores tenant B's pi_ in the reference of a payment it signs for itself; B's platform-verified refund.created and charge.refunded then match both tenants and write nothing on either; a platform-verified refund matching one business is recorded (control)", async () => {
    const PLATFORM = `whsec_${P}platform`;
    await withPlatformSecret(PLATFORM, async () => {
      // Tenant A, with its own secret, forges a 1.00 session on its own invoice whose payment_intent is B's pi_AMB.
      await stripe('evt_forge_cs', 'checkout.session.completed', {
        id: `${P}cs_FAKE`, client_reference_id: ID.invAmbig, amount_total: 100, currency: 'ttd', payment_intent: `${P}pi_AMB`, metadata: { invoiceId: ID.invAmbig },
      }, SECRET_A);
      expect(await rowsOf(ID.invAmbig)).toEqual([`stripe:${P}cs_FAKE:SUCCESSFUL:1:${P}pi_AMB`]);
      // B's genuine payment, verified by the deployment's secret (after A's row: A's is the oldest match).
      await payByIntent(ID.invAmbigVictim, 'AMB', 100, PLATFORM, ID.bizB);
      const victim = await paymentBy(`${P}pi_AMB`);
      expect(victim).toMatchObject({ businessId: ID.bizB, amount: 100, status: 'SUCCESSFUL' });
      const aBefore = await rowsOf(ID.invAmbig);
      const bBefore = await rowsOf(ID.invAmbigVictim);

      expect(await refundCreated('evt_re_AMB', ID.invAmbigVictim, 'AMB', 're_AMB', 25, PLATFORM)).toEqual({ ok: true, received: true, processed: 'refund.created' });
      // RED-BEFORE: A's row re_AMB -25 (reference cs_FAKE) written into A's books; B's books never show the refund.
      expect(await paymentBy(`${P}re_AMB`)).toBeNull();
      await chargeRefunded('evt_chr_AMB', ID.invAmbigVictim, 'AMB', 25, undefined, PLATFORM);
      expect(await rowsOf(ID.invAmbig)).toEqual(aBefore);
      expect(await rowsOf(ID.invAmbigVictim)).toEqual(bBefore);
      expect(await postingsOf(victim.id)).toEqual(['INCOME:POSTED:100']);
      await expectLedgerAgrees(ID.invAmbigVictim, 100);
      await expectLedgerAgrees(ID.invAmbig, 1);

      // Control: a platform-verified refund whose ids match one business only is recorded there.
      await payByIntent(ID.invPlatformOk, 'PO', 100, PLATFORM, ID.bizA);
      await refundCreated('evt_re_PO', ID.invPlatformOk, 'PO', 're_PO', 30, PLATFORM);
      expect(await paymentBy(`${P}re_PO`)).toMatchObject({ businessId: ID.bizA, amount: -30, reference: `${P}pi_PO` });
      await expectLedgerAgrees(ID.invPlatformOk, 70);
    });
  });
});

describe('Review SEC-V29C-2: a refund is never recorded beyond the payment, whichever door records it first', () => {
  it("PRD-09: a manual refund of the whole payment, then Stripe's refund.created (or charge.refunded) of the same money writes nothing; a second Stripe refund beyond the payment writes nothing; PayPal's refund after a manual refund writes nothing; the ledger agrees after each step", async () => {
    // The manual refund records only; the operator refunded in the Stripe dashboard, whose event arrives after.
    const inv = ID.invManualFirst;
    await payByIntent(inv, 'MF', 100);
    const pi = await paymentBy(`${P}pi_MF`);
    const manual = await refund(pi.id, 'refunded in the Stripe dashboard');
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    expect(manual.body).toMatchObject({ amount: -100, invoiceStatus: 'SENT' });
    const rows = await rowsOf(inv);
    expect(await refundCreated('evt_re_MF', inv, 'MF', 're_MF', 100)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    // RED-BEFORE: a second -100 row (re_MF): refunded 200 of paid 100, net -100, remaining 200.
    expect(await rowsOf(inv)).toEqual(rows);
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100 });
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    await expectLedgerAgrees(inv, 0);

    const ch = ID.invManualFirstCh;
    await payByIntent(ch, 'MC', 100);
    const pic = await paymentBy(`${P}pi_MC`);
    expect((await refund(pic.id, 'refunded in the Stripe dashboard')).status).toBe(201);
    const chRows = await rowsOf(ch);
    await chargeRefunded('evt_chr_MC', ch, 'MC', 100);
    // RED-BEFORE: re_synth_..._10000 -100 beside the manual -100.
    expect(await rowsOf(ch)).toEqual(chRows);
    expect(await balanceOf(ch)).toMatchObject({ refunded: 100, net: 0 });
    await expectLedgerAgrees(ch, 0);

    // Two Stripe refunds of one 100 payment adding up to 130: the second writes nothing.
    const over = ID.invOverRefund;
    await payByIntent(over, 'OV', 100);
    await refundCreated('evt_re_OVa', over, 'OV', 're_OVa', 100);
    await refundCreated('evt_re_OVb', over, 'OV', 're_OVb', 30);
    // RED-BEFORE: re_OVb -30 written too: refunded 130, net -30.
    expect(await paymentBy(`${P}re_OVb`)).toBeNull();
    expect(await balanceOf(over)).toMatchObject({ refunded: 100, net: 0 });
    await expectLedgerAgrees(over, 0);

    // PayPal: a manual refund of the capture, then PayPal's refund event for the same money.
    const pp = ID.invPaypalManual;
    await paymentsSvc.processPaypalCaptureCompleted({ id: `${P}CAP_M`, custom_id: pp, amount: { value: '100.00', currency_code: 'TTD' } });
    const cap = await paymentBy(`${P}CAP_M`);
    expect((await refund(cap.id, 'refunded in PayPal')).status).toBe(201);
    const ppRows = await rowsOf(pp);
    await paymentsSvc.processPaypalRefund({ id: `${P}RF_M`, amount: { value: '100.00', currency_code: 'TTD' }, supplementary_data: { related_ids: { capture_id: `${P}CAP_M` } } });
    // RED-BEFORE: RF_M -100 beside the manual -100.
    expect(await rowsOf(pp)).toEqual(ppRows);
    await expectLedgerAgrees(pp, 0);
  });
});

describe("Review SEC-V29C-3: one tenant cannot take the synthetic id of another tenant's refund", () => {
  it("PRD-10: a charge.refunded tenant A signs naming tenant B's charge (with A's own payment_intent) refunds A's payment only, and B's own charge.refunded of that charge with the same cumulative is still recorded in B's books; a refund id an event supplies under re_synth_ writes nothing", async () => {
    await payByIntent(ID.invSynthVictim, 'SV', 100, SECRET_B);
    await payByIntent(ID.invSynthOwn, 'SO', 100, SECRET_A);
    const victim = await paymentBy(`${P}pi_SV`);
    await stripe('evt_forge_synth', 'charge.refunded', {
      id: `${P}ch_SV`, payment_intent: `${P}pi_SO`, amount: 10000, amount_refunded: 2500, currency: 'ttd', metadata: { invoiceId: ID.invSynthOwn },
    }, SECRET_A);
    // A's own payment (pi_SO) is what A's secret can refund: in A's books.
    expect((await paymentsOf(ID.invSynthOwn)).map((r) => [r.businessId, r.status, Number(r.amount)])).toEqual([
      [ID.bizA, 'SUCCESSFUL', 100],
      [ID.bizA, 'REFUNDED', -25],
    ]);

    expect(await chargeRefunded('evt_synth_victim', ID.invSynthVictim, 'SV', 25, undefined, SECRET_B)).toEqual({ ok: true, received: true, processed: 'charge.refunded' });
    // RED-BEFORE: acked 'processed' with nothing written: A's row had taken re_synth_<ch_SV>_2500.
    expect(await refundRowsOf(victim)).toHaveLength(1);
    expect(await balanceOf(ID.invSynthVictim)).toMatchObject({ refunded: 25, net: 75 });
    expect(await postingsOf(victim.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:25']);
    await expectLedgerAgrees(ID.invSynthVictim, 75);
    await expectLedgerAgrees(ID.invSynthOwn, 75);

    // A refund id under the door's synthetic prefix, supplied by an event, is refused.
    const before = await rowsOf(ID.invSynthOwn);
    await stripe('evt_forge_synth_id', 'refund.created', {
      id: `re_synth_${P}forged`, amount: 1000, currency: 'ttd', charge: `${P}ch_SO`, payment_intent: `${P}pi_SO`, status: 'succeeded', metadata: { invoiceId: ID.invSynthOwn },
    }, SECRET_A);
    // RED-BEFORE: recorded as a -10 refund under that id.
    expect(await paymentBy(`re_synth_${P}forged`)).toBeNull();
    expect(await rowsOf(ID.invSynthOwn)).toEqual(before);
    await expectLedgerAgrees(ID.invSynthOwn, 75);
  });
});

describe('Review CRR-V29C-1: a linked refund row that was never posted counts towards refunding the payment', () => {
  it('PRD-11: after the unposted row payments-ops refundCharge writes (-30, reference = the payment), the manual refund of what is left (70), or Stripe\'s refund.created of 70, reverses the recording: ledger cash net 0 = balance net 0', async () => {
    const inv = ID.invOpsManual;
    await payByIntent(inv, 'OM', 100);
    const pi = await paymentBy(`${P}pi_OM`);
    await refundChargeRow(pi, 're_ops_OM', 30);
    const rest = await refund(pi.id, 'rest');
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body).toMatchObject({ amount: -70, refundOfPaymentId: pi.id, invoiceStatus: 'SENT' });
    // RED-BEFORE: ['INCOME:POSTED:100', 'REFUND:POSTED:70']: ledger cash net 30 against a balance net of 0, for good.
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    await expectLedgerAgrees(inv, 0);

    const inv2 = ID.invOpsStripe;
    await payByIntent(inv2, 'OS', 100);
    const pi2 = await paymentBy(`${P}pi_OS`);
    await refundChargeRow(pi2, 're_ops_OS', 30);
    await refundCreated('evt_re_OS', inv2, 'OS', 're_OS', 70);
    expect(await paymentBy(`${P}re_OS`)).toMatchObject({ amount: -70, reference: `${P}pi_OS`, status: 'REFUNDED' });
    expect(await postingsOf(pi2.id)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    await expectLedgerAgrees(inv2, 0);
  });
});

describe('Review CRR-V29C-2: a payment refunded in full in parts reads as nothing received in the cash-basis P&L of an ACCRUAL business', () => {
  it('PRD-12: ACCRUAL: pay 100, refund.created 40, refund.created 60 -> cash-basis revenue +0 and operating cash in 100 / out 100 at the end; the partial REFUND is reversed (no ADJUSTMENT); the same with a manual refund of the rest', async () => {
    const inv = ID.invAccrual;
    await revenuePostingSvc.onInvoiceFinalized(inv);
    const before = await cashBasis(ID.bizC);
    await payByIntent(inv, 'AC', 100, SECRET_C);
    const pi = await paymentBy(`${P}pi_AC`);
    expect(pi).toMatchObject({ businessId: ID.bizC, amount: 100 });
    await expectLedgerAgrees(inv, 100);
    expect(money((await cashBasis(ID.bizC)).revenue - before.revenue)).toBe(100);

    await refundCreated('evt_re_AC1', inv, 'AC', 're_AC1', 40, SECRET_C);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
    await expectLedgerAgrees(inv, 60);
    await refundCreated('evt_re_AC2', inv, 'AC', 're_AC2', 60, SECRET_C);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:40']);
    await expectLedgerAgrees(inv, 0);
    const end = await cashBasis(ID.bizC);
    // RED-BEFORE: revenue +40 (the ADJUSTMENT folding the partial back read as a new collection), cash in 140 / out 100.
    expect(money(end.revenue - before.revenue), 'cash-basis revenue of a fully refunded payment').toBe(0);
    expect(money(end.cashIn - before.cashIn)).toBe(100);
    expect(money(end.cashOut - before.cashOut)).toBe(100);

    const m = ID.invAccrualManual;
    await revenuePostingSvc.onInvoiceFinalized(m);
    const b2 = await cashBasis(ID.bizC);
    await payBySession(m, 'ACM', 100, SECRET_C);
    const cs = await paymentBy(`${P}cs_ACM`);
    await refundCreated('evt_re_ACM', m, 'ACM', 're_ACM', 40, SECRET_C);
    const rest = await refund(cs.id, 'rest', ID.bizC, ID.ownerC);
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body).toMatchObject({ amount: -60, refundOfPaymentId: cs.id });
    expect(await postingsOf(cs.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:40']);
    await expectLedgerAgrees(m, 0);
    const e2 = await cashBasis(ID.bizC);
    // RED-BEFORE: +40.
    expect(money(e2.revenue - b2.revenue), 'cash-basis revenue after the manual refund of the rest').toBe(0);
    expect(money(e2.cashIn - b2.cashIn)).toBe(money(e2.cashOut - b2.cashOut));
  });
});
