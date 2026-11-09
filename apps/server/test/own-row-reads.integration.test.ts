/**
 * DEP-R3-OWN-ROW-READS (D-75) — every invoice read projection and every money
 * decision counts only the invoice's own business's Payment rows (REAL
 * database, REAL ledger posting, REAL invoice workflow).
 *
 * Payment sits outside the tenant extension and has no FK to Business (M31),
 * so a row on A's invoice can carry another businessId. The reconcile, the
 * balance read, mark-paid and the pay-page intent already read the invoice's
 * own-tenant rows (trial-N round 2: RC-DEP-2, F1; ownTenantPayments in
 * invoice-workflow.service.ts). The read projections did not (trial-N repair
 * round 2 deposit recheck, F2 and RC2-DEP-1): with a SUCCESSFUL 25 row tagged
 * for business B on A's SENT 25 invoice, the operator detail read paid 25 /
 * remaining 0, the customer's pay page and the public payment status said
 * nothing was due, and the payments list listed B's row as A's money.
 *
 * D-75 (owner ruling, 2026-11-03): every invoice read projection (operator
 * detail, public page, payments list, payment status) and every money decision
 * counts only the invoice's own business's payment rows.
 *
 * Fixtures (all on business A, SENT unless stated, TTD):
 *   invF    25, no money of A's, a SUCCESSFUL 25 row tagged for B (the finding's repro)
 *   invMix  100, A received 40 (real route, PARTIALLY_PAID), then a SUCCESSFUL 60 row of B
 *   invPaid 50, A received 50 (real route, PAID), then a negative REFUNDED -50 row of B
 *   invRec  25, a SUCCESSFUL 25 row of B; A records 10 through the real route (OR-07)
 *   invCtl  25, no foreign row (pure control)
 *
 * Cases (RED = fails on the unmodified working branch; CONTROL = green there, kept):
 *   OR-01 RED      operator detail (getInvoiceForBusiness): paidAmount/remaining and the served
 *                  rows are A's own; B's row is not served
 *   OR-02 RED      operator bare-id read (getInvoiceWithBusiness, OPERATOR_INVOICE_INCLUDE): the
 *                  served rows are A's own
 *   OR-03 RED      payments list (listPayments): B's row is not listed; paidAmount/remaining own
 *   OR-04 RED      customer pay page (getInvoicePublicView, by token and by bare id): paid/remaining
 *                  from A's own rows, so the invoice B "paid" still shows 25 due
 *   OR-05 RED      public payment status (PaymentsService.invoicePaymentStatus, by token and by
 *                  bare id): paid/remaining/lastPaymentAt from A's own rows
 *   OR-06 CONTROL  the pay-page intent (recordPublicPaymentIntent) decides refuse/cap from A's own
 *                  rows: B's row neither answers 'already paid' nor moves the cap. Already green on
 *                  the working branch (trial-N round 2 F1, 644bb6ad); pinned here as D-75's money
 *                  decision
 *   OR-07 RED      recordPayment and its replay answer the invoice with A's own rows and the
 *                  replay's paidAmount/remaining from them
 *   OR-08 RED      the invoice list row and the invoice timeline carry A's own rows only
 *   OR-09 CONTROL  the reads change nothing: statuses stay what A's own rows state, and the
 *                  invoice with no foreign row reads exactly as before
 *
 * Review repairs (RED on the packet head 6f22f65a):
 *   OR-10 RED      the bare-id operator read (getInvoiceWithBusiness) fails closed on an absent or
 *                  non-string id (SEC-OR-1 / CR-1): readOperatorInvoice moved it from findUnique to
 *                  findFirst, and findFirst({ where: { id: undefined } }) has no filter, so the KEY
 *                  get_invoice command without an invoiceId returned the first invoice in the table
 *                  (any tenant's, outside a tenant context) in the full operator shape
 *   OR-11 RED      B's payments list (listAllPayments, also the KEY get_payment_history) serves B's
 *                  row on A's invoice without A's invoice or A's customer (SEC-OR-2, the M31 row
 *                  from the payment side); the contactId filter matches B's own invoices only.
 *                  B's own invoice invB (30, B's contact) and B's own 30 through the real route
 *                  are the control
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PublicRateLimitGuard (real Redis at REDIS_URL, this suite's
 * own key namespace), CommerceController, PaymentsController, CommerceService,
 * PaymentsService, InvoiceWorkflowService, RevenuePostingService,
 * PostingService and ChartOfAccountsSeederService read and write real rows
 * behind the production GlobalHttpExceptionFilter and ValidationPipe. Identity
 * attachment is the one stand-in: a test middleware reads `x-v87d-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. EventEmitter2 is a no-op stub;
 * COGS, the contact timeline, the stats cache and the AI / Drive / Gmail
 * services are stubs off the boundary. B's rows are written by raw Prisma,
 * because no known writer produces them (the finding's repro).
 *
 * Fixtures: prefix `v87d_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping. Literals in globally
 * unique columns (User.email, Payment.providerPaymentId, PaymentLink.token)
 * embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v87d_';
const HEADER = 'x-v87d-user';

const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`, // the business B the foreign rows are tagged for
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  invB: `${P}invB`, // B's own invoice (OR-10 / OR-11)
  invF: `${P}invF`,
  invMix: `${P}invMix`,
  invPaid: `${P}invPaid`,
  invRec: `${P}invRec`,
  invCtl: `${P}invCtl`,
};

const TOTAL: Record<string, number> = { [ID.invF]: 25, [ID.invMix]: 100, [ID.invPaid]: 50, [ID.invRec]: 25, [ID.invCtl]: 25 };
const TOKEN: Record<string, string> = {};

let db: any;
let app: any;
let redis: any;
/** The real CommerceService instance the app serves (OR-10 calls it outside any request). */
let commerce: any;

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
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
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

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

