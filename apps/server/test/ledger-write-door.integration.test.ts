/**
 * V1-15-DM-LEDGER-WRITE-DOOR — the posting door enforces closed accounting
 * periods, and the ledger it writes balances (REAL database, REAL posting,
 * REAL invoice workflow).
 *
 * CF-40 / M30 (docs/reconstruction/BUILD-MAP-001.md):
 *
 *   CF-40  Closing an accounting period was metadata only. AccountingPeriodService
 *          stamped `lockedByPeriod` on the period's transactions, but
 *          checkClosed() had no caller, so PostingService.post() dated inside a
 *          CLOSED period succeeded, and so did every payment, refund and expense
 *          that posts through it.
 *   M30    Journal balance was enforced only in application code, with no
 *          real-database trial balance per currency.
 *
 * Contract pinned here:
 *
 *   LWD-01  post() dated inside a CLOSED period (first day, mid-month, last
 *           instant)                          -> ConflictException (409); no row
 *   LWD-02  reopen the period                 -> the same post succeeds, balanced
 *   LWD-03  another tenant's CLOSED period does not block this tenant
 *   LWD-04  an idempotent replay of a posting that already exists returns it
 *           (writes nothing) even after its period closed
 *
 *   V1-15 review repairs (the rule: a period is closed only once it has ENDED,
 *   so what is dated now, which is every payment, provider settlement, refund
 *   and reversal, never meets an enforced closed period):
 *
 *   LWD-05  (SEC-V15-1) closing the current or a future period -> 400; it stays
 *           OPEN with no audit row. With last month CLOSED, an HTTP manual
 *           payment (dated now) posts
 *   LWD-06  a CLOSED current period left by a close made before this rule
 *           (closing was metadata only before V1-15) is not enforced: an HTTP
 *           manual payment and an HTTP refund post
 *   LWD-07  (SEC-V15-1) provider settlements under that CLOSED current period
 *           and a CLOSED last month: a signed WiPay callback and a signed Stripe
 *           checkout.session.completed record the payment and post it once; the
 *           invoice is PAID; the redelivery is a duplicate and writes nothing.
 *           At a5d73ff6 the first delivery was refused after its dedupe row
 *           committed, and every redelivery was acked as a duplicate: lost.
 *   LWD-08  (SEC-V15-3) a close that starts while a posting dated inside the
 *           period is in flight waits for it, then stamps it lockedByPeriod; a
 *           posting after the close is refused
 *   LWD-09  (SEC-V15-2) HTTP close / reopen (FinanceController, real AuthGuard,
 *           BusinessGuard and the global TenantInterceptor): a STAFF member gets
 *           403 on close and on reopening the owner's close, and nothing
 *           changes; the owner and an ADMIN may; every close and reopen leaves a
 *           finance audit row naming its actor (a reopen also the closer it
 *           undid); unauthenticated -> 401
 *
 *   V1-15b-LEDGER-DOOR-COMPANIONS (the V1-15 review's CR-1..CR-3, whose fixes sat
 *   outside V1-15's write set):
 *
 *   LWD-10  (CR-1) cash-basis tenant: a payment refunded through the door nets to
 *           zero in the cash P&L (the REVERSED original is read beside its
 *           REVERSAL); the accrual P&L agrees
 *   LWD-11  (CR-1) accrual tenant, cash-basis view: a refunded collection traced to
 *           its invoice, a voided paid expense and a voided paid bill each net to
 *           zero in the cash P&L and the cash cashflow, and no reversal is counted
 *           twice; the accrual P&L and the expense breakdowns agree
 *   LWD-12  (CR-2) HTTP depreciate / dispose dated inside a CLOSED month -> 409
 *           and nothing is written (asset row unchanged, no posting). In an open
 *           month each run is one transaction with its posting: a second
 *           depreciation run posts its own delta (the ledger keeps up with the
 *           row), a disposal posts once, a second dispose -> 400, and an asset
 *           with no depreciation disposed for nothing posts (no zero entry)
 *   LWD-13  (CR-3) HTTP statement import with auto-match: a rule-matched row dated
 *           inside a CLOSED month stays UNMATCHED with a visible reason (finance
 *           audit row, and the skipped list of POST bank-rules/apply); the other
 *           rows are matched, each to its own posting (externalRef
 *           BankRule:<ruleId>:<bankTransactionId>); the import succeeds. After a
 *           reopen the skipped row matches and posts once
 *
 *   V1-15b review repairs:
 *
 *   LWD-14  (SEC-V15b-1) a depreciation run dated inside a CLOSED month -> 409
 *           even when it would post nothing; a run that would lower the
 *           accumulated figure (an earlier asOf) or a replay writes nothing; the
 *           next run posts only its own delta, and the ledger holds the row's figure
 *   LWD-15  (SEC-V15b-2 / CRR-2) depreciating a DISPOSED asset -> 400 and nothing
 *           is posted (it stays DISPOSED; a second dispose stays 400, also dated
 *           in a closed month); racing depreciation / disposal pairs never leave
 *           a disposal on a live asset or a disposal built from a stale figure; a
 *           disposal the ledger already holds is not replayed onto a row that
 *           lost it (409, nothing changed)
 *   LWD-16  (SEC-V15b-3 / CRR-1) two concurrent POST bank-rules/apply of one
 *           UNMATCHED row both answer 201; the row is matched once, to one posting
 *   LWD-17  (SEC-V15b-4) a re-applied row re-links its own earlier posting, but
 *           not once another bank row claims it or it was reversed: the row stays
 *           UNMATCHED and is skipped with the reason
 *
 *   V1-15b repair2 (review SEC9-1, LC-1, LC-3):
 *
 *   LWD-18  (SEC9-1) a PATCH of a period that read it OPEN and writes after an
 *           admin's close committed -> 400: the CLOSED period keeps its month
 *           and that month stays shut (at f366085e the PATCH moved the CLOSED
 *           row to a future month, so the closed month took postings again,
 *           with no PERIOD_REOPENED)
 *   LWD-19  (SEC9-1) the same race on DELETE -> 400; the CLOSED period stays
 *   LWD-20  (SEC9-1) PATCH / DELETE of a period is the owner's or an admin's
 *           (STAFF -> 403, nothing changes; unauthenticated -> 401); a CLOSED
 *           period is refused to them too
 *   LWD-21  (LC-1) a signed Stripe checkout.session.completed dated now,
 *           arriving while a close stamps last month slowly (~6ms a row, a
 *           hosted database's round trip), is recorded and posted at once; a
 *           posting dated in that month still waits for the close and is
 *           refused; the redelivery is a duplicate. At f366085e the settlement
 *           queued behind the close's business-wide lock, its transaction
 *           expired (P2028) after its dedupe row committed, and the redelivery
 *           was acked as a duplicate: the payment was lost
 *   LWD-22  (LC-1) close stamps every transaction of its month (1100, past the
 *           1000-row read cap), keeping their own metadata; reopen clears every
 *           stamp; the audit rows count them all
 *   LWD-23  (LC-3) with 1001 cash transactions in range, the REVERSAL past the
 *           1000th is read: cash P&L and cash cashflow equal the accrual figures
 *
 *   V1-15c-PAYMENT-INGRESS-AND-READERS (the V1-15 / V1-15b verification):
 *
 *   LWD-24  a PayPal capture (capturePaypalOrder; the SDK client stubbed at
 *           getPaypalClient, no network) records its payment through the door:
 *           one SUCCESSFUL row and its INCOME posting; the invoice is PAID. At
 *           cb50b388 it wrote the row with payment.create and posted nothing
 *   LWD-25  the capture's row and posting commit together: when the posting
 *           aborts, no SUCCESSFUL row is left unposted. Review (SEC-V15C-2,
 *           CR-V15C-1): PayPal has already taken the money, so the abort is
 *           not a failed capture: the call answers COMPLETED with no FAILED row
 *           and no payment.failed event (at 1504b037: 'Failed to capture PayPal
 *           order', a FAILED row for the whole total and emitPaymentFailed);
 *           the transient abort is retried a bounded number of times, then
 *           PayPal's PAYMENT.CAPTURE.COMPLETED delivery records the capture
 *           once, and a second payment of the invoice is refused
 *   LWD-25b a transient abort of the first recording attempt is retried: the
 *           capture is recorded and posted once and announced once
 *   LWD-25c PayPal's own PAYMENT.CAPTURE.COMPLETED delivery records the capture
 *           between the capture call and its recording (P2002 on the capture
 *           id): the call answers COMPLETED, nothing FAILED, one row posted
 *           once, announced once (by the delivery)
 *   LWD-26  the dimension breakdowns read every ledger row past the 1000-row
 *           read cap: with 1001 invoice postings, revenue by customer and by
 *           product count all 1001; with 1001 bills, expense by vendor and by
 *           project count all 1001 (at cb50b388: 1000 of each)
 *   LWD-27  AP aging reads every AP entry and every bill past the cap: 1001
 *           open bills age into their bucket in full (at cb50b388: 1000)
 *
 *   TB-01  trial balance after payments (two currencies), a refund and an
 *           expense void: sum(debit) = sum(credit) per currency, every
 *           transaction balanced, entry currency = transaction currency
 *   TB-02   accrual AR net per invoice = computeBalance(...).remaining, for every
 *           invoice whose payments were not refunded; the AR account holds
 *           nothing that is not attributable to an invoice
 *   TB-03   (todo) the same equality for a refunded invoice: blocked by M28,
 *           see the case.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService, ExpensesService, ExpensePostingService,
 * PaymentsService (its WiPay / Stripe webhook handlers), LedgerReportingService,
 * and (behind FinanceController) FixedAssetService, BankImportService,
 * BankMatchingService, BankRuleService and FinanceAuditService read and write
 * real rows, and the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Identity attachment is the one stand-in: a test middleware reads
 * `x-v15a-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recorder; the contact timeline, stats cache and the AI / Gmail / Drive
 * services are stubs off the ledger path.
 *
 * Fixtures: prefix `v15a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PostingService, PostingInput } from '../src/modules/finance/posting.service';
import type { AccountingPeriodService } from '../src/modules/finance/accounting-period.service';
import type { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';
import type { ExpensesService } from '../src/modules/expenses/expenses.service';
import type { PaymentsService } from '../src/modules/payments/payments.service';
import type { LedgerReportingService } from '../src/modules/reports/ledger-reporting.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v15a_';
const HEADER = 'x-v15a-user';
/** bizPay's own Stripe webhook secret (business.metaData.stripeWebhookSecret), so no global env is touched. */
const STRIPE_SECRET = `whsec_${P}stripe`;

const ID = {
  owner: `${P}owner`,
  ownerB: `${P}ownerB`,
  staff: `${P}staff`, // a STAFF member of bizGate
  admin: `${P}admin`, // an ADMIN member of bizGate
  bizA: `${P}bizA`, // direct post() cases
  bizB: `${P}bizB`, // another tenant with its own closed period
  bizPay: `${P}bizPay`, // HTTP payments, refunds and provider settlements around closed periods
  bizTB: `${P}bizTB`, // trial balance (accrual basis)
  bizGate: `${P}bizGate`, // who may close and reopen a period (HTTP)
  contactPay: `${P}contactPay`,
  contactTB: `${P}contactTB`,
  invPayEarly: `${P}invPayEarly`,
  invPayClosed: `${P}invPayClosed`,
  invPayLegacy: `${P}invPayLegacy`,
  invWipay: `${P}invWipay`,
  invStripe: `${P}invStripe`,
  invPart: `${P}invPart`,
  invFull: `${P}invFull`,
  invRefund: `${P}invRefund`,
  invOpen: `${P}invOpen`,
  invUsd: `${P}invUsd`,
  // V1-15b (review CR-1..CR-3)
  bizAR: `${P}bizAR`, // accrual tenant: a refunded collection and voids in the cash-basis reports
  contactAR: `${P}contactAR`,
  invAR: `${P}invAR`,
  bizAsset: `${P}bizAsset`, // fixed assets around a closed month
  bizBank: `${P}bizBank`, // statement import + bank rules around a closed month
  bankAcct: `${P}bankAcct`,
  // V1-15b review repairs (SEC-V15b-1..4, CRR-1, CRR-2)
  bizAssetR: `${P}bizAssetR`, // fixed-asset lifecycle after the review
  bizBankR: `${P}bizBankR`, // bank-rule concurrency and re-link after the review
  bankAcctR: `${P}bankAcctR`,
  // V1-15b repair2 (review SEC9-1, LC-1, LC-3)
  bizEdit: `${P}bizEdit`, // PATCH / DELETE of a period racing its close (HTTP)
  bizSlow: `${P}bizSlow`, // a close stamping a large month while a provider settlement dated now arrives
  contactSlow: `${P}contactSlow`,
  invSlow: `${P}invSlow`,
  bizMany: `${P}bizMany`, // more cash transactions in a report range than one read returns
  // V1-15c (payment writers through the door, report readers past the read cap)
  bizCapture: `${P}bizCapture`, // PayPal captures through the door
  contactCapture: `${P}contactCapture`,
  invCapture: `${P}invCapture`,
  invCaptureAbort: `${P}invCaptureAbort`,
  invCaptureRetry: `${P}invCaptureRetry`, // review CR-V15C-1: a transient abort of the recording is retried
  invCaptureRace: `${P}invCaptureRace`, // review SEC-V15C-2: PayPal's webhook records the capture first
  bizBreak: `${P}bizBreak`, // more ledger rows in a dimension breakdown than one read returns
  customerBreak: `${P}customerBreak`,
  vendorBreak: `${P}vendorBreak`,
  projectBreak: `${P}projectBreak`,
  productBreak: `${P}productBreak`,
};

const TB_INVOICES: Array<{ id: string; total: number; currency: string }> = [
  { id: ID.invPart, total: 100, currency: 'TTD' },
  { id: ID.invFull, total: 100, currency: 'TTD' },
  { id: ID.invRefund, total: 100, currency: 'TTD' },
  { id: ID.invOpen, total: 100, currency: 'TTD' },
  { id: ID.invUsd, total: 250, currency: 'USD' },
];

let db: any;
let app: any;
let redis: any;
let posting: PostingService;
let periods: AccountingPeriodService;
let coa: ChartOfAccountsSeederService;
let workflow: InvoiceWorkflowService;
let expenses: ExpensesService;
let payments: PaymentsService;
let reporting: LedgerReportingService;
let computeBalance: (total: number, payments: Array<{ amount: unknown; status: string }>, currency?: string) => { remaining: number };

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Review LC-1's emulated hosted-database cost per stamped row (a trigger on bizSlow's rows only). */
const SLOW_STAMP_TRIGGER = 'v15a_slow_stamp';

