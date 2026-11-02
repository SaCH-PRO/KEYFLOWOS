/**
 * R0-PL-04-MARK-PAID-POSTS-LEDGER — mark-paid records the remaining balance
 * through recordPayment, so every SUCCESSFUL payment it creates has a ledger
 * posting (REAL database, REAL ledger posting, REAL invoice workflow).
 *
 * Gap report G2 (docs/reconstruction/product/evidence/REVENUE-GAP-REPORT-001.md),
 * payments lane PK-PL-04 (PL-F05), build map CF-09 / R0-20:
 *
 *   G2   markInvoicePaid transitioned the invoice to PAID and then, when the
 *        invoice had no payment row at all, wrote a synthetic
 *        `payment.create` (SUCCESSFUL, provider 'manual') outside any
 *        transaction and with no ledger posting. Cash appeared on the invoice
 *        without a journal entry, and a refund of that row had nothing to
 *        reverse (payments-actor PA-13). An invoice that already held a
 *        partial payment was flipped to PAID with no balancing payment, so
 *        the next reconcile flipped it back to PARTIALLY_PAID.
 *
 * Contract pinned here:
 *
 *   PATCH /commerce/invoices/:id/paid { businessId } by a revenue:write member, SENT invoice, no payments
 *     -> 200; exactly one SUCCESSFUL Payment for the total (provider 'manual', method 'MANUAL',
 *        recordedBy = the acting user), one POSTED Payment:<id>:payment_recorded FinancialTransaction
 *        with balanced ledger entries (createdById = the acting user); invoice PAID with paidAt;
 *        invoice.paid emitted once, after commit
 *   the same after a 60 partial on a 100 invoice
 *     -> one 40 balancing payment with its posting; a later reconcile leaves PAID (no flip-back)
 *   the same on an invoice that is already PAID -> 200, idempotent: no Payment, posting, event or timeline entry
 *   the same on a DRAFT invoice                 -> 409; nothing written
 *   refund of the mark-paid payment             -> a reversal posting whose createdById is the refunder
 *   legacy Stripe webhook call shape markInvoicePaid(invoiceId) (no actor, no tenant; G16 stays DEFERRED)
 *                                               -> PAID through the same path; recordedBy null
 *   KEY (KEY_SYSTEM_ACTOR_ID + businessId)      -> PAID through the same path; recordedBy KEY
 *   KEY without a tenant                        -> 403; nothing written (system-actor contract unchanged)
 *   two concurrent mark-paids                   -> one payment, one posting, one invoice.paid (the invoice lock)
 *   a payment commits while mark-paid waits for the invoice lock:
 *     it settles the invoice                    -> 200 (already PAID: idempotent); mark-paid writes nothing
 *     it leaves a balance                       -> 409; mark-paid writes nothing (its remaining is stale)
 *
 * Review repairs (R0-PL-04 review):
 *   ST-PL04-1  a client record-payment whose idempotencyKey is the old mark-paid key shape
 *              -> mark-paid still records its own balancing payment and ends PAID (no replay of the client row)
 *   ST-PL04-2  a FAILED row the public WiPay callback wrote on the old predictable mark-paid slot
 *              -> mark-paid still ends PAID (its slot is random, server-built, never a client-key slot)
 *   CR-PL04-1  a row the manual refund flipped to REFUNDED before V1-29 on the invoice -> 409; nothing written,
 *              nothing posted (computeBalance counts the flipped row twice; a provider refund row does not block).
 *              V1-29 (D-14): a manual refund is now a separate negative row, so mark-paid after one records
 *              the true remaining and ends PAID (MP-12c)
 *   CR-PL04-2  paid, undone to DRAFT, total edited, re-issued, marked paid again -> 200 PAID with a second payment
 *   either     the write leaves the invoice short of PAID -> 409; no invoice.paid timeline entry
 *
 * R0-20-MARKPAID-CONVERGENCE (conformance of the landed R0-PL-04 behaviour to
 * the R0-20 proof; bound by scripts/proof-admission/manifests/mark-paid-convergence.json):
 *   MP-18  100 paid of 250, then mark-paid -> one 150 balancing payment recorded THROUGH recordPayment
 *          (server-built slot manual_<inv>_markpaid_<hex>, ST-PL04-1/2; not the markpaid_<inv> key
 *          the packet text predates), one Payment:<id>:payment_recorded posting; reconcile keeps PAID
 *   MP-19  TENANT: tenant B's owner marks tenant A's invoice paid -> 404 (businessId B) / 403
 *          (businessId A, BusinessGuard); the Payment table (outside the tenant extension, M31) is
 *          read directly: no row for A's invoice and none in B; no posting, status, event or timeline
 *   MP-19b TENANT on an invoice of A that is already PAID: the idempotent PAID return runs only after
 *          the tenant and membership checks -> 404 under B (same as an unknown id, no invoice body),
 *          403 naming A, the service shapes refused; nothing written
 *   MP-08b KEY without a tenant on an already PAID invoice -> 403 too (and KEY naming B -> 404)
 *   MP-20a an injected posting failure AFTER the payment's ledger rows were written -> 500; payment
 *          and posting rolled back. The reconcile runs after the posting, so the status was never
 *          written here: it stays SENT, which proves no status rollback (MP-20c does)
 *   MP-20b the same failure before writing on a PARTIALLY_PAID invoice -> status and rows as they were
 *   MP-20c an injected posting failure AFTER the status write (the COGS posting step of the
 *          in-transaction reconcile, once PAID, the payment and its posting exist inside the
 *          transaction) -> 500; payment, posting AND status roll back to SENT; a retry is clean
 *   MP-L1  LEDGER: for every refund-free fixture invoice whose rows were all written by the service,
 *          the deposit-side (cash) ledger net = sum(SUCCESSFUL) = computeBalance.paid (each case owns
 *          its invoice, so the end state is the state after that case)
 *   MP-L2  LEDGER: every FinancialTransaction of both tenants balances (debits = credits)
 *
 * KNOWN DEFECT, not admitted as conforming (RA-G16-01, deferred; it.todo below MP-08b): the
 * legacy Stripe webhook shape markInvoicePaid(invoiceId) records provider 'manual' / method
 * 'MANUAL', so RevenuePostingService.depositSystemKey posts a Stripe checkout receipt Dr CASH
 * instead of Dr PAYMENT_PROCESSOR. MP-06 pins only that the caller takes the posted path; MP-L1
 * checks the deposit side as the union CASH | BANK | PAYMENT_PROCESSOR and does not judge the
 * account. Passing the provider needs the webhooks.controller.ts:86 half D-05 does not authorize.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows, and the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Identity attachment is the one stand-in: a test middleware reads
 * `x-pmp-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recording spy; the contact timeline is a recording stub; COGS, stats cache
 * and the AI / Gmail / Drive services are stubs off the boundary. The race
 * cases hold the request at the invoice lock with a barrier on
 * CommerceService.lockInvoiceForPayment and commit the competing payment by a
 * direct write in the gap.
 *
 * Fixtures: prefix `k20a_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { createHash } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k20a_';
const HEADER = 'x-pmp-user';
/** Mirrors KEY_SYSTEM_ACTOR_ID (src/core/auth/system-actor.ts); asserted equal below. */
const KEY_ACTOR = 'key_ai';

