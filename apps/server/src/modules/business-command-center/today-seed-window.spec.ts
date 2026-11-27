import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  localTimeTodayUtc,
  todaySeedFixtures,
} from '../../../test/helpers/today-seed-time.js';
import { TodayService } from './today.service';

interface CapturedQueryBounds {
  dayStart: Date;
  dayEnd: Date;
  invoiceDayEnd: Date;
  taskDayEnd: Date;
  responseTimezone: string;
}

/**
 * Runs the real `TodayService.getToday` under a pinned `Date` clock and captures
 * the exact UTC `[dayStart, dayEnd]` predicates it passes to Prisma for bookings,
 * invoices, and tasks.
 */
async function captureTodayServiceBounds(now: Date, businessTimeZone: string | null): Promise<CapturedQueryBounds> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);

  let bookingStartTimeWhere: { gte?: Date; lte?: Date } | undefined;
  let invoiceDueDateLte: Date | undefined;
  let taskDueDateLte: Date | undefined;

  const mockPrisma = {
    client: {
      user: {
        findUnique: vi.fn(async () => ({ id: 'tz_owner', role: 'USER' })),
      },
      membership: {
        findUnique: vi.fn(async () => ({ role: 'OWNER', permissionScopes: null })),
      },
      business: {
        findUnique: vi.fn(async () => ({
          id: 'tz_biz',
          timezone: businessTimeZone,
          currency: 'TTD',
          slug: 'tz-biz',
          storeEnabled: true,
          businessHours: null,
          metaData: {},
        })),
      },
      product: { count: vi.fn(async () => 0) },
      service: { count: vi.fn(async () => 0) },
      quote: { findMany: vi.fn(async () => []) },
      approvalRequest: { findMany: vi.fn(async () => []) },
      aiPlanStep: { findMany: vi.fn(async () => []) },
      marketplaceOrder: { findMany: vi.fn(async () => []) },
      booking: {
        findMany: vi.fn(async (args: { where?: { startTime?: { gte?: Date; lte?: Date } } }) => {
          bookingStartTimeWhere = args.where?.startTime;
          return [];
        }),
      },
      invoice: {
        findMany: vi.fn(
          async (args: { where?: { AND?: Array<{ OR?: Array<{ dueDate?: { lte?: Date } }> }> } }) => {
            const orList = args.where?.AND?.[0]?.OR ?? [];
            const dueBranch = orList.find((branch) => branch.dueDate?.lte instanceof Date);
            invoiceDueDateLte = dueBranch?.dueDate?.lte;
            return [];
          },
        ),
      },
      contactTask: {
        findMany: vi.fn(async (args: { where?: { dueDate?: { lte?: Date } } }) => {
          taskDueDateLte = args.where?.dueDate?.lte;
          return [];
        }),
      },
    },
  };

  const mockFinanceOverview = {
    getOverview: vi.fn(async () => ({
      cashBalance: 0,
      cashBasis: 'LEDGER',
      cashCurrency: 'TTD',
      otherCurrencyCash: [],
      outstandingInvoices: 0,
      outstandingInvoiceCount: 0,
      overdueInvoices: 0,
      overdueInvoiceCount: 0,
      billsDue: 0,
      billsDueCount: 0,
      revenueThisMonth: 0,
      expensesThisMonth: 0,
      netProfitThisMonth: 0,
      currency: 'TTD',
    })),
  };
  const mockSafeToSpend = { calculate: vi.fn(async () => ({ safeToSpend: 0 })) };
  const mockReadyToSend = { listDue: vi.fn(async () => ({ items: [] })) };
  const mockKeyAutonomy = { listForReader: vi.fn(async () => []) };
  const mockCommerce = { listPaymentClaims: vi.fn(async () => []) };

  const svc = new TodayService(
    mockPrisma as never,
    mockFinanceOverview as never,
    mockSafeToSpend as never,
    mockReadyToSend as never,
    mockKeyAutonomy as never,
    mockCommerce as never,
  );

  const res = await svc.getToday('tz_biz', { id: 'tz_owner', role: 'USER' });

  expect(bookingStartTimeWhere?.gte).toBeInstanceOf(Date);
  expect(bookingStartTimeWhere?.lte).toBeInstanceOf(Date);
  expect(invoiceDueDateLte).toBeInstanceOf(Date);
  expect(taskDueDateLte).toBeInstanceOf(Date);

  return {
    dayStart: bookingStartTimeWhere!.gte!,
    dayEnd: bookingStartTimeWhere!.lte!,
    invoiceDayEnd: invoiceDueDateLte!,
    taskDayEnd: taskDueDateLte!,
    responseTimezone: res.timezone,
  };
}

