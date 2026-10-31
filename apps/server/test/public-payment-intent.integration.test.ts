/**
 * R0-22-PUBLIC-INTENT-HARDEN — the public payment intent (REAL database).
 *
 * CF-12 (build map, step 6): POST /commerce/invoices/:invoiceId/payment-intent
 * is an anonymous bare-id write. At its base it:
 *
 *   - flipped the invoice to PENDING for bank_transfer / cash
 *     (recordPublicPaymentIntent), and PENDING is not a shareable status, so
 *     the customer's own pay link (GET /commerce/invoices/:id) answered 404
 *     after they confirmed an offline payment, and anyone holding an invoice
 *     id could hide another tenant's SENT invoice;
 *   - wrote one PENDING row per call (no dedupe), keyed
 *     manual_<invoiceId>_<Date.now()>, so two intents in the same millisecond
 *     collided on the Payment.providerPaymentId unique index and answered 500;
 *   - accepted intents on DRAFT and VOID invoices (only PAID was refused, 400);
 *   - silently dropped a negative / non-number amount and stored any positive
 *     amount, however far above the balance.
 *
 * Contract pinned here:
 *
 *   intent on a payable invoice (SENT, OVERDUE, PARTIALLY_PAID)
 *     -> 2xx { success, method, invoiceNumber }; the invoice status is unchanged
 *        and the public projection still answers after a reload
 *   a second intent for the same invoice and method -> the same answer, still one PENDING row;
 *     it writes nothing when it states the same amount, and otherwise updates
 *     that row to what it states (capped at the balance as it is now)
 *   intents in the same millisecond, or a concurrent burst -> never 500
 *   DRAFT, VOID, FAILED, PENDING, soft-deleted -> 404, identical to an unknown id; nothing written
 *   PAID (or nothing left to pay)               -> 409; nothing written
 *   amount above the remaining balance          -> stored as the remaining balance
 *   amount                                      -> stored rounded to cents
 *   no amount (what the pay page sends)         -> stored as 0, as at the base
 *     (open payables, the overdue-invoice scan and the money health score sum
 *     Payment.amount whatever its status; a defaulted balance read as paid)
 *   negative, zero, NaN, non-number or sub-cent amount -> 400; nothing written
 *   LEDGER: no intent changes computeBalance, FinancialTransaction or LedgerEntry
 *   TENANT: the PENDING row carries the invoice's own businessId (Payment table
 *           read directly, M31); no other tenant's invoices or payments change
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), CommerceService,
 * InvoiceWorkflowService and the real ledger chain (RevenuePostingService,
 * PostingService, ChartOfAccountsSeederService) write real rows; the
 * production GlobalHttpExceptionFilter + ValidationPipe are installed. The
 * settled and partly paid fixtures are paid through the real operator route,
 * so the ledger counts the LEDGER case compares are real postings. Identity
 * attachment (for that operator route only) is a test middleware reading
 * `x-k22a-user`; every intent is anonymous. Collaborators off the boundary
 * (contact timeline, stats cache, Gmail / AI / Drive) are stubs.
 *
 * Fixtures: prefix `k22a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { computeBalance } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k22a_';
const HEADER = 'x-k22a-user';

// This suite's public rate-limit keys live under its own namespace, so the
// resets below never touch another suite's windows on the same Redis index.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // tenant A, one invoice per case so balances and rows never bleed between cases
  invSent: `${P}invSent`,
  invCash: `${P}invCash`,
  invOverdue: `${P}invOverdue`,
  invPartialStatus: `${P}invPartialStatus`,
  invDedupe: `${P}invDedupe`,
  invMethods: `${P}invMethods`,
  invSameMs: `${P}invSameMs`,
  invBurst: `${P}invBurst`,
  invDraft: `${P}invDraft`,
  invVoid: `${P}invVoid`,
  invFailed: `${P}invFailed`,
  invPending: `${P}invPending`,
  invDeleted: `${P}invDeleted`,
  invPaid: `${P}invPaid`,
  invCap: `${P}invCap`,
  invNoAmount: `${P}invNoAmount`,
  invUnderCap: `${P}invUnderCap`,
  invBadAmount: `${P}invBadAmount`,
  invBadMethod: `${P}invBadMethod`,
  invLedger: `${P}invLedger`,
  invTenantA: `${P}invTenantA`,
  invConsumers: `${P}invConsumers`,
  invRounding: `${P}invRounding`,
  invRefresh: `${P}invRefresh`,
  // tenant B
  invB: `${P}invB`,
  unknown: `${P}invNoSuchInvoice`,
};

const TOTAL = 100;

/** The one tenant-A invoice that is overdue by date (SENT, due 10 days ago): the status-blind readers see it. */
const OVERDUE_DUE_DATE = new Date(Date.now() - 10 * 86_400_000);

