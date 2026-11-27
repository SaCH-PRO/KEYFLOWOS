/**
 * P139 — FU-CASE-STUDY-REVENUE (server, P2 launch-track, S, Journey H, D-100):
 *
 * Real Postgres + real NestJS HTTP app (`SiteController`, `CaseStudyService`,
 * `AuthGuard`, `BusinessGuard`, `ModuleScopeGuard`, `GlobalHttpExceptionFilter`)
 * across both `production` (TenantInterceptor + tenant extension) and `bare`
 * pipelines, proving that case-study endpoints withhold `recentRevenue` and all
 * sibling revenue / paid-order metrics (`priorRevenue`, `revenueGrowthPct`,
 * `recentOrders`, `priorOrders`, `orderGrowthPct`, `topProduct`, and revenue /
 * paid-order headline clauses) when the acting member lacks `revenue:read`:
 *
 *   - [CSR-01] RED-BEFORE: members below `revenue:read` (STAFF with `revenue: 'none'`,
 *              STAFF with explicit `{ content: 'write' }` omitting revenue, OWNER with
 *              explicit `{ content: 'write', revenue: 'none' }` per D-114/D-140, ADMIN
 *              with `revenue: 'none'`, STAFF with JSON array `permissionScopes: []` per
 *              SV-4, dual member who is OWNER only in bizB) receive `200` on
 *              `GET /site/businesses/:b/case-studies` with non-money booking/study
 *              metrics intact (`windowDays`, `currency`, `recentBookings`, `priorBookings`,
 *              `bookingGrowthPct`, `topService`), while every revenue & paid-order key is
 *              absent (not zero) and `headline` leaks zero revenue/paid-order figures.
 *              Direct `CaseStudyService.list(bizA, null)` / `list(bizA, undefined)` also
 *              fail closed.
 *   - [CSR-02] Control: OWNER (default scopes), STAFF (default scopes), STAFF with
 *              explicit `revenue: 'read'`, and platform `SUPER_ADMIN` receive full
 *              `recentRevenue` and sibling metrics matching seeded paid orders, unchanged.
 *   - [CSR-03] Auth & cross-tenant: unauthenticated requests get `401`; foreign business
 *              OWNER gets `403` with zero bizA data; dual member reads bizB's own revenue
 *              as bizB's OWNER and sees zero bizA data.
 *   - [CSR-04] RED-BEFORE (sibling write/generate/publish/unpublish endpoints + query skip):
 *              - `POST /site/businesses/:b/case-studies/generate` by `content:write` +
 *                `revenue:none` skips all paid-order DB queries (`marketplaceOrder.findMany`
 *                and `marketplaceOrderItem.groupBy` count === 0), returns zero revenue /
 *                paid-order fields or headline text, and does NOT clobber the OWNER's
 *                persisted revenue metrics on an existing case study; `ownerA` calling
 *                `POST .../generate` DOES run the paid-order queries and returns full metrics.
 *              - `POST /site/businesses/:b/case-studies/:id/publish` by `content:write` +
 *                `revenue:none` on a revenue-bearing draft is refused `403` (cannot leak
 *                private revenue draft to the unauthenticated public storefront); `ownerA`
 *                can publish it (`201`) and `listPublic` serves it; `staffRevNone` calling
 *                `POST .../unpublish` returns `201` with revenue/paid-order fields withheld.
 *              - On a fresh business with bookings (`bizC`), `staffRevNone` can generate a
 *                booking-only draft (zero paid-order queries) and publish it (`201`) with
 *                zero revenue metrics on both the response and the public storefront.
 *
 * Every seeded row carries the `v91k_` prefix and is hard-deleted by raw SQL
 * with `sqlLikePrefix(P)` in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91k_';
const HEADER = 'x-v91k-user';

const ID = {
  ownerA: `${P}ownerA`,               // OWNER of bizA, default scopes (null)
  ownerRevNone: `${P}ownerRevNone`,   // OWNER of bizA, explicit { content: 'write', revenue: 'none' }
  staffDefaults: `${P}staffDef`,      // STAFF of bizA, default scopes (null -> revenue: 'read')
  staffRevNone: `${P}staffRevNone`,   // STAFF of bizA & bizC, explicit { content: 'write', revenue: 'none' }
  staffContentOnly: `${P}staffCont`,  // STAFF of bizA, explicit { content: 'write' } (revenue omitted -> none)
  adminRevNone: `${P}adminRevNone`,   // ADMIN of bizA, explicit { content: 'admin', revenue: 'none' }
  arrayScopes: `${P}arrayScopes`,     // STAFF of bizA, permissionScopes: [] (SV-4 -> all none)
  staffRevRead: `${P}staffRevRead`,   // STAFF of bizA, explicit { content: 'write', revenue: 'read' }
  dual: `${P}dual`,                   // { content: 'read' } in bizA, OWNER in bizB
  ownerB: `${P}ownerB`,               // OWNER of bizB
  ownerC: `${P}ownerC`,               // OWNER of bizC (fresh booking-only generate test)
  superAdmin: `${P}superAdmin`,       // platform SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactC: `${P}contactC`,
  serviceA: `${P}svcA`,
  serviceB: `${P}svcB`,
  serviceC: `${P}svcC`,
  productA: `${P}prodA`,
  productC: `${P}prodC`,
};

const SLUG_A = 'v91k-biz-a';
const SLUG_B = 'v91k-biz-b';
const SLUG_C = 'v91k-biz-c';

// Paid order amounts for bizA:
//   recent 60d: 3000 + 1800 = 4800 (2 orders)
//   prior 60d:  1200 (1 order)
//   revenueGrowthPct = round((4800 - 1200) / 1200 * 100) = 300
//   orderGrowthPct   = round((2 - 1) / 1 * 100) = 100
const RECENT_REV_A_1 = 3000;
const RECENT_REV_A_2 = 1800;
const RECENT_REV_A = RECENT_REV_A_1 + RECENT_REV_A_2;
const PRIOR_REV_A = 1200;
const REV_GROWTH_A = 300;
const ORDER_GROWTH_A = 100;
const RECENT_REV_B = 9500;

const WITHHELD_METRIC_KEYS = [
  'recentRevenue',
  'priorRevenue',
  'revenueGrowthPct',
  'recentOrders',
  'priorOrders',
  'orderGrowthPct',
  'topProduct',
] as const;

const OFF_BOUNDARY = new Set([
  'SiteService',
  'StoreOrderService',
  'PromoCodeService',
  'IntakeService',
  'QualificationService',
  'CustomerReferralService',
  'PaymentsService',
  'StorefrontConversionService',
]);

type Pipeline = 'production' | 'bare';
const PIPELINES: Pipeline[] = ['production', 'bare'];

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
const apps: Partial<Record<Pipeline, any>> = {};
const services: Partial<Record<Pipeline, any>> = {};
let seededStudyIdA = '';
let initialMetaA: any = {};
/* eslint-enable @typescript-eslint/no-explicit-any */

