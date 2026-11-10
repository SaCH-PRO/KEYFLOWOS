/**
 * W8-GOOGLE-CONSENT-OWNER (REAL database; owner ruling D-99): every Google
 * connection for a business (Calendar, Drive, Contacts, Gmail, Analytics,
 * Search Console) is started, synced and disconnected only by the business
 * owner. The rule has the Gmail rule's shape (GmailService.assertConnectAuthority,
 * D-11): an OWNER membership of the route's own business, or that business's
 * distinguished owner (Business.ownerId), with the SUPER_ADMIN bypass
 * BusinessGuard already grants. Anyone else (an ADMIN or STAFF member, the
 * owner of another business) gets 403 GOOGLE_CONNECT_OWNER_ONLY before a
 * consent URL is built or a stored connection is touched.
 *
 * The defect (review CR-RCV-1, SEC-W7RCV-2, CR-RCV-2 of W7-RECENT-CONTACTS-
 * VISIBILITY): GET /bookings/businesses/:b/calendar/auth-url and GET
 * /drive/businesses/:b/auth-url gave any member a Google consent URL whose
 * signed state names the business, so a STAFF member could connect their own
 * Google Calendar or Drive as the business's; POST .../calendar/disconnect and
 * DELETE /drive/businesses/:b/disconnect let any member clear the business's
 * stored Google tokens.
 *
 * This suite covers the bookings Google Calendar doors and the Google Drive
 * doors. The Google Suite consent (POST /connect/google-suite/businesses/:b/
 * auth-url) is covered by connect-recent-visibility.integration.test.ts
 * ([V93E-B01]) and gmail-connect-binding.integration.test.ts ([R0-CMF5-H01]);
 * the CRM Google contact import consent (GET /crm/businesses/:b/google/auth-url)
 * and its callback by contacts-import-write-scope.integration.test.ts
 * ([V94D-C01]..[V94D-C03]). The Google doors outside this packet's write set
 * are it.todo at the end of this file ([V94D-T01]..[V94D-T03]).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business and membership rows, AuthGuard, BusinessGuard,
 * BookingsController, GoogleDriveController, CalendarService (getAuthUrl,
 * getCalendarStatus, disconnectCalendar) and GoogleDriveService (getAuthUrl,
 * getConnectionStatus, disconnect) are real against DATABASE_URL, with an
 * obviously fake OAuth client id and state secret. The stand-ins: identity
 * attachment (a test middleware reads `x-test-user`, loads that seeded user row
 * and attaches `{ id, email, role }` as AuthMiddleware would after Supabase
 * token verification) and the two controllers' collaborators no case here
 * reaches. No provider is called.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v94d_` prefix and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v94d_';

const ID = {
  owner: `${P}owner`, // OWNER membership of biz and its Business.ownerId
  coOwner: `${P}coowner`, // OWNER membership of biz, not its Business.ownerId
  admin: `${P}admin`, // ADMIN of biz, role defaults
  staff: `${P}staff`, // STAFF of biz, bookings write
  otherOwner: `${P}otherowner`, // Business.ownerId of bizOther (no membership row there); STAFF of biz
  superAdmin: `${P}super`, // SUPER_ADMIN, no membership
  stranger: `${P}stranger`, // no membership anywhere
  biz: `${P}biz`,
  bizOther: `${P}bizother`,
};

const USERS = [ID.owner, ID.coOwner, ID.admin, ID.staff, ID.otherOwner, ID.superAdmin, ID.stranger];

/** The members of biz the ruling refuses (each passes AuthGuard and BusinessGuard). */
const REFUSED = [ID.admin, ID.staff, ID.otherOwner];

// Obviously fake OAuth configuration (no real client id or secret). CalendarService
// and GoogleDriveService read it when they are constructed.
const OAUTH_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: `${P}fake-client-id`,
  GOOGLE_CLIENT_SECRET: `${P}fake-client-secret-not-real`,
  GOOGLE_STATE_SECRET: `${P}fake-state-secret-not-real`,
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/crm/google/callback',
  DRIVE_REDIRECT_URI: 'http://localhost:3000/api/drive/callback',
};
const OAUTH_KEYS = [...Object.keys(OAUTH_ENV), 'CALENDAR_REDIRECT_URI'];
const savedEnv: Record<string, string | undefined> = {};

/** The stored Google connection a business starts each case with (obviously fake tokens). */
function storedTokens(businessId: string) {
  return {
    calendarEmail: `${businessId}-calendar@test.local`,
    calendarAccess: `${businessId}-fake-calendar-access-not-real`,
    calendarRefresh: `${businessId}-fake-calendar-refresh-not-real`,
    driveEmail: `${businessId}-drive@test.local`,
    driveAccess: `${businessId}-fake-drive-access-not-real`,
    driveRefresh: `${businessId}-fake-drive-refresh-not-real`,
  };
}

