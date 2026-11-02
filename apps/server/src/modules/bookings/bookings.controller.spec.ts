import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingWaitlistService } from './booking-waitlist.service';
import { CalendarService } from './calendar.service';
import { BookingOptimizerService } from './booking-optimizer.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CatalogService } from '../catalog/catalog.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';

class CalendarPrismaMock {
  client: any;
  constructor() {
    const self = this;
    self.client = {
      business: {
        findFirst: vi.fn(({ where }: any) => {
          if (where.id === 'biz_1') return Promise.resolve({ id: 'biz_1' });
          return Promise.resolve(null);
        }),
        findUnique: vi.fn(({ where }: any) => {
          if (where.id === 'biz_1') {
            return Promise.resolve({ timezone: 'America/Port_of_Spain', calendarId: 'primary' });
          }
          return Promise.resolve(null);
        }),
      },
      booking: {
        findMany: vi.fn(() => Promise.resolve([])),
        findFirst: vi.fn(() => Promise.resolve(null)),
      },
      contactTask: { findMany: vi.fn(() => Promise.resolve([])) },
      projectTask: { findMany: vi.fn(() => Promise.resolve([])) },
      autopilotTask: { findMany: vi.fn(() => Promise.resolve([])) },
      project: { findMany: vi.fn(() => Promise.resolve([])) },
    };
  }
}

