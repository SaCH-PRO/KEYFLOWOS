/**
 * W8-GOOGLE-CONSENT-OWNER (REAL database; owner ruling D-99): every Google
 * connection for a business (Calendar, Drive, Contacts, Gmail, Analytics,
 * Search Console) is started, synced and disconnected only by the business
 * owner. The rule has the Gmail rule's shape (GmailService.assertConnectAuthority,
 * D-11): an OWNER membership of the route's own business, or that business's
 * distinguished owner (Business.ownerId, holding a Membership there since owner
 * ruling D-104), with the SUPER_ADMIN bypass
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
 * doors, and (W8-GOOGLE-CONSENT-OWNER review repairs) the platform calendar
 * sync doors POST /calendar/businesses/:b/sync/google/connect, .../disconnect
 * and .../resync (SEC-W8GCO-2, [V94D-D01]..[V94D-D02]) and the OAuth states
 * the Drive and calendar callbacks complete (SEC-W8GCO-1, [V94D-E01]..
 * [V94D-E03]): before the repair GoogleDriveService.verifyState and
 * CalendarService.verifyState accepted any GOOGLE_STATE_SECRET-signed state
 * naming a business, so a member refused the Drive consent URL could land a
 * calendar state (from the ungated sync connect) or a Microsoft Outlook state
 * (signed with GOOGLE_STATE_SECRET while MICROSOFT_STATE_SECRET is unset) at
 * GET /drive/callback, or at either calendar callback, and connect their own
 * Google account as the business's. The Google Suite consent (POST /connect/google-suite/businesses/:b/
 * auth-url) is covered by connect-recent-visibility.integration.test.ts
 * ([V93E-B01]) and gmail-connect-binding.integration.test.ts ([R0-CMF5-H01]);
 * the CRM Google contact import consent (GET /crm/businesses/:b/google/auth-url)
 * and its callback by contacts-import-write-scope.integration.test.ts
 * ([V94D-C01]..[V94D-C03]). The Google doors outside this packet's write set
 * are it.todo at the end of this file ([V94D-T02]..[V94D-T04]); [V94D-T04]
 * (the web) is now a pointer comment to the web suite of W9-GOOGLE-WEB-403.
 *
 * W9-GOOGLE-DOORS-SERVER (owner ruling D-99) turns two of them live: [V94D-T02]
 * the generic connector doors POST /connectors/businesses/:b/sync/:type,
 * .../disconnect/:type and .../reconnect/:type for the connections the Google
 * Suite consent provisions (google_calendar, google_drive, google_contacts,
 * google_forms, google_business_profile; gmail keeps GMAIL_OWNER_ONLY), with
 * controls [V94D-F01]..[V94D-F02]; and [V94D-T03] the contact-source doors
 * POST /connect/businesses/:b/contact-sources/google_contacts/resync, DELETE
 * .../contact-sources/google_contacts and POST .../contact-sources/sync-all
 * (refused to a non-owner only while Google Contacts is connected, the source
 * it would sync), with controls [V94D-G01]..[V94D-G02]. POST
 * .../contacts/sync stays it.todo ([V94D-T05]): connect-sync-actor.integration.
 * test.ts (outside the write set) pins STAFF-started Google Contacts syncs.
 *
 * W9-GOOGLE-DOORS-SERVER review repairs (D-99): DELETE /connectors/businesses/
 * :b/credentials/:type for the same Google Suite connections ([V94D-H01],
 * control [V94D-H02]; SEC-W9GD-1): it marks the connector row disconnected,
 * which takes the connection out of the nightly and background sync while its
 * Google tokens stay. Three Google sync doors outside the write set stay open
 * to every member and are it.todo: POST .../contacts/sync ([V94D-T05];
 * SEC-W9GD-2), POST /drive/businesses/:b/sync with the KEY tool
 * connect.scanDrive ([V94D-T06]; CRR-W9GD-1) and POST /calendar/businesses/:b/
 * sync/google/temporal-flow ([V94D-T07]; SEC-W9GD-3).
 *
 * W10-GOOGLE-DOORS-REST (owner ruling D-99) turns those three live: [V94D-T05]
 * POST /connect/businesses/:b/contacts/sync (control [V94D-J01]; the five
 * STAFF-started Google Contacts cases of connect-sync-actor.integration.test.ts
 * are re-pointed at the owner, or at the Outlook source, in the same change),
 * [V94D-T06] POST /drive/businesses/:b/sync (DriveIntakeController.sync) and the
 * KEY tool connect.scanDrive (KeyToolRegistryService: the driving member must be
 * the owner, else a refusal envelope and nothing run; control [V94D-J02]), and
 * [V94D-T07] POST /calendar/businesses/:b/sync/google/temporal-flow (control
 * [V94D-J03]). Its review repair (SEC-W10GDR-1; D-99, D-111) gates the Google
 * Calendar sync settings writes, PATCH /calendar/businesses/:b/sync/settings
 * and its twin PATCH /bookings/businesses/:b/calendar/settings ([V94D-T08],
 * control [V94D-J04]; the reads stay a member's). For these cases the
 * Drive pull (ConnectorIntelligenceService.syncGoogleDrive) and the calendar
 * pull (GoogleCalendarTemporalSyncService.syncBusiness) are recording
 * stand-ins, the KEY tool registry is the real KeyToolRegistryService with
 * stand-ins for the services no case here reaches, and DriveIntakeController is
 * mounted as the commerce module mounts it.
 *
 * For these cases the connector registry behind ConnectorController is a
 * stand-in recording what reaches it, its credential store is the real
 * ConnectorCredentialsService, the Google Contacts sync is the real
 * GoogleContactsSyncService with its provider run (sync) replaced by a
 * recording stand-in (its disconnect is real), ContactSyncService.syncAll is
 * real, and the Outlook Contacts sync is a recording stand-in.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business and membership rows, AuthGuard, BusinessGuard,
 * BookingsController, GoogleDriveController, CalendarController,
 * MicrosoftOAuthController, CalendarService (getAuthUrl, verifyState,
 * saveCalendarCredentials, getCalendarStatus, disconnectCalendar),
 * CalendarSyncService (getAuthUrl, verifyState, completeOAuth, disconnect,
 * manualResync), GoogleDriveService (getAuthUrl, verifyState,
 * saveDriveCredentials, getConnectionStatus, disconnect) and
 * MicrosoftOAuthService (buildAuthUrl) are real against DATABASE_URL, with an
 * obviously fake OAuth client id and state secret. The stand-ins: identity
 * attachment (a test middleware reads `x-test-user`, loads that seeded user row
 * and attaches `{ id, email, role }` as AuthMiddleware would after Supabase
 * token verification), the controllers' collaborators no case here reaches,
 * and the provider: global fetch answers Google's token exchange and userinfo
 * with an obviously fake account and refuses anything else, so no provider is
 * called.
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
  otherOwner: `${P}otherowner`, // Business.ownerId of bizOther with its OWNER membership (D-104); STAFF of biz
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
  // SEC-W8GCO-1: the Microsoft Outlook door, configured as .env.example leaves it
  // (MICROSOFT_STATE_SECRET empty, so its state is signed with GOOGLE_STATE_SECRET).
  MICROSOFT_CLIENT_ID: `${P}fake-ms-client-id`,
  MICROSOFT_REDIRECT_URI: 'http://localhost:3000/api/connect/microsoft/callback',
};
const OAUTH_KEYS = [...Object.keys(OAUTH_ENV), 'CALENDAR_REDIRECT_URI', 'MICROSOFT_STATE_SECRET'];
const savedEnv: Record<string, string | undefined> = {};

/**
 * The Google account the provider stand-in answers for any code (obviously
 * fake): what a callback stores when it completes a state.
 */
const PROVIDER_ACCOUNT = {
  email: `${P}provider-account@test.local`,
  access: `${P}fake-provider-access-not-real`,
  refresh: `${P}fake-provider-refresh-not-real`,
};
const realFetch = globalThis.fetch;

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

/**
 * W9-GOOGLE-DOORS-SERVER: the connector registry behind ConnectorController, a
 * stand-in recording each call that reaches it (a refused door never does).
 */
const connectorRegistry = {
  syncConnector: vi.fn(async (_type: string, _businessId: string) => ({ success: true, itemsSynced: 0, errors: [] as string[], duration: 0 })),
  disconnectConnector: vi.fn(async (_type: string, _businessId: string) => undefined),
  reconnectConnector: vi.fn(async (_type: string, _businessId: string) => ({ connected: false })),
  testConnector: vi.fn(async (_type: string, _businessId: string) => ({ success: true })),
  // W9-GOOGLE-DOORS-SERVER review repair SEC-W9GD-1: DELETE credentials/:type looks the connector up first.
  get: vi.fn((type: string) => ({ meta: { type, name: type } })),
};