async function cleanup() {
  for (const sql of [
    `DROP TRIGGER IF EXISTS ${SLOW_STAMP_TRIGGER} ON financial_transactions`,
    `DROP FUNCTION IF EXISTS ${SLOW_STAMP_TRIGGER}()`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fixed_assets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function pay(businessId: string, invoiceId: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${businessId}/invoices/${invoiceId}/payments`).set(HEADER, ID.owner).send(body);
}

function refund(businessId: string, paymentId: string) {
  return agent().post(`/commerce/businesses/${businessId}/payments/${paymentId}/refund`).set(HEADER, ID.owner).send({ reason: 'v15a refund' });
}

/** Ledger row counts for one business (a fresh read). */
async function ledgerCounts(businessId: string): Promise<{ txns: number; entries: number }> {
  return {
    txns: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

async function accountId(businessId: string, systemKey: string): Promise<string> {
  const row = await coa.getBySystemKey(businessId, systemKey);
  if (!row) throw new Error(`no ${systemKey} account for ${businessId}`);
  return row.id;
}

/** A balanced cash sale for `businessId`, dated `date`. */
async function probe(businessId: string, sourceId: string, date: Date): Promise<PostingInput> {
  return {
    businessId,
    type: 'INCOME',
    date,
    amount: 10,
    currency: 'TTD',
    description: `v15a probe ${sourceId}`,
    sourceType: 'V15Probe',
    sourceId,
    kind: 'probe',
    entries: [
      { accountId: await accountId(businessId, 'CASH'), debit: 10 },
      { accountId: await accountId(businessId, 'REVENUE'), credit: 10 },
    ],
  };
}

/** Create and close a period as `closedById`, who must be the business's owner or an admin (review SEC-V15-2). */
async function openAndClose(businessId: string, year: number, month: number, closedById: string = ID.owner) {
  const period = await periods.create(businessId, { year, month });
  return periods.close(businessId, period.id, { closedById });
}

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/** The UTC month `offset` months from the current one (-1 = last month, which has ended). */
function monthFromNow(offset: number): { year: number; month: number } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * Resolves once some transaction is queued, not granted, on an advisory lock
 * (the period lock, ACCOUNTING_PERIOD_LOCK_NAMESPACE) that the backend
 * `holderPid` holds: pg_blocking_pids of the waiter names the holder. Named
 * by the holder rather than by the key, so it does not depend on how the
 * period lock's key is built (review LC-1 scoped it to the month). Throws if
 * none queues in time.
 */
async function waitForPeriodLockWaiter(holderPid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND $1::int = ANY(pg_blocking_pids(pid))`,
      holderPid,
    );
    if (row.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no transaction queued on a period lock held by backend ${holderPid} within ${timeoutMs}ms`);
}

/** The server backend running a transaction client (its pg_backend_pid). */
async function backendPid(tx: any): Promise<number> {
  const [row] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
  return Number(row.pid);
}

/**
 * Resolves once some backend of this database sleeps in pg_sleep (the slow
 * stamp trigger of review LC-1's case, so: a close is stamping). Throws if
 * none does in time.
 */
async function waitForSleepingStamp(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'`,
    );
    if (row.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`no backend started stamping within ${timeoutMs}ms`);
}

/** Finance audit rows (team_activity_logs, module 'finance') recorded for one accounting period. */
async function periodAudit(periodId: string): Promise<any[]> {
  return db.teamActivityLog.findMany({
    where: { module: 'finance', entityType: 'AccountingPeriod', entityId: periodId },
    orderBy: { createdAt: 'asc' },
  });
}

async function paymentPostings(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({ where: { sourceType: 'Payment', sourceId: paymentId }, orderBy: { createdAt: 'asc' } });
}

async function seedInvoice(id: string, businessId: string, contactId: string, n: number, total: number, currency: string, status: string) {
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V15A-${String(n).padStart(3, '0')}`,
      status,
      subtotal: total,
      total,
      currency,
      businessId,
      contactId,
      items: { create: [{ id: `${id}_item1`, description: `v15a item ${n}`, quantity: 1, unitPrice: total, total }] },
    },
  });
}

/** A tenant owned by ID.owner (an OWNER member too) with the default chart of accounts. */
async function seedTenant(id: string, basis: 'CASH' | 'ACCRUAL') {
  await db.business.create({ data: { id, name: `V15A ${id}`, ownerId: ID.owner, currency: 'TTD', accountingBasis: basis } });
  await db.membership.create({ data: { id: `${id}_m`, userId: ID.owner, businessId: id, role: 'OWNER' } });
  await coa.ensureDefaults(id);
}

/** Every posting of one business is balanced, and so is the business per currency. */
async function expectBalanced(businessId: string) {
  const perCurrency: Array<{ currency: string; debit: string; credit: string }> = await db.$queryRawUnsafe(
    `SELECT currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit FROM ledger_entries WHERE business_id = $1 GROUP BY currency`,
    businessId,
  );
  for (const r of perCurrency) expect(Number(r.debit), `${businessId} ${r.currency} debits vs credits`).toBe(Number(r.credit));
  const unbalanced = await db.$queryRawUnsafe(
    `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
    businessId,
  );
  expect(unbalanced, businessId).toEqual([]);
}

/**
 * FinanceController behind the real AuthGuard, BusinessGuard and the global
 * TenantInterceptor, identity attached from HEADER. `real` providers are live;
 * every other collaborator of the controller is a stub off the path under test.
 */
async function buildFinanceApp(real: any[]): Promise<any> {
  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const collaborators = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/posting.service').then((m) => m.PostingService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
  ]);
  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ...real,
      ...collaborators.filter((token) => !real.includes(token)).map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  const financeApp = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  financeApp.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // As app.module.ts registers it (APP_INTERCEPTOR): the reopen route passes no actor, this names it.
  financeApp.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  financeApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await financeApp.init();
  return financeApp;
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
  const PostingMod = await import('../src/modules/finance/posting.service');
  const PeriodMod = await import('../src/modules/finance/accounting-period.service');
  const SeederMod = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const ExpensesMod = await import('../src/modules/expenses/expenses.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const ReportingMod = await import('../src/modules/reports/ledger-reporting.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  computeBalance = workflowMod.computeBalance as typeof computeBalance;

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
      // The real ledger chain, including the period ledger the door consults.
      RevenuePostingService,
      PostingMod.PostingService,
      PeriodMod.AccountingPeriodService,
      SeederMod.ChartOfAccountsSeederService,
      ExpensePostingService,
      ExpensesMod.ExpensesService,
      // The report readers (review CR-1), on the same rows.
      ReportingMod.LedgerReportingService,
      LedgerBalanceService,
      ReceivablesService,
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
  posting = moduleRef.get(PostingMod.PostingService);
  periods = moduleRef.get(PeriodMod.AccountingPeriodService);
  coa = moduleRef.get(SeederMod.ChartOfAccountsSeederService);
  workflow = moduleRef.get(workflowMod.InvoiceWorkflowService);
  expenses = moduleRef.get(ExpensesMod.ExpensesService);
  reporting = moduleRef.get(ReportingMod.LedgerReportingService);
  // The provider webhook handlers (review SEC-V15-1), on the same real chain:
  // payment row + posting in one transaction, the dedupe row committed first.
  const { PaymentsService: PaymentsCtor } = await import('../src/modules/payments/payments.service');
  payments = new PaymentsCtor(
    moduleRef.get(PrismaService),
    moduleRef.get(CommerceService),
    workflow,
    moduleRef.get(RevenuePostingService),
  );

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
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.admin, email: `${P}admin@test.local`, role: 'USER' } });
  for (const [biz, owner, basis] of [
    [ID.bizA, ID.owner, 'CASH'],
    [ID.bizB, ID.ownerB, 'CASH'],
    [ID.bizPay, ID.owner, 'CASH'],
    [ID.bizTB, ID.owner, 'ACCRUAL'],
    [ID.bizGate, ID.owner, 'CASH'],
  ] as const) {
    await db.business.create({
      data: {
        id: biz,
        name: `V15A ${biz}`,
        ownerId: owner,
        currency: 'TTD',
        accountingBasis: basis,
        ...(biz === ID.bizPay ? { metaData: { stripeWebhookSecret: STRIPE_SECRET } } : {}),
      },
    });
    await db.membership.create({ data: { id: `${biz}_m`, userId: owner, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
  }
  await db.membership.create({ data: { id: `${ID.bizGate}_staff`, userId: ID.staff, businessId: ID.bizGate, role: 'STAFF' } });
  await db.membership.create({ data: { id: `${ID.bizGate}_admin`, userId: ID.admin, businessId: ID.bizGate, role: 'ADMIN' } });
  await db.contact.create({ data: { id: ID.contactPay, businessId: ID.bizPay, firstName: 'V15A', lastName: 'Payer', email: `${P}payer@test.local` } });
  await db.contact.create({ data: { id: ID.contactTB, businessId: ID.bizTB, firstName: 'V15A', lastName: 'Ledger', email: `${P}ledger@test.local` } });

  await seedInvoice(ID.invPayEarly, ID.bizPay, ID.contactPay, 1, 100, 'TTD', 'SENT');
  await seedInvoice(ID.invPayClosed, ID.bizPay, ID.contactPay, 2, 100, 'TTD', 'SENT');
  await seedInvoice(ID.invPayLegacy, ID.bizPay, ID.contactPay, 3, 100, 'TTD', 'SENT');
  await seedInvoice(ID.invWipay, ID.bizPay, ID.contactPay, 4, 100, 'TTD', 'SENT');
  await seedInvoice(ID.invStripe, ID.bizPay, ID.contactPay, 5, 100, 'TTD', 'SENT');
  let n = 10;
  for (const inv of TB_INVOICES) {
    n += 1;
    // DRAFT, then SENT through the workflow: on accrual basis that posts Dr AR / Cr Revenue.
    await seedInvoice(inv.id, ID.bizTB, ID.contactTB, n, inv.total, inv.currency, 'DRAFT');
    await workflow.transition(inv.id, 'SENT');
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('seeded five tenants with a chart of accounts, and the accrual invoices are recognised in AR', async () => {
    for (const biz of [ID.bizA, ID.bizB, ID.bizPay, ID.bizTB, ID.bizGate]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } }), biz).toBeGreaterThan(0);
      expect(await db.accountingPeriod.count({ where: { businessId: biz } }), biz).toBe(0);
    }
    const finalized = await db.financialTransaction.findMany({ where: { businessId: ID.bizTB, sourceType: 'Invoice' } });
    expect(finalized.map((t: any) => t.sourceId).sort()).toEqual(TB_INVOICES.map((i) => i.id).sort());
  });
});

describe('CF-40: post() refuses a date inside a CLOSED accounting period', () => {
  let closedMarch: any;

  beforeAll(async () => {
    closedMarch = await openAndClose(ID.bizA, 2025, 3);
  });

  it('LWD-01: post() dated inside a CLOSED period (first day, mid-month, last instant) -> 409; no transaction, no entry', async () => {
    expect(closedMarch.status).toBe('CLOSED');
    const before = await ledgerCounts(ID.bizA);
    for (const [label, date] of [
      ['first day', new Date(Date.UTC(2025, 2, 1, 0, 0, 0, 0))],
      ['mid-month', new Date(Date.UTC(2025, 2, 15, 12, 0, 0))],
      ['last instant', new Date(Date.UTC(2025, 2, 31, 23, 59, 59, 999))],
    ] as const) {
      const input = await probe(ID.bizA, `${P}closed_${label.replace(/\W+/g, '-')}`, date);
      await expect(posting.post(input), label).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/closed/i) });
    }
    expect(await ledgerCounts(ID.bizA)).toEqual(before);
  });

  it('LWD-01b: the day after the closed period posts (the guard is the period, not the month around it)', async () => {
    const res = await posting.post(await probe(ID.bizA, `${P}after_close`, new Date(Date.UTC(2025, 3, 1, 0, 0, 0, 0))));
    expect(res.alreadyPosted).toBe(false);
  });

  it('LWD-02: reopening the period allows the same post; it is written once and balanced', async () => {
    await periods.reopen(ID.bizA, closedMarch.id, { reopenedById: ID.owner });
    const input = await probe(ID.bizA, `${P}closed_mid-month`, new Date(Date.UTC(2025, 2, 15, 12, 0, 0)));
    const res = await posting.post(input);
    expect(res.alreadyPosted).toBe(false);
    const txn = await db.financialTransaction.findUnique({ where: { id: res.transactionId }, include: { entries: true } });
    expect(txn.status).toBe('POSTED');
    expect(txn.date.toISOString()).toBe('2025-03-15T12:00:00.000Z');
    const debit = txn.entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
    const credit = txn.entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    expect(txn.entries).toHaveLength(2);
    expect(debit).toBe(10);
    expect(credit).toBe(10);
  });

  it('LWD-03: another tenant\'s CLOSED period does not block this tenant (and does block its own)', async () => {
    await openAndClose(ID.bizB, 2025, 4, ID.ownerB);
    const date = new Date(Date.UTC(2025, 3, 10, 9, 0, 0));
    const before = await ledgerCounts(ID.bizB);
    await expect(posting.post(await probe(ID.bizB, `${P}b_closed`, date))).rejects.toMatchObject({ status: 409 });
    expect(await ledgerCounts(ID.bizB)).toEqual(before);

    const res = await posting.post(await probe(ID.bizA, `${P}a_in_b_closed_month`, date));
    expect(res.alreadyPosted).toBe(false);
    expect((await db.financialTransaction.findUnique({ where: { id: res.transactionId } })).businessId).toBe(ID.bizA);
  });

  it('LWD-04: an idempotent replay of a posting that already exists returns it after its period closed, writing nothing', async () => {
    await periods.close(ID.bizA, closedMarch.id, { closedById: ID.owner });
    const before = await ledgerCounts(ID.bizA);
    const replay = await posting.post(await probe(ID.bizA, `${P}closed_mid-month`, new Date(Date.UTC(2025, 2, 15, 12, 0, 0))));
    expect(replay.alreadyPosted).toBe(true);
    expect(await ledgerCounts(ID.bizA)).toEqual(before);
  });
});