const ID = {
  owner: `${P}owner`,
  staff: `${P}staff`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  // one invoice per case so balances never bleed between cases
  invFull: `${P}invFull`,
  invPartial: `${P}invPartial`,
  invTwice: `${P}invTwice`,
  invDraft: `${P}invDraft`,
  invRefund: `${P}invRefund`,
  invWebhook: `${P}invWebhook`,
  invKey: `${P}invKey`,
  invKeyNoTenant: `${P}invKeyNoTenant`,
  invConcurrent: `${P}invConcurrent`,
  invRaceSettled: `${P}invRaceSettled`,
  invRaceMoved: `${P}invRaceMoved`,
  // R0-PL-04 review repairs
  invClientKey: `${P}invClientKey`,
  invSquat: `${P}invSquat`,
  invManualRefund: `${P}invManualRefund`,
  invManualRefundPart: `${P}invManualRefundPart`,
  // V1-29-DM-REFUND-CONVENTION: MP-12c, mark-paid after a refund through the route
  invManualRefundV129: `${P}invManualRefundV129`,
  invProviderRefund: `${P}invProviderRefund`,
  invReissue: `${P}invReissue`,
  invShort: `${P}invShort`,
  // R0-20-MARKPAID-CONVERGENCE
  invPartial250: `${P}invPartial250`,
  invForeign: `${P}invForeign`,
  invPostFail: `${P}invPostFail`,
  invPostFailPartial: `${P}invPostFailPartial`,
  // R0-20-MARKPAID-CONVERGENCE review repairs: the PAID short-circuit behind
  // the tenant demand (SEC4-1) and a failure after the status write (CR-R020-1)
  invForeignPaid: `${P}invForeignPaid`,
  invKeyNoTenantPaid: `${P}invKeyNoTenantPaid`,
  invStatusFail: `${P}invStatusFail`,
  // tenant B (R0-20 TENANT): a second business with its own owner; it owns no invoice
  ownerB: `${P}ownerB`,
  bizB: `${P}bizB`,
};

const INVOICE_TOTAL = 100;
/** Fixture invoices whose total is not INVOICE_TOTAL (R0-20's 100 of 250). */
const INVOICE_TOTALS: Record<string, number> = { [ID.invPartial250]: 250 };
const totalOf = (id: string) => INVOICE_TOTALS[id] ?? INVOICE_TOTAL;
/**
 * R0-20 LEDGER: the fixture invoices left out of the cash-net invariant, and why.
 * Their competing or provider rows are direct db writes standing in for another
 * writer, with no posting (MP-10, MP-11, MP-15), or they carry a refund (M28:
 * refund semantics are V1-29; the R0-20 claim is over refund-free fixtures).
 */
const LEDGER_EXCLUDED: Record<string, string> = {
  [ID.invRaceSettled]: 'direct competing write, no posting',
  [ID.invRaceMoved]: 'direct competing write, no posting',
  [ID.invProviderRefund]: 'direct provider charge and refund rows, no posting',
  [ID.invRefund]: 'refund (M28, V1-29)',
  [ID.invManualRefund]: 'refund (M28, V1-29)',
  [ID.invManualRefundPart]: 'refund (M28, V1-29)',
  [ID.invManualRefundV129]: 'refund (V1-29: cash net = computeBalance.net, not sum(SUCCESSFUL); asserted inline in MP-12c)',
};
/** The deposit-side system accounts a payment posting debits (RevenuePostingService.depositSystemKey). */
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);
const DRAFT_INVOICES = new Set<string>([ID.invDraft]);
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_recorded']);

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
/** The CommerceService class itself: lockInvoiceForPayment is a static on it. */
let CommerceServiceClass: any;
let workflow: InvoiceWorkflowService;
/** Real PaymentsService: the public WiPay callback is the squatter in ST-PL04-2. */
let payments: any;
let systemActorId: string;
/** The real PostingService instance RevenuePostingService posts through (R0-20 failure injection). */
let posting: any;
/** invoice-workflow.service computeBalance (imported after dotenv, like every src module here). */
let computeBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

/**
 * Recording EventEmitter2. For the two invoice payment events it also starts a
 * fresh read of the invoice at emit time, on the shared client outside any
 * transaction: an event emitted before its transaction committed would not
 * see the new status or the payment.
 */
type Emitted = { name: string; payload: any; seen: Promise<{ status: string; paymentIds: string[] } | null> };
const emitted: Emitted[] = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    const invoiceId: string | undefined = payload?.invoice?.id;
    const seen = INVOICE_EVENTS.has(name) && invoiceId
      ? db.invoice
          .findUnique({ where: { id: invoiceId }, include: { payments: true } })
          .then((inv: any) => (inv ? { status: inv.status, paymentIds: inv.payments.map((p: any) => p.id) } : null))
      : Promise.resolve(null);
    emitted.push({ name, payload, seen });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Contact timeline entries (CrmService.logContactEvent is a recording stub). */
const contactEvents: any[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function agent() {
  return request(app.getHttpServer());
}

function markPaid(user: string, inv: string, body: Record<string, unknown> = { businessId: ID.biz }) {
  return agent().patch(`/commerce/invoices/${inv}/paid`).set(HEADER, user).send(body);
}

function pay(user: string, inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/payments`).set(HEADER, user).send(body);
}

function refund(user: string, paymentId: string, reason = 'pmp test refund') {
  return agent().post(`/commerce/businesses/${ID.biz}/payments/${paymentId}/refund`).set(HEADER, user).send({ reason });
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

/** The ledger transaction(s) posted for one payment row (FIN2 externalRef), with their entries. */
async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded` },
    include: { entries: true },
  });
}

