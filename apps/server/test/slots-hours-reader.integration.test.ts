/**
 * V1-91 / P227 (FU-SLOTS-HOURS-READER) — real-DB + HTTP integration proof.
 *
 * Business.businessHours is persisted under two day-key spellings:
 *   - Short keys: sun..sat (Your page hours editor)
 *   - Long keys:  sunday..saturday (Profile editor)
 *
 * BookingsService previously only indexed short keys in getAvailableSlots,
 * assertWithinSchedule, and rescheduleBooking, and returned `slots: []`
 * whenever businessHours was null, the requested weekday was omitted, or only
 * the long key existed.
 *
 * This suite proves against real Postgres + Redis + HTTP routes:
 *   1. Short day keys (`mon` open, `tue` closed) return matching slots & `[]`.
 *   2. Long day keys (`monday` open, `tuesday` closed) are honoured by
 *      GET /bookings/public/businesses/:id/slots (including taken slots and
 *      duration+buffer fitting) AND enforced by publicCreateBooking,
 *      createBooking, and rescheduleBooking (400 outside window or closed,
 *      201 on offered slots).
 *   3. `businessHours: null` falls back to 09:00-17:00 in /slots (omitting
 *      taken slots & slots ending past 17:00), and offered slots are bookable.
 *   4. Partial `businessHours` (day key absent, not closed:true) falls back
 *      to 09:00-17:00 in /slots instead of returning `[]`.
 *   5. Short key takes precedence over long key when both exist.
 *   6. Staff Availability rows still take precedence over businessHours
 *      (a staff member working Mon only still returns `[]` on Tue even when
 *      businessHours is null).
 *
 * Fixtures: prefix `v91d_` (registered in test/helpers/fixture-prefixes.json);
 * cleaned up via raw SQL with sqlLikePrefix(P).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91d_';
const HEADER = 'x-v91d-user';

const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`,
  bizShort: `${P}bizShort`,
  bizLong: `${P}bizLong`,
  bizNull: `${P}bizNull`,
  bizPartial: `${P}bizPartial`,
  bizPrecedence: `${P}bizPrec`,
  contactLong: `${P}contactLong`,
  contactPubPrefix: `${P}contactPub`,
  svcShort: `${P}svcShort`,
  svcLong: `${P}svcLong`,
  svcNull: `${P}svcNull`,
  svcPartial: `${P}svcPartial`,
  svcPrecedence: `${P}svcPrec`,
  staffMonOnly: `${P}staffMonOnly`,
  bkLongTaken: `${P}bkLongTaken`,
  bkNullTaken: `${P}bkNullTaken`,
};

// January 2030 calendar dates (UTC):
// 2030-01-07 = Monday, 2030-01-08 = Tuesday, 2030-01-09 = Wednesday, 2030-01-14 = Monday
const MON1 = '2030-01-07';
const TUE1 = '2030-01-08';
const WED1 = '2030-01-09';
const MON2 = '2030-01-14';

const utc = (iso: string) => new Date(iso);

let db: any;
let app: any;
let redis: any;

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

function publicBook(businessId: string, serviceId: string, startIso: string) {
  return agent()
    .post(`/bookings/public/businesses/${businessId}`)
    .send({
      serviceId,
      startTime: startIso,
      firstName: 'Pat',
      lastName: 'Public',
      email: `${P}public@test.local`,
      phone: '+18685550191',
    });
}

function inAppBook(
  businessId: string,
  body: { contactId: string; serviceId: string; startTime: string; endTime: string },
) {
  return agent()
    .post(`/bookings/businesses/${businessId}`)
    .set(HEADER, ID.owner)
    .send(body);
}

function reschedule(businessId: string, bookingId: string, startIso: string) {
  return agent()
    .post(`/bookings/businesses/${businessId}/bookings/${bookingId}/reschedule`)
    .set(HEADER, ID.owner)
    .send({ startTime: startIso });
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

  const createBiz = async (id: string, name: string, businessHours: any) => {
    await db.business.create({
      data: {
        id,
        name,
        slug: `${P}${id.slice(P.length).toLowerCase()}-slug`,
        ownerId: ID.owner,
        currency: 'TTD',
        timezone: 'UTC',
        storeEnabled: true,
        businessHours,
      },
    });
    await db.membership.create({
      data: { id: `${P}m_${id.slice(P.length)}`, userId: ID.owner, businessId: id, role: 'OWNER' },
    });
  };

  // 1. Short day keys
  await createBiz(ID.bizShort, 'V91D Short Keys', {
    mon: { open: '10:00', close: '13:00', closed: false },
    tue: { open: '09:00', close: '17:00', closed: true },
  });
  await db.service.create({
    data: { id: ID.svcShort, businessId: ID.bizShort, name: 'Short Svc', duration: 60, price: 0 },
  });

  // 2. Long day keys (Profile editor spelling) + 15m buffer
  await createBiz(ID.bizLong, 'V91D Long Keys', {
    monday: { open: '10:00', close: '13:00', closed: false },
    tuesday: { open: '09:00', close: '17:00', closed: true },
  });
  await db.contact.create({
    data: { id: ID.contactLong, businessId: ID.bizLong, firstName: 'Long', lastName: 'Client' },
  });
  await db.service.create({
    data: { id: ID.svcLong, businessId: ID.bizLong, name: 'Long Svc', duration: 60, bufferMins: 15, price: 0 },
  });
  // Taken booking on MON1 10:00-11:00 UTC (with 15m buffer blocks 09:45..11:15)
  await db.booking.create({
    data: {
      id: ID.bkLongTaken,
      businessId: ID.bizLong,
      contactId: ID.contactLong,
      serviceId: ID.svcLong,
      startTime: utc(`${MON1}T10:00:00.000Z`),
      endTime: utc(`${MON1}T11:00:00.000Z`),
      status: 'CONFIRMED',
    },
  });

  // 3. businessHours: null + staff working Monday only
  await createBiz(ID.bizNull, 'V91D Null Hours', null);
  await db.service.create({
    data: { id: ID.svcNull, businessId: ID.bizNull, name: 'Null Svc', duration: 60, price: 0 },
  });
  const nullContact = await crmStub.findOrCreateContact(ID.bizNull, { firstName: 'Seed' });
  await db.booking.create({
    data: {
      id: ID.bkNullTaken,
      businessId: ID.bizNull,
      contactId: nullContact.id,
      serviceId: ID.svcNull,
      startTime: utc(`${MON1}T10:00:00.000Z`),
      endTime: utc(`${MON1}T11:00:00.000Z`),
      status: 'CONFIRMED',
    },
  });
  await db.staffMember.create({
    data: { id: ID.staffMonOnly, businessId: ID.bizNull, name: 'Monday Staff' },
  });
  await db.availability.create({
    data: {
      id: `${P}av_mon`,
      staffId: ID.staffMonOnly,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '11:00',
    },
  });

  // 4. Partial businessHours (only mon configured; wed absent)
  await createBiz(ID.bizPartial, 'V91D Partial Hours', {
    mon: { open: '09:00', close: '12:00', closed: false },
  });
  await db.service.create({
    data: { id: ID.svcPartial, businessId: ID.bizPartial, name: 'Partial Svc', duration: 60, price: 0 },
  });

  // 5. Short-key precedence when both mon and monday exist
  await createBiz(ID.bizPrecedence, 'V91D Precedence', {
    mon: { open: '10:00', close: '12:00', closed: false },
    monday: { open: '14:00', close: '16:00', closed: false },
  });
  await db.service.create({
    data: { id: ID.svcPrecedence, businessId: ID.bizPrecedence, name: 'Prec Svc', duration: 60, price: 0 },
  });
}, 120_000);

beforeEach(clearRateLimits);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try {
      await clearRateLimits();
    } catch {
      /* best-effort */
    }
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

