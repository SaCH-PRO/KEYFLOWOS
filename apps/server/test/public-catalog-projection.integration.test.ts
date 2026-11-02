/**
 * V1-23-PUB-PUBLIC-PROJECTIONS — what an anonymous visitor reads of the
 * catalog, the services and the staff (REAL database, REAL Redis).
 *
 * M36 (build map): public product, staff and service endpoints spread full
 * rows. At the V1-06 head (claude/elegant-curie-7azpsb):
 *
 *   - GET /catalog/public/businesses/:id/products returns {...product} per row
 *     (catalog.service.ts listPublicProducts, ~128-148): downloadUrl (the paid
 *     file), licenseTerms, sku, fulfillmentModel ('dropship' names the supply
 *     route), executionMeta, timestamps. It ignores Business.storeEnabled and
 *     carries no PublicRateLimit (catalog.controller.ts:19-22).
 *   - GET /commerce/public/businesses/:id/products, the route the /book
 *     storefront actually calls, is a pass-through to the same service.
 *   - GET /bookings/public/businesses/:id/staff returns the StaffMember row:
 *     hourlyRate (staff pay) and maxHoursPerWeek. .../services returns the
 *     Service row: invoiceTiming, deposit terms, sourceProductId. Neither reads
 *     storeEnabled, although the public create on the same controller refuses
 *     a closed store (bookings.service.ts publicCreateBooking).
 *   - GET /site/storefront/public/:slug (site.service.ts getPublicStorefront)
 *     honours storeEnabled (CF-56) but returns the same full product and
 *     service rows.
 *
 * Contract pinned here:
 *
 *   products (catalog + commerce) -> exactly PRODUCT_KEYS: the fields /book reads
 *                                    plus compareAtPrice; the canary planted in
 *                                    downloadUrl, licenseTerms, sku and
 *                                    executionMeta appears nowhere
 *   staff                         -> exactly { id, name }
 *   services                      -> exactly { id, name, description, duration, price }
 *   site storefront               -> the same product (no availability) and service projections
 *   storeEnabled=false            -> 404, the same body as a business that does not exist,
 *                                    on products, staff and services; a store that is
 *                                    on but lists nothing is still 200 []
 *   rate limit                    -> the catalog products route carries
 *                                    @PublicRateLimit(N <= 60, >= 60s); request N+1
 *                                    in the window is a 429. Staff and services were
 *                                    already limited (regression controls)
 *   POSITIVE CONTROL              -> the reads the /book page makes on load still answer
 *                                    200 with every field the page maps
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), CatalogController,
 * CatalogService, CommerceController + CommerceService (the /book products
 * route), BookingsController and SiteController + SiteService read real rows
 * behind the production GlobalHttpExceptionFilter and ValidationPipe. Every
 * request is anonymous. Collaborators the public reads never call (booking
 * engine, waitlist, calendar, ledger, AI, orders, promo codes...) are stubs.
 *
 * Fixtures: prefix `v23a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v23a_';

/** Every fixture string that must never reach a public payload carries this. */
const CANARY = 'V23A_SECRET_';

// This suite's public rate-limit keys live under its own namespace, so the
// resets below never touch another suite's windows on the same Redis index.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  ownerOff: `${P}ownerOff`,
  ownerEmpty: `${P}ownerEmpty`,
  bizA: `${P}bizA`, // storeEnabled: true, one product, service and staff member
  bizOff: `${P}bizOff`, // storeEnabled: false, the same rows
  bizEmpty: `${P}bizEmpty`, // storeEnabled: true, lists nothing
  prodA: `${P}prodA`,
  prodInactive: `${P}prodInactive`,
  prodOff: `${P}prodOff`,
  svcA: `${P}svcA`,
  svcOff: `${P}svcOff`,
  staffA: `${P}staffA`,
  staffOff: `${P}staffOff`,
};
const SLUG = { a: `${P}store-a`, off: `${P}store-off`, empty: `${P}store-empty` };
const UNKNOWN_BIZ = `${P}nosuchbiz`;

/** The /book product contract: CommerceProduct (web components/types.ts) plus compareAtPrice. */
const PRODUCT_KEYS = [
  'availableQuantity', 'category', 'compareAtPrice', 'currency', 'description', 'duration',
  'id', 'imageUrl', 'isActive', 'name', 'outOfStockBehavior', 'price', 'purchasable', 'stockStatus',
];
/** The site storefront lists products without the stock projection. */
const SITE_PRODUCT_KEYS = [
  'category', 'compareAtPrice', 'currency', 'description', 'duration', 'id', 'imageUrl', 'isActive', 'name', 'price',
];
const SERVICE_KEYS = ['description', 'duration', 'id', 'name', 'price'];
const STAFF_KEYS = ['id', 'name'];