describe('review SEC-V15-3: a close and a posting in flight are serialized by the business\'s period lock', () => {
  it('LWD-08: a close that starts while a posting dated inside the period is in flight waits for it, then stamps it; the next posting is refused', async () => {
    const june = await periods.create(ID.bizA, { year: 2024, month: 6 });
    const date = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
    const input = await probe(ID.bizA, `${P}race_in_flight`, date);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let announce!: (posted: { id: string; pid: number }) => void;
    const postedId = new Promise<{ id: string; pid: number }>((resolve) => { announce = resolve; });
    // The posting passes its period check (OPEN) and stays uncommitted until released.
    const inFlight = db.$transaction(async (tx: any) => {
      const res = await posting.post(input, tx);
      announce({ id: res.transactionId, pid: await backendPid(tx) });
      await held;
      return res;
    }, { maxWait: 10_000, timeout: 60_000 });
    try {
      const { id: txnId, pid } = await postedId;
      const closing = periods.close(ID.bizA, june.id, { closedById: ID.owner });
      // At a5d73ff6 the close committed here, and the posting then landed inside the CLOSED period unstamped.
      await waitForPeriodLockWaiter(pid);
      expect((await db.accountingPeriod.findUnique({ where: { id: june.id } })).status, 'the close waits for the posting').toBe('OPEN');
      release();
      await inFlight;
      const closed = await closing;
      expect(closed.status).toBe('CLOSED');
      const row = await db.financialTransaction.findUnique({ where: { id: txnId } });
      expect(row.status).toBe('POSTED');
      expect(row.date.toISOString()).toBe(date.toISOString());
      expect(row.metadata?.lockedByPeriod, 'the posting committed before the close is stamped by it').toBe(closed.lockedTransactionStamp);
      const before = await ledgerCounts(ID.bizA);
      await expect(posting.post(await probe(ID.bizA, `${P}race_after`, date))).rejects.toMatchObject({ status: 409 });
      expect(await ledgerCounts(ID.bizA)).toEqual(before);
    } finally {
      release();
      await inFlight.catch(() => undefined);
    }
  }, 60_000);
});