describe('P227 FU-SLOTS-HOURS-READER: businessHours short/long keys & default fallback', () => {
  it('CONTROL: short day keys return matching open window slots and [] on closed day', async () => {
    const open = await getSlots(ID.bizShort, ID.svcShort, MON1);
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(open.body.slots).toEqual([
      `${MON1}T10:00:00.000Z`,
      `${MON1}T10:30:00.000Z`,
      `${MON1}T11:00:00.000Z`,
      `${MON1}T11:30:00.000Z`,
      `${MON1}T12:00:00.000Z`,
    ]);

    const closed = await getSlots(ID.bizShort, ID.svcShort, TUE1);
    expect(closed.status).toBe(200);
    expect(closed.body.slots).toEqual([]);
  });

  it('RED-BEFORE: long day keys (monday/tuesday) return matching slots (omitting taken & past-close-with-buffer) and [] on closed day', async () => {
    // Clean Monday (MON2): 10:00-13:00, duration 60m + buffer 15m -> last fitting start is 11:30 (ends 12:45 <= 13:00)
    const clean = await getSlots(ID.bizLong, ID.svcLong, MON2);
    expect(clean.status, JSON.stringify(clean.body)).toBe(200);
    expect(clean.body.slots).toEqual([
      `${MON2}T10:00:00.000Z`,
      `${MON2}T10:30:00.000Z`,
      `${MON2}T11:00:00.000Z`,
      `${MON2}T11:30:00.000Z`,
    ]);

    // Taken Monday (MON1): 10:00-11:00 taken with 15m buffer blocks 10:00, 10:30, 11:00; only 11:30 remains
    const withTaken = await getSlots(ID.bizLong, ID.svcLong, MON1);
    expect(withTaken.status, JSON.stringify(withTaken.body)).toBe(200);
    expect(withTaken.body.slots).toEqual([`${MON1}T11:30:00.000Z`]);

    // Closed Tuesday (tuesday: { closed: true }) -> []
    const closed = await getSlots(ID.bizLong, ID.svcLong, TUE1);
    expect(closed.status).toBe(200);
    expect(closed.body.slots).toEqual([]);
  });

  it('RED-BEFORE: write paths (publicCreateBooking, createBooking, rescheduleBooking) enforce long-key closed day & open/close+buffer bounds', async () => {
    // Public create on closed Tuesday (long key) -> 400
    const pubClosed = await publicBook(ID.bizLong, ID.svcLong, `${TUE1}T11:00:00.000Z`);
    expect(pubClosed.status, JSON.stringify(pubClosed.body)).toBe(400);
    expect(pubClosed.body.message).toBe('This business is closed on the selected day.');

    // In-app create on closed Tuesday (long key) -> 400
    const inAppClosed = await inAppBook(ID.bizLong, {
      contactId: ID.contactLong,
      serviceId: ID.svcLong,
      startTime: `${TUE1}T11:00:00.000Z`,
      endTime: `${TUE1}T12:00:00.000Z`,
    });
    expect(inAppClosed.status, JSON.stringify(inAppClosed.body)).toBe(400);
    expect(inAppClosed.body.message).toBe('This business is closed on the selected day.');

    // Public create before open (09:00 < 10:00) -> 400
    const pubEarly = await publicBook(ID.bizLong, ID.svcLong, `${MON2}T09:00:00.000Z`);
    expect(pubEarly.status, JSON.stringify(pubEarly.body)).toBe(400);
    expect(pubEarly.body.message).toBe('The selected time is outside business hours.');

    // Public create whose duration+buffer passes close (12:00 + 60m + 15m = 13:15 > 13:00) -> 400
    const pubLate = await publicBook(ID.bizLong, ID.svcLong, `${MON2}T12:00:00.000Z`);
    expect(pubLate.status, JSON.stringify(pubLate.body)).toBe(400);
    expect(pubLate.body.message).toBe('The selected time is outside business hours.');

    // Offered slot (10:00) succeeds with 201
    const ok = await publicBook(ID.bizLong, ID.svcLong, `${MON2}T10:00:00.000Z`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const bookingId: string = ok.body.bookingId;
    expect(bookingId).toEqual(expect.any(String));

    // Reschedule to long-key closed Tuesday -> 400
    const reschClosed = await reschedule(ID.bizLong, bookingId, `${TUE1}T11:00:00.000Z`);
    expect(reschClosed.status, JSON.stringify(reschClosed.body)).toBe(400);
    expect(reschClosed.body.message).toBe('The business is closed on this day.');

    // Reschedule before long-key opening (09:00) -> 400
    const reschEarly = await reschedule(ID.bizLong, bookingId, `${MON2}T09:00:00.000Z`);
    expect(reschEarly.status, JSON.stringify(reschEarly.body)).toBe(400);
    expect(reschEarly.body.message).toBe('The selected time is outside business hours (10:00 – 13:00).');

    // Reschedule whose buffer runs past long-key closing (12:00) -> 400
    const reschLate = await reschedule(ID.bizLong, bookingId, `${MON2}T12:00:00.000Z`);
    expect(reschLate.status, JSON.stringify(reschLate.body)).toBe(400);
    expect(reschLate.body.message).toBe('The selected time is outside business hours (10:00 – 13:00).');

    // Reschedule to valid offered slot (11:30) -> 201
    const reschOk = await reschedule(ID.bizLong, bookingId, `${MON2}T11:30:00.000Z`);
    expect(reschOk.status, JSON.stringify(reschOk.body)).toBe(201);
    expect(new Date(reschOk.body.startTime).toISOString()).toBe(`${MON2}T11:30:00.000Z`);
  });

  it('RED-BEFORE: businessHours: null falls back to 09:00-17:00 (omitting taken & past-17:00 slots), and offered slot books cleanly', async () => {
    const res = await getSlots(ID.bizNull, ID.svcNull, MON1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list: string[] = res.body.slots;

    // 09:00-17:00 with 60m duration -> starts 09:00..16:00, minus 09:30, 10:00, 10:30 (taken 10:00-11:00)
    expect(list[0]).toBe(`${MON1}T09:00:00.000Z`);
    expect(list[list.length - 1]).toBe(`${MON1}T16:00:00.000Z`);
    expect(list).not.toContain(`${MON1}T09:30:00.000Z`);
    expect(list).not.toContain(`${MON1}T10:00:00.000Z`);
    expect(list).not.toContain(`${MON1}T10:30:00.000Z`);
    expect(list).toContain(`${MON1}T11:00:00.000Z`);
    expect(list).not.toContain(`${MON1}T16:30:00.000Z`);

    // Booking an offered slot succeeds
    const booked = await publicBook(ID.bizNull, ID.svcNull, `${MON1}T14:00:00.000Z`);
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
  });

  it('RED-BEFORE: partial businessHours (absent day key) falls back to 09:00-17:00 rather than []', async () => {
    // Configured Monday uses its explicit 09:00-12:00 window
    const mon = await getSlots(ID.bizPartial, ID.svcPartial, MON1);
    expect(mon.status).toBe(200);
    expect(mon.body.slots).toEqual([
      `${MON1}T09:00:00.000Z`,
      `${MON1}T09:30:00.000Z`,
      `${MON1}T10:00:00.000Z`,
      `${MON1}T10:30:00.000Z`,
      `${MON1}T11:00:00.000Z`,
    ]);

    // Unconfigured Wednesday (not closed: true) falls back to 09:00-17:00
    const wed = await getSlots(ID.bizPartial, ID.svcPartial, WED1);
    expect(wed.status, JSON.stringify(wed.body)).toBe(200);
    expect(wed.body.slots[0]).toBe(`${WED1}T09:00:00.000Z`);
    expect(wed.body.slots[wed.body.slots.length - 1]).toBe(`${WED1}T16:00:00.000Z`);
    expect(wed.body.slots).toHaveLength(15);

    const booked = await publicBook(ID.bizPartial, ID.svcPartial, `${WED1}T15:00:00.000Z`);
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
  });

  it('CONTROL: short key takes precedence over long key when both exist', async () => {
    const res = await getSlots(ID.bizPrecedence, ID.svcPrecedence, MON1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.slots).toEqual([
      `${MON1}T10:00:00.000Z`,
      `${MON1}T10:30:00.000Z`,
      `${MON1}T11:00:00.000Z`,
    ]);

    // 14:00 is inside `monday` but outside `mon` (10:00-12:00) -> refused
    const refused = await publicBook(ID.bizPrecedence, ID.svcPrecedence, `${MON1}T14:00:00.000Z`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('The selected time is outside business hours.');
  });

  it('CONTROL: staff Availability still takes precedence over businessHours (Mon-only staff returns [] on Tue even with null businessHours)', async () => {
    const mon = await getSlots(ID.bizNull, ID.svcNull, MON1, ID.staffMonOnly);
    expect(mon.status).toBe(200);
    expect(mon.body.slots).toEqual([
      `${MON1}T09:00:00.000Z`,
      `${MON1}T09:30:00.000Z`,
      `${MON1}T10:00:00.000Z`,
    ]);

    const tue = await getSlots(ID.bizNull, ID.svcNull, TUE1, ID.staffMonOnly);
    expect(tue.status).toBe(200);
    expect(tue.body.slots).toEqual([]);
  });
});
