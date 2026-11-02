/**
 * V1-27-BK-SLOT-WRITERS — the three booking writers that bypassed the slot
 * guard, against a REAL database.
 *
 * M41 / M06. V1-16 put every BookingsService path that takes a slot through
 * its claim: the calendar's advisory transaction lock
 * (`booking-slot:<business>:<staff member, else service>`), the overlap guard
 * read again inside that transaction, then the write. Three writers outside
 * BookingsService still wrote booking rows with no check at all:
 *
 *   tRPC bookings.createBooking        packages/api/src/routers/bookings.ts
 *   the waitlist offer's placeholder   booking-waitlist.service.ts offerSlot
 *                                      (REST offer route, KEY, and the
 *                                      cancel/reschedule listener)
 *   the calendar PATCH write-back      calendar-projection.service.ts
 *                                      applyPatchToSource (PATCH
 *                                      /calendar/businesses/:id/events/:id)
 *
 * Cases:
 *   RED-BEFORE (fail at the V1-16 head): each writer puts a second live
 *   booking on an occupied staff slot; the tRPC create ignores the service's
 *   buffer; the cancel listener offers a freed slot that was booked again
 *   before it ran; the calendar brings a cancelled booking back onto a slot
 *   booked since; and with the slot's advisory lock held by a claim that has
 *   written but not committed, each writer neither waits for it nor sees it.
 *   After the fix each is refused with the in-app create's own message
 *   (pinned by the PARITY controls) and writes nothing.
 *   PARITY (green at the base): BookingsService.createBooking refuses the same
 *   occupied slot with MSG.taken, and the buffered one with MSG.buffer15, so
 *   those strings are the shared guard's, not this file's.
 *   CONTROL (green at the base, kept as regression controls): a free slot, or
 *   another staff member in the same slot, is still written by every writer;
 *   a calendar move inside the booking's own window, a notes-only patch and a
 *   PENDING -> CONFIRMED move on two legacy rows that already overlap, and a
 *   cancel, all still succeed.
 *   RACE (GREEN-AFTER proof): the in-app create and all three writers racing
 *   for one free slot leave exactly one booking on it; the other three are
 *   refused with the guard's message.
 *
 * Boundary: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CalendarController, CalendarQueryService, CalendarPermissionService,
 * CalendarProjectionService, BookingWaitlistService, BookingWaitlistListener
 * and BookingsService read and write real rows, behind the production
 * GlobalHttpExceptionFilter and ValidationPipe. The tRPC router is the
 * worktree's own packages/api SOURCE (root.ts, imported by relative path, not
 * the @keyflow/api build, which a worktree resolves to the main tree), mounted
 * with @trpc/server's express adapter and the context TrpcModule builds.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-v27a-user` and attaches the seeded user row as AuthMiddleware would.
 * Collaborators off the boundary are stubs: the event bus, the CRM timeline,
 * invoices (every service here is free), revenue attribution, storefront
 * events, email, plan limits, the timeline, the model gateway and the Google
 * calendar.
 *
 * Fixtures: prefix `v27a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll, and
 * the booking-side rows again before each case; no $transaction wrapping
 * (the only transactions are the lock holders below, which commit). Literals
 * in globally unique columns embed the prefix.
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

const P = 'v27a_';
const HEADER = 'x-v27a-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  svc: `${P}svc`, // no buffer configured (bufferMins null)
  svcBuf: `${P}svcBuf`, // a 15-minute buffer
  staff1: `${P}staff1`,
  staff2: `${P}staff2`,
};

const MSG = {
  taken: 'That time slot has already been booked. Please choose another.',
  buffer15: 'This time slot is unavailable due to a 15-minute buffer between appointments.',
};

const utc = (iso: string) => new Date(iso);
const plusMins = (d: Date, mins: number) => new Date(d.getTime() + mins * 60_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Far in the future: no lead time, opening hours or staff hours apply here
// (the business has none, and none of the three writers reads them).
const T10 = utc('2031-03-04T10:00:00.000Z');
const T11 = plusMins(T10, 60);
const T13 = utc('2031-03-04T13:00:00.000Z');
const T14 = plusMins(T13, 60);
const T16 = utc('2031-03-04T16:00:00.000Z');

let db: any;
let app: any;
let bookingsService: any;
let waitlist: any;
let listener: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM booking_waitlist_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM calendar_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The rows a case writes: bookings, their projections, waitlist entries. */
async function resetBookingRows() {
  for (const sql of [
    `DELETE FROM booking_waitlist_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM calendar_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

function agent() {
  return request(app.getHttpServer());
}

/** A booking row written directly: the slot's existing occupant. */
function occupy(input: { staffId: string; start: Date; mins?: number; status?: string; serviceId?: string }) {
  return db.booking.create({
    data: {
      businessId: ID.biz,
      contactId: ID.contact,
      serviceId: input.serviceId ?? ID.svc,
      staffId: input.staffId,
      startTime: input.start,
      endTime: plusMins(input.start, input.mins ?? 60),
      status: input.status ?? 'CONFIRMED',
    },
    include: { contact: true, service: true, staff: true },
  });
}

/** Live bookings (not cancelled, no-show or deleted) of `staffId` overlapping [start, end). */
function liveOn(staffId: string, start: Date, end: Date) {
  return db.booking.findMany({
    where: {
      businessId: ID.biz,
      staffId,
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      startTime: { lt: end },
      endTime: { gt: start },
    },
    select: { id: true, startTime: true, endTime: true, status: true },
  });
}

/** BookingsService's lock key for a staff member's calendar (booking-overlap.spec.ts pins it). */
const slotKey = (staffId: string) => `booking-slot:${ID.biz}:${staffId}`;

/**
 * A claim in flight: takes the staff member's slot lock exactly as
 * BookingsService.claimSlot does, writes the occupying booking, and holds the
 * transaction open for `holdMs` before committing. Resolves once the lock is
 * held and the row written (but not committed); the returned promise settles
 * at commit. A writer that takes the same lock waits for the commit and then
 * sees the row; one that does not, sees nothing and writes.
 */
async function occupyUnderHeldLock(staffId: string, start: Date, holdMs = 700) {
  let held!: () => void;
  const lockHeld = new Promise<void>((resolve) => { held = resolve; });
  const committed = db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${slotKey(staffId)}))`;
    await tx.booking.create({
      data: {
        businessId: ID.biz,
        contactId: ID.contact,
        serviceId: ID.svc,
        staffId,
        startTime: start,
        endTime: plusMins(start, 60),
        status: 'CONFIRMED',
      },
    });
    held();
    await sleep(holdMs);
  }, { timeout: 15_000 });
  committed.catch(() => held());
  await lockHeld;
  return committed;
}