async function reversalsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded:reversal` },
  });
}

/** Every FinancialTransaction for this invoice's payments (payment postings carry the invoice number as reference). */
async function paymentPostingsOf(invoiceId: string): Promise<any[]> {
  const inv = await invoiceRow(invoiceId);
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceType: 'Payment', reference: inv.invoiceNumber },
  });
}

function invoiceEventsFor(invoiceId: string, name?: string): Emitted[] {
  return emitted.filter((e) => INVOICE_EVENTS.has(e.name) && e.payload?.invoice?.id === invoiceId && (!name || e.name === name));
}

function timelineFor(invoiceId: string, type?: string): any[] {
  return contactEvents.filter((e) => e.data?.invoiceId === invoiceId && (!type || e.type === type));
}

const sum = (rows: any[], key: 'debit' | 'credit') => rows.reduce((s: number, e: any) => s + Number(e[key] ?? 0), 0);

/** Exactly one POSTED, balanced INCOME posting for this payment, for this amount, by `actor`. */
async function expectPostedOnce(paymentId: string, amount: number, actor: string | null) {
  const txns = await postingsFor(paymentId);
  expect(txns, `postings for ${paymentId}`).toHaveLength(1);
  expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
  expect(Number(txns[0].amount)).toBe(amount);
  expect(txns[0].entries.length, 'ledger entries').toBeGreaterThanOrEqual(2);
  expect(sum(txns[0].entries, 'debit'), 'debits').toBe(amount);
  expect(sum(txns[0].entries, 'credit'), 'credits').toBe(amount);
  expect(txns[0].createdById, `posting creator for ${paymentId}`).toBe(actor);
}

/** The mark-paid row: one SUCCESSFUL manual payment for `amount`, recorded by `actor`. */
function expectMarkPaidRow(row: any, invoiceId: string, amount: number, actor: string | null) {
  expect(row).toMatchObject({
    invoiceId,
    businessId: ID.biz,
    status: 'SUCCESSFUL',
    amount,
    provider: 'manual',
    method: 'MANUAL',
  });
  expect(row.recordedBy, 'recordedBy').toBe(actor);
}

const money = (n: number) => Math.round(n * 100) / 100;

/** Payment rows of an invoice read straight from the table by raw SQL (Payment is outside the tenant extension, M31). */
async function rawPaymentRows(where: 'invoice_id' | 'business_id', value: string): Promise<any[]> {
  return db.$queryRawUnsafe(`SELECT id, business_id, invoice_id, status::text AS status, amount FROM payments WHERE ${where} = $1`, value);
}

/** Every FinancialTransaction (with entries and their accounts) a payment of this invoice sourced, reversals included. */
async function ledgerOf(invoiceId: string, businessId = ID.biz): Promise<{ rows: any[]; txns: any[] }> {
  const rows = await paymentsOf(invoiceId);
  const txns = rows.length === 0
    ? []
    : await db.financialTransaction.findMany({
        where: { businessId, sourceType: 'Payment', sourceId: { in: rows.map((r) => r.id) } },
        include: { entries: { include: { account: { select: { systemKey: true } } } } },
      });
  return { rows, txns };
}

/**
 * R0-20 LEDGER: every transaction the invoice's payments sourced balances, and
 * the deposit-side (cash) ledger net = sum(SUCCESSFUL) = computeBalance.paid.
 * Returns the figures so a caller can pin the amount.
 */
async function expectLedgerConverged(invoiceId: string, businessId = ID.biz) {
  const { rows, txns } = await ledgerOf(invoiceId, businessId);
  for (const t of txns) {
    expect(money(sum(t.entries, 'debit')), `${invoiceId} ${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
  }
  const cashNet = money(
    txns
      .flatMap((t) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const successful = money(rows.filter((r) => r.status === 'SUCCESSFUL').reduce((s, r) => s + Number(r.amount), 0));
  const inv = await invoiceRow(invoiceId);
  const balance = computeBalanceFn(
    Number(inv.total),
    rows.map((r) => ({ amount: Number(r.amount), status: r.status })),
    inv.currency,
  );
  expect(cashNet, `${invoiceId}: ledger cash net = sum(SUCCESSFUL)`).toBe(successful);
  expect(successful, `${invoiceId}: sum(SUCCESSFUL) = computeBalance.paid`).toBe(balance.paid);
  return { cashNet, successful, paid: balance.paid, rows, txns };
}

/** Each event was emitted after its transaction committed: a fresh read at emit time already saw its status and payment. */
async function expectEmittedAfterCommit(event: Emitted, paymentId: string) {
  const seen = await event.seen;
  expect(seen, `${event.name} fresh read`).not.toBeNull();
  expect(seen!.status, `${event.name}: status visible at emit time`).toBe(event.payload.invoice.status);
  expect(seen!.paymentIds, `${event.name}: payment visible at emit time`).toContain(paymentId);
}

/** The invoice is exactly as seeded: no payment, no payment posting, status unchanged, no event. */
async function expectUntouched(invoiceId: string, status: string) {
  expect(await paymentsOf(invoiceId), `payments of ${invoiceId}`).toHaveLength(0);
  expect(await paymentPostingsOf(invoiceId), `postings of ${invoiceId}`).toHaveLength(0);
  expect((await invoiceRow(invoiceId)).status, `status of ${invoiceId}`).toBe(status);
  expect(invoiceEventsFor(invoiceId), `events of ${invoiceId}`).toHaveLength(0);
}

/**
 * Barrier on CommerceService.lockInvoiceForPayment, the first statement of the
 * payment transaction and so after every pre-transaction read: hold the call,
 * run `before` (a change another request commits in the gap), then take the
 * real lock.
 */
function holdAtLock(before: () => Promise<unknown>) {
  const original = CommerceServiceClass.lockInvoiceForPayment;
  let ran: Promise<unknown> | null = null;
  return vi.spyOn(CommerceServiceClass, 'lockInvoiceForPayment').mockImplementation(async (...args: any[]) => {
    ran ??= before();
    await ran;
    return original.apply(CommerceServiceClass, args);
  });
}

/** A payment another request committed: a SUCCESSFUL row written directly (no posting needed for the race). */
async function commitCompetingPayment(invoiceId: string, amount: number, settle: boolean) {
  await db.payment.create({
    data: {
      id: `${invoiceId}_competing`,
      businessId: ID.biz,
      invoiceId,
      amount,
      currency: 'TTD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      providerPaymentId: `${P}pp_${invoiceId}_competing`,
    },
  });
  await db.invoice.update({
    where: { id: invoiceId },
    data: settle ? { status: 'PAID', paidAt: new Date() } : { status: 'PARTIALLY_PAID' },
  });
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
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
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
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  systemActorId = KEY_SYSTEM_ACTOR_ID;

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
      // Real ledger chain: the proof is the rows it posts (or does not).
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async (e: any) => { contactEvents.push(e); return null; } } },
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
  commerce = moduleRef.get(CommerceService);
  CommerceServiceClass = CommerceService;
  workflow = moduleRef.get(InvoiceWorkflowService);
  posting = moduleRef.get(PostingService);
  computeBalanceFn = (await import('../src/modules/commerce/invoice-workflow.service')).computeBalance;
  // Constructed directly with the real collaborators (no connectors: the WiPay
  // failure path only writes the FAILED row).
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  payments = new PaymentsService(moduleRef.get(PrismaService), commerce, workflow, moduleRef.get(RevenuePostingService));

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

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'PMP Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  // A second human with revenue:write, so "the acting user" is never just "the owner".
  await db.membership.create({
    data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'write' } },
  });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Pmp', lastName: 'Customer', email: `${P}c@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  // R0-20 TENANT: tenant B, a real business with its own owner and chart of
  // accounts, so a refusal is the tenant boundary and never a missing account.
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizB, name: 'PMP Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const total = totalOf(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `PMP-${String(n).padStart(3, '0')}`,
        status: DRAFT_INVOICES.has(id) ? 'DRAFT' : 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `PMP item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  emitted.length = 0;
  contactEvents.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows)', () => {
  it('seeded an owner, a revenue:write staff member, a system chart of accounts, DRAFT and SENT invoices with no payments', async () => {
    expect(systemActorId).toBe(KEY_ACTOR);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } })).toBeGreaterThan(0);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
      expect((await invoiceRow(id)).status, id).toBe(DRAFT_INVOICES.has(id) ? 'DRAFT' : 'SENT');
    }
  });
});

describe('mark-paid records the remaining balance as a posted payment (G2)', () => {
  it('MP-01: SENT, no payments -> one SUCCESSFUL payment for the total with a balanced Payment:<id>:payment_recorded posting; PAID with paidAt; invoice.paid once, after commit', async () => {
    const res = await markPaid(ID.owner, ID.invFull);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.invFull, status: 'PAID' });

    const rows = await paymentsOf(ID.invFull);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], ID.invFull, INVOICE_TOTAL, ID.owner);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, ID.owner);

    const inv = await invoiceRow(ID.invFull);
    expect(inv.status).toBe('PAID');
    expect(inv.paidAt).toBeTruthy();

    const paid = invoiceEventsFor(ID.invFull, 'invoice.paid');
    expect(paid).toHaveLength(1);
    await expectEmittedAfterCommit(paid[0], rows[0].id);
    // The operator's timeline keeps the invoice.paid entry, attributed to the actor.
    const timeline = timelineFor(ID.invFull, 'invoice.paid');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ actorId: ID.owner, actorType: 'USER' });
  });

  it('MP-02: after a 60 partial on a 100 invoice, mark-paid by a revenue:write staff member records one 40 balancing payment with its posting; a later reconcile leaves PAID', async () => {
    const partial = await pay(ID.owner, ID.invPartial, { amount: 60, method: 'cash', reference: 'PMP-P-1' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect((await invoiceRow(ID.invPartial)).status).toBe('PARTIALLY_PAID');
    emitted.length = 0;

    const res = await markPaid(ID.staff, ID.invPartial);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await paymentsOf(ID.invPartial);
    expect(rows).toHaveLength(2);
    const balancing = rows.find((r) => r.id !== partial.body.payment.id);
    expectMarkPaidRow(balancing, ID.invPartial, 40, ID.staff);
    await expectPostedOnce(balancing.id, 40, ID.staff);
    const inv = await invoiceRow(ID.invPartial);
    expect(inv.status).toBe('PAID');
    expect(inv.paidAt).toBeTruthy();
    expect(invoiceEventsFor(ID.invPartial, 'invoice.paid')).toHaveLength(1);

    // No flip-back: the payment rows now say PAID, so recomputing from them changes nothing.
    const again = await workflow.reconcileFromPayments(ID.invPartial);
    expect(again).toMatchObject({ status: 'PAID', changed: false });
    expect(again.balance).toMatchObject({ net: INVOICE_TOTAL, remaining: 0, isFullyPaid: true });
    expect((await invoiceRow(ID.invPartial)).status).toBe('PAID');
  });

  it('MP-03: mark-paid on an already PAID invoice is idempotent: 200, no new Payment, posting, event or timeline entry; paidAt unchanged', async () => {
    const first = await markPaid(ID.owner, ID.invTwice);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const rowsBefore = await paymentsOf(ID.invTwice);
    const postingsBefore = await paymentPostingsOf(ID.invTwice);
    const paidAtBefore = (await invoiceRow(ID.invTwice)).paidAt;
    expect(rowsBefore).toHaveLength(1);
    expect(postingsBefore).toHaveLength(1);
    emitted.length = 0;
    contactEvents.length = 0;

    const second = await markPaid(ID.owner, ID.invTwice);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: ID.invTwice, status: 'PAID' });

    expect((await paymentsOf(ID.invTwice)).map((r) => r.id)).toEqual(rowsBefore.map((r) => r.id));
    expect((await paymentPostingsOf(ID.invTwice)).map((t) => t.id)).toEqual(postingsBefore.map((t) => t.id));
    expect((await invoiceRow(ID.invTwice)).paidAt).toEqual(paidAtBefore);
    expect(invoiceEventsFor(ID.invTwice)).toHaveLength(0);
    expect(timelineFor(ID.invTwice)).toHaveLength(0);
  });

  it('MP-04: mark-paid on a DRAFT invoice -> 409; no payment, no posting, still DRAFT, no event', async () => {
    const res = await markPaid(ID.owner, ID.invDraft);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    await expectUntouched(ID.invDraft, 'DRAFT');
    expect(timelineFor(ID.invDraft)).toHaveLength(0);
  });

  // MP-12 (CR-PL04-1): settling an invoice by mark-paid after a MANUAL refund.
  // V1-29-DM-REFUND-CONVENTION (D-14) closed it: a manual refund is a separate
  // negative REFUNDED row counted once, so mark-paid records the true
  // remaining and ends PAID (MP-12c below; test/commerce-refund.integration
  // RF-08). A row flipped to REFUNDED before V1-29 is still refused (MP-12a,
  // MP-12b).

  it('MP-05: a refund of the mark-paid payment reverses its posting and records the refunder on the reversal', async () => {
    const res = await markPaid(ID.owner, ID.invRefund);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [row] = await paymentsOf(ID.invRefund);
    expectMarkPaidRow(row, ID.invRefund, INVOICE_TOTAL, ID.owner);

    const refunded = await refund(ID.staff, row.id);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body.status).toBe('REFUNDED');

    const reversals = await reversalsFor(row.id);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ type: 'REVERSAL', status: 'POSTED', sourceType: 'Payment', sourceId: row.id });
    expect(reversals[0].createdById).toBe(ID.staff);
    const original = await postingsFor(row.id);
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ status: 'REVERSED', createdById: ID.owner });
    expect(reversals[0].reversalOfId).toBe(original[0].id);
    // Who recorded the receipt is not overwritten by the refund.
    expect((await db.payment.findUnique({ where: { id: row.id } })).recordedBy).toBe(ID.owner);
  });
});

describe('every caller of markInvoicePaid takes the same posted path', () => {
  it('MP-06: the legacy Stripe webhook call shape markInvoicePaid(invoiceId) (no actor, no tenant; G16 deferred) -> PAID with a posted payment, recordedBy null', async () => {
    const invoice = await commerce.markInvoicePaid(ID.invWebhook);
    expect(invoice).toMatchObject({ id: ID.invWebhook, status: 'PAID' });
    const rows = await paymentsOf(ID.invWebhook);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], ID.invWebhook, INVOICE_TOTAL, null);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, null);
    expect((await invoiceRow(ID.invWebhook)).paidAt).toBeTruthy();
    expect(invoiceEventsFor(ID.invWebhook, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-07: KEY (KEY_SYSTEM_ACTOR_ID + businessId, the flow orchestrator and updateInvoice shape) -> PAID with a posted payment recorded by KEY', async () => {
    const invoice = await commerce.markInvoicePaid(ID.invKey, systemActorId, ID.biz);
    expect(invoice).toMatchObject({ id: ID.invKey, status: 'PAID' });
    const rows = await paymentsOf(ID.invKey);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], ID.invKey, INVOICE_TOTAL, KEY_ACTOR);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, KEY_ACTOR);
  });

  it('MP-08: KEY without a tenant is still refused (403) and nothing is written', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    await expect(commerce.markInvoicePaid(ID.invKeyNoTenant, systemActorId)).rejects.toBeInstanceOf(ForbiddenException);
    await expectUntouched(ID.invKeyNoTenant, 'SENT');
  });

  it('MP-08b: KEY without a tenant is refused (403) on an invoice that is already PAID too, and KEY naming another tenant gets 404: the idempotent PAID return is no way around the tenant demand; nothing written', async () => {
    const { ForbiddenException, NotFoundException } = await import('@nestjs/common');
    const inv = ID.invKeyNoTenantPaid;
    const first = await markPaid(ID.owner, inv);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const rowsBefore = (await paymentsOf(inv)).map((r) => r.id);
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    const paidAtBefore = (await invoiceRow(inv)).paidAt;
    expect(rowsBefore).toHaveLength(1);
    expect(postingsBefore).toHaveLength(1);
    emitted.length = 0;
    contactEvents.length = 0;

    await expect(commerce.markInvoicePaid(inv, systemActorId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(commerce.markInvoicePaid(inv, systemActorId, ID.bizB)).rejects.toBeInstanceOf(NotFoundException);

    expect((await paymentsOf(inv)).map((r) => r.id)).toEqual(rowsBefore);
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    const after = await invoiceRow(inv);
    expect(after.status).toBe('PAID');
    expect(after.paidAt).toEqual(paidAtBefore);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
  });

  it.todo(
    'MP-06 KNOWN DEFECT (RA-G16-01, deferred; not admitted as conforming): the legacy Stripe webhook shape markInvoicePaid(invoiceId) '
      + "records provider 'manual' / method 'MANUAL', so RevenuePostingService.depositSystemKey posts the Stripe checkout receipt "
      + 'Dr CASH / Cr REVENUE instead of Dr PAYMENT_PROCESSOR. Fixing it needs the caller to name its provider '
      + '(webhooks.controller.ts:86, the webhook half D-05 does not authorize).',
  );
});

describe('concurrency: the remaining balance is the one under the invoice lock', () => {
  it('MP-09: two concurrent mark-paids -> both 200; one payment, one posting, one invoice.paid', async () => {
    const results = await Promise.all([markPaid(ID.owner, ID.invConcurrent), markPaid(ID.staff, ID.invConcurrent)]);
    expect(results.map((r) => r.status), JSON.stringify(results.map((r) => r.body))).toEqual([200, 200]);
    const rows = await paymentsOf(ID.invConcurrent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SUCCESSFUL', amount: INVOICE_TOTAL, provider: 'manual' });
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, rows[0].recordedBy);
    expect((await invoiceRow(ID.invConcurrent)).status).toBe('PAID');
    expect(invoiceEventsFor(ID.invConcurrent, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-10: a payment that settles the invoice commits while mark-paid waits for the lock -> 200 (already PAID); mark-paid writes nothing', async () => {
    holdAtLock(() => commitCompetingPayment(ID.invRaceSettled, INVOICE_TOTAL, true));
    const res = await markPaid(ID.owner, ID.invRaceSettled);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.invRaceSettled, status: 'PAID' });
    const rows = await paymentsOf(ID.invRaceSettled);
    expect(rows.map((r) => r.id)).toEqual([`${ID.invRaceSettled}_competing`]);
    expect(await paymentPostingsOf(ID.invRaceSettled)).toHaveLength(0);
    expect(invoiceEventsFor(ID.invRaceSettled)).toHaveLength(0);
    expect(timelineFor(ID.invRaceSettled)).toHaveLength(0);
  });

  it('MP-11: a partial payment commits while mark-paid waits for the lock -> 409; mark-paid records no stale remaining (no over-payment)', async () => {
    holdAtLock(() => commitCompetingPayment(ID.invRaceMoved, 30, false));
    const res = await markPaid(ID.owner, ID.invRaceMoved);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    const rows = await paymentsOf(ID.invRaceMoved);
    expect(rows.map((r) => r.id)).toEqual([`${ID.invRaceMoved}_competing`]);
    expect(await paymentPostingsOf(ID.invRaceMoved)).toHaveLength(0);
    expect((await invoiceRow(ID.invRaceMoved)).status).toBe('PARTIALLY_PAID');
    expect(invoiceEventsFor(ID.invRaceMoved)).toHaveLength(0);

    // The operator retries against the balance as it now stands: 70 settles it.
    const retry = await markPaid(ID.owner, ID.invRaceMoved);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    const after = await paymentsOf(ID.invRaceMoved);
    expect(after).toHaveLength(2);
    const balancing = after.find((r) => r.id !== `${ID.invRaceMoved}_competing`);
    expectMarkPaidRow(balancing, ID.invRaceMoved, 70, ID.owner);
    await expectPostedOnce(balancing.id, 70, ID.owner);
    expect((await invoiceRow(ID.invRaceMoved)).status).toBe('PAID');
  });
});

describe('review repairs (R0-PL-04 review)', () => {
  /** The pre-repair mark-paid slot: the client-key path's hash of 'markpaid:<inv>:<remaining>:<refunded>'. */
  const oldMarkPaidSlot = (inv: string, remaining: string, refunded = '0.00') =>
    `manual_${inv}_key_${createHash('sha256').update(`markpaid:${inv}:${remaining}:${refunded}`, 'utf8').digest('hex').slice(0, 32)}`;
  /** Mark-paid's own slot: random, server-built, never a client-key or reference slot. */
  const markPaidSlot = (inv: string) => new RegExp(`^manual_${inv}_markpaid_[0-9a-f]{32}$`);

  it('MP-13 (ST-PL04-1): a client payment keyed with the old mark-paid key shape does not capture mark-paid: it records its own 50 balancing payment and ends PAID', async () => {
    const inv = ID.invClientKey;
    const client = await pay(ID.staff, inv, { amount: 50, method: 'cash', idempotencyKey: `markpaid:${inv}:50.00:0.00` });
    expect(client.status, JSON.stringify(client.body)).toBe(201);
    expect(client.body.payment.providerPaymentId).toBe(oldMarkPaidSlot(inv, '50.00'));
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const balancing = rows.find((r) => r.id !== client.body.payment.id);
    expectMarkPaidRow(balancing, inv, 50, ID.owner);
    expect(balancing.providerPaymentId).toMatch(markPaidSlot(inv));
    await expectPostedOnce(balancing.id, 50, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
    const timeline = timelineFor(inv, 'invoice.paid');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ actorId: ID.owner, actorType: 'USER' });
  });

  it('MP-14 (ST-PL04-2): a FAILED row the unauthenticated WiPay failure callback wrote on the old predictable slot does not block mark-paid', async () => {
    const inv = ID.invSquat;
    const squat = oldMarkPaidSlot(inv, '100.00');
    const cb = await payments.handleWipayCallback({ order_id: inv, status: 'failed', transaction_id: squat, total: '100' });
    expect(cb, JSON.stringify(cb)).toMatchObject({ invoiceId: inv });
    const before = await paymentsOf(inv);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ providerPaymentId: squat, status: 'FAILED', businessId: ID.biz, invoiceId: inv });

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const marked = rows.find((r) => r.providerPaymentId !== squat);
    expectMarkPaidRow(marked, inv, INVOICE_TOTAL, ID.owner);
    expect(marked.providerPaymentId).toMatch(markPaidSlot(inv));
    await expectPostedOnce(marked.id, INVOICE_TOTAL, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
  });

  // MP-12a / MP-12b titles are bound by manifests/mark-paid-convergence.json.
  // Since V1-29 (D-14) the refund route writes a separate negative row (MP-12c),
  // so the manual flip these cases name is seeded directly, as legacy data.
  it('MP-12a (CR-PL04-1): 60 paid then refunded (manual flip) on a 100 invoice -> mark-paid 409; no payment, no posting, status unchanged, no event or timeline entry', async () => {
    const inv = ID.invManualRefund;
    const paid = await pay(ID.owner, inv, { amount: 60, method: 'cash', reference: 'PMP-MR-1' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    // The pre-V1-29 manual flip, seeded directly (the route no longer writes it).
    await db.payment.update({ where: { id: paid.body.payment.id }, data: { status: 'REFUNDED' } });
    // Characterization (legacy rows only): computeBalance reads a flipped row
    // sign-agnostically, so it is dropped from paid AND subtracted again; the
    // operator read now serves computeBalance's figures too (V1-29, CF-17).
    expect(await commerce.getInvoiceForBusiness(inv, ID.biz)).toMatchObject({ paidAmount: -60, remaining: 160 });
    const statusBefore = (await invoiceRow(inv)).status;
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(409);

    const rows = await paymentsOf(inv);
    expect(rows.map((r) => [r.id, Number(r.amount), r.status])).toEqual([[paid.body.payment.id, 60, 'REFUNDED']]);
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    expect((await invoiceRow(inv)).status).toBe(statusBefore);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
  });

  it('MP-12b (CR-PL04-1): a manual refund that leaves remaining below the total still blocks (30 refunded, 50 paid: computeBalance 80, true 50) -> 409; nothing written', async () => {
    const inv = ID.invManualRefundPart;
    const a = await pay(ID.owner, inv, { amount: 30, method: 'cash', reference: 'PMP-MRP-A' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await pay(ID.owner, inv, { amount: 50, method: 'cash', reference: 'PMP-MRP-B' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    // The pre-V1-29 manual flip of the 30, seeded directly (the route no longer writes it).
    await db.payment.update({ where: { id: a.body.payment.id }, data: { status: 'REFUNDED' } });
    const statusBefore = (await invoiceRow(inv)).status;
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(409);

    expect((await paymentsOf(inv)).map((r) => r.id).sort()).toEqual([a.body.payment.id, b.body.payment.id].sort());
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    expect((await invoiceRow(inv)).status).toBe(statusBefore);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
  });

  it('MP-12c (V1-29, D-14): 30 + 50 paid, the 30 refunded through the route (a separate -30 row) -> mark-paid records the true remaining 50 with one posting and ends PAID; the ledger cash net equals computeBalance.net', async () => {
    const inv = ID.invManualRefundV129;
    const a = await pay(ID.owner, inv, { amount: 30, method: 'cash', reference: 'PMP-MRC-A' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await pay(ID.owner, inv, { amount: 50, method: 'cash', reference: 'PMP-MRC-B' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const refunded = await refund(ID.owner, a.body.payment.id);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body).toMatchObject({ status: 'REFUNDED', amount: -30, refundOfPaymentId: a.body.payment.id });
    // computeBalance: paid 80, refunded 30, net 50, remaining 50 (the base read remaining 80).
    expect(await commerce.getInvoiceForBusiness(inv, ID.biz)).toMatchObject({ paidAmount: 50, remaining: 50 });
    emitted.length = 0;
    contactEvents.length = 0;

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(4);
    const marked = rows.find((r) => r.providerPaymentId.includes('_markpaid_'));
    expectMarkPaidRow(marked, inv, 50, ID.owner);
    await expectPostedOnce(marked.id, 50, ID.owner);
    expect(await reversalsFor(a.body.payment.id)).toHaveLength(1);
    const row = await invoiceRow(inv);
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);

    // LEDGER (V1-29): every posting balances and the cash net of the invoice's
    // payment postings (30 + 50 + 50 - 30 reversed) equals computeBalance.net.
    const { rows: ledgerRows, txns } = await ledgerOf(inv);
    for (const t of txns) expect(money(sum(t.entries, 'debit')), `${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
    const cashNet = money(
      txns.flatMap((t) => t.entries).filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
        .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
    );
    const balance = computeBalanceFn(INVOICE_TOTAL, ledgerRows.map((r) => ({ amount: Number(r.amount), status: r.status })), 'TTD');
    expect(balance).toMatchObject({ paid: 130, refunded: 30, net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
    expect(cashNet).toBe(balance.net);
  });

  it('MP-15 (CR-PL04-1, narrow): a provider refund (a separate negative REFUNDED row beside a SUCCESSFUL original) does not block: mark-paid records the 40 net balance and ends PAID', async () => {
    const inv = ID.invProviderRefund;
    await db.payment.create({
      data: {
        id: `${inv}_charge`, businessId: ID.biz, invoiceId: inv, amount: INVOICE_TOTAL, currency: 'TTD',
        status: 'SUCCESSFUL', provider: 'stripe', method: 'card', providerPaymentId: `${P}pp_${inv}_charge`,
      },
    });
    await db.payment.create({
      data: {
        id: `${inv}_refund`, businessId: ID.biz, invoiceId: inv, amount: -40, currency: 'TTD',
        status: 'REFUNDED', provider: 'stripe', providerPaymentId: `${P}pp_${inv}_refund`, reference: `${inv}_charge`,
      },
    });
    await db.invoice.update({ where: { id: inv }, data: { status: 'PARTIALLY_PAID' } });

    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(3);
    const marked = rows.find((r) => r.id !== `${inv}_charge` && r.id !== `${inv}_refund`);
    expectMarkPaidRow(marked, inv, 40, ID.owner);
    await expectPostedOnce(marked.id, 40, ID.owner);
  });

  it('MP-16 (CR-PL04-2): paid, undone to DRAFT, total edited to 200, re-issued, marked paid again -> 200 PAID with a second 100 payment and invoice.paid', async () => {
    const inv = ID.invReissue;
    const first = await markPaid(ID.owner, inv);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const [firstRow] = await paymentsOf(inv);
    expectMarkPaidRow(firstRow, inv, INVOICE_TOTAL, ID.owner);

    expect(await commerce.undoInvoice(inv, ID.biz)).toMatchObject({ status: 'reverted_to_draft' });
    await commerce.updateInvoice({
      invoiceId: inv,
      businessId: ID.biz,
      items: [
        { description: 'PMP reissue 1', quantity: 1, unitPrice: 100 },
        { description: 'PMP reissue 2', quantity: 1, unitPrice: 100 },
      ],
    });
    expect(Number((await invoiceRow(inv)).total)).toBe(200);
    await workflow.transition(inv, 'SENT');
    expect((await invoiceRow(inv)).status).toBe('SENT');
    emitted.length = 0;
    contactEvents.length = 0;

    const second = await markPaid(ID.owner, inv);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: inv, status: 'PAID' });
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const secondRow = rows.find((r) => r.id !== firstRow.id);
    expectMarkPaidRow(secondRow, inv, 100, ID.owner);
    expect(secondRow.providerPaymentId).not.toBe(firstRow.providerPaymentId);
    await expectPostedOnce(secondRow.id, 100, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
    expect(timelineFor(inv, 'invoice.paid')).toHaveLength(1);
  });

  it('MP-17 (ST-PL04-1 / CR-PL04-2): when the write leaves the invoice short of PAID, mark-paid answers 409 and logs no invoice.paid', async () => {
    const inv = ID.invShort;
    // Stand-in for a write that did not settle the invoice (the pre-repair
    // replay of another row): it resolves and changes nothing.
    const spy = vi.spyOn(commerce, 'recordPayment').mockResolvedValue({} as any);

    const res = await markPaid(ID.owner, inv);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(timelineFor(inv)).toHaveLength(0);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
  });
});

