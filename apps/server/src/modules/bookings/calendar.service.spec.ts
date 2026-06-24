import { describe, expect, it, vi, afterEach } from 'vitest';
import { CalendarService } from './calendar.service';
import { KeyflowCommandService } from '../keyflow-command/keyflow-command.service';
import { PrismaService } from '../../core/prisma/prisma.service';

describe('CalendarService.listCalendarEvents → KeyflowEvent meta round-trip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function buildPrismaMock() {
    return {
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
    } as unknown as PrismaService;
  }

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

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => googleApiResponse,
        text: async () => '',
      } as any),
    );

    const prismaMock = buildPrismaMock();
    const calendar = new CalendarService(prismaMock);

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

    const keyflow = new KeyflowCommandService(prismaMock, calendar);
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
  });
});
