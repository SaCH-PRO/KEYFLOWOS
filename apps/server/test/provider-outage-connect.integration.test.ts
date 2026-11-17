/**
 * W11-PROVIDER-OUTAGE-CONNECT (R-5 part 3; owner ruling D-73) — the Google
 * connect clients (People sync, Forms, Business Profile), the Microsoft Graph
 * client (Outlook Contacts sync), the CRM Google import and the Calendar list
 * answer a provider outage 503 provider_unavailable over HTTP, and a refusal
 * stays 400 (REAL database, REAL services, REAL ConnectController,
 * CrmGoogleController, BookingsController and CalendarController behind the
 * real guards and the production exception filter).
 *
 * The defect: these clients answered every non-OK upstream response with
 * BadRequestException, an outage included. Over HTTP,
 *
 *   POST /connect/businesses/:b/contacts/sync          (People 503 / 429)  -> 400 'People API error 503'
 *   POST /connect/businesses/:b/contacts/sync          (People 410)        -> 400 'Sync token expired; please retry'
 *   POST /connect/businesses/:b/outlook-contacts/sync  (Graph 503 / 410)   -> 400
 *   GET  /connect/businesses/:b/forms[/:formId]        (Forms / Drive 5xx) -> 400
 *   GET|POST /connect/businesses/:b/business-profile/* (5xx, 429)          -> 400
 *   POST /crm/businesses/:b/google/import              (People 503)        -> 400 'Failed to fetch Google contacts'
 *   GET  /bookings/businesses/:b/calendar/list, GET /calendar/businesses/:b/sync/calendars (503 / 429) -> 400
 *   an expired connection whose token endpoint is down (Google, Microsoft)  -> 400
 *
 * so a client could not tell "the provider is down, try again" from "your
 * request is wrong", and the two 410s said "please retry" with a 400. Now each
 * outage is 503 { statusCode: 503, code: 'provider_unavailable', message:
 * <the existing message>, details: { service, upstreamStatus } }, the two 410s
 * included (their cursor is still cleared, so the retry does a full sync); a
 * refusal (a 400, a 404, a Graph 409, a token endpoint's invalid_grant) keeps
 * its 400 and message. Nothing else is written on either answer: no token is
 * stored and no cursor moves (but the 410's own clear), no contact is created.
 * The D-99 owner door on the Google Contacts sync answers first, unchanged.
 *
 * RED-BEFORE (recorded in the tests-first commit): on the packet base
 * (c72069ac) every outage case answers 400 BAD_REQUEST with the same message;
 * the refusal controls, the retry after a 410 and the owner door pass.
 *
 * FU-PROVIDER-ERROR-HYGIENE (D-221, review follow-up C8): the provider's body
 * never reaches the answer. Four sites put it in their message, and since the
 * cases above those messages reach the client in a 503 as well as a 400:
 *
 *   an expired connection's token refresh (Google)  -> 'Failed to refresh <label> token: <body>'
 *   an expired connection's token refresh (Microsoft) -> 'Failed to refresh Outlook Contacts token: <body>'
 *   POST /connect/businesses/:b/outlook-contacts/sync (Graph delta) -> 'Graph API error <status>: <body, 200 chars>'
 *   POST /connect/businesses/:b/forms (Forms create) -> 'Forms API error <status>: <body>'
 *
 * and a scheduled Business Profile post that failed on a refresh kept that
 * message, body and all, in connector_statuses.metadata and in GET
 * .../business-profile/scheduled-posts. Each message is now the same text
 * without the body. And GET .../business-profile/insights, which answered
 * every Performance API failure 400 'Performance API <status>: <body>',
 * answers an outage 503 provider_unavailable (google_business_profile) and a
 * refusal 400, both 'Performance API <status>'. RED-BEFORE (chain head
 * b00e5f78): V63Y-05, -06, -07, -08, -10, -13 (their messages carry the body)
 * and V63Y-21 to V63Y-24 fail; the rest pass.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, the TenantInterceptor, ConnectController,
 * GoogleContactsSyncService, OutlookContactsSyncService, GoogleFormsService,
 * GoogleBusinessProfileService (their token helpers, GoogleTokenHelper and
 * MicrosoftTokenHelper, included), CrmGoogleController, CrmGoogleService,
 * CrmService, CrmTimelineService, ContactAuditService, BookingsController,
 * CalendarController, CalendarService, CalendarSyncService,
 * GlobalHttpExceptionFilter and ValidationPipe. The stand-ins: identity
 * attachment (a test middleware reads `x-v63y-user` and attaches the seeded
 * user row, as the Supabase AuthMiddleware would), the collaborators no case
 * reaches (empty objects), and the providers themselves: globalThis.fetch
 * answers the People, Graph, Forms, Drive, Business Profile, Calendar and
 * Google / Microsoft token endpoints in process with what each case sets, and
 * records and refuses anything else, so no provider is called. The OAuth
 * clients the services read are obviously fake ids built at runtime.
 *
 * Fixtures: prefix `v63y_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63y_';
const HEADER = 'x-v63y-user';

const ID = {
  owner: `${P}owner`,
  staff: `${P}staff`,
  /** Every connection connected, every access token live. */
  bizLive: `${P}bizLive`,
  /** Every connection connected, every access token expired (a refresh comes first). */
  bizExpired: `${P}bizExp`,
};
const SYNC_TOKEN = `${P}people-sync-token`;
const DELTA_LINK = `https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=${P}delta`;
const LOCATION = 'accounts/v63yacct/locations/v63yloc';
const LIVE_EXPIRY = () => new Date(Date.now() + 2 * 60 * 60 * 1000);
const PAST_EXPIRY = new Date(Date.now() - 2 * 60 * 60 * 1000);

