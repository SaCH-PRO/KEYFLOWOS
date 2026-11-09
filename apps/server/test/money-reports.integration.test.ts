/**
 * V1-81 (FOLLOW3-A7-MONEY-REPORTS) — the money reports read a partial refund,
 * and only a member who may read revenue reads them (REAL database, REAL ledger
 * posting, REAL webhook door, REAL report routes behind the real AuthGuard /
 * BusinessGuard / ModuleScopeGuard).
 *
 * Item 8 (V1-29c deviation and residual). RevenuePostingService.onPaymentRefunded
 * posts a refund that leaves part of a payment as a REFUND transaction sourced by
 * the Payment (no reversalOfId): on an ACCRUAL business Dr AR / Cr cash.
 * LedgerReportingService.computeCashBasisPnl read a Payment-sourced settlement
 * only when `(reversalOfId ? -1 : 1) * cashEffect > 0`, so the partial REFUND
 * (cash out, sign 1) was skipped: the cash-basis P&L kept the whole collection
 * as revenue and the cash-basis cash flow recorded no operating cash out. Only
 * the completed end state netted to zero (provider-refund-door PRD-12).
 *
 * Item 9 (SEC-V37b-1 residual; owner ruling D-57): GET reports/{generate, pnl,
 * cashflow, balance-sheet, tax-summary, ar-aging, revenue-by} (CSV and PDF
 * formats included) and GET commerce revenue-reports/:preset ran AuthGuard and
 * BusinessGuard only, so a member whose revenue scope is none read every figure.
 * They need revenue:read, the gate of the commerce revenue reads and the trial
 * balance. ap-aging and expense-by carry no revenue and are left as they are.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at bb6b86d4):
 *
 *   MR-01 RED-BEFORE ACCRUAL: an invoice of 100 paid 100 (platform-signed Stripe
 *         payment_intent.succeeded), then a platform-signed refund.created of 40 ->
 *         cash-basis revenue +60, operating cash in 100 / out 40, cash-basis net
 *         income = operating cash net (RED-BEFORE: revenue +100, in 100 / out 0)
 *   MR-02 RED-BEFORE the refund.created of the other 60 completes it: revenue 0,
 *         operating cash in 100 / out 100 (PRD-12's end state, unchanged). The
 *         partial refund read in period 1 and its completion in period 2 read
 *         revenue +60 then -60 (cash in 100 / out 40, then in 0 / out 60), and the
 *         two periods add up to the whole
 *   MR-03 control: a CASH-basis business (Dr REVENUE / Cr cash, the direct-income
 *         branch) reads exactly as at bb6b86d4: the partial refund nets (+60, in
 *         100 / out 40) and the completed refund reads revenue 0, in 140 / out 140
 *   MR-04 RED-BEFORE a STAFF member with revenue:none gets 403 ('revenue requires
 *         read access') and no figure from every listed report route, every
 *         format, and every revenue-reports preset, before any read (no service
 *         method is reached) (RED-BEFORE: 200 with the figures). A STAFF member
 *         with revenue:read, a STAFF member on role defaults and the owner read
 *         200 with the same bodies, equal to the services' own answers. The
 *         outsider and the owner of business B get 403 on business A's routes.
 *         Control: ap-aging and expense-by stay as they are (no revenue scope).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService (webhook claims
 * included), PaymentsService, RevenuePostingService, PostingService,
 * ChartOfAccountsSeederService, LedgerBalanceService, ReceivablesService,
 * LedgerReportingService, ReportsService and RevenueReportingService read and
 * write real rows. Identity attachment is the one stand-in: a test middleware
 * reads `x-v81g-user`, loads that seeded user row and attaches
 * `{ id, email, role }` as the Supabase-verifying AuthMiddleware would. Stripe
 * deliveries are signed with the deployment's webhook secret (set for the call
 * and restored) and go through PaymentsService.handleStripeWebhook. The report
 * services are handed to the controllers through recording stand-ins that call
 * the real instance, so a refused route is proven to reach no read. The AI
 * narrative of reports/generate (AiUsageService.callAi) answers a fixed text;
 * EventEmitter2, the contact timeline and the AI / Gmail / Drive services are
 * stubs off the boundary.
 *
 * Fixtures: prefix `v81g_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v81g_';
const HEADER = 'x-v81g-user';
const PLATFORM_SECRET = `whsec_${P}platform`;

const ID = {
  ownerA: `${P}ownerA`,
  ownerP: `${P}ownerP`,
  ownerC: `${P}ownerC`,
  ownerR: `${P}ownerR`,
  ownerB: `${P}ownerB`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffDefault: `${P}staffDefault`,
  outsider: `${P}outsider`,
  bizA: `${P}bizA`, // ACCRUAL: MR-01
  bizP: `${P}bizP`, // ACCRUAL: MR-02
  bizC: `${P}bizC`, // CASH: MR-03
  bizR: `${P}bizR`, // ACCRUAL: MR-04 (the report routes)
  bizB: `${P}bizB`, // another tenant
  contactA: `${P}contactA`,
  contactP: `${P}contactP`,
  contactC: `${P}contactC`,
  contactR: `${P}contactR`,
  contactB: `${P}contactB`,
  invA: `${P}invA`,
  invP: `${P}invP`,
  invC: `${P}invC`,
  invR: `${P}invR`,
  invB: `${P}invB`,
};

const TOTAL = 100;
const REPORT_TOTAL = 250;

let db: any;
let app: any;
let redis: any;
let paymentsSvc: any;
let revenuePostingSvc: any;
let ledgerReporting: any;
let reportsSvc: any;
let revenueReportingSvc: any;

/** Every report service method a route reached, in order (the recording stand-ins). */
const reads: string[] = [];

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