/** Seeded status per invoice (everything else in tenant A is SENT). */
const SEEDED_STATUS: Record<string, string> = {
  [ID.invOverdue]: 'OVERDUE',
  [ID.invDraft]: 'DRAFT',
  [ID.invVoid]: 'VOID',
  [ID.invFailed]: 'FAILED',
  [ID.invPending]: 'PENDING',
};

/** Invoices paid through the real operator route in beforeAll: invoice -> amount. */
const OPERATOR_PAYMENTS: Record<string, number> = {
  [ID.invPaid]: TOTAL,
  [ID.invPartialStatus]: 40,
  [ID.invCap]: 40,
  [ID.invNoAmount]: 40,
  [ID.invLedger]: 30,
};

let db: any;
let app: any;
let redis: any;

async function cleanup() {
  for (const sql of [
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

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

/** An anonymous intent: no identity header, exactly as the public pay page sends it. */
function intent(invoiceId: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/invoices/${invoiceId}/payment-intent`).send(body);
}

function publicInvoice(invoiceId: string) {
  return agent().get(`/commerce/invoices/${invoiceId}`);
}

/** Error bodies differ only in volatile envelope fields; strip those before comparing. */
function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

async function invoiceRow(id: string): Promise<any> {
  // Raw read: the soft-delete extension hides the deleted fixture from findUnique.
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, business_id AS "businessId", deleted_at AS "deletedAt" FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

async function pendingOf(invoiceId: string): Promise<any[]> {
  return (await paymentsOf(invoiceId)).filter((p) => p.status === 'PENDING');
}

async function balanceOf(invoiceId: string) {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId },
    select: { total: true, currency: true, payments: { select: { amount: true, status: true } } },
  });
  return computeBalance(Number(inv.total), inv.payments, inv.currency);
}

async function ledgerCounts(businessId: string) {
  return {
    transactions: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

/** Every invoice and payment row of a tenant, as plain JSON (byte-for-byte comparable). */
async function tenantSnapshot(businessId: string): Promise<string> {
  const invoices = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, total, paid_at AS "paidAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM invoices WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  const payments = await db.$queryRawUnsafe(
    `SELECT id, invoice_id AS "invoiceId", amount, status, provider, method, provider_payment_id AS "providerPaymentId"
       FROM payments WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  return JSON.stringify({ invoices, payments });
}

/** The invoice is exactly as seeded: same status, no PENDING row, the given payment count. */
async function expectNothingWritten(invoiceId: string, status: string, paymentCount = 0) {
  expect((await invoiceRow(invoiceId)).status, `status of ${invoiceId}`).toBe(status);
  expect(await paymentsOf(invoiceId), `payments of ${invoiceId}`).toHaveLength(paymentCount);
}

let unknownBody: Record<string, unknown>;
let ledgerAtStart: { a: { transactions: number; entries: number }; b: { transactions: number; entries: number } };

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
      // Real ledger chain: the operator payments in beforeAll post real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: EventEmitter2,
        useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined, off: () => undefined, once: () => undefined, removeListener: () => undefined },
      },
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

  app = moduleRef.createNestApplication();
  // Identity attachment only (the operator payment route in beforeAll). No guard is overridden.
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

  // ---- two tenants, each with an owner, a contact and a system chart of accounts
  for (const [user, biz, contact, name] of [
    [ID.ownerA, ID.bizA, ID.contactA, 'K22A Biz A'],
    [ID.ownerB, ID.bizB, ID.contactB, 'K22A Biz B'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}${user.slice(P.length)}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_${user}`, userId: user, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'K22a', lastName: 'Customer', email: `${P}${contact.slice(P.length)}@test.local` } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  }

  // ---- invoices -----------------------------------------------------------
  let n = 0;
  const tenantAInvoices = Object.values(ID).filter((v) => v.startsWith(`${P}inv`) && v !== ID.invB && v !== ID.unknown);
  for (const [id, biz, contact] of [
    ...tenantAInvoices.map((id) => [id, ID.bizA, ID.contactA] as const),
    [ID.invB, ID.bizB, ID.contactB] as const,
  ]) {
    n += 1;
    // Payable fixtures that the operator pays below start SENT; the route moves them.
    const status = SEEDED_STATUS[id] ?? 'SENT';
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `K22A-${String(n).padStart(3, '0')}`,
        status,
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: biz,
        contactId: contact,
        ...(id === ID.invDeleted ? { deletedAt: new Date() } : {}),
        ...(id === ID.invConsumers ? { dueDate: OVERDUE_DUE_DATE } : {}),
        items: { create: [{ id: `${id}_item1`, description: `K22A item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }

  // ---- operator payments through the real route (real postings) -----------
  for (const [inv, amount] of Object.entries(OPERATOR_PAYMENTS)) {
    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/payments`)
      .set(HEADER, ID.ownerA)
      .send({ amount, method: 'cash', reference: `${P}slip_${inv}` });
    if (res.status !== 201) throw new Error(`operator payment on ${inv} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  await clearRateLimits();
  const unknown = await intent(ID.unknown, { method: 'bank_transfer' });
  unknownBody = unknown.body;
  ledgerAtStart = { a: await ledgerCounts(ID.bizA), b: await ledgerCounts(ID.bizB) };
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

beforeEach(async () => {
  await clearRateLimits();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows)', () => {
  it('two tenants with a system chart of accounts; payable, unpayable and settled invoices as seeded; the operator payments posted to the ledger', async () => {
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizA, isSystem: true } })).toBeGreaterThan(0);
    expect((await invoiceRow(ID.invSent)).status).toBe('SENT');
    expect((await invoiceRow(ID.invDraft)).status).toBe('DRAFT');
    expect((await invoiceRow(ID.invVoid)).status).toBe('VOID');
    expect((await invoiceRow(ID.invDeleted)).deletedAt).toBeTruthy();
    expect((await invoiceRow(ID.invPaid)).status).toBe('PAID');
    expect((await invoiceRow(ID.invCap)).status).toBe('PARTIALLY_PAID');
    expect((await invoiceRow(ID.invB)).businessId).toBe(ID.bizB);
    expect(await pendingOf(ID.invSent)).toHaveLength(0);
    // Five operator payments, each with a real posting: the LEDGER case is not vacuous.
    expect(ledgerAtStart.a.transactions).toBeGreaterThanOrEqual(Object.keys(OPERATOR_PAYMENTS).length);
    expect(ledgerAtStart.a.entries).toBeGreaterThan(0);
    expect(unknownBody).toMatchObject({ statusCode: 404, message: 'Invoice not found' });
  });
});

