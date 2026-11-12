/**
 * W11-CALENDAR-NAMES-SCOPE (REAL database; owner ruling D-120, read with
 * D-125): the names of the owner's Google calendars (the calendar sync
 * settings list and the booking calendar list) are listed to the owner and
 * ADMINs only. STAFF may see that a calendar is connected, not its names.
 * Connecting and disconnecting stay owner-only (D-99; google-consent-owner.
 * integration.test.ts pins those doors, GOOGLE_CONNECT_OWNER_ONLY).
 *
 * The owner, by D-125, is whoever holds an OWNER membership of the route's
 * business: the recorded owner (Business.ownerId) holding it, or a co-owner
 * holding it without being the recorded owner. The recorded-owner field grants
 * nothing on its own (D-116), so a recorded owner who holds only a STAFF
 * membership is STAFF here. A platform SUPER_ADMIN follows the guard
 * behaviour these controllers already have (BusinessGuard admits them, as the
 * D-99 owner doors do).
 *
 * The defect (W10-GOOGLE-DOORS-REST residual, ruling R-2): GET
 * /calendar/businesses/:b/sync/calendars (CalendarController.listSyncCalendars,
 * CalendarSyncService.listAvailableCalendars) and GET
 * /bookings/businesses/:b/calendar/list (BookingsController.
 * listAvailableCalendars, CalendarService.listAvailableCalendars) carry only
 * AuthGuard + BusinessGuard, so any member, STAFF included, read the names of
 * every Google calendar the owner's connection can write to. Both now refuse
 * a member who holds neither an OWNER nor an ADMIN membership with 403
 * CALENDAR_NAMES_OWNER_OR_ADMIN before Google is called. The "is a calendar
 * connected" reads (GET /bookings/businesses/:b/calendar/status and GET
 * /calendar/businesses/:b/sync/status) stay open to every member and carry no
 * calendar name, so STAFF learn there that a calendar is connected: the list
 * routes refuse STAFF (403) rather than answering a names-free shape.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business and membership rows, AuthGuard, BusinessGuard,
 * BookingsController, CalendarController, CalendarService (getCalendarStatus,
 * listAvailableCalendars and its token read) and CalendarSyncService (getStatus,
 * listAvailableCalendars) are real against DATABASE_URL. The stand-ins:
 * identity attachment (a test middleware reads `x-test-user`, loads that
 * seeded user row and attaches `{ id, email, role }` as AuthMiddleware would
 * after Supabase token verification), the controllers' collaborators no case
 * here reaches, and the Google Calendar client: global fetch answers the
 * calendarList call with obviously fake calendars, records each call, and
 * refuses anything else, so no provider is called. Each business's stored
 * access token is unexpired, so no token refresh is attempted.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v97v_` prefix and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v97v_';

const ID = {
  owner: `${P}owner`, // Business.ownerId of biz holding its OWNER membership
  coOwner: `${P}coowner`, // OWNER membership of biz (and of bizRec), not a Business.ownerId
  admin: `${P}admin`, // ADMIN of biz, role defaults
  staff: `${P}staff`, // STAFF of biz, bookings write
  recOwner: `${P}recowner`, // Business.ownerId of bizRec holding only a STAFF membership there
  otherOwner: `${P}otherowner`, // Business.ownerId of bizOther with its OWNER membership; no membership of biz
  superAdmin: `${P}super`, // SUPER_ADMIN, no membership
  stranger: `${P}stranger`, // no membership anywhere
  biz: `${P}biz`,
  bizRec: `${P}bizrec`,
  bizOther: `${P}bizother`,
};

const USERS = [ID.owner, ID.coOwner, ID.admin, ID.staff, ID.recOwner, ID.otherOwner, ID.superAdmin, ID.stranger];

const NAMES_CODE = 'CALENDAR_NAMES_OWNER_OR_ADMIN';
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

/** The stored access token of `businessId` (obviously fake, unexpired). */
const accessTokenOf = (businessId: string) => `${businessId}-fake-calendar-access-not-real`;

