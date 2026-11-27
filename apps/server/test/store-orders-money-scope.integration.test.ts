/**
 * FU-STORE-ORDERS-MONEY-SCOPE (P135, V1-91; owner rulings D-100, D-234) —
 * GET /site/businesses/:businessId/orders, GET /site/businesses/:businessId/orders/:orderId,
 * and PATCH /site/businesses/:businessId/orders/:orderId/status withhold every
 * money field, payment/invoice reference, item price, and financial metadata
 * key from readers whose `revenue` module level is below `read` (REAL database).
 *
 * Found by the FU-SITE-ANALYTICS-REVENUE-SCOPE delta security review:
 *   GET .../orders (SiteController.listOrders -> StoreOrderService.listOrders)
 *   and GET .../orders/:orderId (SiteController.getOrderDetail -> StoreOrderService.getOrder)
 *   served whole MarketplaceOrder rows (total, subtotal, shippingFee, taxAmount,
 *   dutyAmount, discountAmount, currency, paymentStatus, paymentMethod,
 *   paymentRef, promoCodeId, item unitPrice/total/currency, financial metadata)
 *   to any member of the business, letting a revenue:none member rebuild the
 *   withheld summary and funnel revenue. PATCH .../orders/:orderId/status
 *   likewise returned the full row to a storefront:write / revenue:none member.
 *
 * Pinned here across both 'production' (TenantInterceptor + tenant extension)
 * and 'bare' NestJS HTTP pipelines:
 *   - Every reader below revenue:read (explicit { storefront: 'read' }, ADMIN
 *     with { revenue: 'none' }, OWNER with explicit { revenue: 'none' } per
 *     D-114/D-140, STAFF with { storefront: 'write', revenue: 'none' }, JSON
 *     array permissionScopes [], dual member who is OWNER only in another biz):
 *       * GET .../orders returns 200 with accurate pagination/total count and
 *         fulfilment fields (id, businessId, orderNumber, status, type,
 *         customerName/Email/Phone/Country, shippingAddress, notes, createdAt,
 *         updatedAt, items[id,orderId,productId,name,sku,quantity]) and ZERO
 *         money, payment, discount, billing, item-price, or financial metadata
 *         fields (keys absent, not zero/null);
 *       * GET .../orders/:orderId returns 200 with the same fulfilment-only
 *         projection;
 *       * GET .../orders?search=<paymentRef> returns 0 matches (no paymentRef
 *         search oracle); ?paymentStatus=PAID is not honored as a filter oracle;
 *       * PATCH .../orders/:orderId/status by a storefront:write / revenue:none
 *         member updates fulfilment status and returns the same fulfilment-only
 *         projection with ZERO money fields.
 *   - Owner (default scopes), ADMIN (default scopes), STAFF (default scopes),
 *     explicit revenue:read member, and platform SUPER_ADMIN receive the full
 *     order payload unchanged on list, detail, and status update.
 *   - Cross-tenant isolation: non-member gets 403; tenant A member requesting
 *     tenant B's orderId under tenant A's URL gets 404 (both revenue readers
 *     and non-readers); dual member reads bizB's full money fields as OWNER of
 *     bizB and never leaks bizA.
 *
 * Every seeded row carries the `v91f_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91f_';
const HEADER = 'x-v91f-user';

const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA, default scopes (revenue: admin)
  adminDefault: `${P}adminDef`, // ADMIN of bizA, default scopes (revenue: write)
  staffDefaults: `${P}staffDef`, // STAFF of bizA, default scopes (revenue: read)
  revenueReader: `${P}revRead`, // STAFF of bizA, explicit { storefront: 'read', revenue: 'read' }
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no membership
  storefrontOnly: `${P}storeOnly`, // STAFF of bizA, explicit { storefront: 'read' } (revenue missing -> none)
  revenueNoneAdmin: `${P}revNoneAdm`, // ADMIN of bizA, explicit { storefront: 'admin', revenue: 'none' }
  ownerRevNone: `${P}ownerNoRev`, // OWNER of bizA, explicit { storefront: 'admin', revenue: 'none' } (D-114/D-140)
  storefrontWriterNoRev: `${P}sfWriteNoRev`, // STAFF of bizA, explicit { storefront: 'write', revenue: 'none' }
  arrayScopes: `${P}array`, // STAFF of bizA, permissionScopes: [] (every module none)
  dual: `${P}dual`, // { storefront: 'read' } in bizA, OWNER (default) in bizB
  ownerB: `${P}ownerB`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  prodA1: `${P}prodA1`,
  prodA2: `${P}prodA2`,
  prodB1: `${P}prodB1`,
  promoA: `${P}promoA`,
  orderA1: `${P}orderA1`,
  orderA2: `${P}orderA2`,
  orderB1: `${P}orderB1`,
  itemA1: `${P}itemA1`,
  itemA2: `${P}itemA2`,
  itemA3: `${P}itemA3`,
  itemB1: `${P}itemB1`,
};

const SECRET_PAYMENT_REF_A1 = 'pi_v91f_secret_98765';
const SECRET_PAYMENT_REF_A2 = 'ref_v91f_unpaid_222';
const SECRET_PAYMENT_REF_B1 = 'pi_v91f_bizB_secret';

const FORBIDDEN_ORDER_KEYS = [
  'subtotal',
  'shippingFee',
  'taxAmount',
  'dutyAmount',
  'discountAmount',
  'total',
  'currency',
  'paymentStatus',
  'paymentMethod',
  'paymentRef',
  'promoCodeId',
  'promoCode',
  'billingAddress',
  'invoiceId',
  'invoice',
] as const;

const FORBIDDEN_ITEM_KEYS = ['unitPrice', 'total', 'currency', 'price'] as const;

const FORBIDDEN_METADATA_KEYS = [
  'taxRate',
  'promoCode',
  'refundedTotal',
  'shippingExpense',
  'links',
  'publicToken',
  'invoiceId',
  'paymentRef',
] as const;

const OFF_BOUNDARY = new Set([
  'PromoCodeService',
  'IntakeService',
  'QualificationService',
  'CustomerReferralService',
  'CaseStudyService',
  'PaymentsService',
  'AiUsageService',
  'Symbol(REDIS_CLIENT)',
]);

type Pipeline = 'production' | 'bare';
const PIPELINES: Pipeline[] = ['production', 'bare'];

let db: any;
const apps: Partial<Record<Pipeline, any>> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM promo_codes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

const has = (o: unknown, k: string) =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

const describeBody = (res: { status: number; body: unknown }) =>
  `${res.status} ${JSON.stringify(res.body)}`;

function getPath(pipeline: Pipeline, user: string, urlPath: string) {
  return request(apps[pipeline]!.getHttpServer()).get(urlPath).set(HEADER, user);
}

function patchPath(pipeline: Pipeline, user: string, urlPath: string, body: Record<string, unknown>) {
  return request(apps[pipeline]!.getHttpServer()).patch(urlPath).set(HEADER, user).send(body);
}

function assertRedactedOrder(order: any, label: string) {
  for (const key of FORBIDDEN_ORDER_KEYS) {
    expect(has(order, key), `${label}: order must not expose '${key}' (${JSON.stringify(order)})`).toBe(false);
  }
  expect(Array.isArray(order.items), `${label}: items array kept`).toBe(true);
  for (const item of order.items) {
    for (const key of FORBIDDEN_ITEM_KEYS) {
      expect(has(item, key), `${label}: item must not expose '${key}' (${JSON.stringify(item)})`).toBe(false);
    }
    expect(typeof item.id).toBe('string');
    expect(typeof item.name).toBe('string');
    expect(typeof item.quantity).toBe('number');
  }
  if (order.metadata && typeof order.metadata === 'object') {
    for (const key of FORBIDDEN_METADATA_KEYS) {
      expect(has(order.metadata, key), `${label}: metadata must not expose '${key}' (${JSON.stringify(order.metadata)})`).toBe(false);
    }
    if (order.metadata.shipping && typeof order.metadata.shipping === 'object') {
      expect(has(order.metadata.shipping, 'fee'), `${label}: metadata.shipping must not expose 'fee'`).toBe(false);
    }
    if (Array.isArray(order.metadata.statusTimeline)) {
      for (const step of order.metadata.statusTimeline) {
        expect(['paid', 'refunded', 'partially_refunded']).not.toContain(
          String(step?.status ?? '').toLowerCase(),
        );
        expect(has(step, 'refundAmount'), `${label}: timeline step must not expose refundAmount`).toBe(false);
        expect(has(step, 'refundedTotal'), `${label}: timeline step must not expose refundedTotal`).toBe(false);
      }
    }
  }
}

function assertOrderA1FulfilmentKept(order: any) {
  expect(order).toMatchObject({
    id: ID.orderA1,
    businessId: ID.bizA,
    orderNumber: `${P}ORD-A1`,
    status: 'CONFIRMED',
    type: 'STOREFRONT',
    customerName: 'Alicia Fulfil',
    customerEmail: `${P}alicia@test.local`,
    customerPhone: '+18685550101',
    customerCountry: 'TT',
    shippingAddress: { line1: '12 Dock Rd', city: 'Port of Spain' },
    notes: 'Leave at front gate',
  });
  expect(typeof order.createdAt).toBe('string');
  expect(typeof order.updatedAt).toBe('string');
  expect(order.items).toHaveLength(2);
  const byId = new Map<string, any>(order.items.map((i: any) => [i.id, i]));
  expect(byId.get(ID.itemA1)).toEqual({
    id: ID.itemA1,
    orderId: ID.orderA1,
    productId: ID.prodA1,
    name: 'Cacao Nib Box',
    sku: `${P}SKU-1`,
    quantity: 2,
  });
  expect(byId.get(ID.itemA2)).toEqual({
    id: ID.itemA2,
    orderId: ID.orderA1,
    productId: ID.prodA2,
    name: 'Spice Rub',
    sku: `${P}SKU-2`,
    quantity: 1,
  });
  expect(order.metadata).toEqual({
    storefrontSlug: `${P}shop`,
    deliveryNotes: 'Ring bell twice',
    stockNotDecrementedProductIds: [ID.prodA2],
    shipping: {
      zoneId: `${P}zone1`,
      zoneName: 'POS Express',
      estimatedDays: '1-2',
      carrier: 'TTPost',
    },
    statusTimeline: [
      { status: 'placed', timestamp: '2026-11-20T10:00:00.000Z', note: 'Order placed' },
      { status: 'confirmed', timestamp: '2026-11-20T12:00:00.000Z', note: 'Ready to pack' },
    ],
  });
}

function assertOrderA1FullMoneyKept(order: any) {
  expect(order).toMatchObject({
    id: ID.orderA1,
    businessId: ID.bizA,
    orderNumber: `${P}ORD-A1`,
    status: 'CONFIRMED',
    subtotal: 285,
    shippingFee: 25,
    taxAmount: 33.12,
    dutyAmount: 5,
    discountAmount: 20,
    total: 328.12,
    currency: 'TTD',
    paymentStatus: 'PAID',
    paymentMethod: 'STRIPE',
    paymentRef: SECRET_PAYMENT_REF_A1,
    promoCodeId: ID.promoA,
  });
  const byId = new Map<string, any>(order.items.map((i: any) => [i.id, i]));
  expect(byId.get(ID.itemA1)).toMatchObject({
    id: ID.itemA1,
    unitPrice: 120,
    total: 240,
    currency: 'TTD',
  });
  expect(byId.get(ID.itemA2)).toMatchObject({
    id: ID.itemA2,
    unitPrice: 45,
    total: 45,
    currency: 'TTD',
  });
  expect(order.metadata).toMatchObject({
    taxRate: 12.5,
    promoCode: `${P}SAVE20`,
    refundedTotal: 15.5,
    shipping: { zoneId: `${P}zone1`, zoneName: 'POS Express', fee: 25, estimatedDays: '1-2', carrier: 'TTPost' },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');

  const build = async (pipeline: Pipeline) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SiteController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        SiteService,
        StorefrontConversionService,
        {
          provide: StoreOrderService,
          useFactory: (prisma: any) =>
            new (StoreOrderService as any)(prisma, { emit: () => true }, {}, {}, {}, {}, {}, {}, {}, {}),
          inject: [PrismaService],
        },
        ...(pipeline === 'production' ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }] : []),
      ],
    })
      .useMocker((token: any) => {
        const name = typeof token === 'function' ? token.name : String(token);
        return OFF_BOUNDARY.has(name) ? {} : undefined;
      })
      .compile();

    const nest = moduleRef.createNestApplication();
    nest.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    nest.useGlobalFilters(new GlobalHttpExceptionFilter());
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await nest.init();
    return nest;
  };

  apps.production = await build('production');
  apps.bare = await build('bare');

  await cleanup();

  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.adminDefault, 'USER'],
    [ID.staffDefaults, 'USER'],
    [ID.revenueReader, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
    [ID.storefrontOnly, 'USER'],
    [ID.revenueNoneAdmin, 'USER'],
    [ID.ownerRevNone, 'USER'],
    [ID.storefrontWriterNoRev, 'USER'],
    [ID.arrayScopes, 'USER'],
    [ID.dual, 'USER'],
    [ID.ownerB, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }

  await db.business.create({ data: { id: ID.bizA, name: 'V91F Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V91F Biz B', ownerId: ID.ownerB } });

  const memberships: Array<[string, string, string, unknown]> = [
    [ID.ownerA, ID.bizA, 'OWNER', undefined],
    [ID.adminDefault, ID.bizA, 'ADMIN', undefined],
    [ID.staffDefaults, ID.bizA, 'STAFF', undefined],
    [ID.revenueReader, ID.bizA, 'STAFF', { storefront: 'read', revenue: 'read' }],
    [ID.storefrontOnly, ID.bizA, 'STAFF', { storefront: 'read' }],
    [ID.revenueNoneAdmin, ID.bizA, 'ADMIN', { storefront: 'admin', revenue: 'none' }],
    [ID.ownerRevNone, ID.bizA, 'OWNER', { storefront: 'admin', revenue: 'none' }],
    [ID.storefrontWriterNoRev, ID.bizA, 'STAFF', { storefront: 'write', revenue: 'none' }],
    [ID.arrayScopes, ID.bizA, 'STAFF', []],
    [ID.dual, ID.bizA, 'STAFF', { storefront: 'read' }],
    [ID.dual, ID.bizB, 'OWNER', undefined],
    [ID.ownerB, ID.bizB, 'OWNER', undefined],
  ];
  let mIdx = 0;
  for (const [userId, businessId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: {
        id: `${P}m${mIdx++}`,
        userId,
        businessId,
        role,
        ...(permissionScopes !== undefined ? { permissionScopes } : {}),
      },
    });
  }

  await db.product.create({
    data: { id: ID.prodA1, businessId: ID.bizA, name: 'Cacao Nib Box', sku: `${P}SKU-1`, price: 120, currency: 'TTD' },
  });
  await db.product.create({
    data: { id: ID.prodA2, businessId: ID.bizA, name: 'Spice Rub', sku: `${P}SKU-2`, price: 45, currency: 'TTD' },
  });
  await db.product.create({
    data: { id: ID.prodB1, businessId: ID.bizB, name: 'BizB Vault', sku: `${P}SKU-B`, price: 999, currency: 'USD' },
  });

  await db.promoCode.create({
    data: { id: ID.promoA, businessId: ID.bizA, code: `${P}SAVE20`, type: 'FIXED', value: 20, active: true },
  });

  await db.marketplaceOrder.create({
    data: {
      id: ID.orderA1,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-A1`,
      status: 'CONFIRMED',
      type: 'STOREFRONT',
      customerName: 'Alicia Fulfil',
      customerEmail: `${P}alicia@test.local`,
      customerPhone: '+18685550101',
      customerCountry: 'TT',
      shippingAddress: { line1: '12 Dock Rd', city: 'Port of Spain' },
      billingAddress: { line1: '99 Billing St', city: 'Port of Spain' },
      subtotal: 285,
      shippingFee: 25,
      taxAmount: 33.12,
      dutyAmount: 5,
      discountAmount: 20,
      total: 328.12,
      currency: 'TTD',
      paymentStatus: 'PAID',
      paymentMethod: 'STRIPE',
      paymentRef: SECRET_PAYMENT_REF_A1,
      promoCodeId: ID.promoA,
      notes: 'Leave at front gate',
      metadata: {
        taxRate: 12.5,
        promoCode: `${P}SAVE20`,
        refundedTotal: 15.5,
        shippingExpense: { expenseId: `${P}exp_1`, amount: 25 },
        links: { contactId: `${P}c1`, invoiceId: `${P}inv_secret` },
        publicToken: `${P}pub_tok_secret`,
        invoiceId: `${P}inv_secret`,
        shipping: {
          zoneId: `${P}zone1`,
          zoneName: 'POS Express',
          fee: 25,
          estimatedDays: '1-2',
          carrier: 'TTPost',
        },
        storefrontSlug: `${P}shop`,
        deliveryNotes: 'Ring bell twice',
        stockNotDecrementedProductIds: [ID.prodA2],
        statusTimeline: [
          { status: 'placed', timestamp: '2026-11-20T10:00:00.000Z', note: 'Order placed' },
          { status: 'paid', timestamp: '2026-11-20T10:05:00.000Z', note: 'Paid via Stripe' },
          {
            status: 'partially_refunded',
            timestamp: '2026-11-20T11:00:00.000Z',
            refundAmount: 15.5,
            refundedTotal: 15.5,
            reason: 'damaged',
          },
          { status: 'confirmed', timestamp: '2026-11-20T12:00:00.000Z', note: 'Ready to pack' },
        ],
      },
      items: {
        create: [
          {
            id: ID.itemA1,
            productId: ID.prodA1,
            name: 'Cacao Nib Box',
            sku: `${P}SKU-1`,
            quantity: 2,
            unitPrice: 120,
            total: 240,
            currency: 'TTD',
          },
          {
            id: ID.itemA2,
            productId: ID.prodA2,
            name: 'Spice Rub',
            sku: `${P}SKU-2`,
            quantity: 1,
            unitPrice: 45,
            total: 45,
            currency: 'TTD',
          },
        ],
      },
    },
  });

  await db.marketplaceOrder.create({
    data: {
      id: ID.orderA2,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-A2`,
      status: 'PENDING',
      type: 'STOREFRONT',
      customerName: 'Devon Pending',
      customerEmail: `${P}devon@test.local`,
      subtotal: 90,
      shippingFee: 10,
      taxAmount: 0,
      dutyAmount: 0,
      discountAmount: 0,
      total: 100,
      currency: 'TTD',
      paymentStatus: 'UNPAID',
      paymentMethod: 'CASH',
      paymentRef: SECRET_PAYMENT_REF_A2,
      items: {
        create: [
          {
            id: ID.itemA3,
            productId: ID.prodA2,
            name: 'Spice Rub',
            sku: `${P}SKU-2`,
            quantity: 2,
            unitPrice: 45,
            total: 90,
            currency: 'TTD',
          },
        ],
      },
    },
  });

  await db.marketplaceOrder.create({
    data: {
      id: ID.orderB1,
      businessId: ID.bizB,
      orderNumber: `${P}ORD-B1`,
      status: 'COMPLETED',
      type: 'STOREFRONT',
      customerName: 'Bravo Buyer',
      customerEmail: `${P}bravo@test.local`,
      subtotal: 999,
      shippingFee: 0,
      taxAmount: 0,
      dutyAmount: 0,
      discountAmount: 0,
      total: 999,
      currency: 'USD',
      paymentStatus: 'PAID',
      paymentMethod: 'STRIPE',
      paymentRef: SECRET_PAYMENT_REF_B1,
      items: {
        create: [
          {
            id: ID.itemB1,
            productId: ID.prodB1,
            name: 'BizB Vault',
            sku: `${P}SKU-B`,
            quantity: 1,
            unitPrice: 999,
            total: 999,
            currency: 'USD',
          },
        ],
      },
    },
  });
}, 120_000);

afterAll(async () => {
  for (const app of Object.values(apps)) await app?.close();
  if (db) await cleanup();
});

const NON_READERS: Array<[string, string]> = [
  ['STAFF explicit { storefront: read } (revenue missing)', ID.storefrontOnly],
  ['ADMIN explicit { storefront: admin, revenue: none }', ID.revenueNoneAdmin],
  ['OWNER explicit { storefront: admin, revenue: none } (D-114/D-140)', ID.ownerRevNone],
  ['STAFF explicit { storefront: write, revenue: none }', ID.storefrontWriterNoRev],
  ['STAFF permissionScopes stored as JSON array []', ID.arrayScopes],
  ['dual member (revenue read in bizB only, storefront:read in bizA)', ID.dual],
];

const READERS: Array<[string, string]> = [
  ['OWNER (default scopes)', ID.ownerA],
  ['ADMIN (default scopes)', ID.adminDefault],
  ['STAFF (default scopes -> revenue read)', ID.staffDefaults],
  ['STAFF explicit { storefront: read, revenue: read }', ID.revenueReader],
  ['platform SUPER_ADMIN', ID.superAdmin],
];

describe.each(PIPELINES)('FU-STORE-ORDERS-MONEY-SCOPE, %s pipeline', (pipeline) => {
  const listUrl = (biz: string) => `/site/businesses/${biz}/orders`;
  const detailUrl = (biz: string, orderId: string) => `/site/businesses/${biz}/orders/${orderId}`;
  const statusUrl = (biz: string, orderId: string) => `/site/businesses/${biz}/orders/${orderId}/status`;

  describe('GET /site/businesses/:businessId/orders — listOrders', () => {
    it.each(NON_READERS)(
      '%s: keeps list count & fulfilment fields, omits every money/payment/price/financial-metadata field',
      async (label, user) => {
        const res = await getPath(pipeline, user, listUrl(ID.bizA));
        expect(res.status, describeBody(res)).toBe(200);
        // List count and pagination metadata are NOT withheld per spec.
        expect(res.body.total, describeBody(res)).toBe(2);
        expect(res.body.page).toBe(1);
        expect(res.body.pageSize).toBe(20);
        expect(res.body.totalPages).toBe(1);
        expect(res.body.data).toHaveLength(2);

        for (const row of res.body.data) {
          assertRedactedOrder(row, `${label} list`);
        }

        const orderA1 = res.body.data.find((o: any) => o.id === ID.orderA1);
        expect(orderA1, 'orderA1 present in list').toBeDefined();
        assertOrderA1FulfilmentKept(orderA1);

        const raw = JSON.stringify(res.body);
        for (const secret of [
          SECRET_PAYMENT_REF_A1,
          SECRET_PAYMENT_REF_A2,
          `${P}SAVE20`,
          `${P}inv_secret`,
          `${P}pub_tok_secret`,
          `${P}exp_1`,
          '328.12',
          '33.12',
        ]) {
          expect(raw, `${label}: serialized list must not leak ${secret}`).not.toContain(secret);
        }
      },
    );

    it.each(READERS)('%s: full order payload with all money & payment fields unchanged', async (_label, user) => {
      const res = await getPath(pipeline, user, listUrl(ID.bizA));
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body.total).toBe(2);
      const orderA1 = res.body.data.find((o: any) => o.id === ID.orderA1);
      expect(orderA1).toBeDefined();
      assertOrderA1FullMoneyKept(orderA1);
    });

    it('search=<paymentRef> does not match orders by paymentRef for revenue:none reader (no search oracle)', async () => {
      const oracle = await getPath(
        pipeline,
        ID.storefrontOnly,
        `${listUrl(ID.bizA)}?search=${encodeURIComponent(SECRET_PAYMENT_REF_A1)}`,
      );
      expect(oracle.status, describeBody(oracle)).toBe(200);
      expect(oracle.body.data).toEqual([]);
      expect(oracle.body.total).toBe(0);

      // Control: searching by orderNumber still matches and returns redacted row.
      const byNum = await getPath(
        pipeline,
        ID.storefrontOnly,
        `${listUrl(ID.bizA)}?search=${encodeURIComponent(`${P}ORD-A1`)}`,
      );
      expect(byNum.status, describeBody(byNum)).toBe(200);
      expect(byNum.body.total).toBe(1);
      assertRedactedOrder(byNum.body.data[0], 'search by orderNumber');
      assertOrderA1FulfilmentKept(byNum.body.data[0]);
    });

    it('paymentStatus query param is not honored as a filter oracle for revenue:none reader', async () => {
      const res = await getPath(pipeline, ID.storefrontOnly, `${listUrl(ID.bizA)}?paymentStatus=PAID`);
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.data).toHaveLength(2);
      for (const row of res.body.data) {
        assertRedactedOrder(row, 'paymentStatus query ignored');
      }
    });
  });

  describe('GET /site/businesses/:businessId/orders/:orderId — getOrderDetail', () => {
    it.each(NON_READERS)(
      '%s: keeps fulfilment fields, omits every money/payment/price/financial-metadata field',
      async (label, user) => {
        const res = await getPath(pipeline, user, detailUrl(ID.bizA, ID.orderA1));
        expect(res.status, describeBody(res)).toBe(200);
        assertRedactedOrder(res.body, `${label} detail`);
        assertOrderA1FulfilmentKept(res.body);

        const raw = JSON.stringify(res.body);
        for (const secret of [
          SECRET_PAYMENT_REF_A1,
          `${P}SAVE20`,
          `${P}inv_secret`,
          `${P}pub_tok_secret`,
          `${P}exp_1`,
          '328.12',
          '33.12',
        ]) {
          expect(raw, `${label}: serialized detail must not leak ${secret}`).not.toContain(secret);
        }
      },
    );

    it.each(READERS)('%s: full order detail with all money & payment fields unchanged', async (_label, user) => {
      const res = await getPath(pipeline, user, detailUrl(ID.bizA, ID.orderA1));
      expect(res.status, describeBody(res)).toBe(200);
      assertOrderA1FullMoneyKept(res.body);
    });
  });

  describe('PATCH /site/businesses/:businessId/orders/:orderId/status — response redaction', () => {
    it('storefront:write / revenue:none member can advance status without leaking money fields in response; owner keeps full payload', async () => {
      // Ensure orderA2 starts PENDING for each pipeline run.
      await db.marketplaceOrder.update({ where: { id: ID.orderA2 }, data: { status: 'PENDING' } });

      const staffRes = await patchPath(pipeline, ID.storefrontWriterNoRev, statusUrl(ID.bizA, ID.orderA2), {
        status: 'CONFIRMED',
      });
      expect(staffRes.status, describeBody(staffRes)).toBe(200);
      expect(staffRes.body.status).toBe('CONFIRMED');
      expect(staffRes.body.orderNumber).toBe(`${P}ORD-A2`);
      assertRedactedOrder(staffRes.body, 'PATCH status by revenue:none writer');
      expect(JSON.stringify(staffRes.body)).not.toContain(SECRET_PAYMENT_REF_A2);

      // Owner patching next status still gets full payload intact.
      const ownerRes = await patchPath(pipeline, ID.ownerA, statusUrl(ID.bizA, ID.orderA2), {
        status: 'PROCESSING',
      });
      expect(ownerRes.status, describeBody(ownerRes)).toBe(200);
      expect(ownerRes.body).toMatchObject({
        id: ID.orderA2,
        status: 'PROCESSING',
        total: 100,
        subtotal: 90,
        shippingFee: 10,
        currency: 'TTD',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        paymentRef: SECRET_PAYMENT_REF_A2,
      });
      expect(ownerRes.body.items[0]).toMatchObject({ unitPrice: 45, total: 90, currency: 'TTD' });

      // Reset orderA2 back to PENDING so any subsequent run sees clean state.
      await db.marketplaceOrder.update({ where: { id: ID.orderA2 }, data: { status: 'PENDING' } });
    });
  });

  describe('cross-tenant isolation', () => {
    it('dual member reads full money fields on bizB (OWNER), never bizA', async () => {
      const listRes = await getPath(pipeline, ID.dual, listUrl(ID.bizB));
      expect(listRes.status, describeBody(listRes)).toBe(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.data[0]).toMatchObject({
        id: ID.orderB1,
        total: 999,
        currency: 'USD',
        paymentStatus: 'PAID',
        paymentRef: SECRET_PAYMENT_REF_B1,
      });

      const detailRes = await getPath(pipeline, ID.dual, detailUrl(ID.bizB, ID.orderB1));
      expect(detailRes.status, describeBody(detailRes)).toBe(200);
      expect(detailRes.body).toMatchObject({
        id: ID.orderB1,
        total: 999,
        paymentRef: SECRET_PAYMENT_REF_B1,
      });
    });

    it('non-member (ownerB) gets 403 on bizA list and detail and learns nothing', async () => {
      const listRes = await getPath(pipeline, ID.ownerB, listUrl(ID.bizA));
      expect(listRes.status, describeBody(listRes)).toBe(403);
      expect(JSON.stringify(listRes.body)).not.toContain(SECRET_PAYMENT_REF_A1);

      const detailRes = await getPath(pipeline, ID.ownerB, detailUrl(ID.bizA, ID.orderA1));
      expect(detailRes.status, describeBody(detailRes)).toBe(403);
      expect(JSON.stringify(detailRes.body)).not.toContain(SECRET_PAYMENT_REF_A1);
    });

    it('tenant A callers (both revenue reader and revenue:none) requesting tenant B orderId under bizA URL get 404', async () => {
      for (const actor of [ID.ownerA, ID.storefrontOnly]) {
        const res = await getPath(pipeline, actor, detailUrl(ID.bizA, ID.orderB1));
        expect(res.status, `${actor}: ${describeBody(res)}`).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(SECRET_PAYMENT_REF_B1);
      }
    });
  });
});