/** With the deployment's own Stripe webhook secret configured (no tenant binding). */
async function withPlatformSecret<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  }
}

/** A Stripe delivery signed with the deployment's webhook secret, as Stripe signs it. */
function stripe(id: string, type: string, object: Record<string, unknown>) {
  return withPlatformSecret(async () => {
    const raw = JSON.stringify({ id: `${P}${id}`, type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac('sha256', PLATFORM_SECRET).update(`${t}.${raw}`).digest('hex')}`;
    return paymentsSvc.handleStripeWebhook(raw, signature);
  });
}

/**
 * A PaymentIntent payment of `amount` (stored as pi_, its charge in reference). It names the
 * invoice's business, as a platform-signed payment event must (R0-20c review SEC-R020C-1).
 */
async function payByIntent(inv: string, n: string, amount: number) {
  const { businessId } = await db.invoice.findUnique({ where: { id: inv }, select: { businessId: true } });
  return stripe(`evt_pi_${n}`, 'payment_intent.succeeded', {
    id: `${P}pi_${n}`, amount_received: amount * 100, currency: 'ttd', latest_charge: `${P}ch_${n}`, metadata: { invoiceId: inv, businessId },
  });
}

/** refund.created: the Refund object itself. */
function refundCreated(evt: string, inv: string, n: string, re: string, amount: number) {
  return stripe(evt, 'refund.created', {
    id: `${P}${re}`, amount: amount * 100, currency: 'ttd', charge: `${P}ch_${n}`, payment_intent: `${P}pi_${n}`, status: 'succeeded', metadata: { invoiceId: inv },
  });
}

async function paymentBy(providerPaymentId: string): Promise<any> {
  return db.payment.findUnique({ where: { providerPaymentId } });
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WINDOW_FROM = () => new Date(Date.now() - 400 * 24 * 3600 * 1000);
const WINDOW_TO = () => new Date(Date.now() + 24 * 3600 * 1000);

/** The cash-basis P&L and cash flow of a business over [from, to]. */
async function cashBasis(businessId: string, from: Date = WINDOW_FROM(), to: Date = WINDOW_TO()) {
  const pnl = await ledgerReporting.getPnl(businessId, from, to, 'cash');
  const flow = await ledgerReporting.getCashflow(businessId, from, to, 'cash');
  return {
    revenue: pnl.revenue.total,
    netProfit: pnl.netProfit,
    cashIn: flow.cashIn,
    cashOut: flow.cashOut,
    netMovement: flow.netMovement,
    cashFromOperations: flow.accrualAdjustments.cashFromOperations,
  };
}

/** A raw body reader for the PDF exports (supertest does not buffer application/pdf). */
function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

/** A thin stand-in over a real service that records each call before forwarding it. */
function recording(name: string, target: any, methods: string[]) {
  return Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => {
    reads.push(`${name}.${m}`);
    return target[m](...args);
  }]));
}

const LEDGER_READS = ['getPnl', 'getCashflow', 'getBalanceSheet', 'getTaxSummary', 'getArAging', 'getApAging', 'getRevenueBy', 'getExpenseBy'];

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
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { RevenueReportingController } = await import('../src/modules/commerce/revenue-reporting.controller');
  const { RevenueReportingService } = await import('../src/modules/commerce/revenue-reporting.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
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
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { ReportsController } = await import('../src/modules/reports/reports.controller');
  const { ReportsService } = await import('../src/modules/reports/reports.service');
  const { LedgerReportingService } = await import('../src/modules/reports/ledger-reporting.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // The commerce and ledger services the webhook door and the reports run on.
  const coreRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      PublicRateLimitGuard,
      PlanLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      ReceivablesService,
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
  const prisma = coreRef.get(PrismaService);
  paymentsSvc = new PaymentsService(prisma, coreRef.get(CommerceService), coreRef.get(InvoiceWorkflowService), coreRef.get(RevenuePostingService));
  revenuePostingSvc = coreRef.get(RevenuePostingService);
  ledgerReporting = new LedgerReportingService(prisma, coreRef.get(LedgerBalanceService), coreRef.get(ReceivablesService));
  reportsSvc = new ReportsService(prisma, { callAi: async () => ({ content: 'v81g narrative' }) } as any, ledgerReporting);
  revenueReportingSvc = new RevenueReportingService(prisma);

  // The report routes: real controllers and guards over recording stand-ins of the real services.
  const reportsRef = await Test.createTestingModule({
    controllers: [ReportsController, RevenueReportingController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: LedgerReportingService, useValue: recording('ledger', ledgerReporting, LEDGER_READS) },
      { provide: ReportsService, useValue: recording('reports', reportsSvc, ['generateReport']) },
      { provide: RevenueReportingService, useValue: recording('revenueReporting', revenueReportingSvc, ['generate']) },
      { provide: AiUsageService, useValue: {} },
    ],
  }).compile();
  app = reportsRef.createNestApplication();
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

  const coa = coreRef.get(ChartOfAccountsSeederService);
  for (const [user, biz, contact, tag, accountingBasis] of [
    [ID.ownerA, ID.bizA, ID.contactA, 'a', 'ACCRUAL'],
    [ID.ownerP, ID.bizP, ID.contactP, 'p', 'ACCRUAL'],
    [ID.ownerC, ID.bizC, ID.contactC, 'c', 'CASH'],
    [ID.ownerR, ID.bizR, ID.contactR, 'r', 'ACCRUAL'],
    [ID.ownerB, ID.bizB, ID.contactB, 'b', 'ACCRUAL'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}owner_${tag}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: biz, name: `V81G Biz ${tag.toUpperCase()}`, ownerId: user, currency: 'TTD', accountingBasis } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V81g', lastName: `Customer ${tag.toUpperCase()}`, email: `${P}c_${tag}@test.local` } });
  }

  // MR-04 actors on business R: STAFF by revenue scope, STAFF on role defaults, and an outsider.
  for (const [user, scopes, tag] of [
    [ID.staffNone, { revenue: 'none', crm: 'write', expenses: 'read' }, 'none'],
    [ID.staffRead, { revenue: 'read', crm: 'write', expenses: 'read' }, 'read'],
    [ID.staffDefault, null, 'default'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}staff_${tag}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${user}_m`, userId: user, businessId: ID.bizR, role: 'STAFF', ...(scopes ? { permissionScopes: scopes } : {}) },
    });
  }
  await db.user.create({ data: { id: ID.outsider, email: `${P}outsider@test.local`, role: 'USER' } });

  let n = 0;
  for (const [id, biz, contact, total] of [
    [ID.invA, ID.bizA, ID.contactA, TOTAL],
    [ID.invP, ID.bizP, ID.contactP, TOTAL],
    [ID.invC, ID.bizC, ID.contactC, TOTAL],
    [ID.invR, ID.bizR, ID.contactR, REPORT_TOTAL],
    [ID.invB, ID.bizB, ID.contactB, TOTAL],
  ] as const) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V81G-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId: biz,
        contactId: contact,
        items: { create: [{ id: `${id}_item1`, description: `V81G item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }

  // Business R's book: an invoice of 250 issued (AR on ACCRUAL) and paid through the webhook door.
  await revenuePostingSvc.onInvoiceFinalized(ID.invR);
  await payByIntent(ID.invR, 'R1', REPORT_TOTAL);
  // Business B's own book, so a foreign read would have figures to show.
  await revenuePostingSvc.onInvoiceFinalized(ID.invB);
  await payByIntent(ID.invB, 'B1', TOTAL);
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit().catch(() => undefined);
}, 60_000);

describe('Item 8: the cash-basis P&L and cash flow of an ACCRUAL business net a partial refund', () => {
  it('MR-01 RED-BEFORE: ACCRUAL pay 100, platform-signed refund.created 40 -> cash-basis revenue +60, operating cash in 100 / out 40, net income = operating cash net', async () => {
    const inv = ID.invA;
    await revenuePostingSvc.onInvoiceFinalized(inv);
    const before = await cashBasis(ID.bizA);
    expect(before).toMatchObject({ revenue: 0, cashIn: 0, cashOut: 0 });

    await payByIntent(inv, 'A1', TOTAL);
    const pi = await paymentBy(`${P}pi_A1`);
    expect(pi).toMatchObject({ businessId: ID.bizA, amount: TOTAL, status: 'SUCCESSFUL' });
    expect(await cashBasis(ID.bizA)).toMatchObject({ revenue: 100, cashIn: 100, cashOut: 0 });

    expect(await refundCreated('evt_re_A1', inv, 'A1', 're_A1', 40)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    expect(await paymentBy(`${P}re_A1`)).toMatchObject({ businessId: ID.bizA, amount: -40, status: 'REFUNDED', reference: `${P}pi_A1` });
    // The partial refund is a REFUND sourced by the payment, the recording stays POSTED.
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);

    const after = await cashBasis(ID.bizA);
    // RED-BEFORE: revenue 100, cash in 100 / out 0 (the REFUND was skipped).
    expect(after.revenue, 'cash-basis revenue after a partial refund of 40').toBe(60);
    expect(after.cashIn).toBe(100);
    expect(after.cashOut, 'the refund is an operating cash outflow').toBe(40);
    expect(after.netMovement).toBe(60);
    expect(after.netProfit, 'cash-basis net income = operating cash net').toBe(after.netMovement);
    expect(after.cashFromOperations).toBe(60);

    // The same figures through the real P&L route (the owner).
    const res = await request(app.getHttpServer())
      .get(`/businesses/${ID.bizA}/reports/pnl`)
      .query({ basis: 'cash', from: WINDOW_FROM().toISOString(), to: WINDOW_TO().toISOString() })
      .set(HEADER, ID.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.revenue.total).toBe(60);
  });

  it('MR-02 RED-BEFORE: refund.created 60 completes it -> revenue 0, cash in 100 / out 100 (PRD-12); per period +60 (in 100 / out 40) then -60 (in 0 / out 60), adding up to the whole', async () => {
    const inv = ID.invP;
    await revenuePostingSvc.onInvoiceFinalized(inv);
    const start = new Date(Date.now() - 60_000);
    await payByIntent(inv, 'P1', TOTAL);
    const pi = await paymentBy(`${P}pi_P1`);
    await refundCreated('evt_re_P1', inv, 'P1', 're_P1', 40);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);

    // Period 1 ends after the partial refund, period 2 starts before the completion.
    await sleep(20);
    const split = new Date();
    await sleep(20);
    await refundCreated('evt_re_P2', inv, 'P1', 're_P2', 60);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:40']);
    const end = new Date(Date.now() + 60_000);

    const whole = await cashBasis(ID.bizP);
    expect(whole.revenue, 'a fully refunded payment reads as nothing received').toBe(0);
    expect(whole.cashIn).toBe(100);
    expect(whole.cashOut).toBe(100);
    expect(whole.netProfit).toBe(whole.netMovement);

    const p1 = await cashBasis(ID.bizP, start, split);
    const p2 = await cashBasis(ID.bizP, new Date(split.getTime() + 1), end);
    // RED-BEFORE: period 1 +100 (in 100 / out 0), period 2 -100 (in 0 / out 100).
    expect([p1.revenue, p1.cashIn, p1.cashOut], 'period 1: paid 100, refunded 40').toEqual([60, 100, 40]);
    expect([p2.revenue, p2.cashIn, p2.cashOut], 'period 2: the refund of the other 60').toEqual([-60, 0, 60]);
    expect(p1.netProfit).toBe(p1.netMovement);
    expect(p2.netProfit).toBe(p2.netMovement);
    expect(money(p1.revenue + p2.revenue)).toBe(whole.revenue);
    expect(money(p1.cashIn + p2.cashIn)).toBe(whole.cashIn);
    expect(money(p1.cashOut + p2.cashOut)).toBe(whole.cashOut);
  });

  it('MR-03 control: a CASH-basis business reads as at bb6b86d4 (direct-income branch): partial refund +60 (in 100 / out 40); completed refund 0 (in 140 / out 140)', async () => {
    const inv = ID.invC;
    await payByIntent(inv, 'C1', TOTAL);
    const pi = await paymentBy(`${P}pi_C1`);
    expect(pi).toMatchObject({ businessId: ID.bizC, amount: TOTAL });
    await refundCreated('evt_re_C1', inv, 'C1', 're_C1', 40);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
    expect(await cashBasis(ID.bizC)).toMatchObject({ revenue: 60, cashIn: 100, cashOut: 40, netMovement: 60, netProfit: 60 });

    await refundCreated('evt_re_C2', inv, 'C1', 're_C2', 60);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REFUND:REVERSED:40', 'REVERSAL:POSTED:100', 'REVERSAL:POSTED:40']);
    // The REVERSAL of the CASH partial refund (Dr cash / Cr REVENUE) is a direct cash income line, as at head.
    expect(await cashBasis(ID.bizC)).toMatchObject({ revenue: 0, cashIn: 140, cashOut: 140, netMovement: 0, netProfit: 0 });
  });
});

describe('Item 9 (D-57): the money report routes need revenue:read', () => {
  const B = () => `/businesses/${ID.bizR}`;
  const range = () => ({ from: WINDOW_FROM().toISOString(), to: WINDOW_TO().toISOString() });
  const asOf = () => ({ asOf: WINDOW_TO().toISOString() });

  /** Every revenue-bearing report route, every format, and what the route reads. */
  const ROUTES = (): Array<{ path: string; query: Record<string, string>; format: 'json' | 'csv' | 'pdf'; reaches: string }> => {
    const out: Array<{ path: string; query: Record<string, string>; format: 'json' | 'csv' | 'pdf'; reaches: string }> = [
      { path: `${B()}/reports/generate`, query: { type: 'executive', startDate: range().from, endDate: range().to }, format: 'json', reaches: 'reports.generateReport' },
      { path: `${B()}/reports/pnl`, query: { ...range(), basis: 'cash' }, format: 'json', reaches: 'ledger.getPnl' },
    ];
    for (const [route, query, reaches] of [
      ['pnl', range(), 'ledger.getPnl'],
      ['cashflow', range(), 'ledger.getCashflow'],
      ['balance-sheet', asOf(), 'ledger.getBalanceSheet'],
      ['tax-summary', range(), 'ledger.getTaxSummary'],
      ['ar-aging', asOf(), 'ledger.getArAging'],
      ['revenue-by', { ...range(), dimension: 'customer' }, 'ledger.getRevenueBy'],
    ] as const) {
      for (const format of ['json', 'csv', 'pdf'] as const) {
        out.push({ path: `${B()}/reports/${route}`, query: format === 'json' ? { ...query } : { ...query, format }, format, reaches });
      }
    }
    return out;
  };

  const PRESETS = [
    'by-source', 'by-contact', 'by-product', 'quote-conversion', 'days-to-pay', 'aging-buckets', 'collected-vs-expected',
    'recurring-expected', 'margin-by-product', 'margin-by-contact', 'revenue-per-hour', 'time-to-pay', 'time-to-close-quote',
  ];
  const presetPath = (preset: string, biz = ID.bizR) => `/commerce/businesses/${biz}/revenue-reports/${preset}`;
  const presetRange = () => ({ startDate: range().from, endDate: range().to });

  function get(pathName: string, query: Record<string, string>, as: string, format: 'json' | 'csv' | 'pdf' = 'json') {
    const req = request(app.getHttpServer()).get(pathName).query(query).set(HEADER, as);
    return format === 'pdf' ? req.buffer(true).parse(binary) : req;
  }

  /**
   * A refusal's body without the filter's request echo (timestamp, path with the
   * query, correlation id), so what is left is what the route said.
   */
  function refusal(res: any, format: 'json' | 'csv' | 'pdf' = 'json'): string {
    const text = format === 'pdf' && Buffer.isBuffer(res.body) ? res.body.toString() : (res.text ?? '');
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { return text; }
    const { timestamp: _t, path: _p, correlationId: _c, ...rest } = parsed;
    return JSON.stringify(rest);
  }

  /** The figures a route shows, comparable across actors (the generated-at stamp and PDF metadata aside). */
  function bodyOf(res: any, format: 'json' | 'csv' | 'pdf') {
    if (format === 'csv') return res.text;
    if (format === 'pdf') return { pdf: Buffer.isBuffer(res.body) && res.body.subarray(0, 4).toString() === '%PDF' };
    const { generatedAt: _generatedAt, ...rest } = res.body ?? {};
    return rest;
  }

  it('MR-04 RED-BEFORE: a STAFF member with revenue:none gets 403 and no figure from every report route (JSON, CSV, PDF) and every revenue-reports preset; no report service is reached', async () => {
    // The owner reads business R's figures (so a refusal below has something to withhold).
    const pnl = await get(`${B()}/reports/pnl`, range(), ID.ownerR);
    expect(pnl.status, JSON.stringify(pnl.body)).toBe(200);
    expect(pnl.body.revenue.total).toBe(REPORT_TOTAL);

    reads.length = 0;
    // Every answer first, so a failure lists every route that leaks, not only the first.
    const observed: string[] = [];
    const expected: string[] = [];
    const answers: Array<{ label: string; shown: string }> = [];
    for (const route of ROUTES()) {
      const res = await get(route.path, route.query, ID.staffNone, route.format);
      const label = `${route.path.replace(B(), '')} ${route.format}${route.query.basis ? ' cash' : ''}`;
      observed.push(`${label} ${res.status}`);
      expected.push(`${label} 403`);
      answers.push({ label, shown: refusal(res, route.format) });
    }
    for (const preset of PRESETS) {
      const res = await get(presetPath(preset), presetRange(), ID.staffNone);
      const label = `revenue-reports/${preset}`;
      observed.push(`${label} ${res.status}`);
      expected.push(`${label} 403`);
      answers.push({ label, shown: refusal(res) });
    }
    // RED-BEFORE: 200 with the figures (revenue 250, AR, cash) on every route, in every format.
    expect(observed, 'revenue:none is refused on every money report').toEqual(expected);
    for (const { label, shown } of answers) {
      expect(shown, `${label} says why`).toMatch(/Insufficient permissions: revenue requires read access \(you have none\)/);
      expect(shown, `${label} returns no figure`).not.toMatch(/250|"revenue":\{|"assets"|"rows"|totalRevenue|%PDF/);
    }
    expect(reads, 'a refused route reaches no report service').toEqual([]);
  });

  it('MR-04: a revenue:read STAFF member, a STAFF member on role defaults and the owner read 200 with the same bodies, equal to the services\' own answers', async () => {
    for (const route of ROUTES()) {
      const bodies: unknown[] = [];
      for (const as of [ID.ownerR, ID.staffRead, ID.staffDefault]) {
        reads.length = 0;
        const res = await get(route.path, route.query, as, route.format);
        expect(res.status, `${as} GET ${route.path} ${JSON.stringify(route.query)}: ${(res.text ?? '').slice(0, 300)}`).toBe(200);
        expect(reads, `${route.path} reads through ${route.reaches}`).toEqual([route.reaches]);
        if (route.format === 'csv') expect(res.headers['content-type']).toMatch(/^text\/csv/);
        if (route.format === 'pdf') expect(res.headers['content-type']).toBe('application/pdf');
        bodies.push(bodyOf(res, route.format));
      }
      expect(bodies[1], `${route.path} (${route.format}): revenue:read reads what the owner reads`).toEqual(bodies[0]);
      expect(bodies[2], `${route.path} (${route.format}): role defaults read what the owner reads`).toEqual(bodies[0]);
      if (route.format === 'pdf') expect(bodies[0]).toEqual({ pdf: true });
    }

    // The JSON bodies are the services' own answers.
    const from = new Date(range().from);
    const to = new Date(range().to);
    const json = (v: unknown) => JSON.parse(JSON.stringify(v));
    const pnl = await get(`${B()}/reports/pnl`, range(), ID.staffRead);
    expect(pnl.body).toEqual(json(await ledgerReporting.getPnl(ID.bizR, from, to, 'accrual')));
    expect(pnl.body.revenue.total).toBe(REPORT_TOTAL);
    const sheet = await get(`${B()}/reports/balance-sheet`, { asOf: to.toISOString() }, ID.staffRead);
    expect(sheet.body).toEqual(json(await ledgerReporting.getBalanceSheet(ID.bizR, to)));
    const byContact = await get(presetPath('by-contact'), presetRange(), ID.staffRead);
    expect(byContact.status, JSON.stringify(byContact.body)).toBe(200);
    expect(byContact.body).toEqual(json(await revenueReportingSvc.generate(ID.bizR, 'by-contact', { start: from, end: to })));
    expect(byContact.body.totalRevenue).toBe(REPORT_TOTAL);
    for (const as of [ID.ownerR, ID.staffDefault]) {
      const res = await get(presetPath('by-contact'), presetRange(), as);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(byContact.body);
    }
  });

  it('MR-04: the outsider and the owner of business B get 403 on business R\'s report routes and revenue reports; no report service is reached', async () => {
    reads.length = 0;
    for (const as of [ID.outsider, ID.ownerB]) {
      for (const route of ROUTES().filter((r) => r.format !== 'pdf')) {
        const res = await get(route.path, route.query, as, route.format);
        expect(res.status, `${as} GET ${route.path}: ${refusal(res, route.format).slice(0, 300)}`).toBe(403);
        expect(refusal(res, route.format)).not.toMatch(/250|"revenue":\{/);
      }
      const preset = await get(presetPath('by-contact'), presetRange(), as);
      expect(preset.status).toBe(403);
      expect(refusal(preset)).not.toMatch(/250|"rows"/);
    }
    expect(reads).toEqual([]);
    // Control: business B's owner reads business B's own reports.
    const own = await get(`/businesses/${ID.bizB}/reports/pnl`, range(), ID.ownerB);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.revenue.total).toBe(TOTAL);
  });

  it('MR-04 control (scope ruling): ap-aging and expense-by carry no revenue and are left as they are', async () => {
    for (const [route, query] of [
      ['ap-aging', asOf()],
      ['expense-by', { ...range(), dimension: 'vendor' }],
    ] as const) {
      const res = await get(`${B()}/reports/${route}`, { ...query }, ID.staffNone);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });
});