/** tRPC bookings.createBooking as the business owner, over HTTP. */
function trpcCreate(input: { staffId: string; start: Date; mins?: number; serviceId?: string }) {
  return agent()
    .post('/trpc/bookings.createBooking')
    .set(HEADER, ID.owner)
    .send({
      businessId: ID.biz,
      contactId: ID.contact,
      serviceId: input.serviceId ?? ID.svc,
      staffId: input.staffId,
      startTime: input.start.toISOString(),
      endTime: plusMins(input.start, input.mins ?? 60).toISOString(),
    });
}

/** A waiting waitlist entry for the unbuffered service. */
function waitingEntry(preferredStaffId?: string) {
  return waitlist.addToWaitlist({
    businessId: ID.biz,
    contactId: ID.contact,
    serviceId: ID.svc,
    preferredStaffId: preferredStaffId ?? null,
  });
}

function offer(entryId: string, staffId: string, start: Date) {
  return waitlist.offerSlot(entryId, {
    startTime: start,
    endTime: plusMins(start, 60),
    serviceId: ID.svc,
    staffId,
  });
}

/** A booking and its calendar projection, as the bookings listener writes it. */
async function projectedBooking(input: { staffId: string; start: Date; status?: string }) {
  const booking = await occupy(input);
  const event = await db.calendarEvent.create({
    data: {
      businessId: ID.biz,
      title: 'V27A booking',
      type: 'BOOKING',
      module: 'BOOKINGS',
      startAt: booking.startTime,
      endAt: booking.endTime,
      status: booking.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED',
      sourceType: 'booking',
      sourceId: booking.id,
      staffId: booking.staffId,
      contactId: booking.contactId,
    },
  });
  return { booking, event };
}

function calendarPatch(eventId: string, body: Record<string, unknown>) {
  return agent()
    .patch(`/calendar/businesses/${ID.biz}/events/${eventId}`)
    .set(HEADER, ID.owner)
    .send(body);
}

