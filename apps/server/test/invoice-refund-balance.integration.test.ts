/**
 * V1-36-DM-BALANCE-READ-CONTRACT — one invoice balance read contract across
 * server and web (REAL database, REAL ledger posting, REAL invoice workflow).
 *
 * CF-17: the paid / refund arithmetic was written out again on every surface
 * that shows money received. V1-29 (D-14) made every refund a separate
 * negative REFUNDED row beside its SUCCESSFUL original and moved the operator
 * reads (listPayments, the tenant-bound invoice read, recordPayment's answer)
 * onto computeBalance. The surfaces that still summed SUCCESSFUL rows alone
 * read a refunded invoice as still paid: the web invoice list ("100% paid"),
 * the stat cards (nothing unpaid) and the payment form (remaining 0, so
 * recording the 40 still owed asked to confirm an over-payment), and the
 * Finance overview / revenue KPIs / revenue report, which counted refunded
 * money as revenue.
 *
 * Contract pinned here (the reading is computeBalance over the stored rows,
 * balanceOfStoredRows; the web reads the same rows through its mirror,
 * packages/shared/src/invoice-balance.ts):
 *
 *   BR-01  SUCCESSFUL 100 (60 + 40) with the 40 refunded on a 100 invoice: listPayments and the
 *          operator invoice read serve paidAmount 60, remaining 40; PARTIALLY_PAID
 *          (regression control: fixed on the server by V1-29, CF-17)
 *   BR-02  recording the 40 still owed is not an over-payment: 201, paidAmount 100, remaining 0,
 *          PAID, nothing over the total (regression control, V1-29)
 *   BR-03  the web's reading of the list row it renders (the shared mirror over inv.payments) is
 *          the server's: net 60, remaining 40, 60% paid; 40 is within the remaining, 40.01 is not.
 *          This proves the mirror over the served rows. The three web files of the V1-36 write set
 *          render on no route (review V36-CR-1, balance-arithmetic.spec.ts BA-07); the live web
 *          surfaces (the invoices hub, the invoice detail page, the finance payment-record modal)
 *          read the mirror since V1-29b-REFUND-READERS (BA-08 and their web unit tests)
 *   BR-09  (V1-29b-REFUND-READERS) every balance reader outside the V1-29 / V1-36 write sets reads
 *          the CF-17 invoice as paid 60, remaining 40, the ledger cash net: the reminder email
 *          (CR-V29-1), the evidence-match candidate (CR-V29-1), CASH-basis receivables (CR-V29-2),
 *          the open payables (V1-22 residual), the public receipt (CR-V29-3), and the web mirror
 *          over the rows the list route (invoices hub) and the detail route (detail page, payment
 *          modal fallback) serve
 *   BR-10  (same) a fully refunded invoice reads paid 0, remaining = the total on every one of
 *          them; the public receipt answers 409 (nothing received net)
 *   BR-04  Finance overview revenueThisMonth subtracts refunds: = the tenant's ledger cash net
 *   BR-05  revenue KPIs collectedThisMonth and the 12-week revenue pulse subtract refunds
 *   BR-06  the collected-vs-expected report subtracts refunds
 *   LEDGER every per-invoice figure equals the ledger cash net of the invoice's payment postings,
 *          every tenant figure the ledger cash net of the tenant's; each transaction balances.
 *          A row flipped to REFUNDED before V1-29 (positive, its posting reversed) counts 0, not
 *          minus its amount. Another tenant's money is never in the figures (Payment is outside
 *          the tenant extension, M31).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows; FinanceOverviewService, RevenueActionService and
 * RevenueReportingService read them through the real PrismaService. The
 * production GlobalHttpExceptionFilter + ValidationPipe are installed.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-v36a-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recording stub; ExpensePostingService (COGS), the contact timeline, the
 * stats cache and the AI / Drive services are stubs off the boundary
 * (RevenueActionService's model gateway is never called by the KPI reads).
 * The Gmail service records every email it is handed and sends nothing (BR-09,
 * BR-10 read the rendered figures); the model extraction of payment evidence is
 * stubbed in BR-09 / BR-10.
 *
 * Fixtures: prefix `v36a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v36a_';
const HEADER = 'x-v36a-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerR: `${P}ownerR`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`, // per-invoice reads
  bizR: `${P}bizR`, // tenant aggregates
  bizB: `${P}bizB`, // another tenant
  contactA: `${P}contactA`,
  contactR: `${P}contactR`,
  contactB: `${P}contactB`,
  invReads: `${P}invReads`,
  invSettle: `${P}invSettle`,
  invFullRefund: `${P}invFullRefund`, // BR-10
  invRRefund: `${P}invRRefund`,
  invRPaid: `${P}invRPaid`,
  invRLegacy: `${P}invRLegacy`,
  invBPaid: `${P}invBPaid`,
};

const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);
/** The web's mirror of the contract (V1-36). Imported by path so this suite reads the tree it runs in. */
const SHARED_BALANCE = path.resolve(__dirname, '../../../packages/shared/src/invoice-balance.ts');