describe('review SEC-V15-1: a period closes only once it has ended, so what is dated now (payments, refunds, provider settlements) always posts', () => {
  let earlyPaymentId: string;
  let currentId: string;

  beforeAll(async () => {
    // A payment recorded while every period is open, to refund later.
    const early = await pay(ID.bizPay, ID.invPayEarly, { amount: 40, method: 'cash', reference: `${P}early` });
    expect(early.status, JSON.stringify(early.body)).toBe(201);
    earlyPaymentId = early.body.payment.id;
    // Last month has ended, so it closes.
    const last = monthFromNow(-1);
    expect((await openAndClose(ID.bizPay, last.year, last.month)).status).toBe('CLOSED');
    currentId = (await periods.create(ID.bizPay, currentPeriod())).id;
  });

  it('LWD-05: closing the current or a future period -> 400; it stays OPEN with no audit row; a manual payment (dated now) posts beside the CLOSED last month', async () => {
    const next = await periods.create(ID.bizPay, monthFromNow(1));
    for (const id of [currentId, next.id]) {
      await expect(periods.close(ID.bizPay, id, { closedById: ID.owner })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/has not ended/),
      });
      const row = await db.accountingPeriod.findUnique({ where: { id } });
      expect(row.status).toBe('OPEN');
      expect(row.closedById).toBeNull();
      expect(row.lockedTransactionStamp).toBeNull();
      expect(await periodAudit(id)).toEqual([]);
    }
    // Deleting a period is the owner's or an admin's call (review SEC9-1).
    await periods.remove(ID.bizPay, next.id, { actorId: ID.owner });

    const res = await pay(ID.bizPay, ID.invPayClosed, { amount: 40, method: 'cash', reference: `${P}beside-closed` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await paymentPostings(res.body.payment.id)).map((t: any) => `${t.type}:${t.status}`)).toEqual(['INCOME:POSTED']);
  });

  it('LWD-06: a CLOSED current period left by a close made before this rule is not enforced: a manual payment and a refund post', async () => {
    // Closing was metadata only before V1-15 and any month could be closed, so such a row can exist.
    await db.accountingPeriod.update({ where: { id: currentId }, data: { status: 'CLOSED', closedAt: new Date(), closedById: ID.owner } });
    const res = await pay(ID.bizPay, ID.invPayLegacy, { amount: 40, method: 'cash', reference: `${P}legacy` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await paymentPostings(res.body.payment.id)).map((t: any) => `${t.type}:${t.status}`)).toEqual(['INCOME:POSTED']);

    const r = await refund(ID.bizPay, earlyPaymentId);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const postings = await paymentPostings(earlyPaymentId);
    expect(postings.map((t: any) => t.type)).toEqual(['INCOME', 'REVERSAL']);
    expect(postings[0].status).toBe('REVERSED');
  });

  it('LWD-07: provider settlements under that CLOSED current period and a CLOSED last month are recorded and posted once (WiPay callback, Stripe checkout.session.completed); the redelivery writes nothing', async () => {
    expect((await db.accountingPeriod.findUnique({ where: { id: currentId } })).status).toBe('CLOSED');

    const wipay = { order_id: ID.invWipay, status: 'success', transaction_id: `${P}wipay_txn`, total: '100.00' };
    const hash = createHash('md5').update(`${wipay.transaction_id}${wipay.order_id}${wipay.total}${wipay.status}`).digest('hex');
    // At a5d73ff6: { success: false, 'Payment processing error' }, then 'Duplicate callback ignored' forever, and no Payment row.
    expect(await payments.handleWipayCallback({ ...wipay, hash })).toMatchObject({ success: true, message: 'Payment successful' });
    expect(await payments.handleWipayCallback({ ...wipay, hash })).toMatchObject({ success: true, message: 'Duplicate callback ignored' });

    const event = {
      id: `${P}evt_checkout`,
      type: 'checkout.session.completed',
      data: { object: { id: `${P}cs_checkout`, metadata: { invoiceId: ID.invStripe }, amount_total: 10000, currency: 'ttd' } },
    };
    const raw = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac('sha256', STRIPE_SECRET).update(`${t}.${raw}`).digest('hex')}`;
    // At a5d73ff6: 409, then { ok: true, received: true } on every redelivery, and no Payment row.
    expect(await payments.handleStripeWebhook(raw, signature)).toEqual({ ok: true, received: true, processed: 'checkout.session.completed' });
    expect(await payments.handleStripeWebhook(raw, signature)).toEqual({ ok: true, received: true });

    for (const [invoiceId, provider] of [[ID.invWipay, 'wipay'], [ID.invStripe, 'stripe']] as const) {
      const rows = await db.payment.findMany({ where: { invoiceId } });
      expect(rows.map((p: any) => `${p.provider}:${p.status}:${Number(p.amount)}`), invoiceId).toEqual([`${provider}:SUCCESSFUL:100`]);
      expect((await paymentPostings(rows[0].id)).map((x: any) => `${x.type}:${x.status}`), invoiceId).toEqual(['INCOME:POSTED']);
      expect((await db.invoice.findUnique({ where: { id: invoiceId } })).status, invoiceId).toBe('PAID');
    }
  });

  it('LWD-10 (review CR-1): the payment refunded through the door nets to zero in the cash-basis P&L; the accrual P&L agrees', async () => {
    const from = new Date(Date.UTC(2000, 0, 1));
    const to = new Date(Date.now() + 86_400_000);
    // The refunded payment's original is REVERSED, its REVERSAL POSTED; the rest are settled.
    const early = await paymentPostings(earlyPaymentId);
    expect(early.map((t: any) => `${t.type}:${t.status}`)).toEqual(['INCOME:REVERSED', 'REVERSAL:POSTED']);
    const settled = (await db.payment.findMany({ where: { businessId: ID.bizPay, status: 'SUCCESSFUL' } }))
      .reduce((s: number, p: any) => s + Number(p.amount), 0);
    expect(settled).toBe(280);

    const cash = await reporting.getPnl(ID.bizPay, from, to, 'cash');
    const accrual = await reporting.getPnl(ID.bizPay, from, to, 'accrual');
    // At 2dd2eb65 the cash P&L read POSTED only: the REVERSED original dropped out
    // and its REVERSAL counted as -40 of revenue (240).
    expect(cash.revenue.total, 'cash-basis revenue').toBe(settled);
    expect(accrual.revenue.total, 'accrual revenue').toBe(settled);
    expect(cash.netProfit).toBe(accrual.netProfit);
    await expectBalanced(ID.bizPay);
  });
});

describe('review SEC-V15-2: only the owner or an admin opens and shuts the posting door, and every change is audited', () => {
  let financeApp: any;

  function gate(path: string, actor: string | null, body: Record<string, unknown> = {}) {
    const req = request(financeApp.getHttpServer()).post(`/finance/businesses/${ID.bizGate}/accounting-periods${path}`);
    return (actor ? req.set(HEADER, actor) : req).send(body);
  }

  beforeAll(async () => {
    const PeriodMod = await import('../src/modules/finance/accounting-period.service');
    // FinanceController's other collaborators are off the period routes.
    financeApp = await buildFinanceApp([PeriodMod.AccountingPeriodService]);
  }, 120_000);

  afterAll(async () => {
    if (financeApp) await financeApp.close();
  });

  it('LWD-09: STAFF close / reopen -> 403 and nothing changes; the owner and an ADMIN close and reopen; each change is audited with its actor; unauthenticated -> 401', async () => {
    const last = monthFromNow(-1);
    const created = await gate('', ID.staff, last);
    expect(created.status, JSON.stringify(created.body)).toBe(201); // an OPEN period gates nothing
    const id: string = created.body.id;
    const state = async () => {
      const row = await db.accountingPeriod.findUnique({ where: { id } });
      return `${row.status}:${row.closedById}`;
    };

    const staffClose = await gate(`/${id}/close`, ID.staff);
    expect(staffClose.status, JSON.stringify(staffClose.body)).toBe(403);
    expect(await state()).toBe('OPEN:null');

    const ownerClose = await gate(`/${id}/close`, ID.owner);
    expect(ownerClose.status, JSON.stringify(ownerClose.body)).toBe(201);
    expect(await state()).toBe(`CLOSED:${ID.owner}`);

    const staffReopen = await gate(`/${id}/reopen`, ID.staff);
    expect(staffReopen.status, JSON.stringify(staffReopen.body)).toBe(403);
    expect(await state()).toBe(`CLOSED:${ID.owner}`);

    const adminReopen = await gate(`/${id}/reopen`, ID.admin);
    expect(adminReopen.status, JSON.stringify(adminReopen.body)).toBe(201);
    expect(await state()).toBe('OPEN:null');

    const adminClose = await gate(`/${id}/close`, ID.admin);
    expect(adminClose.status, JSON.stringify(adminClose.body)).toBe(201);
    expect(await state()).toBe(`CLOSED:${ID.admin}`);

    const anonymous = await gate(`/${id}/reopen`, null);
    expect(anonymous.status).toBe(401);
    expect(await state()).toBe(`CLOSED:${ID.admin}`);

    const ownerReopen = await gate(`/${id}/reopen`, ID.owner);
    expect(ownerReopen.status, JSON.stringify(ownerReopen.body)).toBe(201);

    const audit = await periodAudit(id);
    expect(audit.map((a: any) => `${a.action}:${a.userId}`)).toEqual([
      `PERIOD_CLOSED:${ID.owner}`,
      `PERIOD_REOPENED:${ID.admin}`,
      `PERIOD_CLOSED:${ID.admin}`,
      `PERIOD_REOPENED:${ID.owner}`,
    ]);
    // The reopen clears closedById on the period, so the audit row keeps who it undid.
    expect(audit[1].meta).toMatchObject({ previousClosedById: ID.owner, year: last.year, month: last.month });
    expect(audit[3].meta).toMatchObject({ previousClosedById: ID.admin });
    expect(audit.every((a: any) => a.businessId === ID.bizGate)).toBe(true);
  });
});

describe('review CR-1: a reversed original and its REVERSAL net to zero in every report, and no reversal is counted twice', () => {
  const from = new Date(Date.UTC(2000, 0, 1));
  let to: Date;

  beforeAll(async () => {
    await seedTenant(ID.bizAR, 'ACCRUAL');
    await db.contact.create({ data: { id: ID.contactAR, businessId: ID.bizAR, firstName: 'V15A', lastName: 'Receivable', email: `${P}receivable@test.local` } });
    // Recognised in AR (Dr AR / Cr Revenue 100), collected 60 + 40, and the 40 refunded through the door.
    await seedInvoice(ID.invAR, ID.bizAR, ID.contactAR, 30, 100, 'TTD', 'DRAFT');
    await workflow.transition(ID.invAR, 'SENT');
    const kept = await pay(ID.bizAR, ID.invAR, { amount: 60, method: 'cash', reference: `${P}ar-kept` });
    expect(kept.status, JSON.stringify(kept.body)).toBe(201);
    const refunded = await pay(ID.bizAR, ID.invAR, { amount: 40, method: 'cash', reference: `${P}ar-refunded` });
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    const r = await refund(ID.bizAR, refunded.body.payment.id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // A paid expense voided (direct Dr Expense / Cr Cash) and a bill paid then voided (AP, traced to the bill).
    const paid = await expenses.createExpense({ businessId: ID.bizAR, description: `${P}ar paid expense`, amount: 25, currency: 'TTD', paymentMethod: 'cash', vendor: `${P}vendor` });
    await expenses.voidExpense({ businessId: ID.bizAR, expenseId: paid.id, reason: 'v15a CR-1 void' });
    const bill = await expenses.createExpense({ businessId: ID.bizAR, description: `${P}ar bill`, amount: 50, currency: 'TTD', status: 'BILL', vendor: `${P}vendor` });
    await expenses.markBillPaid({ businessId: ID.bizAR, expenseId: bill.id, paymentMethod: 'cash' });
    await expenses.voidExpense({ businessId: ID.bizAR, expenseId: bill.id, reason: 'v15a CR-1 bill void' });
    to = new Date(Date.now() + 86_400_000);
    const reversed = await db.financialTransaction.findMany({ where: { businessId: ID.bizAR, status: 'REVERSED' } });
    expect(reversed, 'the refunded collection, the paid expense, the bill and its payment').toHaveLength(4);
  }, 120_000);

  it('LWD-11: cash-basis view of an accrual tenant: the refunded collection, the voided expense and the voided bill each net to zero in the cash P&L and the cash cashflow; the accrual P&L agrees on expenses', async () => {
    const cash = await reporting.getPnl(ID.bizAR, from, to, 'cash');
    const accrual = await reporting.getPnl(ID.bizAR, from, to, 'accrual');
    // Cash: only the 60 still collected. A REVERSAL is read as the mirror of its
    // original, traced the same way (a refunded collection is -40 of the invoice's
    // revenue, a reversed bill payment -50 of the bill's expense), never twice.
    // At 2dd2eb65 the voided expense's REVERSAL counted as -25 of expense (net profit 85).
    expect(cash.revenue.total, 'cash-basis revenue').toBe(60);
    expect(cash.operatingExpenses.total, 'cash-basis expenses').toBe(0);
    expect(cash.netProfit).toBe(60);
    // Accrual: revenue is the invoice (the refund restores the receivable), and the voids net to zero.
    expect(accrual.revenue.total, 'accrual revenue').toBe(100);
    expect(accrual.operatingExpenses.total, 'accrual expenses').toBe(0);
    expect(accrual.netProfit).toBe(100);

    const cashflow = await reporting.getCashflow(ID.bizAR, from, to, 'cash');
    expect(cashflow.netMovement, 'cash-basis operating cash').toBe(60);
    expect(cashflow.accrualAdjustments.netIncome).toBe(60);
    const accrualFlow = await reporting.getCashflow(ID.bizAR, from, to, 'accrual');
    expect(accrualFlow.netMovement, 'every cash movement').toBe(60);

    expect(await reporting.getExpenseBy(ID.bizAR, 'category', from, to)).toEqual([]);
    const byVendor = await reporting.getExpenseBy(ID.bizAR, 'vendor', from, to);
    expect(byVendor.every((r) => r.total === 0), JSON.stringify(byVendor)).toBe(true);
    await expectBalanced(ID.bizAR);
  });
});

describe('review CR-2 / CR-3: callers that write their own row and post (fixed assets, bank rules) do both in one transaction or not at all', () => {
  let financeApp: any;
  const last = monthFromNow(-1);
  const inClosedMonth = new Date(Date.UTC(last.year, last.month - 1, 15, 12, 0, 0)).toISOString();

  function api(method: 'get' | 'post', path: string, businessId: string) {
    return request(financeApp.getHttpServer())[method](`/finance/businesses/${businessId}${path}`).set(HEADER, ID.owner);
  }

  async function fixedAssetPostings(assetId: string): Promise<any[]> {
    return db.financialTransaction.findMany({
      where: { sourceType: 'FixedAsset', sourceId: assetId },
      include: { entries: { include: { account: { select: { systemKey: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The asset row, as one comparable line. */
  async function assetRow(assetId: string): Promise<string> {
    const a = await db.fixedAsset.findUnique({ where: { id: assetId } });
    return `${a.status}:${Number(a.accumulatedDepreciation)}:${Number(a.netBookValue)}:${a.disposalDate?.toISOString() ?? null}:${a.disposalProceeds == null ? null : Number(a.disposalProceeds)}`;
  }

  /** Net credit the asset's own postings leave on ACCUMULATED_DEPRECIATION. */
  function accumulatedOnLedger(postings: any[]): number {
    return postings
      .flatMap((t: any) => t.entries)
      .filter((e: any) => e.account.systemKey === 'ACCUMULATED_DEPRECIATION')
      .reduce((s: number, e: any) => s + Number(e.credit) - Number(e.debit), 0);
  }

  function newAsset(businessId: string, name: string, purchaseCost = 1200, usefulLifeMonths = 120) {
    return api('post', '/fixed-assets', businessId).send({
      name: `${P}${name}`, category: 'vehicle', purchaseDate: '2024-01-15T12:00:00.000Z', purchaseCost, salvageValue: 0, usefulLifeMonths,
    });
  }

  beforeAll(async () => {
    const real = await Promise.all([
      import('../src/modules/finance/accounting-period.service').then((m) => m.AccountingPeriodService),
      import('../src/modules/finance/posting.service').then((m) => m.PostingService),
      import('../src/modules/finance/finance-audit.service').then((m) => m.FinanceAuditService),
      import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
      import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
      import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
      import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    ]);
    financeApp = await buildFinanceApp(real);
    await seedTenant(ID.bizAsset, 'CASH');
    await seedTenant(ID.bizBank, 'CASH');
    await seedTenant(ID.bizAssetR, 'CASH');
    await seedTenant(ID.bizBankR, 'CASH');
    await db.financialAccount.create({
      data: { id: ID.bankAcctR, businessId: ID.bizBankR, chartOfAccountId: await accountId(ID.bizBankR, 'BANK'), name: `${P}Repair account`, type: 'BANK', currency: 'TTD' },
    });
  }, 120_000);

  afterAll(async () => {
    if (financeApp) await financeApp.close();
  });

  it('LWD-12 (CR-2): depreciate / dispose dated inside a CLOSED month -> 409 and nothing is written; in an open month each run posts with its row, a second run posts its own delta, a dispose posts once', async () => {
    const created = await api('post', '/fixed-assets', ID.bizAsset).send({
      name: `${P}van`, category: 'vehicle', purchaseDate: '2024-01-15T12:00:00.000Z', purchaseCost: 1200, salvageValue: 0, usefulLifeMonths: 120,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const assetId: string = created.body.id;
    const row = async () => {
      const a = await db.fixedAsset.findUnique({ where: { id: assetId } });
      return `${a.status}:${Number(a.accumulatedDepreciation)}:${Number(a.netBookValue)}:${a.disposalDate?.toISOString() ?? null}:${a.disposalProceeds == null ? null : Number(a.disposalProceeds)}`;
    };
    expect(await row()).toBe('ACTIVE:0:1200:null:null');
    expect((await openAndClose(ID.bizAsset, last.year, last.month)).status).toBe('CLOSED');
    const before = await ledgerCounts(ID.bizAsset);

    // At 2dd2eb65 both wrote the asset row first, outside the posting's transaction:
    // the depreciation left accumulated ahead of the ledger, the disposal a DISPOSED asset with no posting.
    const dep = await api('post', `/fixed-assets/${assetId}/depreciate`, ID.bizAsset).send({ asOf: inClosedMonth });
    expect(dep.status, JSON.stringify(dep.body)).toBe(409);
    expect(dep.body.message).toMatch(/closed/i);
    expect(await row(), 'depreciation in a closed month writes nothing').toBe('ACTIVE:0:1200:null:null');
    const disp = await api('post', `/fixed-assets/${assetId}/dispose`, ID.bizAsset).send({ proceeds: 300, disposalDate: inClosedMonth });
    expect(disp.status, JSON.stringify(disp.body)).toBe(409);
    expect(await row(), 'disposal in a closed month writes nothing').toBe('ACTIVE:0:1200:null:null');
    expect(await fixedAssetPostings(assetId)).toEqual([]);
    expect(await ledgerCounts(ID.bizAsset)).toEqual(before);

    // Open months: the current one and two ahead (a month closes only once it has ended).
    const now = new Date();
    const asOf1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0));
    const asOf2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 15, 12, 0, 0));
    const months1 = (asOf1.getUTCFullYear() - 2024) * 12 + asOf1.getUTCMonth();
    const run1 = await api('post', `/fixed-assets/${assetId}/depreciate`, ID.bizAsset).send({ asOf: asOf1.toISOString() });
    expect(run1.status, JSON.stringify(run1.body)).toBe(201);
    expect(Number(run1.body.accumulatedDepreciation)).toBe(months1 * 10);
    const run2 = await api('post', `/fixed-assets/${assetId}/depreciate`, ID.bizAsset).send({ asOf: asOf2.toISOString() });
    expect(run2.status, JSON.stringify(run2.body)).toBe(201);
    expect(Number(run2.body.accumulatedDepreciation)).toBe((months1 + 2) * 10);
    // A replay of the second run has no delta and posts nothing.
    expect((await api('post', `/fixed-assets/${assetId}/depreciate`, ID.bizAsset).send({ asOf: asOf2.toISOString() })).status).toBe(201);

    const depPostings = await fixedAssetPostings(assetId);
    // At 2dd2eb65 every run shared the externalRef FixedAsset:<id>:depreciation, so the
    // second run's 20 was deduped away while the row moved on.
    expect(depPostings.map((t: any) => `${Number(t.amount)}@${t.date.toISOString()}`)).toEqual([
      `${months1 * 10}@${asOf1.toISOString()}`,
      `20@${asOf2.toISOString()}`,
    ]);
    expect(new Set(depPostings.map((t: any) => t.externalRef)).size).toBe(2);
    const accDepCredit = depPostings
      .flatMap((t: any) => t.entries)
      .filter((e: any) => e.account.systemKey === 'ACCUMULATED_DEPRECIATION')
      .reduce((s: number, e: any) => s + Number(e.credit) - Number(e.debit), 0);
    expect(accDepCredit, 'the ledger holds what the asset row says').toBe((months1 + 2) * 10);

    const disposed = await api('post', `/fixed-assets/${assetId}/dispose`, ID.bizAsset).send({ proceeds: 900, disposalDate: asOf1.toISOString() });
    expect(disposed.status, JSON.stringify(disposed.body)).toBe(201);
    const acc = (months1 + 2) * 10;
    expect(await row()).toBe(`DISPOSED:${acc}:${1200 - acc}:${asOf1.toISOString()}:900`);
    const again = await api('post', `/fixed-assets/${assetId}/dispose`, ID.bizAsset).send({ proceeds: 900, disposalDate: asOf1.toISOString() });
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    const disposal = (await fixedAssetPostings(assetId)).filter((t: any) => t.externalRef === `FixedAsset:${assetId}:disposal`);
    expect(disposal).toHaveLength(1);
    const lines = disposal[0].entries.map((e: any) => `${e.account.systemKey}:${Number(e.debit)}:${Number(e.credit)}`).sort();
    const gain = 900 - (1200 - acc);
    expect(lines).toEqual([
      `ACCUMULATED_DEPRECIATION:${acc}:0`,
      'BANK:900:0',
      'FIXED_ASSET_EQUIPMENT:0:1200',
      gain > 0 ? `GAIN_LOSS_ON_DISPOSAL:0:${gain}` : `GAIN_LOSS_ON_DISPOSAL:${-gain}:0`,
    ].sort());

    // An asset never depreciated, written off for nothing, disposed twice at once: one
    // disposal posting with no zero entry (at 2dd2eb65 its zero proceeds / zero
    // accumulated entries made post() refuse it with 400 after the row was DISPOSED).
    const scrap = await api('post', '/fixed-assets', ID.bizAsset).send({
      name: `${P}printer`, category: 'technology', purchaseDate: asOf1.toISOString(), purchaseCost: 500, salvageValue: 0, usefulLifeMonths: 60,
    });
    expect(scrap.status, JSON.stringify(scrap.body)).toBe(201);
    const both = await Promise.all([0, 1].map(() =>
      api('post', `/fixed-assets/${scrap.body.id}/dispose`, ID.bizAsset).send({ proceeds: 0, disposalDate: asOf1.toISOString() })));
    expect(both.map((r) => r.status).sort(), JSON.stringify(both.map((r) => r.body))).toEqual([201, 400]);
    const scrapPostings = await fixedAssetPostings(scrap.body.id);
    expect(scrapPostings).toHaveLength(1);
    expect(scrapPostings[0].entries.map((e: any) => `${e.account.systemKey}:${Number(e.debit)}:${Number(e.credit)}`).sort()).toEqual([
      'FIXED_ASSET_EQUIPMENT:0:500',
      'GAIN_LOSS_ON_DISPOSAL:500:0',
    ]);
    expect((await db.fixedAsset.findUnique({ where: { id: scrap.body.id } })).status).toBe('DISPOSED');

    // Nothing is dated inside the closed month.
    const closedFrom = new Date(Date.UTC(last.year, last.month - 1, 1));
    const closedTo = new Date(Date.UTC(last.year, last.month, 1));
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizAsset, date: { gte: closedFrom, lt: closedTo } } })).toBe(0);
    await expectBalanced(ID.bizAsset);
  }, 60_000);

  it('LWD-13 (CR-3): statement import with auto-match: the rule-matched row dated in a CLOSED month stays UNMATCHED with a visible reason; the other rows match, each to its own posting; the import succeeds', async () => {
    const bankCoa = await accountId(ID.bizBank, 'BANK');
    const expenseCoa = await accountId(ID.bizBank, 'EXPENSE_GENERAL');
    await db.financialAccount.create({
      data: { id: ID.bankAcct, businessId: ID.bizBank, chartOfAccountId: bankCoa, name: `${P}Operating account`, type: 'BANK', currency: 'TTD' },
    });
    const rule = await api('post', '/bank-rules', ID.bizBank).send({ name: `${P}coffee`, pattern: 'v15a coffee', matchType: 'contains', accountId: expenseCoa });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const ruleId: string = rule.body.id;
    const closed = await openAndClose(ID.bizBank, last.year, last.month);
    expect(closed.status).toBe('CLOSED');

    const today = new Date().toISOString().slice(0, 10);
    const csv = [
      'Date,Description,Amount,Reference',
      `${inClosedMonth.slice(0, 10)},V15A COFFEE in the closed month,-15.00,V15A-R1`,
      `${today},V15A COFFEE one,-20.00,V15A-R2`,
      `${today},V15A COFFEE two,-25.00,V15A-R3`,
    ].join('\n');
    const imported = await api('post', `/accounts/${ID.bankAcct}/bank-transactions/import`, ID.bizBank)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'statement.csv', contentType: 'text/csv' });
    // At 2dd2eb65 the closed-month row's 409 escaped applyRules and failed the import after ingest.
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(imported.body).toMatchObject({ parsed: 3, inserted: 3 });

    const rows = await db.bankTransaction.findMany({ where: { businessId: ID.bizBank, accountId: ID.bankAcct } });
    const byRef = Object.fromEntries(rows.map((r: any) => [r.reference, r]));
    expect(byRef['V15A-R1'].status).toBe('UNMATCHED');
    expect(byRef['V15A-R1'].matchedTransactionId).toBeNull();
    for (const [ref, amount] of [['V15A-R2', 20], ['V15A-R3', 25]] as const) {
      const bank = byRef[ref];
      expect(bank.status, ref).toBe('MATCHED');
      const txn = await db.financialTransaction.findUnique({ where: { id: bank.matchedTransactionId }, include: { entries: true } });
      // At 2dd2eb65 both rows shared BankRule:<ruleId>:default: the second was linked to the first's posting.
      expect(txn.externalRef, ref).toBe(`BankRule:${ruleId}:${bank.id}`);
      expect(Number(txn.amount), ref).toBe(amount);
      expect(txn.date.toISOString(), ref).toBe(bank.date.toISOString());
      const label = (id: string) => (id === expenseCoa ? 'EXPENSE' : id === bankCoa ? 'BANK' : id);
      expect(txn.entries.map((e: any) => `${label(e.accountId)}:${Number(e.debit)}:${Number(e.credit)}`).sort()).toEqual(
        [`BANK:0:${amount}`, `EXPENSE:${amount}:0`],
      );
    }
    expect(byRef['V15A-R2'].matchedTransactionId).not.toBe(byRef['V15A-R3'].matchedTransactionId);

    // The reason is visible: a finance audit row on the skipped bank row ...
    const audit = await db.teamActivityLog.findMany({ where: { businessId: ID.bizBank, module: 'finance', entityType: 'BankTransaction', entityId: byRef['V15A-R1'].id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('BANK_TRANSACTION_UNMATCHED');
    expect(audit[0].detail).toMatch(/closed/i);
    expect(audit[0].meta).toMatchObject({ ruleId, reason: expect.stringMatching(/closed/i) });
    // ... and the skipped list of a direct apply, which writes nothing either.
    const before = await ledgerCounts(ID.bizBank);
    const applied = await api('post', '/bank-rules/apply', ID.bizBank).send({ bankTransactionIds: [byRef['V15A-R1'].id] });
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect(applied.body).toMatchObject({ scanned: 1, matched: 0, createdTransactions: 0 });
    expect(applied.body.skipped).toEqual([{ bankTransactionId: byRef['V15A-R1'].id, ruleId, reason: expect.stringMatching(/closed/i) }]);
    expect(await ledgerCounts(ID.bizBank)).toEqual(before);
    expect((await db.bankTransaction.findUnique({ where: { id: byRef['V15A-R1'].id } })).status).toBe('UNMATCHED');

    // Reopened, the row matches and posts once, dated in its own month.
    await periods.reopen(ID.bizBank, closed.id, { reopenedById: ID.owner });
    const reapplied = await api('post', '/bank-rules/apply', ID.bizBank).send({ bankTransactionIds: [byRef['V15A-R1'].id] });
    expect(reapplied.status, JSON.stringify(reapplied.body)).toBe(201);
    expect(reapplied.body).toMatchObject({ scanned: 1, matched: 1, createdTransactions: 1, skipped: [] });
    const r1 = await db.bankTransaction.findUnique({ where: { id: byRef['V15A-R1'].id } });
    expect(r1.status).toBe('MATCHED');
    const r1Txn = await db.financialTransaction.findUnique({ where: { id: r1.matchedTransactionId } });
    expect(r1Txn.externalRef).toBe(`BankRule:${ruleId}:${r1.id}`);
    expect(r1Txn.date.toISOString()).toBe(r1.date.toISOString());
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizBank, sourceType: 'BankRule' } })).toBe(3);
    await expectBalanced(ID.bizBank);
  }, 60_000);

  // ── V1-15b review repairs ────────────────────────────────────────────────

  it('LWD-14 (review SEC-V15b-1): a depreciation run dated inside a CLOSED month -> 409 even when it would post nothing; an earlier asOf or a replay writes nothing; the next run posts only its own delta, and the ledger holds what the row says', async () => {
    const biz = ID.bizAssetR;
    expect((await openAndClose(biz, last.year, last.month)).status).toBe('CLOSED');
    const created = await newAsset(biz, 'rewind');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const assetId: string = created.body.id;

    const now = new Date();
    const asOf1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0));
    const asOf2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 12, 0, 0));
    const months1 = (asOf1.getUTCFullYear() - 2024) * 12 + asOf1.getUTCMonth();
    const run1 = await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf: asOf1.toISOString() });
    expect(run1.status, JSON.stringify(run1.body)).toBe(201);
    expect(Number(run1.body.accumulatedDepreciation)).toBe(months1 * 10);

    const snapshot = async () => ({
      row: await assetRow(assetId),
      postings: (await fixedAssetPostings(assetId)).map((t: any) => `${t.externalRef}=${Number(t.amount)}`),
      ledger: await ledgerCounts(biz),
    });
    const before = await snapshot();
    expect(before.row).toBe(`ACTIVE:${months1 * 10}:${1200 - months1 * 10}:null:null`);

    // At 0f080f4b: 201, and the row was written down to the closed month's figure with nothing posted.
    const inClosed = await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf: inClosedMonth });
    expect(inClosed.status, JSON.stringify(inClosed.body)).toBe(409);
    expect(inClosed.body.message).toMatch(/closed/i);
    expect(await snapshot(), 'a run dated in a closed month writes nothing').toEqual(before);

    // An earlier asOf in an open month, and a replay: nothing to add, so nothing is written.
    const earlier = await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf: '2024-06-15T12:00:00.000Z' });
    expect(earlier.status, JSON.stringify(earlier.body)).toBe(201);
    expect(Number(earlier.body.accumulatedDepreciation), 'the figure is never written down').toBe(months1 * 10);
    const replay = await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf: asOf1.toISOString() });
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(await snapshot()).toEqual(before);

    // The next run posts one month (at 0f080f4b, after the write-down, it posted the climb back again).
    const run2 = await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf: asOf2.toISOString() });
    expect(run2.status, JSON.stringify(run2.body)).toBe(201);
    expect(Number(run2.body.accumulatedDepreciation)).toBe((months1 + 1) * 10);
    const postings = await fixedAssetPostings(assetId);
    expect(postings.map((t: any) => `${t.externalRef}=${Number(t.amount)}@${t.date.toISOString()}`)).toEqual([
      `FixedAsset:${assetId}:depreciation:${(months1 * 10).toFixed(4)}=${months1 * 10}@${asOf1.toISOString()}`,
      `FixedAsset:${assetId}:depreciation:${((months1 + 1) * 10).toFixed(4)}=10@${asOf2.toISOString()}`,
    ]);
    expect(accumulatedOnLedger(postings), 'the ledger holds what the asset row says').toBe((months1 + 1) * 10);
    await expectBalanced(biz);
  }, 60_000);

  it('LWD-15 (review SEC-V15b-2 / CRR-2): a DISPOSED asset is not depreciated and stays DISPOSED; racing depreciation / disposal never leaves a disposal on a live asset or one built from a stale figure; a disposal the ledger already holds is not replayed', async () => {
    const biz = ID.bizAssetR;
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0)).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 12, 0, 0)).toISOString();
    const months = (new Date(thisMonth).getUTCFullYear() - 2024) * 12 + new Date(thisMonth).getUTCMonth();

    const created = await newAsset(biz, 'disposed', 120, 12);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const assetId: string = created.body.id;
    // Purchased 2024-01: fully depreciated (120) as of this month.
    expect((await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf: thisMonth })).status).toBe(201);
    expect(await assetRow(assetId)).toBe(`FULLY_DEPRECIATED:${Math.min(120, months * 10)}:${120 - Math.min(120, months * 10)}:null:null`);
    const disposed = await api('post', `/fixed-assets/${assetId}/dispose`, biz).send({ proceeds: 100, disposalDate: thisMonth });
    expect(disposed.status, JSON.stringify(disposed.body)).toBe(201);
    const snapshot = async () => ({
      row: await assetRow(assetId),
      postings: (await fixedAssetPostings(assetId)).map((t: any) => `${t.externalRef}=${Number(t.amount)}`),
      ledger: await ledgerCounts(biz),
    });
    const before = await snapshot();
    expect(before.row).toBe(`DISPOSED:120:0:${thisMonth}:100`);

    // At 0f080f4b each run posted depreciation and wrote the row back to FULLY_DEPRECIATED;
    // the second dispose then answered 201 and rewrote proceeds and date, also inside a closed month.
    for (const asOf of [nextMonth, '2040-01-15T12:00:00.000Z']) {
      const dep = await api('post', `/fixed-assets/${assetId}/depreciate`, biz).send({ asOf });
      expect(dep.status, JSON.stringify(dep.body)).toBe(400);
      expect(dep.body.message).toMatch(/disposed/i);
    }
    for (const disposalDate of [nextMonth, inClosedMonth]) {
      const again = await api('post', `/fixed-assets/${assetId}/dispose`, biz).send({ proceeds: 5, disposalDate });
      expect(again.status, JSON.stringify(again.body)).toBe(400);
    }
    expect(await snapshot(), 'nothing changed').toEqual(before);

    // A disposal racing a depreciation run (at 0f080f4b some pairs ended 201/201 with the row
    // ACTIVE beside a disposal posting, or DISPOSED with a disposal built from accumulated 0).
    const outcomes: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const raced = await newAsset(biz, `race${i}`);
      expect(raced.status, JSON.stringify(raced.body)).toBe(201);
      const id: string = raced.body.id;
      const [dep, disp] = await Promise.all([
        api('post', `/fixed-assets/${id}/depreciate`, biz).send({ asOf: nextMonth }),
        api('post', `/fixed-assets/${id}/dispose`, biz).send({ proceeds: 500, disposalDate: thisMonth }),
      ]);
      const label = `pair ${i}: ${dep.status} ${JSON.stringify(dep.body)} / ${disp.status} ${JSON.stringify(disp.body)}`;
      expect([201, 400, 409], label).toContain(dep.status);
      expect([201, 409], label).toContain(disp.status);
      const row = await db.fixedAsset.findUnique({ where: { id } });
      const postings = await fixedAssetPostings(id);
      const disposals = postings.filter((t: any) => t.externalRef === `FixedAsset:${id}:disposal`);
      const depreciations = postings.filter((t: any) => t.externalRef.startsWith(`FixedAsset:${id}:depreciation:`));
      expect(depreciations.length, label).toBe(dep.status === 201 ? 1 : 0);
      if (row.status === 'DISPOSED') {
        expect(disp.status, label).toBe(201);
        expect(disposals, label).toHaveLength(1);
        const accDebit = disposals[0].entries
          .filter((e: any) => e.account.systemKey === 'ACCUMULATED_DEPRECIATION')
          .reduce((s: number, e: any) => s + Number(e.debit), 0);
        expect(accDebit, `${label}: the disposal clears the figure the row holds`).toBe(Number(row.accumulatedDepreciation));
        expect(accumulatedOnLedger(postings), label).toBe(0);
      } else {
        expect(disp.status, label).toBe(409);
        expect(disposals, `${label}: no disposal on a live asset`).toEqual([]);
        expect(accumulatedOnLedger(postings), label).toBe(Number(row.accumulatedDepreciation));
      }
      outcomes.push(`${dep.status}/${disp.status}:${row.status}`);
    }
    expect(outcomes.filter((o) => o.startsWith('201/201') && !o.endsWith('DISPOSED')), outcomes.join(' ')).toEqual([]);

    // A row a depreciation run wrote back before the repair (status off DISPOSED, the
    // disposal still in the ledger): a dispose is refused, dated now or in a closed month.
    await db.fixedAsset.update({ where: { id: assetId }, data: { status: 'FULLY_DEPRECIATED' } });
    const legacy = await snapshot();
    for (const disposalDate of [thisMonth, inClosedMonth]) {
      const replayed = await api('post', `/fixed-assets/${assetId}/dispose`, biz).send({ proceeds: 5, disposalDate });
      expect(replayed.status, JSON.stringify(replayed.body)).toBe(409);
      expect(replayed.body.message).toMatch(/already posted/i);
    }
    expect(await snapshot(), 'the replay rewrote nothing').toEqual(legacy);
    await expectBalanced(biz);
  }, 120_000);

  it('LWD-16 (review SEC-V15b-3 / CRR-1): two concurrent applies of one UNMATCHED row both answer 201; the row is matched once, to one posting', async () => {
    const biz = ID.bizBankR;
    const expenseCoa = await accountId(biz, 'EXPENSE_GENERAL');
    const rule = await api('post', '/bank-rules', biz).send({ name: `${P}tolls`, pattern: 'v15a toll', matchType: 'contains', accountId: expenseCoa });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const ruleId: string = rule.body.id;
    for (let i = 0; i < 8; i += 1) {
      const row = await db.bankTransaction.create({
        data: { id: `${P}toll${i}`, businessId: biz, accountId: ID.bankAcctR, date: new Date(), description: `V15A TOLL ${i}`, amount: -3, currency: 'TTD', status: 'UNMATCHED' },
      });
      const both = await Promise.all([0, 1].map(() => api('post', '/bank-rules/apply', biz).send({ bankTransactionIds: [row.id] })));
      const label = both.map((r) => `${r.status} ${JSON.stringify(r.body)}`).join(' | ');
      // At 0f080f4b one of each pair answered 500 (25P02: the posting's key collision aborted its transaction).
      expect(both.map((r) => r.status), label).toEqual([201, 201]);
      expect(both.map((r) => r.body.matched).sort(), label).toEqual([0, 1]);
      expect(both.map((r) => r.body.createdTransactions).sort(), label).toEqual([0, 1]);
      expect(both.map((r) => r.body.skipped), label).toEqual([[], []]);
      const bank = await db.bankTransaction.findUnique({ where: { id: row.id } });
      expect(bank.status, label).toBe('MATCHED');
      const postings = await db.financialTransaction.findMany({ where: { businessId: biz, sourceType: 'BankRule', sourceId: ruleId, externalRef: `BankRule:${ruleId}:${row.id}` } });
      expect(postings.map((t: any) => t.id), label).toEqual([bank.matchedTransactionId]);
      const audit = await db.teamActivityLog.findMany({ where: { businessId: biz, module: 'finance', entityType: 'BankTransaction', entityId: row.id } });
      expect(audit.map((a: any) => a.action), label).toEqual(['BANK_TRANSACTION_MATCHED']);
    }
    expect(await db.financialTransaction.count({ where: { businessId: biz, sourceType: 'BankRule', sourceId: ruleId } })).toBe(8);
    await expectBalanced(biz);
  }, 60_000);

  it('LWD-17 (review SEC-V15b-4): a re-applied row re-links its own earlier posting, but not once another bank row claims it or it was reversed', async () => {
    const biz = ID.bizBankR;
    const expenseCoa = await accountId(biz, 'EXPENSE_GENERAL');
    const rule = await api('post', '/bank-rules', biz).send({ name: `${P}fuel`, pattern: 'v15a fuel', matchType: 'contains', accountId: expenseCoa });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const ruleId: string = rule.body.id;
    const today = new Date();
    const a = await db.bankTransaction.create({ data: { id: `${P}fuelA`, businessId: biz, accountId: ID.bankAcctR, date: today, description: 'V15A FUEL a', amount: -30, currency: 'TTD', status: 'UNMATCHED' } });
    const b = await db.bankTransaction.create({ data: { id: `${P}fuelB`, businessId: biz, accountId: ID.bankAcctR, date: today, description: 'v15a other spend', amount: -30, currency: 'TTD', status: 'UNMATCHED' } });
    const applyA = () => api('post', '/bank-rules/apply', biz).send({ bankTransactionIds: [a.id] });
    const unmatch = (id: string) => api('post', `/bank-transactions/${id}/unmatch`, biz).send({});
    const bankRow = (id: string) => db.bankTransaction.findUnique({ where: { id } });

    const first = await applyA();
    expect(first.body, JSON.stringify(first.body)).toMatchObject({ scanned: 1, matched: 1, createdTransactions: 1, skipped: [] });
    const p: string = (await bankRow(a.id)).matchedTransactionId;
    expect(p).toBeTruthy();

    // Unmatched and re-applied: its own posting comes back, nothing new is posted.
    expect((await unmatch(a.id)).status).toBe(201);
    const relinked = await applyA();
    expect(relinked.body, JSON.stringify(relinked.body)).toMatchObject({ scanned: 1, matched: 1, createdTransactions: 0, skipped: [] });
    expect(await bankRow(a.id)).toMatchObject({ status: 'MATCHED', matchedTransactionId: p });

    // Another bank row claims the posting meanwhile (at 0f080f4b the re-apply linked A as well: two lines, one transaction).
    expect((await unmatch(a.id)).status).toBe(201);
    const manual = await api('post', `/bank-transactions/${b.id}/match`, biz).send({ transactionId: p });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    const counts = await ledgerCounts(biz);
    const claimed = await applyA();
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(201);
    expect(claimed.body).toMatchObject({ scanned: 1, matched: 0, createdTransactions: 0 });
    expect(claimed.body.skipped).toEqual([{ bankTransactionId: a.id, ruleId, reason: expect.stringMatching(/another bank row/i) }]);
    expect(await bankRow(a.id)).toMatchObject({ status: 'UNMATCHED', matchedTransactionId: null });
    const claims = await db.bankTransaction.findMany({ where: { businessId: biz, matchedTransactionId: p, status: 'MATCHED' }, select: { id: true } });
    expect(claims.map((c: any) => c.id)).toEqual([b.id]);
    expect(await ledgerCounts(biz)).toEqual(counts);

    // The posting reversed: not re-linked either.
    expect((await unmatch(b.id)).status).toBe(201);
    await posting.reverse(biz, p, { reason: 'v15a reversed rule posting' });
    const afterReversal = await ledgerCounts(biz);
    const reversed = await applyA();
    expect(reversed.body.skipped, JSON.stringify(reversed.body)).toEqual([{ bankTransactionId: a.id, ruleId, reason: expect.stringMatching(/no longer POSTED/) }]);
    expect(reversed.body).toMatchObject({ matched: 0, createdTransactions: 0 });
    expect(await bankRow(a.id)).toMatchObject({ status: 'UNMATCHED', matchedTransactionId: null });
    expect(await ledgerCounts(biz)).toEqual(afterReversal);

    // The two refusals are audited on A with their reasons (beside the two unmatch rows).
    const audit = await db.teamActivityLog.findMany({
      where: { businessId: biz, module: 'finance', entityType: 'BankTransaction', entityId: a.id, action: 'BANK_TRANSACTION_UNMATCHED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((r: any) => r.title)).toEqual(['Unmatched bank row', 'Unmatched bank row', 'Bank rule not applied', 'Bank rule not applied']);
    expect(audit.slice(2).map((r: any) => r.meta.reason)).toEqual([expect.stringMatching(/another bank row/i), expect.stringMatching(/no longer POSTED/)]);
    await expectBalanced(biz);
  }, 60_000);
});

describe('review SEC9-1: a PATCH or DELETE of a period never lands on it once it is CLOSED, and only the owner or an admin changes a period', () => {
  let financeApp: any;
  let routeService: any; // the AccountingPeriodService instance behind financeApp's routes

  function route(method: 'patch' | 'delete', path: string, actor: string | null, body?: Record<string, unknown>) {
    let req = request(financeApp.getHttpServer())[method](`/finance/businesses/${ID.bizEdit}/accounting-periods${path}`);
    if (actor) req = req.set(HEADER, actor);
    return body ? req.send(body) : req;
  }

  /**
   * Holds the route service's next get() (the PATCH / DELETE route's read of
   * the period) after it returns, until released: the repro's pause, which
   * only widens the read-then-write window the route already has.
   */
  function pauseNextRead() {
    let readDone!: () => void;
    const read = new Promise<void>((resolve) => { readDone = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = routeService.get.bind(routeService);
    const spy = vi.spyOn(routeService, 'get').mockImplementationOnce(async (...args: any[]) => {
      const row = await original(...args);
      readDone();
      await gate;
      return row;
    });
    return { read, release, restore: () => spy.mockRestore() };
  }

  function midMonth(m: { year: number; month: number }): Date {
    return new Date(Date.UTC(m.year, m.month - 1, 15, 12, 0, 0));
  }

  beforeAll(async () => {
    await seedTenant(ID.bizEdit, 'CASH');
    await db.membership.create({ data: { id: `${ID.bizEdit}_staff`, userId: ID.staff, businessId: ID.bizEdit, role: 'STAFF' } });
    await db.membership.create({ data: { id: `${ID.bizEdit}_admin`, userId: ID.admin, businessId: ID.bizEdit, role: 'ADMIN' } });
    const PeriodMod = await import('../src/modules/finance/accounting-period.service');
    financeApp = await buildFinanceApp([PeriodMod.AccountingPeriodService]);
    routeService = financeApp.get(PeriodMod.AccountingPeriodService);
  }, 120_000);

  afterAll(async () => {
    if (financeApp) await financeApp.close();
  });

  it('LWD-18 (review SEC9-1): a PATCH that read the period OPEN and writes after its close committed -> 400; the CLOSED period keeps its month, and that month stays shut, with no reopen', async () => {
    const shut = monthFromNow(-4);
    const period = await periods.create(ID.bizEdit, shut);
    const pause = pauseNextRead();
    try {
      // An admin moves the period three months ahead; the move reads it OPEN, then waits.
      const patching = route('patch', `/${period.id}`, ID.admin, monthFromNow(3)).then((r: any) => r);
      await pause.read;
      expect((await periods.close(ID.bizEdit, period.id, { closedById: ID.owner })).status).toBe('CLOSED');
      await expect(posting.post(await probe(ID.bizEdit, `${P}edit_patch_before`, midMonth(shut)))).rejects.toMatchObject({ status: 409 });
      pause.release();
      const res = await patching;
      // At f366085e: 200, the CLOSED row covered a month three months ahead (CLOSED but not ended,
      // so not enforced), and the formerly closed month took postings again, with no PERIOD_REOPENED.
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      const row = await db.accountingPeriod.findUnique({ where: { id: period.id } });
      expect(row).toMatchObject({ status: 'CLOSED', year: shut.year, month: shut.month, closedById: ID.owner });
      expect(row.startDate.toISOString()).toBe(new Date(period.startDate).toISOString());
      expect(row.endDate.toISOString()).toBe(new Date(period.endDate).toISOString());
      const before = await ledgerCounts(ID.bizEdit);
      await expect(posting.post(await probe(ID.bizEdit, `${P}edit_patch_after`, midMonth(shut)))).rejects.toMatchObject({ status: 409 });
      expect(await ledgerCounts(ID.bizEdit)).toEqual(before);
      expect((await periodAudit(period.id)).map((a: any) => `${a.action}:${a.userId}`)).toEqual([`PERIOD_CLOSED:${ID.owner}`]);
    } finally {
      pause.release();
      pause.restore();
    }
  }, 60_000);

  it('LWD-19 (review SEC9-1): a DELETE that read the period OPEN and writes after its close committed -> 400; the CLOSED period stays, and its month stays shut', async () => {
    const shut = monthFromNow(-5);
    const period = await periods.create(ID.bizEdit, shut);
    const pause = pauseNextRead();
    try {
      const deleting = route('delete', `/${period.id}`, ID.admin).then((r: any) => r);
      await pause.read;
      expect((await periods.close(ID.bizEdit, period.id, { closedById: ID.owner })).status).toBe('CLOSED');
      pause.release();
      const res = await deleting;
      // At f366085e: 200, the CLOSED row was gone, and its month took postings again, with no audit row.
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(await db.accountingPeriod.findUnique({ where: { id: period.id } })).toMatchObject({ status: 'CLOSED', closedById: ID.owner });
      const before = await ledgerCounts(ID.bizEdit);
      await expect(posting.post(await probe(ID.bizEdit, `${P}edit_delete_after`, midMonth(shut)))).rejects.toMatchObject({ status: 409 });
      expect(await ledgerCounts(ID.bizEdit)).toEqual(before);
      expect((await periodAudit(period.id)).map((a: any) => a.action)).toEqual(['PERIOD_CLOSED']);
    } finally {
      pause.release();
      pause.restore();
    }
  }, 60_000);

  it('LWD-20 (review SEC9-1): a STAFF PATCH or DELETE of a period -> 403 and nothing changes; the owner and an admin edit and delete an OPEN period; a CLOSED one is refused to them too; unauthenticated -> 401', async () => {
    const open = await periods.create(ID.bizEdit, monthFromNow(-7));
    const shape = async (id: string) => {
      const row = await db.accountingPeriod.findUnique({ where: { id } });
      return row ? `${row.status}:${row.year}-${row.month}` : 'gone';
    };
    const original = `OPEN:${open.year}-${open.month}`;

    // Changing a period is the same authority as closing and reopening it (safer
    // product choice, listed with the repair: create stays open to members).
    const staffPatch = await route('patch', `/${open.id}`, ID.staff, monthFromNow(2));
    expect(staffPatch.status, JSON.stringify(staffPatch.body)).toBe(403);
    expect(await shape(open.id)).toBe(original);
    const staffDelete = await route('delete', `/${open.id}`, ID.staff);
    expect(staffDelete.status, JSON.stringify(staffDelete.body)).toBe(403);
    expect(await shape(open.id)).toBe(original);
    expect((await route('patch', `/${open.id}`, null, monthFromNow(2))).status).toBe(401);
    expect((await route('delete', `/${open.id}`, null)).status).toBe(401);
    expect(await shape(open.id)).toBe(original);

    const moved = monthFromNow(-8);
    const ownerPatch = await route('patch', `/${open.id}`, ID.owner, moved);
    expect(ownerPatch.status, JSON.stringify(ownerPatch.body)).toBe(200);
    expect(ownerPatch.body).toMatchObject({ id: open.id, status: 'OPEN', year: moved.year, month: moved.month });
    expect(new Date(ownerPatch.body.startDate).toISOString()).toBe(new Date(Date.UTC(moved.year, moved.month - 1, 1)).toISOString());

    const shut = await periods.create(ID.bizEdit, monthFromNow(-9));
    await periods.close(ID.bizEdit, shut.id, { closedById: ID.owner });
    const closedShape = await shape(shut.id);
    const ownerPatchClosed = await route('patch', `/${shut.id}`, ID.owner, monthFromNow(2));
    expect(ownerPatchClosed.status, JSON.stringify(ownerPatchClosed.body)).toBe(400);
    const adminDeleteClosed = await route('delete', `/${shut.id}`, ID.admin);
    expect(adminDeleteClosed.status, JSON.stringify(adminDeleteClosed.body)).toBe(400);
    expect(await shape(shut.id)).toBe(closedShape);

    const adminDelete = await route('delete', `/${open.id}`, ID.admin);
    expect(adminDelete.status, JSON.stringify(adminDelete.body)).toBe(200);
    expect(await shape(open.id)).toBe('gone');
  }, 60_000);
});

describe('review LC-1: a close shuts only its own month, so a settlement dated now never waits on it; and it stamps every row of the month', () => {
  const SLOW_SECRET = `whsec_${P}slow`;
  const ROWS = 1100;

  /** ROWS history transactions of bizSlow dated across month `m`; every third carries metadata of its own. */
  async function seedMonth(m: { year: number; month: number }, tag: string) {
    const days = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
    await db.financialTransaction.createMany({
      data: Array.from({ length: ROWS }, (_, i) => ({
        businessId: ID.bizSlow,
        type: 'INCOME',
        status: 'POSTED',
        date: new Date(Date.UTC(m.year, m.month - 1, 1 + (i % days), 12, 0, 0)),
        amount: 1,
        currency: 'TTD',
        description: `v15a ${tag} history ${i}`,
        sourceType: 'V15Seed',
        sourceId: `${P}${tag}_${i}`,
        ...(i % 3 === 0 ? { metadata: { seed: i } } : {}),
      })),
    });
  }

  /** bizSlow transactions dated in month `m`: how many carry `stamp` (any stamp when null), and how many kept their own `seed`. */
  async function monthRows(m: { year: number; month: number }, stamp: string | null): Promise<{ stamped: number; seeded: number; total: number }> {
    const from = new Date(Date.UTC(m.year, m.month - 1, 1));
    const to = new Date(Date.UTC(m.year, m.month, 1));
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*) FILTER (WHERE metadata->>'lockedByPeriod' IS NOT NULL AND ($4::text IS NULL OR metadata->>'lockedByPeriod' = $4))::int AS stamped,
              count(*) FILTER (WHERE metadata->>'seed' IS NOT NULL)::int AS seeded,
              count(*)::int AS total
         FROM financial_transactions WHERE business_id = $1 AND date >= $2::timestamp AND date < $3::timestamp`,
      ID.bizSlow,
      from.toISOString().slice(0, 23).replace('T', ' '),
      to.toISOString().slice(0, 23).replace('T', ' '),
      stamp,
    );
    return row;
  }

  beforeAll(async () => {
    await db.business.create({
      data: { id: ID.bizSlow, name: `V15A ${ID.bizSlow}`, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH', metaData: { stripeWebhookSecret: SLOW_SECRET } },
    });
    await db.membership.create({ data: { id: `${ID.bizSlow}_m`, userId: ID.owner, businessId: ID.bizSlow, role: 'OWNER' } });
    await coa.ensureDefaults(ID.bizSlow);
    await db.contact.create({ data: { id: ID.contactSlow, businessId: ID.bizSlow, firstName: 'V15A', lastName: 'Slow', email: `${P}slow@test.local` } });
    await seedInvoice(ID.invSlow, ID.bizSlow, ID.contactSlow, 40, 100, 'TTD', 'SENT');
    await seedMonth(monthFromNow(-1), 'slow');
    await seedMonth(monthFromNow(-2), 'stamp');
  }, 120_000);

  it('LWD-21 (review LC-1): a Stripe checkout.session.completed dated now, arriving while a close stamps last month at ~6ms a row, is recorded and posted at once; a posting dated in that month waits and is refused; the redelivery is a duplicate', async () => {
    const last = monthFromNow(-1);
    const period = await periods.create(ID.bizSlow, last);
    // The repro's emulation of a hosted database's cost per stamped row, on bizSlow's rows only.
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION ${SLOW_STAMP_TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.006); RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${SLOW_STAMP_TRIGGER} BEFORE UPDATE ON financial_transactions FOR EACH ROW
         WHEN (OLD.business_id = '${ID.bizSlow}') EXECUTE FUNCTION ${SLOW_STAMP_TRIGGER}()`,
    );
    let closeSettled = false;
    let closing: Promise<any> | undefined;
    let inMonth: Promise<unknown> | undefined;
    try {
      closing = periods.close(ID.bizSlow, period.id, { closedById: ID.owner }).finally(() => { closeSettled = true; });
      await waitForSleepingStamp();
      // A posting dated inside the month being closed starts now: it must wait for the close, then be
      // refused. (In a transaction that outlives the slow close, so its refusal is the period's, not a timeout.)
      let inMonthSettled = false;
      const inMonthInput = await probe(ID.bizSlow, `${P}slow_in_month`, new Date(Date.UTC(last.year, last.month - 1, 20, 12)));
      inMonth = db
        .$transaction((tx: any) => posting.post(inMonthInput, tx), { maxWait: 10_000, timeout: 60_000 })
        .finally(() => { inMonthSettled = true; });
      inMonth.catch(() => undefined);

      const event = {
        id: `${P}evt_slow`,
        type: 'checkout.session.completed',
        data: { object: { id: `${P}cs_slow`, metadata: { invoiceId: ID.invSlow }, amount_total: 10000, currency: 'ttd' } },
      };
      const raw = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const signature = `t=${t},v1=${createHmac('sha256', SLOW_SECRET).update(`${t}.${raw}`).digest('hex')}`;
      // At f366085e the settlement queued behind the close's business-wide lock, its payment
      // transaction expired (P2028) after its dedupe row had committed, and the redelivery
      // below was acked as a duplicate: the payment was never recorded.
      expect(await payments.handleStripeWebhook(raw, signature)).toEqual({ ok: true, received: true, processed: 'checkout.session.completed' });
      expect(closeSettled, 'the settlement waited for the close of another month').toBe(false);
      expect(inMonthSettled, 'a posting dated inside the month being closed did not wait for the close').toBe(false);

      const closed = await closing;
      expect(closed.status).toBe('CLOSED');
      await expect(inMonth).rejects.toMatchObject({ status: 409 });
      expect(await db.financialTransaction.count({ where: { businessId: ID.bizSlow, sourceId: `${P}slow_in_month` } })).toBe(0);

      expect(await payments.handleStripeWebhook(raw, signature)).toEqual({ ok: true, received: true });
      const rows = await db.payment.findMany({ where: { invoiceId: ID.invSlow } });
      expect(rows.map((p: any) => `${p.provider}:${p.status}:${Number(p.amount)}`)).toEqual(['stripe:SUCCESSFUL:100']);
      const postings = await paymentPostings(rows[0].id);
      expect(postings.map((x: any) => `${x.type}:${x.status}`)).toEqual(['INCOME:POSTED']);
      expect(postings[0].metadata?.lockedByPeriod, 'dated now: not inside the closed month').toBeUndefined();
      expect((await db.invoice.findUnique({ where: { id: ID.invSlow } })).status).toBe('PAID');
      expect((await monthRows(last, closed.lockedTransactionStamp)).stamped).toBe(ROWS);
      await expectBalanced(ID.bizSlow);
    } finally {
      await closing?.catch(() => undefined);
      await inMonth?.catch(() => undefined);
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${SLOW_STAMP_TRIGGER} ON financial_transactions`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${SLOW_STAMP_TRIGGER}()`);
    }
  }, 120_000);

  it('LWD-22 (review LC-1): close stamps every transaction dated in its month (1100, past the 1000-row read cap) and keeps their own metadata; reopen clears every stamp; the audit rows count them all', async () => {
    const m = monthFromNow(-2);
    expect((await monthRows(m, null)).total).toBe(ROWS);
    const period = await periods.create(ID.bizSlow, m);
    const closed = await periods.close(ID.bizSlow, period.id, { closedById: ID.owner });
    const stamp: string = closed.lockedTransactionStamp;
    // At f366085e: 1000 (close read the month's rows through a findMany capped at 1000).
    expect(await monthRows(m, stamp)).toEqual({ stamped: ROWS, seeded: Math.ceil(ROWS / 3), total: ROWS });
    const [{ n: stampedAnywhere }] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM financial_transactions WHERE metadata->>'lockedByPeriod' = $1`,
      stamp,
    );
    expect(stampedAnywhere, 'only the month\'s own rows carry its stamp').toBe(ROWS);

    await periods.reopen(ID.bizSlow, period.id, { reopenedById: ID.owner });
    expect(await monthRows(m, null)).toEqual({ stamped: 0, seeded: Math.ceil(ROWS / 3), total: ROWS });
    const audit = await periodAudit(period.id);
    expect(audit.map((a: any) => a.action)).toEqual(['PERIOD_CLOSED', 'PERIOD_REOPENED']);
    expect(audit[0].meta).toMatchObject({ stamp, transactionsStamped: ROWS });
    expect(audit[1].meta).toMatchObject({ previousStamp: stamp, transactionsUnstamped: ROWS });
  }, 120_000);
});