let db: any;
let app: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Write the stored calendar and drive connection back onto `businessId` (raw SQL, as stored). */
async function connect(businessId: string) {
  const t = storedTokens(businessId);
  await db.$executeRawUnsafe(
    `UPDATE businesses SET calendar_email = $2, calendar_access_token = $3, calendar_refresh_token = $4,
       calendar_token_expiry = now() + interval '1 hour', calendar_id = 'primary',
       drive_email = $5, drive_access_token = $6, drive_refresh_token = $7, drive_token_expiry = now() + interval '1 hour'
     WHERE id = $1`,
    businessId, t.calendarEmail, t.calendarAccess, t.calendarRefresh, t.driveEmail, t.driveAccess, t.driveRefresh,
  );
}

/** The stored calendar and drive columns of `businessId`, as stored. */
async function stored(businessId: string) {
  const rows: Array<Record<string, unknown>> = await db.$queryRawUnsafe(
    `SELECT calendar_email, calendar_access_token, calendar_refresh_token, calendar_token_expiry IS NOT NULL AS calendar_expiry, calendar_id,
            drive_email, drive_access_token, drive_refresh_token, drive_token_expiry IS NOT NULL AS drive_expiry
     FROM businesses WHERE id = $1`,
    businessId,
  );
  return rows[0];
}

function connectedRow(businessId: string) {
  const t = storedTokens(businessId);
  return {
    calendar_email: t.calendarEmail, calendar_access_token: t.calendarAccess, calendar_refresh_token: t.calendarRefresh, calendar_expiry: true, calendar_id: 'primary',
    drive_email: t.driveEmail, drive_access_token: t.driveAccess, drive_refresh_token: t.driveRefresh, drive_expiry: true,
  };
}