/** The refusal message a writer answered with, whichever surface it is. */
function refusal(result: PromiseSettledResult<any>): string | undefined {
  if (result.status === 'rejected') return (result.reason as Error)?.message;
  const res = result.value;
  // An HTTP answer (tRPC, calendar) carries a numeric status; a service result does not.
  if (typeof res?.status !== 'number' || res.status < 400) return undefined;
  return res.body?.error?.message ?? res.body?.message;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { Reflector } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const trpcExpress = await import('@trpc/server/adapters/express');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CalendarController } = await import('../src/modules/calendar/calendar.controller');
  const { CalendarQueryService } = await import('../src/modules/calendar/calendar-query.service');
  const { CalendarPermissionService } = await import('../src/modules/calendar/calendar-permission.service');
  const { CalendarProjectionService } = await import('../src/modules/calendar/calendar-projection.service');
  const { CalendarConflictService } = await import('../src/modules/calendar/calendar-conflict.service');
  const { CalendarInsightService } = await import('../src/modules/calendar/calendar-insight.service');
  const { CalendarSyncService } = await import('../src/modules/calendar/calendar-sync.service');
  const { GoogleCalendarTemporalSyncService } = await import('../src/modules/calendar/connectors/google-calendar-temporal-sync.service');
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { BookingWaitlistListener } = await import('../src/modules/bookings/booking-waitlist.listener');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  // The worktree's packages/api source, so this file proves the router in the
  // same checkout as the server code (the @keyflow/api build can be stale).
  const { appRouter } = await import('../../../packages/api/src/root');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [CalendarController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      Reflector,
      CalendarQueryService,
      CalendarPermissionService,
      CalendarProjectionService,
      CalendarConflictService,
      CalendarInsightService,
      { provide: GoogleCalendarTemporalSyncService, useValue: { syncBusiness: async () => ({ synced: 0, skipped: 0 }) } },
      { provide: CalendarSyncService, useValue: {} },
      { provide: ModelGatewayService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      BookingWaitlistService,
      BookingWaitlistListener,
      BookingsService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      // Every service in this suite is free, so no invoice is ever created.
      { provide: CommerceService, useValue: { computeServiceDeposit: () => 0, createInvoiceForService: async () => null } },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined, backstitchVisitor: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
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
  // /trpc as TrpcModule mounts it, with the context it builds.
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext: ({ req }: any) => ({ db, user: req.user, business: req.business, eventBus: eventStub }),
    }),
  );
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  bookingsService = moduleRef.get(BookingsService);
  waitlist = moduleRef.get(BookingWaitlistService);
  listener = moduleRef.get(BookingWaitlistListener);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V27A Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', timezone: 'UTC' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Ana', lastName: 'Client' } });
  await db.service.create({ data: { id: ID.svc, businessId: ID.biz, name: 'V27A Cut', duration: 60, price: 0 } });
  await db.service.create({ data: { id: ID.svcBuf, businessId: ID.biz, name: 'V27A Colour', duration: 60, price: 0, bufferMins: 15 } });
  // No availability rows and no business hours: nothing but the overlap guard decides.
  await db.staffMember.create({ data: { id: ID.staff1, businessId: ID.biz, name: 'Staff One' } });
  await db.staffMember.create({ data: { id: ID.staff2, businessId: ID.biz, name: 'Staff Two' } });
}, 60_000);

afterAll(async () => {
  try {
    if (db) await cleanup();
  } finally {
    if (app) await app.close();
  }
});

beforeEach(async () => {
  await resetBookingRows();
});

describe('PARITY: the shared guard is BookingsService\'s own', () => {
  it('the in-app create refuses an occupied staff slot with MSG.taken', async () => {
    await occupy({ staffId: ID.staff1, start: T10 });
    await expect(
      bookingsService.createBooking({
        businessId: ID.biz, contactId: ID.contact, serviceId: ID.svc, staffId: ID.staff1, startTime: T10, endTime: T11,
      }),
    ).rejects.toThrow(MSG.taken);
  });

  it('the in-app create refuses a slot inside the service buffer with MSG.buffer15', async () => {
    await occupy({ staffId: ID.staff1, start: T10, serviceId: ID.svcBuf });
    const start = plusMins(T11, 5);
    await expect(
      bookingsService.createBooking({
        businessId: ID.biz, contactId: ID.contact, serviceId: ID.svcBuf, staffId: ID.staff1, startTime: start, endTime: plusMins(start, 60),
      }),
    ).rejects.toThrow(MSG.buffer15);
  });
});