describe('review LC-3: the cash-basis P&L and cashflow read every cash transaction in the range, past the 1000-row read cap', () => {
  const SALES = 1000;
  const from = new Date(Date.UTC(2000, 0, 1));

  beforeAll(async () => {
    await seedTenant(ID.bizMany, 'CASH');
    const cash = await accountId(ID.bizMany, 'CASH');
    const revenue = await accountId(ID.bizMany, 'REVENUE');
    const date = new Date(Date.now() - 86_400_000);
    const sale = (i: number): PostingInput => ({
      businessId: ID.bizMany,
      type: 'INCOME',
      date,
      amount: 10,
      currency: 'TTD',
      description: `v15a many ${i}`,
      sourceType: 'V15Probe',
      sourceId: `${P}many_${i}`,
      kind: 'probe',
      entries: [
        { accountId: cash, debit: 10 },
        { accountId: revenue, credit: 10 },
      ],
    });
    // The repro: a cash sale, 999 more, then the first reversed through the door (1001 transactions).
    const first = await posting.post(sale(0));
    for (let i = 1; i < SALES; i += 10) {
      await Promise.all(Array.from({ length: Math.min(10, SALES - i) }, (_, k) => posting.post(sale(i + k))));
    }
    await posting.reverse(ID.bizMany, first.transactionId, { reason: 'v15a LC-3 reversal' });
  }, 180_000);

  it('LWD-23 (review LC-3): a REVERSAL past the 1000th cash transaction of the range is read: the cash P&L and cash cashflow equal the accrual figures', async () => {
    const to = new Date(Date.now() + 86_400_000);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizMany } })).toBe(SALES + 1);
    const accrual = await reporting.getPnl(ID.bizMany, from, to, 'accrual');
    const cash = await reporting.getPnl(ID.bizMany, from, to, 'cash');
    expect(accrual.revenue.total, 'accrual revenue').toBe((SALES - 1) * 10);
    // At f366085e: 10000, the REVERSAL (the 1001st row read) was dropped by the 1000-row read cap.
    expect(cash.revenue.total, 'cash-basis revenue').toBe(accrual.revenue.total);
    expect(cash.netProfit).toBe(accrual.netProfit);

    const cashFlow = await reporting.getCashflow(ID.bizMany, from, to, 'cash');
    const accrualFlow = await reporting.getCashflow(ID.bizMany, from, to, 'accrual');
    expect(accrualFlow.netMovement, 'every cash movement').toBe((SALES - 1) * 10);
    expect(cashFlow.netMovement, 'cash-basis operating cash').toBe(accrualFlow.netMovement);
    expect(cashFlow.cashIn).toBe(SALES * 10);
    expect(cashFlow.cashOut).toBe(10);
    expect(cashFlow.accrualAdjustments.netIncome).toBe((SALES - 1) * 10);
    await expectBalanced(ID.bizMany);
  }, 60_000);
});