/** W9-GOOGLE-DOORS-SERVER: the Outlook Contacts sync (Microsoft, outside D-99), a recording stand-in. */
const outlookContacts = {
  sync: vi.fn(async (_businessId: string) => ({ imported: 0, updated: 0, deleted: 0, skipped: 0 })),
  disconnect: vi.fn(async (_businessId: string) => undefined),
};

/** W9-GOOGLE-DOORS-SERVER: the provider run of the real GoogleContactsSyncService (spied in beforeAll). */
let googleContactsSync: any;

/**
 * W10-GOOGLE-DOORS-REST (D-99, [V94D-T06]): the Google Drive API pull behind
 * POST /drive/businesses/:b/sync and the KEY tool connect.scanDrive, a recording
 * stand-in (a refused door or tool never reaches it).
 */
const driveIntelligence = {
  syncGoogleDrive: vi.fn(async (_businessId: string) => ({ scanned: 0, newFiles: 0 })),
};
/**
 * W10-GOOGLE-DOORS-REST (D-99, [V94D-T07]): the Google Calendar pull behind
 * POST /calendar/businesses/:b/sync/google/temporal-flow, a recording stand-in.
 */
const temporalSync = {
  syncBusiness: vi.fn(async (_businessId: string) => ({ synced: 0, skipped: 0 })),
};
/** W10-GOOGLE-DOORS-REST: the KEY tool registry's audit log, a recording stand-in. */
const keyToolAudit = { logToolExecution: vi.fn(async () => 'v94d_audit') };
/** W10-GOOGLE-DOORS-REST: the real KeyToolRegistryService (resolved in beforeAll). */
let keyTools: any;

let db: any;
let app: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/**
 * W9-GOOGLE-DOORS-SERVER: write a stored Google Contacts connection (and, with
 * `outlook`, an Outlook Contacts one) onto `businessId`, raw SQL, obviously fake
 * tokens. `google: false` leaves Google Contacts not connected.
 */
async function connectContacts(businessId: string, { google = true, outlook = true }: { google?: boolean; outlook?: boolean } = {}) {
  await db.$executeRawUnsafe(
    `UPDATE businesses SET contacts_email = $2, contacts_access_token = $3, contacts_refresh_token = $4,
       contacts_token_expiry = CASE WHEN $3::text IS NULL THEN NULL ELSE now() + interval '1 hour' END, contacts_sync_token = $5,
       ms_contacts_access_token = $6
     WHERE id = $1`,
    businessId,
    google ? `${businessId}-contacts@test.local` : null,
    google ? `${businessId}-fake-contacts-access-not-real` : null,
    google ? `${businessId}-fake-contacts-refresh-not-real` : null,
    google ? `${businessId}-fake-contacts-sync-token` : null,
    outlook ? `${businessId}-fake-ms-contacts-access-not-real` : null,
  );
}

/** The stored Google Contacts connection of `businessId`, as stored. */
async function storedContacts(businessId: string) {
  const rows: Array<Record<string, unknown>> = await db.$queryRawUnsafe(
    `SELECT contacts_email, contacts_access_token, contacts_refresh_token, contacts_token_expiry IS NOT NULL AS contacts_expiry, contacts_sync_token
     FROM businesses WHERE id = $1`,
    businessId,
  );
  return rows[0];
}

function contactsConnectedRow(businessId: string) {
  return {
    contacts_email: `${businessId}-contacts@test.local`,
    contacts_access_token: `${businessId}-fake-contacts-access-not-real`,
    contacts_refresh_token: `${businessId}-fake-contacts-refresh-not-real`,
    contacts_expiry: true,
    contacts_sync_token: `${businessId}-fake-contacts-sync-token`,
  };
}

