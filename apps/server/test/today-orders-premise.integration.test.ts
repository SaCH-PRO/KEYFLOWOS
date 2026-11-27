/**
 * P205 FU-TODAY-ORDERS-PREMISE (D-298, Journey I3): real-DB PostgreSQL proof
 * that GET /business-command-center/businesses/:businessId/today lists open
 * unpaid orders to fulfil (e.g. orders created via POST /marketplace/businesses/:id/orders
 * as in Journey I3) alongside open paid orders, while still excluding closed
 * fulfilment statuses and refunded/failed/cancelled payment statuses, and
 * keeping D-57/D-100/D-234 money hiding (`total: null` below revenue:read) and
 * strict tenant & storefront:read scope isolation.
 *
 * Fixture prefix: `v92i_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92i_';
const HEADER = 'x-v92i-user';

const ID = {
  ownerA: `${P}owner_a`,
  staffStoreOnlyA: `${P}staff_store_a`,
  staffNoStoreA: `${P}staff_nostore_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  orderUnpaidOpenA: `${P}ord_unpaid_open`,
  orderPendingOpenA: `${P}ord_pending_open`,
  orderPaidOpenA: `${P}ord_paid_open`,
  orderShippedA: `${P}ord_shipped`,
  orderMixedCaseClosedA: `${P}ord_mixed_closed`,
  orderCancelledA: `${P}ord_cancelled`,
  orderRefundedPayA: `${P}ord_ref_pay`,
  orderFailedPayA: `${P}ord_fail_pay`,
  orderVoidPayA: `${P}ord_void_pay`,
  orderCancelledPayA: `${P}ord_cancel_pay`,
  orderUnpaidOpenB: `${P}ord_unpaid_b`,
};

let db: typeof import('@keyflow/db').db;
let app: import('@nestjs/common').INestApplication;

async function cleanup() {
  for (const sql of [
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { TodayController } = await import('../src/modules/business-command-center/today.controller');
  const { TodayService } = await import('../src/modules/business-command-center/today.service');
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { ReadyToSendService } = await import('../src/modules/commerce/ready-to-send.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');

  const prismaStub = { client: db };

  const moduleRef = await Test.createTestingModule({
    controllers: [TodayController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      TodayService,
      {
        provide: FinanceOverviewService,
        useValue: {
          getOverview: async () => ({
            cashBalance: 0,
            cashBasis: 'LEDGER',
            cashCurrency: 'TTD',
            otherCurrencyCash: [],
            outstandingInvoices: 0,
            outstandingInvoiceCount: 0,
            overdueInvoices: 0,
            overdueInvoiceCount: 0,
            billsDue: 0,
            billsDueCount: 0,
            revenueThisMonth: 0,
            expensesThisMonth: 0,
            netProfitThisMonth: 0,
            currency: 'TTD',
          }),
        },
      },
      {
        provide: SafeToSpendService,
        useValue: { calculate: async () => ({ safeToSpend: 0 }) },
      },
      {
        provide: ReadyToSendService,
        useValue: { listDue: async () => ({ items: [] }) },
      },
      {
        provide: KeyActionProposalService,
        useValue: { listForReader: async () => [] },
      },
      {
        provide: CommerceService,
        useValue: { listPaymentClaims: async () => [] },
      },
      AuthGuard,
      BusinessGuard,
      TenantInterceptor,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.trim().length > 0) {
      req.user = { id: uid.trim(), role: 'USER', email: `${P}${uid.trim()}@test.local` };
    }
    next();
  });
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'Owner A' },
      { id: ID.staffStoreOnlyA, email: `${P}staff_store_a@test.local`, name: 'Store Staff A' },
      { id: ID.staffNoStoreA, email: `${P}staff_nostore_a@test.local`, name: 'Bookings Staff A' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'Owner B' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'Biz A Orders', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'Biz B Orders', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        userId: ID.staffStoreOnlyA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { storefront: 'read', revenue: 'none' },
      },
      {
        userId: ID.staffNoStoreA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'read', storefront: 'none' },
      },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.marketplaceOrder.createMany({
    data: [
      {
        id: ID.orderUnpaidOpenA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-UNPAID-1`,
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Simone Unpaid',
        subtotal: 120,
        total: 120,
        currency: 'TTD',
      },
      {
        id: ID.orderPendingOpenA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-PENDING-1B`,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        customerName: 'Tasha Pending',
        subtotal: 180,
        total: 180,
        currency: 'TTD',
      },
      {
        id: ID.orderPaidOpenA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-PAID-2`,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        customerName: 'Maria Paid',
        subtotal: 250,
        total: 250,
        currency: 'TTD',
      },
      {
        id: ID.orderShippedA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-SHIPPED-3`,
        status: 'SHIPPED',
        paymentStatus: 'PAID',
        customerName: 'Shipped Customer',
        subtotal: 90,
        total: 90,
        currency: 'TTD',
      },
      {
        id: ID.orderMixedCaseClosedA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-MIXED-3B`,
        status: 'Shipped',
        paymentStatus: 'Paid',
        customerName: 'Mixed Case Shipped',
        subtotal: 95,
        total: 95,
        currency: 'TTD',
      },
      {
        id: ID.orderCancelledA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-CANCELLED-4`,
        status: 'cancelled',
        paymentStatus: 'UNPAID',
        customerName: 'Cancelled Customer',
        subtotal: 80,
        total: 80,
        currency: 'TTD',
      },
      {
        id: ID.orderRefundedPayA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-REFUNDED-5`,
        status: 'placed',
        paymentStatus: 'REFUNDED',
        customerName: 'Refunded Customer',
        subtotal: 70,
        total: 70,
        currency: 'TTD',
      },
      {
        id: ID.orderFailedPayA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-FAILED-6`,
        status: 'placed',
        paymentStatus: 'FAILED',
        customerName: 'Failed Payment Customer',
        subtotal: 60,
        total: 60,
        currency: 'TTD',
      },
      {
        id: ID.orderVoidPayA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-VOID-7`,
        status: 'placed',
        paymentStatus: 'Void',
        customerName: 'Void Payment Customer',
        subtotal: 50,
        total: 50,
        currency: 'TTD',
      },
      {
        id: ID.orderCancelledPayA,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-PAYCANCEL-8`,
        status: 'placed',
        paymentStatus: 'CANCELLED',
        customerName: 'Cancelled Payment Customer',
        subtotal: 40,
        total: 40,
        currency: 'TTD',
      },
      {
        id: ID.orderUnpaidOpenB,
        businessId: ID.bizB,
        orderNumber: `${P}ORD-FOREIGN-B`,
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Foreign Customer',
        subtotal: 300,
        total: 300,
        currency: 'TTD',
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('P205 FU-TODAY-ORDERS-PREMISE (D-298, Journey I3)', () => {
  it('[TOP-01] RED-BEFORE: Today lists open unpaid & pending orders alongside open paid orders, and excludes closed/mixed-case/cancelled/refunded/failed/void orders', async () => {
    const res = await request(app.getHttpServer())
      .get(`/business-command-center/businesses/${ID.bizA}/today`)
      .set(HEADER, ID.ownerA)
      .expect(200);

    const orderIds = (res.body.today.orders as Array<{ id: string }>).map((o) => o.id);
    expect(orderIds).toContain(ID.orderUnpaidOpenA);
    expect(orderIds).toContain(ID.orderPendingOpenA);
    expect(orderIds).toContain(ID.orderPaidOpenA);
    expect(orderIds).not.toContain(ID.orderShippedA);
    expect(orderIds).not.toContain(ID.orderMixedCaseClosedA);
    expect(orderIds).not.toContain(ID.orderCancelledA);
    expect(orderIds).not.toContain(ID.orderRefundedPayA);
    expect(orderIds).not.toContain(ID.orderFailedPayA);
    expect(orderIds).not.toContain(ID.orderVoidPayA);
    expect(orderIds).not.toContain(ID.orderCancelledPayA);
    expect(orderIds).not.toContain(ID.orderUnpaidOpenB);
    expect(res.body.today.counts.orders).toBe(3);

    const unpaid = res.body.today.orders.find((o: any) => o.id === ID.orderUnpaidOpenA);
    expect(unpaid).toMatchObject({
      id: ID.orderUnpaidOpenA,
      orderNumber: `${P}ORD-UNPAID-1`,
      total: 120,
      currency: 'TTD',
      customerName: 'Simone Unpaid',
    });
    expect(unpaid).not.toHaveProperty('paymentStatus');
  });

  it('[TOP-02] RED-BEFORE (D-57/D-100/D-234): storefront-only STAFF sees open unpaid & paid orders with total: null and no paymentStatus leak', async () => {
    const res = await request(app.getHttpServer())
      .get(`/business-command-center/businesses/${ID.bizA}/today`)
      .set(HEADER, ID.staffStoreOnlyA)
      .expect(200);

    const unpaid = res.body.today.orders.find((o: any) => o.id === ID.orderUnpaidOpenA);
    const paid = res.body.today.orders.find((o: any) => o.id === ID.orderPaidOpenA);
    expect(unpaid).toBeDefined();
    expect(paid).toBeDefined();
    expect(unpaid.total).toBeNull();
    expect(paid.total).toBeNull();
    expect(unpaid).not.toHaveProperty('paymentStatus');
    expect(paid).not.toHaveProperty('paymentStatus');
    expect(res.body.pulse).toBeNull();
    expect(res.body.pulseStatus).toBe('RESTRICTED');
  });

  it('[TOP-03] (D-96): STAFF without storefront:read receives empty orders list and cross-business access returns 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/business-command-center/businesses/${ID.bizA}/today`)
      .set(HEADER, ID.staffNoStoreA)
      .expect(200);
    expect(res.body.today.orders).toEqual([]);

    await request(app.getHttpServer())
      .get(`/business-command-center/businesses/${ID.bizB}/today`)
      .set(HEADER, ID.ownerA)
      .expect(403);
  });
});