describe('BookingsController — Google Calendar two-way editing', () => {
  let app: INestApplication;
  const patchCalendarEvent = vi.fn().mockResolvedValue(true);
  const createCalendarEvent = vi.fn().mockResolvedValue('evt_new_123');
  const deleteCalendarEvent = vi.fn().mockResolvedValue(true);

  beforeAll(async () => {
    const prismaMock = new CalendarPrismaMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        AuthGuard,
        BusinessGuard,
        PlanLimitGuard,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: BookingsService,
          useValue: {
            listBookings: vi.fn(),
            getBookingStats: vi.fn(),
            updateBookingStatus: vi.fn(),
            rescheduleBooking: vi.fn(),
            updateBookingNotes: vi.fn(),
            updateBookingLocation: vi.fn(),
            createBooking: vi.fn(),
            publicCreateBooking: vi.fn(),
            getReminderSettings: vi.fn(),
            updateReminderSettings: vi.fn(),
          },
        },
        {
          provide: BookingWaitlistService,
          useValue: {
            addToWaitlist: vi.fn(),
            listWaitlist: vi.fn(),
            offerSlot: vi.fn(),
            convertWaitlistEntry: vi.fn(),
            cancelWaitlistEntry: vi.fn(),
            previewMatchesForSlot: vi.fn(),
          },
        },
        {
          provide: CalendarService,
          useValue: {
            patchCalendarEvent,
            createCalendarEvent,
            deleteCalendarEvent,
            syncBookingToCalendar: vi.fn(),
            listCalendarEvents: vi.fn(),
            getCalendarStatus: vi.fn(),
            disconnectCalendar: vi.fn(),
            getAuthUrl: vi.fn(),
            verifyState: vi.fn(),
            saveCalendarCredentials: vi.fn(),
            listAvailableCalendars: vi.fn(),
            updateSyncSettings: vi.fn(),
            listConflicts: vi.fn(),
            scanForConflicts: vi.fn(),
            resolveConflict: vi.fn(),
          },
        },
        { provide: BookingOptimizerService, useValue: {} },
        { provide: SubscriptionsService, useValue: { checkLimit: vi.fn() } },
        { provide: CatalogService, useValue: {} },
        { provide: REDIS_CLIENT, useValue: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), pipeline: vi.fn(() => ({ exec: vi.fn(async () => []) })) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user_1' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    patchCalendarEvent.mockClear();
    patchCalendarEvent.mockResolvedValue(true);
    createCalendarEvent.mockClear();
    createCalendarEvent.mockResolvedValue('evt_new_123');
    deleteCalendarEvent.mockClear();
    deleteCalendarEvent.mockResolvedValue(true);
  });

  describe('PATCH /calendar/events/:eventId — partial updates', () => {
    it('forwards only the summary when only the title changes', async () => {
      await request(app.getHttpServer())
        .patch('/bookings/businesses/biz_1/calendar/events/evt_abc')
        .send({ summary: 'Renamed event' })
        .expect(200);

      expect(patchCalendarEvent).toHaveBeenCalledTimes(1);
      const [, eventId, patch] = patchCalendarEvent.mock.calls[0];
      expect(eventId).toBe('evt_abc');
      expect(patch).toEqual({ summary: 'Renamed event' });
      expect(patch).not.toHaveProperty('start');
      expect(patch).not.toHaveProperty('end');
      expect(patch).not.toHaveProperty('attendees');
      expect(patch).not.toHaveProperty('location');
      expect(patch).not.toHaveProperty('description');
    });

    it('forwards only start/end when only the times change (preserves attendees + location)', async () => {
      await request(app.getHttpServer())
        .patch('/bookings/businesses/biz_1/calendar/events/evt_time')
        .send({
          start: '2030-06-01T15:00:00.000Z',
          end: '2030-06-01T16:00:00.000Z',
        })
        .expect(200);

      expect(patchCalendarEvent).toHaveBeenCalledTimes(1);
      const [, , patch] = patchCalendarEvent.mock.calls[0];
      expect(Object.keys(patch).sort()).toEqual(['end', 'start']);
      expect(patch.start).toMatchObject({
        dateTime: '2030-06-01T15:00:00.000Z',
        timeZone: 'America/Port_of_Spain',
      });
      expect(patch.end).toMatchObject({
        dateTime: '2030-06-01T16:00:00.000Z',
        timeZone: 'America/Port_of_Spain',
      });
      expect(patch).not.toHaveProperty('attendees');
      expect(patch).not.toHaveProperty('location');
    });

    it('normalizes attendees and forwards them when only attendees change', async () => {
      await request(app.getHttpServer())
        .patch('/bookings/businesses/biz_1/calendar/events/evt_att')
        .send({ attendees: ['  alex@acme.com  ', 'invalid', 'sam@acme.com'] })
        .expect(200);

      const [, , patch] = patchCalendarEvent.mock.calls[0];
      expect(Object.keys(patch)).toEqual(['attendees']);
      expect(patch.attendees).toEqual([
        { email: 'alex@acme.com' },
        { email: 'sam@acme.com' },
      ]);
    });

    it('does not call the Google API at all when no fields change', async () => {
      const res = await request(app.getHttpServer())
        .patch('/bookings/businesses/biz_1/calendar/events/evt_noop')
        .send({})
        .expect(200);

      expect(patchCalendarEvent).not.toHaveBeenCalled();
      expect(res.body).toMatchObject({ id: 'evt_noop', success: true });
    });

    it('rejects when end is not after start', async () => {
      await request(app.getHttpServer())
        .patch('/bookings/businesses/biz_1/calendar/events/evt_bad')
        .send({
          start: '2030-06-01T15:00:00.000Z',
          end: '2030-06-01T15:00:00.000Z',
        })
        .expect(400);

      expect(patchCalendarEvent).not.toHaveBeenCalled();
    });
  });

  describe('POST /calendar/events — create', () => {
    it('creates a timed event with normalized attendees', async () => {
      const res = await request(app.getHttpServer())
        .post('/bookings/businesses/biz_1/calendar/events')
        .send({
          summary: 'Strategy sync',
          description: 'Roadmap review',
          location: 'HQ Conference Room',
          start: '2030-06-02T14:00:00.000Z',
          end: '2030-06-02T15:00:00.000Z',
          attendees: ['alex@acme.com', { email: 'sam@acme.com', displayName: 'Sam' }],
        })
        .expect(201);

      expect(res.body).toEqual({ id: 'evt_new_123' });
      expect(createCalendarEvent).toHaveBeenCalledTimes(1);
      const [, payload] = createCalendarEvent.mock.calls[0];
      expect(payload).toMatchObject({
        summary: 'Strategy sync',
        description: 'Roadmap review',
        location: 'HQ Conference Room',
        start: { dateTime: '2030-06-02T14:00:00.000Z', timeZone: 'America/Port_of_Spain' },
        end: { dateTime: '2030-06-02T15:00:00.000Z', timeZone: 'America/Port_of_Spain' },
        attendees: [
          { email: 'alex@acme.com' },
          { email: 'sam@acme.com', displayName: 'Sam' },
        ],
      });
    });

    it('rejects when end is not after start', async () => {
      await request(app.getHttpServer())
        .post('/bookings/businesses/biz_1/calendar/events')
        .send({
          summary: 'Bad',
          start: '2030-06-02T14:00:00.000Z',
          end: '2030-06-02T13:00:00.000Z',
        })
        .expect(400);

      expect(createCalendarEvent).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /calendar/events/:eventId', () => {
    it('forwards the delete to the calendar service', async () => {
      const res = await request(app.getHttpServer())
        .delete('/bookings/businesses/biz_1/calendar/events/evt_to_remove')
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(deleteCalendarEvent).toHaveBeenCalledWith('biz_1', 'evt_to_remove');
    });

    it('returns 400 when the calendar service reports failure', async () => {
      deleteCalendarEvent.mockResolvedValueOnce(false);
      await request(app.getHttpServer())
        .delete('/bookings/businesses/biz_1/calendar/events/evt_fail')
        .expect(400);
    });
  });
});

/**
 * V1-16 (M43, CF-44): the public picker answers in the BUSINESS's timezone.
 *
 * The route builds the requested day as a server-local midnight, and the
 * service then read the day's opening hours with setHours/getDay in the
 * server's zone. A Port_of_Spain (UTC-4) business open 09:00-11:00 was offered
 * 09:00Z-10:00Z on a UTC server and 14:00Z-15:00Z on a New York one: one
 * request, a different answer per server, none of them the business's hours.
 *
 * The real BookingsService runs behind the real route here; only Prisma is a
 * stand-in, holding one service, one business and no bookings.
 */
describe('GET public slots: the business day is read in Business.timezone (V1-16)', () => {
  let slotsApp: INestApplication;
  const PREVIOUS_TZ = process.env.TZ;

  const prisma = {
    client: {
      service: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.id === 'svc_pos' && where.businessId === 'biz_pos'
            ? { duration: 60, bufferMins: null, leadTimeMins: null }
            : null,
        ),
      },
      business: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.id === 'biz_pos'
            ? { businessHours: { mon: { open: '09:00', close: '11:00', closed: false } }, timezone: 'America/Port_of_Spain' }
            : null,
        ),
      },
      availability: { findMany: vi.fn(async () => []) },
      booking: { findFirst: vi.fn(async () => null) },
    },
  };

  // The public rate limiter's pipeline, answering "nothing counted yet".
  const redis = {
    pipeline: () => {
      const p: any = {
        zremrangebyscore: () => p,
        zcard: () => p,
        exec: async () => [[null, 0], [null, 0]],
      };
      return p;
    },
    zadd: async () => 1,
    pexpire: async () => 1,
    get: async () => null,
    set: async () => 'OK',
  };

  beforeAll(async () => {
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const { CrmService } = await import('../crm/crm.service');
    const { CommerceService } = await import('../commerce/commerce.service');
    const { RevenueAttributionService } = await import('../commerce/revenue-attribution.service');
    const { TransactionalEmailService } = await import('../notifications/transactional-email.service');
    const { PublicEventsService } = await import('../public-events/public-events.service');
    const { TimelineService } = await import('../timeline/timeline.service');

    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        AuthGuard,
        BusinessGuard,
        PlanLimitGuard,
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
        { provide: CrmService, useValue: {} },
        { provide: CommerceService, useValue: {} },
        { provide: RevenueAttributionService, useValue: {} },
        { provide: TransactionalEmailService, useValue: {} },
        { provide: PublicEventsService, useValue: {} },
        { provide: TimelineService, useValue: {} },
        { provide: BookingWaitlistService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: BookingOptimizerService, useValue: {} },
        { provide: SubscriptionsService, useValue: { checkLimit: vi.fn() } },
        { provide: CatalogService, useValue: {} },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    slotsApp = moduleRef.createNestApplication();
    slotsApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await slotsApp.init();
  });

  afterAll(async () => {
    if (PREVIOUS_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = PREVIOUS_TZ;
    if (slotsApp) await slotsApp.close();
  });

  // 2030-01-07 is a Monday. Port_of_Spain keeps UTC-4 all year (no DST), so
  // 09:00-11:00 there is 13:00Z-15:00Z, and a 60-minute service at a 30-minute
  // interval starts at 13:00Z, 13:30Z and 14:00Z, whatever the server's zone.
  for (const serverTz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
    it(`Port_of_Spain 09:00-11:00 starts at 13:00Z..14:00Z with the server at TZ=${serverTz}`, async () => {
      process.env.TZ = serverTz;
      const res = await request(slotsApp.getHttpServer())
        .get('/bookings/public/businesses/biz_pos/slots')
        .query({ serviceId: 'svc_pos', date: '2030-01-07' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        date: '2030-01-07',
        slots: ['2030-01-07T13:00:00.000Z', '2030-01-07T13:30:00.000Z', '2030-01-07T14:00:00.000Z'],
      });
    });
  }

  it('a day the business has no hours for offers nothing, and reports the day asked for', async () => {
    // Tuesday has no hours row. On a Tokyo server the route's local midnight
    // for the 8th is the 7th in UTC, and the reported date was read from that.
    process.env.TZ = 'Asia/Tokyo';
    const res = await request(slotsApp.getHttpServer())
      .get('/bookings/public/businesses/biz_pos/slots')
      .query({ serviceId: 'svc_pos', date: '2030-01-08' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ date: '2030-01-08', slots: [] });
  });
});