// ---- the operator (owner of A) ---------------------------------------------

function operatorDetail(inv: string) {
  return agent().get(`/commerce/businesses/${ID.bizA}/invoices/${inv}`).set(HEADER, ID.ownerA);
}

/** The bare-id read with the operator's identity: the full operator shape (getInvoiceWithBusiness). */
function operatorBareRead(inv: string) {
  return agent().get(`/commerce/invoices/${inv}`).set(HEADER, ID.ownerA);
}

function listPayments(inv: string) {
  return agent().get(`/commerce/businesses/${ID.bizA}/invoices/${inv}/payments`).set(HEADER, ID.ownerA);
}

function listInvoices() {
  return agent().get(`/commerce/businesses/${ID.bizA}/invoices?pageSize=100`).set(HEADER, ID.ownerA);
}

function timeline(inv: string) {
  return agent().get(`/commerce/businesses/${ID.bizA}/invoices/${inv}/timeline`).set(HEADER, ID.ownerA);
}

function recordPayment(inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/payments`).set(HEADER, ID.ownerA).send(body);
}

// ---- the customer (anonymous) -----------------------------------------------

function payPage(inv: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(TOKEN[inv])}/pay`);
}

function bareProjection(inv: string) {
  return agent().get(`/commerce/invoices/${inv}`);
}

function tokStatus(inv: string) {
  return agent().get(`/payments/public/invoice-link/${encodeURIComponent(TOKEN[inv])}/status`);
}

function bareStatus(inv: string) {
  return agent().get(`/payments/invoice/${inv}/status`);
}

