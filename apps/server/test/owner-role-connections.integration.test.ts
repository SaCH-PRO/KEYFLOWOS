/**
 * W11-D116-CONNECTION-OWNER (REAL database; owner rulings D-116, D-125): the
 * owner-only connection doors ask whether the caller holds an OWNER-role
 * Membership of the route's business. A co-owner (an OWNER membership, not
 * Business.ownerId) IS the owner; Business.ownerId grants nothing on its own;
 * a recorded owner (Business.ownerId) who holds only an ADMIN or STAFF
 * membership is that role.
 *
 * The defect (at fb00af1c): each of these rules carried a second arm,
 * `business.findFirst({ where: { id, ownerId: actor.id, members: { some: {
 * userId: actor.id } } } })` (owner ruling D-104), which admitted the recorded
 * owner holding ANY membership:
 *   - assertGoogleConnectOwner (google-suite.controller.ts; D-99): the Google
 *     Suite consent without gmail, the bookings calendar and the Drive consent;
 *   - GmailService.connectStanding / assertConnectAuthority (D-11): the
 *     commerce Gmail auth-url and the Google Suite consent with gmail;
 *   - SeoController.assertConnectorOwner (D-94): GA4 and Search Console;
 *   - WhatsAppService.isConfigOwner (D-11): PATCH config, the writer view of
 *     GET config and status (phoneNumberId, each credential's last 4; review
 *     SEC-D116C-1, case D116C-W04), and WhatsAppOperationsScopeGuard, which
 *     lets a config owner past ModuleScopeGuard on the send and inbox routes;
 *   - SubscriptionsService.assertPlanChangeAuthority (D-11): plan changes;
 *   - KeyConnectorController.requireConnectorWriter (OWNER or ADMIN, D-111): a
 *     recorded owner holding STAFF managed provider connections.
 * The fix adds `role: 'OWNER'` to that members filter; nothing else in the
 * rules changes (the OWNER-membership arm, the SUPER_ADMIN bypass, the error
 * codes, ADMIN's D-111 rights).
 *
 * Fixtures: bizA is recorded as owned (Business.ownerId) by `ownerAdmin`, who
 * holds an ADMIN membership of it (role defaults); bizS is recorded as owned by
 * `ownerStaff`, who holds a STAFF membership of it with operations: none; the
 * `coOwner` holds an OWNER membership of both and is the recorded owner of
 * neither (the D-125 positive control).
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): one real Nest app
 * with the real GoogleSuiteController (and GoogleSuiteService),
 * BookingsController (CalendarService), GoogleDriveController
 * (GoogleDriveService), CommerceController (GmailService), SeoController (its
 * SeoAdminGuard and the real GA4 and Search Console services), WhatsAppController
 * (WhatsAppService, WhatsAppOperationsScopeGuard, ModuleScopeGuard),
 * SubscriptionsController (SubscriptionsService) and KeyConnectorController
 * (KeyConnectorService with its real registry), the real PrismaService,
 * AuthGuard and BusinessGuard, the production TenantInterceptor (with the
 * Prisma tenant extension reading its ambient tenant, as main.ts wires it),
 * the global exception filter and ValidationPipe, against DATABASE_URL. The
 * controllers' collaborators no case here reaches are empty stand-ins. The one
 * stand-in on the authorization path is identity attachment: a test middleware
 * reads `x-test-user`, loads that seeded User row and attaches
 * `{ id, email, role }` as AuthMiddleware does after token verification.
 *
 * NO PROVIDER TRAFFIC: global fetch is a recorder that fails, and every case
 * asserts it was handed nothing; the OAuth client id and state secret are
 * obviously fake; the WhatsApp config uses the mock provider.
 *
 * FIXTURES: every user, business and membership id has the `v97z_` prefix
 * (registered in test/helpers/fixture-prefixes.json, packet
 * 'V1-97 (W11-D116-CONNECTION-OWNER)'), every unique column written here
 * (User.email) embeds it, and every row is hard-deleted with
 * LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
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

const P = 'v97z_';

const ID = {
  ownerAdmin: `${P}owner_admin`, // Business.ownerId of bizA; holds an ADMIN membership of bizA (role defaults)
  ownerStaff: `${P}owner_staff`, // Business.ownerId of bizS; holds a STAFF membership of bizS, operations: none
  coOwner: `${P}coowner`, // OWNER membership of bizA and bizS; the recorded owner of neither
  bizA: `${P}biz_a`,
  bizS: `${P}biz_s`,
};
const USERS = [ID.ownerAdmin, ID.ownerStaff, ID.coOwner];

/** The recorded owners D-116 refuses, each on the business it is recorded as owning. */
const RECORDED_OWNERS = [
  { actor: ID.ownerAdmin, businessId: ID.bizA, label: 'recorded owner of bizA holding ADMIN' },
  { actor: ID.ownerStaff, businessId: ID.bizS, label: 'recorded owner of bizS holding STAFF' },
] as const;
const BUSINESSES = [ID.bizA, ID.bizS];

