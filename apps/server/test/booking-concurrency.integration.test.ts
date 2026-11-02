/**
 * V1-16-BK-SLOT-CONCURRENCY — the slot claim and the business's clock against
 * a REAL database.
 *
 * M41 / M43 / CF-44. Two defects, both disclosed by earlier work:
 *
 *   THE RACE. assertSlotFree is a findFirst, and every write path runs it and
 *   then, several awaits later, a separate create or update. booking-overlap.
 *   spec.ts has said so since the overlap guard landed ("two simultaneous
 *   requests can both pass this read before either writes"). Two customers
 *   pressing "book" for the last slot both got a booking.
 *
 *   THE CLOCK. Opening hours, staff hours and the picker's day were read with
 *   getHours/getDay/setHours in the SERVER's zone. Production runs with TZ
 *   unset (UTC), so a Port_of_Spain (UTC-4) business had its hours shifted four
 *   hours early, and the answer changed whenever the host's zone did.
 *
 * Cases:
 *   RED-BEFORE (fail at the V1-06 head): ten concurrent public creates for one
 *   slot write one booking, and the other nine are refused with the overlap
 *   message; public and in-app creates racing for one staff member's slot write
 *   one; two reschedules and a create racing into one free slot leave one
 *   owner; Port_of_Spain 09:00-11:00 is offered as 13:00Z-14:00Z starts under
 *   TZ=UTC and TZ=America/New_York; a slot the picker offers is bookable on
 *   both create paths with the server in New York.
 *   CONTROL (green at the base, kept as regression controls): two staff
 *   members in the same slot both succeed; the same slot in another tenant
 *   does not block; a reschedule into an occupied slot is refused.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * PlanLimitGuard, PublicRateLimitGuard (real Redis at REDIS_URL, this suite's
 * own key namespace), HoneypotGuard, BookingsController and BookingsService
 * read and write real rows behind the production GlobalHttpExceptionFilter and
 * ValidationPipe. Identity attachment is the one stand-in: a test middleware
 * reads `x-v16a-user` and attaches the seeded user row as AuthMiddleware would.
 * Collaborators off the boundary are stubs: the event bus, the contact
 * timeline, the public path's contact resolution (returns the business's one
 * seeded public contact after a 30 ms pause, standing in for the CRM round
 * trip that sits between the overlap read and the write), invoices (every
 * service here is free), revenue attribution, storefront events, email, plan
 * limits (always allowed) and the Google calendar.
 *
 * The server runs at TZ=UTC (production's unset zone) unless a case says
 * otherwise; every instant below is written in UTC. Fixtures: prefix `v16a_`
 * (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 * Literals in globally unique columns embed the prefix.
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

const P = 'v16a_';
const HEADER = 'x-v16a-user';

// This suite's public rate-limit keys live under its own namespace.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
const PREVIOUS_TZ = process.env.TZ;

const POS = 'America/Port_of_Spain'; // UTC-4 all year, no DST

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`, // Port_of_Spain, weekdays 09:00-17:00 local
  bizB: `${P}bizB`, // another tenant, same zone and hours
  bizS: `${P}bizS`, // Port_of_Spain, Mondays 09:00-11:00 local only
  contactA: `${P}contactA`,
  contactS: `${P}contactS`,
  staff1: `${P}staff1`,
  staff2: `${P}staff2`,
  staffR: `${P}staffR`,
  svcRace: `${P}svcRace`,
  svcB: `${P}svcB`,
  svcS: `${P}svcS`,
  svcS2: `${P}svcS2`,
  bkR1: `${P}bkR1`,
  bkR2: `${P}bkR2`,
};

/** The one public contact the stubbed CRM resolves to in each business. */
const publicContactId = (businessId: string) => `${P}pub_${businessId.slice(P.length)}`;

const MSG = {
  taken: 'That time slot has already been booked. Please choose another.',
};

// 2030-01-07 is a Monday. 13:00Z-17:00Z is 09:00-13:00 in Port_of_Spain, and
// it is also inside 09:00-17:00 read as UTC, so the race cases below fail at
// the base for the race alone, not for the clock.
const utc = (iso: string) => new Date(iso);
const plusMins = (d: Date, mins: number) => new Date(d.getTime() + mins * 60_000);

const WEEKDAY = { open: '09:00', close: '17:00', closed: false };
const CLOSED = { open: '00:00', close: '00:00', closed: true };
const HOURS = { mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY, sat: CLOSED, sun: CLOSED };

let db: any;
let app: any;
let redis: any;
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
  findOrCreateContact: async (businessId: string) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return db.contact.findUnique({ where: { id: publicContactId(businessId) } });
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

