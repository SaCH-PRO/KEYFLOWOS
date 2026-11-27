/**
 * P229 FU-SLOTS-OVERNIGHT-HOURS (D-311): real-DB PostgreSQL + real-guard HTTP
 * proof that overnight opening hours (e.g. 18:00–02:00, 18:15–02:15,
 * 18:00–00:00) work consistently across:
 *   - GET /bookings/public/businesses/:id/slots
 *   - POST /bookings/public/businesses/:id (publicCreateBooking)
 *   - POST /bookings/businesses/:id (authenticated in-app createBooking)
 *   - POST /bookings/businesses/:id/bookings/:bookingId/reschedule
 *   - KEY get_availability (BookingsAdapterService.getAvailability)
 *   - BookingOptimizerService.getWeeklyUtilization
 *
 * Uses real PrismaService, real CatalogService, real AuthGuard, real
 * BusinessGuard, real ModuleScopeGuard, real PlanLimitGuard, real
 * PublicRateLimitGuard (backed by Redis under namespace `v92l_`), real
 * HoneypotGuard, real TenantInterceptor, and real ValidationPipe — zero
 * `.overrideGuard(...)` mocks.
 *
 * Fixture prefix: `v92l_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92l_';
const HEADER = 'x-v92l-user';
process.env.RATE_LIMIT_KEY_NAMESPACE = P;

const ID = {
  owner: `${P}owner`,
  ownerOther: `${P}owner_other`,
  contactOvernight: `${P}contact_ov`,
  contactRegular: `${P}contact_reg`,
  bizOvernight: `${P}biz_ov`,
  bizOvernightOther: `${P}biz_ov_other`,
  bizOffset: `${P}biz_off`,
  bizMidnight: `${P}biz_mid`,
  bizBuffered: `${P}biz_buf`,
  bizConsec: `${P}biz_consec`,
  bizUnconfigSpill: `${P}biz_unconfig`,
  bizRegular: `${P}biz_reg`,
  svcOvernight: `${P}svc_ov`,
  svcOvernightOther: `${P}svc_ov_other`,
  svcOffset: `${P}svc_off`,
  svcMidnight: `${P}svc_mid`,
  svcBuffered: `${P}svc_buf`,
  svcConsec: `${P}svc_consec`,
  svcUnconfigSpill: `${P}svc_unconfig`,
  svcRegular: `${P}svc_reg`,
  staffOvernight: `${P}staff_ov`,
};

// Fixed future Friday (2030-01-04) and Saturday (2030-01-05) in America/Port_of_Spain (UTC-04:00, no DST).
const TZ = 'America/Port_of_Spain';
const FRI_DATE = '2030-01-04'; // Friday (weekday 5)
const SAT_DATE = '2030-01-05'; // Saturday (weekday 6)
const isoAt = (date: string, hhmm: string) => `${date}T${hhmm}:00-04:00`;

let db: typeof import('@keyflow/db').db;
let redis: IORedis;
let app: import('@nestjs/common').INestApplication;
let bookingsAdapter: import('../src/modules/key-cortex/adapters/bookings-adapter.service').BookingsAdapterService;
let bookingOptimizer: import('../src/modules/bookings/booking-optimizer.service').BookingOptimizerService;

async function cleanup() {
  for (const sql of [
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM availabilities WHERE staff_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function clearRateLimits() {
  if (!redis) return;
  try {
    const keys = await redis.keys(`*${P}*`);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');
  const { CreateBookingDto } = await import('../src/modules/bookings/dto/create-booking.dto');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { BookingsAdapterService } = await import('../src/modules/key-cortex/adapters/bookings-adapter.service');

  Reflect.defineMetadata(
    'design:paramtypes',
    [String, PublicCreateBookingDto],
    BookingsController.prototype,
    'publicCreateBooking',
  );
  Reflect.defineMetadata(
    'design:paramtypes',
    [String, CreateBookingDto, Object],
    BookingsController.prototype,
    'createBooking',
  );
  Reflect.defineMetadata(
    'design:paramtypes',
    [String, String, String],
    BookingsController.prototype,
    'rescheduleBooking',
  );

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  const crmStub = {
    findOrCreateContact: async (businessId: string, input: any) => {
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : null;
      if (email) {
        const existing = await db.contact.findFirst({
          where: { businessId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
        });
        if (existing) return existing;
      }
      return db.contact.create({
        data: {
          businessId,
          firstName: input.firstName ?? 'Night',
          lastName: input.lastName ?? 'Owl',
          email,
          phone: input.phone ?? null,
        },
      });
    },
    logContactEvent: vi.fn(async () => ({})),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      TenantInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      BookingsService,
      CatalogService,
      BookingOptimizerService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: CrmService, useValue: crmStub },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceService, useValue: { computeServiceDeposit: () => 0 } },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      {
        provide: PublicEventsService,
        useValue: { logStorefrontEvent: async () => undefined, backstitchVisitor: async () => undefined },
      },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CalendarService, useValue: { syncBookingToCalendar: async () => null } },
    ],
  }).compile();

  bookingsAdapter = new BookingsAdapterService(
    moduleRef.get(PrismaService),
    moduleRef.get(BookingsService),
    moduleRef.get(CatalogService),
  );
  bookingOptimizer = moduleRef.get(BookingOptimizerService);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: () => void) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header.trim() : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();
  await clearRateLimits();

  await db.user.createMany({
    data: [
      { id: ID.owner, email: `${P}owner@test.local`, name: 'Overnight Owner' },
      { id: ID.ownerOther, email: `${P}owner_other@test.local`, name: 'Other Tenant Owner' },
    ],
  });

  const allClosed = {
    sun: { closed: true },
    mon: { closed: true },
    tue: { closed: true },
    wed: { closed: true },
    thu: { closed: true },
    fri: { closed: true },
    sat: { closed: true },
  };

  const seedBiz = async (
    bizId: string,
    ownerId: string,
    slug: string,
    svcId: string,
    businessHours: Record<string, unknown>,
    opts: { bufferMins?: number } = {},
  ) => {
    await db.business.create({
      data: {
        id: bizId,
        name: `Biz ${slug}`,
        slug,
        ownerId,
        currency: 'TTD',
        timezone: TZ,
        storeEnabled: true,
        businessHours: businessHours as any,
      },
    });
    await db.membership.create({
      data: { id: `${bizId}_mem`, businessId: bizId, userId: ownerId, role: 'OWNER' },
    });
    await db.service.create({
      data: {
        id: svcId,
        businessId: bizId,
        name: `Session ${slug}`,
        duration: 60,
        price: 100,
        bufferMins: opts.bufferMins ?? 0,
      },
    });
  };

  // 1. Fri 18:00–02:00, Sat closed (+ staff member on business hours for KEY get_availability)
  await seedBiz(ID.bizOvernight, ID.owner, `${P}ov`, ID.svcOvernight, {
    ...allClosed,
    fri: { open: '18:00', close: '02:00', closed: false },
    sat: { closed: true },
  });
  await db.staffMember.create({
    data: { id: ID.staffOvernight, businessId: ID.bizOvernight, name: 'Night Stylist' },
  });
  await db.contact.create({
    data: { id: ID.contactOvernight, businessId: ID.bizOvernight, firstName: 'InApp', lastName: 'Guest', email: `${P}inapp@test.local` },
  });

  // 2. Second tenant with identical overnight schedule for cross-tenant isolation
  await seedBiz(ID.bizOvernightOther, ID.ownerOther, `${P}ov-other`, ID.svcOvernightOther, {
    ...allClosed,
    fri: { open: '18:00', close: '02:00', closed: false },
    sat: { closed: true },
  });

  // 3. Offset overnight Fri 18:15–02:15, Sat closed
  await seedBiz(ID.bizOffset, ID.owner, `${P}off`, ID.svcOffset, {
    ...allClosed,
    fri: { open: '18:15', close: '02:15', closed: false },
    sat: { closed: true },
  });

  // 4. Midnight close Fri 18:00–00:00, Sat closed (zero next-day spillover)
  await seedBiz(ID.bizMidnight, ID.owner, `${P}mid`, ID.svcMidnight, {
    ...allClosed,
    fri: { open: '18:00', close: '00:00', closed: false },
    sat: { closed: true },
  });

  // 5. Buffered overnight Fri 18:00–02:00 with 15-min buffer
  await seedBiz(
    ID.bizBuffered,
    ID.owner,
    `${P}buf`,
    ID.svcBuffered,
    { ...allClosed, fri: { open: '18:00', close: '02:00', closed: false }, sat: { closed: true } },
    { bufferMins: 15 },
  );

  // 6. Consecutive overnight shifts: Fri 18:00–02:00 & Sat 18:00–02:00
  await seedBiz(ID.bizConsec, ID.owner, `${P}consec`, ID.svcConsec, {
    ...allClosed,
    fri: { open: '18:00', close: '02:00', closed: false },
    sat: { open: '18:00', close: '02:00', closed: false },
  });

  // 7. Unconfigured Saturday with offset Friday 18:15–02:15 spillover (SEC-SOH-03)
  await seedBiz(ID.bizUnconfigSpill, ID.owner, `${P}unconfig`, ID.svcUnconfigSpill, {
    fri: { open: '18:15', close: '02:15', closed: false },
  });

  // 8. Regular non-overnight Fri 09:00–23:00, Sat closed
  await seedBiz(ID.bizRegular, ID.owner, `${P}reg`, ID.svcRegular, {
    ...allClosed,
    fri: { open: '09:00', close: '23:00', closed: false },
    sat: { closed: true },
  });
  await db.contact.create({
    data: { id: ID.contactRegular, businessId: ID.bizRegular, firstName: 'Day', lastName: 'Guest', email: `${P}day@test.local` },
  });
}, 60_000);

beforeEach(async () => {
  await clearRateLimits();
});

afterAll(async () => {
  await cleanup();
  await clearRateLimits();
  if (app) await app.close();
  if (redis) await redis.quit();
});

describe('P229 FU-SLOTS-OVERNIGHT-HOURS (D-311, v92l_)', () => {
  const guest = { firstName: 'Night', lastName: 'Owl', email: `${P}guest@test.local` };

  it('[SOH-01] Friday 18:00–02:00 offers 18:00..23:30 on Friday and 00:00..01:00 spillover on closed Saturday across public /slots, KEY get_availability, and BookingOptimizerService', async () => {
    const friSlots = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOvernight}/slots`)
      .query({ serviceId: ID.svcOvernight, date: FRI_DATE })
      .expect(200);

    expect(friSlots.body.slots).toContain(new Date(isoAt(FRI_DATE, '18:00')).toISOString());
    expect(friSlots.body.slots).toContain(new Date(isoAt(FRI_DATE, '23:30')).toISOString());
    expect(friSlots.body.slots).not.toContain(new Date(isoAt(FRI_DATE, '09:00')).toISOString());
    expect(friSlots.body.slots).not.toContain(new Date(isoAt(FRI_DATE, '17:00')).toISOString());
    expect(friSlots.body.slots).toHaveLength(12); // 18:00..23:30 every 30m

    const satSlots = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOvernight}/slots`)
      .query({ serviceId: ID.svcOvernight, date: SAT_DATE })
      .expect(200);

    expect(satSlots.body.slots).toEqual([
      new Date(isoAt(SAT_DATE, '00:00')).toISOString(),
      new Date(isoAt(SAT_DATE, '00:30')).toISOString(),
      new Date(isoAt(SAT_DATE, '01:00')).toISOString(),
    ]);

    // KEY get_availability (BookingsAdapterService) must also return closed Saturday's spillover slots
    const keyAvail = await bookingsAdapter.getAvailability({
      businessId: ID.bizOvernight,
      serviceId: ID.svcOvernight,
      from: SAT_DATE,
      to: SAT_DATE,
    });
    expect(keyAvail.map((s) => s.startTime)).toEqual(satSlots.body.slots);

    // BookingOptimizerService must report 8 hourly slots (480 min) for an overnight 18:00–02:00 day, not 0
    const weekly = await bookingOptimizer.getWeeklyUtilization(ID.bizOvernight);
    const fridayUtil = weekly.find((d) => d.dayOfWeek === 'Friday');
    expect(fridayUtil?.totalSlots).toBe(8);
  });

  it('[SOH-02] publicCreateBooking, authenticated createBooking, and HTTP rescheduleBooking handle overnight spans, midnight-crossing overlap, cross-tenant isolation, and reject out-of-hours with 0 writes', async () => {
    // 1. Public booking at Friday 23:30 (60m -> crosses midnight to Saturday 00:30 <= 02:00) accepted
    const friLate = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernight}`)
      .send({
        serviceId: ID.svcOvernight,
        startTime: isoAt(FRI_DATE, '23:30'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(201);
    const bkId = friLate.body.bookingId as string;

    // 2. Midnight-crossing overlap: Fri 23:30–00:30 blocks Sat 00:00 in /slots, public create, and HTTP reschedule,
    //    while a second tenant with the same overnight schedule is unaffected.
    const satSlotsWhileHeld = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOvernight}/slots`)
      .query({ serviceId: ID.svcOvernight, date: SAT_DATE })
      .expect(200);
    expect(satSlotsWhileHeld.body.slots).not.toContain(new Date(isoAt(SAT_DATE, '00:00')).toISOString());
    expect(satSlotsWhileHeld.body.slots).toContain(new Date(isoAt(SAT_DATE, '00:30')).toISOString());

    const countBeforeClash = await db.booking.count({ where: { businessId: ID.bizOvernight } });
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernight}`)
      .send({
        serviceId: ID.svcOvernight,
        startTime: isoAt(SAT_DATE, '00:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);
    expect(await db.booking.count({ where: { businessId: ID.bizOvernight } })).toBe(countBeforeClash);

    // Cross-tenant control: other business still books Sat 00:00 cleanly
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernightOther}`)
      .send({
        serviceId: ID.svcOvernightOther,
        startTime: isoAt(SAT_DATE, '00:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(201);

    // 3. HTTP reschedule of bkId onto Saturday 00:00 (00:00–01:00 spillover) accepted through real guards
    const moved = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizOvernight}/bookings/${bkId}/reschedule`)
      .set(HEADER, ID.owner)
      .send({ startTime: isoAt(SAT_DATE, '00:00') })
      .expect(201);
    expect(new Date(moved.body.startTime).toISOString()).toBe(new Date(isoAt(SAT_DATE, '00:00')).toISOString());

    // 4. HTTP reschedule negative controls: Sat 01:30 (ends 02:30 > 02:00) and Sat 10:00 (closed daytime) rejected with (00:00 – 02:00)
    const badReschedLate = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizOvernight}/bookings/${bkId}/reschedule`)
      .set(HEADER, ID.owner)
      .send({ startTime: isoAt(SAT_DATE, '01:30') })
      .expect(400);
    expect(badReschedLate.body.message).toContain('00:00 – 02:00');

    const badReschedDay = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizOvernight}/bookings/${bkId}/reschedule`)
      .set(HEADER, ID.owner)
      .send({ startTime: isoAt(SAT_DATE, '10:00') })
      .expect(400);
    expect(badReschedDay.body.message).toContain('00:00 – 02:00');

    // 5. Authenticated in-app createBooking on Saturday 01:00–02:00 spillover accepted through real AuthGuard/BusinessGuard/ModuleScopeGuard
    const inApp = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizOvernight}`)
      .set(HEADER, ID.owner)
      .send({
        contactId: ID.contactOvernight,
        serviceId: ID.svcOvernight,
        startTime: isoAt(SAT_DATE, '01:00'),
        endTime: isoAt(SAT_DATE, '02:00'),
      })
      .expect(201);
    expect(new Date(inApp.body.startTime).toISOString()).toBe(new Date(isoAt(SAT_DATE, '01:00')).toISOString());

    // 6. Public booking rejections (Sat 01:30, Fri 10:00, off-grid seconds/ms on spillover) write 0 rows
    const countBeforeRejects = await db.booking.count({ where: { businessId: ID.bizOvernight } });
    for (const badTime of [
      isoAt(SAT_DATE, '01:30'),
      isoAt(FRI_DATE, '10:00'),
      `${SAT_DATE}T00:30:15-04:00`,
      `${SAT_DATE}T00:30:00.500-04:00`,
    ]) {
      await request(app.getHttpServer())
        .post(`/bookings/public/businesses/${ID.bizOvernight}`)
        .send({
          serviceId: ID.svcOvernight,
          startTime: badTime,
          ...guest,
          paymentMethod: 'CASH',
        })
        .expect(400);
    }
    expect(await db.booking.count({ where: { businessId: ID.bizOvernight } })).toBe(countBeforeRejects);
  });

  it('[SOH-03] offset overnight 18:15–02:15 preserves 30-min grid across midnight, unconfigured+spillover enforces spillover grid (SEC-SOH-03), and regular non-overnight days refuse past-closing/midnight', async () => {
    const satOffset = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOffset}/slots`)
      .query({ serviceId: ID.svcOffset, date: SAT_DATE })
      .expect(200);

    expect(satOffset.body.slots).toEqual([
      new Date(isoAt(SAT_DATE, '00:15')).toISOString(),
      new Date(isoAt(SAT_DATE, '00:45')).toISOString(),
      new Date(isoAt(SAT_DATE, '01:15')).toISOString(),
    ]);

    // 00:00 is off-grid for 18:15 shift -> 400 (0 rows); 00:15 is on-grid -> 201
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOffset}`)
      .send({
        serviceId: ID.svcOffset,
        startTime: isoAt(SAT_DATE, '00:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);
    expect(await db.booking.count({ where: { businessId: ID.bizOffset } })).toBe(0);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOffset}`)
      .send({
        serviceId: ID.svcOffset,
        startTime: isoAt(SAT_DATE, '00:15'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(201);

    // SEC-SOH-03: unconfigured Saturday with Friday 18:15–02:15 spillover must still reject 00:00 (off spillover grid) and accept 00:15
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizUnconfigSpill}`)
      .send({
        serviceId: ID.svcUnconfigSpill,
        startTime: isoAt(SAT_DATE, '00:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);
    expect(await db.booking.count({ where: { businessId: ID.bizUnconfigSpill } })).toBe(0);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizUnconfigSpill}`)
      .send({
        serviceId: ID.svcUnconfigSpill,
        startTime: isoAt(SAT_DATE, '00:15'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(201);

    // Control: non-overnight Fri 09:00–23:00 still refuses Fri 22:30 (ends 23:30) and Sat 00:30 on both public create and HTTP reschedule
    const regOk = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizRegular}`)
      .set(HEADER, ID.owner)
      .send({
        contactId: ID.contactRegular,
        serviceId: ID.svcRegular,
        startTime: isoAt(FRI_DATE, '21:00'),
        endTime: isoAt(FRI_DATE, '22:00'),
      })
      .expect(201);

    for (const badTime of [isoAt(FRI_DATE, '22:30'), isoAt(SAT_DATE, '00:30')]) {
      await request(app.getHttpServer())
        .post(`/bookings/public/businesses/${ID.bizRegular}`)
        .send({ serviceId: ID.svcRegular, startTime: badTime, ...guest, paymentMethod: 'CASH' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/bookings/businesses/${ID.bizRegular}/bookings/${regOk.body.id}/reschedule`)
        .set(HEADER, ID.owner)
        .send({ startTime: badTime })
        .expect(400);
    }
  });

  it('[SOH-04] covers 18:00–00:00 midnight close (no spillover), buffered overnight close (15m buffer excludes 01:00), and consecutive overnight shifts (dedup, sort, and non-duplicated reschedule error)', async () => {
    // 1. Fri 18:00–00:00: Fri 23:00 (ends 00:00) accepted, Fri 23:30 (ends 00:30) rejected, closed Sat has 0 slots & rejects 00:00
    const satMidnight = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizMidnight}/slots`)
      .query({ serviceId: ID.svcMidnight, date: SAT_DATE })
      .expect(200);
    expect(satMidnight.body.slots).toEqual([]);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizMidnight}`)
      .send({ serviceId: ID.svcMidnight, startTime: isoAt(FRI_DATE, '23:00'), ...guest, paymentMethod: 'CASH' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizMidnight}`)
      .send({ serviceId: ID.svcMidnight, startTime: isoAt(FRI_DATE, '23:30'), ...guest, paymentMethod: 'CASH' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizMidnight}`)
      .send({ serviceId: ID.svcMidnight, startTime: isoAt(SAT_DATE, '00:00'), ...guest, paymentMethod: 'CASH' })
      .expect(400);

    // 2. Buffered overnight (18:00–02:00, 60m duration + 15m buffer): Sat 01:00 (ends 02:15 > 02:00) excluded & rejected; 00:30 accepted
    const satBuf = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizBuffered}/slots`)
      .query({ serviceId: ID.svcBuffered, date: SAT_DATE })
      .expect(200);
    expect(satBuf.body.slots).toEqual([
      new Date(isoAt(SAT_DATE, '00:00')).toISOString(),
      new Date(isoAt(SAT_DATE, '00:30')).toISOString(),
    ]);
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizBuffered}`)
      .send({ serviceId: ID.svcBuffered, startTime: isoAt(SAT_DATE, '01:00'), ...guest, paymentMethod: 'CASH' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizBuffered}`)
      .send({ serviceId: ID.svcBuffered, startTime: isoAt(SAT_DATE, '00:30'), ...guest, paymentMethod: 'CASH' })
      .expect(201);

    // 3. Consecutive overnight shifts (Fri 18:00–02:00 & Sat 18:00–02:00): Saturday offers sorted spillover + evening slots with no duplicates,
    //    and reschedule rejection formats "(00:00 – 02:00, 18:00 – 02:00)" without duplicating "18:00 – 02:00"
    const satConsec = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizConsec}/slots`)
      .query({ serviceId: ID.svcConsec, date: SAT_DATE })
      .expect(200);
    expect(satConsec.body.slots).toHaveLength(15); // 3 spillover (00:00, 00:30, 01:00) + 12 evening (18:00..23:30)
    expect([...satConsec.body.slots].sort()).toEqual(satConsec.body.slots);
    expect(new Set(satConsec.body.slots).size).toBe(15);

    const consecBk = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizConsec}`)
      .send({ serviceId: ID.svcConsec, startTime: isoAt(SAT_DATE, '18:00'), ...guest, paymentMethod: 'CASH' })
      .expect(201);
    const consecBadResched = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizConsec}/bookings/${consecBk.body.bookingId}/reschedule`)
      .set(HEADER, ID.owner)
      .send({ startTime: isoAt(SAT_DATE, '10:00') })
      .expect(400);
    expect(consecBadResched.body.message).toContain('00:00 – 02:00, 18:00 – 02:00');
  });
});