describe('V1-15c: a PayPal capture records its payment through the posting door', () => {
  /**
   * The PayPal SDK client, stubbed at getPaypalClient: the order is this
   * invoice's, and it captures. `duringCapture` runs inside the capture call,
   * after PayPal has taken the money and before it answers.
   */
  function stubPaypal(invoiceId: string, orderId: string, captureId: string, duringCapture?: () => Promise<void>) {
    return vi.spyOn(payments as any, 'getPaypalClient').mockReturnValue({
      client: {},
      ordersController: {
        getOrder: async () => ({ result: { purchaseUnits: [{ customId: invoiceId, amount: { value: '100.00' } }] } }),
        captureOrder: async () => {
          await duringCapture?.();
          return {
            result: { id: orderId, status: 'COMPLETED', purchaseUnits: [{ payments: { captures: [{ id: captureId }] } }], payer: {} },
          };
        },
      },
    });
  }

  /** The PayPal connector, a recorder of the events a capture announces (the harness builds PaymentsService without one). */
  function recordConnector() {
    const connector = {
      emitPaymentReceived: vi.fn(async () => undefined),
      emitPaymentFailed: vi.fn(async () => undefined),
    };
    (payments as any).paypalConnector = connector;
    return { connector, restore: () => ((payments as any).paypalConnector = undefined) };
  }

  /** PayPal's PAYMENT.CAPTURE.COMPLETED delivery for `captureId` (its signature verification, a network call, stubbed). */
  async function captureWebhook(eventId: string, captureId: string, invoiceId: string) {
    const verify = vi.spyOn(payments as any, 'verifyPaypalSignature').mockResolvedValue(true);
    try {
      return await payments.handlePaypalWebhook(
        JSON.stringify({
          id: eventId,
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: { id: captureId, custom_id: invoiceId, amount: { value: '100.00', currency_code: 'TTD' } },
        }),
        {},
      );
    } finally {
      verify.mockRestore();
    }
  }

  async function captureRows(invoiceId: string): Promise<string[]> {
    const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
    return rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}`);
  }

  async function capturePostings(invoiceId: string): Promise<string[]> {
    const rows = await db.payment.findMany({ where: { invoiceId }, select: { id: true } });
    const txns = await db.financialTransaction.findMany({
      where: { sourceType: 'Payment', sourceId: { in: rows.map((p: any) => p.id) } },
      orderBy: { createdAt: 'asc' },
    });
    return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`);
  }

  function p2028(): Error {
    return Object.assign(new Error('Transaction already closed (injected by V1-15c)'), { code: 'P2028' });
  }

  beforeAll(async () => {
    await seedTenant(ID.bizCapture, 'CASH');
    await db.contact.create({ data: { id: ID.contactCapture, businessId: ID.bizCapture, firstName: 'V15A', lastName: 'Capture', email: `${P}capture@test.local` } });
    await seedInvoice(ID.invCapture, ID.bizCapture, ID.contactCapture, 50, 100, 'TTD', 'SENT');
    await seedInvoice(ID.invCaptureAbort, ID.bizCapture, ID.contactCapture, 51, 100, 'TTD', 'SENT');
    await seedInvoice(ID.invCaptureRetry, ID.bizCapture, ID.contactCapture, 52, 100, 'TTD', 'SENT');
    await seedInvoice(ID.invCaptureRace, ID.bizCapture, ID.contactCapture, 53, 100, 'TTD', 'SENT');
  }, 60_000);

  it('LWD-24 (V1-15c): capturePaypalOrder records one SUCCESSFUL row and posts it once; the invoice is PAID', async () => {
    const spy = stubPaypal(ID.invCapture, `${P}order_capture`, `${P}cap_capture`);
    try {
      expect(await payments.capturePaypalOrder(`${P}order_capture`, ID.invCapture)).toMatchObject({ id: `${P}order_capture`, status: 'COMPLETED' });
    } finally {
      spy.mockRestore();
    }
    const rows = await db.payment.findMany({ where: { invoiceId: ID.invCapture } });
    expect(rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}`)).toEqual([`paypal:${P}cap_capture:SUCCESSFUL:100`]);
    // At cb50b388: [] (payment.create with no posting: the ledger never saw the capture).
    expect((await paymentPostings(rows[0].id)).map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`)).toEqual(['INCOME:POSTED:100']);
    expect((await db.invoice.findUnique({ where: { id: ID.invCapture } })).status).toBe('PAID');
    await expectBalanced(ID.bizCapture);
  });

  it("LWD-25 (V1-15c; review SEC-V15C-2, CR-V15C-1): when the captured payment's transaction aborts, no SUCCESSFUL row is left unposted, nothing is recorded FAILED or announced as failed for money PayPal took, PayPal's capture delivery records it once, and the invoice is not paid twice", async () => {
    const revenuePosting = (payments as any).revenuePosting;
    const { connector, restore } = recordConnector();
    const abort = vi.spyOn(revenuePosting, 'onPaymentRecorded').mockRejectedValue(p2028());
    const spy = stubPaypal(ID.invCaptureAbort, `${P}order_abort`, `${P}cap_abort`);
    try {
      // At 1504b037: rejected 'Failed to capture PayPal order', a FAILED row for the whole total and emitPaymentFailed.
      expect(await payments.capturePaypalOrder(`${P}order_abort`, ID.invCaptureAbort)).toMatchObject({ id: `${P}order_abort`, status: 'COMPLETED' });
      expect(abort, 'the transient abort is retried, a bounded number of times').toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
      abort.mockRestore();
    }
    // At cb50b388: one SUCCESSFUL row with no posting (the posting was never attempted).
    expect(await captureRows(ID.invCaptureAbort), 'no SUCCESSFUL row left unposted, and no FAILED row for money PayPal took').toEqual([]);
    expect(connector.emitPaymentFailed, 'no payment.failed for a capture PayPal completed').not.toHaveBeenCalled();
    expect(connector.emitPaymentReceived).not.toHaveBeenCalled();
    expect((await db.invoice.findUnique({ where: { id: ID.invCaptureAbort } })).status).toBe('SENT');

    // PayPal's own delivery of the capture records it, once and posted (its claim is released when it fails: WDD-02).
    expect(await captureWebhook(`${P}WH-cap_abort`, `${P}cap_abort`, ID.invCaptureAbort)).toEqual({
      ok: true,
      received: true,
      processed: 'PAYMENT.CAPTURE.COMPLETED',
    });
    restore();
    expect(await captureRows(ID.invCaptureAbort)).toEqual([`paypal:${P}cap_abort:SUCCESSFUL:100`]);
    expect(await capturePostings(ID.invCaptureAbort)).toEqual(['INCOME:POSTED:100']);
    expect((await db.invoice.findUnique({ where: { id: ID.invCaptureAbort } })).status).toBe('PAID');

    // CR-V15C-1's double charge: at 1504b037 the invoice stayed SENT after the FAILED capture and a second capture was taken.
    const again = stubPaypal(ID.invCaptureAbort, `${P}order_abort2`, `${P}cap_abort2`);
    try {
      await expect(payments.capturePaypalOrder(`${P}order_abort2`, ID.invCaptureAbort)).rejects.toThrow(/already paid/);
    } finally {
      again.mockRestore();
    }
    expect(await captureRows(ID.invCaptureAbort)).toEqual([`paypal:${P}cap_abort:SUCCESSFUL:100`]);
    await expectBalanced(ID.bizCapture);
  });

  it('LWD-25b (review CR-V15C-1): a transient abort of the first recording attempt is retried: the capture is recorded and posted once, announced once, nothing FAILED', async () => {
    const revenuePosting = (payments as any).revenuePosting;
    const { connector, restore } = recordConnector();
    const real = revenuePosting.onPaymentRecorded.bind(revenuePosting);
    let calls = 0;
    const abort = vi.spyOn(revenuePosting, 'onPaymentRecorded').mockImplementation(async (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) throw p2028();
      return real(...args);
    });
    const spy = stubPaypal(ID.invCaptureRetry, `${P}order_retry`, `${P}cap_retry`);
    try {
      expect(await payments.capturePaypalOrder(`${P}order_retry`, ID.invCaptureRetry)).toMatchObject({ id: `${P}order_retry`, status: 'COMPLETED' });
    } finally {
      spy.mockRestore();
      abort.mockRestore();
      restore();
    }
    expect(calls).toBe(2);
    expect(await captureRows(ID.invCaptureRetry)).toEqual([`paypal:${P}cap_retry:SUCCESSFUL:100`]);
    expect(await capturePostings(ID.invCaptureRetry)).toEqual(['INCOME:POSTED:100']);
    expect(connector.emitPaymentReceived).toHaveBeenCalledTimes(1);
    expect(connector.emitPaymentFailed).not.toHaveBeenCalled();
    expect((await db.invoice.findUnique({ where: { id: ID.invCaptureRetry } })).status).toBe('PAID');
    await expectBalanced(ID.bizCapture);
  });

  it("LWD-25c (review SEC-V15C-2): PayPal's capture delivery records the capture before the capture call does (P2002 on the capture id): the call answers COMPLETED, nothing FAILED, one row posted once, announced once", async () => {
    const { connector, restore } = recordConnector();
    let delivered: unknown;
    const spy = stubPaypal(ID.invCaptureRace, `${P}order_race`, `${P}cap_race`, async () => {
      delivered = await captureWebhook(`${P}WH-cap_race`, `${P}cap_race`, ID.invCaptureRace);
    });
    try {
      // At 1504b037: rejected 'Failed to capture PayPal order' with a FAILED row and emitPaymentFailed, though the capture is recorded.
      expect(await payments.capturePaypalOrder(`${P}order_race`, ID.invCaptureRace)).toMatchObject({ id: `${P}order_race`, status: 'COMPLETED' });
    } finally {
      spy.mockRestore();
      restore();
    }
    expect(delivered).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.COMPLETED' });
    expect(await captureRows(ID.invCaptureRace)).toEqual([`paypal:${P}cap_race:SUCCESSFUL:100`]);
    expect(await capturePostings(ID.invCaptureRace)).toEqual(['INCOME:POSTED:100']);
    expect(connector.emitPaymentFailed).not.toHaveBeenCalled();
    expect(connector.emitPaymentReceived, 'announced by the delivery that recorded it, not again by the capture').toHaveBeenCalledTimes(1);
    expect((await db.invoice.findUnique({ where: { id: ID.invCaptureRace } })).status).toBe('PAID');
    await expectBalanced(ID.bizCapture);
  });
});

