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
 *   (todo)  callers that commit their own row before posting, outside one
 *           transaction (review CR-2 FixedAssetService, CR-3 BankRuleService):
 *           outside this packet's write set, see the cases
 *
 *   TB-01   trial balance after payments (two currencies), a refund and an
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
 * ChartOfAccountsSeederService, ExpensesService, ExpensePostingService and
 * PaymentsService (its WiPay / Stripe webhook handlers) write
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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PostingService, PostingInput } from '../src/modules/finance/posting.service';
import type { AccountingPeriodService } from '../src/modules/finance/accounting-period.service';
import type { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';
import type { ExpensesService } from '../src/modules/expenses/expenses.service';
import type { PaymentsService } from '../src/modules/payments/payments.service';

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
let periodLockNamespace = '';
let computeBalance: (total: number, payments: Array<{ amount: unknown; status: string }>, currency?: string) => { remaining: number };

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
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
 * Resolves once some transaction is queued, not granted, on `businessId`'s
 * period lock (ACCOUNTING_PERIOD_LOCK_NAMESPACE, a one-key advisory lock: its
 * low 32 bits are pg_locks.objid). Throws if none queues in time.
 */
async function waitForPeriodLockWaiter(businessId: string, timeoutMs = 10_000): Promise<void> {
  const key = periodLockNamespace + businessId;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND objid::bigint = (hashtext($1)::bigint & 4294967295)`,
      key,
    );
    if (row.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no transaction queued on the period lock of ${businessId} within ${timeoutMs}ms`);
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
  computeBalance = workflowMod.computeBalance as typeof computeBalance;
  periodLockNamespace = PeriodMod.ACCOUNTING_PERIOD_LOCK_NAMESPACE;

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
    let announce!: (id: string) => void;
    const postedId = new Promise<string>((resolve) => { announce = resolve; });
    // The posting passes its period check (OPEN) and stays uncommitted until released.
    const inFlight = db.$transaction(async (tx: any) => {
      const res = await posting.post(input, tx);
      announce(res.transactionId);
      await held;
      return res;
    }, { maxWait: 10_000, timeout: 60_000 });
    try {
      const txnId = await postedId;
      const closing = periods.close(ID.bizA, june.id, { closedById: ID.owner });
      // At a5d73ff6 the close committed here, and the posting then landed inside the CLOSED period unstamped.
      await waitForPeriodLockWaiter(ID.bizA);
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
    await periods.remove(ID.bizPay, next.id);

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
});

describe('review SEC-V15-2: only the owner or an admin opens and shuts the posting door, and every change is audited', () => {
  let financeApp: any;

  function gate(path: string, actor: string | null, body: Record<string, unknown> = {}) {
    const req = request(financeApp.getHttpServer()).post(`/finance/businesses/${ID.bizGate}/accounting-periods${path}`);
    return (actor ? req.set(HEADER, actor) : req).send(body);
  }

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { FinanceController } = await import('../src/modules/finance/finance.controller');
    const PeriodMod = await import('../src/modules/finance/accounting-period.service');
    // FinanceController's other collaborators are off the period routes.
    const offPath = await Promise.all([
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
        PeriodMod.AccountingPeriodService,
        ...offPath.map((token) => ({ provide: token, useValue: {} })),
      ],
    }).compile();
    financeApp = moduleRef.createNestApplication();
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

describe('review CR-2 / CR-3: callers that commit their own row before they post (outside the V1-15 write set)', () => {
  // These callers call post() after writing their own row, outside one transaction,
  // so the door's 409 for a date inside a CLOSED period leaves split state. The fix
  // belongs in each caller (fixed-asset.service.ts, bank-rule.service.ts), which this
  // packet may not edit.
  it.todo('CR-2: FixedAssetService.dispose / runDepreciation dated inside a CLOSED month answer 409 and write nothing (today the FixedAsset row is updated before post(), outside its transaction: the asset is DISPOSED with no disposal posting, or accumulated depreciation runs ahead of the ledger; fix: one transaction in fixed-asset.service.ts)');
  it.todo('CR-3: bank auto-match leaves a rule-matched row dated inside a CLOSED month UNMATCHED and matches the rest (today the 409 escapes BankRuleService.applyRules, which posts per row with no catch, and fails the statement import after ingest; fix: bank-rule.service.ts, which also owns the pre-existing shared externalRef BankRule:<ruleId>:default)');
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
