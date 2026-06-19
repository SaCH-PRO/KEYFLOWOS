// TODO: Quarantined flaky test — timeout/ECONNRESET in calendar controller integration setup.
// Remediation: reduce module bootstrap scope and mock Prisma/Redis where appropriate.
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingsController } from '../src/modules/bookings/bookings.controller';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { CalendarService } from '../src/modules/bookings/calendar.service';
import { BookingOptimizerService } from '../src/modules/bookings/booking-optimizer.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { KeyflowCommandService } from '../src/modules/keyflow-command/keyflow-command.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';

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

describe('Calendar listCalendarEvents → KeyflowEvent meta round-trip', () => {
  it('preserves attendees and location all the way into KeyflowEvent.meta', async () => {
    const googleApiResponse = {
      items: [
        {
          id: 'g_evt_1',
          status: 'confirmed',
          summary: 'Client kickoff',
          description: 'Walk through the SOW',
          location: '12 Main Street, Port of Spain',
          htmlLink: 'https://calendar.google.com/event?eid=g_evt_1',
          start: { dateTime: '2030-06-03T13:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2030-06-03T14:00:00Z', timeZone: 'UTC' },
          organizer: { email: 'owner@acme.com' },
          attendees: [
            { email: 'alex@acme.com', displayName: 'Alex' },
            { email: 'sam@acme.com' },
            { displayName: 'Resource room (no email)' },
          ],
        },
        {
          id: 'g_evt_allday',
          status: 'confirmed',
          summary: 'Holiday',
          start: { date: '2030-06-04' },
          end: { date: '2030-06-05' },
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => googleApiResponse,
      text: async () => '',
    } as any);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    try {
      const prismaMock: any = {
        client: {
          business: {
            findUnique: vi.fn(({ select }: any) => {
              if (select?.calendarRefreshToken) {
                return Promise.resolve({
                  calendarRefreshToken: 'rt',
                  calendarTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
                  calendarAccessToken: 'at',
                });
              }
              if (select?.calendarId) {
                return Promise.resolve({ calendarId: 'primary' });
              }
              return Promise.resolve({});
            }),
          },
          booking: { findMany: vi.fn(() => Promise.resolve([])) },
          contactTask: { findMany: vi.fn(() => Promise.resolve([])) },
          projectTask: { findMany: vi.fn(() => Promise.resolve([])) },
          autopilotTask: { findMany: vi.fn(() => Promise.resolve([])) },
          project: { findMany: vi.fn(() => Promise.resolve([])) },
        },
      };

      const { CalendarService: RealCalendarService } = await import(
        '../src/modules/bookings/calendar.service'
      );
      const calendar = new RealCalendarService(prismaMock as PrismaService);

      const listed = await calendar.listCalendarEvents(
        'biz_1',
        '2030-06-01T00:00:00Z',
        '2030-06-30T00:00:00Z',
      );

      const timed = listed.find((e) => e.id === 'g_evt_1');
      expect(timed).toBeDefined();
      expect(timed!.location).toBe('12 Main Street, Port of Spain');
      expect(timed!.organizer).toBe('owner@acme.com');
      expect(timed!.allDay).toBe(false);
      expect(timed!.attendees).toEqual([
        { email: 'alex@acme.com', displayName: 'Alex' },
        { email: 'sam@acme.com', displayName: undefined },
      ]);

      const allDay = listed.find((e) => e.id === 'g_evt_allday');
      expect(allDay).toBeDefined();
      expect(allDay!.allDay).toBe(true);
      expect(allDay!.start).toBe('2030-06-04');

      const keyflow = new KeyflowCommandService(prismaMock as PrismaService, calendar);
      const events = await keyflow.listUnifiedEvents(
        'biz_1',
        new Date('2030-06-01T00:00:00Z'),
        new Date('2030-06-30T00:00:00Z'),
      );

      const googleEvent = events.find((e) => e.refId === 'g_evt_1');
      expect(googleEvent).toBeDefined();
      expect(googleEvent!.kind).toBe('google_event');
      expect(googleEvent!.allDay).toBe(false);
      expect(googleEvent!.meta).toMatchObject({
        location: '12 Main Street, Port of Spain',
        organizer: 'owner@acme.com',
        allDay: false,
      });
      expect(googleEvent!.meta!.attendees).toEqual([
        { email: 'alex@acme.com', displayName: 'Alex' },
        { email: 'sam@acme.com', displayName: undefined },
      ]);

      const allDayKf = events.find((e) => e.refId === 'g_evt_allday');
      expect(allDayKf).toBeDefined();
      expect(allDayKf!.allDay).toBe(true);
      expect(allDayKf!.meta).toMatchObject({ allDay: true });
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});