describe('R0-20-MARKPAID-CONVERGENCE: the R0-20 proof against the landed mark-paid', () => {
  /** Mark-paid's own slot (R0-PL-04 review ST-PL04-1 / ST-PL04-2): random, server-built. */
  const markPaidSlot = (inv: string) => new RegExp(`^manual_${inv}_markpaid_[0-9a-f]{32}$`);

  it('MP-18: 100 paid of 250, then mark-paid -> one 150 balancing payment recorded through recordPayment on the server-built markpaid slot, one Payment:<id>:payment_recorded posting, PAID; a later reconcile keeps PAID', async () => {
    const inv = ID.invPartial250;
    const partial = await pay(ID.owner, inv, { amount: 100, method: 'cash', reference: 'PMP-250-1' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    expect((await expectLedgerConverged(inv)).cashNet).toBe(100);
    emitted.length = 0;
    contactEvents.length = 0;

    // Installed after the partial (which also goes through recordPayment): it calls through.
    const through = vi.spyOn(commerce, 'recordPayment');
    const res = await markPaid(ID.owner, inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });
    expect(through).toHaveBeenCalledTimes(1);
    expect(through).toHaveBeenCalledWith(
      inv,
      ID.biz,
      { amount: 150, method: 'MANUAL' },
      expect.objectContaining({
        actorId: ID.owner,
        provider: 'manual',
        expectRemaining: 150,
        providerPaymentId: expect.stringMatching(markPaidSlot(inv)),
      }),
    );

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(2);
    const balancing = rows.find((r) => r.id !== partial.body.payment.id);
    expectMarkPaidRow(balancing, inv, 150, ID.owner);
    expect(balancing.providerPaymentId).toMatch(markPaidSlot(inv));
    await expectPostedOnce(balancing.id, 150, ID.owner);
    const after = await invoiceRow(inv);
    expect(after.status).toBe('PAID');
    expect(after.paidAt).toBeTruthy();
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);

    // No flip-back to PARTIALLY_PAID (invoice-workflow allows PAID -> PARTIALLY_PAID).
    const again = await workflow.reconcileFromPayments(inv);
    expect(again).toMatchObject({ status: 'PAID', changed: false });
    expect(again.balance).toMatchObject({ paid: 250, net: 250, remaining: 0, isFullyPaid: true });
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect((await expectLedgerConverged(inv)).cashNet).toBe(250);
  });

  it("MP-19 TENANT: tenant B's owner cannot mark tenant A's invoice paid (404 under B, 403 naming A, 403 with no tenant); the Payment table read directly holds no row for A's invoice and none in B; nothing posted; status, event and timeline unchanged", async () => {
    const { NotFoundException, ForbiddenException } = await import('@nestjs/common');
    const inv = ID.invForeign;
    const ledgerA = await db.financialTransaction.count({ where: { businessId: ID.biz } });
    const ledgerB = await db.financialTransaction.count({ where: { businessId: ID.bizB } });

    // Under its own tenant: indistinguishable from an unknown id.
    const own = await markPaid(ID.ownerB, inv, { businessId: ID.bizB });
    expect(own.status, JSON.stringify(own.body)).toBe(404);
    const unknown = await markPaid(ID.ownerB, `${P}invNoSuch`, { businessId: ID.bizB });
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(own.body.message).toEqual(unknown.body.message);
    // Naming tenant A: B's owner is no member of A (BusinessGuard).
    const named = await markPaid(ID.ownerB, inv, { businessId: ID.biz });
    expect(named.status, JSON.stringify(named.body)).toBe(403);
    // Service shapes: tenant-bound (KEY / flow orchestrator) -> 404; actor only, no tenant -> 403 (membership).
    await expect(commerce.markInvoicePaid(inv, ID.ownerB, ID.bizB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(commerce.markInvoicePaid(inv, ID.ownerB)).rejects.toBeInstanceOf(ForbiddenException);

    // M31: Payment is outside the tenant extension, so read the table itself.
    expect(await rawPaymentRows('invoice_id', inv)).toEqual([]);
    expect(await rawPaymentRows('business_id', ID.bizB)).toEqual([]);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz } })).toBe(ledgerA);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizB } })).toBe(ledgerB);
    await expectUntouched(inv, 'SENT');
    expect((await invoiceRow(inv)).paidAt).toBeNull();
    expect(timelineFor(inv)).toHaveLength(0);
    expect((await expectLedgerConverged(inv)).cashNet).toBe(0);
  });

  it("MP-19b TENANT on an already PAID invoice: the idempotent PAID return runs only after the tenant and membership checks, so tenant B's owner gets the unknown-id 404 under B (no invoice body), 403 naming A, and the service shapes are refused; A's payment, posting, paidAt, events and timeline unchanged", async () => {
    const { NotFoundException, ForbiddenException } = await import('@nestjs/common');
    const inv = ID.invForeignPaid;
    const first = await markPaid(ID.owner, inv);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const rowsBefore = (await paymentsOf(inv)).map((r) => r.id);
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    const paidAtBefore = (await invoiceRow(inv)).paidAt;
    expect(rowsBefore).toHaveLength(1);
    expect(postingsBefore).toHaveLength(1);
    const ledgerA = await db.financialTransaction.count({ where: { businessId: ID.biz } });
    const ledgerB = await db.financialTransaction.count({ where: { businessId: ID.bizB } });
    emitted.length = 0;
    contactEvents.length = 0;

    // Under its own tenant: the same 404 as an unknown id, and none of A's invoice in the body.
    const own = await markPaid(ID.ownerB, inv, { businessId: ID.bizB });
    expect(own.status, JSON.stringify(own.body)).toBe(404);
    const unknown = await markPaid(ID.ownerB, `${P}invNoSuch`, { businessId: ID.bizB });
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(own.body.message).toEqual(unknown.body.message);
    for (const leaked of ['id', 'invoiceNumber', 'total', 'items', 'contact', 'businessId', 'paidAt']) {
      expect(own.body, `404 body carries no ${leaked}`).not.toHaveProperty(leaked);
    }
    // Naming tenant A: B's owner is no member of A (BusinessGuard).
    const named = await markPaid(ID.ownerB, inv, { businessId: ID.biz });
    expect(named.status, JSON.stringify(named.body)).toBe(403);
    expect(named.body).not.toHaveProperty('invoiceNumber');
    // Service shapes: tenant-bound -> 404; actor only, no tenant -> 403 (membership).
    await expect(commerce.markInvoicePaid(inv, ID.ownerB, ID.bizB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(commerce.markInvoicePaid(inv, ID.ownerB)).rejects.toBeInstanceOf(ForbiddenException);

    // M31: the Payment table read directly.
    expect((await rawPaymentRows('invoice_id', inv)).map((r) => r.id)).toEqual(rowsBefore);
    expect(await rawPaymentRows('business_id', ID.bizB)).toEqual([]);
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz } })).toBe(ledgerA);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizB } })).toBe(ledgerB);
    const after = await invoiceRow(inv);
    expect(after.status).toBe('PAID');
    expect(after.paidAt).toEqual(paidAtBefore);
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
    expect((await expectLedgerConverged(inv)).cashNet).toBe(INVOICE_TOTAL);
  });

  // The payment posting runs before the reconcile inside recordPayment's
  // transaction, so a failure of the posting itself (MP-20a, MP-20b) strikes
  // before the status is written: the status assertions there show it never
  // moved, not that it rolled back. MP-20c fails after the status write.
  it('MP-20a: an injected posting failure after the ledger rows were written rolls back the payment and the posting (500); the status, not yet written, stays SENT; a retry records exactly one payment and one posting', async () => {
    const inv = ID.invPostFail;
    const original = posting.post;
    const seenInTx: Array<{ paymentId: string; postedInTx: number; paymentInTx: number }> = [];
    const spy = vi.spyOn(posting, 'post').mockImplementation(async (input: any, tx: any) => {
      await original.call(posting, input, tx);
      seenInTx.push({
        paymentId: input.sourceId,
        postedInTx: await tx.financialTransaction.count({
          where: { businessId: input.businessId, externalRef: `Payment:${input.sourceId}:payment_recorded` },
        }),
        paymentInTx: await tx.payment.count({ where: { id: input.sourceId } }),
      });
      throw new Error('pmp injected posting failure');
    });

    const res = await markPaid(ID.owner, inv);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    // The failure struck once the payment and its posting existed inside the transaction ...
    expect(seenInTx).toEqual([{ paymentId: expect.any(String), postedInTx: 1, paymentInTx: 1 }]);
    // ... and none of it committed (the Payment table read directly).
    expect(await rawPaymentRows('invoice_id', inv)).toEqual([]);
    expect(await db.payment.findUnique({ where: { id: seenInTx[0].paymentId } })).toBeNull();
    expect(await postingsFor(seenInTx[0].paymentId)).toHaveLength(0);
    expect(await db.ledgerEntry.count({ where: { businessId: ID.biz, transaction: { sourceId: seenInTx[0].paymentId } } })).toBe(0);
    await expectUntouched(inv, 'SENT');
    expect((await invoiceRow(inv)).paidAt).toBeNull();
    expect(timelineFor(inv)).toHaveLength(0);

    spy.mockRestore();
    const retry = await markPaid(ID.owner, inv);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], inv, INVOICE_TOTAL, ID.owner);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, ID.owner);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
    expect((await expectLedgerConverged(inv)).cashNet).toBe(INVOICE_TOTAL);
  });

  it('MP-20b: the same failure before anything is posted, on a PARTIALLY_PAID invoice -> 500; the partial row, its posting and PARTIALLY_PAID stand as they were', async () => {
    const inv = ID.invPostFailPartial;
    const partial = await pay(ID.owner, inv, { amount: 60, method: 'cash', reference: 'PMP-PF-1' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    const postingsBefore = (await paymentPostingsOf(inv)).map((t) => t.id).sort();
    expect(postingsBefore).toHaveLength(1);
    emitted.length = 0;
    contactEvents.length = 0;

    const spy = vi.spyOn(posting, 'post').mockRejectedValue(new Error('pmp injected posting failure'));
    const res = await markPaid(ID.owner, inv);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status, JSON.stringify(res.body)).toBe(500);

    expect((await rawPaymentRows('invoice_id', inv)).map((r) => [r.id, Number(r.amount), r.status])).toEqual([
      [partial.body.payment.id, 60, 'SUCCESSFUL'],
    ]);
    expect((await paymentPostingsOf(inv)).map((t) => t.id).sort()).toEqual(postingsBefore);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    expect(invoiceEventsFor(inv)).toHaveLength(0);
    expect(timelineFor(inv)).toHaveLength(0);
    expect((await expectLedgerConverged(inv)).cashNet).toBe(60);
  });

  it('MP-20c: an injected posting failure after the status write (the COGS posting step of the in-transaction reconcile, once PAID, paidAt, the payment and its posting exist inside the transaction) -> 500; payment, posting and status all roll back to SENT; a retry records exactly one payment and one posting', async () => {
    const inv = ID.invStatusFail;
    // The reconcile writes the status, then posts COGS through the same
    // transaction client (invoice-workflow.service reconcileFromPayments ->
    // postCogsForPaidInvoice). Call through, look inside the transaction, then fail.
    // postCogsForPaidInvoice is private: reach it through a structural view of the instance.
    const target = workflow as unknown as { postCogsForPaidInvoice: (...args: unknown[]) => Promise<void> };
    const original = target.postCogsForPaidInvoice;
    const originalReconcile = workflow.reconcileFromPayments.bind(workflow);
    const seenInTx: Array<{ status: string; paidAt: boolean; payments: number; postings: number; sameTx: boolean }> = [];
    // The transaction client recordPayment handed the reconcile (undefined if the reconcile ran outside it).
    let reconcileTx: unknown;
    const reconcileSpy = vi.spyOn(workflow, 'reconcileFromPayments').mockImplementation(async (invoiceId, extra) => {
      reconcileTx = extra?.tx;
      return originalReconcile(invoiceId, extra);
    });
    const spy = vi.spyOn(target, 'postCogsForPaidInvoice').mockImplementation(async (...args: unknown[]) => {
      const invoiceId = args[0] as string;
      // The transaction client the reconcile wrote the status through (same shape as the shared client).
      const tx = args[4] as typeof db;
      await original.apply(target, args);
      const row = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { status: true, paidAt: true } });
      const paymentRows: Array<{ id: string }> = await tx.payment.findMany({ where: { invoiceId }, select: { id: true } });
      const postings = paymentRows.length === 0
        ? 0
        : await tx.financialTransaction.count({
            where: { businessId: ID.biz, externalRef: { in: paymentRows.map((p) => `Payment:${p.id}:payment_recorded`) } },
          });
      seenInTx.push({
        status: row?.status,
        paidAt: Boolean(row?.paidAt),
        payments: paymentRows.length,
        postings,
        sameTx: tx !== undefined && tx === reconcileTx,
      });
      throw new Error('pmp injected COGS posting failure after the status write');
    });

    const res = await markPaid(ID.owner, inv);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    // Inside the transaction the status was written: PAID with paidAt, the payment and its posting present ...
    expect(seenInTx).toEqual([{ status: 'PAID', paidAt: true, payments: 1, postings: 1, sameTx: true }]);
    // ... and none of it committed: the status rolled back with the payment and the posting.
    expect(await rawPaymentRows('invoice_id', inv)).toEqual([]);
    await expectUntouched(inv, 'SENT');
    expect((await invoiceRow(inv)).paidAt).toBeNull();
    expect(timelineFor(inv)).toHaveLength(0);

    spy.mockRestore();
    reconcileSpy.mockRestore();
    const retry = await markPaid(ID.owner, inv);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(1);
    expectMarkPaidRow(rows[0], inv, INVOICE_TOTAL, ID.owner);
    await expectPostedOnce(rows[0].id, INVOICE_TOTAL, ID.owner);
    const after = await invoiceRow(inv);
    expect(after.status).toBe('PAID');
    expect(after.paidAt).toBeTruthy();
    expect(invoiceEventsFor(inv, 'invoice.paid')).toHaveLength(1);
    expect((await expectLedgerConverged(inv)).cashNet).toBe(INVOICE_TOTAL);
  });
});