describe('tRPC bookings.createBooking (packages/api/src/routers/bookings.ts)', () => {
  it('RED-BEFORE: refuses an occupied staff slot with the guard message and writes nothing', async () => {
    await occupy({ staffId: ID.staff1, start: T10 });
    const res = await trpcCreate({ staffId: ID.staff1, start: plusMins(T10, 30) });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.message).toBe(MSG.taken);
    expect(await liveOn(ID.staff1, T10, plusMins(T11, 30))).toHaveLength(1);
  });

  it('RED-BEFORE: refuses a slot inside the service buffer with the guard\'s buffer message', async () => {
    await occupy({ staffId: ID.staff1, start: T10, serviceId: ID.svcBuf });
    const res = await trpcCreate({ staffId: ID.staff1, start: plusMins(T11, 5), serviceId: ID.svcBuf });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.message).toBe(MSG.buffer15);
    expect(await liveOn(ID.staff1, T10, plusMins(T11, 65))).toHaveLength(1);
  });

  it('RED-BEFORE: waits for a claim holding the slot lock, then is refused', async () => {
    const holder = await occupyUnderHeldLock(ID.staff1, T10);
    const [res] = await Promise.all([trpcCreate({ staffId: ID.staff1, start: T10 }), holder]);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.message).toBe(MSG.taken);
    expect(await liveOn(ID.staff1, T10, T11)).toHaveLength(1);
  });

  it('CONTROL: writes a free slot, and another staff member in an occupied slot', async () => {
    await occupy({ staffId: ID.staff1, start: T10 });
    const free = await trpcCreate({ staffId: ID.staff1, start: T13 });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    expect(free.body.result.data).toMatchObject({ businessId: ID.biz, staffId: ID.staff1 });
    const other = await trpcCreate({ staffId: ID.staff2, start: T10 });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(await liveOn(ID.staff1, T13, T14)).toHaveLength(1);
    expect(await liveOn(ID.staff2, T10, T11)).toHaveLength(1);
  });
});

describe('waitlist offerSlot placeholder (booking-waitlist.service.ts)', () => {
  it('RED-BEFORE: refuses to offer an occupied staff slot, writes no placeholder, leaves the entry WAITING', async () => {
    await occupy({ staffId: ID.staff1, start: T10 });
    const entry = await waitingEntry();
    await expect(offer(entry.id, ID.staff1, plusMins(T10, 30))).rejects.toThrow(MSG.taken);
    const after = await db.bookingWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('WAITING');
    expect(after.offeredBookingId).toBeNull();
    expect(await liveOn(ID.staff1, T10, plusMins(T11, 30))).toHaveLength(1);
  });

  it('RED-BEFORE: the cancel listener does not offer a freed slot booked again before it ran', async () => {
    const cancelled = await occupy({ staffId: ID.staff1, start: T10, status: 'CANCELLED' });
    await occupy({ staffId: ID.staff1, start: T10 }); // rebooked before the listener ran
    const entry = await waitingEntry(ID.staff1);
    await listener.onCancelled({ businessId: ID.biz, booking: cancelled, contact: cancelled.contact ?? undefined });
    const after = await db.bookingWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('WAITING');
    expect(after.offeredBookingId).toBeNull();
    expect(await liveOn(ID.staff1, T10, T11)).toHaveLength(1);
  });

  it('RED-BEFORE: waits for a claim holding the slot lock, then is refused', async () => {
    const entry = await waitingEntry();
    const holder = await occupyUnderHeldLock(ID.staff1, T10);
    const [result] = await Promise.allSettled([offer(entry.id, ID.staff1, T10), holder]);
    expect(refusal(result)).toBe(MSG.taken);
    const after = await db.bookingWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('WAITING');
    expect(await liveOn(ID.staff1, T10, T11)).toHaveLength(1);
  });

  it('CONTROL: a freed slot that is really free is offered as an UNCONFIRMED placeholder', async () => {
    const cancelled = await occupy({ staffId: ID.staff1, start: T10, status: 'CANCELLED' });
    await occupy({ staffId: ID.staff2, start: T10 }); // another staff member's booking does not block
    const entry = await waitingEntry(ID.staff1);
    await listener.onCancelled({ businessId: ID.biz, booking: cancelled, contact: cancelled.contact ?? undefined });
    const after = await db.bookingWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { offeredBooking: true } });
    expect(after.status).toBe('OFFERED');
    expect(after.offeredBooking).toMatchObject({ status: 'UNCONFIRMED', staffId: ID.staff1, startTime: T10, endTime: T11 });
  });
});