const queryCounters: Record<Pipeline, { orderFindMany: number; orderItemGroupBy: number }> = {
  production: { orderFindMany: 0, orderItemGroupBy: 0 },
  bare: { orderFindMany: 0, orderItemGroupBy: 0 },
};

function resetCounters(pipeline: Pipeline) {
  queryCounters[pipeline].orderFindMany = 0;
  queryCounters[pipeline].orderItemGroupBy = 0;
}

const has = (o: unknown, k: string) =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

const describeBody = (res: { status: number; body: unknown }) =>
  `${res.status} ${JSON.stringify(res.body)}`;

async function cleanup() {
  for (const sql of [
    `DELETE FROM marketplace_order_items WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function getStudies(pipeline: Pipeline, user: string | null, businessId: string) {
  const req = request(apps[pipeline]!.getHttpServer()).get(`/site/businesses/${businessId}/case-studies`);
  if (user !== null) req.set(HEADER, user);
  return req;
}

function postGenerate(pipeline: Pipeline, user: string | null, businessId: string) {
  const req = request(apps[pipeline]!.getHttpServer()).post(
    `/site/businesses/${businessId}/case-studies/generate`,
  );
  if (user !== null) req.set(HEADER, user);
  return req;
}

function postPublish(pipeline: Pipeline, user: string | null, businessId: string, caseStudyId: string) {
  const req = request(apps[pipeline]!.getHttpServer())
    .post(`/site/businesses/${businessId}/case-studies/${caseStudyId}/publish`)
    .send({ consent: true });
  if (user !== null) req.set(HEADER, user);
  return req;
}

function postUnpublish(pipeline: Pipeline, user: string | null, businessId: string, caseStudyId: string) {
  const req = request(apps[pipeline]!.getHttpServer()).post(
    `/site/businesses/${businessId}/case-studies/${caseStudyId}/unpublish`,
  );
  if (user !== null) req.set(HEADER, user);
  return req;
}

function getPublicStudies(pipeline: Pipeline, slug: string) {
  return request(apps[pipeline]!.getHttpServer()).get(`/site/storefront/public/${slug}/case-studies`);
}

function expectRedactedCaseStudyA(study: any, context: string) {
  expect(study.id, context).toBe(seededStudyIdA);
  expect(study.businessId, context).toBe(ID.bizA);
  expect(study.location, context).toBe('Port of Spain, TT');
  expect(study.industry, context).toBe('Beauty');
  expect(typeof study.generatedAt, context).toBe('string');

  const m = study.metrics;
  expect(m, context).toBeDefined();
  for (const key of WITHHELD_METRIC_KEYS) {
    expect(has(m, key), `withheld key "${key}" present in ${context}`).toBe(false);
  }
  expect(m.windowDays, context).toBe(60);
  expect(m.currency, context).toBe('TTD');
  expect(m.recentBookings, context).toBe(3);
  expect(m.priorBookings, context).toBe(2);
  expect(m.bookingGrowthPct, context).toBe(50);
  expect(m.topService, context).toBe('Signature Facial');

  expect(study.headline, context).not.toMatch(/revenue/i);
  expect(study.headline, context).not.toMatch(/online orders/i);
  const raw = JSON.stringify(study);
  expect(raw, context).not.toContain(String(RECENT_REV_A));
  expect(raw, context).not.toContain(String(PRIOR_REV_A));
  expect(raw, context).not.toContain(`${REV_GROWTH_A}%`);
}

function expectFullCaseStudyA(study: any, context: string) {
  expect(study.id, context).toBe(seededStudyIdA);
  expect(study.businessId, context).toBe(ID.bizA);
  expect(study.headline, context).toContain(`grew revenue ${REV_GROWTH_A}%`);
  expect(study.metrics, context).toMatchObject({
    windowDays: 60,
    recentOrders: 2,
    priorOrders: 1,
    recentRevenue: RECENT_REV_A,
    priorRevenue: PRIOR_REV_A,
    currency: 'TTD',
    recentBookings: 3,
    priorBookings: 2,
    orderGrowthPct: ORDER_GROWTH_A,
    revenueGrowthPct: REV_GROWTH_A,
    bookingGrowthPct: 50,
    topService: 'Signature Facial',
    topProduct: 'Glow Serum',
  });
}

function wrapPrismaWithQueryCounters(prismaService: any, pipeline: Pipeline) {
  const realClient = prismaService.client;
  const wrappedClient = new Proxy(realClient, {
    get(target, prop, receiver) {
      if (prop === 'marketplaceOrder') {
        const delegate = Reflect.get(target, prop, receiver);
        return new Proxy(delegate, {
          get(dTarget, dProp, dReceiver) {
            const val = Reflect.get(dTarget, dProp, dReceiver);
            if (dProp === 'findMany' && typeof val === 'function') {
              return (...args: unknown[]) => {
                queryCounters[pipeline].orderFindMany += 1;
                return val.apply(dTarget, args);
              };
            }
            return typeof val === 'function' ? val.bind(dTarget) : val;
          },
        });
      }
      if (prop === 'marketplaceOrderItem') {
        const delegate = Reflect.get(target, prop, receiver);
        return new Proxy(delegate, {
          get(dTarget, dProp, dReceiver) {
            const val = Reflect.get(dTarget, dProp, dReceiver);
            if (dProp === 'groupBy' && typeof val === 'function') {
              return (...args: unknown[]) => {
                queryCounters[pipeline].orderItemGroupBy += 1;
                return val.apply(dTarget, args);
              };
            }
            return typeof val === 'function' ? val.bind(dTarget) : val;
          },
        });
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  return new Proxy(prismaService, {
    get(target, prop, receiver) {
      if (prop === 'client') return wrappedClient;
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');

  Logger.overrideLogger(false);

  const realPrisma = new PrismaService();
  await realPrisma.onModuleInit();

  const redisStub = {
    pipeline: () => {
      const pipe = {
        zremrangebyscore: () => pipe,
        zcard: () => pipe,
        exec: async () => [[null, 0], [null, 0]],
      };
      return pipe;
    },
    zadd: async () => 1,
    pexpire: async () => 1,
  };

  const build = async (pipeline: Pipeline) => {
    const countedPrisma = wrapPrismaWithQueryCounters(realPrisma, pipeline);
    const moduleRef = await Test.createTestingModule({
      controllers: [SiteController],
      providers: [
        { provide: PrismaService, useValue: countedPrisma },
        { provide: REDIS_CLIENT, useValue: redisStub },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        CaseStudyService,
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
    services[pipeline] = moduleRef.get(CaseStudyService);
    return nest;
  };

  apps.production = await build('production');
  apps.bare = await build('bare');

  await cleanup();

  const users: Array<[string, string]> = [
    [ID.ownerA, 'USER'],
    [ID.ownerRevNone, 'USER'],
    [ID.staffDefaults, 'USER'],
    [ID.staffRevNone, 'USER'],
    [ID.staffContentOnly, 'USER'],
    [ID.adminRevNone, 'USER'],
    [ID.arrayScopes, 'USER'],
    [ID.staffRevRead, 'USER'],
    [ID.dual, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.ownerC, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ];
  for (const [id, role] of users) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@test.local`, role },
    });
  }

  await db.business.create({
    data: {
      id: ID.bizA,
      name: 'V91K Salon',
      city: 'Port of Spain',
      country: 'TT',
      industry: 'Beauty',
      slug: SLUG_A,
      currency: 'TTD',
      ownerId: ID.ownerA,
    },
  });
  await db.business.create({
    data: {
      id: ID.bizB,
      name: 'V91K Studio B',
      city: 'Bridgetown',
      country: 'BB',
      industry: 'Fitness',
      slug: SLUG_B,
      currency: 'TTD',
      ownerId: ID.ownerB,
    },
  });
  await db.business.create({
    data: {
      id: ID.bizC,
      name: 'V91K Wellness C',
      city: 'Kingston',
      country: 'JM',
      industry: 'Wellness',
      slug: SLUG_C,
      currency: 'JMD',
      ownerId: ID.ownerC,
    },
  });

  const memberships: Array<[string, string, string, unknown]> = [
    [ID.ownerA, ID.bizA, 'OWNER', undefined],
    [ID.ownerRevNone, ID.bizA, 'OWNER', { content: 'write', revenue: 'none' }],
    [ID.staffDefaults, ID.bizA, 'STAFF', undefined],
    [ID.staffRevNone, ID.bizA, 'STAFF', { content: 'write', revenue: 'none' }],
    [ID.staffContentOnly, ID.bizA, 'STAFF', { content: 'write' }],
    [ID.adminRevNone, ID.bizA, 'ADMIN', { content: 'admin', revenue: 'none' }],
    [ID.arrayScopes, ID.bizA, 'STAFF', []],
    [ID.staffRevRead, ID.bizA, 'STAFF', { content: 'write', revenue: 'read' }],
    [ID.dual, ID.bizA, 'STAFF', { content: 'read' }],
    [ID.dual, ID.bizB, 'OWNER', undefined],
    [ID.ownerB, ID.bizB, 'OWNER', undefined],
    [ID.ownerC, ID.bizC, 'OWNER', undefined],
    [ID.staffRevNone, ID.bizC, 'STAFF', { content: 'write', revenue: 'none' }],
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

  await db.contact.createMany({
    data: [
      { id: ID.contactA, businessId: ID.bizA, firstName: 'V91K', lastName: 'ClientA' },
      { id: ID.contactB, businessId: ID.bizB, firstName: 'V91K', lastName: 'ClientB' },
      { id: ID.contactC, businessId: ID.bizC, firstName: 'V91K', lastName: 'ClientC' },
    ],
  });

  await db.service.createMany({
    data: [
      { id: ID.serviceA, businessId: ID.bizA, name: 'Signature Facial', duration: 60, price: 350 },
      { id: ID.serviceB, businessId: ID.bizB, name: 'Private Training', duration: 60, price: 500 },
      { id: ID.serviceC, businessId: ID.bizC, name: 'Deep Massage', duration: 90, price: 450 },
    ],
  });

  await db.product.createMany({
    data: [
      { id: ID.productA, businessId: ID.bizA, name: 'Glow Serum', price: 1500, currency: 'TTD' },
      { id: ID.productC, businessId: ID.bizC, name: 'Calm Oil', price: 2200, currency: 'JMD' },
    ],
  });

  const now = Date.now();
  const recentDate = new Date(now - 5 * 24 * 60 * 60 * 1000);
  const priorDate = new Date(now - 75 * 24 * 60 * 60 * 1000);

  // bizA paid orders: 2 recent (3000 + 1800 = 4800), 1 prior (1200)
  await db.marketplaceOrder.create({
    data: {
      id: `${P}ordA1`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-A1`,
      customerName: 'V91K Buyer 1',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: RECENT_REV_A_1,
      total: RECENT_REV_A_1,
      currency: 'TTD',
      createdAt: recentDate,
    },
  });
  await db.marketplaceOrder.create({
    data: {
      id: `${P}ordA2`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-A2`,
      customerName: 'V91K Buyer 2',
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      subtotal: RECENT_REV_A_2,
      total: RECENT_REV_A_2,
      currency: 'TTD',
      createdAt: recentDate,
    },
  });
  await db.marketplaceOrder.create({
    data: {
      id: `${P}ordA3`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-A3`,
      customerName: 'V91K Buyer Prior',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: PRIOR_REV_A,
      total: PRIOR_REV_A,
      currency: 'TTD',
      createdAt: priorDate,
    },
  });
  await db.marketplaceOrderItem.create({
    data: {
      id: `${P}oiA1`,
      orderId: `${P}ordA1`,
      productId: ID.productA,
      name: 'Glow Serum',
      quantity: 2,
      unitPrice: 1500,
      total: RECENT_REV_A_1,
      currency: 'TTD',
    },
  });

  // bizA confirmed bookings: 3 recent, 2 prior (bookingGrowthPct = 50)
  for (let i = 0; i < 3; i++) {
    const start = new Date(recentDate.getTime() + i * 3_600_000);
    await db.booking.create({
      data: {
        id: `${P}bkARec${i}`,
        businessId: ID.bizA,
        contactId: ID.contactA,
        serviceId: ID.serviceA,
        status: 'CONFIRMED',
        startTime: start,
        endTime: new Date(start.getTime() + 3_600_000),
        createdAt: recentDate,
      },
    });
  }
  for (let i = 0; i < 2; i++) {
    const start = new Date(priorDate.getTime() + i * 3_600_000);
    await db.booking.create({
      data: {
        id: `${P}bkAPri${i}`,
        businessId: ID.bizA,
        contactId: ID.contactA,
        serviceId: ID.serviceA,
        status: 'COMPLETED',
        startTime: start,
        endTime: new Date(start.getTime() + 3_600_000),
        createdAt: priorDate,
      },
    });
  }

  // bizB paid order (9500) + 1 confirmed booking
  await db.marketplaceOrder.create({
    data: {
      id: `${P}ordB1`,
      businessId: ID.bizB,
      orderNumber: `${P}ORD-B1`,
      customerName: 'V91K Buyer B',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: RECENT_REV_B,
      total: RECENT_REV_B,
      currency: 'TTD',
      createdAt: recentDate,
    },
  });
  await db.booking.create({
    data: {
      id: `${P}bkB1`,
      businessId: ID.bizB,
      contactId: ID.contactB,
      serviceId: ID.serviceB,
      status: 'CONFIRMED',
      startTime: recentDate,
      endTime: new Date(recentDate.getTime() + 3_600_000),
      createdAt: recentDate,
    },
  });

  // bizC: both paid orders (secret 6600 JMD) AND confirmed bookings (2 recent), no pre-generated draft
  await db.marketplaceOrder.create({
    data: {
      id: `${P}ordC1`,
      businessId: ID.bizC,
      orderNumber: `${P}ORD-C1`,
      customerName: 'V91K Buyer C',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: 6600,
      total: 6600,
      currency: 'JMD',
      createdAt: recentDate,
    },
  });
  await db.marketplaceOrderItem.create({
    data: {
      id: `${P}oiC1`,
      orderId: `${P}ordC1`,
      productId: ID.productC,
      name: 'Calm Oil',
      quantity: 3,
      unitPrice: 2200,
      total: 6600,
      currency: 'JMD',
    },
  });
  for (let i = 0; i < 2; i++) {
    const start = new Date(recentDate.getTime() + i * 3_600_000);
    await db.booking.create({
      data: {
        id: `${P}bkC${i}`,
        businessId: ID.bizC,
        contactId: ID.contactC,
        serviceId: ID.serviceC,
        status: 'CONFIRMED',
        startTime: start,
        endTime: new Date(start.getTime() + 3_600_000),
        createdAt: recentDate,
      },
    });
  }

  // Generate baseline case studies for bizA and bizB as their respective OWNERs
  const genA = await postGenerate('production', ID.ownerA, ID.bizA);
  expect(genA.status, describeBody(genA)).toBe(201);
  seededStudyIdA = genA.body.id;
  expectFullCaseStudyA(genA.body, 'baseline seed bizA');

  const genB = await postGenerate('production', ID.ownerB, ID.bizB);
  expect(genB.status, describeBody(genB)).toBe(201);
  expect(genB.body.metrics.recentRevenue).toBe(RECENT_REV_B);

  const bizARow = await db.business.findUnique({ where: { id: ID.bizA }, select: { metaData: true } });
  initialMetaA = bizARow?.metaData ?? {};
}, 120_000);

afterAll(async () => {
  for (const app of Object.values(apps)) await app?.close();
  if (db) await cleanup();
});

const NON_READERS: Array<[string, string]> = [
  ['STAFF with explicit { content: write, revenue: none }', ID.staffRevNone],
  ['STAFF with explicit { content: write } (revenue omitted)', ID.staffContentOnly],
  ['OWNER with explicit { content: write, revenue: none } (D-114/D-140)', ID.ownerRevNone],
  ['ADMIN with explicit { content: admin, revenue: none }', ID.adminRevNone],
  ['STAFF with permissionScopes JSON array [] (SV-4)', ID.arrayScopes],
  ['dual member with revenue read only in bizB', ID.dual],
];

const READERS: Array<[string, string]> = [
  ['OWNER (default scopes)', ID.ownerA],
  ['STAFF (default scopes)', ID.staffDefaults],
  ['STAFF with explicit { content: write, revenue: read }', ID.staffRevRead],
  ['platform SUPER_ADMIN', ID.superAdmin],
];

describe.each(PIPELINES)('FU-CASE-STUDY-REVENUE (%s pipeline)', (pipeline) => {
  describe('[CSR-01] RED-BEFORE: revenue:none readers do not receive recentRevenue or sibling paid-order metrics', () => {
    it.each(NON_READERS)('%s', async (_label, user) => {
      const res = await getStudies(pipeline, user, ID.bizA);
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body).toHaveLength(1);
      expectRedactedCaseStudyA(res.body[0], `${pipeline} ${_label}: ${describeBody(res)}`);
    });

    it('direct CaseStudyService.list fails closed when actor is null or undefined', async () => {
      const svc = services[pipeline]!;
      for (const actor of [null, undefined]) {
        const studies = await svc.list(ID.bizA, actor);
        expect(studies).toHaveLength(1);
        expectRedactedCaseStudyA(studies[0], `${pipeline} actor=${String(actor)}`);
      }
    });
  });

  describe('[CSR-02] Control: OWNER, revenue:read STAFF, and SUPER_ADMIN receive full recentRevenue unchanged', () => {
    it.each(READERS)('%s', async (_label, user) => {
      const res = await getStudies(pipeline, user, ID.bizA);
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body).toHaveLength(1);
      expectFullCaseStudyA(res.body[0], `${pipeline} ${_label}: ${describeBody(res)}`);
    });
  });

  describe('[CSR-03] Auth & cross-tenant isolation', () => {
    it('unauthenticated requests are refused with 401', async () => {
      const getRes = await getStudies(pipeline, null, ID.bizA);
      expect(getRes.status, describeBody(getRes)).toBe(401);

      const genRes = await postGenerate(pipeline, null, ID.bizA);
      expect(genRes.status, describeBody(genRes)).toBe(401);
    });

    it('foreign tenant owner is refused with 403 and sees zero bizA data', async () => {
      const getRes = await getStudies(pipeline, ID.ownerB, ID.bizA);
      expect(getRes.status, describeBody(getRes)).toBe(403);
      expect(JSON.stringify(getRes.body)).not.toContain(String(RECENT_REV_A));
      expect(JSON.stringify(getRes.body)).not.toContain('Signature Facial');

      const genRes = await postGenerate(pipeline, ID.ownerB, ID.bizA);
      expect(genRes.status, describeBody(genRes)).toBe(403);
    });

    it('dual member reads bizB revenue as bizB OWNER and sees zero bizA data', async () => {
      const res = await getStudies(pipeline, ID.dual, ID.bizB);
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].businessId).toBe(ID.bizB);
      expect(res.body[0].metrics.recentRevenue).toBe(RECENT_REV_B);
      expect(JSON.stringify(res.body)).not.toContain(String(RECENT_REV_A));
    });
  });

  describe('[CSR-04] RED-BEFORE: sibling generate / publish / unpublish respect revenue:read and skip paid-order queries', () => {
    it('POST .../generate by revenue:none skips paid-order queries, withholds revenue fields, and preserves OWNER persisted revenue', async () => {
      try {
        resetCounters(pipeline);
        const nonReaderRes = await postGenerate(pipeline, ID.staffRevNone, ID.bizA);
        expect(nonReaderRes.status, describeBody(nonReaderRes)).toBe(201);
        expectRedactedCaseStudyA(nonReaderRes.body, `${pipeline} staffRevNone generate`);
        expect(queryCounters[pipeline].orderFindMany, 'marketplaceOrder.findMany must be skipped for !readsRevenue').toBe(0);
        expect(queryCounters[pipeline].orderItemGroupBy, 'marketplaceOrderItem.groupBy must be skipped for !readsRevenue').toBe(0);

        // Persisted OWNER revenue metrics must NOT have been wiped out
        const ownerList = await getStudies(pipeline, ID.ownerA, ID.bizA);
        expect(ownerList.status, describeBody(ownerList)).toBe(200);
        expectFullCaseStudyA(ownerList.body[0], `${pipeline} ownerA after staffRevNone generate`);

        // Positive control: OWNER generate DOES run the paid-order queries (spy is not blind)
        resetCounters(pipeline);
        const ownerGen = await postGenerate(pipeline, ID.ownerA, ID.bizA);
        expect(ownerGen.status, describeBody(ownerGen)).toBe(201);
        expectFullCaseStudyA(ownerGen.body, `${pipeline} ownerA generate`);
        expect(queryCounters[pipeline].orderFindMany, 'ownerA generate runs paid-order queries').toBe(2);
        expect(queryCounters[pipeline].orderItemGroupBy, 'ownerA generate runs paid-order-item query').toBe(1);
      } finally {
        await db.business.update({ where: { id: ID.bizA }, data: { metaData: initialMetaA } });
      }
    });

    it('POST .../publish refuses revenue:none on a revenue-bearing draft (403); OWNER can publish; unpublish by revenue:none withholds revenue fields', async () => {
      try {
        const blockedPub = await postPublish(pipeline, ID.staffRevNone, ID.bizA, seededStudyIdA);
        expect(blockedPub.status, describeBody(blockedPub)).toBe(403);
        expect(JSON.stringify(blockedPub.body)).not.toContain(String(RECENT_REV_A));

        const pubBefore = await getPublicStudies(pipeline, SLUG_A);
        expect(pubBefore.status).toBe(200);
        expect(pubBefore.body).toEqual([]);

        const ownerPub = await postPublish(pipeline, ID.ownerA, ID.bizA, seededStudyIdA);
        expect(ownerPub.status, describeBody(ownerPub)).toBe(201);
        expect(ownerPub.body.status).toBe('published');
        expectFullCaseStudyA(ownerPub.body, `${pipeline} ownerA publish`);

        const pubAfter = await getPublicStudies(pipeline, SLUG_A);
        expect(pubAfter.status).toBe(200);
        expect(pubAfter.body).toHaveLength(1);
        expect(pubAfter.body[0].metrics.recentRevenue).toBe(RECENT_REV_A);

        const staffUnpub = await postUnpublish(pipeline, ID.staffRevNone, ID.bizA, seededStudyIdA);
        expect(staffUnpub.status, describeBody(staffUnpub)).toBe(201);
        expect(staffUnpub.body.status).toBe('draft');
        expectRedactedCaseStudyA(staffUnpub.body, `${pipeline} staffRevNone unpublish`);
      } finally {
        await db.business.update({ where: { id: ID.bizA }, data: { metaData: initialMetaA } });
      }
    });

    it('fresh business with bookings: revenue:none generates and publishes a booking-only draft without running paid-order queries or leaking revenue', async () => {
      await db.business.update({ where: { id: ID.bizC }, data: { metaData: {} } });
      try {
        resetCounters(pipeline);
        const genC = await postGenerate(pipeline, ID.staffRevNone, ID.bizC);
        expect(genC.status, describeBody(genC)).toBe(201);
        expect(queryCounters[pipeline].orderFindMany).toBe(0);
        expect(queryCounters[pipeline].orderItemGroupBy).toBe(0);
        for (const key of WITHHELD_METRIC_KEYS) {
          expect(has(genC.body.metrics, key), `bizC generate leaked ${key}`).toBe(false);
        }
        expect(genC.body.metrics).toMatchObject({
          windowDays: 60,
          currency: 'JMD',
          recentBookings: 2,
          priorBookings: 0,
          bookingGrowthPct: null,
          topService: 'Deep Massage',
        });
        expect(JSON.stringify(genC.body)).not.toContain('6600');
        expect(JSON.stringify(genC.body)).not.toContain('Calm Oil');

        const pubC = await postPublish(pipeline, ID.staffRevNone, ID.bizC, genC.body.id);
        expect(pubC.status, describeBody(pubC)).toBe(201);
        expect(pubC.body.status).toBe('published');
        expect(JSON.stringify(pubC.body)).not.toContain('6600');

        const publicC = await getPublicStudies(pipeline, SLUG_C);
        expect(publicC.status).toBe(200);
        expect(publicC.body).toHaveLength(1);
        expect(JSON.stringify(publicC.body)).not.toContain('6600');
      } finally {
        await db.business.update({ where: { id: ID.bizC }, data: { metaData: {} } });
      }
    });
  });
});