describe('P203 (FU-TODAY-AGGREGATE-TZ-SEED): today-aggregate fixture seed window across all 24 UTC hours', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[TZ-01] keeps every todaySeedFixtures timestamp strictly inside TodayService [dayStart, dayEnd] across all 24 UTC hours and rollover boundaries in America/Port_of_Spain', async () => {
    const tz = 'America/Port_of_Spain';
    const instants: Date[] = [];
    for (let hour = 0; hour < 24; hour++) {
      instants.push(new Date(Date.UTC(2026, 10, 26, hour, 0, 0, 0)));
    }
    // Critical boundary instants around 02:00–04:00 UTC (22:00–24:00 Port-of-Spain) + month/year rollovers
    instants.push(
      new Date('2026-11-26T01:59:59.999Z'),
      new Date('2026-11-26T02:00:00.000Z'),
      new Date('2026-11-26T02:30:00.000Z'),
      new Date('2026-11-26T03:30:00.000Z'),
      new Date('2026-11-26T03:55:00.000Z'),
      new Date('2026-11-26T03:59:59.000Z'),
      new Date('2026-11-26T04:00:00.000Z'),
      new Date('2026-11-26T04:00:01.000Z'),
      new Date('2026-11-26T23:59:59.000Z'),
      new Date('2026-12-01T02:30:00.000Z'), // Port-of-Spain is still Nov 30 22:30
      new Date('2027-01-01T03:30:00.000Z'), // Port-of-Spain is still Dec 31 23:30
    );

    for (const now of instants) {
      const bounds = await captureTodayServiceBounds(now, tz);
      const fixtures = todaySeedFixtures(now, tz);
      const label = now.toISOString();

      expect(bounds.responseTimezone, label).toBe(tz);
      expect(bounds.invoiceDayEnd.getTime(), label).toBe(bounds.dayEnd.getTime());
      expect(bounds.taskDayEnd.getTime(), label).toBe(bounds.dayEnd.getTime());

      expect(fixtures.bookingStart.getTime(), `${label} bookingStart >= dayStart`).toBeGreaterThanOrEqual(
        bounds.dayStart.getTime(),
      );
      expect(fixtures.bookingStart.getTime(), `${label} bookingStart <= dayEnd`).toBeLessThanOrEqual(
        bounds.dayEnd.getTime(),
      );
      expect(fixtures.bookingEnd.getTime(), `${label} bookingEnd > bookingStart`).toBeGreaterThan(
        fixtures.bookingStart.getTime(),
      );
      expect(fixtures.bookingEnd.getTime(), `${label} bookingEnd <= dayEnd`).toBeLessThanOrEqual(
        bounds.dayEnd.getTime(),
      );

      expect(fixtures.privateBookingStart.getTime(), `${label} privateBookingStart >= dayStart`).toBeGreaterThanOrEqual(
        bounds.dayStart.getTime(),
      );
      expect(fixtures.privateBookingStart.getTime(), `${label} privateBookingStart <= dayEnd`).toBeLessThanOrEqual(
        bounds.dayEnd.getTime(),
      );
      expect(fixtures.privateBookingEnd.getTime(), `${label} privateBookingEnd > privateBookingStart`).toBeGreaterThan(
        fixtures.privateBookingStart.getTime(),
      );
      expect(fixtures.privateBookingEnd.getTime(), `${label} privateBookingEnd <= dayEnd`).toBeLessThanOrEqual(
        bounds.dayEnd.getTime(),
      );

      expect(fixtures.dueToday.getTime(), `${label} dueToday >= dayStart`).toBeGreaterThanOrEqual(
        bounds.dayStart.getTime(),
      );
      expect(fixtures.dueToday.getTime(), `${label} dueToday <= dayEnd`).toBeLessThanOrEqual(
        bounds.dayEnd.getTime(),
      );

      expect(fixtures.yesterday.getTime(), `${label} yesterday < dayStart`).toBeLessThan(bounds.dayStart.getTime());
      expect(fixtures.yesterday.getTime(), `${label} yesterday < now`).toBeLessThan(now.getTime());
    }
  });

  it('[TZ-02] proves legacy now+2h / now+90m booking seeds overshoot Port-of-Spain dayEnd in 02:00–04:00 UTC while todaySeedFixtures stays in-window', async () => {
    const tz = 'America/Port_of_Spain';

    const at0230 = new Date('2026-11-26T02:30:00.000Z'); // 22:30 Port-of-Spain
    const bounds0230 = await captureTodayServiceBounds(at0230, tz);
    const legacyPlus2h = new Date(at0230.getTime() + 2 * 60 * 60_000);
    const legacyPlus90m = new Date(at0230.getTime() + 90 * 60_000);
    expect(legacyPlus2h.getTime()).toBeGreaterThan(bounds0230.dayEnd.getTime());
    expect(legacyPlus90m.getTime()).toBeGreaterThan(bounds0230.dayEnd.getTime());

    const safe0230 = todaySeedFixtures(at0230, tz);
    expect(safe0230.bookingStart.getTime()).toBeGreaterThanOrEqual(bounds0230.dayStart.getTime());
    expect(safe0230.bookingStart.getTime()).toBeLessThanOrEqual(bounds0230.dayEnd.getTime());
    expect(safe0230.privateBookingStart.getTime()).toBeGreaterThanOrEqual(bounds0230.dayStart.getTime());
    expect(safe0230.privateBookingStart.getTime()).toBeLessThanOrEqual(bounds0230.dayEnd.getTime());

    const at0355 = new Date('2026-11-26T03:55:00.000Z'); // 23:55 Port-of-Spain
    const bounds0355 = await captureTodayServiceBounds(at0355, tz);
    expect(new Date(at0355.getTime() + 2 * 60 * 60_000).getTime()).toBeGreaterThan(bounds0355.dayEnd.getTime());
    const safe0355 = todaySeedFixtures(at0355, tz);
    expect(safe0355.bookingStart.getTime()).toBeGreaterThanOrEqual(bounds0355.dayStart.getTime());
    expect(safe0355.bookingStart.getTime()).toBeLessThanOrEqual(bounds0355.dayEnd.getTime());
  });

  it('[TZ-03] stays strictly inside TodayService [dayStart, dayEnd] for DST-observing and positive-offset IANA timezones', async () => {
    const cases: Array<{ tz: string; iso: string }> = [
      // America/New_York spring-forward (2026-03-08)
      { tz: 'America/New_York', iso: '2026-03-08T02:30:00.000Z' },
      { tz: 'America/New_York', iso: '2026-03-08T07:30:00.000Z' },
      { tz: 'America/New_York', iso: '2026-03-09T03:30:00.000Z' },
      // America/New_York fall-back (2026-11-01)
      { tz: 'America/New_York', iso: '2026-11-01T02:30:00.000Z' },
      { tz: 'America/New_York', iso: '2026-11-01T06:30:00.000Z' },
      { tz: 'America/New_York', iso: '2026-11-02T03:30:00.000Z' },
      // Positive-offset timezone (UTC+9) around local midnight (15:00 UTC)
      { tz: 'Asia/Tokyo', iso: '2026-11-26T14:30:00.000Z' },
      { tz: 'Asia/Tokyo', iso: '2026-11-26T15:30:00.000Z' },
    ];

    for (const { tz, iso } of cases) {
      const now = new Date(iso);
      const bounds = await captureTodayServiceBounds(now, tz);
      const fixtures = todaySeedFixtures(now, tz);

      expect(fixtures.bookingStart.getTime(), `${tz} @ ${iso}`).toBeGreaterThanOrEqual(bounds.dayStart.getTime());
      expect(fixtures.bookingStart.getTime(), `${tz} @ ${iso}`).toBeLessThanOrEqual(bounds.dayEnd.getTime());
      expect(fixtures.privateBookingStart.getTime(), `${tz} @ ${iso}`).toBeGreaterThanOrEqual(bounds.dayStart.getTime());
      expect(fixtures.privateBookingStart.getTime(), `${tz} @ ${iso}`).toBeLessThanOrEqual(bounds.dayEnd.getTime());
      expect(fixtures.dueToday.getTime(), `${tz} @ ${iso}`).toBeLessThanOrEqual(bounds.dayEnd.getTime());
      expect(fixtures.yesterday.getTime(), `${tz} @ ${iso}`).toBeLessThan(bounds.dayStart.getTime());
    }
  });

  it('[TZ-04] handles blank/invalid timezone fallback matching TodayService and rejects invalid hour/minute/Date inputs', async () => {
    const now = new Date('2026-11-26T02:30:00.000Z');

    // Blank/null timezone falls back to America/Port_of_Spain (matching TodayService.DEFAULT_TIMEZONE)
    const defaultBounds = await captureTodayServiceBounds(now, null);
    const defaultFixtures = todaySeedFixtures(now, '');
    expect(defaultBounds.responseTimezone).toBe('America/Port_of_Spain');
    expect(defaultFixtures.bookingStart.getTime()).toBeGreaterThanOrEqual(defaultBounds.dayStart.getTime());
    expect(defaultFixtures.bookingStart.getTime()).toBeLessThanOrEqual(defaultBounds.dayEnd.getTime());

    // Invalid IANA timezone falls back to UTC (matching TodayService.resolveValidTimeZone)
    const invalidBounds = await captureTodayServiceBounds(now, 'Mars/Olympus_Mons');
    const invalidFixtures = todaySeedFixtures(now, 'Mars/Olympus_Mons');
    expect(invalidBounds.responseTimezone).toBe('UTC');
    expect(invalidFixtures.bookingStart.getTime()).toBeGreaterThanOrEqual(invalidBounds.dayStart.getTime());
    expect(invalidFixtures.bookingStart.getTime()).toBeLessThanOrEqual(invalidBounds.dayEnd.getTime());

    // Failure cases: out-of-range hours/minutes and invalid Date throw loudly
    expect(() => localTimeTodayUtc('America/Port_of_Spain', -1, 0, now)).toThrow(RangeError);
    expect(() => localTimeTodayUtc('America/Port_of_Spain', 24, 0, now)).toThrow(RangeError);
    expect(() => localTimeTodayUtc('America/Port_of_Spain', 12, -1, now)).toThrow(RangeError);
    expect(() => localTimeTodayUtc('America/Port_of_Spain', 12, 60, now)).toThrow(RangeError);
    expect(() => localTimeTodayUtc('America/Port_of_Spain', 12, 0, new Date('invalid'))).toThrow(TypeError);
  });

  it('[TZ-05] today-aggregate.integration.test.ts uses today-seed-time.js with no hardcoded UTC-4 hour arithmetic or forward now+ booking offsets and includes midnight-pinned TD-09', () => {
    const integrationPath = join(__dirname, '..', '..', '..', 'test', 'today-aggregate.integration.test.ts');
    const src = readFileSync(integrationPath, 'utf8');

    expect(src).toContain('./helpers/today-seed-time.js');
    expect(src).toContain('todaySeedFixtures');
    expect(src).not.toMatch(/Date\.UTC\([^)]*,\s*16\s*,\s*0\s*,\s*0\s*,\s*0\)/);
    expect(src).not.toMatch(/Date\.UTC\([^)]*,\s*18\s*,\s*0\s*,\s*0\s*,\s*0\)/);
    expect(src).not.toMatch(/now\.getTime\(\)\s*\+\s*(?:2\s*\*\s*60|90\s*\*\s*60)/);
    expect(src).toContain('[TD-09]');
  });
});