/** The public widget's create, anonymous. */
function publicCreate(input: { businessId?: string; serviceId: string; staffId?: string; start: Date }) {
  return agent()
    .post(`/bookings/public/businesses/${input.businessId ?? ID.bizA}`)
    .send({
      serviceId: input.serviceId,
      ...(input.staffId ? { staffId: input.staffId } : {}),
      startTime: input.start.toISOString(),
      firstName: 'Pat',
      lastName: 'Public',
      email: `${P}public@test.local`,
      phone: '+18685550100',
    });
}

/** The in-app create, as the business owner, for a 60-minute booking. */
function inAppCreate(input: { businessId?: string; contactId?: string; serviceId: string; staffId?: string; start: Date }) {
  const owner = input.businessId === ID.bizB ? ID.ownerB : ID.ownerA;
  return agent()
    .post(`/bookings/businesses/${input.businessId ?? ID.bizA}`)
    .set(HEADER, owner)
    .send({
      contactId: input.contactId ?? ID.contactA,
      serviceId: input.serviceId,
      ...(input.staffId ? { staffId: input.staffId } : {}),
      startTime: input.start.toISOString(),
      endTime: plusMins(input.start, 60).toISOString(),
    });
}

function reschedule(bookingId: string, start: Date) {
  return agent()
    .post(`/bookings/businesses/${ID.bizA}/bookings/${bookingId}/reschedule`)
    .set(HEADER, ID.ownerA)
    .send({ startTime: start.toISOString() });
}

/** Live bookings (not cancelled, not deleted) starting at `start`. */
function liveAt(businessId: string, start: Date, extra: Record<string, unknown> = {}) {
  return db.booking.findMany({
    where: { businessId, startTime: start, deletedAt: null, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, ...extra },
    select: { id: true, staffId: true, serviceId: true, contactId: true },
  });
}

const created = (res: any) => res.status === 201;
const describeResults = (results: any[]) =>
  results.map((r) => `${r.status} ${r.body?.message ?? r.body?.bookingId ?? r.body?.id ?? ''}`).join(' | ');