/** Product columns a visitor must never read (M36). */
const PRODUCT_SECRET_KEYS = [
  'downloadUrl', 'licenseTerms', 'sku', 'fulfillmentModel', 'inventoryMode', 'executionMeta',
  'businessId', 'createdAt', 'updatedAt', 'deletedAt',
];
const STAFF_SECRET_KEYS = ['hourlyRate', 'maxHoursPerWeek', 'businessId', 'createdAt', 'updatedAt', 'deletedAt'];
const SERVICE_SECRET_KEYS = [
  'invoiceTiming', 'depositRequired', 'depositType', 'depositValue', 'sourceProductId',
  'bufferMins', 'leadTimeMins', 'businessId', 'createdAt', 'updatedAt', 'deletedAt',
];

let db: any;
let app: any;
let redis: any;
let CatalogControllerClass: any;
let BookingsControllerClass: any;
let PUBLIC_RATE_LIMIT_KEY_VALUE: string;

async function cleanup() {
  for (const sql of [
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

const catalogProducts = (biz: string) => agent().get(`/catalog/public/businesses/${encodeURIComponent(biz)}/products`);
const commerceProducts = (biz: string) => agent().get(`/commerce/public/businesses/${encodeURIComponent(biz)}/products`);
const publicStaff = (biz: string) => agent().get(`/bookings/public/businesses/${encodeURIComponent(biz)}/staff`);
const publicServices = (biz: string) => agent().get(`/bookings/public/businesses/${encodeURIComponent(biz)}/services`);
const siteStorefront = (slug: string) => agent().get(`/site/storefront/public/${encodeURIComponent(slug)}`);

function sortedKeys(row: unknown): string[] {
  return Object.keys((row ?? {}) as Record<string, unknown>).sort();
}

function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {}), 'canary in a public payload').not.toContain(CANARY);
}

function expectRowsProjected(rows: unknown, keys: string[], secret: string[], label: string) {
  expect(Array.isArray(rows), `${label}: an array`).toBe(true);
  const list = rows as Array<Record<string, unknown>>;
  expect(list.length, `${label}: at least one row`).toBeGreaterThan(0);
  for (const row of list) {
    for (const k of secret) expect(Object.prototype.hasOwnProperty.call(row, k), `${label}: ${k} present`).toBe(false);
    expect(sortedKeys(row), `${label}: exact projection`).toEqual([...keys].sort());
  }
  expectNoCanary(rows);
}

/** A 404 must not tell a closed store from one that does not exist. */
function stripVolatile(body: Record<string, unknown>) {
  const { timestamp: _t, path: _p, correlationId: _c, ...rest } = body ?? {};
  return rest;
}

/** limit + 1 sequential requests; returns the status codes. */
async function burst(fn: () => any, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) statuses.push((await fn()).status);
  return statuses;
}