beforeAll(async () => {
  for (const key of OAUTH_KEYS) savedEnv[key] = process.env[key];
  delete process.env.CALENDAR_REDIRECT_URI;
  delete process.env.MICROSOFT_STATE_SECRET;
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
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CalendarController } = await import('../src/modules/calendar/calendar.controller');
  const { CalendarSyncService } = await import('../src/modules/calendar/calendar-sync.service');
  const { CalendarProjectionService } = await import('../src/modules/calendar/calendar-projection.service');
  const { CalendarQueryService } = await import('../src/modules/calendar/calendar-query.service');
  const { CalendarConflictService } = await import('../src/modules/calendar/calendar-conflict.service');
  const { CalendarInsightService } = await import('../src/modules/calendar/calendar-insight.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { GoogleCalendarTemporalSyncService } = await import('../src/modules/calendar/connectors/google-calendar-temporal-sync.service');
  const { MicrosoftOAuthController } = await import('../src/modules/connect/microsoft-oauth.controller');
  const { MicrosoftOAuthService } = await import('../src/modules/connect/microsoft-oauth.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  // W9-GOOGLE-DOORS-SERVER: the generic connector doors and the contact-source doors.
  const { ConnectorController } = await import('../src/core/connectors/connector.controller');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorHealthMonitorService } = await import('../src/core/connectors/connector-health-monitor.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { GoogleFormsService } = await import('../src/modules/connect/google-forms.service');
  const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { SignatureParserService } = await import('../src/modules/connect/signature-parser.service');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  // W10-GOOGLE-DOORS-REST: the Drive intake sync door and the KEY tool registry.
  const { DriveIntakeController } = await import('../src/modules/commerce/drive-intake.controller');
  const { DriveIntakeOrchestrator } = await import('../src/modules/commerce/drive-intake-orchestrator.service');
  const { ConnectorIntelligenceService } = await import('../src/modules/ai/connector-intelligence.service');
  const { KeyToolRegistryService } = await import('../src/modules/ai/key-tool-registry.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { CashflowForecastService } = await import('../src/modules/finance/cashflow-forecast.service');
  const { MoneyMovesService } = await import('../src/modules/finance/money-moves.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  // What tsc emits for DriveIntakeController's constructor (it declares its
  // dependencies by type only, and this transform emits no decorator metadata),
  // as payments-actor.integration.test.ts declares it.
  if (!Reflect.getMetadata('design:paramtypes', DriveIntakeController)) {
    Reflect.defineMetadata('design:paramtypes', [ConnectorIntelligenceService, DriveIntakeOrchestrator, PrismaService], DriveIntakeController);
  }

  Logger.overrideLogger(false);

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController, GoogleDriveController, CalendarController, MicrosoftOAuthController, ConnectorController, ConnectController, DriveIntakeController],
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
      { provide: GeneratedDocumentService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      // CalendarController's and CalendarSyncService's collaborators no case here reaches.
      { provide: CalendarProjectionService, useValue: {} },
      { provide: CalendarQueryService, useValue: {} },
      { provide: CalendarConflictService, useValue: {} },
      { provide: CalendarInsightService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      // W10-GOOGLE-DOORS-REST ([V94D-T07]): the temporal-flow pull, recording.
      { provide: GoogleCalendarTemporalSyncService, useValue: temporalSync },
      // MicrosoftOAuthService's activity log, reached only by its callback (no case here).
      { provide: ConnectorActivityService, useValue: {} },
      // The Google Calendar and Drive connections, real (no connector: both are @Optional),
      // the platform calendar sync over the same CalendarService, and the Outlook door.
      CalendarService,
      CalendarSyncService,
      GoogleDriveService,
      MicrosoftOAuthService,
      // W9-GOOGLE-DOORS-SERVER: ConnectorController's registry (recording stand-in)
      // and the collaborators no case here reaches.
      { provide: ConnectorRegistryService, useValue: connectorRegistry },
      { provide: ConnectorHealthMonitorService, useValue: {} },
      // W9-GOOGLE-DOORS-SERVER review repair SEC-W9GD-1: the real credential store
      // (connector_statuses), reached only by DELETE credentials/:type ([V94D-H01], [V94D-H02]).
      ConnectorCredentialsService,
      // ConnectController: the real Google Contacts sync (its provider run spied
      // below; CrmService and ContactAuditService are reached only by that run),
      // the real cross-source syncAll, the Outlook stand-in, and the collaborators
      // no case here reaches.
      GoogleContactsSyncService,
      { provide: CrmService, useValue: {} },
      { provide: ContactAuditService, useValue: {} },
      { provide: OutlookContactsSyncService, useValue: outlookContacts },
      {
        provide: ContactSyncService,
        useFactory: (prisma: any, google: any, outlook: any) => new ContactSyncService(prisma, google, outlook),
        inject: [PrismaService, GoogleContactsSyncService, OutlookContactsSyncService],
      },
      { provide: GoogleFormsService, useValue: {} },
      { provide: GoogleFormsMappingService, useValue: {} },
      { provide: SignatureParserService, useValue: {} },
      { provide: GoogleBusinessProfileService, useValue: {} },
      { provide: ConnectorFormMappingService, useValue: {} },
      // W10-GOOGLE-DOORS-REST ([V94D-T06]): DriveIntakeController's Drive pull
      // (recording, shared with the KEY tool) and its plan orchestrator, which
      // no case here reaches; the real KeyToolRegistryService over the real
      // PrismaService, with stand-ins for the services connect.scanDrive does
      // not use and a recording audit log.
      { provide: ConnectorIntelligenceService, useValue: driveIntelligence },
      { provide: DriveIntakeOrchestrator, useValue: {} },
      KeyToolRegistryService,
      { provide: AiExecutionLogService, useValue: keyToolAudit },
      { provide: SafeToSpendService, useValue: {} },
      { provide: CashflowForecastService, useValue: {} },
      { provide: MoneyMovesService, useValue: {} },
      { provide: ReceivablesService, useValue: {} },
      { provide: FinanceOverviewService, useValue: {} },
      { provide: CommandService, useValue: {} },
      { provide: TimelineService, useValue: {} },
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
  // W9-GOOGLE-DOORS-SERVER: the Google Contacts provider run, recorded and never sent.
  googleContactsSync = vi
    .spyOn(app.get(GoogleContactsSyncService), 'sync')
    .mockImplementation(async () => ({ imported: 0, updated: 0, matched: 0, created: 0, skipped: 0, appliedRules: false }));
  keyTools = app.get(KeyToolRegistryService);

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
  // W10-OWNER-MEMBERSHIP (owner ruling D-104): the distinguished owner of
  // bizOther holds the OWNER Membership the operator backfill writes; an owner
  // recorded only as Business.ownerId is refused everywhere (fixture change).
  await db.membership.create({ data: { id: `${P}m_${ID.otherOwner}_other`, userId: ID.otherOwner, businessId: ID.bizOther, role: 'OWNER' } });
  await connect(ID.biz);
  await connect(ID.bizOther);

  // The provider stand-in (SEC-W8GCO-1 cases): Google's token exchange and
  // userinfo answer with PROVIDER_ACCOUNT for any code; anything else is refused,
  // so a case that reached another provider would fail rather than call out.
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: PROVIDER_ACCOUNT.access, refresh_token: PROVIDER_ACCOUNT.refresh, expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
      return new Response(JSON.stringify({ email: PROVIDER_ACCOUNT.email }), { status: 200 });
    }
    throw new Error(`v94d_ provider stand-in: unexpected fetch ${url}`);
  }) as typeof fetch;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
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
const syncConnect = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/calendar/businesses/${businessId}/sync/google/connect`), actor);
const syncDisconnect = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/calendar/businesses/${businessId}/sync/google/disconnect`), actor);
const syncResync = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/calendar/businesses/${businessId}/sync/google/resync`), actor);
const microsoftAuthUrl = (businessId: string, actor: string | undefined) =>
  as(agent().get(`/connect/microsoft/businesses/${businessId}/auth-url`), actor);

/** W9-GOOGLE-DOORS-SERVER: the connector doors D-99 covers (start, sync and disconnect: reconnect disconnects first). */
const CONNECTOR_DOORS = ['sync', 'disconnect', 'reconnect'] as const;
/** The connections the Google Suite consent provisions besides gmail (GoogleSuiteService SERVICE_TO_CONNECTOR). */
const GOOGLE_SUITE_CONNECTORS = ['google_calendar', 'google_drive', 'google_contacts', 'google_forms', 'google_business_profile'] as const;
/** A connector outside D-99 (not a Google connection). */
const NON_GOOGLE_CONNECTOR = 'typeform';
const connectorDoor = (op: string, businessId: string, type: string, actor: string | undefined) =>
  as(agent().post(`/connectors/businesses/${businessId}/${op}/${type}`), actor).send({});
const REGISTRY_DOOR: Record<(typeof CONNECTOR_DOORS)[number], 'syncConnector' | 'disconnectConnector' | 'reconnectConnector'> = {
  sync: 'syncConnector',
  disconnect: 'disconnectConnector',
  reconnect: 'reconnectConnector',
};
function clearConnectorRegistry() {
  for (const fn of Object.values(connectorRegistry)) fn.mockClear();
}

const contactSourceResync = (businessId: string, source: string, actor: string | undefined) =>
  as(agent().post(`/connect/businesses/${businessId}/contact-sources/${source}/resync`), actor);
const contactSourceDisconnect = (businessId: string, source: string, actor: string | undefined) =>
  as(agent().delete(`/connect/businesses/${businessId}/contact-sources/${source}`), actor);
const contactSourcesSyncAll = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/connect/businesses/${businessId}/contact-sources/sync-all`), actor);
function clearContactSyncs() {
  googleContactsSync.mockClear();
  outlookContacts.sync.mockClear();
  outlookContacts.disconnect.mockClear();
}

/** W9-GOOGLE-DOORS-SERVER review repair SEC-W9GD-1: DELETE /connectors/businesses/:b/credentials/:type (ConnectorCredentialsService.clearCredentials). */
const deleteConnectorCredentials = (businessId: string, type: string, actor: string | undefined) =>
  as(agent().delete(`/connectors/businesses/${businessId}/credentials/${type}`), actor);
/** When each seeded connector row was connected (fixed, so a case can compare it as stored). */
const ROW_CONNECTED_AT = new Date('2026-01-02T03:04:05.000Z');
/** Write a connected connector_statuses row for `type` on `businessId` (its account names the business and the type). */
async function seedConnectorRow(businessId: string, type: string) {
  await db.connectorStatus.upsert({
    where: { businessId_connectorType: { businessId, connectorType: type } },
    create: { businessId, connectorType: type, status: 'connected', connectedAccount: `${businessId}-${type}@test.local`, connectedAt: ROW_CONNECTED_AT },
    update: { status: 'connected', connectedAccount: `${businessId}-${type}@test.local`, connectedAt: ROW_CONNECTED_AT },
  });
}
/** The connector row of `type` on `businessId`, as stored. */
async function connectorRowOf(businessId: string, type: string) {
  const rows: Array<{ status: string; connected_account: string | null; connected_at: Date | null }> = await db.$queryRawUnsafe(
    `SELECT status, connected_account, connected_at FROM connector_statuses WHERE business_id = $1 AND connector_type = $2`,
    businessId, type,
  );
  return rows[0];
}
/** The connector types of `businessId` the nightly sync selects (ConnectorSyncScheduler ELIGIBLE_STATUSES). */
async function nightlySyncTypesOf(businessId: string): Promise<string[]> {
  const rows: Array<{ connector_type: string }> = await db.$queryRawUnsafe(
    `SELECT connector_type FROM connector_statuses WHERE business_id = $1 AND status IN ('connected', 'syncing') ORDER BY connector_type`,
    businessId,
  );
  return rows.map((r) => r.connector_type);
}

/** The three Google OAuth callbacks a Drive or calendar state can be landed at. */
const CALLBACKS = {
  drive: '/drive/callback',
  bookingsCalendar: '/bookings/calendar/callback',
  syncCalendar: '/calendar/sync/google/callback',
} as const;
const landAt = (callback: string, state: string, code: string) => agent().get(callback).query({ state, code });

/** The `state` query parameter of a consent URL. */
const stateOf = (url: string) => String(new URL(url).searchParams.get('state'));

/** The business's calendar sync settings, as stored (NULL until a resync or a settings write). */
async function storedSyncSettings(businessId: string) {
  const rows: Array<{ calendar_sync_settings: unknown }> = await db.$queryRawUnsafe(
    `SELECT calendar_sync_settings FROM businesses WHERE id = $1`,
    businessId,
  );
  return rows[0]?.calendar_sync_settings ?? null;
}

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
  it('[V94D-X01] seeded two businesses: biz with its owner (OWNER and Business.ownerId), a co-owner (OWNER membership only), an ADMIN, a STAFF member and the distinguished owner of bizOther as a STAFF member; bizOther with only the OWNER membership of its distinguished owner (D-104); both hold a stored Google Calendar and Drive connection', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(5);
    expect(await db.membership.count({ where: { businessId: ID.bizOther } })).toBe(1);
    expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
    expect(await stored(ID.bizOther)).toEqual(connectedRow(ID.bizOther));
  });
});

