/**
 * P204 / V1-91 (`FU-STORE-ADD-IDEMPOTENT`):
 * Adding a product to the store creates a `Service` row with `sourceProductId = productId`.
 * This real-Postgres + real-HTTP integration proof pins the atomic idempotency and
 * tenant-isolation contract across all service listing write paths:
 *
 *   - SAI-01: Sequential double-add of `(businessId, sourceProductId)` via
 *             `POST /bookings/businesses/:b/services` and `POST /catalog/businesses/:b/services`
 *             returns the SAME `Service.id`, leaves exactly 1 live `Service` row in Postgres,
 *             and emits `catalog.service.created` only once.
 *   - SAI-02: 5-way concurrent `Promise.all` add-to-store for the same `(businessId, sourceProductId)`
 *             all succeed, return the SAME `Service.id`, leave exactly 1 live `Service` row,
 *             and emit `catalog.service.created` only once.
 *   - SAI-03: Re-adding a product AFTER its previous listing `Service` was soft-deleted
 *             creates a fresh live `Service` row cleanly, and subsequent adds return that new row.
 *   - SAI-04: Cross-tenant, nonexistent, and soft-deleted `sourceProductId` values are rejected
 *             with a uniform 400 (`Product not found or does not belong to this business`) and
 *             create 0 rows; two different businesses with their own products operate independently.
 *   - SAI-05: `updateService` (`PATCH /catalog/.../services/:id` & `PATCH /bookings/.../services/:id`)
 *             refuses assigning a `sourceProductId` already held by another live `Service` (409)
 *             or belonging to another business / nonexistent / soft-deleted (uniform 400), while
 *             allowing self-updates and unlinking (`null` / blank).
 *   - SAI-06: `StoreReadinessService.backfillSourceProductIds`, `CatalogService.linkServiceToProduct`,
 *             and `CatalogService.restoreService` enforce the same no-duplicate live listing and
 *             tenant-isolation invariants.
 *   - SAI-07: CONTROL — regular bookable services (`sourceProductId` omitted, `null`, or whitespace)
 *             continue to allow multiple distinct services per business.
 *
 * Fixture prefix: `v91g_` (registered in `apps/server/test/helpers/fixture-prefixes.json`).
 * Teardown uses raw SQL `sqlLikePrefix(P)` only (no `.deleteMany`).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { configureNestApp } from '../src/app-bootstrap';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { PublicRateLimitGuard } from '../src/core/guards/public-rate-limit.guard';
import { HoneypotGuard } from '../src/core/guards/honeypot.guard';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { CatalogController } from '../src/modules/catalog/catalog.controller';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { BookingsController } from '../src/modules/bookings/bookings.controller';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { BookingWaitlistService } from '../src/modules/bookings/booking-waitlist.service';
import { CalendarService } from '../src/modules/bookings/calendar.service';
import { BookingOptimizerService } from '../src/modules/bookings/booking-optimizer.service';
import { StoreReadinessService } from '../src/modules/commerce/store-readiness.service';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91g_';
const HEADER = 'x-v91g-user';
const UNIFORM_PRODUCT_ERROR = 'Product not found or does not belong to this business';

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  prodSeqA: `${P}prod_seq_a`,
  prodConcA: `${P}prod_conc_a`,
  prodReaddA: `${P}prod_readd_a`,
  prodSoftDelA: `${P}prod_softdel_a`,
  prodUpdA1: `${P}prod_upd_a1`,
  prodUpdA2: `${P}prod_upd_a2`,
  prodBackfillA: `${P}prod_backfill_a`,
  prodRestoreA: `${P}prod_restore_a`,
  prodB: `${P}prod_b`,
};

let db: any;
let app: any;
let catalogService: CatalogService;
let storeReadiness: StoreReadinessService;
const emittedEvents: Array<{ name: string; payload: any }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function rawLiveServicesForProduct(businessId: string, productId: string): Promise<Array<{ id: string; source_product_id: string | null }>> {
  return db.$queryRaw`
    SELECT id, source_product_id
    FROM services
    WHERE business_id = ${businessId}
      AND source_product_id = ${productId}
      AND deleted_at IS NULL
    ORDER BY created_at ASC
  `;
}

async function rawAllServicesForProduct(businessId: string, productId: string): Promise<Array<{ id: string; deleted_at: Date | null }>> {
  return db.$queryRaw`
    SELECT id, deleted_at
    FROM services
    WHERE business_id = ${businessId}
      AND source_product_id = ${productId}
    ORDER BY created_at ASC
  `;
}

async function rawServiceCountForBusiness(businessId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM services
    WHERE business_id = ${businessId}
  `;
  return Number(rows[0]?.count ?? 0);
}

describe('P204 / V1-91 (FU-STORE-ADD-IDEMPOTENT): idempotent store listing & tenant isolation', () => {
  beforeAll(async () => {
    const dbMod = await import('@keyflow/db');
    db = dbMod.db;

    await cleanup();

    await db.user.createMany({
      data: [
        { id: ID.ownerA, email: `${P}owner-a@test.local`, name: 'v91g Owner A', role: 'USER' },
        { id: ID.ownerB, email: `${P}owner-b@test.local`, name: 'v91g Owner B', role: 'USER' },
      ],
    });
    await db.business.createMany({
      data: [
        { id: ID.bizA, name: 'v91g Store A', slug: `${P}store-a`, ownerId: ID.ownerA, currency: 'TTD', storeEnabled: true },
        { id: ID.bizB, name: 'v91g Store B', slug: `${P}store-b`, ownerId: ID.ownerB, currency: 'TTD', storeEnabled: true },
      ],
    });
    await db.membership.createMany({
      data: [
        { id: `${P}mem_a`, businessId: ID.bizA, userId: ID.ownerA, role: 'OWNER' },
        { id: `${P}mem_b`, businessId: ID.bizB, userId: ID.ownerB, role: 'OWNER' },
      ],
    });

    await db.product.createMany({
      data: [
        { id: ID.prodSeqA, businessId: ID.bizA, name: 'v91g Sequential Lamp', price: 120, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodConcA, businessId: ID.bizA, name: 'v91g Concurrent Mug', price: 45, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodReaddA, businessId: ID.bizA, name: 'v91g Readd Candle', price: 60, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodSoftDelA, businessId: ID.bizA, name: 'v91g Deleted Tea', price: 30, currency: 'TTD', category: 'PRODUCT', isActive: true, deletedAt: new Date() },
        { id: ID.prodUpdA1, businessId: ID.bizA, name: 'v91g Update Bowl 1', price: 80, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodUpdA2, businessId: ID.bizA, name: 'v91g Update Bowl 2', price: 90, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodBackfillA, businessId: ID.bizA, name: 'v91g Backfill Soap', price: 25, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodRestoreA, businessId: ID.bizA, name: 'v91g Restore Towel', price: 70, currency: 'TTD', category: 'PRODUCT', isActive: true },
        { id: ID.prodB, businessId: ID.bizB, name: 'v91g Foreign Widget', price: 99, currency: 'TTD', category: 'PRODUCT', isActive: true },
      ],
    });

    const prismaStub = { client: db } as unknown as PrismaService;
    const offRoute = {};

    const ref = await Test.createTestingModule({
      controllers: [CatalogController, BookingsController],
      providers: [
        { provide: PrismaService, useValue: prismaStub },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        PlanLimitGuard,
        PublicRateLimitGuard,
        HoneypotGuard,
        TeamAuditInterceptor,
        { provide: REDIS_CLIENT, useValue: null },
        CatalogService,
        StoreReadinessService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: (name: string, payload: unknown) => {
              emittedEvents.push({ name, payload });
              return true;
            },
            emitAsync: async (name: string, payload: unknown) => {
              emittedEvents.push({ name, payload });
              return [];
            },
          },
        },
        { provide: BookingsService, useValue: offRoute },
        { provide: BookingWaitlistService, useValue: offRoute },
        { provide: CalendarService, useValue: offRoute },
        { provide: BookingOptimizerService, useValue: offRoute },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      ],
    }).compile();

    catalogService = ref.get(CatalogService);
    storeReadiness = ref.get(StoreReadinessService);

    app = ref.createNestApplication({ logger: false });
    app.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const found = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (found) req.user = { id: found.id, email: found.email, role: found.role };
      }
      next();
    });
    configureNestApp(app);
    await app.init();
  }, 60_000);

  afterAll(async () => {
    try {
      await app?.close();
    } catch {
      /* best-effort */
    }
    try {
      await cleanup();
    } catch {
      /* best-effort */
    }
  });

  const postBookingsService = (body: Record<string, unknown>, user = ID.ownerA, biz = ID.bizA) =>
    request(app.getHttpServer()).post(`/bookings/businesses/${biz}/services`).set(HEADER, user).send(body);

  const postCatalogService = (body: Record<string, unknown>, user = ID.ownerA, biz = ID.bizA) =>
    request(app.getHttpServer()).post(`/catalog/businesses/${biz}/services`).set(HEADER, user).send(body);

  const patchCatalogService = (serviceId: string, body: Record<string, unknown>, user = ID.ownerA, biz = ID.bizA) =>
    request(app.getHttpServer()).patch(`/catalog/businesses/${biz}/services/${serviceId}`).set(HEADER, user).send(body);

  const patchBookingsService = (serviceId: string, body: Record<string, unknown>, user = ID.ownerA, biz = ID.bizA) =>
    request(app.getHttpServer()).patch(`/bookings/businesses/${biz}/services/${serviceId}`).set(HEADER, user).send(body);

  const deleteCatalogService = (serviceId: string, user = ID.ownerA, biz = ID.bizA) =>
    request(app.getHttpServer()).delete(`/catalog/businesses/${biz}/services/${serviceId}`).set(HEADER, user);

  it('[SAI-01] RED-BEFORE: sequential double-add via /bookings and /catalog returns the same Service.id, leaves 1 live row, and emits catalog.service.created once', async () => {
    emittedEvents.length = 0;

    const first = await postBookingsService({
      name: 'v91g Sequential Lamp',
      duration: 30,
      price: 120,
      sourceProductId: ID.prodSeqA,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.id).toBeTruthy();
    expect(first.body.sourceProductId).toBe(ID.prodSeqA);

    const second = await postBookingsService({
      name: 'v91g Sequential Lamp (retry)',
      duration: 30,
      price: 120,
      sourceProductId: ID.prodSeqA,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const third = await postCatalogService({
      name: 'v91g Sequential Lamp (catalog retry)',
      duration: 30,
      price: 120,
      sourceProductId: ID.prodSeqA,
    });
    expect(third.status, JSON.stringify(third.body)).toBe(201);
    expect(third.body.id).toBe(first.body.id);

    const liveRows = await rawLiveServicesForProduct(ID.bizA, ID.prodSeqA);
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0].id).toBe(first.body.id);

    const createdEvents = emittedEvents.filter(
      (e) => e.name === 'catalog.service.created' && e.payload?.service?.sourceProductId === ID.prodSeqA,
    );
    expect(createdEvents).toHaveLength(1);
  });

  it('[SAI-02] RED-BEFORE: 5 concurrent add-to-store requests all succeed with the same Service.id, leave exactly 1 live row, and emit catalog.service.created once', async () => {
    emittedEvents.length = 0;

    const payload = {
      name: 'v91g Concurrent Mug',
      duration: 30,
      price: 45,
      sourceProductId: ID.prodConcA,
    };

    const responses = await Promise.all([
      postBookingsService(payload),
      postCatalogService(payload),
      postBookingsService(payload),
      postCatalogService(payload),
      postBookingsService(payload),
    ]);

    for (const res of responses) {
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.sourceProductId).toBe(ID.prodConcA);
    }

    const distinctIds = new Set(responses.map((r) => r.body.id));
    expect(distinctIds.size).toBe(1);

    const liveRows = await rawLiveServicesForProduct(ID.bizA, ID.prodConcA);
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0].id).toBe(responses[0].body.id);

    const createdEvents = emittedEvents.filter(
      (e) => e.name === 'catalog.service.created' && e.payload?.service?.sourceProductId === ID.prodConcA,
    );
    expect(createdEvents).toHaveLength(1);
  });

  it('[SAI-03] re-adding a product after its previous listing Service was soft-deleted creates a fresh live Service cleanly', async () => {
    const first = await postCatalogService({
      name: 'v91g Readd Candle',
      duration: 30,
      price: 60,
      sourceProductId: ID.prodReaddA,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const del = await deleteCatalogService(first.body.id);
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    const readded = await postBookingsService({
      name: 'v91g Readd Candle v2',
      duration: 30,
      price: 60,
      sourceProductId: ID.prodReaddA,
    });
    expect(readded.status, JSON.stringify(readded.body)).toBe(201);
    expect(readded.body.id).toBeTruthy();
    expect(readded.body.id).not.toBe(first.body.id);

    // Repeating after re-add stays idempotent against the new live row.
    const repeat = await postCatalogService({
      name: 'v91g Readd Candle v2 dup',
      duration: 30,
      price: 60,
      sourceProductId: ID.prodReaddA,
    });
    expect(repeat.status, JSON.stringify(repeat.body)).toBe(201);
    expect(repeat.body.id).toBe(readded.body.id);

    const liveRows = await rawLiveServicesForProduct(ID.bizA, ID.prodReaddA);
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0].id).toBe(readded.body.id);

    const allRows = await rawAllServicesForProduct(ID.bizA, ID.prodReaddA);
    expect(allRows).toHaveLength(2);
    expect(allRows.filter((r) => r.deleted_at !== null)).toHaveLength(1);
  });

  it('[SAI-04] RED-BEFORE: foreign-tenant, nonexistent, and soft-deleted sourceProductId are rejected with uniform 400 and write 0 rows; two businesses work independently', async () => {
    const beforeCountA = await rawServiceCountForBusiness(ID.bizA);

    const badCases: Array<[string, string]> = [
      ['foreign-tenant', ID.prodB],
      ['nonexistent', `${P}no_such_product`],
      ['soft-deleted', ID.prodSoftDelA],
    ];

    const seenMessages = new Set<string>();
    for (const [label, sourceProductId] of badCases) {
      const bookRes = await postBookingsService({
        name: `v91g Bad ${label} bookings`,
        duration: 30,
        price: 50,
        sourceProductId,
      });
      expect(bookRes.status, `/bookings ${label}: ${JSON.stringify(bookRes.body)}`).toBe(400);
      expect(String(bookRes.body?.message ?? '')).toBe(UNIFORM_PRODUCT_ERROR);
      seenMessages.add(String(bookRes.body?.message ?? ''));

      const catRes = await postCatalogService({
        name: `v91g Bad ${label} catalog`,
        duration: 30,
        price: 50,
        sourceProductId,
      });
      expect(catRes.status, `/catalog ${label}: ${JSON.stringify(catRes.body)}`).toBe(400);
      expect(String(catRes.body?.message ?? '')).toBe(UNIFORM_PRODUCT_ERROR);
      seenMessages.add(String(catRes.body?.message ?? ''));
    }

    expect(seenMessages.size).toBe(1);
    expect(await rawServiceCountForBusiness(ID.bizA)).toBe(beforeCountA);

    // Independent business B can list its own product B cleanly and idempotently.
    const bizBFirst = await postCatalogService(
      { name: 'v91g Foreign Widget', duration: 30, price: 99, sourceProductId: ID.prodB },
      ID.ownerB,
      ID.bizB,
    );
    expect(bizBFirst.status, JSON.stringify(bizBFirst.body)).toBe(201);

    const bizBSecond = await postBookingsService(
      { name: 'v91g Foreign Widget', duration: 30, price: 99, sourceProductId: ID.prodB },
      ID.ownerB,
      ID.bizB,
    );
    expect(bizBSecond.status, JSON.stringify(bizBSecond.body)).toBe(201);
    expect(bizBSecond.body.id).toBe(bizBFirst.body.id);
    expect(await rawLiveServicesForProduct(ID.bizB, ID.prodB)).toHaveLength(1);
  });

  it('[SAI-05] RED-BEFORE: updateService refuses duplicate live sourceProductId (409) and foreign/nonexistent/soft-deleted sourceProductId (400), while allowing self-update and unlink', async () => {
    const listed = await postCatalogService({
      name: 'v91g Update Bowl 1',
      duration: 30,
      price: 80,
      sourceProductId: ID.prodUpdA1,
    });
    expect(listed.status, JSON.stringify(listed.body)).toBe(201);

    const standalone = await postCatalogService({
      name: 'v91g Standalone For Patch',
      duration: 45,
      price: 100,
    });
    expect(standalone.status, JSON.stringify(standalone.body)).toBe(201);

    // Assigning a sourceProductId already held by another live Service -> 409 on both routes.
    const dupCat = await patchCatalogService(standalone.body.id, { sourceProductId: ID.prodUpdA1 });
    expect(dupCat.status, JSON.stringify(dupCat.body)).toBe(409);

    const dupBook = await patchBookingsService(standalone.body.id, { sourceProductId: ID.prodUpdA1 });
    expect(dupBook.status, JSON.stringify(dupBook.body)).toBe(409);

    // Foreign, nonexistent, and soft-deleted product -> uniform 400.
    for (const badProdId of [ID.prodB, `${P}missing_patch_prod`, ID.prodSoftDelA]) {
      const res = await patchCatalogService(standalone.body.id, { sourceProductId: badProdId });
      expect(res.status, `patch ${badProdId}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(String(res.body?.message ?? '')).toBe(UNIFORM_PRODUCT_ERROR);
    }

    // Standalone remains unlinked; prodUpdA1 still has exactly 1 live listing.
    const liveUpd1 = await rawLiveServicesForProduct(ID.bizA, ID.prodUpdA1);
    expect(liveUpd1).toHaveLength(1);
    expect(liveUpd1[0].id).toBe(listed.body.id);

    // Self-update passing the same sourceProductId succeeds.
    const selfUpd = await patchCatalogService(listed.body.id, {
      price: 85,
      sourceProductId: ID.prodUpdA1,
    });
    expect(selfUpd.status, JSON.stringify(selfUpd.body)).toBe(200);
    expect(selfUpd.body.price).toBe(85);
    expect(selfUpd.body.sourceProductId).toBe(ID.prodUpdA1);

    // Linking standalone to an unused live product in the same business succeeds, then unlinking via null works.
    const validLink = await patchCatalogService(standalone.body.id, { sourceProductId: ID.prodUpdA2 });
    expect(validLink.status, JSON.stringify(validLink.body)).toBe(200);
    expect(validLink.body.sourceProductId).toBe(ID.prodUpdA2);

    const unlink = await patchCatalogService(standalone.body.id, { sourceProductId: null });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);
    expect(unlink.body.sourceProductId).toBeNull();
  });

  it('[SAI-06] RED-BEFORE: StoreReadinessService.backfillSourceProductIds, linkServiceToProduct, and restoreService enforce no-duplicate and tenant isolation', async () => {
    // Seed two unlinked live services whose name matches prodBackfillA.
    const bf1 = await postCatalogService({ name: 'v91g Backfill Soap', duration: 30, price: 25 });
    const bf2 = await postCatalogService({ name: 'v91g Backfill Soap', duration: 30, price: 25 });
    expect(bf1.status).toBe(201);
    expect(bf2.status).toBe(201);

    // Run two backfills concurrently; at most one service may be linked to prodBackfillA.
    await Promise.all([
      storeReadiness.backfillSourceProductIds(ID.bizA),
      storeReadiness.backfillSourceProductIds(ID.bizA),
    ]);
    const liveBackfill = await rawLiveServicesForProduct(ID.bizA, ID.prodBackfillA);
    expect(liveBackfill).toHaveLength(1);

    const linkedId = liveBackfill[0].id;
    const unlinkedId = linkedId === bf1.body.id ? bf2.body.id : bf1.body.id;

    // Direct linkServiceToProduct rejects foreign tenant (400) and duplicate live link (409).
    await expect(catalogService.linkServiceToProduct(ID.bizA, unlinkedId, ID.prodB)).rejects.toMatchObject({
      status: 400,
    });
    await expect(catalogService.linkServiceToProduct(ID.bizA, unlinkedId, ID.prodBackfillA)).rejects.toMatchObject({
      status: 409,
    });

    // restoreService refuses restoring a trashed listing if another live listing now owns the product (409).
    const firstRestore = await postCatalogService({
      name: 'v91g Restore Towel',
      duration: 30,
      price: 70,
      sourceProductId: ID.prodRestoreA,
    });
    expect(firstRestore.status).toBe(201);
    await deleteCatalogService(firstRestore.body.id);

    const replacement = await postCatalogService({
      name: 'v91g Restore Towel replacement',
      duration: 30,
      price: 70,
      sourceProductId: ID.prodRestoreA,
    });
    expect(replacement.status).toBe(201);
    expect(replacement.body.id).not.toBe(firstRestore.body.id);

    await expect(catalogService.restoreService(ID.bizA, firstRestore.body.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(await rawLiveServicesForProduct(ID.bizA, ID.prodRestoreA)).toHaveLength(1);
  });

  it('[SAI-07] CONTROL: regular bookable services (sourceProductId omitted, null, or blank) still allow multiple distinct rows per business', async () => {
    const r1 = await postCatalogService({ name: 'v91g Consult 1', duration: 60, price: 200 });
    const r2 = await postBookingsService({ name: 'v91g Consult 2', duration: 60, price: 200, sourceProductId: null });
    const r3 = await postCatalogService({ name: 'v91g Consult 3', duration: 60, price: 200, sourceProductId: '   ' });

    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r3.status, JSON.stringify(r3.body)).toBe(201);

    expect(new Set([r1.body.id, r2.body.id, r3.body.id]).size).toBe(3);
    expect(r1.body.sourceProductId).toBeNull();
    expect(r2.body.sourceProductId).toBeNull();
    expect(r3.body.sourceProductId).toBeNull();
  });
});
