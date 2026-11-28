/**
 * FU-LIST-CREDIT-AWARE-REMAINING (server half, P2 launch-track, Journey H) —
 * Invoice list rows and invoice detail both serve credit-aware `remaining`,
 * `paidAmount`, and `creditedAmount` (`total - net payments - APPLIED own-tenant
 * credit notes`, clamped to 0 for VOID and FULLY_CREDITED), matching the
 * server's `readInvoiceMoney` / D-256 contract so web owed figures can count
 * PARTIALLY_CREDITED accurately.
 *
 * Real Postgres, real CommerceController + CommerceService, real AuthGuard /
 * BusinessGuard / ModuleScopeGuard / TenantInterceptor / ValidationPipe /
 * GlobalHttpExceptionFilter.
 *
 * Contract pinned here:
 *   ILR-01  500 invoice PARTIALLY_CREDITED by 100 serves remaining=400,
 *           paidAmount=0, creditedAmount=100 on BOTH GET .../invoices (list)
 *           and GET .../invoices/:id (detail).
 *   ILR-02  PARTIALLY_CREDITED with payment + refund + multiple APPLIED credits
 *           + DRAFT/ISSUED/VOID credits ignored + fully-settled PARTIALLY_CREDITED
 *           (remaining=0) + sub-cent precision (100 - 3*33.33 = 0.01).
 *   ILR-03  Standard status clamps: SENT, PARTIALLY_PAID, PAID, VOID (remaining=0),
 *           FULLY_CREDITED (remaining=0), DRAFT — list row matches detail exactly.
 *   ILR-04  Cross-tenant isolation: foreign-tenant APPLIED credit note and
 *           foreign-tenant SUCCESSFUL payment on bizA's invoice are excluded
 *           from both list and detail; ?contactId filter works; unauthorized
 *           caller refused 403.
 *   ILR-05  Batched credit-note query: a page with multiple PARTIALLY_CREDITED
 *           invoices executes at most one creditNote.groupBy call, and a page
 *           with no credited-status invoices executes zero creditNote queries.
 *
 * Fixtures: prefix `v92t_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92t_';
const HEADER = 'x-v92t-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  staffNone: `${P}staffNone`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA1: `${P}contactA1`,
  contactA2: `${P}contactA2`,
  contactB: `${P}contactB`,
};

let db: any;
let app: any;
let redis: any;
let prismaService: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function agent() {
  return request(app.getHttpServer());
}

let seq = 0;
async function seedInvoice(opts: {
  biz?: string;
  contact?: string;
  status: string;
  total: number;
  currency?: string;
}) {
  seq += 1;
  const biz = opts.biz ?? ID.bizA;
  const contact = opts.contact ?? ID.contactA1;
  const id = `${P}inv_${seq}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `${P}INV-${seq}`,
      status: opts.status,
      subtotal: opts.total,
      total: opts.total,
      currency: opts.currency ?? 'TTD',
      businessId: biz,
      contactId: contact,
      sentAt: opts.status === 'DRAFT' ? null : new Date(),
      paidAt: opts.status === 'PAID' ? new Date() : null,
    },
  });
  return id;
}

async function seedPayment(opts: {
  biz?: string;
  invoiceId: string;
  amount: number;
  status: 'SUCCESSFUL' | 'REFUNDED' | 'FAILED' | 'PENDING';
  currency?: string;
}) {
  seq += 1;
  await db.payment.create({
    data: {
      id: `${P}pay_${seq}`,
      businessId: opts.biz ?? ID.bizA,
      invoiceId: opts.invoiceId,
      amount: opts.amount,
      currency: opts.currency ?? 'TTD',
      status: opts.status,
      method: 'MANUAL',
      provider: 'MANUAL',
      providerPaymentId: `${P}pp_${seq}`,
    },
  });
}

async function seedCreditNote(opts: {
  biz?: string;
  invoiceId: string;
  amount: number;
  status: 'DRAFT' | 'ISSUED' | 'APPLIED' | 'VOID';
}) {
  seq += 1;
  await db.creditNote.create({
    data: {
      id: `${P}cn_${seq}`,
      businessId: opts.biz ?? ID.bizA,
      invoiceId: opts.invoiceId,
      creditNoteNumber: `${P}CN-${seq}`,
      status: opts.status,
      amount: opts.amount,
      appliedAt: opts.status === 'APPLIED' ? new Date() : null,
      voidedAt: opts.status === 'VOID' ? new Date() : null,
    },
  });
}

async function clearInvoicesOnly() {
  for (const sql of [
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
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
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

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
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [] } },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
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

  prismaService = moduleRef.get(PrismaService);
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
  app.useGlobalInterceptors(new TenantInterceptor(prismaService));
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' },
      { id: ID.staffNone, email: `${P}staff_none@test.local`, role: 'USER' },
    ],
  });
  await db.business.createMany({
    data: [
      { id: ID.bizA, name: `${P}Biz A`, slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: `${P}Biz B`, slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });
  await db.membership.createMany({
    data: [
      { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
      {
        id: `${P}m_staff`,
        userId: ID.staffNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'none' },
      },
    ],
  });
  await db.contact.createMany({
    data: [
      { id: ID.contactA1, businessId: ID.bizA, firstName: 'A1', lastName: 'Client', email: `${P}c_a1@test.local` },
      { id: ID.contactA2, businessId: ID.bizA, firstName: 'A2', lastName: 'Client', email: `${P}c_a2@test.local` },
      { id: ID.contactB, businessId: ID.bizB, firstName: 'B1', lastName: 'Client', email: `${P}c_b1@test.local` },
    ],
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearInvoicesOnly();
});

describe('FU-LIST-CREDIT-AWARE-REMAINING (server half)', () => {
  it('ILR-01: 500 invoice PARTIALLY_CREDITED by 100 serves remaining=400, paidAmount=0, creditedAmount=100 on list and detail', async () => {
    const invId = await seedInvoice({ status: 'PARTIALLY_CREDITED', total: 500 });
    await seedCreditNote({ invoiceId: invId, amount: 100, status: 'APPLIED' });

    const listRes = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerA);
    expect(listRes.status).toBe(200);
    const listRow = listRes.body.data.find((r: any) => r.id === invId);
    expect(listRow).toBeDefined();
    expect(listRow.remaining).toBe(400);
    expect(listRow.paidAmount).toBe(0);
    expect(listRow.creditedAmount).toBe(100);

    const detailRes = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${invId}`).set(HEADER, ID.ownerA);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.remaining).toBe(400);
    expect(detailRes.body.paidAmount).toBe(0);
    expect(detailRes.body.creditedAmount).toBe(100);
  });

  it('ILR-02: nets payments, refunds, multiple APPLIED credits (ignoring DRAFT/ISSUED/VOID), settles to 0, and preserves cent precision', async () => {
    // 500 - (200 - 50) - (60 + 40) = 250; DRAFT(75), ISSUED(30), VOID(50) ignored
    const invMix = await seedInvoice({ status: 'PARTIALLY_CREDITED', total: 500 });
    await seedPayment({ invoiceId: invMix, amount: 200, status: 'SUCCESSFUL' });
    await seedPayment({ invoiceId: invMix, amount: -50, status: 'REFUNDED' });
    await seedPayment({ invoiceId: invMix, amount: 99, status: 'FAILED' });
    await seedCreditNote({ invoiceId: invMix, amount: 60, status: 'APPLIED' });
    await seedCreditNote({ invoiceId: invMix, amount: 40, status: 'APPLIED' });
    await seedCreditNote({ invoiceId: invMix, amount: 75, status: 'DRAFT' });
    await seedCreditNote({ invoiceId: invMix, amount: 30, status: 'ISSUED' });
    await seedCreditNote({ invoiceId: invMix, amount: 50, status: 'VOID' });

    // Fully settled PARTIALLY_CREDITED (500 total, 100 credit, 400 paid => remaining 0)
    const invSettled = await seedInvoice({ status: 'PARTIALLY_CREDITED', total: 500 });
    await seedCreditNote({ invoiceId: invSettled, amount: 100, status: 'APPLIED' });
    await seedPayment({ invoiceId: invSettled, amount: 400, status: 'SUCCESSFUL' });

    // Cent-exact precision: 100 - 3*33.33 = 0.01
    const invCents = await seedInvoice({ status: 'PARTIALLY_PAID', total: 100 });
    await seedPayment({ invoiceId: invCents, amount: 33.33, status: 'SUCCESSFUL' });
    await seedPayment({ invoiceId: invCents, amount: 33.33, status: 'SUCCESSFUL' });
    await seedPayment({ invoiceId: invCents, amount: 33.33, status: 'SUCCESSFUL' });

    const listRes = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerA);
    expect(listRes.status).toBe(200);
    const byId = new Map<string, any>(listRes.body.data.map((r: any) => [r.id, r]));

    expect(byId.get(invMix)).toMatchObject({ paidAmount: 150, creditedAmount: 100, remaining: 250 });
    expect(byId.get(invSettled)).toMatchObject({ paidAmount: 400, creditedAmount: 100, remaining: 0 });
    expect(byId.get(invCents)).toMatchObject({ paidAmount: 99.99, creditedAmount: 0, remaining: 0.01 });

    // Detail agrees identically on all three
    for (const [id, expected] of [
      [invMix, { paidAmount: 150, creditedAmount: 100, remaining: 250 }],
      [invSettled, { paidAmount: 400, creditedAmount: 100, remaining: 0 }],
      [invCents, { paidAmount: 99.99, creditedAmount: 0, remaining: 0.01 }],
    ] as const) {
      const det = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${id}`).set(HEADER, ID.ownerA);
      expect(det.status).toBe(200);
      expect(det.body).toMatchObject(expected);
    }
  });

  it('ILR-03: list and detail agree on SENT, PARTIALLY_PAID, PAID, VOID (clamped 0), FULLY_CREDITED (clamped 0), and DRAFT', async () => {
    const invSent = await seedInvoice({ status: 'SENT', total: 300 });
    const invPart = await seedInvoice({ status: 'PARTIALLY_PAID', total: 500 });
    await seedPayment({ invoiceId: invPart, amount: 120, status: 'SUCCESSFUL' });
    const invPaid = await seedInvoice({ status: 'PAID', total: 200 });
    await seedPayment({ invoiceId: invPaid, amount: 200, status: 'SUCCESSFUL' });
    const invVoid = await seedInvoice({ status: 'VOID', total: 400 });
    const invFullCred = await seedInvoice({ status: 'FULLY_CREDITED', total: 500 });
    await seedCreditNote({ invoiceId: invFullCred, amount: 500, status: 'APPLIED' });
    const invDraft = await seedInvoice({ status: 'DRAFT', total: 150 });

    const listRes = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerA);
    expect(listRes.status).toBe(200);
    const byId = new Map<string, any>(listRes.body.data.map((r: any) => [r.id, r]));

    const expected: Array<[string, { paidAmount: number; creditedAmount: number; remaining: number }]> = [
      [invSent, { paidAmount: 0, creditedAmount: 0, remaining: 300 }],
      [invPart, { paidAmount: 120, creditedAmount: 0, remaining: 380 }],
      [invPaid, { paidAmount: 200, creditedAmount: 0, remaining: 0 }],
      [invVoid, { paidAmount: 0, creditedAmount: 0, remaining: 0 }],
      [invFullCred, { paidAmount: 0, creditedAmount: 500, remaining: 0 }],
      [invDraft, { paidAmount: 0, creditedAmount: 0, remaining: 150 }],
    ];

    for (const [id, want] of expected) {
      expect(byId.get(id)).toMatchObject(want);
      const det = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${id}`).set(HEADER, ID.ownerA);
      expect(det.status).toBe(200);
      expect(det.body).toMatchObject(want);
    }
  });

  it('ILR-04: excludes cross-tenant credit notes and payments, honors ?contactId, and enforces revenue:read', async () => {
    const invA1 = await seedInvoice({ biz: ID.bizA, contact: ID.contactA1, status: 'PARTIALLY_CREDITED', total: 500 });
    const invA2 = await seedInvoice({ biz: ID.bizA, contact: ID.contactA2, status: 'SENT', total: 250 });
    // Own-tenant credit of 100
    await seedCreditNote({ biz: ID.bizA, invoiceId: invA1, amount: 100, status: 'APPLIED' });
    // Cross-tenant (bizB) credit note & payment attached to bizA's invoice — must be ignored!
    await seedCreditNote({ biz: ID.bizB, invoiceId: invA1, amount: 250, status: 'APPLIED' });
    await seedPayment({ biz: ID.bizB, invoiceId: invA1, amount: 150, status: 'SUCCESSFUL' });

    const listRes = await agent()
      .get(`/commerce/businesses/${ID.bizA}/invoices?contactId=${ID.contactA1}`)
      .set(HEADER, ID.ownerA);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.map((r: any) => r.id)).toEqual([invA1]);
    expect(listRes.body.data[0]).toMatchObject({ paidAmount: 0, creditedAmount: 100, remaining: 400 });

    const detRes = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${invA1}`).set(HEADER, ID.ownerA);
    expect(detRes.status).toBe(200);
    expect(detRes.body).toMatchObject({ paidAmount: 0, creditedAmount: 100, remaining: 400 });

    // Confirm invA2 still exists under unfiltered list
    const allRes = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerA);
    expect(allRes.body.data.map((r: any) => r.id)).toContain(invA2);

    // Scope & cross-tenant refusals
    const noScope = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.staffNone);
    expect(noScope.status).toBe(403);
    const crossBiz = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerB);
    expect(crossBiz.status).toBe(403);
  });

  it('ILR-05: batches credit-note sums into one query for credited pages and zero queries for non-credited pages', async () => {
    const inv1 = await seedInvoice({ status: 'PARTIALLY_CREDITED', total: 500 });
    const inv2 = await seedInvoice({ status: 'PARTIALLY_CREDITED', total: 300 });
    const inv3 = await seedInvoice({ status: 'FULLY_CREDITED', total: 200 });
    await seedCreditNote({ invoiceId: inv1, amount: 100, status: 'APPLIED' });
    await seedCreditNote({ invoiceId: inv2, amount: 50, status: 'APPLIED' });
    await seedCreditNote({ invoiceId: inv3, amount: 200, status: 'APPLIED' });

    let groupByCalls = 0;
    const origGroupBy = prismaService.client.creditNote.groupBy.bind(prismaService.client.creditNote);
    const origAggregate = prismaService.client.creditNote.aggregate.bind(prismaService.client.creditNote);
    let aggregateCalls = 0;
    const origCreditNote = prismaService.client.creditNote;
    const wrappedCreditNote = new Proxy(origCreditNote, {
      get(target, prop, receiver) {
        if (prop === 'groupBy') {
          return (...args: any[]) => {
            groupByCalls += 1;
            return origGroupBy(...args);
          };
        }
        if (prop === 'aggregate') {
          return (...args: any[]) => {
            aggregateCalls += 1;
            return origAggregate(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const clientProxy = new Proxy(prismaService.client, {
      get(target, prop, receiver) {
        if (prop === 'creditNote') return wrappedCreditNote;
        return Reflect.get(target, prop, receiver);
      },
    });
    vi.spyOn(prismaService, 'client', 'get').mockReturnValue(clientProxy);

    const resCredited = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerA);
    expect(resCredited.status).toBe(200);
    expect(groupByCalls).toBe(1);
    expect(aggregateCalls).toBe(0);

    // Now clear and seed only SENT invoices -> zero creditNote queries
    await clearInvoicesOnly();
    await seedInvoice({ status: 'SENT', total: 100 });
    groupByCalls = 0;
    aggregateCalls = 0;

    const resPlain = await agent().get(`/commerce/businesses/${ID.bizA}/invoices`).set(HEADER, ID.ownerA);
    expect(resPlain.status).toBe(200);
    expect(resPlain.body.data[0].remaining).toBe(100);
    expect(groupByCalls).toBe(0);
    expect(aggregateCalls).toBe(0);
  });
});