function intent(inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/public/invoice-link/${encodeURIComponent(TOKEN[inv])}/payment-intent`).send(body);
}

// ---- fixtures ---------------------------------------------------------------

/** A payment of A's own, through the real operator route, asserted 201. */
async function ownPayment(inv: string, amount: number, reference: string) {
  const res = await recordPayment(inv, { amount, method: 'cash', reference });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.payment;
}

/** A row on A's invoice tagged for B (no known writer produces one: the finding's repro). */
async function foreignRow(inv: string, amount: number, status: 'SUCCESSFUL' | 'REFUNDED') {
  return db.payment.create({
    data: {
      id: `${P}foreign_${inv.slice(P.length)}`,
      invoiceId: inv,
      businessId: ID.bizB,
      amount,
      currency: 'TTD',
      status,
      provider: 'cash',
      method: 'cash',
      providerPaymentId: `${P}foreign_${inv.slice(P.length)}`,
      reference: `${P}foreign`,
    },
  });
}

const businessesOf = (rows: Array<{ businessId: string }>) => [...new Set(rows.map((r) => r.businessId))];

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
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
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
      PaymentsService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: A's own payments post real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
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
  commerce = moduleRef.get(CommerceService);

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
  await clearRateLimits();

  for (const [user, biz, name, tag] of [
    [ID.ownerA, ID.bizA, 'V87D Biz A', 'a'],
    [ID.ownerB, ID.bizB, 'V87D Biz B', 'b'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}owner_${tag}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  }
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V87d', lastName: 'Customer', email: `${P}contact_a@test.local` } });

  let n = 0;
  for (const inv of [ID.invF, ID.invMix, ID.invPaid, ID.invRec, ID.invCtl]) {
    n += 1;
    const total = TOTAL[inv];
    await db.invoice.create({
      data: {
        id: inv,
        invoiceNumber: `V87D-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId: ID.bizA,
        contactId: ID.contactA,
        items: { create: [{ id: `${inv}_item1`, description: `V87D item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
    TOKEN[inv] = `${P}tok_${inv.slice(P.length)}_${Math.random().toString(36).slice(2, 10)}`;
    await db.paymentLink.create({ data: { id: `${P}link_${inv.slice(P.length)}`, token: TOKEN[inv], invoiceId: inv, businessId: ID.bizA, active: true } });
  }

  // A's own money, through the real route (ledger posting, reconcile), then B's rows.
  await ownPayment(ID.invMix, 40, 'V87D-MIX-40');
  await ownPayment(ID.invPaid, 50, 'V87D-PAID-50');
  await foreignRow(ID.invF, 25, 'SUCCESSFUL');
  await foreignRow(ID.invMix, 60, 'SUCCESSFUL');
  await foreignRow(ID.invPaid, -50, 'REFUNDED');
  await foreignRow(ID.invRec, 25, 'SUCCESSFUL');

  // B's own invoice and B's own money on it, through the real route as B's owner (OR-10 / OR-11).
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V87d', lastName: 'CustomerB', email: `${P}contact_b@test.local` } });
  await db.invoice.create({
    data: {
      id: ID.invB,
      invoiceNumber: 'V87D-B-001',
      status: 'SENT',
      subtotal: 30,
      total: 30,
      currency: 'TTD',
      businessId: ID.bizB,
      contactId: ID.contactB,
      items: { create: [{ id: `${ID.invB}_item1`, description: 'V87D B item', quantity: 1, unitPrice: 30, total: 30 }] },
    },
  });
  const bOwn = await agent()
    .post(`/commerce/businesses/${ID.bizB}/invoices/${ID.invB}/payments`)
    .set(HEADER, ID.ownerB)
    .send({ amount: 30, method: 'cash', reference: 'V87D-B-30' });
  expect(bOwn.status, JSON.stringify(bOwn.body)).toBe(201);
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

/** What A's own rows state for each fixture invoice (paid = gross received, net = received less refunds). */
const OWN: Record<string, { paid: number; net: number; remaining: number; status: string }> = {
  [ID.invF]: { paid: 0, net: 0, remaining: 25, status: 'SENT' },
  [ID.invMix]: { paid: 40, net: 40, remaining: 60, status: 'PARTIALLY_PAID' },
  [ID.invPaid]: { paid: 50, net: 50, remaining: 0, status: 'PAID' },
  [ID.invCtl]: { paid: 0, net: 0, remaining: 25, status: 'SENT' },
};
const READ_FIXTURES = [ID.invF, ID.invMix, ID.invPaid, ID.invCtl];

describe('the setup: B rows on A invoices are real and the reconcile already ignores them', () => {
  it('each foreign row is stored on its invoice tagged for B; the stored statuses are those of A\'s own rows', async () => {
    for (const inv of [ID.invF, ID.invMix, ID.invPaid, ID.invRec]) {
      const rows = await db.payment.findMany({ where: { invoiceId: inv, businessId: ID.bizB } });
      expect(rows, inv).toHaveLength(1);
    }
    for (const inv of READ_FIXTURES) {
      const row = await db.invoice.findUnique({ where: { id: inv } });
      expect(row.status, inv).toBe(OWN[inv].status);
    }
  });
});

describe('OR-01 operator detail (getInvoiceForBusiness)', () => {
  it('paidAmount and remaining are what A received; B\'s row is not among the served rows', async () => {
    for (const inv of READ_FIXTURES) {
      const res = await operatorDetail(inv);
      expect(res.status, `${inv} ${JSON.stringify(res.body)}`).toBe(200);
      expect({ inv, paidAmount: res.body.paidAmount, remaining: res.body.remaining }).toEqual({
        inv,
        paidAmount: OWN[inv].net,
        remaining: OWN[inv].remaining,
      });
      expect(businessesOf(res.body.payments).filter((b) => b !== ID.bizA), inv).toEqual([]);
    }
  });

  it('the finding\'s repro: A\'s SENT 25 invoice with B\'s SUCCESSFUL 25 reads paidAmount 0, remaining 25, no rows', async () => {
    const res = await operatorDetail(ID.invF);
    expect(res.status).toBe(200);
    expect(res.body.paidAmount).toBe(0);
    expect(res.body.remaining).toBe(25);
    expect(res.body.payments).toEqual([]);
  });
});

describe('OR-02 operator bare-id read (getInvoiceWithBusiness, OPERATOR_INVOICE_INCLUDE)', () => {
  it('the served rows are A\'s own', async () => {
    for (const inv of READ_FIXTURES) {
      const res = await operatorBareRead(inv);
      expect(res.status, `${inv} ${JSON.stringify(res.body)}`).toBe(200);
      expect(Array.isArray(res.body.payments), `${inv}: the operator shape`).toBe(true);
      expect(businessesOf(res.body.payments).filter((b) => b !== ID.bizA), inv).toEqual([]);
    }
  });
});

describe('OR-03 payments list (listPayments)', () => {
  it('lists A\'s rows only; paidAmount and remaining are what A received', async () => {
    for (const inv of READ_FIXTURES) {
      const res = await listPayments(inv);
      expect(res.status, `${inv} ${JSON.stringify(res.body)}`).toBe(200);
      expect(businessesOf(res.body.payments).filter((b) => b !== ID.bizA), inv).toEqual([]);
      expect({ inv, paidAmount: res.body.paidAmount, remaining: res.body.remaining }).toEqual({
        inv,
        paidAmount: OWN[inv].net,
        remaining: OWN[inv].remaining,
      });
    }
    const repro = await listPayments(ID.invF);
    expect(repro.body.payments).toEqual([]);
  });
});

describe('OR-04 the customer pay page (getInvoicePublicView)', () => {
  it('by token and by bare id: paid and remaining from A\'s own rows, so the invoice B "paid" is still due', async () => {
    for (const inv of READ_FIXTURES) {
      for (const [label, call] of [
        ['token', payPage],
        ['bare id', bareProjection],
      ] as const) {
        const res = await call(inv);
        expect(res.status, `${inv} ${label} ${JSON.stringify(res.body)}`).toBe(200);
        expect({ inv, label, paid: res.body.paid, remaining: res.body.remaining }).toEqual({
          inv,
          label,
          paid: OWN[inv].paid,
          remaining: OWN[inv].remaining,
        });
        expect(res.body.payments, `${inv} ${label}: no rows on the public projection`).toBeUndefined();
      }
    }
  });
});

describe('OR-05 the public payment status (PaymentsService.invoicePaymentStatus)', () => {
  it('by token and by bare id: paid, remaining and lastPaymentAt from A\'s own rows', async () => {
    for (const inv of READ_FIXTURES) {
      const own = await db.payment.findMany({ where: { invoiceId: inv, businessId: ID.bizA, status: 'SUCCESSFUL' }, orderBy: { createdAt: 'desc' } });
      const lastOwn = own[0]?.createdAt ? new Date(own[0].createdAt).toISOString() : null;
      for (const [label, call] of [
        ['token', tokStatus],
        ['bare id', bareStatus],
      ] as const) {
        const res = await call(inv);
        expect(res.status, `${inv} ${label} ${JSON.stringify(res.body)}`).toBe(200);
        expect({ inv, label, paid: res.body.paid, remaining: res.body.remaining, lastPaymentAt: res.body.lastPaymentAt }).toEqual({
          inv,
          label,
          paid: OWN[inv].paid,
          remaining: OWN[inv].remaining,
          lastPaymentAt: lastOwn,
        });
      }
    }
  });
});

describe('OR-06 the pay-page intent (recordPublicPaymentIntent) decides from A\'s own rows', () => {
  it('B\'s 25 does not answer "already paid": the intent of 25 is recorded at 25 on A', async () => {
    const res = await intent(ID.invF, { method: 'bank_transfer', amount: 25 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    const rows = await db.payment.findMany({ where: { invoiceId: ID.invF, status: 'PENDING' } });
    expect(rows.map((r: any) => ({ businessId: r.businessId, amount: Number(r.amount) }))).toEqual([{ businessId: ID.bizA, amount: 25 }]);
  });

  it('B\'s 60 does not shrink the cap: an intent of 100 on invMix is capped at the 60 A is owed', async () => {
    const res = await intent(ID.invMix, { method: 'cash', amount: 100 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await db.payment.findMany({ where: { invoiceId: ID.invMix, status: 'PENDING' } });
    expect(rows.map((r: any) => Number(r.amount))).toEqual([60]);
  });

  it('CONTROL: an invoice A\'s own rows settle answers 409 (B\'s refund row does not reopen it)', async () => {
    const res = await intent(ID.invPaid, { method: 'cash', amount: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await db.payment.count({ where: { invoiceId: ID.invPaid, status: 'PENDING' } })).toBe(0);
  });
});

describe('OR-07 recordPayment and its replay answer from A\'s own rows', () => {
  it('a fresh record and its replay: the invoice carries A\'s rows only; paidAmount 10, remaining 15', async () => {
    const body = { amount: 10, method: 'cash', reference: 'V87D-REC-10', idempotencyKey: `${P}rec-key-1` };
    const first = await recordPayment(ID.invRec, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect({ paidAmount: first.body.paidAmount, remaining: first.body.remaining }).toEqual({ paidAmount: 10, remaining: 15 });
    expect(first.body.invoice.status).toBe('PARTIALLY_PAID');
    expect(businessesOf(first.body.invoice.payments)).toEqual([ID.bizA]);

    const replay = await recordPayment(ID.invRec, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect({ paidAmount: replay.body.paidAmount, remaining: replay.body.remaining }).toEqual({ paidAmount: 10, remaining: 15 });
    expect(businessesOf(replay.body.invoice.payments)).toEqual([ID.bizA]);
    expect(await db.payment.count({ where: { invoiceId: ID.invRec, businessId: ID.bizA } })).toBe(1);
  });
});

describe('OR-08 the invoice list row and the invoice timeline', () => {
  it('the list serves each invoice with A\'s own rows only', async () => {
    const res = await listInvoices();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = res.body.data.filter((i: any) => READ_FIXTURES.includes(i.id));
    expect(mine.map((i: any) => i.id).sort()).toEqual([...READ_FIXTURES].sort());
    for (const row of mine) {
      expect(businessesOf(row.payments).filter((b) => b !== ID.bizA), row.id).toEqual([]);
    }
  });

  it('the timeline shows A\'s payments only: none on invF, the one 40 on invMix', async () => {
    const f = await timeline(ID.invF);
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    expect(f.body.entries.filter((e: any) => /^(pay|refund|fail)-/.test(e.id))).toEqual([]);
    const mix = await timeline(ID.invMix);
    expect(mix.status).toBe(200);
    const money = mix.body.entries.filter((e: any) => /^(pay|refund|fail)-/.test(e.id));
    expect(money.map((e: any) => e.data?.amount)).toEqual([40]);
  });
});

describe('OR-09 CONTROL: the foreign rows change nothing', () => {
  it('statuses stay what A\'s own rows state; B\'s rows are untouched', async () => {
    for (const inv of READ_FIXTURES) {
      const row = await db.invoice.findUnique({ where: { id: inv } });
      expect(row.status, inv).toBe(OWN[inv].status);
    }
    expect(await db.payment.count({ where: { invoiceId: { in: [ID.invF, ID.invMix, ID.invPaid, ID.invRec] }, businessId: ID.bizB } })).toBe(4);
  });

  it('the invoice with no foreign row reads exactly as before on every surface', async () => {
    const detail = await operatorDetail(ID.invCtl);
    expect({ paidAmount: detail.body.paidAmount, remaining: detail.body.remaining, payments: detail.body.payments }).toEqual({ paidAmount: 0, remaining: 25, payments: [] });
    const list = await listPayments(ID.invCtl);
    expect({ paidAmount: list.body.paidAmount, remaining: list.body.remaining, payments: list.body.payments }).toEqual({ paidAmount: 0, remaining: 25, payments: [] });
    const page = await payPage(ID.invCtl);
    expect({ paid: page.body.paid, remaining: page.body.remaining }).toEqual({ paid: 0, remaining: 25 });
    const status = await tokStatus(ID.invCtl);
    expect({ paid: status.body.paid, remaining: status.body.remaining, lastPaymentAt: status.body.lastPaymentAt }).toEqual({ paid: 0, remaining: 25, lastPaymentAt: null });
  });
});

describe('OR-10 the bare-id operator read fails closed on an absent id (review SEC-OR-1 / CR-1)', () => {
  const BAD_IDS: unknown[] = [undefined, null, '', { not: `${P}none` }];
  const label = (bad: unknown) => JSON.stringify(bad) ?? 'undefined';

  it('getInvoiceWithBusiness with no id, an empty id or a non-string id reads as absent, outside any tenant context', async () => {
    const { getTenantContext } = await import('../src/core/tenant/tenant-context');
    expect(getTenantContext(), 'no request, no tenant: the event / background-run path').toBeUndefined();
    for (const bad of BAD_IDS) {
      for (const requireShareable of [false, true]) {
        let got: unknown;
        let threw: string | null = null;
        try {
          got = await commerce.getInvoiceWithBusiness(bad, requireShareable);
        } catch (e: any) {
          threw = `${e?.constructor?.name}: ${String(e?.message).slice(0, 80)}`;
        }
        expect({ bad: label(bad), requireShareable, threw, got: (got as any)?.id ?? got }).toEqual({
          bad: label(bad),
          requireShareable,
          threw: null,
          got: null,
        });
      }
    }
  });

  it('getInvoiceForBusiness with no id reads as absent, not as the business\'s first invoice', async () => {
    for (const bad of BAD_IDS) {
      await expect(commerce.getInvoiceForBusiness(bad, ID.bizA), label(bad)).resolves.toBeNull();
    }
  });

  it('the KEY get_invoice command without an invoiceId answers not found, with no tenant and under B\'s tenant', async () => {
    const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
    const { runWithTenant } = await import('../src/core/tenant/tenant-context');
    const { NotFoundException } = await import('@nestjs/common');
    const adapter = new CommerceAdapterService(commerce);
    const command = { module: 'commerce', action: 'get_invoice', parameters: {}, businessId: ID.bizB, userId: ID.ownerB } as any;
    await expect(adapter.execute(command)).rejects.toBeInstanceOf(NotFoundException);
    await expect(runWithTenant(ID.bizB, ID.ownerB, () => adapter.execute(command))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CONTROL: a real id still reads the invoice in the operator shape with A\'s own rows, outside any tenant context', async () => {
    const inv = await commerce.getInvoiceWithBusiness(ID.invMix);
    expect(inv?.id).toBe(ID.invMix);
    expect(inv.contact?.email).toBe(`${P}contact_a@test.local`);
    expect(businessesOf(inv.payments)).toEqual([ID.bizA]);
    const detail = await commerce.getInvoiceForBusiness(ID.invMix, ID.bizA);
    expect({ id: detail?.id, paidAmount: detail?.paidAmount, remaining: detail?.remaining }).toEqual({ id: ID.invMix, paidAmount: 40, remaining: 60 });
  });
});

describe('OR-11 B\'s payments list does not carry A\'s invoice (review SEC-OR-2, listAllPayments)', () => {
  const A_INVOICES = [ID.invF, ID.invMix, ID.invPaid, ID.invRec];
  const bList = (query = '') => agent().get(`/commerce/businesses/${ID.bizB}/payments${query}`).set(HEADER, ID.ownerB);

  it('B\'s row on A\'s invoice is listed as B\'s row, with no invoice: no A invoice number, total or customer', async () => {
    const res = await bList();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const onA = res.body.filter((r: any) => A_INVOICES.includes(r.invoiceId));
    expect(onA.map((r: any) => r.id).sort()).toEqual(A_INVOICES.map((inv) => `${P}foreign_${inv.slice(P.length)}`).sort());
    for (const row of onA) {
      expect({ id: row.id, businessId: row.businessId, invoice: row.invoice }).toEqual({ id: row.id, businessId: ID.bizB, invoice: null });
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(`${P}contact_a@test.local`);
    expect(body).not.toMatch(/V87D-00\d/);
  });

  it('CONTROL: B\'s own row on B\'s own invoice keeps its invoice and customer', async () => {
    const res = await bList();
    expect(res.status).toBe(200);
    const own = res.body.filter((r: any) => r.invoiceId === ID.invB);
    expect(own).toHaveLength(1);
    expect(own[0].invoice).toMatchObject({
      id: ID.invB,
      invoiceNumber: 'V87D-B-001',
      total: 30,
      contact: { id: ID.contactB, firstName: 'V87d', lastName: 'CustomerB', email: `${P}contact_b@test.local` },
    });
  });

  it('the contactId filter matches B\'s own invoices only: A\'s customer finds none of B\'s rows', async () => {
    const byA = await bList(`?contactId=${ID.contactA}`);
    expect(byA.status, JSON.stringify(byA.body)).toBe(200);
    expect(byA.body).toEqual([]);
    const byB = await bList(`?contactId=${ID.contactB}`);
    expect(byB.status).toBe(200);
    expect(byB.body.map((r: any) => r.invoiceId)).toEqual([ID.invB]);
  });

  it('the KEY get_payment_history command serves the same rows: no A invoice on B\'s history', async () => {
    const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
    const adapter = new CommerceAdapterService(commerce);
    const result = await adapter.execute({
      module: 'commerce',
      action: 'get_payment_history',
      parameters: { limit: 500 },
      businessId: ID.bizB,
      userId: ID.ownerB,
    } as any);
    expect(result.success).toBe(true);
    const rows = result.data as any[];
    expect(rows.filter((r) => A_INVOICES.includes(r.invoiceId)).map((r) => r.invoice)).toEqual([null, null, null, null]);
    expect(JSON.stringify(rows)).not.toContain(`${P}contact_a@test.local`);
  });

  it('CONTROL: A\'s list serves A\'s rows only, each with its own invoice and customer', async () => {
    const res = await agent().get(`/commerce/businesses/${ID.bizA}/payments`).set(HEADER, ID.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = res.body.filter((r: any) => typeof r.invoiceId === 'string' && r.invoiceId.startsWith(P));
    expect(mine.length).toBeGreaterThan(0);
    expect(businessesOf(mine)).toEqual([ID.bizA]);
    for (const row of mine) {
      expect({ id: row.id, invoiceId: row.invoice?.id, email: row.invoice?.contact?.email }).toEqual({
        id: row.id,
        invoiceId: row.invoiceId,
        email: `${P}contact_a@test.local`,
      });
    }
  });
});
