/**
 * P234 (FU-SERVICE-WRITE-SCOPE, D-309 / D-315 / D-317 Option B):
 * Real-Postgres + real HTTP integration proof that editing services, prices,
 * and deposits on ALL 8 service write routes (`POST/PATCH/DELETE/POST batch`
 * across both `CatalogController` `/catalog/businesses/:b/services*` and
 * deprecated pass-through `BookingsController` `/bookings/businesses/:b/services*`)
 * requires `storefront:write` OR `bookings:admin`.
 *
 * Pre-allocated fixture prefix: `v92o_` (registered in
 * `apps/server/test/helpers/fixture-prefixes.json`, cleaned up via
 * `sqlLikePrefix(P)`).
 *
 * Cases:
 *   V92O-01 (RED-BEFORE): Default STAFF (`bookings:write`, `storefront:read`)
 *           is refused 403 on all 8 service write routes (create, update price/
 *           deposit, delete, batch on both `/catalog` and `/bookings`) with zero
 *           DB mutations.
 *   V92O-02 (RED-BEFORE): Explicit scope maps:
 *           - `{ storefront: 'write', bookings: 'none' }` ALLOWED on all 8 routes.
 *           - `{ storefront: 'none', bookings: 'admin' }` ALLOWED on all 8 routes.
 *           - `{ storefront: 'read', bookings: 'write' }` REFUSED 403 on all 8 routes.
 *           - OWNER with explicit `{ storefront: 'read', bookings: 'write' }`
 *             (D-140) REFUSED 403 on all 8 routes.
 *   V92O-03 (Controls): Default OWNER and default ADMIN succeed on both
 *           `/catalog` and `/bookings` writes (including price & deposit);
 *           default STAFF keeps read access to `GET .../services`; cross-tenant
 *           OWNER gets 403; unauthenticated gets 401.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { db } from '@keyflow/db';
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
import { TransactionalEmailService } from '../src/modules/notifications/transactional-email.service';
import { sqlLikePrefix } from './helpers/sql-like.js';

const P = 'v92o_';
const HEADER = 'x-v92o-user';

const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`,
  staffDefault: `${P}staff_default`,
  staffStorefrontWrite: `${P}staff_sf_write`,
  staffBookingsAdmin: `${P}staff_bk_admin`,
  staffExplicitBookingsWrite: `${P}staff_bk_write`,
  ownerRestricted: `${P}owner_restricted`,
  otherOwner: `${P}other_owner`,
  biz: `${P}biz`,
  bizOther: `${P}biz_other`,
};

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

describe('P234 (FU-SERVICE-WRITE-SCOPE, D-317 Option B): service, price and deposit writes require storefront:write OR bookings:admin', () => {
  let app: any;
  let baselineServiceId: string;

  beforeAll(async () => {
    await cleanup();

    await db.user.createMany({
      data: [
        { id: ID.owner, email: `${P}owner@test.local`, name: 'v92o Owner', role: 'USER' },
        { id: ID.admin, email: `${P}admin@test.local`, name: 'v92o Admin', role: 'USER' },
        { id: ID.staffDefault, email: `${P}staff-default@test.local`, name: 'v92o Staff Default', role: 'USER' },
        { id: ID.staffStorefrontWrite, email: `${P}staff-sf@test.local`, name: 'v92o Staff SF Write', role: 'USER' },
        { id: ID.staffBookingsAdmin, email: `${P}staff-bk-admin@test.local`, name: 'v92o Staff BK Admin', role: 'USER' },
        { id: ID.staffExplicitBookingsWrite, email: `${P}staff-bk-write@test.local`, name: 'v92o Staff BK Write', role: 'USER' },
        { id: ID.ownerRestricted, email: `${P}owner-restricted@test.local`, name: 'v92o Restricted Owner', role: 'USER' },
        { id: ID.otherOwner, email: `${P}other-owner@test.local`, name: 'v92o Other Owner', role: 'USER' },
      ],
    });

    await db.business.createMany({
      data: [
        { id: ID.biz, name: `${P}Studio`, slug: `${P}studio`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizOther, name: `${P}Other`, slug: `${P}other`, ownerId: ID.otherOwner, currency: 'TTD' },
      ],
    });

    await db.membership.createMany({
      data: [
        { id: `${P}m_owner`, businessId: ID.biz, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_admin`, businessId: ID.biz, userId: ID.admin, role: 'ADMIN' },
        { id: `${P}m_staff`, businessId: ID.biz, userId: ID.staffDefault, role: 'STAFF' },
        {
          id: `${P}m_sf_write`,
          businessId: ID.biz,
          userId: ID.staffStorefrontWrite,
          role: 'STAFF',
          permissionScopes: { storefront: 'write', bookings: 'none' },
        },
        {
          id: `${P}m_bk_admin`,
          businessId: ID.biz,
          userId: ID.staffBookingsAdmin,
          role: 'STAFF',
          permissionScopes: { storefront: 'none', bookings: 'admin' },
        },
        {
          id: `${P}m_bk_write`,
          businessId: ID.biz,
          userId: ID.staffExplicitBookingsWrite,
          role: 'STAFF',
          permissionScopes: { storefront: 'read', bookings: 'write' },
        },
        {
          id: `${P}m_owner_restr`,
          businessId: ID.biz,
          userId: ID.ownerRestricted,
          role: 'OWNER',
          permissionScopes: { storefront: 'read', bookings: 'write' },
        },
        { id: `${P}m_other`, businessId: ID.bizOther, userId: ID.otherOwner, role: 'OWNER' },
      ],
    });

    const seeded = await db.service.create({
      data: {
        id: `${P}svc_base`,
        businessId: ID.biz,
        name: `${P}Baseline Service`,
        duration: 60,
        price: 150,
        depositRequired: true,
        depositType: 'PERCENT',
        depositValue: 20,
      },
    });
    baselineServiceId = seeded.id;

    const ref = await Test.createTestingModule({
      controllers: [CatalogController, BookingsController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        PlanLimitGuard,
        PublicRateLimitGuard,
        HoneypotGuard,
        TeamAuditInterceptor,
        CatalogService,
        { provide: EventEmitter2, useValue: { emit: () => true } },
        { provide: REDIS_CLIENT, useValue: null },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
        { provide: BookingsService, useValue: {} },
        { provide: BookingWaitlistService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: BookingOptimizerService, useValue: {} },
        { provide: TransactionalEmailService, useValue: {} },
      ],
    }).compile();

    app = ref.createNestApplication();
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
  });

  afterAll(async () => {
    if (app) await app.close();
    await cleanup();
  });

  async function assertAllEightWriteRoutesRefused403(userId: string, label: string) {
    const beforeCount = await db.service.count({ where: { businessId: ID.biz, deletedAt: null } });
    const beforeBase = await db.service.findUniqueOrThrow({ where: { id: baselineServiceId } });

    const calls = [
      ['POST /catalog/services', () => request(app.getHttpServer()).post(`/catalog/businesses/${ID.biz}/services`).set(HEADER, userId).send({ name: `${P}denied_c`, duration: 30, price: 99, depositRequired: true, depositType: 'FIXED', depositValue: 20 })],
      ['PATCH /catalog/services/:id', () => request(app.getHttpServer()).patch(`/catalog/businesses/${ID.biz}/services/${baselineServiceId}`).set(HEADER, userId).send({ price: 999, depositValue: 50 })],
      ['DELETE /catalog/services/:id', () => request(app.getHttpServer()).delete(`/catalog/businesses/${ID.biz}/services/${baselineServiceId}`).set(HEADER, userId)],
      ['POST /catalog/services/batch', () => request(app.getHttpServer()).post(`/catalog/businesses/${ID.biz}/services/batch`).set(HEADER, userId).send({ add: [{ name: `${P}denied_cb`, duration: 30, price: 50 }] })],
      ['POST /bookings/services', () => request(app.getHttpServer()).post(`/bookings/businesses/${ID.biz}/services`).set(HEADER, userId).send({ name: `${P}denied_b`, duration: 30, price: 99, depositRequired: true, depositType: 'PERCENT', depositValue: 10 })],
      ['PATCH /bookings/services/:id', () => request(app.getHttpServer()).patch(`/bookings/businesses/${ID.biz}/services/${baselineServiceId}`).set(HEADER, userId).send({ price: 888, depositRequired: false })],
      ['DELETE /bookings/services/:id', () => request(app.getHttpServer()).delete(`/bookings/businesses/${ID.biz}/services/${baselineServiceId}`).set(HEADER, userId)],
      ['POST /bookings/services/batch', () => request(app.getHttpServer()).post(`/bookings/businesses/${ID.biz}/services/batch`).set(HEADER, userId).send({ add: [{ name: `${P}denied_bb`, duration: 30, price: 50 }] })],
    ] as const;

    for (const [route, run] of calls) {
      const res = await run();
      expect(res.status, `${label} must get 403 on ${route}, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(403);
    }

    const afterCount = await db.service.count({ where: { businessId: ID.biz, deletedAt: null } });
    const afterBase = await db.service.findUniqueOrThrow({ where: { id: baselineServiceId } });
    expect(afterCount).toBe(beforeCount);
    expect(afterBase.price).toBe(beforeBase.price);
    expect(afterBase.depositRequired).toBe(beforeBase.depositRequired);
    expect(afterBase.depositValue).toBe(beforeBase.depositValue);
    expect(afterBase.deletedAt).toBeNull();
  }

  async function assertAllEightWriteRoutesAllowed(userId: string, tag: string) {
    // 1-3: Catalog create -> patch price/deposit -> delete
    const cCreate = await request(app.getHttpServer())
      .post(`/catalog/businesses/${ID.biz}/services`)
      .set(HEADER, userId)
      .send({ name: `${P}${tag}_cat`, duration: 45, price: 120, depositRequired: true, depositType: 'PERCENT', depositValue: 25 });
    expect(cCreate.status, `${tag} POST /catalog/services: ${JSON.stringify(cCreate.body)}`).toBe(201);

    const cPatch = await request(app.getHttpServer())
      .patch(`/catalog/businesses/${ID.biz}/services/${cCreate.body.id}`)
      .set(HEADER, userId)
      .send({ price: 140, depositType: 'FIXED', depositValue: 40 });
    expect(cPatch.status, `${tag} PATCH /catalog/services: ${JSON.stringify(cPatch.body)}`).toBe(200);
    expect(cPatch.body.price).toBe(140);
    expect(cPatch.body.depositValue).toBe(40);

    const cDel = await request(app.getHttpServer())
      .delete(`/catalog/businesses/${ID.biz}/services/${cCreate.body.id}`)
      .set(HEADER, userId);
    expect(cDel.status, `${tag} DELETE /catalog/services: ${JSON.stringify(cDel.body)}`).toBe(200);

    // 4: Catalog batch
    const cBatch = await request(app.getHttpServer())
      .post(`/catalog/businesses/${ID.biz}/services/batch`)
      .set(HEADER, userId)
      .send({ add: [{ name: `${P}${tag}_cb`, duration: 30, price: 60 }] });
    expect(cBatch.status, `${tag} POST /catalog/services/batch: ${JSON.stringify(cBatch.body)}`).toBe(201);

    // 5-7: Bookings pass-through create -> patch -> delete
    const bCreate = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.biz}/services`)
      .set(HEADER, userId)
      .send({ name: `${P}${tag}_bk`, duration: 30, price: 80, depositRequired: true, depositType: 'FIXED', depositValue: 20 });
    expect(bCreate.status, `${tag} POST /bookings/services: ${JSON.stringify(bCreate.body)}`).toBe(201);

    const bPatch = await request(app.getHttpServer())
      .patch(`/bookings/businesses/${ID.biz}/services/${bCreate.body.id}`)
      .set(HEADER, userId)
      .send({ price: 95, depositRequired: false });
    expect(bPatch.status, `${tag} PATCH /bookings/services: ${JSON.stringify(bPatch.body)}`).toBe(200);
    expect(bPatch.body.price).toBe(95);
    expect(bPatch.body.depositRequired).toBe(false);

    const bDel = await request(app.getHttpServer())
      .delete(`/bookings/businesses/${ID.biz}/services/${bCreate.body.id}`)
      .set(HEADER, userId);
    expect(bDel.status, `${tag} DELETE /bookings/services: ${JSON.stringify(bDel.body)}`).toBe(200);

    // 8: Bookings batch
    const bBatch = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.biz}/services/batch`)
      .set(HEADER, userId)
      .send({ add: [{ name: `${P}${tag}_bb`, duration: 30, price: 70 }] });
    expect(bBatch.status, `${tag} POST /bookings/services/batch: ${JSON.stringify(bBatch.body)}`).toBe(201);
  }

  it('[V92O-01] RED-BEFORE: default STAFF (bookings:write, storefront:read) gets 403 on all 8 service write routes with zero DB mutations', async () => {
    await assertAllEightWriteRoutesRefused403(ID.staffDefault, 'default STAFF');
  });

  it('[V92O-02] RED-BEFORE: explicit storefront:write OR bookings:admin succeeds on all 8 routes; explicit bookings:write+storefront:read (STAFF and D-140 restricted OWNER) gets 403', async () => {
    await assertAllEightWriteRoutesAllowed(ID.staffStorefrontWrite, 'sf_write');
    await assertAllEightWriteRoutesAllowed(ID.staffBookingsAdmin, 'bk_admin');
    await assertAllEightWriteRoutesRefused403(ID.staffExplicitBookingsWrite, 'STAFF explicit bookings:write + storefront:read');
    await assertAllEightWriteRoutesRefused403(ID.ownerRestricted, 'D-140 restricted OWNER (bookings:write + storefront:read)');
  });

  it('[V92O-03] controls: default OWNER & ADMIN succeed; default STAFF keeps GET .../services reads; cross-tenant OWNER gets 403; unauthenticated gets 401', async () => {
    await assertAllEightWriteRoutesAllowed(ID.owner, 'owner');
    await assertAllEightWriteRoutesAllowed(ID.admin, 'admin');

    const staffReadCatalog = await request(app.getHttpServer())
      .get(`/catalog/businesses/${ID.biz}/services`)
      .set(HEADER, ID.staffDefault);
    expect(staffReadCatalog.status).toBe(200);

    const staffReadBookings = await request(app.getHttpServer())
      .get(`/bookings/businesses/${ID.biz}/services`)
      .set(HEADER, ID.staffDefault);
    expect(staffReadBookings.status).toBe(200);

    const crossTenant = await request(app.getHttpServer())
      .patch(`/catalog/businesses/${ID.biz}/services/${baselineServiceId}`)
      .set(HEADER, ID.otherOwner)
      .send({ price: 1 });
    expect(crossTenant.status).toBe(403);

    const unauth = await request(app.getHttpServer())
      .post(`/catalog/businesses/${ID.biz}/services`)
      .send({ name: `${P}unauth`, duration: 30, price: 10 });
    expect(unauth.status).toBe(401);
  });
});