beforeAll(async () => {
  for (const key of OAUTH_KEYS) savedEnv[key] = process.env[key];
  delete process.env.CALENDAR_REDIRECT_URI;
  Object.assign(process.env, OAUTH_ENV);

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
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
  const { GoogleDriveController } = await import('../src/modules/google-drive/google-drive.controller');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { GeneratedDocumentService } = await import('../src/modules/google-drive/generated-document.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');

  Logger.overrideLogger(false);

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController, GoogleDriveController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
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
      { provide: GeneratedDocumentService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      // The Google Calendar and Drive connections, real (no connector: both are @Optional).
      CalendarService,
      GoogleDriveService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v94d_ users. No guard is overridden.
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
  await db.business.create({ data: { id: ID.biz, name: 'V94D Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizOther, name: 'V94D Other Biz', ownerId: ID.otherOwner } });
  const memberships: Array<[string, string, Record<string, string> | null]> = [
    [ID.owner, 'OWNER', null],
    [ID.coOwner, 'OWNER', null],
    [ID.admin, 'ADMIN', null],
    [ID.staff, 'STAFF', { bookings: 'write' }],
    [ID.otherOwner, 'STAFF', { bookings: 'write' }],
  ];
  for (const [userId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: { id: `${P}m_${userId}`, userId, businessId: ID.biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
  await connect(ID.biz);
  await connect(ID.bizOther);
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  for (const key of OAUTH_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const agent = () => request(app.getHttpServer());

function as(req: any, actor: string | undefined) {
  return actor ? req.set('x-test-user', actor) : req;
}

const calendarAuthUrl = (businessId: string, actor: string | undefined) =>
  as(agent().get(`/bookings/businesses/${businessId}/calendar/auth-url`), actor);
const calendarDisconnect = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/bookings/businesses/${businessId}/calendar/disconnect`), actor);
const calendarStatus = (businessId: string, actor: string | undefined) =>
  as(agent().get(`/bookings/businesses/${businessId}/calendar/status`), actor);
const driveAuthUrl = (businessId: string, actor: string | undefined) =>
  as(agent().get(`/drive/businesses/${businessId}/auth-url`), actor);
const driveDisconnect = (businessId: string, actor: string | undefined) =>
  as(agent().delete(`/drive/businesses/${businessId}/disconnect`), actor);
const driveStatus = (businessId: string, actor: string | undefined) =>
  as(agent().get(`/drive/businesses/${businessId}/status`), actor);

/** A refusal under D-99: 403 GOOGLE_CONNECT_OWNER_ONLY, and no Google consent URL anywhere in the body. */
function expectGoogleOwnerOnly(res: { status: number; body: any }, who: string) {
  expect(res.status, `${who} ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body.code, `${who} ${JSON.stringify(res.body)}`).toBe('GOOGLE_CONNECT_OWNER_ONLY');
  expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
}

/** An admitted consent: a Google URL whose signed state names `businessId` (and the flow tag `flow`, if any). */
function expectConsentFor(res: { status: number; body: any }, businessId: string, flow: string | undefined, who: string) {
  expect(res.status, `${who} ${JSON.stringify(res.body)}`).toBe(200);
  const url = new URL(res.body.url);
  expect(url.origin).toBe('https://accounts.google.com');
  // base64 of `${JSON payload}.${hex HMAC}`, the format every Google flow here signs.
  const decoded = Buffer.from(String(url.searchParams.get('state')), 'base64').toString('utf8');
  const claims = JSON.parse(decoded.slice(0, decoded.lastIndexOf('.')));
  expect(claims.businessId).toBe(businessId);
  expect(claims.flow).toBe(flow);
}

describe('W8-GOOGLE-CONSENT-OWNER fixture sanity (real rows)', () => {
  it('[V94D-X01] seeded two businesses: biz with its owner (OWNER and Business.ownerId), a co-owner (OWNER membership only), an ADMIN, a STAFF member and the distinguished owner of bizOther as a STAFF member; bizOther with no membership row; both hold a stored Google Calendar and Drive connection', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(5);
    expect(await db.membership.count({ where: { businessId: ID.bizOther } })).toBe(0);
    expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
    expect(await stored(ID.bizOther)).toEqual(connectedRow(ID.bizOther));
  });
});

describe('W8-GOOGLE-CONSENT-OWNER: starting or disconnecting the Google Calendar connection is the business owner\'s (D-99)', () => {
  it('[V94D-A01] RED-BEFORE (D-99; SEC-W7RCV-2): GET /bookings/businesses/:b/calendar/auth-url answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with no Google URL', async () => {
    for (const member of REFUSED) expectGoogleOwnerOnly(await calendarAuthUrl(ID.biz, member), member);
  });

  it('[V94D-A02] control (D-99, the Gmail owner rule\'s arms): the owner, a co-owner by OWNER membership, the distinguished owner (Business.ownerId, no membership row) and a SUPER_ADMIN with no membership each get the calendar consent URL, its signed state naming the route\'s business', async () => {
    expectConsentFor(await calendarAuthUrl(ID.biz, ID.owner), ID.biz, undefined, 'owner');
    expectConsentFor(await calendarAuthUrl(ID.biz, ID.coOwner), ID.biz, undefined, 'coOwner');
    expectConsentFor(await calendarAuthUrl(ID.bizOther, ID.otherOwner), ID.bizOther, undefined, 'otherOwner on bizOther');
    expectConsentFor(await calendarAuthUrl(ID.biz, ID.superAdmin), ID.biz, undefined, 'superAdmin');
  });

  it('[V94D-A03] RED-BEFORE (D-99): POST /bookings/businesses/:b/calendar/disconnect answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY, and the business\'s stored calendar connection (and its drive connection) stays exactly as it was', async () => {
    await connect(ID.biz);
    for (const member of REFUSED) {
      expectGoogleOwnerOnly(await calendarDisconnect(ID.biz, member), member);
      expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
    }
  });

  it('[V94D-A04] control (D-99): the owner disconnects the calendar (calendar email, tokens, expiry and calendar id cleared; the drive connection untouched), and so do the co-owner, the distinguished owner on their own business and a SUPER_ADMIN', async () => {
    for (const [businessId, actor] of [[ID.biz, ID.owner], [ID.biz, ID.coOwner], [ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]]) {
      await connect(businessId);
      const res = await calendarDisconnect(businessId, actor);
      expect([200, 201], `${actor} ${JSON.stringify(res.body)}`).toContain(res.status);
      expect(res.body).toEqual({ success: true });
      expect(await stored(businessId)).toEqual({
        ...connectedRow(businessId),
        calendar_email: null, calendar_access_token: null, calendar_refresh_token: null, calendar_expiry: false, calendar_id: null,
      });
    }
    await connect(ID.biz);
    await connect(ID.bizOther);
  });

  it('[V94D-A05] control: the ruling covers start, sync and disconnect only, so GET .../calendar/status stays readable to every member (a STAFF member and an ADMIN get 200 connected); a user with no membership is refused every calendar door by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with no URL and nothing changed', async () => {
    for (const member of [ID.staff, ID.admin]) {
      const res = await calendarStatus(ID.biz, member);
      expect(res.status, `${member} ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ connected: true });
    }
    for (const [actor, status] of [[ID.stranger, 403], [undefined, 401]] as const) {
      for (const res of [await calendarAuthUrl(ID.biz, actor), await calendarDisconnect(ID.biz, actor)]) {
        expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(status);
        expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
      }
    }
    expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
  });
});

describe('W8-GOOGLE-CONSENT-OWNER: starting or disconnecting the Google Drive connection is the business owner\'s (D-99)', () => {
  it('[V94D-B01] RED-BEFORE (D-99; SEC-W7RCV-2, CR-RCV-2): GET /drive/businesses/:b/auth-url answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with no Google URL', async () => {
    for (const member of REFUSED) expectGoogleOwnerOnly(await driveAuthUrl(ID.biz, member), member);
  });

  it('[V94D-B02] control (D-99, the Gmail owner rule\'s arms): the owner, a co-owner by OWNER membership, the distinguished owner (Business.ownerId, no membership row) and a SUPER_ADMIN with no membership each get the drive consent URL, its signed state naming the route\'s business and the drive flow', async () => {
    expectConsentFor(await driveAuthUrl(ID.biz, ID.owner), ID.biz, 'drive', 'owner');
    expectConsentFor(await driveAuthUrl(ID.biz, ID.coOwner), ID.biz, 'drive', 'coOwner');
    expectConsentFor(await driveAuthUrl(ID.bizOther, ID.otherOwner), ID.bizOther, 'drive', 'otherOwner on bizOther');
    expectConsentFor(await driveAuthUrl(ID.biz, ID.superAdmin), ID.biz, 'drive', 'superAdmin');
  });

  it('[V94D-B03] RED-BEFORE (D-99): DELETE /drive/businesses/:b/disconnect answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY, and the business\'s stored drive connection (and its calendar connection) stays exactly as it was', async () => {
    await connect(ID.biz);
    for (const member of REFUSED) {
      expectGoogleOwnerOnly(await driveDisconnect(ID.biz, member), member);
      expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
    }
  });

  it('[V94D-B04] control (D-99): the owner disconnects Drive (drive email, tokens and expiry cleared; the calendar connection untouched), and so do the co-owner, the distinguished owner on their own business and a SUPER_ADMIN', async () => {
    for (const [businessId, actor] of [[ID.biz, ID.owner], [ID.biz, ID.coOwner], [ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]]) {
      await connect(businessId);
      const res = await driveDisconnect(businessId, actor);
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(200);
      expect(await stored(businessId)).toEqual({
        ...connectedRow(businessId),
        drive_email: null, drive_access_token: null, drive_refresh_token: null, drive_expiry: false,
      });
    }
    await connect(ID.biz);
    await connect(ID.bizOther);
  });

  it('[V94D-B05] control: GET /drive/businesses/:b/status stays readable to every member (a STAFF member and an ADMIN get 200 connected); a user with no membership is refused every drive door by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with no URL and nothing changed', async () => {
    for (const member of [ID.staff, ID.admin]) {
      const res = await driveStatus(ID.biz, member);
      expect(res.status, `${member} ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ connected: true });
    }
    for (const [actor, status] of [[ID.stranger, 403], [undefined, 401]] as const) {
      for (const res of [await driveAuthUrl(ID.biz, actor), await driveDisconnect(ID.biz, actor)]) {
        expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(status);
        expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
      }
    }
    expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
  });
});

describe('W8-GOOGLE-CONSENT-OWNER: Google doors outside this packet\'s write set (D-99 follow-up)', () => {
  it.todo('[V94D-T01] needs apps/server/src/modules/calendar/calendar.controller.ts (outside the W8-GOOGLE-CONSENT-OWNER write set, which names the bookings calendar routes): POST /calendar/businesses/:b/sync/google/connect (a calendar consent URL), .../sync/google/disconnect and .../sync/google/resync answer an ADMIN and a STAFF member 403 GOOGLE_CONNECT_OWNER_ONLY with nothing changed; the owner keeps all three (D-99)');

  it.todo('[V94D-T02] needs apps/server/src/core/connectors/connector.controller.ts (outside the write set): POST /connectors/businesses/:b/sync/:type, .../disconnect/:type and .../reconnect/:type for google_calendar, google_drive, google_contacts, google_forms and google_business_profile (the connections the Google Suite consent provisions) answer an ADMIN and a STAFF member 403 GOOGLE_CONNECT_OWNER_ONLY before the registry is reached; the owner keeps them; R0-CMF6-K05 (a STAFF member syncs, tests and smoke-tests google_calendar) is retitled with gmail-connect-binding.json in the same change (D-99)');

  it.todo('[V94D-T03] needs apps/server/src/modules/connect/connect.controller.ts (outside the write set): POST /connect/businesses/:b/contacts/sync, POST .../contact-sources/google_contacts/resync, DELETE .../contact-sources/google_contacts and POST .../contact-sources/sync-all (which syncs Google Contacts) answer an ADMIN and a STAFF member 403 GOOGLE_CONNECT_OWNER_ONLY with nothing synced or cleared; the owner keeps them (D-99)');
});