describe('CF-12: an intent never changes the invoice status (R0-22)', () => {
  it('PI-01: an anonymous bank_transfer intent on a SENT invoice answers success; the invoice stays SENT and the public projection still answers after reload', async () => {
    const res = await intent(ID.invSent, { method: 'bank_transfer' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toEqual({ success: true, method: 'bank_transfer', invoiceNumber: expect.any(String) });

    expect((await invoiceRow(ID.invSent)).status).toBe('SENT');
    const reload = await publicInvoice(ID.invSent);
    expect(reload.status, JSON.stringify(reload.body)).toBe(200);
    expect(reload.body).toMatchObject({ id: ID.invSent, status: 'SENT', paid: 0, remaining: TOTAL });

    const pending = await pendingOf(ID.invSent);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ method: 'bank_transfer', businessId: ID.bizA, status: 'PENDING' });
  });

  it('PI-02: a cash intent leaves the SENT invoice SENT and shareable', async () => {
    const res = await intent(ID.invCash, { method: 'cash' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect((await invoiceRow(ID.invCash)).status).toBe('SENT');
    expect((await publicInvoice(ID.invCash)).status).toBe(200);
  });

  it('PI-03: OVERDUE and PARTIALLY_PAID invoices accept an intent and keep their status', async () => {
    for (const [inv, status] of [[ID.invOverdue, 'OVERDUE'], [ID.invPartialStatus, 'PARTIALLY_PAID']] as const) {
      const res = await intent(inv, { method: 'bank_transfer' });
      expect([200, 201], `${inv}: ${JSON.stringify(res.body)}`).toContain(res.status);
      expect((await invoiceRow(inv)).status, inv).toBe(status);
      expect((await publicInvoice(inv)).status, inv).toBe(200);
      expect(await pendingOf(inv), inv).toHaveLength(1);
    }
  });
});

describe('dedupe per invoice and method; never 500 (R0-22)', () => {
  it('PI-04: two intents for the same invoice and method create one PENDING row; both answer the same success', async () => {
    const first = await intent(ID.invDedupe, { method: 'bank_transfer' });
    const second = await intent(ID.invDedupe, { method: 'bank_transfer' });
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    expect(second.status, JSON.stringify(second.body)).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await pendingOf(ID.invDedupe)).toHaveLength(1);
    expect((await invoiceRow(ID.invDedupe)).status).toBe('SENT');
  });

  it('PI-05: different methods on the same invoice are separate intents (one PENDING row each)', async () => {
    for (const method of ['bank_transfer', 'cash', 'bank_transfer', 'cash']) {
      const res = await intent(ID.invMethods, { method });
      expect([200, 201], `${method}: ${JSON.stringify(res.body)}`).toContain(res.status);
    }
    const pending = await pendingOf(ID.invMethods);
    expect(pending.map((p) => p.method).sort()).toEqual(['bank_transfer', 'cash']);
  });

  it('PI-06: two intents in the same millisecond never answer 500 (no manual_<id>_<Date.now()> collision)', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const a = await intent(ID.invSameMs, { method: 'bank_transfer' });
    const b = await intent(ID.invSameMs, { method: 'cash' });
    vi.restoreAllMocks();
    expect([200, 201], JSON.stringify(a.body)).toContain(a.status);
    expect([200, 201], JSON.stringify(b.body)).toContain(b.status);
    expect((await pendingOf(ID.invSameMs)).map((p) => p.method).sort()).toEqual(['bank_transfer', 'cash']);
  });

  it('PI-07: a concurrent burst of five same-method intents in one millisecond never answers 500 and leaves exactly one PENDING row', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const results = await Promise.all(Array.from({ length: 5 }, () => intent(ID.invBurst, { method: 'cash' })));
    vi.restoreAllMocks();
    for (const r of results) {
      expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
    }
    expect(await pendingOf(ID.invBurst)).toHaveLength(1);
    expect((await invoiceRow(ID.invBurst)).status).toBe('SENT');
  });
});