// Obviously fake OAuth configuration (no real client id or secret). The Google
// services read it when they are constructed.
const OAUTH_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: `${P}fake-client-id`,
  GOOGLE_CLIENT_SECRET: `${P}fake-client-secret-not-real`,
  GOOGLE_STATE_SECRET: `${P}fake-state-secret-not-real`,
  GMAIL_REDIRECT_URI: 'http://localhost:3001/api/commerce/gmail/callback',
  GOOGLE_SUITE_REDIRECT_URI: 'http://localhost:3001/api/connect/google-suite/callback',
  CALENDAR_REDIRECT_URI: 'http://localhost:3001/api/bookings/calendar/callback',
  DRIVE_REDIRECT_URI: 'http://localhost:3001/api/drive/callback',
};
const OAUTH_KEYS = [...Object.keys(OAUTH_ENV), 'GOOGLE_REDIRECT_URI'];
const savedEnv: Record<string, string | undefined> = {};

/** The stored SEO connection each business starts with (obviously fake tokens). */
const seoMeta = (businessId: string) => ({
  ga4: { propertyId: `${businessId}-property`, accessToken: `${businessId}-fake-ga4-access`, refreshToken: `${businessId}-fake-ga4-refresh` },
  whatsapp: { provider: 'mock', fromNumber: '+18685550100' },
  otherKey: `${P}keep-me`,
});

/** The refusal codes the rules answer (unchanged by D-116). */
const CODE = {
  google: 'GOOGLE_CONNECT_OWNER_ONLY',
  gmail: 'GMAIL_OWNER_ONLY',
  seo: 'SEO_CONNECTOR_OWNER_ONLY',
  profile: 'BUSINESS_PROFILE_OWNER_ONLY',
  subscription: 'SUBSCRIPTION_OWNER_ONLY',
};
const KEY_CONNECTOR_REFUSAL = 'Only the business owner or an admin can change provider connections or act through them';