/** The OAuth clients the services read: obviously fake ones, built at runtime. */
const OAUTH_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: [P, 'fake', 'oauth', 'client'].join(''),
  GOOGLE_CLIENT_SECRET: [P, 'fake', 'oauth', 'value'].join(''),
  GOOGLE_STATE_SECRET: [P, 'fake', 'state', 'value'].join(''),
  GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/crm/google/callback',
  MICROSOFT_CLIENT_ID: [P, 'fake', 'ms', 'client'].join(''),
  MICROSOFT_CLIENT_SECRET: [P, 'fake', 'ms', 'value'].join(''),
};
const savedEnv: Record<string, string | undefined> = {};

let db: any;
let app: any;
const realFetch = globalThis.fetch;

type Match = (url: string, method: string) => boolean;
/** What the providers answer this case: a request `when` matches gets `status` and `body`; everything else is refused. */
let providers: Array<{ when: Match; status: number; body: string }> = [];
/** Every provider request this suite's fetch answered, in order. */
const answered: Array<{ url: string; method: string; status: number }> = [];
/** Every outbound request no rule answered (refused). */
const outbound: string[] = [];

const isPeopleList: Match = (u, m) => m === 'GET' && u.startsWith('https://people.googleapis.com/v1/people/me/connections?');
const isGraphDelta: Match = (u, m) => m === 'GET' && u.startsWith('https://graph.microsoft.com/v1.0/me/contacts/delta');
const isGoogleToken: Match = (u, m) => m === 'POST' && u === 'https://oauth2.googleapis.com/token';
const isMicrosoftToken: Match = (u, m) => m === 'POST' && u === 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const isFormGet: Match = (u, m) => m === 'GET' && u === `https://forms.googleapis.com/v1/forms/${P}form`;
const isDriveFormsList: Match = (u, m) => m === 'GET' && u.startsWith('https://www.googleapis.com/drive/v3/files?');
const isBpAccounts: Match = (u, m) => m === 'GET' && u === 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const isBpCreatePost: Match = (u, m) => m === 'POST' && u === `https://mybusiness.googleapis.com/v4/${LOCATION}/localPosts`;
const isCalendarList: Match = (u, m) => m === 'GET' && u.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList?');
const isFormCreate: Match = (u, m) => m === 'POST' && u === 'https://forms.googleapis.com/v1/forms';
const isBpInsights: Match = (u, m) => m === 'GET' && u.startsWith(`https://businessprofileperformance.googleapis.com/v1/${LOCATION}:fetchMultiDailyMetricsTimeSeries?`);

function googleError(code: number, status: string, reasons: string[] = []) {
  return JSON.stringify({ error: { code, message: `upstream ${status}`, status, errors: reasons.map((reason) => ({ reason })) } });
}
function graphError(code: string) {
  return JSON.stringify({ error: { code, message: `graph says ${code}` } });
}
const INVALID_GRANT = JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
const TOKEN_DOWN = JSON.stringify({ error: 'temporarily_unavailable' });

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_sync_audits WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const agent = () => request(app.getHttpServer());
function as<T extends { set: (k: string, v: string) => T }>(req: T, actor = ID.owner): T {
  return req.set(HEADER, actor);
}

const googleContactsSync = (b: string, actor = ID.owner) => as(agent().post(`/connect/businesses/${b}/contacts/sync`), actor).send({});
const outlookSync = (b: string) => as(agent().post(`/connect/businesses/${b}/outlook-contacts/sync`)).send({});
const getForm = (b: string) => as(agent().get(`/connect/businesses/${b}/forms/${P}form`));
const listForms = (b: string) => as(agent().get(`/connect/businesses/${b}/forms`));
const bpAccounts = (b: string) => as(agent().get(`/connect/businesses/${b}/business-profile/accounts`));
const bpCreatePost = (b: string) => as(agent().post(`/connect/businesses/${b}/business-profile/posts`)).send({ location: LOCATION, summary: `${P} post` });
const crmImport = (b: string) => as(agent().post(`/crm/businesses/${b}/google/import`)).send({ accessToken: `${P}import-access` });
const bookingsCalendarList = (b: string) => as(agent().get(`/bookings/businesses/${b}/calendar/list`));
const syncCalendars = (b: string) => as(agent().get(`/calendar/businesses/${b}/sync/calendars`));
const createForm = (b: string) => as(agent().post(`/connect/businesses/${b}/forms`)).send({ title: `${P} form` });
const bpInsights = (b: string) => as(agent().get(`/connect/businesses/${b}/business-profile/insights?location=${encodeURIComponent(LOCATION)}&days=7`));
const bpScheduled = (b: string) => as(agent().get(`/connect/businesses/${b}/business-profile/scheduled-posts`));