describe('V1-15c: the dimension breakdowns and AP aging read every ledger row, past the 1000-row read cap', () => {
  const ROWS = 1001;
  const from = new Date(Date.UTC(2000, 0, 1));
  const date = new Date(Date.now() - 86_400_000);
  /** Every bill fell due ten days ago: one aging bucket (1-30 days). */
  const dueDate = new Date(Date.now() - 10 * 86_400_000);

  beforeAll(async () => {
    await seedTenant(ID.bizBreak, 'ACCRUAL');
    await db.contact.create({ data: { id: ID.customerBreak, businessId: ID.bizBreak, firstName: 'V15A', lastName: 'Customer', email: `${P}break_customer@test.local` } });
    await db.contact.create({ data: { id: ID.vendorBreak, businessId: ID.bizBreak, firstName: 'V15A', lastName: 'Vendor', email: `${P}break_vendor@test.local` } });
    await db.project.create({ data: { id: ID.projectBreak, businessId: ID.bizBreak, name: 'V15A project' } });
    await db.product.create({ data: { id: ID.productBreak, businessId: ID.bizBreak, name: 'V15A product', price: 10, category: 'PRODUCT' } });
    const ar = await accountId(ID.bizBreak, 'ACCOUNTS_RECEIVABLE');
    const revenue = await accountId(ID.bizBreak, 'REVENUE');
    const expense = await accountId(ID.bizBreak, 'EXPENSE_GENERAL');
    const ap = await accountId(ID.bizBreak, 'ACCOUNTS_PAYABLE');
    const n = Array.from({ length: ROWS }, (_, i) => i);
    // 1001 invoices of one product, each recognised (Dr AR / Cr Revenue) by its own posting.
    await db.invoice.createMany({
      data: n.map((i) => ({
        id: `${P}brk_inv_${i}`,
        invoiceNumber: `V15A-BRK-${i}`,
        status: 'SENT',
        subtotal: 10,
        total: 10,
        currency: 'TTD',
        businessId: ID.bizBreak,
        contactId: ID.customerBreak,
      })),
    });
    await db.invoiceItem.createMany({
      data: n.map((i) => ({ id: `${P}brk_item_${i}`, invoiceId: `${P}brk_inv_${i}`, productId: ID.productBreak, description: 'v15a item', quantity: 1, unitPrice: 10, total: 10 })),
    });
    // 1001 bills of one vendor and one project, each booked (Dr Expense / Cr AP) by its own posting.
    await db.expense.createMany({
      data: n.map((i) => ({
        id: `${P}brk_exp_${i}`,
        description: `v15a bill ${i}`,
        amount: 10,
        currency: 'TTD',
        date,
        vendor: 'V15A Vendor',
        contactId: ID.vendorBreak,
        projectId: ID.projectBreak,
        status: 'BILL',
        dueDate,
        businessId: ID.bizBreak,
      })),
    });
    const txn = (id: string, type: string, sourceType: string, sourceId: string, contactId: string) => ({
      id, businessId: ID.bizBreak, type, status: 'POSTED', date, amount: 10, currency: 'TTD', contactId, sourceType, sourceId,
      description: `v15a break ${sourceId}`,
    });
    await db.financialTransaction.createMany({
      data: [
        ...n.map((i) => txn(`${P}brk_in_${i}`, 'INCOME', 'Invoice', `${P}brk_inv_${i}`, ID.customerBreak)),
        ...n.map((i) => txn(`${P}brk_ex_${i}`, 'EXPENSE', 'Expense', `${P}brk_exp_${i}`, ID.vendorBreak)),
      ],
    });
    const entry = (txId: string, account: string, side: 'debit' | 'credit') => ({
      businessId: ID.bizBreak, transactionId: txId, accountId: account, currency: 'TTD', date, debit: side === 'debit' ? 10 : 0, credit: side === 'credit' ? 10 : 0,
    });
    await db.ledgerEntry.createMany({
      data: [
        ...n.flatMap((i) => [entry(`${P}brk_in_${i}`, ar, 'debit'), entry(`${P}brk_in_${i}`, revenue, 'credit')]),
        ...n.flatMap((i) => [entry(`${P}brk_ex_${i}`, expense, 'debit'), entry(`${P}brk_ex_${i}`, ap, 'credit')]),
      ],
    });
  }, 120_000);

  it('LWD-26 (V1-15c): revenue by customer and by product, and expense by vendor and by project, count all 1001 postings', async () => {
    const to = new Date(Date.now() + 86_400_000);
    expect(await db.ledgerEntry.count({ where: { businessId: ID.bizBreak } })).toBe(ROWS * 4);
    const total = ROWS * 10;
    // At cb50b388 each read was cut at 1000 rows: 10000 and 1000.
    expect(await reporting.getRevenueBy(ID.bizBreak, 'customer', from, to)).toEqual([
      { key: ID.customerBreak, label: 'V15A Customer', total, count: ROWS },
    ]);
    expect(await reporting.getRevenueBy(ID.bizBreak, 'product', from, to)).toEqual([
      { key: ID.productBreak, label: 'V15A product', total, count: ROWS },
    ]);
    expect(await reporting.getExpenseBy(ID.bizBreak, 'vendor', from, to)).toEqual([
      { key: ID.vendorBreak, label: 'V15A Vendor', total, count: ROWS },
    ]);
    expect(await reporting.getExpenseBy(ID.bizBreak, 'project', from, to)).toEqual([
      { key: ID.projectBreak, label: 'V15A project', total, count: ROWS },
    ]);
    // The aggregate readers (a groupBy, no cap) agree.
    const pnl = await reporting.getPnl(ID.bizBreak, from, to, 'accrual');
    expect(pnl.revenue.total).toBe(total);
    await expectBalanced(ID.bizBreak);
  });

  it('LWD-27 (V1-15c): AP aging reads every AP entry and every bill: 1001 open bills age into the 1-30 day bucket in full', async () => {
    const aging = await reporting.getApAging(ID.bizBreak, new Date());
    // At cb50b388: 10000, 1000 bills.
    expect(aging.total).toBe(ROWS * 10);
    expect(aging.buckets.d_1_30).toEqual({ total: ROWS * 10, count: ROWS });
    expect(aging.buckets.current).toEqual({ total: 0, count: 0 });
    expect(aging.vendors).toEqual([
      expect.objectContaining({ key: ID.vendorBreak, label: 'V15A Vendor', total: ROWS * 10, d1to30: ROWS * 10 }),
    ]);
  });
});