function rateLimitOf(controller: any, handler: string): { limit: number; windowMs: number } | undefined {
  return Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_VALUE, controller.prototype[handler]);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard, PUBLIC_RATE_LIMIT_KEY } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  // Catalog
  const { CatalogController } = await import('../src/modules/catalog/catalog.controller');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  // Commerce: the products route /book calls
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
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  // Bookings
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  // Site
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { IntakeService } = await import('../src/modules/site/intake.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');
  const { CustomerReferralService } = await import('../src/modules/site/customer-referral.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');

  CatalogControllerClass = CatalogController;
  BookingsControllerClass = BookingsController;
  PUBLIC_RATE_LIMIT_KEY_VALUE = PUBLIC_RATE_LIMIT_KEY;

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const stub = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [CatalogController, CommerceController, BookingsController, SiteController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      CatalogService,
      CommerceService,
      SiteService,
      {
        provide: EventEmitter2,
        useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined, off: () => undefined, once: () => undefined, removeListener: () => undefined },
      },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      // Off the public read paths: never called by the routes under test.
      { provide: CrmService, useValue: stub },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: InvoiceWorkflowService, useValue: stub },
      { provide: InvoiceReceiptBuilderService, useValue: stub },
      { provide: GmailService, useValue: stub },
      { provide: CommerceVisionService, useValue: stub },
      { provide: StoreReadinessService, useValue: stub },
      { provide: PaymentEvidenceService, useValue: stub },
      { provide: TimeEntryService, useValue: stub },
      { provide: PublicEventsService, useValue: stub },
      { provide: RevenuePostingService, useValue: stub },
      { provide: BookingsService, useValue: stub },
      { provide: BookingWaitlistService, useValue: stub },
      { provide: CalendarService, useValue: stub },
      { provide: BookingOptimizerService, useValue: stub },
      { provide: StoreOrderService, useValue: stub },
      { provide: PromoCodeService, useValue: stub },
      { provide: IntakeService, useValue: stub },
      { provide: QualificationService, useValue: stub },
      { provide: StorefrontConversionService, useValue: stub },
      { provide: CustomerReferralService, useValue: stub },
      { provide: CaseStudyService, useValue: stub },
      { provide: PaymentsService, useValue: stub },
      { provide: AiUsageService, useValue: stub },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Every request in this suite is anonymous: no identity middleware.
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  // ---- three stores: on with rows, off with the same rows, on with nothing ----
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerOff, email: `${P}ownerOff@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerEmpty, email: `${P}ownerEmpty@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V23A Store', slug: SLUG.a, ownerId: ID.ownerA, currency: 'TTD', storeEnabled: true } });
  await db.business.create({ data: { id: ID.bizOff, name: 'V23A Closed Store', slug: SLUG.off, ownerId: ID.ownerOff, currency: 'TTD', storeEnabled: false } });
  await db.business.create({ data: { id: ID.bizEmpty, name: 'V23A Empty Store', slug: SLUG.empty, ownerId: ID.ownerEmpty, currency: 'TTD', storeEnabled: true } });

  // A paid digital resource: the file, its licence, the SKU and the execution
  // notes are the owner's, not the visitor's.
  const product = (id: string, businessId: string, extra: Record<string, unknown> = {}) =>
    db.product.create({
      data: {
        id,
        businessId,
        name: `V23A ${id.slice(P.length)}`,
        description: 'A ready-made booking template',
        price: 49,
        currency: 'TTD',
        category: 'PRODUCT',
        imageUrl: 'https://example.test/v23a-cover.png',
        isActive: true,
        inventoryMode: 'untracked',
        compareAtPrice: 59,
        resourceType: 'TEMPLATE',
        downloadUrl: `https://files.example.test/${CANARY}download.zip`,
        licenseTerms: `${CANARY}license: single seat, no resale`,
        sku: `${CANARY}sku-0001`,
        fulfillmentModel: 'dropship',
        executionMeta: { pricingNote: `${CANARY}margin note` },
        ...extra,
      },
    });
  await product(ID.prodA, ID.bizA);
  await product(ID.prodInactive, ID.bizA, { isActive: false });
  await product(ID.prodOff, ID.bizOff);

  const service = (id: string, businessId: string) =>
    db.service.create({
      data: {
        id,
        businessId,
        name: `V23A ${id.slice(P.length)}`,
        description: 'Forty-five minute consultation',
        duration: 45,
        price: 120,
        bufferMins: 15,
        leadTimeMins: 60,
        invoiceTiming: 'BOOKING',
        depositRequired: true,
        depositType: 'FIXED',
        depositValue: 20,
        sourceProductId: `${CANARY}source-product`,
      },
    });
  await service(ID.svcA, ID.bizA);
  await service(ID.svcOff, ID.bizOff);

  // Staff pay and capacity: internal (L4 manager), never public.
  await db.staffMember.create({ data: { id: ID.staffA, businessId: ID.bizA, name: 'V23A Stylist', hourlyRate: 87.5, maxHoursPerWeek: 31 } });
  await db.staffMember.create({ data: { id: ID.staffOff, businessId: ID.bizOff, name: 'V23A Closed Stylist', hourlyRate: 87.5, maxHoursPerWeek: 31 } });
}, 60_000);

beforeEach(async () => {
  await clearRateLimits();
});