let db: any;
let app: any;
const fetchCalls: string[] = [];
let realFetch: typeof globalThis.fetch | undefined;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM sync_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_audit_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM whatsapp_messages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM whatsapp_contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscription_payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** Put a business's metaData back to its seeded SEO and WhatsApp connections (raw SQL, as stored). */
async function resetMeta(businessId: string) {
  await db.$executeRawUnsafe('UPDATE businesses SET meta_data = $2::jsonb WHERE id = $1', businessId, JSON.stringify(seoMeta(businessId)));
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

/** Everything the doors here can write for one business, as stored. "Nothing written" means this text is identical. */
async function writtenStateText(businessId: string): Promise<string> {
  const q = async (sql: string) =>
    (await db.$queryRawUnsafe(sql, businessId)).map((r: { j: string }) => r.j);
  return JSON.stringify({
    business: await businessRowText(businessId),
    subscriptions: await q('SELECT row_to_json(s)::text AS j FROM subscriptions s WHERE s.business_id = $1 ORDER BY s.id'),
    payments: await q('SELECT row_to_json(p)::text AS j FROM subscription_payments p WHERE p.business_id = $1 ORDER BY p.id'),
    audit: await q('SELECT row_to_json(a)::text AS j FROM team_activity_logs a WHERE a.business_id = $1 ORDER BY a.id'),
    pendingGmail: await q('SELECT row_to_json(c)::text AS j FROM connector_accounts c WHERE c.business_id = $1 ORDER BY c.id'),
    connectorStatuses: await q('SELECT row_to_json(c)::text AS j FROM connector_statuses c WHERE c.business_id = $1 ORDER BY c.id'),
    connections: await q('SELECT row_to_json(c)::text AS j FROM integration_connections c WHERE c.business_id = $1 ORDER BY c.id'),
    connectorAudit: await q('SELECT row_to_json(c)::text AS j FROM connector_audit_logs c WHERE c.business_id = $1 ORDER BY c.id'),
    whatsappContacts: await q('SELECT row_to_json(c)::text AS j FROM whatsapp_contacts c WHERE c.business_id = $1 ORDER BY c.id'),
    whatsappMessages: await q('SELECT row_to_json(m)::text AS j FROM whatsapp_messages m WHERE m.business_id = $1 ORDER BY m.id'),
  });
}

const http = () => request(app.getHttpServer());
const as = (r: any, actor: string) => r.set('x-test-user', actor);

/** The Google consent doors assertGoogleConnectOwner guards (D-99), and the two Gmail doors (D-11). */
const GOOGLE_DOORS: Array<{ label: string; code: string; call: (actor: string, b: string) => any }> = [
  { label: 'POST /connect/google-suite/businesses/:b/auth-url (calendar, drive)', code: CODE.google, call: (a, b) => as(http().post(`/connect/google-suite/businesses/${b}/auth-url`), a).send({ services: ['calendar', 'drive'] }) },
  { label: 'GET /bookings/businesses/:b/calendar/auth-url', code: CODE.google, call: (a, b) => as(http().get(`/bookings/businesses/${b}/calendar/auth-url`), a) },
  { label: 'GET /drive/businesses/:b/auth-url', code: CODE.google, call: (a, b) => as(http().get(`/drive/businesses/${b}/auth-url`), a) },
];
const GMAIL_DOORS: Array<{ label: string; code: string; call: (actor: string, b: string) => any }> = [
  { label: 'POST /connect/google-suite/businesses/:b/auth-url (every service, gmail included)', code: CODE.gmail, call: (a, b) => as(http().post(`/connect/google-suite/businesses/${b}/auth-url`), a).send({}) },
  { label: 'GET /commerce/businesses/:b/gmail/auth-url', code: CODE.gmail, call: (a, b) => as(http().get(`/commerce/businesses/${b}/gmail/auth-url`), a) },
];

const seoConnectGa4 = (actor: string, b: string, body: Record<string, unknown>) =>
  as(http().post(`/seo/businesses/${b}/connectors/ga4`), actor).send(body);
const patchWhatsAppConfig = (actor: string, b: string, body: Record<string, unknown>) =>
  as(http().patch(`/whatsapp/businesses/${b}/config`), actor).send(body);
const whatsappSend = (actor: string, b: string) =>
  as(http().post(`/whatsapp/businesses/${b}/send`), actor).send({ to: '+18685550111', message: `${P}hello` });
const whatsappConversations = (actor: string, b: string) => as(http().get(`/whatsapp/businesses/${b}/conversations`), actor);
/** The business's stored WhatsApp conversations (what GET .../conversations lists). */
async function conversationCount(businessId: string): Promise<number> {
  const [row] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM whatsapp_contacts WHERE business_id = $1', businessId);
  return row.n;
}
const activatePlan = (actor: string, b: string) =>
  as(http().post(`/subscriptions/businesses/${b}/activate`), actor).send({ plan: 'KEYFLOW', currency: 'USD', gateway: 'manual' });
const keyConnectorConnect = (actor: string, b: string, providerKey: string, secret: string) =>
  as(http().post(`/key-connector/providers/${providerKey}/connect`), actor)
    .query({ businessId: b })
    .send({ providerKey, authData: { apiKey: secret } });

/** A refusal: 403 with `code`, and no Google consent URL (no signed state) anywhere in the body. */
function expectRefused(res: { status: number; body: any }, code: string, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: ${JSON.stringify(res.body)}`).toBe(code);
  const text = JSON.stringify(res.body);
  expect(text, `${label}: a consent URL in the refusal`).not.toContain('accounts.google.com');
  expect(text, `${label}: a signed state in the refusal`).not.toContain('state=');
}

/** An admitted consent: a Google URL whose signed state names `businessId`. */
function expectConsentFor(res: { status: number; body: any }, businessId: string, label: string) {
  expect([200, 201], `${label}: ${JSON.stringify(res.body)}`).toContain(res.status);
  const url = new URL(String(res.body.url ?? res.body.authUrl));
  expect(url.origin, label).toBe('https://accounts.google.com');
  // base64 of `${JSON payload}.${hex HMAC}`, the format every Google flow here signs.
  const decoded = Buffer.from(String(url.searchParams.get('state')), 'base64').toString('utf8');
  const claims = JSON.parse(decoded.slice(0, decoded.lastIndexOf('.')));
  expect(claims.businessId, label).toBe(businessId);
}

beforeAll(async () => {
  for (const key of OAUTH_KEYS) savedEnv[key] = process.env[key];
  delete process.env.GOOGLE_REDIRECT_URI;
  Object.assign(process.env, OAUTH_ENV);
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input instanceof Request ? input.url : input));
    throw new Error('v97z_: no provider traffic in this suite');
  }) as typeof globalThis.fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  // Google Suite consent (D-99, D-11).
  const { GoogleSuiteController } = await import('../src/core/connectors/google-suite.controller');
  const { GoogleSuiteService } = await import('../src/core/connectors/google-suite.service');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  // Bookings calendar consent (D-99).
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  // Drive consent (D-99).
  const { GoogleDriveController } = await import('../src/modules/google-drive/google-drive.controller');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { GeneratedDocumentService } = await import('../src/modules/google-drive/generated-document.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  // Commerce Gmail auth-url (D-11).
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  // SEO connectors (D-94).
  const { SeoController } = await import('../src/modules/seo/seo.controller');
  const { SeoAdminGuard } = await import('../src/modules/seo/seo-admin.guard');
  const { SeoService } = await import('../src/modules/seo/seo.service');
  const { SeoContentService } = await import('../src/modules/seo/seo-content.service');
  const { SeoGoogleAnalyticsService } = await import('../src/modules/seo/seo-ga4.service');
  const { SeoGoogleSearchConsoleService } = await import('../src/modules/seo/seo-gsc.service');
  const { FeatureFlagsService } = await import('../src/modules/feature-flags/feature-flags.service');
  // WhatsApp config and operations (D-11, R0-SEC2).
  const { WhatsAppController } = await import('../src/modules/whatsapp/whatsapp.controller');
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { KeyInboxService } = await import('../src/modules/key-inbox/key-inbox.service');
  const { StaffChatBridgeService } = await import('../src/modules/structure/staff-chat-bridge.service');
  // Plan changes (D-11).
  const { SubscriptionsController } = await import('../src/modules/subscriptions/subscriptions.controller');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  // KEY connector (D-111).
  const { KeyConnectorController } = await import('../src/modules/key-connector/key-connector.controller');
  const { KeyConnectorService } = await import('../src/modules/key-connector/key-connector.service');
  const { ProviderRegistryService } = await import('../src/modules/key-connector/providers/provider-registry.service');
  const { HealthCheckService } = await import('../src/modules/key-connector/health/health-check.service');
  const { SyncEngineService } = await import('../src/modules/key-connector/sync/sync-engine.service');
  const { AiGatewayService } = await import('../src/modules/key-connector/ai-gateway/ai-gateway.service');

  // The constructor parameter types tsc emits for KeyConnectorController (Nest
  // injects by them; vitest's esbuild transform emits none), left alone if present.
  if (!Reflect.getMetadata('design:paramtypes', KeyConnectorController)) {
    Reflect.defineMetadata('design:paramtypes', [KeyConnectorService, PrismaService], KeyConnectorController);
  }
  // The KEY connector health checker's HTTP client: throws if anything calls it (no route here does).
  const noNetwork = new Proxy({}, {
    get() {
      return () => {
        fetchCalls.push('key-connector health client');
        throw new Error('v97z_: no provider traffic in this suite');
      };
    },
  });

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [
      GoogleSuiteController,
      BookingsController,
      GoogleDriveController,
      CommerceController,
      SeoController,
      WhatsAppController,
      SubscriptionsController,
      KeyConnectorController,
    ],
    providers: [
      // Installed globally in production (app.module.ts).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // Present only because the controllers' other routes declare them; no case here reaches them.
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: {} },
      // Plan changes: the real service (PlanLimitGuard and CommerceController resolve it too).
      SubscriptionsService,
      // Google Suite consent: the real service; its registry and activity log are reached only by the callback.
      GoogleSuiteService,
      { provide: ConnectorRegistryService, useValue: {} },
      { provide: ConnectorActivityService, useValue: { record: async () => undefined } },
      // Bookings calendar and Drive consent: the real services (no connector: both are @Optional).
      CalendarService,
      GoogleDriveService,
      { provide: BookingsService, useValue: {} },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: BookingOptimizerService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: GeneratedDocumentService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      // Commerce Gmail auth-url: the real GmailService (the Google Suite consent with gmail resolves it too).
      GmailService,
      { provide: CommerceService, useValue: {} },
      { provide: InvoiceReceiptBuilderService, useValue: {} },
      { provide: TimeEntryService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
      // SEO connectors: the real guard (flag row absent: open) and the real GA4 and Search Console services;
      // ingestion is a stub and nothing here syncs.
      SeoAdminGuard,
      SeoGoogleAnalyticsService,
      SeoGoogleSearchConsoleService,
      { provide: FeatureFlagsService, useValue: { hasBypass: async () => ({ exists: false, comingSoon: false, bypass: false }) } },
      { provide: SeoService, useValue: { ingestAnalyticsData: async () => ({ updated: 0 }), ingestSearchConsoleData: async () => ({ updated: 0 }) } },
      { provide: SeoContentService, useValue: {} },
      // WhatsApp: the real service; the collaborators the config and operator routes never reach are stand-ins.
      WhatsAppService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: WebhookIngressLoggerService, useValue: { log: async () => undefined } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: KeyInboxService, useValue: {} },
      { provide: StaffChatBridgeService, useValue: {} },
      // KEY connector: the real service with its real registry, sync engine and AI gateway.
      {
        provide: KeyConnectorService,
        useFactory: () => {
          const registry = new ProviderRegistryService();
          return new KeyConnectorService(
            registry,
            new HealthCheckService(noNetwork as any, registry),
            new SyncEngineService(),
            new AiGatewayService(registry),
          );
        },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication({ logger: false });
  // Identity attachment only, for seeded v97z_ users. No guard is overridden.
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
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V97Z Biz A', ownerId: ID.ownerAdmin, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizS, name: 'V97Z Biz S', ownerId: ID.ownerStaff, currency: 'TTD' } });
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.ownerAdmin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.ownerStaff, businessId: ID.bizS, role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, operations: 'none' } },
    { userId: ID.coOwner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizS, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
  for (const businessId of BUSINESSES) await resetMeta(businessId);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (db) (await import('@keyflow/db')).setTenantContextProvider({ getCurrentBusinessId: () => undefined });
  if (realFetch) globalThis.fetch = realFetch;
  for (const key of OAUTH_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}, 60_000);

beforeEach(() => {
  fetchCalls.length = 0;
});

describe('W11-D116-CONNECTION-OWNER fixture sanity (real rows)', () => {
  it('[D116C-X01] seeded two businesses: bizA recorded as owned by a user holding an ADMIN membership of it, bizS recorded as owned by a user holding a STAFF membership of it with operations: none, and a co-owner holding an OWNER membership of both; no plan, connection, pending Gmail grant or conversation anywhere', async () => {
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(4);
    const roles = await db.$queryRawUnsafe(
      `SELECT b.id AS business_id, b.owner_id, m.user_id, m.role, m.permission_scopes->>'operations' AS operations
       FROM businesses b JOIN memberships m ON m.business_id = b.id WHERE b.id LIKE ${sqlLikePrefix(P)} ORDER BY b.id, m.user_id`,
    );
    expect(roles).toEqual([
      { business_id: ID.bizA, owner_id: ID.ownerAdmin, user_id: ID.coOwner, role: 'OWNER', operations: null },
      { business_id: ID.bizA, owner_id: ID.ownerAdmin, user_id: ID.ownerAdmin, role: 'ADMIN', operations: null },
      { business_id: ID.bizS, owner_id: ID.ownerStaff, user_id: ID.coOwner, role: 'OWNER', operations: null },
      { business_id: ID.bizS, owner_id: ID.ownerStaff, user_id: ID.ownerStaff, role: 'STAFF', operations: 'none' },
    ]);
    for (const businessId of BUSINESSES) {
      const state = JSON.parse(await writtenStateText(businessId));
      for (const key of ['subscriptions', 'payments', 'audit', 'pendingGmail', 'connectorStatuses', 'connections', 'connectorAudit', 'whatsappContacts', 'whatsappMessages']) {
        expect(state[key], `${businessId} ${key}`).toEqual([]);
      }
    }
  });
});

describe('W11-D116-CONNECTION-OWNER: a Google connection is started by the holder of an OWNER membership only (owner rulings D-116, D-125, D-99, D-11)', () => {
  it('[D116C-G01] RED-BEFORE (owner ruling D-116): the recorded owner (Business.ownerId) holding ADMIN and the recorded owner holding STAFF are refused 403 GOOGLE_CONNECT_OWNER_ONLY by the Google Suite consent without gmail, the bookings calendar consent and the Drive consent on the business they are recorded as owning: no consent URL, no signed state, nothing stored, Google handed nothing', async () => {
    const answered: Record<string, string> = {};
    for (const { actor, businessId, label } of RECORDED_OWNERS) {
      const before = await writtenStateText(businessId);
      for (const door of GOOGLE_DOORS) {
        const res = await door.call(actor, businessId);
        answered[`${label}: ${door.label}`] = `${res.status} ${res.body?.code ?? (res.body?.url || res.body?.authUrl ? 'consent URL' : JSON.stringify(res.body))}`;
        if (res.status === 403) expectRefused(res, door.code, `${label}: ${door.label}`);
      }
      expect(await writtenStateText(businessId), `${label}: nothing stored`).toBe(before);
    }
    expect(answered).toEqual(Object.fromEntries(RECORDED_OWNERS.flatMap(({ label }) => GOOGLE_DOORS.map((d) => [`${label}: ${d.label}`, `403 ${d.code}`]))));
    expect(fetchCalls, 'Google handed nothing').toEqual([]);
  });

  it('[D116C-G02] RED-BEFORE (owner rulings D-116, D-11): the recorded owner holding ADMIN and the recorded owner holding STAFF are refused 403 GMAIL_OWNER_ONLY by the Google Suite consent with gmail and by GET /commerce/businesses/:b/gmail/auth-url: no consent URL, no signed state, no pending Gmail grant, the mailbox columns unchanged, Google handed nothing', async () => {
    const answered: Record<string, string> = {};
    for (const { actor, businessId, label } of RECORDED_OWNERS) {
      const before = await writtenStateText(businessId);
      for (const door of GMAIL_DOORS) {
        const res = await door.call(actor, businessId);
        answered[`${label}: ${door.label}`] = `${res.status} ${res.body?.code ?? (res.body?.url || res.body?.authUrl ? 'consent URL' : JSON.stringify(res.body))}`;
        if (res.status === 403) expectRefused(res, door.code, `${label}: ${door.label}`);
      }
      expect(await writtenStateText(businessId), `${label}: nothing stored`).toBe(before);
    }
    expect(answered).toEqual(Object.fromEntries(RECORDED_OWNERS.flatMap(({ label }) => GMAIL_DOORS.map((d) => [`${label}: ${d.label}`, `403 ${d.code}`]))));
    expect(fetchCalls, 'Google handed nothing').toEqual([]);
  });

  it('[D116C-G03] CONTROL (owner ruling D-125): the co-owner (an OWNER membership, not Business.ownerId) gets every one of the five consent URLs on both businesses, each signed state naming the route business; nothing stored, Google handed nothing', async () => {
    for (const businessId of BUSINESSES) {
      const before = await writtenStateText(businessId);
      for (const door of [...GOOGLE_DOORS, ...GMAIL_DOORS]) {
        expectConsentFor(await door.call(ID.coOwner, businessId), businessId, `co-owner on ${businessId}: ${door.label}`);
      }
      expect(await writtenStateText(businessId), `co-owner on ${businessId}: a consent URL stores nothing`).toBe(before);
    }
    expect(fetchCalls).toEqual([]);
  });
});

describe('W11-D116-CONNECTION-OWNER: Google Analytics and Search Console are connected by the holder of an OWNER membership only (owner rulings D-116, D-125, D-94)', () => {
  it('[D116C-S01] RED-BEFORE (owner rulings D-116, D-94): POST /seo/businesses/:b/connectors/ga4 refuses the recorded owner holding ADMIN and the recorded owner holding STAFF 403 SEO_CONNECTOR_OWNER_ONLY: the stored GA4 connection and its tokens unchanged (the Business row byte-identical), Google handed nothing', async () => {
    const answered: Record<string, string> = {};
    const unchanged: Record<string, boolean> = {};
    for (const { actor, businessId, label } of RECORDED_OWNERS) {
      await resetMeta(businessId);
      const before = await writtenStateText(businessId);
      const res = await seoConnectGa4(actor, businessId, {
        propertyId: `${P}their-own-property`, accessToken: `${P}their-fake-ga4-access`, refreshToken: `${P}their-fake-ga4-refresh`,
      });
      answered[label] = `${res.status} ${res.body?.code ?? JSON.stringify(res.body)}`;
      if (res.status === 403) expectRefused(res, CODE.seo, label);
      unchanged[label] = (await writtenStateText(businessId)) === before;
    }
    expect(answered).toEqual(Object.fromEntries(RECORDED_OWNERS.map(({ label }) => [label, `403 ${CODE.seo}`])));
    expect(unchanged, 'the Business row (metaData.ga4 and its tokens) byte-identical').toEqual(Object.fromEntries(RECORDED_OWNERS.map(({ label }) => [label, true])));
    expect(fetchCalls, 'Google handed nothing').toEqual([]);
  });

  it('[D116C-S02] CONTROL (owner ruling D-125): the co-owner connects GA4 on both businesses (201 connected), the saved connection is the one it sent, and Google is handed nothing', async () => {
    try {
      for (const businessId of BUSINESSES) {
        await resetMeta(businessId);
        const sent = { propertyId: `${businessId}-coowner-property`, accessToken: `${businessId}-coowner-fake-access`, refreshToken: `${businessId}-coowner-fake-refresh` };
        const res = await seoConnectGa4(ID.coOwner, businessId, sent);
        expect([res.status, res.body], businessId).toEqual([201, { connected: true, propertyId: sent.propertyId }]);
        const rows = await db.$queryRawUnsafe(`SELECT meta_data->'ga4' AS ga4, meta_data->>'otherKey' AS other FROM businesses WHERE id = $1`, businessId);
        expect(rows[0].ga4).toEqual({ ...sent, connectedAt: expect.any(String) });
        expect(rows[0].other).toBe(`${P}keep-me`);
      }
      expect(fetchCalls).toEqual([]);
    } finally {
      for (const businessId of BUSINESSES) await resetMeta(businessId);
    }
  });
});

describe('W11-D116-CONNECTION-OWNER: the WhatsApp sending identity is the OWNER-membership holder\'s (owner rulings D-116, D-125, D-11; R0-SEC2)', () => {
  it('[D116C-W01] RED-BEFORE (owner rulings D-116, D-11): PATCH /whatsapp/businesses/:b/config refuses the recorded owner holding ADMIN and the recorded owner holding STAFF 403 BUSINESS_PROFILE_OWNER_ONLY with the Business row byte-identical and no provider traffic', async () => {
    const answered: Record<string, string> = {};
    const unchanged: Record<string, boolean> = {};
    for (const { actor, businessId, label } of RECORDED_OWNERS) {
      await resetMeta(businessId);
      const before = await writtenStateText(businessId);
      const res = await patchWhatsAppConfig(actor, businessId, { provider: 'mock', fromNumber: '+18685550177' });
      answered[label] = `${res.status} ${res.body?.code ?? JSON.stringify(res.body)}`;
      if (res.status === 403) expectRefused(res, CODE.profile, label);
      unchanged[label] = (await writtenStateText(businessId)) === before;
    }
    expect(answered).toEqual(Object.fromEntries(RECORDED_OWNERS.map(({ label }) => [label, `403 ${CODE.profile}`])));
    expect(unchanged, 'the Business row (metaData.whatsapp) byte-identical').toEqual(Object.fromEntries(RECORDED_OWNERS.map(({ label }) => [label, true])));
    expect(fetchCalls).toEqual([]);
  });

  it("[D116C-W02] RED-BEFORE (owner ruling D-116; R0-SEC2 review CR-SEC2-1): WhatsAppOperationsScopeGuard no longer lets the recorded owner holding STAFF with operations: none past ModuleScopeGuard: POST /whatsapp/businesses/:b/send and GET .../conversations answer ModuleScopeGuard's 403 ('operations requires write' / 'read access (you have none)'), no conversation or message written, no provider traffic", async () => {
    await resetMeta(ID.bizS);
    const before = await writtenStateText(ID.bizS);
    const sent = await whatsappSend(ID.ownerStaff, ID.bizS);
    const read = await whatsappConversations(ID.ownerStaff, ID.bizS);
    expect([sent.status, sent.body?.message], JSON.stringify(sent.body)).toEqual([403, 'Insufficient permissions: operations requires write access (you have none)']);
    expect([read.status, read.body?.message], JSON.stringify(read.body)).toEqual([403, 'Insufficient permissions: operations requires read access (you have none)']);
    expect(await writtenStateText(ID.bizS), 'nothing written').toBe(before);
    expect(fetchCalls).toEqual([]);
  });

  it('[D116C-W03] CONTROL (owner ruling D-125; ADMIN role defaults): the co-owner saves the WhatsApp config on both businesses (200) and reads their conversations (200); the recorded owner holding ADMIN keeps the inbox read its ADMIN role grants (operations: admin, 200); no provider traffic', async () => {
    try {
      for (const businessId of BUSINESSES) {
        await resetMeta(businessId);
        const saved = await patchWhatsAppConfig(ID.coOwner, businessId, { provider: 'mock', fromNumber: '+18685550188' });
        expect([saved.status, saved.body], businessId).toEqual([200, { success: true }]);
        const rows = await db.$queryRawUnsafe(`SELECT meta_data->'whatsapp'->>'fromNumber' AS from_number FROM businesses WHERE id = $1`, businessId);
        expect(rows[0].from_number, businessId).toBe('+18685550188');
        const read = await whatsappConversations(ID.coOwner, businessId);
        expect(read.status, `${businessId}: ${JSON.stringify(read.body)}`).toBe(200);
        expect(read.body.length, businessId).toBe(await conversationCount(businessId));
      }
      const adminRead = await whatsappConversations(ID.ownerAdmin, ID.bizA);
      expect(adminRead.status, JSON.stringify(adminRead.body)).toBe(200);
      expect(adminRead.body.length).toBe(await conversationCount(ID.bizA));
      expect(fetchCalls).toEqual([]);
    } finally {
      for (const businessId of BUSINESSES) await resetMeta(businessId);
    }
  });

  it("[D116C-W04] RED-BEFORE (owner ruling D-116; review SEC-D116C-1; R0-SEC2 writer view): GET /whatsapp/businesses/:b/config and GET .../status answer the recorded owner holding ADMIN the masked view (no phoneNumberId, every credential last4 null, status platformId the fromNumber) and the recorded owner holding STAFF the masked config (its operations: none status read refused by ModuleScopeGuard); the co-owner gets the writer view (phoneNumberId, each credential's last 4, platformId the phoneNumberId); no response carries a credential, no provider traffic", async () => {
    const fromNumber = '+18685550199';
    // Obviously fake credentials (non-hex letters, the suite prefix), each at least 12 characters so a writer sees its last 4.
    const secretsFor = (businessId: string) => ({
      accessToken: `${businessId}_fake_meta_access_not_real_zzzz`,
      authToken: `${businessId}_fake_twilio_auth_not_real_yyyy`,
      accountSid: `${businessId}_fake_twilio_sid_not_real_xxxx`,
    });
    const phoneNumberIdFor = (businessId: string) => `${businessId}_pnid_1234567`;
    const expectNoCredential = (body: unknown, businessId: string, label: string) => {
      const text = JSON.stringify(body);
      for (const value of Object.values(secretsFor(businessId))) expect(text.includes(value), `${label}: a credential in the body`).toBe(false);
    };
    const getConfig = (actor: string, b: string) => as(http().get(`/whatsapp/businesses/${b}/config`), actor);
    const getStatus = (actor: string, b: string) => as(http().get(`/whatsapp/businesses/${b}/status`), actor);
    try {
      for (const businessId of BUSINESSES) {
        await resetMeta(businessId);
        // The co-owner (D-125) stores a Meta config with all three credentials and a phoneNumberId.
        const saved = await patchWhatsAppConfig(ID.coOwner, businessId, {
          provider: 'meta', phoneNumberId: phoneNumberIdFor(businessId), fromNumber, ...secretsFor(businessId),
        });
        expect([saved.status, saved.body], businessId).toEqual([200, { success: true }]);
      }

      // The recorded owner holding ADMIN on bizA: the masked config view and the sending number on status.
      const adminConfig = await getConfig(ID.ownerAdmin, ID.bizA);
      expect(adminConfig.status, JSON.stringify(adminConfig.body)).toBe(200);
      expect(adminConfig.body.data).not.toHaveProperty('phoneNumberId');
      expect(adminConfig.body.data).toEqual({
        provider: 'meta',
        fromNumber,
        credentials: {
          accessToken: { configured: true, last4: null },
          authToken: { configured: true, last4: null },
          accountSid: { configured: true, last4: null },
        },
      });
      expect(JSON.stringify(adminConfig.body).includes(phoneNumberIdFor(ID.bizA)), 'ADMIN-holding recorded owner: phoneNumberId on config').toBe(false);
      expectNoCredential(adminConfig.body, ID.bizA, 'ADMIN-holding recorded owner GET config');
      const adminStatus = await getStatus(ID.ownerAdmin, ID.bizA);
      expect(adminStatus.status, JSON.stringify(adminStatus.body)).toBe(200);
      expect(adminStatus.body).toEqual({
        connected: true,
        destination: { id: `${ID.bizA}:whatsapp`, platformId: fromNumber, displayName: fromNumber },
      });
      expect(JSON.stringify(adminStatus.body).includes(phoneNumberIdFor(ID.bizA)), 'ADMIN-holding recorded owner: phoneNumberId on status').toBe(false);

      // The recorded owner holding STAFF (operations: none) on bizS: the masked config; status is ModuleScopeGuard's 403.
      const staffConfig = await getConfig(ID.ownerStaff, ID.bizS);
      expect(staffConfig.status, JSON.stringify(staffConfig.body)).toBe(200);
      expect(staffConfig.body.data).not.toHaveProperty('phoneNumberId');
      for (const k of ['accessToken', 'authToken', 'accountSid'] as const) {
        expect(staffConfig.body.data.credentials[k], `STAFF-holding recorded owner: ${k}`).toEqual({ configured: true, last4: null });
      }
      expect(JSON.stringify(staffConfig.body).includes(phoneNumberIdFor(ID.bizS)), 'STAFF-holding recorded owner: phoneNumberId on config').toBe(false);
      expectNoCredential(staffConfig.body, ID.bizS, 'STAFF-holding recorded owner GET config');
      const staffStatus = await getStatus(ID.ownerStaff, ID.bizS);
      expect([staffStatus.status, staffStatus.body?.message], JSON.stringify(staffStatus.body)).toEqual([403, 'Insufficient permissions: operations requires read access (you have none)']);
      expect(JSON.stringify(staffStatus.body).includes(phoneNumberIdFor(ID.bizS)), 'STAFF-holding recorded owner: phoneNumberId on status').toBe(false);

      // CONTROL (D-125): the co-owner gets the writer view on both, so the masked answers above are not vacuous.
      for (const businessId of BUSINESSES) {
        const secrets = secretsFor(businessId);
        const config = await getConfig(ID.coOwner, businessId);
        expect(config.status, `${businessId}: ${JSON.stringify(config.body)}`).toBe(200);
        expect(config.body.data, businessId).toEqual({
          provider: 'meta',
          fromNumber,
          phoneNumberId: phoneNumberIdFor(businessId),
          credentials: {
            accessToken: { configured: true, last4: secrets.accessToken.slice(-4) },
            authToken: { configured: true, last4: secrets.authToken.slice(-4) },
            accountSid: { configured: true, last4: secrets.accountSid.slice(-4) },
          },
        });
        expectNoCredential(config.body, businessId, `co-owner GET config on ${businessId}`);
        const status = await getStatus(ID.coOwner, businessId);
        expect(status.status, `${businessId}: ${JSON.stringify(status.body)}`).toBe(200);
        expect(status.body.destination.platformId, businessId).toBe(phoneNumberIdFor(businessId));
      }
      expect(fetchCalls).toEqual([]);
    } finally {
      for (const businessId of BUSINESSES) await resetMeta(businessId);
    }
  });
});

describe('W11-D116-CONNECTION-OWNER: plan changes are the OWNER-membership holder\'s (owner rulings D-116, D-125, D-11)', () => {
  it('[D116C-P01] RED-BEFORE (owner rulings D-116, D-11): POST /subscriptions/businesses/:b/activate refuses the recorded owner holding ADMIN and the recorded owner holding STAFF 403 SUBSCRIPTION_OWNER_ONLY: no subscription row, no subscription payment, no audit row', async () => {
    const answered: Record<string, string> = {};
    const unchanged: Record<string, boolean> = {};
    for (const { actor, businessId, label } of RECORDED_OWNERS) {
      const before = await writtenStateText(businessId);
      const res = await activatePlan(actor, businessId);
      answered[label] = `${res.status} ${res.body?.code ?? `${res.body?.plan} ${res.body?.status}`}`;
      if (res.status === 403) {
        expectRefused(res, CODE.subscription, label);
        for (const key of ['id', 'plan', 'status']) expect(res.body, label).not.toHaveProperty(key);
      }
      unchanged[label] = (await writtenStateText(businessId)) === before;
    }
    expect(answered).toEqual(Object.fromEntries(RECORDED_OWNERS.map(({ label }) => [label, `403 ${CODE.subscription}`])));
    expect(unchanged, 'nothing written (subscriptions, payments, audit rows)').toEqual(Object.fromEntries(RECORDED_OWNERS.map(({ label }) => [label, true])));
    for (const businessId of BUSINESSES) {
      expect(await db.subscription.count({ where: { businessId } }), businessId).toBe(0);
      expect(await db.teamActivityLog.count({ where: { businessId } }), businessId).toBe(0);
    }
  });

  it('[D116C-P02] CONTROL (owner ruling D-125): the co-owner activates a plan on bizA (201 ACTIVE): one subscription row and one team_activity_logs row naming the co-owner', async () => {
    const res = await activatePlan(ID.coOwner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizA, plan: 'KEYFLOW', status: 'ACTIVE' });
    const live = await db.subscription.findMany({ where: { businessId: ID.bizA, status: 'ACTIVE' } });
    expect(live.map((s: { id: string; plan: string }) => [s.id, s.plan])).toEqual([[res.body.id, 'KEYFLOW']]);
    const audit = await db.teamActivityLog.findMany({ where: { businessId: ID.bizA, userId: ID.coOwner } });
    expect(audit.map((a: { action: string; entityId: string | null }) => [a.action, a.entityId])).toEqual([['subscription_activated', res.body.id]]);
  });
});

describe('W11-D116-CONNECTION-OWNER: KEY connector connections are managed by an OWNER or ADMIN membership (owner rulings D-116, D-125, D-111)', () => {
  it("[D116C-K01] RED-BEFORE (owner rulings D-116, D-111): POST /key-connector/providers/:key/connect refuses the recorded owner holding STAFF 403 ('Only the business owner or an admin can change provider connections or act through them'): no connection, no connector audit row, the credential it sent nowhere in the body", async () => {
    const secret = `${P}fake-credential-staff-owner-not-a-real-key`;
    const before = await writtenStateText(ID.bizS);
    const res = await keyConnectorConnect(ID.ownerStaff, ID.bizS, 'mailchimp', secret);
    expect([res.status, res.body?.message], JSON.stringify(res.body)).toEqual([403, KEY_CONNECTOR_REFUSAL]);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(await writtenStateText(ID.bizS), 'nothing written').toBe(before);
    expect(fetchCalls).toEqual([]);
  });

  it('[D116C-K02] CONTROL (owner rulings D-111, D-125): the recorded owner holding ADMIN is admitted as an ADMIN (201, the connection on bizA, audited under it) and the co-owner connects on bizS (201, audited under the co-owner); neither answer carries the stored credential', async () => {
    const admitted: Array<[string, string, string, string]> = [
      [ID.ownerAdmin, ID.bizA, 'mailchimp', `${P}fake-credential-admin-owner-not-a-real-key`],
      [ID.coOwner, ID.bizS, 'typeform', `${P}fake-credential-coowner-not-a-real-key`],
    ];
    for (const [actor, businessId, providerKey, secret] of admitted) {
      const res = await keyConnectorConnect(actor, businessId, providerKey, secret);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.data).toMatchObject({ businessId, providerKey });
      expect(JSON.stringify(res.body)).not.toContain(secret);
      const connections = await db.$queryRawUnsafe(
        `SELECT business_id, auth_data FROM integration_connections WHERE provider_key = $1 AND business_id = $2`, providerKey, businessId);
      expect(connections, `${providerKey} connection on ${businessId}`).toEqual([{ business_id: businessId, auth_data: { apiKey: secret } }]);
      const audit = await db.$queryRawUnsafe(`SELECT user_id, action FROM connector_audit_logs WHERE business_id = $1 AND user_id = $2`, businessId, actor);
      expect(audit, businessId).toEqual([{ user_id: actor, action: 'connect_provider' }]);
    }
    expect(fetchCalls).toEqual([]);
  });
});