describe('M30: real-database trial balance after payment, refund and void', () => {
  const paymentsOf: Record<string, string[]> = {};
  let voidedExpenseId: string;

  beforeAll(async () => {
    const plan: Array<[string, number]> = [
      [ID.invPart, 40],
      [ID.invFull, 100],
      [ID.invRefund, 40],
      [ID.invUsd, 100],
    ];
    for (const [inv, amount] of plan) {
      const res = await pay(ID.bizTB, inv, { amount, method: 'cash', reference: `${P}tb-${inv.slice(P.length)}` });
      expect(res.status, `${inv}: ${JSON.stringify(res.body)}`).toBe(201);
      paymentsOf[inv] = [...(paymentsOf[inv] ?? []), res.body.payment.id];
    }
    const r = await refund(ID.bizTB, paymentsOf[ID.invRefund][0]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    // An expense paid and then voided, plus a bill left open (AP).
    const paid = await expenses.createExpense({ businessId: ID.bizTB, description: `${P}tb paid expense`, amount: 30, currency: 'TTD', paymentMethod: 'cash' });
    voidedExpenseId = paid.id;
    await expenses.voidExpense({ businessId: ID.bizTB, expenseId: paid.id, reason: 'v15a trial balance void' });
    await expenses.createExpense({ businessId: ID.bizTB, description: `${P}tb open bill`, amount: 20, currency: 'TTD', status: 'BILL' });
  });

  it('TB-01: sum(debit) = sum(credit) per currency; every transaction balanced; entry currency = transaction currency', async () => {
    const perCurrency: Array<{ currency: string; debit: string; credit: string; n: number }> = await db.$queryRawUnsafe(
      `SELECT currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit, COUNT(*)::int AS n
         FROM ledger_entries WHERE business_id = $1 GROUP BY currency ORDER BY currency`,
      ID.bizTB,
    );
    expect(perCurrency.map((r) => r.currency)).toEqual(['TTD', 'USD']);
    for (const r of perCurrency) {
      expect(r.n, r.currency).toBeGreaterThan(1);
      expect(Number(r.debit), `${r.currency} debits vs credits`).toBe(Number(r.credit));
    }
    const unbalanced = await db.$queryRawUnsafe(
      `SELECT transaction_id, SUM(debit)::text AS d, SUM(credit)::text AS c FROM ledger_entries
        WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
      ID.bizTB,
    );
    expect(unbalanced).toEqual([]);
    const mixed = await db.$queryRawUnsafe(
      `SELECT le.id FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
        WHERE le.business_id = $1 AND (le.currency <> ft.currency OR le.business_id <> ft.business_id)`,
      ID.bizTB,
    );
    expect(mixed).toEqual([]);

    // The void is in the books as a reversal through the door, and the expense nets to zero.
    const expenseTxns = await db.financialTransaction.findMany({ where: { businessId: ID.bizTB, sourceType: 'Expense', sourceId: voidedExpenseId } });
    expect(expenseTxns.map((t: any) => t.type).sort()).toEqual(['EXPENSE', 'REVERSAL']);
  });

  /** AR net (debit - credit) attributable to one invoice: its recognition and its payments' postings and reversals. */
  async function arNet(invoiceId: string): Promise<number> {
    const ar = await accountId(ID.bizTB, 'ACCOUNTS_RECEIVABLE');
    const pays: string[] = (await db.payment.findMany({ where: { invoiceId }, select: { id: true } })).map((p: any) => p.id);
    const [row] = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(le.debit - le.credit), 0)::text AS net
         FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
        WHERE le.business_id = $1 AND le.account_id = $2
          AND ((ft.source_type = 'Invoice' AND ft.source_id = $3) OR (ft.source_type = 'Payment' AND ft.source_id = ANY($4::text[])))`,
      ID.bizTB,
      ar,
      invoiceId,
      pays,
    );
    return Number(row.net);
  }

  async function remainingOf(invoiceId: string): Promise<number> {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    return computeBalance(Number(inv.total), inv.payments, inv.currency).remaining;
  }

  it('TB-02: accrual AR net equals computeBalance.remaining for every invoice whose payments were not refunded; AR holds nothing unattributed', async () => {
    const expected: Record<string, number> = { [ID.invPart]: 60, [ID.invFull]: 0, [ID.invOpen]: 100, [ID.invUsd]: 150 };
    for (const [inv, value] of Object.entries(expected)) {
      expect(await arNet(inv), `AR of ${inv}`).toBe(value);
      expect(await remainingOf(inv), `computeBalance.remaining of ${inv}`).toBe(value);
    }
    // The refunded invoice: the ledger is right (the reversal restores the receivable).
    const refunded = await db.invoice.findUnique({ where: { id: ID.invRefund }, include: { payments: true } });
    const settled = refunded.payments.filter((p: any) => p.status === 'SUCCESSFUL').reduce((s: number, p: any) => s + p.amount, 0);
    expect(refunded.payments.map((p: any) => p.status)).toEqual(['REFUNDED']);
    expect(await arNet(ID.invRefund)).toBe(Number(refunded.total) - settled);

    // Every AR posting is attributable to one of the invoices above.
    const ar = await accountId(ID.bizTB, 'ACCOUNTS_RECEIVABLE');
    const [total] = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(debit - credit), 0)::text AS net FROM ledger_entries WHERE business_id = $1 AND account_id = $2`,
      ID.bizTB,
      ar,
    );
    let sum = 0;
    for (const inv of TB_INVOICES) sum += await arNet(inv.id);
    expect(Number(total.net)).toBe(sum);
  });

  // M28 (owned by V1-29, invoice-workflow.service.ts is outside this packet's
  // write set): a refund flips the payment row to REFUNDED and computeBalance
  // both drops it from `paid` and subtracts it again as `refunded`, so for the
  // refunded invoice above remaining = 140 while the ledger AR is 100. The
  // ledger side is pinned in TB-02; the equality is owed by V1-29.
  it.todo('TB-03: AR net equals computeBalance.remaining for a refunded invoice (blocked by M28 / V1-29: computeBalance subtracts a REFUNDED payment twice)');
});