describe('calendar PATCH write-back (calendar-projection.service.ts applyPatchToSource)', () => {
  it('RED-BEFORE: refuses to move a booking onto an occupied staff slot; booking and projection unchanged', async () => {
    await occupy({ staffId: ID.staff1, start: T10 });
    const { booking, event } = await projectedBooking({ staffId: ID.staff1, start: T13 });
    const res = await calendarPatch(event.id, { startAt: plusMins(T10, 30).toISOString(), endAt: plusMins(T11, 30).toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe(MSG.taken);
    const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.startTime).toEqual(T13);
    expect(after.endTime).toEqual(T14);
    const projection = await db.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(projection.startAt).toEqual(T13);
    expect(await liveOn(ID.staff1, T10, plusMins(T11, 30))).toHaveLength(1);
  });

  it('RED-BEFORE: refuses to bring a cancelled booking back onto a slot booked since', async () => {
    const { booking, event } = await projectedBooking({ staffId: ID.staff1, start: T10, status: 'CANCELLED' });
    await occupy({ staffId: ID.staff1, start: T10 }); // the slot, booked after the cancellation
    const res = await calendarPatch(event.id, { status: 'CONFIRMED' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe(MSG.taken);
    const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe('CANCELLED');
    expect(await liveOn(ID.staff1, T10, T11)).toHaveLength(1);
  });

  it('RED-BEFORE: waits for a claim holding the slot lock, then is refused', async () => {
    const { booking, event } = await projectedBooking({ staffId: ID.staff1, start: T13 });
    const holder = await occupyUnderHeldLock(ID.staff1, T10);
    const [res] = await Promise.all([
      calendarPatch(event.id, { startAt: T10.toISOString(), endAt: T11.toISOString() }),
      holder,
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe(MSG.taken);
    const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.startTime).toEqual(T13);
    expect(await liveOn(ID.staff1, T10, T11)).toHaveLength(1);
  });

  it('CONTROL: moves a booking into a free slot, and within its own window', async () => {
    await occupy({ staffId: ID.staff2, start: T16 }); // another staff member's booking does not block
    const { booking, event } = await projectedBooking({ staffId: ID.staff1, start: T13 });
    const moved = await calendarPatch(event.id, { startAt: T16.toISOString(), endAt: plusMins(T16, 60).toISOString() });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).startTime).toEqual(T16);
    // 30 minutes later overlaps only the booking's own old window.
    const nudged = await calendarPatch(event.id, { startAt: plusMins(T16, 30).toISOString(), endAt: plusMins(T16, 90).toISOString() });
    expect(nudged.status, JSON.stringify(nudged.body)).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).startTime).toEqual(plusMins(T16, 30));
  });

  it('CONTROL: notes, PENDING -> CONFIRMED and a cancel still write on legacy rows that already overlap', async () => {
    await occupy({ staffId: ID.staff1, start: T10 });
    const { booking, event } = await projectedBooking({ staffId: ID.staff1, start: plusMins(T10, 30), status: 'PENDING' });
    const notes = await calendarPatch(event.id, { description: 'V27A note' });
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).notes).toBe('V27A note');
    const confirmed = await calendarPatch(event.id, { status: 'CONFIRMED' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
    const cancelled = await calendarPatch(event.id, { status: 'CANCELLED' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
  });
});

describe('RACE: every writer against the in-app create', () => {
  it('the in-app create and the three writers racing for one free slot leave exactly one booking on it', async () => {
    const entry = await waitingEntry();
    const { event } = await projectedBooking({ staffId: ID.staff1, start: T13 });
    const results = await Promise.allSettled([
      bookingsService.createBooking({
        businessId: ID.biz, contactId: ID.contact, serviceId: ID.svc, staffId: ID.staff1, startTime: T10, endTime: T11,
      }),
      trpcCreate({ staffId: ID.staff1, start: T10 }),
      offer(entry.id, ID.staff1, T10),
      calendarPatch(event.id, { startAt: T10.toISOString(), endAt: T11.toISOString() }),
    ]);
    const messages = results.map(refusal);
    const refused = messages.filter((m) => m !== undefined);
    expect(await liveOn(ID.staff1, T10, T11), JSON.stringify(messages)).toHaveLength(1);
    expect(refused, JSON.stringify(messages)).toHaveLength(3);
    expect(new Set(refused)).toEqual(new Set([MSG.taken]));
  });
});