describe('W8-GOOGLE-CONSENT-OWNER: starting or disconnecting the Google Calendar connection is the business owner\'s (D-99)', () => {
  it('[V94D-A01] RED-BEFORE (D-99; SEC-W7RCV-2): GET /bookings/businesses/:b/calendar/auth-url answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with no Google URL', async () => {
    for (const member of REFUSED) expectGoogleOwnerOnly(await calendarAuthUrl(ID.biz, member), member);
  });

  it('[V94D-A02] control (D-99, the Gmail owner rule\'s arms): the owner, a co-owner by OWNER membership, the distinguished owner (Business.ownerId, with the OWNER membership D-104 requires) and a SUPER_ADMIN with no membership each get the calendar consent URL, its signed state naming the route\'s business', async () => {
    // SEC-W8GCO-1 (review repair): the calendar state carries a purpose tag of its own.
    expectConsentFor(await calendarAuthUrl(ID.biz, ID.owner), ID.biz, 'google-calendar', 'owner');
    expectConsentFor(await calendarAuthUrl(ID.biz, ID.coOwner), ID.biz, 'google-calendar', 'coOwner');
    expectConsentFor(await calendarAuthUrl(ID.bizOther, ID.otherOwner), ID.bizOther, 'google-calendar', 'otherOwner on bizOther');
    expectConsentFor(await calendarAuthUrl(ID.biz, ID.superAdmin), ID.biz, 'google-calendar', 'superAdmin');
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

  it('[V94D-B02] control (D-99, the Gmail owner rule\'s arms): the owner, a co-owner by OWNER membership, the distinguished owner (Business.ownerId, with the OWNER membership D-104 requires) and a SUPER_ADMIN with no membership each get the drive consent URL, its signed state naming the route\'s business and the drive flow', async () => {
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

describe('W8-GOOGLE-CONSENT-OWNER review repair: the platform Google Calendar sync doors are the business owner\'s (D-99; SEC-W8GCO-2)', () => {
  it('[V94D-D01] RED-BEFORE (D-99; SEC-W8GCO-2): POST /calendar/businesses/:b/sync/google/connect, .../disconnect and .../resync answer an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with no Google URL, the stored calendar and drive connection unchanged and no resync run', async () => {
    await connect(ID.biz);
    const settingsBefore = await storedSyncSettings(ID.biz);
    for (const member of REFUSED) {
      expectGoogleOwnerOnly(await syncConnect(ID.biz, member), `${member} connect`);
      expectGoogleOwnerOnly(await syncDisconnect(ID.biz, member), `${member} disconnect`);
      expectGoogleOwnerOnly(await syncResync(ID.biz, member), `${member} resync`);
      expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
      expect(await storedSyncSettings(ID.biz)).toEqual(settingsBefore);
    }
  });

  it('[V94D-D02] control (D-99): the owner gets the sync consent URL (its state naming the business and the google-calendar purpose), resyncs and disconnects (calendar email, tokens, expiry, calendar id and sync settings cleared; drive untouched); the distinguished owner on their own business and a SUPER_ADMIN get the consent URL; the status read stays a member\'s', async () => {
    const owner = await syncConnect(ID.biz, ID.owner);
    expect([200, 201], JSON.stringify(owner.body)).toContain(owner.status);
    expectConsentFor({ status: 200, body: owner.body }, ID.biz, 'google-calendar', 'owner sync connect');
    for (const [businessId, actor] of [[ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]]) {
      const res = await syncConnect(businessId, actor);
      expect([200, 201], `${actor} ${JSON.stringify(res.body)}`).toContain(res.status);
      expectConsentFor({ status: 200, body: res.body }, businessId, 'google-calendar', `${actor} sync connect`);
    }

    await connect(ID.biz);
    const resync = await syncResync(ID.biz, ID.owner);
    expect([200, 201], JSON.stringify(resync.body)).toContain(resync.status);
    // No calendar event to push and pullExternal off by default: the cycle ran without a provider call.
    expect(resync.body).toEqual({ pushed: 0, pulled: 0, errors: [] });
    expect(await storedSyncSettings(ID.biz)).toMatchObject({ lastResyncAt: expect.any(String), lastResyncError: null });

    const disconnect = await syncDisconnect(ID.biz, ID.owner);
    expect([200, 201], JSON.stringify(disconnect.body)).toContain(disconnect.status);
    expect(disconnect.body).toEqual({ success: true });
    expect(await stored(ID.biz)).toEqual({
      ...connectedRow(ID.biz),
      calendar_email: null, calendar_access_token: null, calendar_refresh_token: null, calendar_expiry: false, calendar_id: null,
    });
    expect(await storedSyncSettings(ID.biz)).toBeNull();
    await connect(ID.biz);

    const status = await as(agent().get(`/calendar/businesses/${ID.biz}/sync/status`), ID.staff);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(status.body).toMatchObject({ connected: true });
  });
});

describe('W8-GOOGLE-CONSENT-OWNER review repair: the Drive and calendar callbacks complete only their own single-use state (D-99; SEC-W8GCO-1)', () => {
  it('[V94D-E01] RED-BEFORE (D-99; SEC-W8GCO-1): GET /drive/callback refuses (reason invalid_state) a bookings calendar state and a calendar sync state the owner obtained, and the Outlook state a STAFF member obtains at GET /connect/microsoft/businesses/:b/auth-url (signed with GOOGLE_STATE_SECRET while MICROSOFT_STATE_SECRET is unset); the stored drive connection stays the business\'s', async () => {
    await connect(ID.biz);
    const microsoft = await microsoftAuthUrl(ID.biz, ID.staff);
    expect(microsoft.status, JSON.stringify(microsoft.body)).toBe(200);
    const foreign: Array<[string, string]> = [
      ['bookings calendar state', stateOf((await calendarAuthUrl(ID.biz, ID.owner)).body.url)],
      ['calendar sync state', stateOf((await syncConnect(ID.biz, ID.owner)).body.url)],
      ['Outlook state (STAFF)', stateOf(microsoft.body.authUrl)],
    ];
    for (const [label, state] of foreign) {
      const res = await landAt(CALLBACKS.drive, state, `${P}code-${label.length}`);
      expect(res.status, label).toBe(302);
      expect(res.headers.location, label).toContain('drive=error&reason=invalid_state');
      expect(await stored(ID.biz), label).toEqual(connectedRow(ID.biz));
    }
  });

  it('[V94D-E02] RED-BEFORE (D-99; SEC-W8GCO-1): GET /bookings/calendar/callback and GET /calendar/sync/google/callback refuse (reason invalid_state) the owner\'s Drive state and a STAFF member\'s Outlook state; the stored calendar connection stays the business\'s', async () => {
    await connect(ID.biz);
    const microsoft = await microsoftAuthUrl(ID.biz, ID.staff);
    expect(microsoft.status, JSON.stringify(microsoft.body)).toBe(200);
    const foreign: Array<[string, string]> = [
      ['Drive state', stateOf((await driveAuthUrl(ID.biz, ID.owner)).body.url)],
      ['Outlook state (STAFF)', stateOf(microsoft.body.authUrl)],
    ];
    for (const [label, state] of foreign) {
      for (const callback of [CALLBACKS.bookingsCalendar, CALLBACKS.syncCalendar]) {
        const res = await landAt(callback, state, `${P}code-${label.length}`);
        expect(res.status, `${label} at ${callback}`).toBe(302);
        expect(res.headers.location, `${label} at ${callback}`).toContain('calendar=error&reason=invalid_state');
        expect(await stored(ID.biz), `${label} at ${callback}`).toEqual(connectedRow(ID.biz));
      }
    }
  });

  it('[V94D-E03] RED-BEFORE (D-99; SEC-W8GCO-1): the owner\'s own state completes its callback once (Drive at /drive/callback, a bookings calendar state at /bookings/calendar/callback, a sync state at /calendar/sync/google/callback, each storing the provider account) and is refused invalid_state when it is landed again, at either calendar callback, with nothing stored', async () => {
    // Drive: once, then never again.
    await connect(ID.biz);
    const driveState = stateOf((await driveAuthUrl(ID.biz, ID.owner)).body.url);
    const first = await landAt(CALLBACKS.drive, driveState, `${P}code-drive-1`);
    expect(first.headers.location, 'drive first').toContain('drive=success');
    const afterDrive = await stored(ID.biz);
    expect(afterDrive.drive_email).toBe(PROVIDER_ACCOUNT.email);
    expect(afterDrive.drive_access_token).not.toBe(connectedRow(ID.biz).drive_access_token);
    // Only the drive columns moved: the calendar connection is untouched.
    expect({ ...afterDrive, drive_email: null, drive_access_token: null, drive_refresh_token: null })
      .toEqual({ ...connectedRow(ID.biz), drive_email: null, drive_access_token: null, drive_refresh_token: null });
    await connect(ID.biz);
    const replay = await landAt(CALLBACKS.drive, driveState, `${P}code-drive-2`);
    expect(replay.headers.location, 'drive replay').toContain('drive=error&reason=invalid_state');
    expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));

    // Calendar: a bookings calendar state, once, then at neither calendar callback again.
    const calendarState = stateOf((await calendarAuthUrl(ID.biz, ID.owner)).body.url);
    const calendarFirst = await landAt(CALLBACKS.bookingsCalendar, calendarState, `${P}code-cal-1`);
    expect(calendarFirst.headers.location, 'calendar first').toContain('calendar=success');
    const afterCalendar = await stored(ID.biz);
    expect(afterCalendar.calendar_email).toBe(PROVIDER_ACCOUNT.email);
    expect(afterCalendar.calendar_access_token).not.toBe(connectedRow(ID.biz).calendar_access_token);
    await connect(ID.biz);
    for (const callback of [CALLBACKS.bookingsCalendar, CALLBACKS.syncCalendar]) {
      const res = await landAt(callback, calendarState, `${P}code-cal-2`);
      expect(res.headers.location, `calendar replay at ${callback}`).toContain('calendar=error&reason=invalid_state');
      expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
    }

    // The sync consent's state completes the platform callback (the same purpose tag).
    const syncState = stateOf((await syncConnect(ID.biz, ID.owner)).body.url);
    const syncFirst = await landAt(CALLBACKS.syncCalendar, syncState, `${P}code-sync-1`);
    expect(syncFirst.headers.location, 'sync first').toContain('calendar=success');
    expect((await stored(ID.biz)).calendar_email).toBe(PROVIDER_ACCOUNT.email);
    await connect(ID.biz);
    const syncReplay = await landAt(CALLBACKS.syncCalendar, syncState, `${P}code-sync-2`);
    expect(syncReplay.headers.location, 'sync replay').toContain('calendar=error&reason=invalid_state');
    expect(await stored(ID.biz)).toEqual(connectedRow(ID.biz));
  });
});

describe('W9-GOOGLE-DOORS-SERVER: the generic connector doors of the Google Suite connections are the business owner\'s (D-99)', () => {
  it('[V94D-T02] (W9-GOOGLE-DOORS-SERVER, was it.todo) RED-BEFORE (D-99): POST /connectors/businesses/:b/sync/:type, .../disconnect/:type and .../reconnect/:type for google_calendar, google_drive, google_contacts, google_forms and google_business_profile (the connections the Google Suite consent provisions) answer an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY before the registry is reached', async () => {
    clearConnectorRegistry();
    for (const type of GOOGLE_SUITE_CONNECTORS) {
      for (const op of CONNECTOR_DOORS) {
        for (const member of REFUSED) expectGoogleOwnerOnly(await connectorDoor(op, ID.biz, type, member), `${member} ${op} ${type}`);
      }
    }
    expect(connectorRegistry.syncConnector).not.toHaveBeenCalled();
    expect(connectorRegistry.disconnectConnector).not.toHaveBeenCalled();
    expect(connectorRegistry.reconnectConnector).not.toHaveBeenCalled();
  });

  it('[V94D-F01] control (D-99, W9-GOOGLE-DOORS-SERVER): the owner, a co-owner by OWNER membership, the distinguished owner (Business.ownerId, with the OWNER membership D-104 requires) on their own business and a SUPER_ADMIN with no membership sync, disconnect and reconnect each Google Suite connection, and the registry is reached with the route\'s business', async () => {
    for (const [businessId, actor] of [[ID.biz, ID.owner], [ID.biz, ID.coOwner], [ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]]) {
      for (const type of GOOGLE_SUITE_CONNECTORS) {
        for (const op of CONNECTOR_DOORS) {
          clearConnectorRegistry();
          const res = await connectorDoor(op, businessId, type, actor);
          expect(res.status, `${actor} ${op} ${type} ${JSON.stringify(res.body)}`).toBe(201);
          expect(connectorRegistry[REGISTRY_DOOR[op]]).toHaveBeenCalledWith(type, businessId);
        }
      }
    }
  });

  it('[V94D-F02] control (D-99, W9-GOOGLE-DOORS-SERVER): the ruling covers Google connections and their start, sync and disconnect only: an ADMIN and a STAFF member still sync, disconnect and reconnect a non-Google connector (typeform) and test google_calendar (a credential check), and the registry is reached; a user with no membership is refused by BusinessGuard (403) and an unauthenticated request by AuthGuard (401) before the registry', async () => {
    for (const member of [ID.admin, ID.staff]) {
      for (const op of CONNECTOR_DOORS) {
        clearConnectorRegistry();
        const res = await connectorDoor(op, ID.biz, NON_GOOGLE_CONNECTOR, member);
        expect(res.status, `${member} ${op} ${JSON.stringify(res.body)}`).toBe(201);
        expect(connectorRegistry[REGISTRY_DOOR[op]]).toHaveBeenCalledWith(NON_GOOGLE_CONNECTOR, ID.biz);
      }
      clearConnectorRegistry();
      const tested = await connectorDoor('test', ID.biz, 'google_calendar', member);
      expect(tested.status, `${member} test ${JSON.stringify(tested.body)}`).toBe(201);
      expect(connectorRegistry.testConnector).toHaveBeenCalledWith('google_calendar', ID.biz);
    }
    clearConnectorRegistry();
    for (const op of CONNECTOR_DOORS) {
      expect((await connectorDoor(op, ID.biz, 'google_calendar', ID.stranger)).status, `stranger ${op}`).toBe(403);
      expect((await connectorDoor(op, ID.biz, 'google_calendar', undefined)).status, `anonymous ${op}`).toBe(401);
    }
    expect(connectorRegistry.syncConnector).not.toHaveBeenCalled();
    expect(connectorRegistry.disconnectConnector).not.toHaveBeenCalled();
    expect(connectorRegistry.reconnectConnector).not.toHaveBeenCalled();
  });
});

describe('W9-GOOGLE-DOORS-SERVER: the Google Contacts source doors are the business owner\'s (D-99)', () => {
  it('[V94D-T03] (W9-GOOGLE-DOORS-SERVER, was it.todo) RED-BEFORE (D-99): POST /connect/businesses/:b/contact-sources/google_contacts/resync, DELETE .../contact-sources/google_contacts and POST .../contact-sources/sync-all (which syncs Google Contacts while it is connected) answer an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with nothing synced (neither Google nor Outlook) and the stored Google Contacts connection exactly as it was', async () => {
    await connectContacts(ID.biz);
    clearContactSyncs();
    for (const member of REFUSED) {
      expectGoogleOwnerOnly(await contactSourceResync(ID.biz, 'google_contacts', member), `${member} resync`);
      expectGoogleOwnerOnly(await contactSourceDisconnect(ID.biz, 'google_contacts', member), `${member} disconnect`);
      expect(await storedContacts(ID.biz), `${member} disconnect`).toEqual(contactsConnectedRow(ID.biz));
      expectGoogleOwnerOnly(await contactSourcesSyncAll(ID.biz, member), `${member} sync-all`);
    }
    expect(googleContactsSync).not.toHaveBeenCalled();
    expect(outlookContacts.sync).not.toHaveBeenCalled();
    expect(await storedContacts(ID.biz)).toEqual(contactsConnectedRow(ID.biz));
  });

  it('[V94D-G01] control (D-99, W9-GOOGLE-DOORS-SERVER): the owner, a co-owner by OWNER membership, the distinguished owner on their own business and a SUPER_ADMIN resync Google Contacts and sync every source (Google and Outlook both run), and disconnect Google Contacts (its tokens, expiry and sync token cleared)', async () => {
    for (const [businessId, actor] of [[ID.biz, ID.owner], [ID.biz, ID.coOwner], [ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]]) {
      await connectContacts(businessId);
      clearContactSyncs();
      const resync = await contactSourceResync(businessId, 'google_contacts', actor);
      expect(resync.status, `${actor} resync ${JSON.stringify(resync.body)}`).toBe(201);
      expect(googleContactsSync).toHaveBeenCalledWith(businessId);

      clearContactSyncs();
      const all = await contactSourcesSyncAll(businessId, actor);
      expect(all.status, `${actor} sync-all ${JSON.stringify(all.body)}`).toBe(201);
      expect(Object.keys(all.body).sort()).toEqual(['google_contacts', 'outlook_contacts']);
      expect(googleContactsSync).toHaveBeenCalledWith(businessId);
      expect(outlookContacts.sync).toHaveBeenCalledWith(businessId);

      const gone = await contactSourceDisconnect(businessId, 'google_contacts', actor);
      expect(gone.status, `${actor} disconnect ${JSON.stringify(gone.body)}`).toBe(200);
      expect(await storedContacts(businessId)).toMatchObject({
        contacts_access_token: null, contacts_refresh_token: null, contacts_expiry: false, contacts_sync_token: null,
      });
    }
  });

  it('[V94D-G02] control (D-99, W9-GOOGLE-DOORS-SERVER; the smaller sync-all change): with Google Contacts not connected, POST .../contact-sources/sync-all syncs no Google source and stays a member\'s (an ADMIN and a STAFF member sync Outlook, Google is not run); the Outlook source resync stays a member\'s (a Microsoft connection, outside D-99)', async () => {
    await connectContacts(ID.biz, { google: false });
    for (const member of [ID.admin, ID.staff]) {
      clearContactSyncs();
      const all = await contactSourcesSyncAll(ID.biz, member);
      expect(all.status, `${member} sync-all ${JSON.stringify(all.body)}`).toBe(201);
      expect(Object.keys(all.body)).toEqual(['outlook_contacts']);
      expect(outlookContacts.sync).toHaveBeenCalledWith(ID.biz);
      expect(googleContactsSync).not.toHaveBeenCalled();

      clearContactSyncs();
      const resync = await contactSourceResync(ID.biz, 'outlook_contacts', member);
      expect(resync.status, `${member} outlook resync ${JSON.stringify(resync.body)}`).toBe(201);
      expect(outlookContacts.sync).toHaveBeenCalledWith(ID.biz);
    }
    await connectContacts(ID.biz);
  });
});

describe('W9-GOOGLE-DOORS-SERVER review repair: clearing a Google Suite connection\'s connector credentials is the business owner\'s (D-99; SEC-W9GD-1)', () => {
  it('[V94D-H01] RED-BEFORE (D-99; SEC-W9GD-1): DELETE /connectors/businesses/:b/credentials/:type for google_calendar, google_drive, google_contacts, google_forms and google_business_profile, which marks the connector row disconnected and clears its account and connection time, answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY before anything is written: each row stays connected with its account and connection time and the nightly sync still selects it', async () => {
    for (const type of GOOGLE_SUITE_CONNECTORS) await seedConnectorRow(ID.biz, type);
    for (const type of GOOGLE_SUITE_CONNECTORS) {
      for (const member of REFUSED) expectGoogleOwnerOnly(await deleteConnectorCredentials(ID.biz, type, member), `${member} delete credentials ${type}`);
    }
    for (const type of GOOGLE_SUITE_CONNECTORS) {
      expect(await connectorRowOf(ID.biz, type), type).toEqual({ status: 'connected', connected_account: `${ID.biz}-${type}@test.local`, connected_at: ROW_CONNECTED_AT });
    }
    expect(await nightlySyncTypesOf(ID.biz)).toEqual([...GOOGLE_SUITE_CONNECTORS].sort());
    await db.$executeRawUnsafe(`DELETE FROM connector_statuses WHERE business_id = $1`, ID.biz);
  });

  it('[V94D-H02] control (D-99, SEC-W9GD-1): the owner, a co-owner by OWNER membership, the distinguished owner on their own business and a SUPER_ADMIN clear each Google Suite connection\'s connector credentials (row disconnected, account and connection time cleared); an ADMIN and a STAFF member still clear a non-Google connector\'s (typeform); a user with no membership is refused by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with the row unchanged', async () => {
    for (const [businessId, actor] of [[ID.biz, ID.owner], [ID.biz, ID.coOwner], [ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]]) {
      for (const type of GOOGLE_SUITE_CONNECTORS) {
        await seedConnectorRow(businessId, type);
        const res = await deleteConnectorCredentials(businessId, type, actor);
        expect(res.status, `${actor} ${type} ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(await connectorRowOf(businessId, type), `${actor} ${type}`).toEqual({ status: 'disconnected', connected_account: null, connected_at: null });
      }
    }
    for (const member of [ID.admin, ID.staff]) {
      await seedConnectorRow(ID.biz, NON_GOOGLE_CONNECTOR);
      const res = await deleteConnectorCredentials(ID.biz, NON_GOOGLE_CONNECTOR, member);
      expect(res.status, `${member} ${JSON.stringify(res.body)}`).toBe(200);
      expect(await connectorRowOf(ID.biz, NON_GOOGLE_CONNECTOR), member).toEqual({ status: 'disconnected', connected_account: null, connected_at: null });
    }
    await seedConnectorRow(ID.biz, 'google_calendar');
    expect((await deleteConnectorCredentials(ID.biz, 'google_calendar', ID.stranger)).status, 'stranger').toBe(403);
    expect((await deleteConnectorCredentials(ID.biz, 'google_calendar', undefined)).status, 'anonymous').toBe(401);
    expect(await connectorRowOf(ID.biz, 'google_calendar')).toEqual({ status: 'connected', connected_account: `${ID.biz}-google_calendar@test.local`, connected_at: ROW_CONNECTED_AT });
    await db.$executeRawUnsafe(`DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  });
});

/**
 * W10-GOOGLE-DOORS-REST (owner ruling D-99): the last Google sync doors. Each
 * was an it.todo here ([V94D-T05]..[V94D-T07]) while its file was outside the
 * W9-GOOGLE-DOORS-SERVER write set.
 */
const contactsSync = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/connect/businesses/${businessId}/contacts/sync`), actor);
const outlookContactsSync = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/connect/businesses/${businessId}/outlook-contacts/sync`), actor);
const driveSync = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/drive/businesses/${businessId}/sync`), actor).send({});
const temporalFlowSync = (businessId: string, actor: string | undefined) =>
  as(agent().post(`/calendar/businesses/${businessId}/sync/google/temporal-flow`), actor).send({});
const patchSyncSettings = (businessId: string, actor: string | undefined, body: Record<string, unknown>) =>
  as(agent().patch(`/calendar/businesses/${businessId}/sync/settings`), actor).send(body);
/**
 * The KEY tool connect.scanDrive, run as KeyCommandService.executeApprovedPlan
 * runs a legacy tool: INTERNAL_EXEC (2), the driving member as userId.
 */
const scanDrive = (businessId: string, userId: string | undefined): Promise<any> =>
  keyTools.execute('connect', 'scanDrive', { businessId, userId, commandId: `${P}cmd`, autonomyLevel: 2 }, {});
/** A KEY refusal under D-99 (the shape of the other KEY refusals): nothing run, no data, the code named. */
function expectKeyGoogleOwnerOnly(result: any, who: string) {
  expect(result, `${who} ${JSON.stringify(result)}`).toMatchObject({ success: false, notExecuted: true });
  expect(String(result.error), who).toContain('GOOGLE_CONNECT_OWNER_ONLY');
  expect(result.data, who).toBeUndefined();
}
/** The arms of the owner rule, each on a business it owns: the owner, a co-owner, the distinguished owner, a SUPER_ADMIN. */
const OWNER_ARMS: Array<[string, string]> = [[ID.biz, ID.owner], [ID.biz, ID.coOwner], [ID.bizOther, ID.otherOwner], [ID.biz, ID.superAdmin]];

describe('W10-GOOGLE-DOORS-REST: starting a Google Contacts sync is the business owner\'s (D-99)', () => {
  it('[V94D-T05] (W10-GOOGLE-DOORS-REST, D-99, was it.todo) RED-BEFORE: POST /connect/businesses/:b/contacts/sync (the Google Contacts sync: the GoogleContactsSyncService.sync [V94D-T03] refuses at contact-sources/google_contacts/resync and sync-all; review SEC-W9GD-2) answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with nothing synced and the stored Google Contacts connection exactly as it was', async () => {
    await connectContacts(ID.biz);
    clearContactSyncs();
    for (const member of REFUSED) {
      expectGoogleOwnerOnly(await contactsSync(ID.biz, member), `${member} contacts/sync`);
      expect(await storedContacts(ID.biz), member).toEqual(contactsConnectedRow(ID.biz));
    }
    expect(googleContactsSync).not.toHaveBeenCalled();
    expect(outlookContacts.sync).not.toHaveBeenCalled();
  });

  it('[V94D-J01] control (W10-GOOGLE-DOORS-REST, D-99): the owner, a co-owner by OWNER membership, the distinguished owner (Business.ownerId, with the OWNER membership D-104 requires) on their own business and a SUPER_ADMIN with no membership start the Google Contacts sync for the route\'s business; the Outlook Contacts sync (a Microsoft connection, outside D-99) stays a member\'s (an ADMIN and a STAFF member start it); a user with no membership is refused by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with nothing synced', async () => {
    for (const [businessId, actor] of OWNER_ARMS) {
      await connectContacts(businessId);
      clearContactSyncs();
      const res = await contactsSync(businessId, actor);
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(201);
      expect(googleContactsSync).toHaveBeenCalledTimes(1);
      expect(googleContactsSync).toHaveBeenCalledWith(businessId);
    }
    for (const member of [ID.admin, ID.staff]) {
      clearContactSyncs();
      const res = await outlookContactsSync(ID.biz, member);
      expect(res.status, `${member} outlook ${JSON.stringify(res.body)}`).toBe(201);
      expect(outlookContacts.sync).toHaveBeenCalledWith(ID.biz);
      expect(googleContactsSync).not.toHaveBeenCalled();
    }
    clearContactSyncs();
    expect((await contactsSync(ID.biz, ID.stranger)).status, 'stranger').toBe(403);
    expect((await contactsSync(ID.biz, undefined)).status, 'anonymous').toBe(401);
    expect(googleContactsSync).not.toHaveBeenCalled();
    await connectContacts(ID.biz);
  });
});

describe('W10-GOOGLE-DOORS-REST: starting a Google Drive sync, at the Drive intake door or through the KEY tool, is the business owner\'s (D-99)', () => {
  it('[V94D-T06] (W10-GOOGLE-DOORS-REST, D-99, was it.todo) RED-BEFORE: POST /drive/businesses/:b/sync (DriveIntakeController.sync, the Drive sync the web starts: key-connect handleSync and the Drive intake queue) and the KEY tool connect.scanDrive (review CRR-W9GD-1) both run ConnectorIntelligenceService.syncGoogleDrive (the Drive API pull that writes intake rows); for an ADMIN, a STAFF member and the owner of another business who is STAFF here the door answers 403 GOOGLE_CONNECT_OWNER_ONLY and the KEY tool returns a refusal envelope (success false, notExecuted, GOOGLE_CONNECT_OWNER_ONLY, no data), as it does for a run with no driving member, one driven by a user with no membership and one by the owner of another business; syncGoogleDrive is not called', async () => {
    driveIntelligence.syncGoogleDrive.mockClear();
    for (const member of REFUSED) {
      expectGoogleOwnerOnly(await driveSync(ID.biz, member), `${member} drive sync`);
      expectKeyGoogleOwnerOnly(await scanDrive(ID.biz, member), `${member} connect.scanDrive`);
    }
    expectKeyGoogleOwnerOnly(await scanDrive(ID.biz, undefined), 'no driving member');
    expectKeyGoogleOwnerOnly(await scanDrive(ID.biz, ID.stranger), 'stranger');
    expectKeyGoogleOwnerOnly(await scanDrive(ID.bizOther, ID.owner), 'the owner of biz on bizOther');
    expect(driveIntelligence.syncGoogleDrive).not.toHaveBeenCalled();
  });

  it('[V94D-J02] control (W10-GOOGLE-DOORS-REST, D-99): the owner, a co-owner by OWNER membership, the distinguished owner on their own business and a SUPER_ADMIN with no membership start the Drive sync at the door (201, success with the pull\'s counts) and through the KEY tool connect.scanDrive (success, the pull\'s counts), and syncGoogleDrive runs once for the route\'s business each time; a user with no membership is refused the door by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with nothing run', async () => {
    for (const [businessId, actor] of OWNER_ARMS) {
      driveIntelligence.syncGoogleDrive.mockClear();
      const res = await driveSync(businessId, actor);
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toEqual({ success: true, scanned: 0, newFiles: 0 });
      expect(driveIntelligence.syncGoogleDrive).toHaveBeenCalledTimes(1);
      expect(driveIntelligence.syncGoogleDrive).toHaveBeenCalledWith(businessId);

      driveIntelligence.syncGoogleDrive.mockClear();
      expect(await scanDrive(businessId, actor), `${actor} connect.scanDrive`).toEqual({ success: true, data: { scanned: 0, newFiles: 0 } });
      expect(driveIntelligence.syncGoogleDrive).toHaveBeenCalledTimes(1);
      expect(driveIntelligence.syncGoogleDrive).toHaveBeenCalledWith(businessId);
    }
    driveIntelligence.syncGoogleDrive.mockClear();
    expect((await driveSync(ID.biz, ID.stranger)).status, 'stranger').toBe(403);
    expect((await driveSync(ID.biz, undefined)).status, 'anonymous').toBe(401);
    expect(driveIntelligence.syncGoogleDrive).not.toHaveBeenCalled();
  });
});

describe('W10-GOOGLE-DOORS-REST: pulling the business Google Calendar into the temporal flow is the business owner\'s (D-99)', () => {
  it('[V94D-T07] (W10-GOOGLE-DOORS-REST, D-99, was it.todo) RED-BEFORE: POST /calendar/businesses/:b/sync/google/temporal-flow (GoogleCalendarTemporalSyncService.syncBusiness, which pulls the coming events from the business Google Calendar; review SEC-W9GD-3) answers an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY with syncBusiness not called, as its sibling .../sync/google/resync does ([V94D-D01])', async () => {
    temporalSync.syncBusiness.mockClear();
    for (const member of REFUSED) expectGoogleOwnerOnly(await temporalFlowSync(ID.biz, member), `${member} temporal-flow`);
    expect(temporalSync.syncBusiness).not.toHaveBeenCalled();
  });

  // W10-GOOGLE-DOORS-REST review repair (SEC-W10GDR-1): this control also
  // pinned PATCH .../sync/settings as a member's; writing the Google Calendar
  // sync settings is the owner's (D-99, D-111), proved at [V94D-T08] and
  // [V94D-J04] below, so that half left this case.
  it('[V94D-J03] control (W10-GOOGLE-DOORS-REST, D-99): the owner, a co-owner by OWNER membership, the distinguished owner on their own business and a SUPER_ADMIN pull the Google Calendar into the temporal flow (201, the pull\'s counts) and syncBusiness runs once for the route\'s business each time; a user with no membership is refused the pull by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with nothing run', async () => {
    for (const [businessId, actor] of OWNER_ARMS) {
      temporalSync.syncBusiness.mockClear();
      const res = await temporalFlowSync(businessId, actor);
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toEqual({ synced: 0, skipped: 0 });
      expect(temporalSync.syncBusiness).toHaveBeenCalledTimes(1);
      expect(temporalSync.syncBusiness).toHaveBeenCalledWith(businessId);
    }

    temporalSync.syncBusiness.mockClear();
    expect((await temporalFlowSync(ID.biz, ID.stranger)).status, 'stranger').toBe(403);
    expect((await temporalFlowSync(ID.biz, undefined)).status, 'anonymous').toBe(401);
    expect(temporalSync.syncBusiness).not.toHaveBeenCalled();
  });
});

/**
 * W10-GOOGLE-DOORS-REST review repair (SEC-W10GDR-1; owner rulings D-99 and
 * D-111): the Google Calendar sync settings. PATCH /calendar/businesses/:b/
 * sync/settings and its twin PATCH /bookings/businesses/:b/calendar/settings
 * (the one the web's Key Connect calendar panel writes) choose which of the
 * owner's Google calendars the hourly resync reads and writes (calendarId),
 * whether it runs at all (syncEnabled, syncDirection 'disabled') and in which
 * direction, whether the owner's Google events are pulled in and whom they are
 * shown to (pullExternal, defaultVisibility), and which KEYFLOW items are
 * pushed into the owner's Google calendar (the per-type switches). Each of
 * these starts, stops or re-points the sync of the Google connection, which
 * D-99 gives the owner alone, and D-111 keeps changing a Google connection
 * owner-only. The reads (settings, status, calendar status) stay a member's.
 */
const patchBookingsCalendarSettings = (businessId: string, actor: string | undefined, body: Record<string, unknown>) =>
  as(agent().patch(`/bookings/businesses/${businessId}/calendar/settings`), actor).send(body);
/** The Google Calendar sync configuration of `businessId`, as stored. */
async function storedSyncConfig(businessId: string) {
  const rows: Array<Record<string, unknown>> = await db.$queryRawUnsafe(
    `SELECT calendar_id, calendar_sync_direction, calendar_sync_enabled, calendar_sync_settings FROM businesses WHERE id = $1`,
    businessId,
  );
  return rows[0];
}
/** The configuration each settings case starts from: the primary calendar, two-way, on, no settings written. */
const SYNC_CONFIG_START = { calendar_id: 'primary', calendar_sync_direction: 'two_way', calendar_sync_enabled: true, calendar_sync_settings: null };
async function resetSyncConfig(businessId: string) {
  await db.$executeRawUnsafe(
    `UPDATE businesses SET calendar_id = 'primary', calendar_sync_direction = 'two_way', calendar_sync_enabled = true, calendar_sync_settings = NULL WHERE id = $1`,
    businessId,
  );
}
/**
 * The settings writes a refused member tries at the platform door: the
 * reviewer's probe (stop the sync, re-point it at another calendar, pull only),
 * turning the pull of the owner's events on and showing them to everyone, and
 * changing what is pushed into the owner's Google calendar.
 */
const REFUSED_SETTINGS_BODIES: Array<Record<string, unknown>> = [
  { syncEnabled: false, calendarId: `${P}probe-cal`, syncDirection: 'pull' },
  { pullExternal: true, defaultVisibility: 'PUBLIC' },
  { booking: false, invoice_due: true },
];

describe('W10-GOOGLE-DOORS-REST review repair: changing the business Google Calendar sync settings is the business owner\'s (D-99, D-111; SEC-W10GDR-1)', () => {
  it('[V94D-T08] (W10-GOOGLE-DOORS-REST review repair, D-99, D-111; SEC-W10GDR-1) RED-BEFORE: PATCH /calendar/businesses/:b/sync/settings (calendar id, sync switch and direction, external pull and its visibility, the per-type push switches) and its twin PATCH /bookings/businesses/:b/calendar/settings (calendar id, sync switch and direction) answer an ADMIN, a STAFF member and the owner of another business who is STAFF here 403 GOOGLE_CONNECT_OWNER_ONLY before anything is written: the calendar id, sync direction, sync switch and sync settings stay exactly as they were and the stored Google Calendar connection is untouched', async () => {
    await connect(ID.biz);
    await resetSyncConfig(ID.biz);
    for (const member of REFUSED) {
      for (const body of REFUSED_SETTINGS_BODIES) {
        expectGoogleOwnerOnly(await patchSyncSettings(ID.biz, member, body), `${member} sync/settings ${JSON.stringify(body)}`);
        expect(await storedSyncConfig(ID.biz), `${member} ${JSON.stringify(body)}`).toEqual(SYNC_CONFIG_START);
      }
      expectGoogleOwnerOnly(
        await patchBookingsCalendarSettings(ID.biz, member, { syncEnabled: false, calendarId: `${P}probe-cal2`, syncDirection: 'push' }),
        `${member} bookings calendar/settings`,
      );
      expect(await storedSyncConfig(ID.biz), `${member} bookings calendar/settings`).toEqual(SYNC_CONFIG_START);
      expect(await stored(ID.biz), member).toEqual(connectedRow(ID.biz));
    }
  });

  it('[V94D-J04] control (W10-GOOGLE-DOORS-REST review repair, D-99, D-111): the owner, a co-owner by OWNER membership, the distinguished owner on their own business and a SUPER_ADMIN write the sync settings at both doors (200, stored: calendar id, direction, switch, external pull, visibility and a push switch); the settings, sync status and calendar status reads stay a member\'s (an ADMIN and a STAFF member get 200); a user with no membership is refused both writes by BusinessGuard (403) and an unauthenticated request by AuthGuard (401), with nothing written', async () => {
    for (const [businessId, actor] of OWNER_ARMS) {
      await connect(businessId);
      await resetSyncConfig(businessId);
      const calendarId = `${P}owner-cal`;
      const res = await patchSyncSettings(businessId, actor, {
        syncEnabled: false, calendarId, syncDirection: 'pull', pullExternal: true, defaultVisibility: 'PRIVATE', invoice_due: true,
      });
      expect(res.status, `${actor} sync/settings ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ calendarId, syncDirection: 'pull', syncEnabled: false, pullExternal: true, defaultVisibility: 'PRIVATE', invoice_due: true });
      expect(await storedSyncConfig(businessId), actor).toMatchObject({
        calendar_id: calendarId, calendar_sync_direction: 'pull', calendar_sync_enabled: false,
        calendar_sync_settings: expect.objectContaining({ pullExternal: true, defaultVisibility: 'PRIVATE', invoice_due: true }),
      });

      const twin = await patchBookingsCalendarSettings(businessId, actor, { calendarId: `${P}owner-cal2`, syncDirection: 'push', syncEnabled: true });
      expect(twin.status, `${actor} bookings calendar/settings ${JSON.stringify(twin.body)}`).toBe(200);
      expect(twin.body).toEqual({ calendarId: `${P}owner-cal2`, syncDirection: 'push', syncEnabled: true });
      expect(await storedSyncConfig(businessId), `${actor} twin`).toMatchObject({
        calendar_id: `${P}owner-cal2`, calendar_sync_direction: 'push', calendar_sync_enabled: true,
      });
      await resetSyncConfig(businessId);
    }

    await connect(ID.biz);
    for (const member of [ID.admin, ID.staff]) {
      const settings = await as(agent().get(`/calendar/businesses/${ID.biz}/sync/settings`), member);
      expect(settings.status, `${member} settings read ${JSON.stringify(settings.body)}`).toBe(200);
      expect(settings.body).toMatchObject({ pullExternal: false, defaultVisibility: 'TEAM' });
      const status = await as(agent().get(`/calendar/businesses/${ID.biz}/sync/status`), member);
      expect(status.status, `${member} sync status ${JSON.stringify(status.body)}`).toBe(200);
      expect(status.body).toMatchObject({ connected: true, calendarId: 'primary', syncDirection: 'two_way', syncEnabled: true });
      const calendar = await calendarStatus(ID.biz, member);
      expect(calendar.status, `${member} calendar status ${JSON.stringify(calendar.body)}`).toBe(200);
      expect(calendar.body).toMatchObject({ connected: true, calendarId: 'primary' });
    }

    for (const [actor, code] of [[ID.stranger, 403], [undefined, 401]] as const) {
      expect((await patchSyncSettings(ID.biz, actor, REFUSED_SETTINGS_BODIES[0])).status, `${actor} sync/settings`).toBe(code);
      expect((await patchBookingsCalendarSettings(ID.biz, actor, { syncEnabled: false })).status, `${actor} bookings calendar/settings`).toBe(code);
    }
    expect(await storedSyncConfig(ID.biz)).toEqual(SYNC_CONFIG_START);
  });
});

// [V94D-T04] (review CR-W8GCO-1, D-99) was an it.todo here: the web shows the
// GOOGLE_CONNECT_OWNER_ONLY refusal of DELETE /drive/businesses/:b/disconnect
// and GET .../auth-url to an ADMIN or STAFF member and keeps the Drive
// connection shown as connected (google-drive-browser.tsx handleDisconnect and
// handleConnect, inventory-command-center.tsx and sheets-manage-drawer.tsx).
// The server cannot test the web: W9-GOOGLE-WEB-403 proves it in
// apps/web/src/app/app/__tests__/google-connect-owner-only-refusal.test.tsx
// (the [V94D-T04] cases, with the owner controls [V95K-W01]..[V95K-W02] and
// the connector and contact door pins [V95K-P01]..[V95K-P03]; [V95K-P03] is the
// Google Contacts Sync now that [V94D-T05] gates). The web callers of the doors
// W10-GOOGLE-DOORS-REST gates show the server's refusal as they stand: Key
// Connect handleSync (google_drive) and the Drive intake queue's handleSync
// toast res.error, which carries the server's message; the temporal-flow pull
// (lib/api/temporal-flow.ts syncGoogleCalendarToTemporalFlow) has no web caller.