/** The structured 503 of an upstream outage, through the production filter. */
function expectUnavailable(res: { status: number; body: any }, service: string, message: string, upstreamStatus: number) {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.body).toMatchObject({
    statusCode: 503,
    code: 'provider_unavailable',
    message,
    details: { service, upstreamStatus },
  });
}

/** The existing refusal: 400 with its message, not provider_unavailable. */
function expectRefused(res: { status: number; body: any }, message: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.code).toBe('BAD_REQUEST');
  expect(res.body.message).toBe(message);
  expect(res.body.details?.service).toBeUndefined();
}

/** A business's stored connection state (fresh read, decrypted by the client). */
async function connectionOf(businessId: string) {
  return db.business.findUnique({
    where: { id: businessId },
    select: {
      contactsAccessToken: true, contactsTokenExpiry: true, contactsSyncToken: true,
      msContactsAccessToken: true, msContactsTokenExpiry: true, msContactsDeltaLink: true,
      formsAccessToken: true, formsTokenExpiry: true,
      calendarAccessToken: true, calendarTokenExpiry: true,
    },
  });
}
const contactCount = (businessId: string) => db.contact.count({ where: { businessId } });

let ipN = 0;
/** A fresh client address per CRM import (CrmRateLimitGuard counts per address). */
const nextIp = () => `10.63.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

beforeAll(async () => {
  for (const [key, value] of Object.entries(OAUTH_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  // Connect
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { GoogleFormsService } = await import('../src/modules/connect/google-forms.service');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { SignatureParserService } = await import('../src/modules/connect/signature-parser.service');
  // CRM
  const { CrmGoogleController } = await import('../src/modules/crm/crm-google.controller');
  const { CrmGoogleService } = await import('../src/modules/crm/crm-google.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  // Bookings and calendar
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
    controllers: [ConnectController, CrmGoogleController, BookingsController, CalendarController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      // The clients under test, real. GoogleFormsService and
      // GoogleBusinessProfileService declare their PrismaService without
      // @Inject, which this transform (no decorator metadata) cannot resolve:
      // built by a factory over the same real PrismaService.
      GoogleContactsSyncService,
      OutlookContactsSyncService,
      { provide: GoogleFormsService, useFactory: (prisma: any) => new GoogleFormsService(prisma), inject: [PrismaService] },
      { provide: GoogleBusinessProfileService, useFactory: (prisma: any) => new GoogleBusinessProfileService(prisma), inject: [PrismaService] },
      CrmGoogleService,
      CalendarService,
      CalendarSyncService,
      // The CRM write door the syncs and the import consult (no case here writes a contact).
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      // ConnectController's other collaborators (routes not used here).
      { provide: GoogleFormsMappingService, useValue: {} },
      { provide: ContactSyncService, useValue: {} },
      { provide: SignatureParserService, useValue: {} },
      { provide: ConnectorFormMappingService, useValue: {} },
      // Present only because the bookings and calendar controllers' other routes declare them; no case here reaches them.
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: BookingsService, useValue: {} },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: BookingOptimizerService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: CalendarProjectionService, useValue: {} },
      { provide: CalendarQueryService, useValue: {} },
      { provide: CalendarConflictService, useValue: {} },
      { provide: CalendarInsightService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: GoogleCalendarTemporalSyncService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // CrmRateLimitGuard counts per client address: each import names its own.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
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
  // The global interceptor that binds the request's member and verified tenant (app.module.ts).
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  for (const [businessId, expiry] of [[ID.bizLive, LIVE_EXPIRY()], [ID.bizExpired, PAST_EXPIRY]] as const) {
    const t = (name: string) => `${businessId}-${name}`;
    await db.business.create({
      data: {
        id: businessId,
        name: `V63Y ${businessId.slice(P.length)}`,
        ownerId: ID.owner,
        currency: 'TTD',
        contactsAccessToken: t('contacts-access'), contactsRefreshToken: t('contacts-refresh'), contactsTokenExpiry: expiry, contactsSyncToken: SYNC_TOKEN,
        msContactsAccessToken: t('ms-access'), msContactsRefreshToken: t('ms-refresh'), msContactsTokenExpiry: expiry, msContactsDeltaLink: DELTA_LINK,
        formsAccessToken: t('forms-access'), formsRefreshToken: t('forms-refresh'), formsTokenExpiry: expiry,
        driveAccessToken: t('drive-access'), driveRefreshToken: t('drive-refresh'), driveTokenExpiry: expiry,
        bpAccessToken: t('bp-access'), bpRefreshToken: t('bp-refresh'), bpTokenExpiry: expiry, bpAccountId: 'v63yacct',
        calendarEmail: `${businessId}@test.local`, calendarAccessToken: t('calendar-access'), calendarRefreshToken: t('calendar-refresh'), calendarTokenExpiry: expiry,
      },
    });
    // Owner ruling D-104: a Membership is the one access rule; D-99: a Google Contacts sync is the owner's.
    await db.membership.create({ data: { id: `${P}m_owner_${businessId}`, userId: ID.owner, businessId, role: 'OWNER' } });
  }
  await db.membership.create({ data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.bizLive, role: 'STAFF', permissionScopes: { crm: 'write' } } });

  // The providers, in process: each case sets `providers`; anything no rule
  // answers is recorded and refused, so a case that reached anything else
  // fails rather than calling out.
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    const rule = providers.find((r) => r.when(url, method));
    if (rule) {
      answered.push({ url, method, status: rule.status });
      return new Response(rule.body, { status: rule.status, headers: { 'content-type': 'application/json' } });
    }
    outbound.push(`${method} ${url}`);
    throw new Error(`v63y: outbound traffic is refused in this suite (${method} ${url})`);
  }) as typeof fetch;
}, 180_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (app) await app.close();
  if (db) await cleanup();
  for (const key of Object.keys(OAUTH_ENV)) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

beforeEach(() => {
  providers = [];
  answered.length = 0;
});

describe('W11-PROVIDER-OUTAGE-CONNECT: a provider outage answers 503 provider_unavailable over HTTP; a refusal stays 400', () => {
  it('[V63Y-00] fixture sanity: the owner holds OWNER on both businesses, every connection is stored, bizExpired\'s tokens are expired and bizLive\'s live', async () => {
    expect(await db.membership.count({ where: { userId: ID.owner, role: 'OWNER', businessId: { in: [ID.bizLive, ID.bizExpired] } } })).toBe(2);
    const live = await connectionOf(ID.bizLive);
    const expired = await connectionOf(ID.bizExpired);
    expect(live).toMatchObject({ contactsSyncToken: SYNC_TOKEN, msContactsDeltaLink: DELTA_LINK, contactsAccessToken: `${ID.bizLive}-contacts-access` });
    expect(live.contactsTokenExpiry.getTime()).toBeGreaterThan(Date.now());
    for (const key of ['contactsTokenExpiry', 'msContactsTokenExpiry', 'formsTokenExpiry', 'calendarTokenExpiry']) {
      expect(expired[key].getTime()).toBeLessThan(Date.now());
    }
  });

  // ---- Google Contacts sync (People API) ----

  it.each([
    [503, googleError(503, 'UNAVAILABLE', ['backendError'])],
    [429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
  ] as Array<[number, string]>)('[V63Y-01] RED-BEFORE: a Google Contacts sync whose People list answers %i answers 503 {service: google_contacts, message: "People API error <status>"}; the sync token stays and no contact is written', async (status, body) => {
    providers = [{ when: isPeopleList, status, body }];

    expectUnavailable(await googleContactsSync(ID.bizLive), 'google_contacts', `People API error ${status}`, status);
    expect((await connectionOf(ID.bizLive)).contactsSyncToken).toBe(SYNC_TOKEN);
    expect(await contactCount(ID.bizLive)).toBe(0);
    expect(answered.map((a) => [a.method, new URL(a.url).pathname])).toEqual([['GET', '/v1/people/me/connections']]);
  });

  it('[V63Y-02] control: a Google Contacts sync whose People list answers 400 keeps the existing 400 "People API error 400"', async () => {
    providers = [{ when: isPeopleList, status: 400, body: googleError(400, 'INVALID_ARGUMENT', ['invalidArgument']) }];

    expectRefused(await googleContactsSync(ID.bizLive), 'People API error 400');
    expect((await connectionOf(ID.bizLive)).contactsSyncToken).toBe(SYNC_TOKEN);
  });

  it('[V63Y-03] RED-BEFORE: People 410 (sync token expired) clears the stored sync token and answers 503 "Sync token expired; please retry" (upstreamStatus 410); the retry does a full sync without a token', async () => {
    providers = [{ when: isPeopleList, status: 410, body: googleError(410, 'FAILED_PRECONDITION', ['expiredSyncToken']) }];

    try {
      const res = await googleContactsSync(ID.bizLive);

      expect(new URL(answered[0].url).searchParams.get('syncToken')).toBe(SYNC_TOKEN);
      expect((await connectionOf(ID.bizLive)).contactsSyncToken).toBeNull();
      expectUnavailable(res, 'google_contacts', 'Sync token expired; please retry', 410);

      // The retry the message asks for: a full sync (no syncToken), which succeeds and stores the new token.
      providers = [{ when: isPeopleList, status: 200, body: JSON.stringify({ connections: [], nextSyncToken: `${P}people-sync-token-2` }) }];
      answered.length = 0;
      const retry = await googleContactsSync(ID.bizLive);
      expect(retry.status, JSON.stringify(retry.body)).toBe(201);
      expect(new URL(answered[0].url).searchParams.has('syncToken')).toBe(false);
      expect((await connectionOf(ID.bizLive)).contactsSyncToken).toBe(`${P}people-sync-token-2`);
    } finally {
      await db.business.update({ where: { id: ID.bizLive }, data: { contactsSyncToken: SYNC_TOKEN } });
    }
  });

  it('[V63Y-04] D-99 control: a STAFF member starting the Google Contacts sync is refused 403 GOOGLE_CONNECT_OWNER_ONLY before People is called (unchanged)', async () => {
    providers = [{ when: isPeopleList, status: 503, body: googleError(503, 'UNAVAILABLE') }];

    const res = await googleContactsSync(ID.bizLive, ID.staff);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain('GOOGLE_CONNECT_OWNER_ONLY');
    expect(answered).toEqual([]);
  });

  it.each([
    [503, TOKEN_DOWN],
    [429, ''],
  ] as Array<[number, string]>)('[V63Y-05] RED-BEFORE: an expired Google Contacts connection whose token endpoint answers %i answers 503 {service: google_contacts} with the existing message; no token is stored and People is not called', async (status, body) => {
    providers = [{ when: isGoogleToken, status, body }];
    const before = await connectionOf(ID.bizExpired);

    // FU-PROVIDER-ERROR-HYGIENE (D-221): the message, never the token endpoint's body.
    expectUnavailable(await googleContactsSync(ID.bizExpired), 'google_contacts', 'Failed to refresh Google Contacts token', status);
    const after = await connectionOf(ID.bizExpired);
    expect(after.contactsAccessToken).toBe(before.contactsAccessToken);
    expect(after.contactsTokenExpiry.getTime()).toBe(before.contactsTokenExpiry.getTime());
    expect(answered.map((a) => a.url)).toEqual(['https://oauth2.googleapis.com/token']);
  });

  it('[V63Y-06] control: an expired Google Contacts connection whose refresh answers 400 invalid_grant (reconnect) keeps the existing 400', async () => {
    providers = [{ when: isGoogleToken, status: 400, body: INVALID_GRANT }];

    expectRefused(await googleContactsSync(ID.bizExpired), 'Failed to refresh Google Contacts token');
    expect((await connectionOf(ID.bizExpired)).contactsAccessToken).toBe(`${ID.bizExpired}-contacts-access`);
  });

  // ---- Outlook Contacts sync (Microsoft Graph) ----

  it.each([
    [503, graphError('serviceNotAvailable')],
    [429, graphError('TooManyRequests')],
  ] as Array<[number, string]>)('[V63Y-07] RED-BEFORE: an Outlook Contacts sync whose Graph delta answers %i answers 503 {service: outlook_contacts} with the existing "Graph API error" message; the delta link stays', async (status, body) => {
    providers = [{ when: isGraphDelta, status, body }];

    // FU-PROVIDER-ERROR-HYGIENE (D-221): the status, never Graph's body.
    expectUnavailable(await outlookSync(ID.bizLive), 'outlook_contacts', `Graph API error ${status}`, status);
    expect((await connectionOf(ID.bizLive)).msContactsDeltaLink).toBe(DELTA_LINK);
    expect(answered.map((a) => a.url)).toEqual([DELTA_LINK]);
    expect(await contactCount(ID.bizLive)).toBe(0);
  });

  it.each([
    [404, graphError('ErrorItemNotFound')],
    [409, graphError('ErrorIrresolvableConflict')],
  ] as Array<[number, string]>)('[V63Y-08] control: an Outlook Contacts sync whose Graph delta answers %i keeps the existing 400 and the delta link', async (status, body) => {
    providers = [{ when: isGraphDelta, status, body }];

    expectRefused(await outlookSync(ID.bizLive), `Graph API error ${status}`);
    expect((await connectionOf(ID.bizLive)).msContactsDeltaLink).toBe(DELTA_LINK);
  });

  it('[V63Y-09] RED-BEFORE: Graph 410 (delta token expired) clears the stored delta link and answers 503 "Outlook delta token expired; please retry" (upstreamStatus 410)', async () => {
    providers = [{ when: isGraphDelta, status: 410, body: graphError('SyncStateNotFound') }];

    try {
      const res = await outlookSync(ID.bizLive);

      expect(answered.map((a) => a.url)).toEqual([DELTA_LINK]);
      expect((await connectionOf(ID.bizLive)).msContactsDeltaLink).toBeNull();
      expectUnavailable(res, 'outlook_contacts', 'Outlook delta token expired; please retry', 410);
    } finally {
      await db.business.update({ where: { id: ID.bizLive }, data: { msContactsDeltaLink: DELTA_LINK } });
    }
  });

  it('[V63Y-10] RED-BEFORE: an expired Outlook Contacts connection whose Microsoft token endpoint answers 503 answers 503 {service: microsoft}; a 400 invalid_grant keeps the existing 400; no token is stored', async () => {
    providers = [{ when: isMicrosoftToken, status: 503, body: TOKEN_DOWN }];
    expectUnavailable(await outlookSync(ID.bizExpired), 'microsoft', 'Failed to refresh Outlook Contacts token', 503);

    providers = [{ when: isMicrosoftToken, status: 400, body: INVALID_GRANT }];
    expectRefused(await outlookSync(ID.bizExpired), 'Failed to refresh Outlook Contacts token');

    const after = await connectionOf(ID.bizExpired);
    expect(after.msContactsAccessToken).toBe(`${ID.bizExpired}-ms-access`);
    expect(after.msContactsTokenExpiry.getTime()).toBe(PAST_EXPIRY.getTime());
    expect(answered.map((a) => a.url)).toEqual(['https://login.microsoftonline.com/common/oauth2/v2.0/token', 'https://login.microsoftonline.com/common/oauth2/v2.0/token']);
  });

  // ---- Google Forms ----

  it('[V63Y-11] RED-BEFORE: GET forms/:formId whose Forms API answers 503 answers 503 {service: google_forms, message: "Forms API error 503"}; a 404 keeps the existing 400', async () => {
    providers = [{ when: isFormGet, status: 503, body: googleError(503, 'UNAVAILABLE') }];
    expectUnavailable(await getForm(ID.bizLive), 'google_forms', 'Forms API error 503', 503);

    providers = [{ when: isFormGet, status: 404, body: googleError(404, 'NOT_FOUND') }];
    expectRefused(await getForm(ID.bizLive), 'Forms API error 404');
  });

  it('[V63Y-12] RED-BEFORE: GET forms (the Drive list of forms) answering 429 answers 503 {service: google_forms, message: "Drive API error 429"}', async () => {
    providers = [{ when: isDriveFormsList, status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED', ['userRateLimitExceeded']) }];

    expectUnavailable(await listForms(ID.bizLive), 'google_forms', 'Drive API error 429', 429);
  });

  it('[V63Y-13] RED-BEFORE: an expired Google Forms connection whose token endpoint answers 503 answers 503 {service: google_forms}; no token is stored', async () => {
    providers = [{ when: isGoogleToken, status: 503, body: TOKEN_DOWN }];

    expectUnavailable(await getForm(ID.bizExpired), 'google_forms', 'Failed to refresh Google Forms token', 503);
    expect((await connectionOf(ID.bizExpired)).formsAccessToken).toBe(`${ID.bizExpired}-forms-access`);
  });

  // ---- Google Business Profile ----

  it('[V63Y-14] RED-BEFORE: GET business-profile/accounts answering 503 answers 503 {service: google_business_profile, message: "Business Profile API error 503"}; a 400 keeps the existing 400', async () => {
    providers = [{ when: isBpAccounts, status: 503, body: googleError(503, 'UNAVAILABLE') }];
    expectUnavailable(await bpAccounts(ID.bizLive), 'google_business_profile', 'Business Profile API error 503', 503);

    providers = [{ when: isBpAccounts, status: 400, body: googleError(400, 'INVALID_ARGUMENT') }];
    expectRefused(await bpAccounts(ID.bizLive), 'Business Profile API error 400');
  });

  it('[V63Y-15] RED-BEFORE: POST business-profile/posts answering 429 answers 503 {service: google_business_profile}', async () => {
    providers = [{ when: isBpCreatePost, status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED') }];

    expectUnavailable(await bpCreatePost(ID.bizLive), 'google_business_profile', 'Business Profile API error 429', 429);
  });

  // ---- CRM Google import ----

  it('[V63Y-16] RED-BEFORE: POST crm google/import whose People list answers 503 answers 503 {service: google_contacts, message: "Failed to fetch Google contacts"}; a 400 keeps the existing 400; no contact is created', async () => {
    providers = [{ when: isPeopleList, status: 503, body: googleError(503, 'UNAVAILABLE') }];
    expectUnavailable(await crmImport(ID.bizLive).set('x-forwarded-for', nextIp()), 'google_contacts', 'Failed to fetch Google contacts', 503);

    providers = [{ when: isPeopleList, status: 400, body: googleError(400, 'INVALID_ARGUMENT') }];
    expectRefused(await crmImport(ID.bizLive).set('x-forwarded-for', nextIp()), 'Failed to fetch Google contacts');

    expect(await contactCount(ID.bizLive)).toBe(0);
    for (const a of answered) expect(new URL(a.url).pathname).toBe('/v1/people/me/connections');
  });

  // ---- Google Calendar list ----

  it('[V63Y-17] RED-BEFORE: GET bookings calendar/list whose calendarList answers 503 answers 503 {service: google_calendar, message: "Could not load Google calendars"}; a 404 keeps the existing 400', async () => {
    providers = [{ when: isCalendarList, status: 503, body: googleError(503, 'UNAVAILABLE') }];
    expectUnavailable(await bookingsCalendarList(ID.bizLive), 'google_calendar', 'Could not load Google calendars', 503);

    providers = [{ when: isCalendarList, status: 404, body: googleError(404, 'NOT_FOUND') }];
    expectRefused(await bookingsCalendarList(ID.bizLive), 'Could not load Google calendars');
  });

  it('[V63Y-18] RED-BEFORE: GET calendar sync/calendars (the platform twin) whose calendarList answers 429 answers 503 {service: google_calendar}', async () => {
    providers = [{ when: isCalendarList, status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded']) }];

    expectUnavailable(await syncCalendars(ID.bizLive), 'google_calendar', 'Could not load Google calendars', 429);
  });

  it('[V63Y-19] RED-BEFORE: an expired Calendar connection whose token endpoint answers 503 answers 503 {service: google_calendar, message: "Failed to refresh Google Calendar token"}; a 400 invalid_grant keeps the existing 400; no token is stored', async () => {
    providers = [{ when: isGoogleToken, status: 503, body: TOKEN_DOWN }];
    expectUnavailable(await bookingsCalendarList(ID.bizExpired), 'google_calendar', 'Failed to refresh Google Calendar token', 503);

    providers = [{ when: isGoogleToken, status: 400, body: INVALID_GRANT }];
    expectRefused(await bookingsCalendarList(ID.bizExpired), 'Failed to refresh Google Calendar token');

    const after = await connectionOf(ID.bizExpired);
    expect(after.calendarAccessToken).toBe(`${ID.bizExpired}-calendar-access`);
    expect(after.calendarTokenExpiry.getTime()).toBe(PAST_EXPIRY.getTime());
  });

  // ---- FU-PROVIDER-ERROR-HYGIENE (D-221) ----

  it('[V63Y-21] RED-BEFORE: GET business-profile/insights whose Performance API answers 503 or 429 answers 503 {service: google_business_profile, message: "Performance API <status>"}; a 404 and a 403 insufficientPermissions keep a 400 "Performance API <status>"; a 200 still totals the metrics', async () => {
    for (const [status, body] of [
      [503, googleError(503, 'UNAVAILABLE', ['backendError'])],
      [429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
    ] as Array<[number, string]>) {
      providers = [{ when: isBpInsights, status, body }];
      expectUnavailable(await bpInsights(ID.bizLive), 'google_business_profile', `Performance API ${status}`, status);
    }
    for (const [status, body] of [
      [404, googleError(404, 'NOT_FOUND', ['notFound'])],
      [403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions'])],
    ] as Array<[number, string]>) {
      providers = [{ when: isBpInsights, status, body }];
      expectRefused(await bpInsights(ID.bizLive), `Performance API ${status}`);
    }

    providers = [{
      when: isBpInsights,
      status: 200,
      body: JSON.stringify({
        multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{
          dailyMetric: 'CALL_CLICKS',
          timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: '3' }, { date: { year: 2026, month: 11, day: 2 }, value: '4' }] },
        }] }],
      }),
    }];
    const ok = await bpInsights(ID.bizLive);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ locationName: LOCATION, rangeDays: 7, metrics: [{ metric: 'CALL_CLICKS', total: 7 }] });
    for (const a of answered) expect(isBpInsights(a.url, a.method), a.url).toBe(true);
  });

  it('[V63Y-22] RED-BEFORE: POST forms (Forms create) whose Forms API answers 503 answers 503 {service: google_forms, message: "Forms API error 503"}; a 400 keeps a 400 "Forms API error 400"', async () => {
    providers = [{ when: isFormCreate, status: 503, body: googleError(503, 'UNAVAILABLE', ['backendError']) }];
    expectUnavailable(await createForm(ID.bizLive), 'google_forms', 'Forms API error 503', 503);

    providers = [{ when: isFormCreate, status: 400, body: googleError(400, 'INVALID_ARGUMENT', ['invalidArgument']) }];
    expectRefused(await createForm(ID.bizLive), 'Forms API error 400');
    expect(answered.map((a) => [a.method, a.url])).toEqual([['POST', 'https://forms.googleapis.com/v1/forms'], ['POST', 'https://forms.googleapis.com/v1/forms']]);
  });

  it('[V63Y-23] RED-BEFORE: the provider body is never in the answer: the Google and Microsoft token refreshes, the Graph delta, Forms create and the insights read, for an outage and a refusal; no token is stored and the delta link stays', async () => {
    const CANARY = `${P}canary-upstream-body`;
    const google = (code: number, status: string, reason: string) =>
      JSON.stringify({ error: { code, message: `${CANARY} ${status}`, status, errors: [{ reason, message: CANARY }] } });
    const cases: Array<[string, () => Promise<{ status: number; body: any }>, Match, number, string, number]> = [
      ['Google refresh, outage', () => googleContactsSync(ID.bizExpired), isGoogleToken, 503, JSON.stringify({ error: 'temporarily_unavailable', error_description: CANARY }), 503],
      ['Google refresh, refusal', () => googleContactsSync(ID.bizExpired), isGoogleToken, 400, JSON.stringify({ error: 'invalid_grant', error_description: CANARY }), 400],
      ['Microsoft refresh, outage', () => outlookSync(ID.bizExpired), isMicrosoftToken, 503, JSON.stringify({ error: 'temporarily_unavailable', error_description: CANARY }), 503],
      ['Microsoft refresh, refusal', () => outlookSync(ID.bizExpired), isMicrosoftToken, 400, JSON.stringify({ error: 'invalid_grant', error_description: CANARY }), 400],
      ['Graph delta, outage', () => outlookSync(ID.bizLive), isGraphDelta, 503, JSON.stringify({ error: { code: 'serviceNotAvailable', message: CANARY } }), 503],
      ['Graph delta, refusal', () => outlookSync(ID.bizLive), isGraphDelta, 404, JSON.stringify({ error: { code: 'ErrorItemNotFound', message: CANARY } }), 400],
      ['Forms create, outage', () => createForm(ID.bizLive), isFormCreate, 503, google(503, 'UNAVAILABLE', 'backendError'), 503],
      ['Forms create, refusal', () => createForm(ID.bizLive), isFormCreate, 400, google(400, 'INVALID_ARGUMENT', 'invalidArgument'), 400],
      ['insights, outage', () => bpInsights(ID.bizLive), isBpInsights, 503, google(503, 'UNAVAILABLE', 'backendError'), 503],
      ['insights, refusal', () => bpInsights(ID.bizLive), isBpInsights, 404, google(404, 'NOT_FOUND', 'notFound'), 400],
    ];
    const before = await connectionOf(ID.bizExpired);
    for (const [label, call, when, status, body, expected] of cases) {
      providers = [{ when, status, body }];
      const res = await call();
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(expected);
      expect(JSON.stringify(res.body), label).not.toContain(CANARY);
    }
    const after = await connectionOf(ID.bizExpired);
    expect(after.contactsAccessToken).toBe(before.contactsAccessToken);
    expect(after.msContactsAccessToken).toBe(before.msContactsAccessToken);
    expect((await connectionOf(ID.bizLive)).msContactsDeltaLink).toBe(DELTA_LINK);
  });

  it('[V63Y-24] RED-BEFORE: a scheduled Business Profile post that falls due on a connection whose token refresh is refused is listed failed with the bare refresh message; the provider body is in neither the answer nor the stored row', async () => {
    const CANARY = `${P}canary-scheduled-body`;
    const due = { id: `${P}sched_1`, location: LOCATION, summary: `${P} due post`, scheduledFor: new Date(Date.now() - 60_000).toISOString(), status: 'scheduled', createdAt: new Date().toISOString() };
    await db.connectorStatus.create({ data: { id: `${P}cs_bp_exp`, businessId: ID.bizExpired, connectorType: 'google_business_profile', status: 'connected', metadata: { scheduledPosts: [due] } } });
    try {
      providers = [{ when: isGoogleToken, status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: CANARY }) }];

      const res = await bpScheduled(ID.bizExpired);

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ id: due.id, status: 'failed', error: 'Failed to refresh Google Business Profile token' })]);
      expect(JSON.stringify(res.body)).not.toContain(CANARY);
      const row = await db.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId: ID.bizExpired, connectorType: 'google_business_profile' } },
        select: { metadata: true },
      });
      expect(row.metadata.scheduledPosts).toEqual([expect.objectContaining({ id: due.id, status: 'failed', error: 'Failed to refresh Google Business Profile token' })]);
      expect(JSON.stringify(row.metadata)).not.toContain(CANARY);
      // The refresh was asked once and refused: nothing was posted and no token stored.
      expect(answered.map((a) => a.url)).toEqual(['https://oauth2.googleapis.com/token']);
      expect((await db.business.findUnique({ where: { id: ID.bizExpired }, select: { bpTokenExpiry: true } })).bpTokenExpiry.getTime()).toBe(PAST_EXPIRY.getTime());
    } finally {
      await db.connectorStatus.deleteMany({ where: { businessId: ID.bizExpired, connectorType: 'google_business_profile' } });
    }
  });

  it('[V63Y-20] no provider was called for real: every request this suite made was answered in process', () => {
    expect(outbound).toEqual([]);
  });
});