describe('R0-20 LEDGER: the ledger converges with the payment rows after every case', () => {
  it('MP-L1: for every refund-free fixture invoice whose rows the service wrote, ledger cash net = sum(SUCCESSFUL) = computeBalance.paid', async () => {
    const swept = Object.values(ID).filter((v) => v.startsWith(`${P}inv`) && !(v in LEDGER_EXCLUDED));
    let successfulRows = 0;
    let paidInvoices = 0;
    for (const inv of swept) {
      const r = await expectLedgerConverged(inv);
      expect(r.rows.filter((row) => row.status === 'REFUNDED'), `${inv}: refund-free`).toHaveLength(0);
      successfulRows += r.rows.filter((row) => row.status === 'SUCCESSFUL').length;
      if ((await invoiceRow(inv)).status === 'PAID') paidInvoices += 1;
    }
    // Not vacuous: each case owns its invoice, so these are the states the cases above left.
    expect(successfulRows).toBeGreaterThanOrEqual(10);
    expect(paidInvoices).toBeGreaterThanOrEqual(10);
  });

  it('MP-L2: every FinancialTransaction of both tenants balances (debits = credits), reversals included', async () => {
    const txns = await db.financialTransaction.findMany({
      where: { businessId: { in: [ID.biz, ID.bizB] } },
      include: { entries: true },
    });
    expect(txns.length).toBeGreaterThan(0);
    for (const t of txns) {
      expect(t.entries.length, `${t.externalRef}: entries`).toBeGreaterThanOrEqual(2);
      expect(money(sum(t.entries, 'debit')), `${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
    }
  });
});
