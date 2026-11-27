/**
 * V1-91 / P226 (FU-PUBLIC-BOOKING-GRID, from SWP-BOOKING-SLOTS SEC-SLOTS-M1)
 * — real-DB + real-HTTP integration proof.
 *
 * Proves against real Postgres + Redis + HTTP routes:
 *   - PBG-01: Invalid `startTime` ("not-a-date", "", null, missing,
 *     "2026-13-45T99:00:00Z", "2026-02-30T10:00:00Z", numeric) on
 *     POST /bookings/public/businesses/:businessId — as well as direct
 *     BookingsController.publicCreateBooking and BookingsService.publicCreateBooking
 *     calls with invalid dates and GET .../slots with an impossible calendar date —
 *     return HTTP 400 (never 500) and create 0 booking rows.
 *   - PBG-02: Off-grid `startTime` within business hours (09:07, 09:15,
 *     09:00:30 non-zero seconds, 09:00:00.500 non-zero milliseconds) returns
 *     HTTP 400 and creates 0 booking rows.
 *   - PBG-03: Every slot returned by GET /bookings/public/businesses/:businessId/slots
 *     (default 09:00-17:00, custom 09:15-12:15, and non-UTC America/Port_of_Spain
 *     09:15-11:45) IS accepted by POST /bookings/public/businesses/:businessId (201),
 *     while 09:00 or 09:30 for a 09:15-open schedule is rejected (400).
 *   - PBG-04: Staff-specific Availability window (staff starts at 10:15-12:45) —
 *     every slot from GET .../slots?staffId=... is accepted (201), while off-grid
 *     times (10:30, 11:00, 10:22, 10:15:15, 10:15:00.250) and out-of-window
 *     times (09:30) are rejected (400) with 0 booking rows created.
 *   - PBG-05: Cross-tenant isolation — foreign serviceId/staffId are rejected
 *     with 404 and zero cross-tenant data leakage or writes; operator
 *     authenticated createBooking still accepts custom off-grid times (201).
 *
 * Fixtures: prefix `v91h_` (registered in test/helpers/fixture-prefixes.json);
 * cleaned up via raw SQL with sqlLikePrefix(P).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91h_';
const HEADER = 'x-v91h-user';

const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`,
  ownerOther: `${P}ownerOther`,
  bizDefault: `${P}bizDefault`,
  bizCustom: `${P}bizCustom`,
  bizPos: `${P}bizPos`,
  bizStaff: `${P}bizStaff`,
  bizOther: `${P}bizOther`,
  svcDefault: `${P}svcDefault`,
  svcCustom: `${P}svcCustom`,
  svcPos: `${P}svcPos`,
  svcStaff: `${P}svcStaff`,
  svcOther: `${P}svcOther`,
  staffGrid: `${P}staffGrid`,
  staffOther: `${P}staffOther`,
  contactDefault: `${P}contactDefault`,
  contactPubPrefix: `${P}contactPub`,
};

// 2030-01-07 is a Monday in UTC and in America/Port_of_Spain (UTC-4).
const MON = '2030-01-07';

let db: any;
let app: any;
let redis: any;
let bookingsController: any;
let bookingsService: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};

const crmStub = {
  logContactEvent: async () => null,
  findOrCreateContact: async (
    businessId: string,
    input: { firstName?: string | null; lastName?: string | null; email?: string | null },
  ) => {
    const id = `${ID.contactPubPrefix}_${businessId.slice(P.length)}`;
    return db.contact.upsert({
      where: { id },
      update: {},
      create: {
        id,
        businessId,
        firstName: input.firstName ?? 'Public',
        lastName: input.lastName ?? null,
        email: input.email ?? null,
      },
    });
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM availabilities WHERE staff_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

function getSlots(businessId: string, serviceId: string, date: string, staffId?: string) {
  return agent()
    .get(`/bookings/public/businesses/${businessId}/slots`)
    .query({ serviceId, date, ...(staffId ? { staffId } : {}) });
}

function publicBookRaw(businessId: string, payload: Record<string, unknown>) {
  return agent()
    .post(`/bookings/public/businesses/${businessId}`)
    .send(payload);
}

function publicBook(businessId: string, serviceId: string, startTime: unknown, staffId?: string) {
  const body: Record<string, unknown> = {
    serviceId,
    startTime,
    firstName: 'Grid',
    lastName: 'Tester',
    email: `${P}customer@test.local`,
    phone: '+18685550199',
  };
  if (staffId !== undefined) body.staffId = staffId;
  return publicBookRaw(businessId, body);
}

async function cancelBooking(bookingId: string) {
  await db.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
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
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CreateBookingDto } = await import('../src/modules/bookings/dto/create-booking.dto');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');

  Reflect.defineMetadata(
    'design:paramtypes',
    [String, CreateBookingDto, Object],
    BookingsController.prototype,
    'createBooking',
  );
  Reflect.defineMetadata(
    'design:paramtypes',
    [String, PublicCreateBookingDto],
    BookingsController.prototype,
    'publicCreateBooking',
  );

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      BookingsService,
      CatalogService,
      { provide: EventEmitter2, useValue: eventStub },
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
      { provide: BookingOptimizerService, useValue: {} },
    ],
  }).compile();

  bookingsController = moduleRef.get(BookingsController);
  bookingsService = moduleRef.get(BookingsService);

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
  await app.init();

  await cleanup();
  await clearRateLimits();

  await db.user.create({
    data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' },
  });
  await db.user.create({
    data: { id: ID.ownerOther, email: `${P}owner-other@test.local`, role: 'USER' },
  });

  const createBiz = async (
    id: string,
    ownerId: string,
    name: string,
    timezone: string,
    businessHours: any,
  ) => {
    await db.business.create({
      data: {
        id,
        name,
        slug: `${P}${id.slice(P.length).toLowerCase()}-slug`,
        ownerId,
        currency: 'TTD',
        timezone,
        storeEnabled: true,
        businessHours,
      },
    });
    await db.membership.create({
      data: { id: `${P}m_${id.slice(P.length)}`, userId: ownerId, businessId: id, role: 'OWNER' },
    });
  };

  // 1. Default hours (businessHours: null -> 09:00-17:00 UTC in /slots)
  await createBiz(ID.bizDefault, ID.owner, 'V91H Default Hours', 'UTC', null);
  await db.service.create({
    data: { id: ID.svcDefault, businessId: ID.bizDefault, name: 'Default Svc', duration: 60, price: 0 },
  });
  await db.contact.create({
    data: { id: ID.contactDefault, businessId: ID.bizDefault, firstName: 'Op', lastName: 'Client' },
  });

  // 2. Custom open on :15 (09:15-12:15 UTC)
  await createBiz(ID.bizCustom, ID.owner, 'V91H Custom 0915', 'UTC', {
    mon: { open: '09:15', close: '12:15', closed: false },
    tue: { open: '09:00', close: '17:00', closed: true },
  });
  await db.service.create({
    data: { id: ID.svcCustom, businessId: ID.bizCustom, name: 'Custom Svc', duration: 60, price: 0 },
  });

  // 3. Non-UTC timezone America/Port_of_Spain (UTC-4) opening at 09:15 local (13:15Z)
  await createBiz(ID.bizPos, ID.owner, 'V91H Port of Spain', 'America/Port_of_Spain', {
    mon: { open: '09:15', close: '11:45', closed: false },
  });
  await db.service.create({
    data: { id: ID.svcPos, businessId: ID.bizPos, name: 'POS Svc', duration: 60, price: 0 },
  });

  // 4. Staff-specific availability window (Mon 10:15-12:45 UTC) overriding business 09:00-17:00
  await createBiz(ID.bizStaff, ID.owner, 'V91H Staff Window', 'UTC', {
    mon: { open: '09:00', close: '17:00', closed: false },
  });
  await db.service.create({
    data: { id: ID.svcStaff, businessId: ID.bizStaff, name: 'Staff Svc', duration: 60, price: 0 },
  });
  await db.staffMember.create({
    data: { id: ID.staffGrid, businessId: ID.bizStaff, name: 'Grid Staff' },
  });
  await db.availability.create({
    data: {
      id: `${P}av_mon_grid`,
      staffId: ID.staffGrid,
      dayOfWeek: 1,
      startTime: '10:15',
      endTime: '12:45',
    },
  });

  // 5. Cross-tenant business B
  await createBiz(ID.bizOther, ID.ownerOther, 'V91H Other Tenant', 'UTC', {
    mon: { open: '09:00', close: '17:00', closed: false },
  });
  await db.service.create({
    data: { id: ID.svcOther, businessId: ID.bizOther, name: 'Other Svc', duration: 60, price: 0 },
  });
  await db.staffMember.create({
    data: { id: ID.staffOther, businessId: ID.bizOther, name: 'V91H-SECRET-FOREIGN-STAFF' },
  });
  await db.availability.create({
    data: {
      id: `${P}av_mon_other`,
      staffId: ID.staffOther,
      dayOfWeek: 1,
      startTime: '10:15',
      endTime: '12:45',
    },
  });
}, 60_000);

beforeEach(async () => {
  await clearRateLimits();
  await db.$executeRawUnsafe(`DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`);
});

afterAll(async () => {
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
  if (redis) {
    await clearRateLimits().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
  await cleanup();
  if (app) await app.close();
}, 30_000);

describe('P226 (FU-PUBLIC-BOOKING-GRID): 30-min slot grid & invalid startTime hardening', () => {
  it('PBG-01: invalid startTime values return HTTP 400 (never 500) across HTTP, controller, service, and slots date, creating 0 rows', async () => {
    const before = await db.booking.count({ where: { businessId: ID.bizDefault } });

    const invalidBodies: Array<{ label: string; payload: Record<string, unknown> }> = [
      {
        label: 'non-date string',
        payload: {
          serviceId: ID.svcDefault,
          startTime: 'not-a-date',
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
      {
        label: 'blank string',
        payload: {
          serviceId: ID.svcDefault,
          startTime: '',
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
      {
        label: 'null startTime',
        payload: {
          serviceId: ID.svcDefault,
          startTime: null,
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
      {
        label: 'missing startTime',
        payload: {
          serviceId: ID.svcDefault,
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
      {
        label: 'out-of-range ISO components',
        payload: {
          serviceId: ID.svcDefault,
          startTime: '2026-13-45T99:00:00Z',
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
      {
        label: 'impossible calendar date (Feb 30)',
        payload: {
          serviceId: ID.svcDefault,
          startTime: '2026-02-30T10:00:00Z',
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
      {
        label: 'numeric startTime',
        payload: {
          serviceId: ID.svcDefault,
          startTime: 1234567890,
          firstName: 'Bad',
          lastName: 'Date',
          email: `${P}pbg01@test.local`,
          phone: '+18685550101',
        },
      },
    ];

    for (const { label, payload } of invalidBodies) {
      await clearRateLimits();
      const res = await publicBookRaw(ID.bizDefault, payload);
      expect(res.status, `HTTP ${label}: ${JSON.stringify(res.body)}`).toBe(400);
    }

    // Direct controller invocation (bypassing ValidationPipe) must also reject with 400 BadRequestException, never 500/Prisma error.
    for (const bad of ['not-a-date', '', null, undefined, '2026-13-45T99:00:00Z', '2026-02-30T10:00:00Z', 12345]) {
      await expect(
        bookingsController.publicCreateBooking(ID.bizDefault, {
          serviceId: ID.svcDefault,
          startTime: bad as any,
          firstName: 'Direct',
          lastName: 'Controller',
          email: `${P}pbg01-direct@test.local`,
          phone: '+18685550102',
        }),
        `direct controller startTime=${JSON.stringify(bad)}`,
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    // Direct service invocation with Invalid Date must reject with 400 BadRequestException.
    await expect(
      bookingsService.publicCreateBooking({
        businessId: ID.bizDefault,
        serviceId: ID.svcDefault,
        startTime: new Date('not-a-date'),
        contact: {
          firstName: 'Direct',
          lastName: 'Service',
          email: `${P}pbg01-svc@test.local`,
          phone: '+18685550103',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Public slots route must also reject impossible calendar date (Feb 30) with 400.
    const badSlots = await getSlots(ID.bizDefault, ID.svcDefault, '2026-02-30');
    expect(badSlots.status, JSON.stringify(badSlots.body)).toBe(400);

    const after = await db.booking.count({ where: { businessId: ID.bizDefault } });
    expect(after).toBe(before);
  });

  it('PBG-02: off-grid startTime within business hours (09:07, 09:15, 09:00:30, 09:00:00.500) returns HTTP 400 and creates 0 rows', async () => {
    const beforeDefault = await db.booking.count({ where: { businessId: ID.bizDefault } });
    const beforeExplicit = await db.booking.count({ where: { businessId: ID.bizStaff } });

    const offGridInstants = [
      `${MON}T09:07:00.000Z`,
      `${MON}T09:15:00.000Z`,
      `${MON}T09:00:30.000Z`,
      `${MON}T09:00:00.500Z`,
    ];

    for (const startIso of offGridInstants) {
      await clearRateLimits();
      const resDefault = await publicBook(ID.bizDefault, ID.svcDefault, startIso);
      expect(resDefault.status, `bizDefault off-grid ${startIso}: ${JSON.stringify(resDefault.body)}`).toBe(400);

      await clearRateLimits();
      const resExplicit = await publicBook(ID.bizStaff, ID.svcStaff, startIso);
      expect(resExplicit.status, `bizStaff (09:00-17:00) off-grid ${startIso}: ${JSON.stringify(resExplicit.body)}`).toBe(400);
    }

    expect(await db.booking.count({ where: { businessId: ID.bizDefault } })).toBe(beforeDefault);
    expect(await db.booking.count({ where: { businessId: ID.bizStaff } })).toBe(beforeExplicit);
  });

  it('PBG-03: every slot offered by GET .../slots (default 09:00-17:00, custom 09:15-12:15, and America/Port_of_Spain) is accepted (201), while 09:00 and 09:30 on a 09:15-open schedule are rejected (400)', async () => {
    // 1. Default 09:00-17:00 UTC (businessHours: null)
    const defaultSlotsRes = await getSlots(ID.bizDefault, ID.svcDefault, MON);
    expect(defaultSlotsRes.status).toBe(200);
    const defaultSlots: string[] = defaultSlotsRes.body.slots;
    expect(defaultSlots.length).toBe(15); // 09:00..16:00 every 30m for 60m service
    expect(defaultSlots[0]).toBe(`${MON}T09:00:00.000Z`);
    expect(defaultSlots[defaultSlots.length - 1]).toBe(`${MON}T16:00:00.000Z`);

    for (const slotIso of defaultSlots) {
      await clearRateLimits();
      const res = await publicBook(ID.bizDefault, ID.svcDefault, slotIso);
      expect(res.status, `default slot ${slotIso}: ${JSON.stringify(res.body)}`).toBe(201);
      await cancelBooking(res.body.bookingId);
    }

    // 2. Custom 09:15-12:15 UTC
    const customSlotsRes = await getSlots(ID.bizCustom, ID.svcCustom, MON);
    expect(customSlotsRes.status).toBe(200);
    const customSlots: string[] = customSlotsRes.body.slots;
    expect(customSlots).toEqual([
      `${MON}T09:15:00.000Z`,
      `${MON}T09:45:00.000Z`,
      `${MON}T10:15:00.000Z`,
      `${MON}T10:45:00.000Z`,
      `${MON}T11:15:00.000Z`,
    ]);

    for (const slotIso of customSlots) {
      await clearRateLimits();
      const res = await publicBook(ID.bizCustom, ID.svcCustom, slotIso);
      expect(res.status, `custom slot ${slotIso}: ${JSON.stringify(res.body)}`).toBe(201);
      await cancelBooking(res.body.bookingId);
    }

    const customCountBeforeReject = await db.booking.count({ where: { businessId: ID.bizCustom } });
    for (const badIso of [`${MON}T09:00:00.000Z`, `${MON}T09:30:00.000Z`, `${MON}T10:00:00.000Z`, `${MON}T09:15:30.000Z`]) {
      await clearRateLimits();
      const res = await publicBook(ID.bizCustom, ID.svcCustom, badIso);
      expect(res.status, `custom rejected ${badIso}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(await db.booking.count({ where: { businessId: ID.bizCustom } })).toBe(customCountBeforeReject);

    // 3. Non-UTC timezone America/Port_of_Spain (UTC-4), open 09:15-11:45 local -> 13:15Z..14:45Z
    const posSlotsRes = await getSlots(ID.bizPos, ID.svcPos, MON);
    expect(posSlotsRes.status).toBe(200);
    const posSlots: string[] = posSlotsRes.body.slots;
    expect(posSlots).toEqual([
      `${MON}T13:15:00.000Z`,
      `${MON}T13:45:00.000Z`,
      `${MON}T14:15:00.000Z`,
      `${MON}T14:45:00.000Z`,
    ]);

    for (const slotIso of posSlots) {
      await clearRateLimits();
      const res = await publicBook(ID.bizPos, ID.svcPos, slotIso);
      expect(res.status, `POS slot ${slotIso}: ${JSON.stringify(res.body)}`).toBe(201);
      await cancelBooking(res.body.bookingId);
    }

    const posCountBeforeReject = await db.booking.count({ where: { businessId: ID.bizPos } });
    // 13:00Z = 09:00 local (before 09:15 open); 13:30Z = 09:30 local (off-grid); 13:15:30Z (non-zero seconds)
    for (const badIso of [`${MON}T13:00:00.000Z`, `${MON}T13:30:00.000Z`, `${MON}T13:15:30.000Z`]) {
      await clearRateLimits();
      const res = await publicBook(ID.bizPos, ID.svcPos, badIso);
      expect(res.status, `POS rejected ${badIso}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(await db.booking.count({ where: { businessId: ID.bizPos } })).toBe(posCountBeforeReject);
  });

  it('PBG-04: staff-specific Availability window (10:15-12:45) accepts all offered slots and rejects off-grid & out-of-window times', async () => {
    const slotsRes = await getSlots(ID.bizStaff, ID.svcStaff, MON, ID.staffGrid);
    expect(slotsRes.status).toBe(200);
    const staffSlots: string[] = slotsRes.body.slots;
    expect(staffSlots).toEqual([
      `${MON}T10:15:00.000Z`,
      `${MON}T10:45:00.000Z`,
      `${MON}T11:15:00.000Z`,
      `${MON}T11:45:00.000Z`,
    ]);

    for (const slotIso of staffSlots) {
      await clearRateLimits();
      const res = await publicBook(ID.bizStaff, ID.svcStaff, slotIso, ID.staffGrid);
      expect(res.status, `staff slot ${slotIso}: ${JSON.stringify(res.body)}`).toBe(201);
      await cancelBooking(res.body.bookingId);
    }

    const beforeReject = await db.booking.count({ where: { businessId: ID.bizStaff } });
    const rejectedStaffTimes = [
      `${MON}T09:30:00.000Z`, // inside business hours, outside staff window
      `${MON}T10:30:00.000Z`, // inside staff window, off 10:15 + 30m grid
      `${MON}T11:00:00.000Z`, // inside staff window, off 10:15 + 30m grid
      `${MON}T10:22:00.000Z`, // arbitrary minute
      `${MON}T10:15:15.000Z`, // non-zero seconds
      `${MON}T10:15:00.250Z`, // non-zero milliseconds
    ];
    for (const badIso of rejectedStaffTimes) {
      await clearRateLimits();
      const res = await publicBook(ID.bizStaff, ID.svcStaff, badIso, ID.staffGrid);
      expect(res.status, `staff rejected ${badIso}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(await db.booking.count({ where: { businessId: ID.bizStaff } })).toBe(beforeReject);
  });

  it('PBG-05: cross-tenant foreign serviceId/staffId are rejected (404) with zero leakage, while authenticated operator createBooking still allows custom off-grid times', async () => {
    const beforeDefault = await db.booking.count({ where: { businessId: ID.bizDefault } });
    const beforeOther = await db.booking.count({ where: { businessId: ID.bizOther } });

    const foreignSvc = await publicBook(ID.bizDefault, ID.svcOther, `${MON}T09:00:00.000Z`);
    expect(foreignSvc.status, JSON.stringify(foreignSvc.body)).toBe(404);
    expect(JSON.stringify(foreignSvc.body)).not.toContain('Other Svc');

    await clearRateLimits();
    const foreignStaff = await publicBook(ID.bizDefault, ID.svcDefault, `${MON}T10:15:00.000Z`, ID.staffOther);
    expect(foreignStaff.status, JSON.stringify(foreignStaff.body)).toBe(404);
    expect(JSON.stringify(foreignStaff.body)).not.toContain('V91H-SECRET-FOREIGN-STAFF');

    expect(await db.booking.count({ where: { businessId: ID.bizDefault } })).toBe(beforeDefault);
    expect(await db.booking.count({ where: { businessId: ID.bizOther } })).toBe(beforeOther);

    // Operator authenticated createBooking stays untouched and can still book a custom off-grid time.
    const opRes = await agent()
      .post(`/bookings/businesses/${ID.bizDefault}`)
      .set(HEADER, ID.owner)
      .send({
        contactId: ID.contactDefault,
        serviceId: ID.svcDefault,
        startTime: `${MON}T09:15:00.000Z`,
        endTime: `${MON}T10:15:00.000Z`,
      });
    expect(opRes.status, JSON.stringify(opRes.body)).toBe(201);
  });
});