afterAll(async () => {
  try { await cleanup(); } catch { /* best-effort */ }
  try { if (redis) { await clearRateLimits(); await redis.quit(); } } catch { /* best-effort */ }
  try { await app?.close(); } catch { /* best-effort */ }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

// ---------------------------------------------------------------------------
describe('V1-23 GET /catalog/public/businesses/:id/products', () => {
  it('RED-BEFORE: returns an explicit projection; downloadUrl, licenseTerms, sku, executionMeta and the canary are absent', async () => {
    const res = await catalogProducts(ID.bizA);
    expect(res.status).toBe(200);
    expectRowsProjected(res.body, PRODUCT_KEYS, PRODUCT_SECRET_KEYS, 'catalog products');
    expect(res.body.map((p: any) => p.id)).toEqual([ID.prodA]); // the inactive product stays hidden
    expect(res.body[0]).toMatchObject({ id: ID.prodA, price: 49, currency: 'TTD', compareAtPrice: 59, purchasable: true, stockStatus: 'untracked' });
  });

  it('RED-BEFORE: storeEnabled=false is a 404 with the same body as a business that does not exist', async () => {
    const off = await catalogProducts(ID.bizOff);
    const unknown = await catalogProducts(UNKNOWN_BIZ);
    expect(off.status, `closed store answered ${off.status} ${JSON.stringify(off.body)}`).toBe(404);
    expect(unknown.status).toBe(404);
    expect(stripVolatile(off.body)).toEqual(stripVolatile(unknown.body));
    expectNoCanary(off.body);
  });

  it('CONTROL: a store that is on but lists nothing is 200 []', async () => {
    const res = await catalogProducts(ID.bizEmpty);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('RED-BEFORE: carries @PublicRateLimit and request N+1 in the window is a 429', async () => {
    const opts = rateLimitOf(CatalogControllerClass, 'listPublicProducts');
    const limit = opts?.limit ?? 30;
    const statuses = await burst(() => catalogProducts(ID.bizA), limit + 1);
    expect(statuses.slice(0, limit).every((s) => s === 200), `first ${limit}: ${statuses.join(',')}`).toBe(true);
    expect(statuses[limit], `request ${limit + 1}`).toBe(429);
    expect(opts, '@PublicRateLimit on CatalogController.listPublicProducts').toBeDefined();
    expect(opts!.limit).toBeLessThanOrEqual(60);
    expect(opts!.windowMs).toBeGreaterThanOrEqual(60_000);
  });
});

// ---------------------------------------------------------------------------
describe('V1-23 GET /commerce/public/businesses/:id/products (the route /book calls)', () => {
  it('RED-BEFORE: the pass-through returns the same projection', async () => {
    const res = await commerceProducts(ID.bizA);
    expect(res.status).toBe(200);
    expectRowsProjected(res.body, PRODUCT_KEYS, PRODUCT_SECRET_KEYS, 'commerce products');
    expect(res.body.map((p: any) => p.id)).toEqual([ID.prodA]);
  });

  it('RED-BEFORE: storeEnabled=false is a 404, the same body as an unknown business', async () => {
    const off = await commerceProducts(ID.bizOff);
    const unknown = await commerceProducts(UNKNOWN_BIZ);
    expect(off.status, `closed store answered ${off.status} ${JSON.stringify(off.body)}`).toBe(404);
    expect(unknown.status).toBe(404);
    expect(stripVolatile(off.body)).toEqual(stripVolatile(unknown.body));
    expectNoCanary(off.body);
  });

  it.todo(
    'is rate limited: the guard belongs on CommerceController.listPublicProducts (commerce.controller.ts), outside the V1-23 write set',
  );
});

// ---------------------------------------------------------------------------
describe('V1-23 GET /bookings/public/businesses/:id/staff', () => {
  it('RED-BEFORE: returns { id, name } only; hourlyRate and maxHoursPerWeek are absent', async () => {
    const res = await publicStaff(ID.bizA);
    expect(res.status).toBe(200);
    expectRowsProjected(res.body, STAFF_KEYS, STAFF_SECRET_KEYS, 'public staff');
    expect(res.body).toEqual([{ id: ID.staffA, name: 'V23A Stylist' }]);
  });

  it('RED-BEFORE: storeEnabled=false is a 404, the same body as an unknown business', async () => {
    const off = await publicStaff(ID.bizOff);
    const unknown = await publicStaff(UNKNOWN_BIZ);
    expect(off.status, `closed store answered ${off.status} ${JSON.stringify(off.body)}`).toBe(404);
    expect(unknown.status).toBe(404);
    expect(stripVolatile(off.body)).toEqual(stripVolatile(unknown.body));
  });

  it('CONTROL (already limited at the base): request N+1 in the window is a 429', async () => {
    const opts = rateLimitOf(BookingsControllerClass, 'publicListStaff');
    expect(opts, '@PublicRateLimit on publicListStaff').toBeDefined();
    const statuses = await burst(() => publicStaff(ID.bizA), opts!.limit + 1);
    expect(statuses.slice(0, opts!.limit).every((s) => s === 200), statuses.join(',')).toBe(true);
    expect(statuses[opts!.limit]).toBe(429);
  });
});

// ---------------------------------------------------------------------------
describe('V1-23 GET /bookings/public/businesses/:id/services', () => {
  it('RED-BEFORE: returns { id, name, description, duration, price } only; invoice timing, deposit terms and sourceProductId are absent', async () => {
    const res = await publicServices(ID.bizA);
    expect(res.status).toBe(200);
    expectRowsProjected(res.body, SERVICE_KEYS, SERVICE_SECRET_KEYS, 'public services');
    expect(res.body).toEqual([
      { id: ID.svcA, name: 'V23A svcA', description: 'Forty-five minute consultation', duration: 45, price: 120 },
    ]);
  });

  it('RED-BEFORE: storeEnabled=false is a 404, the same body as an unknown business', async () => {
    const off = await publicServices(ID.bizOff);
    const unknown = await publicServices(UNKNOWN_BIZ);
    expect(off.status, `closed store answered ${off.status} ${JSON.stringify(off.body)}`).toBe(404);
    expect(unknown.status).toBe(404);
    expect(stripVolatile(off.body)).toEqual(stripVolatile(unknown.body));
  });

  it('CONTROL (already limited at the base): request N+1 in the window is a 429', async () => {
    const opts = rateLimitOf(BookingsControllerClass, 'publicListServices');
    expect(opts, '@PublicRateLimit on publicListServices').toBeDefined();
    const statuses = await burst(() => publicServices(ID.bizA), opts!.limit + 1);
    expect(statuses.slice(0, opts!.limit).every((s) => s === 200), statuses.join(',')).toBe(true);
    expect(statuses[opts!.limit]).toBe(429);
  });
});

// ---------------------------------------------------------------------------
describe('V1-23 GET /site/storefront/public/:slug', () => {
  it('RED-BEFORE: products and services are projected; the canary is absent', async () => {
    const res = await siteStorefront(SLUG.a);
    expect(res.status).toBe(200);
    expectRowsProjected(res.body.products, SITE_PRODUCT_KEYS, PRODUCT_SECRET_KEYS, 'site products');
    expectRowsProjected(res.body.services, SERVICE_KEYS, SERVICE_SECRET_KEYS, 'site services');
    expectNoCanary(res.body);
  });

  it('CONTROL (CF-56, already at the base): storeEnabled=false is a 404', async () => {
    const res = await siteStorefront(SLUG.off);
    expect(res.status).toBe(404);
    expectNoCanary(res.body);
  });
});

// ---------------------------------------------------------------------------
describe('V1-23 POSITIVE CONTROL: the /book page still loads', () => {
  it('the reads /book/[slug] makes on load answer 200 with every field the page maps', async () => {
    // app/book/[slug]/page.tsx loadBusiness(): the storefront config, then
    // services, staff and products in parallel.
    const sf = await siteStorefront(SLUG.a);
    expect(sf.status).toBe(200);
    expect(sf.body).toHaveProperty('storefront');
    expect(Array.isArray(sf.body.shippingZones)).toBe(true);
    expect(typeof sf.body.completedOrdersCount).toBe('number');
    expect(sf.body.business).toMatchObject({ id: ID.bizA, slug: SLUG.a, storeEnabled: true });

    const [services, staff, products] = await Promise.all([
      publicServices(ID.bizA),
      publicStaff(ID.bizA),
      commerceProducts(ID.bizA),
    ]);
    expect([services.status, staff.status, products.status]).toEqual([200, 200, 200]);

    // The page's own mapping into CatalogItem (page.tsx / product/[productId]/page.tsx).
    const items: Array<Record<string, unknown>> = [];
    for (const s of services.body) {
      items.push({ id: s.id, name: s.name, description: s.description, price: s.price, duration: s.durationMins ?? s.duration, itemType: 'service' });
    }
    for (const p of products.body) {
      if (!p.isActive) continue;
      items.push({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: p.currency,
        duration: p.duration,
        imageUrl: p.imageUrl,
        itemType: p.category === 'PACKAGE' ? 'package' : p.category === 'SERVICE' ? 'service' : 'product',
        availableQuantity: p.availableQuantity,
        stockStatus: p.stockStatus,
        purchasable: p.purchasable,
      });
    }
    expect(items).toEqual([
      { id: ID.svcA, name: 'V23A svcA', description: 'Forty-five minute consultation', price: 120, duration: 45, itemType: 'service' },
      {
        id: ID.prodA,
        name: 'V23A prodA',
        description: 'A ready-made booking template',
        price: 49,
        currency: 'TTD',
        duration: null,
        imageUrl: 'https://example.test/v23a-cover.png',
        itemType: 'product',
        availableQuantity: null,
        stockStatus: 'untracked',
        purchasable: true,
      },
    ]);
    // The staff picker reads id and name (components/types.ts Staff).
    expect(staff.body.map((s: any) => ({ id: s.id, name: s.name }))).toEqual([{ id: ID.staffA, name: 'V23A Stylist' }]);
  });

  it('a store that is on but lists nothing still loads (commerce products 200 [])', async () => {
    const res = await commerceProducts(ID.bizEmpty);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
