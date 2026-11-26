/**
 * P96 — FU-REFUND-GATEWAY-REFUSE (server, P0 money launch-track, S, owner ruling #80 7177362077):
 *
 * Real Postgres + real ledger posting + real NestJS HTTP app (`CommerceController`,
 * `CommerceService`, `RevenuePostingService`, `InvoiceWorkflowService`, `AuthGuard`,
 * `BusinessGuard`, `ModuleScopeGuard`, `GlobalHttpExceptionFilter`) proving:
 *
 *   - [RGR-01] RED-BEFORE: `POST /commerce/businesses/:b/payments/:p/refund` on a
 *              `stripe` charge returns `409 Conflict` pointing to
 *              `POST /payments/businesses/:b/refunds`, writes ZERO refund rows,
 *              ZERO reversals, and leaves the invoice `PAID`.
 *   - [RGR-02] RED-BEFORE: `POST /commerce/businesses/:b/payments/:p/refund` on a
 *              `paypal` charge (and mixed-case `'STRIPE'` / `' PayPal '`) returns
 *              `409 Conflict` pointing to `POST /payments/businesses/:b/refunds`,
 *              writing nothing.
 *   - [RGR-03] RED-BEFORE: A `Payment` row whose `invoiceId` belongs to another
 *              business is refused `404` under the lock, writing ZERO refund rows
 *              and leaving the foreign invoice untouched.
 *   - [RGR-04] Control: `manual` (D-55 hand-recorded cash/bank/card) and `wipay`
 *              (no WiPay refund API) charges STILL refund `201` via the manual
 *              bookkeeping route with negative REFUNDED row, balanced reversal,
 *              and invoice reconciled to `SENT`. Internal D-121 bookkeeping
 *              (`allowApiGatewayBookkeeping: true`) continues working for
 *              `paypal`/`stripe` store-order pairing.
 *   - [RGR-05] Control: `revenue:read` STAFF is refused `403`, cross-tenant OWNER
 *              is refused `403`/`404`, and unauthenticated is refused `401`.
 *
 * Fixtures use prefix `v96g_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v96g_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  staffRead: `${P}staffRead`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  invStripe: `${P}invStripe`,
  invPaypal: `${P}invPaypal`,
  invUpperStripe: `${P}invUpperStripe`,
  invWipay: `${P}invWipay`,
  invManual: `${P}invManual`,
  invD121: `${P}invD121`,
  invForeignB: `${P}invForeignB`,
  payStripe: `${P}payStripe`,
  payPaypal: `${P}payPaypal`,
  payUpperStripe: `${P}payUpperStripe`,
  payWipay: `${P}payWipay`,
  payD121: `${P}payD121`,
  payMismatchedInv: `${P}payMismatchedInv`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
let commerce: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

function postRefund(paymentId: string, actor: string | null = ID.ownerA, bizId = ID.bizA, reason = 'test refund') {
  const req = request(app.getHttpServer()).post(`/commerce/businesses/${bizId}/payments/${paymentId}/refund`);
  if (actor !== null) req.set(HEADER, actor);
  return req.send({ reason });
}

beforeAll(async () => {
  Logger.overrideLogger(false);

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  db = prismaService.client;
  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' },
      { id: ID.staffRead, email: `${P}staffRead@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: `${P}Biz A`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: `${P}Biz B`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}m_staffRead`,
        userId: ID.staffRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'read' },
      },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.contact.createMany({
    data: [
      { id: ID.contactA, businessId: ID.bizA, firstName: 'Grace', lastName: 'Buyer', email: `${P}buyerA@test.local`, status: 'CLIENT' },
      { id: ID.contactB, businessId: ID.bizB, firstName: 'Other', lastName: 'Buyer', email: `${P}buyerB@test.local`, status: 'CLIENT' },
    ],
  });

  const paidInvoices = [
    [ID.invStripe, ID.bizA, ID.contactA, `${P}INV-STR`],
    [ID.invPaypal, ID.bizA, ID.contactA, `${P}INV-PP`],
    [ID.invUpperStripe, ID.bizA, ID.contactA, `${P}INV-USTR`],
    [ID.invWipay, ID.bizA, ID.contactA, `${P}INV-WP`],
    [ID.invD121, ID.bizA, ID.contactA, `${P}INV-D121`],
    [ID.invForeignB, ID.bizB, ID.contactB, `${P}INV-FB`],
  ] as const;

  for (const [id, businessId, contactId, invoiceNumber] of paidInvoices) {
    await db.invoice.create({
      data: {
        id,
        businessId,
        contactId,
        invoiceNumber,
        status: 'PAID',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        paidAt: new Date(),
      },
    });
  }

  await db.invoice.create({
    data: {
      id: ID.invManual,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-MAN`,
      status: 'SENT',
      subtotal: 100,
      total: 100,
      currency: 'TTD',
    },
  });

  await db.payment.createMany({
    data: [
      {
        id: ID.payStripe,
        businessId: ID.bizA,
        invoiceId: ID.invStripe,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'stripe',
        method: 'card',
        providerPaymentId: `${P}pi_stripe_1`,
      },
      {
        id: ID.payPaypal,
        businessId: ID.bizA,
        invoiceId: ID.invPaypal,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'paypal',
        method: 'paypal',
        providerPaymentId: `${P}cap_paypal_1`,
      },
      {
        id: ID.payUpperStripe,
        businessId: ID.bizA,
        invoiceId: ID.invUpperStripe,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: ' STRIPE ',
        method: 'card',
        providerPaymentId: `${P}pi_stripe_upper`,
      },
      {
        id: ID.payWipay,
        businessId: ID.bizA,
        invoiceId: ID.invWipay,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'wipay',
        method: 'wipay',
        providerPaymentId: `${P}wp_1`,
      },
      {
        id: ID.payD121,
        businessId: ID.bizA,
        invoiceId: ID.invD121,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'paypal',
        method: 'paypal',
        providerPaymentId: `${P}cap_d121_1`,
      },
      {
        id: ID.payMismatchedInv,
        businessId: ID.bizA,
        invoiceId: ID.invForeignB,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'manual',
        method: 'cash',
        providerPaymentId: `${P}man_mismatch_1`,
      },
    ],
  });

  const eventStub = {
    emit: () => true,
    emitAsync: async () => [],
    on: () => undefined,
    off: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      { provide: PrismaService, useValue: prismaService },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: null },
      CommerceService,
      InvoiceWorkflowService,
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
      { provide: PaymentEvidenceService, useValue: {} },
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  commerce = moduleRef.get(CommerceService);
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.length > 0) {
      req.user = { id: uid, role: 'USER', email: `${P}req_${uid}@test.local` };
    }
    next();
  });
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
});

describe('P96 — FU-REFUND-GATEWAY-REFUSE (POST /commerce/businesses/:b/payments/:p/refund)', () => {
  it('[RGR-01] RED-BEFORE: Stripe payment is refused 409 pointing to gateway refund route; zero rows written and invoice stays PAID', async () => {
    const res = await postRefund(ID.payStripe);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(String(res.body?.message ?? '')).toMatch(/stripe/i);
    expect(String(res.body?.message ?? '')).toMatch(/\/payments\/businesses\/.+\/refunds/);

    const rows = await db.payment.findMany({ where: { invoiceId: ID.invStripe } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('SUCCESSFUL');
    const inv = await db.invoice.findUnique({ where: { id: ID.invStripe } });
    expect(inv.status).toBe('PAID');
  });

  it('[RGR-02] RED-BEFORE: PayPal and mixed-case padded STRIPE payments are refused 409; zero rows written', async () => {
    for (const [payId, invId, providerName] of [
      [ID.payPaypal, ID.invPaypal, 'paypal'],
      [ID.payUpperStripe, ID.invUpperStripe, 'stripe'],
    ] as const) {
      const res = await postRefund(payId);
      expect(res.status, `${payId}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(String(res.body?.message ?? '')).toMatch(new RegExp(providerName, 'i'));
      expect(String(res.body?.message ?? '')).toMatch(/\/payments\/businesses\/.+\/refunds/);

      const rows = await db.payment.findMany({ where: { invoiceId: invId } });
      expect(rows).toHaveLength(1);
      const inv = await db.invoice.findUnique({ where: { id: invId } });
      expect(inv.status).toBe('PAID');
    }
  });

  it('[RGR-03] RED-BEFORE: payment referencing another business invoiceId is refused 404; foreign invoice untouched', async () => {
    const res = await postRefund(ID.payMismatchedInv);
    expect(res.status, JSON.stringify(res.body)).toBe(404);

    const foreignInv = await db.invoice.findUnique({ where: { id: ID.invForeignB } });
    expect(foreignInv.status).toBe('PAID');
    const refundRows = await db.payment.findMany({
      where: { invoiceId: ID.invForeignB, status: 'REFUNDED' },
    });
    expect(refundRows).toHaveLength(0);
  });

  it('[RGR-04] Control: manual and WiPay payments still refund 201 via HTTP, and D-121 allowApiGatewayBookkeeping still works for PayPal', async () => {
    // 1. Record a real manual cash payment and refund it over HTTP
    const payRes = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invManual}/payments`)
      .set(HEADER, ID.ownerA)
      .send({ amount: 100, method: 'cash', reference: `${P}MAN-CASH` });
    expect(payRes.status, JSON.stringify(payRes.body)).toBe(201);

    const manRefund = await postRefund(payRes.body.payment.id);
    expect(manRefund.status, JSON.stringify(manRefund.body)).toBe(201);
    expect(manRefund.body).toMatchObject({ amount: -100, status: 'REFUNDED', invoiceStatus: 'SENT' });

    // 2. WiPay (no refund API) still refunds via HTTP bookkeeping route
    const wpRefund = await postRefund(ID.payWipay);
    expect(wpRefund.status, JSON.stringify(wpRefund.body)).toBe(201);
    expect(wpRefund.body).toMatchObject({ amount: -100, status: 'REFUNDED', invoiceStatus: 'SENT' });

    // 3. Internal D-121 caller with allowApiGatewayBookkeeping: true still works for PayPal
    const d121 = await commerce.markPaymentRefunded(
      ID.payD121,
      ID.bizA,
      'D-121 out-of-band PayPal store refund',
      ID.ownerA,
      undefined,
      undefined,
      { allowApiGatewayBookkeeping: true },
    );
    expect(d121).toMatchObject({ amount: -100, status: 'REFUNDED', invoiceStatus: 'SENT' });
  });

  it('[RGR-05] Control: revenue:read STAFF refused 403, cross-tenant OWNER refused 403, unauthenticated refused 401', async () => {
    const staff = await postRefund(ID.payStripe, ID.staffRead, ID.bizA);
    expect(staff.status).toBe(403);

    const other = await postRefund(ID.payStripe, ID.ownerB, ID.bizA);
    expect(other.status).toBe(403);

    const unauth = await postRefund(ID.payStripe, null, ID.bizA);
    expect(unauth.status).toBe(401);
  });
});