/** The Google calendars the client stand-in lists for `businessId` (obviously fake names). */
function googleCalendarsOf(businessId: string) {
  return [
    { id: `${businessId}-primary@test.local`, summary: `${businessId} Owner Personal`, primary: true, accessRole: 'owner', backgroundColor: '#123456' },
    { id: `${businessId}-family@group.test.local`, summary: `${businessId} Family Plans`, summaryOverride: `${businessId} Family (renamed)`, accessRole: 'writer' },
  ];
}
/** The list a route answers for `businessId` (CalendarService.listAvailableCalendars' mapping). */
function listedCalendarsOf(businessId: string) {
  return [
    { id: `${businessId}-primary@test.local`, summary: `${businessId} Owner Personal`, primary: true, accessRole: 'owner', backgroundColor: '#123456' },
    { id: `${businessId}-family@group.test.local`, summary: `${businessId} Family (renamed)`, primary: false, accessRole: 'writer' },
  ];
}

/** Every call that reached the Google Calendar client stand-in: the URL and the bearer token it carried. */
const googleCalls: Array<{ url: string; token: string | null }> = [];
const realFetch = globalThis.fetch;

let db: any;
let app: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM calendar_sync_conflicts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Write a stored, unexpired Google Calendar connection onto `businessId` (raw SQL, obviously fake tokens). */
async function connect(businessId: string) {
  await db.$executeRawUnsafe(
    `UPDATE businesses SET calendar_email = $2, calendar_access_token = $3, calendar_refresh_token = $4,
       calendar_token_expiry = now() + interval '1 hour', calendar_id = 'primary'
     WHERE id = $1`,
    businessId,
    `${businessId}-calendar@test.local`,
    accessTokenOf(businessId),
    `${businessId}-fake-calendar-refresh-not-real`,
  );
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
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
  const { CalendarController } = await import('../src/modules/calendar/calendar.controller');
  const { CalendarSyncService } = await import('../src/modules/calendar/calendar-sync.service');
  const { CalendarProjectionService } = await import('../src/modules/calendar/calendar-projection.service');
  const { CalendarQueryService } = await import('../src/modules/calendar/calendar-query.service');
  const { CalendarConflictService } = await import('../src/modules/calendar/calendar-conflict.service');
  const { CalendarInsightService } = await import('../src/modules/calendar/calendar-insight.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { GoogleCalendarTemporalSyncService } = await import('../src/modules/calendar/connectors/google-calendar-temporal-sync.service');

  Logger.overrideLogger(false);

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController, CalendarController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      // Declared by CalendarController's event routes; no case here reaches them.
      ModuleScopeGuard,
      // Present only because the bookings controller's other routes declare them; no case here reaches them.
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: BookingsService, useValue: {} },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: BookingOptimizerService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      // CalendarController's and CalendarSyncService's collaborators no case here reaches.
      { provide: CalendarProjectionService, useValue: {} },
      { provide: CalendarQueryService, useValue: {} },
      { provide: CalendarConflictService, useValue: {} },
      { provide: CalendarInsightService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: GoogleCalendarTemporalSyncService, useValue: {} },
      // The Google Calendar connection, real (no connector: it is @Optional), and
      // the platform calendar sync over the same CalendarService.
      CalendarService,
      CalendarSyncService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v97v_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    // User.email is globally unique: the literal starts with the suite prefix (ids are `${P}<name>`).
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V97V Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizRec, name: 'V97V Recorded-Owner Biz', ownerId: ID.recOwner } });
  await db.business.create({ data: { id: ID.bizOther, name: 'V97V Other Biz', ownerId: ID.otherOwner } });
  const memberships: Array<[string, string, string, Record<string, string> | null]> = [
    [ID.owner, ID.biz, 'OWNER', null],
    [ID.coOwner, ID.biz, 'OWNER', null],
    [ID.admin, ID.biz, 'ADMIN', null],
    [ID.staff, ID.biz, 'STAFF', { bookings: 'write' }],
    // D-116/D-125: bizRec's recorded owner holds only a STAFF membership there;
    // the co-owner of biz also holds bizRec's OWNER membership (the control).
    [ID.recOwner, ID.bizRec, 'STAFF', { bookings: 'write' }],
    [ID.coOwner, ID.bizRec, 'OWNER', null],
    [ID.otherOwner, ID.bizOther, 'OWNER', null],
  ];
  for (const [userId, businessId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: { id: `${P}m_${userId}_${businessId.slice(P.length)}`, userId, businessId, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
  for (const businessId of [ID.biz, ID.bizRec, ID.bizOther]) await connect(businessId);

  // The Google Calendar client stand-in: the calendarList call answers the
  // calendars of the business whose stored access token it carries; anything
  // else is refused, so a case that reached another provider would fail
  // rather than call out.
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = init?.headers?.Authorization ?? null;
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    googleCalls.push({ url, token });
    if (url.startsWith(CALENDAR_LIST_URL)) {
      const businessId = [ID.biz, ID.bizRec, ID.bizOther].find((b) => token === accessTokenOf(b));
      if (!businessId) return new Response(JSON.stringify({ error: 'unknown token' }), { status: 401 });
      return new Response(JSON.stringify({ items: googleCalendarsOf(businessId) }), { status: 200 });
    }
    throw new Error(`v97v_ Google client stand-in: unexpected fetch ${url}`);
  }) as typeof fetch;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) await cleanup();
  if (app) await app.close();
});