beforeAll(async () => {
  // Production runs with TZ unset, which is UTC.
  process.env.TZ = 'UTC';

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

  // The two create handlers' parameter types as tsc emits them for the
  // production build (emitDecoratorMetadata), which vitest's esbuild transform
  // does not; without them the global ValidationPipe checks nothing.
  // bookings-core.integration.test.ts asserts this list against tsc's output.
  Reflect.defineMetadata('design:paramtypes', [String, CreateBookingDto, Object], BookingsController.prototype, 'createBooking');
  Reflect.defineMetadata('design:paramtypes', [String, PublicCreateBookingDto], BookingsController.prototype, 'publicCreateBooking');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

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
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: crmStub },
      // Every service in this suite is free, so no invoice is ever created.
      { provide: CommerceService, useValue: { computeServiceDeposit: () => 0, createInvoiceForService: async () => null } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CatalogService, useValue: {} },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined, backstitchVisitor: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CalendarService, useValue: { syncBookingToCalendar: async () => null } },
      { provide: BookingOptimizerService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  bookingsService = moduleRef.get(BookingsService);

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V16A Biz A', ownerId: ID.ownerA, currency: 'TTD', timezone: POS, businessHours: HOURS } });
  await db.business.create({ data: { id: ID.bizB, name: 'V16A Biz B', ownerId: ID.ownerB, currency: 'TTD', timezone: POS, businessHours: HOURS } });
  await db.business.create({
    data: {
      id: ID.bizS, name: 'V16A Biz S', ownerId: ID.ownerA, currency: 'TTD', timezone: POS,
      businessHours: { mon: { open: '09:00', close: '11:00', closed: false }, tue: CLOSED, wed: CLOSED, thu: CLOSED, fri: CLOSED, sat: CLOSED, sun: CLOSED },
    },
  });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerA_S`, userId: ID.ownerA, businessId: ID.bizS, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Ana', lastName: 'Client' } });
  await db.contact.create({ data: { id: ID.contactS, businessId: ID.bizS, firstName: 'Sol', lastName: 'Client' } });
  for (const businessId of [ID.bizA, ID.bizB, ID.bizS]) {
    await db.contact.create({ data: { id: publicContactId(businessId), businessId, firstName: 'Pat', lastName: 'Public' } });
  }

  // No availability rows: business hours apply to every staff member.
  await db.staffMember.create({ data: { id: ID.staff1, businessId: ID.bizA, name: 'Staff One' } });
  await db.staffMember.create({ data: { id: ID.staff2, businessId: ID.bizA, name: 'Staff Two' } });
  await db.staffMember.create({ data: { id: ID.staffR, businessId: ID.bizA, name: 'Staff Reschedule' } });

  const service = (id: string, businessId: string) =>
    db.service.create({ data: { id, businessId, name: id.slice(P.length), duration: 60, price: 0 } });
  await service(ID.svcRace, ID.bizA);
  await service(ID.svcB, ID.bizB);
  await service(ID.svcS, ID.bizS);
  await service(ID.svcS2, ID.bizS);

  // Friday: staffR holds 13:00Z-14:00Z and 14:00Z-15:00Z (09:00-11:00 local).
  const seed = (id: string, start: Date) =>
    db.booking.create({
      data: {
        id, businessId: ID.bizA, contactId: ID.contactA, serviceId: ID.svcRace, staffId: ID.staffR,
        startTime: start, endTime: plusMins(start, 60), status: 'CONFIRMED',
      },
    });
  await seed(ID.bkR1, utc('2030-01-11T13:00:00.000Z'));
  await seed(ID.bkR2, utc('2030-01-11T14:00:00.000Z'));
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
  if (PREVIOUS_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = PREVIOUS_TZ;
});

beforeEach(async () => {
  // The public create allows 10 a minute per caller; one case uses all ten.
  await clearRateLimits();
  process.env.TZ = 'UTC';
});

describe('V1-16 the slot claim (RED at the base: check-then-insert)', () => {
  it('RED-BEFORE: ten concurrent public creates for one slot write ONE booking; the other nine are refused as taken', async () => {
    const start = utc('2030-01-07T14:00:00.000Z'); // Monday 10:00 local
    const results = await Promise.all(
      Array.from({ length: 10 }, () => publicCreate({ serviceId: ID.svcRace, start })),
    );
    const rows = await liveAt(ID.bizA, start, { serviceId: ID.svcRace });
    expect(rows.length, `rows written; responses: ${describeResults(results)}`).toBe(1);
    expect(results.filter(created).length, describeResults(results)).toBe(1);
    const refused = results.filter((r) => !created(r));
    expect(refused.map((r) => r.status)).toEqual(Array(9).fill(400));
    for (const r of refused) expect(r.body.message).toBe(MSG.taken);
    // The one 201 is the row that exists.
    expect(results.find(created)!.body.bookingId).toBe(rows[0].id);
  });

  it('RED-BEFORE: public and in-app creates racing for one staff member\'s slot write ONE booking', async () => {
    const start = utc('2030-01-08T14:00:00.000Z'); // Tuesday 10:00 local
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => publicCreate({ serviceId: ID.svcRace, staffId: ID.staff1, start })),
      ...Array.from({ length: 5 }, () => inAppCreate({ serviceId: ID.svcRace, staffId: ID.staff1, start })),
    ]);
    const rows = await liveAt(ID.bizA, start, { staffId: ID.staff1 });
    expect(rows.length, `rows written; responses: ${describeResults(results)}`).toBe(1);
    expect(results.filter(created).length, describeResults(results)).toBe(1);
    for (const r of results.filter((x) => !created(x))) {
      expect(r.status).toBe(400);
      expect(r.body.message).toBe(MSG.taken);
    }
  });

  it('RED-BEFORE: two reschedules and a create racing into one free slot leave ONE owner', async () => {
    const target = utc('2030-01-11T15:00:00.000Z'); // Friday 11:00 local, free
    const results = await Promise.all([
      reschedule(ID.bkR1, target),
      reschedule(ID.bkR2, target),
      publicCreate({ serviceId: ID.svcRace, staffId: ID.staffR, start: target }),
    ]);
    const rows = await liveAt(ID.bizA, target, { staffId: ID.staffR });
    expect(rows.length, `owners of the slot; responses: ${describeResults(results)}`).toBe(1);
    expect(results.filter((r) => r.status === 201).length, describeResults(results)).toBe(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(400);
      expect(r.body.message).toBe(MSG.taken);
    }
    // No two of staffR's live bookings overlap anywhere on Friday.
    const friday = await db.booking.findMany({
      where: { staffId: ID.staffR, deletedAt: null, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      orderBy: { startTime: 'asc' },
    });
    for (let i = 1; i < friday.length; i++) {
      expect(friday[i].startTime.getTime(), 'overlapping bookings for one staff member').toBeGreaterThanOrEqual(friday[i - 1].endTime.getTime());
    }
  });
});

describe('V1-16 the slot claim: regression controls (green at the base)', () => {
  it('CONTROL: two staff members in the same slot both succeed, concurrently', async () => {
    const start = utc('2030-01-09T14:00:00.000Z'); // Wednesday 10:00 local
    const results = await Promise.all([
      inAppCreate({ serviceId: ID.svcRace, staffId: ID.staff1, start }),
      inAppCreate({ serviceId: ID.svcRace, staffId: ID.staff2, start }),
    ]);
    expect(results.map((r) => r.status), describeResults(results)).toEqual([201, 201]);
    const rows = await liveAt(ID.bizA, start);
    expect(rows.map((r: any) => r.staffId).sort()).toEqual([ID.staff1, ID.staff2].sort());
  });

  it('CONTROL: the same slot in another tenant does not block', async () => {
    const start = utc('2030-01-10T14:00:00.000Z'); // Thursday 10:00 local
    const results = await Promise.all([
      publicCreate({ businessId: ID.bizA, serviceId: ID.svcRace, start }),
      publicCreate({ businessId: ID.bizB, serviceId: ID.svcB, start }),
    ]);
    expect(results.map((r) => r.status), describeResults(results)).toEqual([201, 201]);
    expect(await liveAt(ID.bizA, start)).toHaveLength(1);
    expect(await liveAt(ID.bizB, start)).toHaveLength(1);
  });

  it('CONTROL: a reschedule into an occupied slot is refused and moves nothing', async () => {
    const start = utc('2030-01-14T14:00:00.000Z'); // Monday 10:00 local
    const holder = await inAppCreate({ serviceId: ID.svcRace, staffId: ID.staff2, start });
    expect(holder.status, holder.body?.message).toBe(201);
    const mover = await inAppCreate({ serviceId: ID.svcRace, staffId: ID.staff2, start: plusMins(start, 120) });
    expect(mover.status, mover.body?.message).toBe(201);

    const res = await reschedule(mover.body.id, start);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(MSG.taken);
    const row = await db.booking.findFirst({ where: { id: mover.body.id } });
    expect(row.startTime.getTime()).toBe(plusMins(start, 120).getTime());
    expect(await liveAt(ID.bizA, start, { staffId: ID.staff2 })).toHaveLength(1);
  });
});

describe('V1-16 the business clock (RED at the base: server-local hours)', () => {
  const OFFERED = ['2030-01-07T13:00:00.000Z', '2030-01-07T13:30:00.000Z', '2030-01-07T14:00:00.000Z'];

  for (const serverTz of ['UTC', 'America/New_York']) {
    it(`RED-BEFORE: Port_of_Spain 09:00-11:00 is offered as 13:00Z..14:00Z starts with the server at TZ=${serverTz}`, async () => {
      process.env.TZ = serverTz;
      const res = await agent().get(`/bookings/public/businesses/${ID.bizS}/slots`).query({ serviceId: ID.svcS, date: '2030-01-07' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({ date: '2030-01-07', slots: OFFERED });

      // The service itself, at an hourly interval: exactly 13:00Z and 14:00Z.
      const hourly = await bookingsService.getAvailableSlots({
        businessId: ID.bizS,
        serviceId: ID.svcS,
        date: new Date(2030, 0, 7), // as the route builds it: local midnight of the day asked for
        slotIntervalMins: 60,
      });
      expect(hourly).toEqual({ date: '2030-01-07', slots: ['2030-01-07T13:00:00.000Z', '2030-01-07T14:00:00.000Z'] });
    });
  }

  it('RED-BEFORE: a slot the picker offers is bookable on both create paths with the server in New York', async () => {
    process.env.TZ = 'America/New_York';
    const slots = await agent().get(`/bookings/public/businesses/${ID.bizS}/slots`).query({ serviceId: ID.svcS2, date: '2030-01-07' });
    expect(slots.status).toBe(200);
    expect(slots.body.slots).toContain('2030-01-07T13:00:00.000Z');
    expect(slots.body.slots).toContain('2030-01-07T13:30:00.000Z');

    // 13:00Z is 09:00 in Port_of_Spain and 08:00 in New York.
    const pub = await publicCreate({ businessId: ID.bizS, serviceId: ID.svcS, start: utc('2030-01-07T13:00:00.000Z') });
    expect(pub.status, pub.body?.message ?? pub.body?.bookingId).toBe(201);
    const inApp = await inAppCreate({ businessId: ID.bizS, contactId: ID.contactS, serviceId: ID.svcS2, start: utc('2030-01-07T13:30:00.000Z') });
    expect(inApp.status, inApp.body?.message ?? inApp.body?.id).toBe(201);

    // 15:00Z is 11:00 local, the close: a booking starting there is refused on both.
    const late = utc('2030-01-07T15:00:00.000Z');
    const latePub = await publicCreate({ businessId: ID.bizS, serviceId: ID.svcS, start: late });
    expect(latePub.status).toBe(400);
    expect(latePub.body.message).toBe('The selected time is outside business hours.');
    const lateInApp = await inAppCreate({ businessId: ID.bizS, contactId: ID.contactS, serviceId: ID.svcS2, start: late });
    expect(lateInApp.status).toBe(400);
    expect(lateInApp.body.message).toBe('The selected time is outside business hours.');
  });
});