let db: any;
let app: any;
let redis: any;
let prismaSvc: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;
let financeOverview: any;
let revenueActions: any;
let revenueReporting: any;
let revenuePosting: any;
// V1-29b-REFUND-READERS (BR-09, BR-10): the readers outside the V1-29 / V1-36 write sets.
let receipts: any;
let paymentEvidence: any;
let receivables: any;
let paymentsOps: any;

/** The Gmail boundary: every email the readers render is recorded; nothing is sent. */
const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];
const gmailStub = {
  sendEmail: async (args: { businessId: string; to: string; subject: string; htmlBody: string }) => {
    sentEmails.push(args);
    return { messageId: `${P}msg_${sentEmails.length}` };
  },
};

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
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

const OWNER_OF: Record<string, string> = { [ID.bizA]: ID.ownerA, [ID.bizR]: ID.ownerR, [ID.bizB]: ID.ownerB };

function pay(biz: string, inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${inv}/payments`).set(HEADER, OWNER_OF[biz]).send(body);
}

/** A payment through the real HTTP route, asserted 201. */
async function paid(biz: string, inv: string, amount: number, reference: string) {
  const res = await pay(biz, inv, { amount, method: 'cash', reference });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.payment;
}

/** The manual refund through the real HTTP route (D-14: a separate negative REFUNDED row), asserted 201. */
async function refunded(biz: string, paymentId: string) {
  const res = await agent()
    .post(`/commerce/businesses/${biz}/payments/${paymentId}/refund`)
    .set(HEADER, OWNER_OF[biz])
    .send({ reason: 'v36a refund' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function listPayments(biz: string, inv: string) {
  return agent().get(`/commerce/businesses/${biz}/invoices/${inv}/payments`).set(HEADER, OWNER_OF[biz]);
}

function invoiceDetail(biz: string, inv: string) {
  return agent().get(`/commerce/businesses/${biz}/invoices/${inv}`).set(HEADER, OWNER_OF[biz]);
}

function invoiceList(biz: string) {
  return agent().get(`/commerce/businesses/${biz}/invoices`).set(HEADER, OWNER_OF[biz]);
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

async function balanceOf(invoiceId: string) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  return storedBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/**
 * LEDGER: the deposit-side (cash) net of the Payment-sourced transactions of
 * `where` (one invoice's payments, or one tenant's); every one balances.
 */
async function ledgerCashNet(businessId: string, paymentIds?: string[]): Promise<number> {
  const txns = await db.financialTransaction.findMany({
    where: { businessId, sourceType: 'Payment', ...(paymentIds ? { sourceId: { in: paymentIds } } : {}) },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  for (const t of txns) {
    expect(money(sum(t.entries, 'debit')), `${businessId} ${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
  }
  return money(
    txns
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
}

async function invoiceCashNet(invoiceId: string): Promise<number> {
  const inv = await invoiceRow(invoiceId);
  return ledgerCashNet(inv.businessId, (await paymentsOf(invoiceId)).map((r) => r.id));
}

/** The web's mirror (packages/shared/src/invoice-balance.ts), or null while it does not exist. */
async function sharedMirror(): Promise<any | null> {
  if (!existsSync(SHARED_BALANCE)) return null;
  return import(SHARED_BALANCE);
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
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
  const { RevenueReportingService } = await import('../src/modules/commerce/revenue-reporting.service');
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
      // Real ledger chain: the proof is the rows it posts and reverses.
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
      { provide: GmailService, useValue: gmailStub },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  prismaSvc = moduleRef.get(PrismaService);
  revenuePosting = moduleRef.get(RevenuePostingService);
  // The tenant read surfaces over the same real Prisma (no Redis cache, no seeder, no receivables).
  financeOverview = new FinanceOverviewService(prismaSvc, null, null, null);
  revenueActions = new RevenueActionService(prismaSvc, eventStub as any, {} as any, {} as any);
  revenueReporting = new RevenueReportingService(prismaSvc);
  // V1-29b-REFUND-READERS: the module's receipt builder and evidence service, CASH-basis
  // receivables and the open payables over the same real Prisma (no payment gateway is called).
  receipts = moduleRef.get(InvoiceReceiptBuilderService);
  paymentEvidence = moduleRef.get(PaymentEvidenceService);
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { PaymentsOpsService } = await import('../src/modules/payments/payments-ops.service');
  receivables = new ReceivablesService(prismaSvc, moduleRef.get(ChartOfAccountsSeederService));
  paymentsOps = new PaymentsOpsService(prismaSvc, {} as any, {} as any, {} as any, {} as any);

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

  for (const [user, biz, name, contact, tag] of [
    [ID.ownerA, ID.bizA, 'V36A Biz A', ID.contactA, 'a'],
    [ID.ownerR, ID.bizR, 'V36A Biz R', ID.contactR, 'r'],
    [ID.ownerB, ID.bizB, 'V36A Biz B', ID.contactB, 'b'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}owner_${tag}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V36a', lastName: 'Customer', email: `${P}contact_${tag}@test.local` } });
  }

  const invoices: Array<[string, string, string, number]> = [
    [ID.invReads, ID.bizA, ID.contactA, 100],
    [ID.invSettle, ID.bizA, ID.contactA, 100],
    [ID.invFullRefund, ID.bizA, ID.contactA, 100],
    [ID.invRRefund, ID.bizR, ID.contactR, 100],
    [ID.invRPaid, ID.bizR, ID.contactR, 50],
    [ID.invRLegacy, ID.bizR, ID.contactR, 30],
    [ID.invBPaid, ID.bizB, ID.contactB, 70],
  ];
  let n = 0;
  for (const [id, biz, contact, total] of invoices) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V36A-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId: biz,
        contactId: contact,
        items: { create: [{ id: `${id}_item1`, description: `V36A item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }
}, 180_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('per invoice: SUCCESSFUL 100 (60 + 40) with the 40 refunded, on a 100 invoice', () => {
  it('BR-01 (regression control, V1-29): listPayments and the operator invoice read serve paidAmount 60, remaining 40; PARTIALLY_PAID; = the ledger cash net', async () => {
    const inv = ID.invReads;
    await paid(ID.bizA, inv, 60, 'V36A-R-60');
    const forty = await paid(ID.bizA, inv, 40, 'V36A-R-40');
    await refunded(ID.bizA, forty.id);

    const rows = await paymentsOf(inv);
    expect(
      sum(rows.filter((r) => r.status === 'SUCCESSFUL'), 'amount'),
      'the rows: SUCCESSFUL 100 in all',
    ).toBe(100);
    expect(rows.filter((r) => r.status === 'REFUNDED').map((r) => Number(r.amount)), 'and one -40 refund row').toEqual([-40]);
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 40, net: 60, remaining: 40, isFullyPaid: false, isOverpaid: false });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');

    const list = await listPayments(ID.bizA, inv);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body).toMatchObject({ paidAmount: 60, remaining: 40 });
    const detail = await invoiceDetail(ID.bizA, inv);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({ paidAmount: 60, remaining: 40 });
    expect(await invoiceCashNet(inv), 'LEDGER: the invoice cash net').toBe(60);
  });

  it('BR-02 (regression control, V1-29): recording the 40 still owed is not an over-payment: 201, paidAmount 100, remaining 0, PAID; = the ledger cash net', async () => {
    const inv = ID.invSettle;
    await paid(ID.bizA, inv, 60, 'V36A-S-60');
    const forty = await paid(ID.bizA, inv, 40, 'V36A-S-40');
    await refunded(ID.bizA, forty.id);
    expect(await invoiceCashNet(inv)).toBe(60);

    const res = await pay(ID.bizA, inv, { amount: 40, method: 'cash', reference: 'V36A-S-40B' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ paidAmount: 100, remaining: 0 });
    expect(money(res.body.paidAmount - Number(res.body.invoice.total)), 'nothing over the total (the web toasts an over-payment above 0)').toBe(0);
    expect(res.body.invoice.status).toBe('PAID');
    expect(await balanceOf(inv)).toMatchObject({ net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
    expect(await invoiceCashNet(inv), 'LEDGER: the invoice cash net').toBe(100);
  });

  it('BR-03: the web reads the list row it renders through the shared mirror and gets the server figures: net 60, remaining 40, 60% paid; 40 is within the remaining, 40.01 is over it', async () => {
    const inv = ID.invReads;
    const list = await invoiceList(ID.bizA);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = list.body.data.find((i: any) => i.id === inv);
    expect(row, 'the invoice is on the list route the web loads').toBeTruthy();
    const server = (await listPayments(ID.bizA, inv)).body;

    const mirror = await sharedMirror();
    expect(mirror, 'packages/shared/src/invoice-balance.ts (the web mirror of computeBalance) exists').not.toBeNull();
    const web = mirror.invoiceBalanceOfStoredRows(Number(row.total), row.payments, row.currency);
    // RED-BEFORE (V1-34 head): the list, the stat cards and the payment form summed the row's
    // SUCCESSFUL payments: paid 100, remaining 0, "100% paid", recording 40 asked to confirm an over-payment.
    expect({ paidAmount: web.net, remaining: web.remaining }, 'the web figures are the server figures').toEqual({
      paidAmount: server.paidAmount,
      remaining: server.remaining,
    });
    expect(web).toMatchObject({ paid: 100, refunded: 40, net: 60, remaining: 40, isFullyPaid: false, isOverpaid: false });
    expect(mirror.invoicePaidPercent(web)).toBe(60);
    expect(mirror.computeInvoiceBalance(Number(row.total), [...row.payments, { amount: 40, status: 'SUCCESSFUL' }]).isOverpaid, 'recording 40').toBe(false);
    expect(mirror.computeInvoiceBalance(Number(row.total), [...row.payments, { amount: 40.01, status: 'SUCCESSFUL' }]).isOverpaid, 'recording 40.01').toBe(true);
    expect(web.net, 'LEDGER: the invoice cash net').toBe(await invoiceCashNet(inv));
  });

  it('BR-09 (V1-29b-REFUND-READERS): every balance reader outside the V1-29 / V1-36 write sets reads the CF-17 invoice as paid 60, remaining 40, the ledger cash net: reminder email, evidence match, CASH receivables, open payables, public receipt, and the web mirror over the list and detail rows', async () => {
    const inv = ID.invReads; // BR-01 seeded it: 60 + 40 paid, the 40 refunded
    const server = (await listPayments(ID.bizA, inv)).body;
    expect(server).toMatchObject({ paidAmount: 60, remaining: 40 });
    const cashNet = await invoiceCashNet(inv);
    expect(cashNet, 'LEDGER: the invoice cash net').toBe(60);

    const readings = await readersOf(inv, 40);
    // RED-BEFORE (int/trial-I 7f4b81a2): the reminder email Paid 100 with no Balance due line and
    // "TT$0.00 awaiting payment", the evidence candidate remaining 0, receivables paid 100 /
    // outstanding 0 and out of the aging, the public receipt amountPaid 100 (each read the gross).
    expect(readings).toEqual({
      'listPayments': { paid: 60, remaining: 40 },
      'reminder email': { paid: 60, remaining: 40, awaiting: 40 },
      'evidence match': { remaining: 40 },
      'receivables (customer balance)': { paid: 60, remaining: 40 },
      'receivables (aging)': { remaining: 40 },
      'open payables': { remaining: 40 },
      'public receipt': { paid: 60, remaining: 40 },
      'web: list row (invoices hub)': { paid: 60, remaining: 40 },
      'web: detail row (detail page, payment modal)': { paid: 60, remaining: 40 },
    });
    expect(money(100 - cashNet), 'remaining = total - the ledger cash net').toBe(40);
  });

  it('BR-10 (V1-29b-REFUND-READERS): a fully refunded invoice reads paid 0, remaining = the total (100) on every reader; the public receipt answers 409 (nothing received net); = the ledger cash net', async () => {
    const inv = ID.invFullRefund;
    const all = await paid(ID.bizA, inv, 100, 'V36A-F-100');
    await refunded(ID.bizA, all.id);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100 });
    expect(await invoiceCashNet(inv), 'LEDGER: the invoice cash net').toBe(0);

    const readings = await readersOf(inv, 100);
    // RED-BEFORE: the reminder email Paid 100, "TT$0.00 awaiting payment", no Balance due; the
    // evidence candidate and receivables read nothing owed; the invoice dropped out of the aging.
    expect(readings).toEqual({
      'listPayments': { paid: 0, remaining: 100 },
      'reminder email': { paid: null, remaining: 100, awaiting: 100 },
      'evidence match': { remaining: 100 },
      'receivables (customer balance)': { paid: 0, remaining: 100 },
      'receivables (aging)': { remaining: 100 },
      'open payables': { remaining: 100 },
      'public receipt': { status: 409 },
      'web: list row (invoices hub)': { paid: 0, remaining: 100 },
      'web: detail row (detail page, payment modal)': { paid: 0, remaining: 100 },
    });
  });
});

/** A figure an email states ('TT$60.00') as a number; null where the line is absent. */
function emailMoney(html: string, re: RegExp): number | null {
  const m = html.match(re);
  return m ? Number(m[1]) : null;
}

/**
 * BR-09 / BR-10: what each balance reader outside the V1-29 / V1-36 write sets states for one
 * invoice of bizA (contactA), read through its real door. `slip` is the amount the stubbed
 * evidence extraction reads off the customer's slip.
 */
async function readersOf(inv: string, slip: number): Promise<Record<string, Record<string, number | null>>> {
  const out: Record<string, Record<string, number | null>> = {};
  const list = (await listPayments(ID.bizA, inv)).body;
  out['listPayments'] = { paid: list.paidAmount, remaining: list.remaining };

  sentEmails.length = 0;
  const reminder = await agent()
    .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
    .set(HEADER, ID.ownerA)
    .send({ channel: 'email' });
  expect(reminder.status, JSON.stringify(reminder.body)).toBe(201);
  expect(sentEmails, 'one reminder email').toHaveLength(1);
  const html = sentEmails[0].htmlBody;
  out['reminder email'] = {
    paid: emailMoney(html, />Paid<\/td><td[^>]*>TT\$(-?[\d.]+)</),
    remaining: emailMoney(html, />Balance due<\/td><td[^>]*>TT\$(-?[\d.]+)</),
    awaiting: emailMoney(html, /for TT\$(-?[\d.]+) is awaiting payment/),
  };

  vi.spyOn(paymentEvidence, 'extractEvidence').mockResolvedValue({
    extracted: { amount: slip, method: 'bank_transfer', payer: 'V36a Customer' },
    raw: null,
  });
  const evidence = await agent()
    .post(`/commerce/businesses/${ID.bizA}/payments/extract-evidence`)
    .set(HEADER, ID.ownerA)
    .send({ evidenceUrl: 'https://example.invalid/v36a-slip.png', evidenceMimeType: 'image/png', filename: 'v36a-slip.png', source: 'upload' });
  expect(evidence.status, JSON.stringify(evidence.body)).toBe(201);
  const candidate = evidence.body.candidates.find((c: any) => c.id === inv);
  out['evidence match'] = { remaining: candidate ? candidate.remaining : null };

  const customer = await receivables.getCustomerBalance(ID.bizA, ID.contactA);
  expect(customer.basis).toBe('CASH');
  const line = customer.invoices.find((i: any) => i.id === inv);
  out['receivables (customer balance)'] = { paid: line?.paid ?? null, remaining: line?.outstanding ?? null };
  // The aging row of contactA holds every open invoice of the contact: this invoice's share is the
  // row total less the other open invoices' contract remaining.
  const aging = await receivables.getAging(ID.bizA);
  const agingRow = aging.customers.find((c: any) => c.contactId === ID.contactA);
  const others = await db.invoice.findMany({
    where: { businessId: ID.bizA, contactId: ID.contactA, id: { not: inv }, deletedAt: null, status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PENDING'] } },
  });
  let otherRemaining = 0;
  for (const o of others) otherRemaining = money(otherRemaining + (await balanceOf(o.id)).remaining);
  out['receivables (aging)'] = { remaining: money((agingRow?.total ?? 0) - otherRemaining) };

  const { payables } = await paymentsOps.listOpenPayables(ID.bizA);
  const payable = payables.find((p: any) => p.type === 'invoice' && p.id === inv);
  out['open payables'] = { remaining: payable ? payable.amount : null };

  try {
    const receipt = await receipts.buildPublicReceipt(inv, ID.bizA);
    out['public receipt'] = { paid: receipt.amountPaid, remaining: receipt.amountDue };
  } catch (err: any) {
    out['public receipt'] = { status: typeof err?.getStatus === 'function' ? err.getStatus() : -1 };
  }

  const mirror = await sharedMirror();
  expect(mirror, 'packages/shared/src/invoice-balance.ts exists').not.toBeNull();
  const listed = (await invoiceList(ID.bizA)).body.data.find((i: any) => i.id === inv);
  const viaList = mirror.invoiceBalanceOfStoredRows(Number(listed.total), listed.payments, listed.currency);
  out['web: list row (invoices hub)'] = { paid: viaList.net, remaining: viaList.remaining };
  const detail = (await invoiceDetail(ID.bizA, inv)).body;
  const viaDetail = mirror.invoiceBalanceOfStoredRows(Number(detail.total), detail.payments, detail.currency);
  out['web: detail row (detail page, payment modal)'] = { paid: viaDetail.net, remaining: viaDetail.remaining };
  return out;
}

describe('per tenant: the revenue surfaces subtract refunds', () => {
  // bizR: 60 + 40 paid with the 40 refunded (net 60); 50 paid (net 50); 30 paid and flipped to
  // REFUNDED the pre-V1-29 way, its posting reversed (net 0). SUCCESSFUL rows sum to 150; the
  // cash received net of refunds is 110. bizB (another tenant) received 70.
  const NET = 110;
  let ready: Promise<void> | null = null;
  function seedTenant(): Promise<void> {
    ready ??= (async () => {
      await paid(ID.bizR, ID.invRRefund, 60, 'V36A-T-60');
      const forty = await paid(ID.bizR, ID.invRRefund, 40, 'V36A-T-40');
      await refunded(ID.bizR, forty.id);
      await paid(ID.bizR, ID.invRPaid, 50, 'V36A-T-50');
      const legacy = await paid(ID.bizR, ID.invRLegacy, 30, 'V36A-T-30');
      // The pre-V1-29 manual refund, as it wrote it: the row flipped (positive amount kept), its posting reversed once.
      await db.payment.update({ where: { id: legacy.id }, data: { status: 'REFUNDED' } });
      await revenuePosting.onPaymentRefunded(legacy.id, { createdById: ID.ownerR });
      await paid(ID.bizB, ID.invBPaid, 70, 'V36A-T-B70');

      const rows = await db.payment.findMany({ where: { businessId: ID.bizR } });
      expect(sum(rows.filter((r: any) => r.status === 'SUCCESSFUL'), 'amount'), 'bizR: SUCCESSFUL rows').toBe(150);
      expect(await ledgerCashNet(ID.bizR), 'LEDGER: bizR cash net').toBe(NET);
      expect(await ledgerCashNet(ID.bizB), 'LEDGER: bizB cash net').toBe(70);
      for (const inv of [ID.invRRefund, ID.invRPaid, ID.invRLegacy]) {
        expect((await balanceOf(inv)).net, `${inv}: computeBalance net = the invoice cash net`).toBe(await invoiceCashNet(inv));
      }
    })();
    return ready;
  }

  it('BR-04: Finance overview revenueThisMonth = the tenant ledger cash net (110), not the SUCCESSFUL sum (150)', async () => {
    await seedTenant();
    const overview = await financeOverview.getOverview(ID.bizR);
    expect(overview.revenueThisMonth).toBe(NET);
    expect(overview.revenueThisMonth).toBe(await ledgerCashNet(ID.bizR));
  });

  it('BR-05: revenue KPIs collectedThisMonth and the 12-week revenue pulse = the tenant ledger cash net (110)', async () => {
    await seedTenant();
    const kpis = await revenueActions.overviewKpis(ID.bizR);
    expect(kpis.collectedThisMonth).toBe(NET);
    const pulse = await revenueActions.revenuePulse(ID.bizR);
    const weeks: Array<{ collected: number }> = pulse;
    expect(money(weeks.reduce((s, w) => s + w.collected, 0))).toBe(NET);
    expect(weeks[weeks.length - 1].collected, 'all of it this week').toBe(NET);
  });

  it('BR-06: the collected-vs-expected report = the tenant ledger cash net (110)', async () => {
    await seedTenant();
    const report = await revenueReporting.collectedVsExpected(ID.bizR, {
      start: new Date(Date.now() - 86_400_000),
      end: new Date(Date.now() + 60_000),
    });
    expect(report.current.collected).toBe(NET);
    expect(report.current.collected).toBe(await ledgerCashNet(ID.bizR));
  });
});

describe('V1-36 discovery outside the write set (it.todo)', () => {
  it.todo(
    'BR-07 LEDGER: a provider partial refund (the real Stripe refund webhook, refund.created 40 of a 100 PaymentIntent payment) leaves every balance surface at net 60, remaining 40, but the ledger cash net of the invoice at 0: createRefundWithPosting (payments/payments.service.ts) calls RevenuePostingService.onPaymentRefunded (finance/revenue-posting.service.ts), which reverses the WHOLE original posting whatever the refund amount. Observed at the V1-34 head with this suite\'s fixtures; both files are outside the V1-36 write set (a partial refund needs a partial reversing posting)',
  );
  it.todo(
    'BR-08 (review ST-V36-1): one Stripe refund is one negative REFUNDED row. A charge.refunded event without refunds.data (Stripe API 2022-11-15 and later omit Charge.refunds by default) is stored under the synthetic id re_synth_<charge> (payments/payments.service.ts processStripeRefund), and refund.created for the same refund under its real re_ id; the refund dedupe looks at providerPaymentId alone, so both rows land. On a 100 invoice paid by a PaymentIntent (latest_charge ch_x), charge.refunded {amount_refunded 4000, no refunds list} then refund.created {amount 4000, charge ch_x} write SUCCESSFUL 100, REFUNDED -40 (re_synth_ch_x) and REFUNDED -40 (re_x): balanceOfStoredRows reads net 20, remaining 80, and since V1-36 every tenant revenue read over CASH_NET_PAYMENT_WHERE (Finance overview revenueThisMonth, revenue KPIs and pulse, collected-vs-expected) subtracts the refund twice; the right reading is net 60, remaining 40. The read contract is not where the duplicate is made: the fix is at the refund write door (dedupe on charge plus cumulative amount_refunded, or skip the synthetic row when real re_ rows on the charge already cover it), payments.service.ts, outside the V1-36 write set',
  );
});