describe('payable-state gate (R0-22)', () => {
  it('PI-08: a DRAFT invoice answers 404, identical to an unknown id; nothing is written', async () => {
    const res = await intent(ID.invDraft, { method: 'bank_transfer' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknownBody));
    await expectNothingWritten(ID.invDraft, 'DRAFT');
  });

  it('PI-09: a VOID invoice answers 404, identical to an unknown id; nothing is written', async () => {
    const res = await intent(ID.invVoid, { method: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(stripVolatile(res.body)).toEqual(stripVolatile(unknownBody));
    await expectNothingWritten(ID.invVoid, 'VOID');
  });

  it('PI-10: FAILED, PENDING and soft-deleted invoices answer the same 404; nothing is written', async () => {
    for (const [inv, status] of [[ID.invFailed, 'FAILED'], [ID.invPending, 'PENDING'], [ID.invDeleted, 'SENT']] as const) {
      const res = await intent(inv, { method: 'bank_transfer' });
      expect(res.status, `${inv}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(stripVolatile(res.body), inv).toEqual(stripVolatile(unknownBody));
      await expectNothingWritten(inv, status);
    }
  });

  it('PI-11: a PAID invoice answers 409; no PENDING row, still PAID, its one payment untouched', async () => {
    const res = await intent(ID.invPaid, { method: 'bank_transfer' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409 });
    await expectNothingWritten(ID.invPaid, 'PAID', 1);
  });

  it('PI-12: an unknown method answers 400 before the invoice is read (unchanged)', async () => {
    const res = await intent(ID.invBadMethod, { method: 'wire_to_me' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    await expectNothingWritten(ID.invBadMethod, 'SENT');
  });
});

describe('amount cap and validation (R0-22)', () => {
  it('PI-13: an amount above the remaining balance is stored as the remaining balance (100 total, 40 paid, 500 asked -> 60)', async () => {
    const res = await intent(ID.invCap, { method: 'bank_transfer', amount: 500 });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const pending = await pendingOf(ID.invCap);
    expect(pending).toHaveLength(1);
    expect(pending[0].amount).toBe(60);
    expect((await invoiceRow(ID.invCap)).status).toBe('PARTIALLY_PAID');
  });

  // R0-22 review (CR-R022-1): a no-amount intent used to default to the
  // remaining balance, and status-blind readers then counted it as paid (PI-20).
  it('PI-14: an intent with no amount is stored as 0 (no amount declared, as at the base), and an amount under the balance is kept as given (25)', async () => {
    const none = await intent(ID.invNoAmount, { method: 'cash' });
    expect([200, 201], JSON.stringify(none.body)).toContain(none.status);
    expect((await pendingOf(ID.invNoAmount)).map((p) => p.amount)).toEqual([0]);
    expect((await balanceOf(ID.invNoAmount)).remaining).toBe(60);

    const under = await intent(ID.invUnderCap, { method: 'cash', amount: 25 });
    expect([200, 201], JSON.stringify(under.body)).toContain(under.status);
    expect((await pendingOf(ID.invUnderCap)).map((p) => p.amount)).toEqual([25]);
  });

  it('PI-15: a negative, zero, NaN or non-number amount answers 400; nothing is written', async () => {
    for (const amount of [-5, 0, Number.NaN, 'NaN', '50', null, { value: 5 }]) {
      const res = await intent(ID.invBadAmount, { method: 'bank_transfer', amount });
      expect(res.status, `${String(amount)}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    // NaN reaches the server as JSON null (JSON has no NaN); a hand-written body with a tiny negative is refused too.
    const raw = await agent()
      .post(`/commerce/invoices/${ID.invBadAmount}/payment-intent`)
      .set('Content-Type', 'application/json')
      .send('{"method":"bank_transfer","amount":-0.01}');
    expect(raw.status, JSON.stringify(raw.body)).toBe(400);
    await expectNothingWritten(ID.invBadAmount, 'SENT');
  });
});

describe('LEDGER and TENANT (R0-22)', () => {
  it('PI-16 LEDGER: intents change neither computeBalance nor any FinancialTransaction or LedgerEntry count', async () => {
    const balanceBefore = await balanceOf(ID.invLedger);
    const countsBefore = await ledgerCounts(ID.bizA);
    expect(balanceBefore).toMatchObject({ paid: 30, remaining: 70 });

    for (const body of [{ method: 'bank_transfer' }, { method: 'cash', amount: 20 }, { method: 'bank_transfer' }]) {
      const res = await intent(ID.invLedger, body);
      expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    }
    expect(await pendingOf(ID.invLedger)).toHaveLength(2);
    expect(await balanceOf(ID.invLedger)).toEqual(balanceBefore);
    expect(await ledgerCounts(ID.bizA)).toEqual(countsBefore);
    expect((await invoiceRow(ID.invLedger)).status).toBe('PARTIALLY_PAID');
  });

  it("PI-17 TENANT: an intent on B's invoice writes one PENDING Payment row carrying B's businessId (Payment table, M31); A's invoices and payments are byte-identical", async () => {
    const aBefore = await tenantSnapshot(ID.bizA);
    const res = await intent(ID.invB, { method: 'bank_transfer', amount: 10 });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);

    const rows = await db.payment.findMany({ where: { invoiceId: ID.invB } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.bizB, invoiceId: ID.invB, status: 'PENDING', amount: 10 });
    expect((await invoiceRow(ID.invB)).status).toBe('SENT');
    expect(await tenantSnapshot(ID.bizA)).toBe(aBefore);
  });

  it("PI-18 TENANT: an intent on A's invoice writes A's businessId; B's invoices and payments are byte-identical", async () => {
    const bBefore = await tenantSnapshot(ID.bizB);
    const res = await intent(ID.invTenantA, { method: 'cash' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const rows = await db.payment.findMany({ where: { invoiceId: ID.invTenantA } });
    expect(rows).toHaveLength(1);
    expect(rows[0].businessId).toBe(ID.bizA);
    expect(await tenantSnapshot(ID.bizB)).toBe(bBefore);
  });

  it('PI-19 LEDGER (whole run): every intent above left both tenants\' FinancialTransaction and LedgerEntry counts as they were after seeding', async () => {
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerAtStart.a);
    expect(await ledgerCounts(ID.bizB)).toEqual(ledgerAtStart.b);
  });
});

// Placed after PI-19: PI-22 records an operator part payment (a real posting),
// so it must not run inside the whole-run LEDGER window above. Its intents are
// checked against the ledger counts around them instead.
describe('R0-22 review repairs: status-blind readers, cents and the latest intent per method', () => {
  it('PI-20: a no-amount intent (what the pay page sends) for every method is stored as 0, so open payables, the overdue-invoice scan and the money health score still see the full balance', async () => {
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { PaymentsOpsService } = await import('../src/modules/payments/payments-ops.service');
    const { HealthScoreService } = await import('../src/modules/intelligence/health-score.service');
    const { ScheduledScansService } = await import('../src/modules/intelligence/scheduled-scans.service');
    const prisma = app.get(PrismaService);
    // The three readers on the real PrismaService; only their side channels
    // (gateways, signal and action writers) are stubs.
    const ops = new PaymentsOpsService(prisma, {} as any, {} as any, {} as any, {} as any);
    const health: any = new HealthScoreService(prisma);
    const signals: Array<{ entityId: string; value: number }> = [];
    const scans: any = new ScheduledScansService(
      prisma,
      {} as any,
      { upsertSignal: async (_biz: string, key: any, data: any) => { signals.push({ entityId: key.entityId, value: data.value }); return null; } } as any,
      { bridge: async () => null } as any,
      health,
    );
    const read = async () => {
      signals.length = 0;
      await scans.evaluateRules(ID.bizA);
      return {
        openPayable: (await ops.listOpenPayables(ID.bizA)).payables.find((p: any) => p.id === ID.invConsumers)?.amount,
        overdueReceivables: (await health.calculateMoneyHealth(ID.bizA)).metrics.overdueReceivables,
        overdueSignal: signals.filter((s) => s.entityId === ID.invConsumers).map((s) => s.value),
      };
    };

    const before = await read();
    // invConsumers is tenant A's only SENT invoice with a past due date.
    expect(before).toEqual({ openPayable: TOTAL, overdueReceivables: TOTAL, overdueSignal: [TOTAL] });

    const methods = ['bank_transfer', 'cash', 'check', 'other', 'google_pay'];
    for (const method of methods) {
      const res = await intent(ID.invConsumers, { method });
      expect([200, 201], `${method}: ${JSON.stringify(res.body)}`).toContain(res.status);
    }
    // The readers first (the behaviour), then the stored rows (the cause).
    expect(await read()).toEqual(before);
    const pending = await pendingOf(ID.invConsumers);
    expect(pending.map((p) => p.method).sort()).toEqual([...methods].sort());
    expect(pending.map((p) => p.amount)).toEqual([0, 0, 0, 0, 0]);
    expect((await balanceOf(ID.invConsumers)).remaining).toBe(TOTAL);
    expect((await invoiceRow(ID.invConsumers)).status).toBe('SENT');
  });

  it('PI-21: a sub-cent amount answers 400 and writes nothing; an amount is stored rounded to cents', async () => {
    for (const amount of [1e-9, 0.004]) {
      const res = await intent(ID.invRounding, { method: 'bank_transfer', amount });
      expect(res.status, `${amount}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    await expectNothingWritten(ID.invRounding, 'SENT');

    const res = await intent(ID.invRounding, { method: 'bank_transfer', amount: 25.678 });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect((await pendingOf(ID.invRounding)).map((p) => p.amount)).toEqual([25.68]);
  });

  it('PI-22: a repeat for the same method keeps one row and states the latest intent: an earlier anonymous amount does not stick, an identical repeat writes nothing, and a stale amount is re-capped after an operator part payment', async () => {
    const row = async () => {
      const pending = await pendingOf(ID.invRefresh);
      expect(pending, 'one PENDING row').toHaveLength(1);
      const { id, amount, providerPaymentId, createdAt } = pending[0];
      return { id, amount, providerPaymentId, createdAt: createdAt.toISOString() };
    };
    const ledgerBefore = await ledgerCounts(ID.bizA);

    // An anonymous first writer declares one cent.
    const first = await intent(ID.invRefresh, { method: 'bank_transfer', amount: 0.01 });
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    const seeded = await row();
    expect(seeded.amount).toBe(0.01);

    // The customer's pay page then sends no amount: same answer, same row, and it now states 0.
    const fromPayPage = await intent(ID.invRefresh, { method: 'bank_transfer' });
    expect(fromPayPage.status).toBe(first.status);
    expect(fromPayPage.body).toEqual(first.body);
    expect(await row()).toEqual({ ...seeded, amount: 0 });

    // A declared amount replaces it; the identical repeat writes nothing.
    const declaredRes = await intent(ID.invRefresh, { method: 'bank_transfer', amount: 90 });
    expect(declaredRes.body).toEqual(first.body);
    const declared = await row();
    expect(declared).toEqual({ ...seeded, amount: 90 });
    const repeat = await intent(ID.invRefresh, { method: 'bank_transfer', amount: 90 });
    expect(repeat.body).toEqual(first.body);
    expect(await row()).toEqual(declared);
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerBefore);

    // The operator records 40, so 60 is left; the same intent again is re-capped at 60.
    const paid = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invRefresh}/payments`)
      .set(HEADER, ID.ownerA)
      .send({ amount: 40, method: 'cash', reference: `${P}slip_refresh` });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await balanceOf(ID.invRefresh)).remaining).toBe(60);
    const ledgerAfterPayment = await ledgerCounts(ID.bizA);

    const again = await intent(ID.invRefresh, { method: 'bank_transfer', amount: 90 });
    expect(again.body).toEqual(first.body);
    expect(await row()).toEqual({ ...seeded, amount: 60 });
    expect((await balanceOf(ID.invRefresh)).remaining).toBe(60);
    expect((await invoiceRow(ID.invRefresh)).status).toBe('PARTIALLY_PAID');
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerAfterPayment);
  });
});