beforeEach(() => {
  googleCalls.length = 0;
});

const agent = () => request(app.getHttpServer());

function as(req: any, actor: string | undefined) {
  return actor ? req.set('x-test-user', actor) : req;
}

/** The two routes that list the names of the owner's Google calendars. */
const NAME_ROUTES: Array<[string, (businessId: string) => string]> = [
  ['GET /calendar/businesses/:b/sync/calendars', (b) => `/calendar/businesses/${b}/sync/calendars`],
  ['GET /bookings/businesses/:b/calendar/list', (b) => `/bookings/businesses/${b}/calendar/list`],
];

const listNames = (route: (businessId: string) => string, businessId: string, actor: string | undefined) =>
  as(agent().get(route(businessId)), actor);

/** A D-120 refusal: 403 CALENDAR_NAMES_OWNER_OR_ADMIN, no calendar name in the body. */
function expectNamesRefused(res: { status: number; body: any }, businessId: string, who: string) {
  expect(res.status, `${who} ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body.code, `${who} ${JSON.stringify(res.body)}`).toBe(NAMES_CODE);
  for (const calendar of googleCalendarsOf(businessId)) {
    expect(JSON.stringify(res.body), who).not.toContain(calendar.summary);
  }
}

/** The members of biz (and bizRec's recorded owner) D-120 refuses: each passes AuthGuard and BusinessGuard. */
const REFUSED: Array<[string, string, string]> = [
  [ID.biz, ID.staff, 'a STAFF member'],
  [ID.bizRec, ID.recOwner, 'the recorded owner (Business.ownerId) holding only a STAFF membership'],
];

/** The readers D-120 (with D-125) admits, and the SUPER_ADMIN the guards admit. */
const READERS: Array<[string, string, string]> = [
  [ID.biz, ID.owner, 'the recorded owner holding the OWNER membership'],
  [ID.biz, ID.coOwner, 'a co-owner (OWNER membership, not Business.ownerId)'],
  [ID.biz, ID.admin, 'an ADMIN'],
  [ID.bizRec, ID.coOwner, 'the OWNER-membership holder of the business whose recorded owner is STAFF'],
  [ID.bizOther, ID.otherOwner, 'the owner of another business on their own business'],
  [ID.biz, ID.superAdmin, 'a platform SUPER_ADMIN with no membership'],
];

describe('W11-CALENDAR-NAMES-SCOPE: the names of the owner\'s Google calendars are listed to the owner and ADMINs only (D-120)', () => {
  it('[V97V-A01] (W11-CALENDAR-NAMES-SCOPE, D-120) RED-BEFORE: GET /calendar/businesses/:b/sync/calendars and GET /bookings/businesses/:b/calendar/list answer a STAFF member 403 CALENDAR_NAMES_OWNER_OR_ADMIN with no calendar name and the Google Calendar client never called', async () => {
    for (const [label, route] of NAME_ROUTES) {
      googleCalls.length = 0;
      expectNamesRefused(await listNames(route, ID.biz, ID.staff), ID.biz, `staff ${label}`);
      expect(googleCalls, `staff ${label}`).toEqual([]);
    }
  });

  it('[V97V-A02] (W11-CALENDAR-NAMES-SCOPE, D-120, D-125, D-116) RED-BEFORE: a recorded owner (Business.ownerId) who holds only a STAFF membership is STAFF: both routes answer 403 CALENDAR_NAMES_OWNER_OR_ADMIN with no calendar name and the Google Calendar client never called', async () => {
    for (const [label, route] of NAME_ROUTES) {
      googleCalls.length = 0;
      expectNamesRefused(await listNames(route, ID.bizRec, ID.recOwner), ID.bizRec, `recorded owner ${label}`);
      expect(googleCalls, `recorded owner ${label}`).toEqual([]);
    }
  });

  it('[V97V-A03] control (W11-CALENDAR-NAMES-SCOPE, D-120, D-125): the recorded owner holding the OWNER membership, a co-owner by OWNER membership, an ADMIN, the OWNER-membership holder of a business whose recorded owner is STAFF, the owner of another business on their own business and a SUPER_ADMIN read the names at both routes (200, the route business\'s calendars as the client listed them, with the Google Calendar client called once with that business\'s stored token)', async () => {
    for (const [businessId, actor, who] of READERS) {
      for (const [label, route] of NAME_ROUTES) {
        googleCalls.length = 0;
        const res = await listNames(route, businessId, actor);
        expect(res.status, `${who} ${label} ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body, `${who} ${label}`).toEqual(listedCalendarsOf(businessId));
        expect(googleCalls, `${who} ${label}`).toHaveLength(1);
        expect(googleCalls[0].url.startsWith(CALENDAR_LIST_URL), `${who} ${label}`).toBe(true);
        expect(googleCalls[0].token, `${who} ${label}`).toBe(accessTokenOf(businessId));
      }
    }
  });

  it('[V97V-A04] control (W11-CALENDAR-NAMES-SCOPE, D-120): STAFF still see that a calendar is connected: GET /bookings/businesses/:b/calendar/status and GET /calendar/businesses/:b/sync/status answer a STAFF member and the STAFF recorded owner 200 connected, with no calendar name and the Google Calendar client never called', async () => {
    for (const [businessId, actor, who] of REFUSED) {
      googleCalls.length = 0;
      const calendar = await as(agent().get(`/bookings/businesses/${businessId}/calendar/status`), actor);
      expect(calendar.status, `${who} calendar status ${JSON.stringify(calendar.body)}`).toBe(200);
      expect(calendar.body).toMatchObject({ connected: true });
      const sync = await as(agent().get(`/calendar/businesses/${businessId}/sync/status`), actor);
      expect(sync.status, `${who} sync status ${JSON.stringify(sync.body)}`).toBe(200);
      expect(sync.body).toMatchObject({ connected: true });
      for (const body of [calendar.body, sync.body]) {
        for (const c of googleCalendarsOf(businessId)) expect(JSON.stringify(body), who).not.toContain(c.summary);
      }
      expect(googleCalls, who).toEqual([]);
    }
  });

  it('[V97V-A05] control (W11-CALENDAR-NAMES-SCOPE, D-120): another business\'s owner, a user with no membership and an unauthenticated request are refused at both routes as the guards refuse them today (BusinessGuard 403, AuthGuard 401), with no calendar name and the Google Calendar client never called', async () => {
    for (const [label, route] of NAME_ROUTES) {
      googleCalls.length = 0;
      for (const actor of [ID.otherOwner, ID.stranger]) {
        const res = await listNames(route, ID.biz, actor);
        expect(res.status, `${actor} ${label} ${JSON.stringify(res.body)}`).toBe(403);
        for (const c of googleCalendarsOf(ID.biz)) expect(JSON.stringify(res.body), `${actor} ${label}`).not.toContain(c.summary);
      }
      const anonymous = await listNames(route, ID.biz, undefined);
      expect(anonymous.status, `anonymous ${label}`).toBe(401);
      expect(googleCalls, label).toEqual([]);
    }
  });
});
