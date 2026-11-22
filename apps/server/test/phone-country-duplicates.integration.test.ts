/**
 * FU-PHONE-COUNTRY-DUPLICATES (V1-71; owner ruling D-211, 'phonecountry': phone duplicates match
 * only within the business's own country code) — against a REAL database, through the HTTP routes.
 *
 * WA-E164-SERVER stores a contact's phone in E.164, read under the business's country
 * (Business.country; unset is Trinidad and Tobago, +1 868), and refuses a variant of a live
 * contact's number on POST/PATCH .../contacts and in the CSV import. Three doors still read a phone
 * another way:
 *
 *   1. The phone duplicate rule of SWP-CRM-SEARCH (crm-duplicate.util: samePhoneKey and the list
 *      search's phoneSearchKeys) read a national number behind ANY country calling code
 *      (samePhoneNumber). In a Trinidad and Tobago business a search for '+44 868 555 0101' (a UK
 *      number) found the customer saved as '868-555-0101', and a search for '+592 555 0102'
 *      (Guyana) found the one saved as the seven-digit local '555-0102'; the add-contact form's
 *      duplicate check is built on that search. Now a number written without a country code is
 *      read in the business's country only.
 *   2. EntityResolutionService (every connector's contact door: the form webhooks, WhatsApp,
 *      payments, calendars, social, the inbox) matched on the `phone` column after its own
 *      reading ('712-3401' became '+7123401', any ten digits became +1) and created contacts
 *      with no phone or email key, so the identity uniques never saw them: a variant of a live
 *      contact's number became a second contact, and POST .../contacts then created a third.
 *   3. The Google and Outlook contact syncs keyed a phone as typed ('868-555-0101' is
 *      '8685550101'), so a person whose number a live contact holds in another spelling was
 *      created again, and a person matched by email took a number another contact holds.
 *
 * All three now use the key the CRM write stores: the phone read under the business's country
 * (contactPhoneForStorage) and its identity key (contactPhoneKey), matched against the live
 * holders of that number (livePhoneHolderIds: the E.164 key, or a key stored before E.164 that
 * reads as it under the business's country). And apps/server/scripts/backfill-phone-keys.ts
 * (`pnpm backfill:phone-keys`, dry run by default) rewrites the keys stored before E.164 to the
 * key a write stores now, leaving every number two live contacts hold for a merge.
 *
 * Nothing on the HTTP, authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor,
 * TenantInterceptor, ValidationPipe, GlobalHttpExceptionFilter, CrmController, CrmService,
 * CrmStatsService, ContactAuditService, ConnectController, GoogleContactsSyncService,
 * OutlookContactsSyncService, FormWebhookController, WebhookFormConnector,
 * ConnectorCredentialsService, WebhookIngressLoggerService and EntityResolutionService are real
 * against DATABASE_URL. The stand-ins: identity attachment (a test middleware reads `x-test-user`
 * and loads that seeded user row, as AuthMiddleware would after token verification); the
 * connector registry (a lookup answering the real WebhookFormConnector); the provider APIs (People
 * API, Microsoft Graph: a stubbed fetch that records every outbound request and refuses any other
 * host, so no request leaves the process) and the OAuth token helpers (a fake token); side
 * channels off the contact write (timeline, caches, flow, plan limit), and the controllers' other
 * collaborators, never on the paths asserted here.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v71l_` prefix (rows the routes create are
 * deleted by their business id) and is hard-deleted by raw SQL in beforeAll and afterAll. The
 * webhook secret is built at run time. No $transaction wrapping.
 *
 * Cases tagged RED-BEFORE fail on the packet's source base (94283786); CONTROL cases pass before
 * and after.
 */
import 'reflect-metadata';
import path from 'path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71l_';
const SERVER_DIR = path.resolve(__dirname, '..');

const ID = {
  owner: `${P}owner`, // OWNER of every business here
  bizS: `${P}bizS`, // the list search (no country set: Trinidad and Tobago)
  bizGY: `${P}bizGY`, // a Guyana business (its own local numbers are +592)
  bizG: `${P}bizG`, // Google Contacts sync
  bizO: `${P}bizO`, // Outlook Contacts sync
  bizW: `${P}bizW`, // the webhook form (EntityResolutionService)
  bizB: `${P}bizB`, // the backfill (Trinidad and Tobago)
  bizBG: `${P}bizBG`, // the backfill (Guyana)
  bizBX: `${P}bizBX`, // the backfill ('Atlantis': no dialling rules)
  bizBO: `${P}bizBO`, // outside the backfill run (--business scopes it)
  bizBC: `${P}bizBC`, // the backfill run the documented way (pnpm backfill:phone-keys)
};

/** The form webhook's per-business secret, built at run time (never a literal). */
const WEBHOOK_SECRET = [P, 'form', 'hook', String(process.pid), String(Date.now())].join('-');
const WEBHOOK_TYPE = 'webhook_form';

let db: any;
let app: any;
let asyncWrites: ReturnType<typeof trackAsyncWrites> | undefined;
let entityResolution: any;

/** What the stubbed provider APIs answer on the next sync. */
let peopleConnections: Array<Record<string, unknown>> = [];
let graphContacts: Array<Record<string, unknown>> = [];
const outbound: string[] = [];
const fetchStub = vi.fn(async (url: string) => {
  const target = String(url);
  outbound.push(target);
  const body = target.startsWith('https://people.googleapis.com/')
    ? { connections: peopleConnections }
    : target.startsWith('https://graph.microsoft.com/')
      ? { value: graphContacts }
      : null;
  if (!body) throw new Error(`unexpected outbound request: ${target}`);
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
});

const CONTACT_TABLES = [
  'contact_audit_entries',
  'contact_events',
  'activities',
  'team_activity_logs',
  'contact_external_mappings',
  'contact_sync_audits',
  'contact_data_issues',
  'lead_form_submissions',
  'lead_forms',
  'contact_shares',
  'contacts',
];

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const table of [...CONTACT_TABLES, 'webhook_delivery_logs', 'connector_statuses']) {
    try { await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`); } catch { /* best-effort */ }
  }
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Remove every contact (and what hangs off it) of one business; its connector rows stay. */
async function clearContacts(businessId: string) {
  if (asyncWrites) await asyncWrites.drain();
  for (const table of CONTACT_TABLES) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id = $1`, businessId);
  }
}

/** A contact as it was stored before WA-E164-SERVER (or by a writer that kept no key), seeded directly. */
function seedContact(id: string, businessId: string, firstName: string, phone: string | null, phoneNormalized: string | null, extra: Record<string, unknown> = {}) {
  return db.contact.create({
    data: { id, businessId, firstName, lastName: `${P}seed`, ownerId: ID.owner, phone, phoneNormalized, ...extra },
  });
}

/** The business's live contacts (raw SQL: no extension), by id. */
async function liveContacts(businessId: string): Promise<Array<{ id: string; first_name: string | null; phone: string | null; phone_normalized: string | null; email: string | null; email_normalized: string | null }>> {
  return db.$queryRawUnsafe(
    `SELECT id, first_name, phone, phone_normalized, email, email_normalized FROM contacts WHERE business_id = $1 AND deleted_at IS NULL ORDER BY id`,
    businessId,
  );
}

async function keyOf(id: string): Promise<string | null | undefined> {
  const rows: Array<{ phone_normalized: string | null }> = await db.$queryRawUnsafe(`SELECT phone_normalized FROM contacts WHERE id = $1`, id);
  return rows[0]?.phone_normalized;
}

const agent = () => request(app.getHttpServer());

function postContact(businessId: string, body: Record<string, unknown>) {
  return agent().post(`/crm/businesses/${businessId}/contacts`).set('x-test-user', ID.owner).send({ lastName: `${P}api`, ...body });
}

/** GET the list with ?search=; answers the ids returned, sorted. */
async function search(businessId: string, term: string): Promise<string[]> {
  const res = await agent()
    .get(`/crm/businesses/${businessId}/contacts`)
    .query({ take: '100', search: term })
    .set('x-test-user', ID.owner);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  for (const c of res.body.contacts as Array<{ businessId: string }>) expect(c.businessId).toBe(businessId);
  return (res.body.contacts as Array<{ id: string }>).map((c) => c.id).sort();
}

function checkDuplicates(businessId: string, contacts: Array<Record<string, string>>) {
  return agent()
    .post(`/crm/businesses/${businessId}/contacts/check-duplicates`)
    .set('x-test-user', ID.owner)
    .send({ contacts });
}

/** POST /webhooks/forms/:businessId/webhook_form, signed with the business's secret. */
function submitForm(body: Record<string, unknown>) {
  return agent()
    .post(`/webhooks/forms/${ID.bizW}/${WEBHOOK_TYPE}`)
    .set('x-keyflow-signature', WEBHOOK_SECRET)
    .send({ formId: `${P}form`, ...body });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { FormWebhookController } = await import('../src/core/connectors/form-webhook.controller');
  const { WebhookFormConnector } = await import('../src/core/connectors/implementations/webhook-form.connector');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
  const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
  const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
  const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
  const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
  const { GoogleFormsService } = await import('../src/modules/connect/google-forms.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { SignatureParserService } = await import('../src/modules/connect/signature-parser.service');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');

  // ---- the real HTTP paths (wired before any row is seeded) --------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, ConnectController, FormWebhookController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmStatsService,
      CrmService,
      ContactAuditService,
      EntityResolutionService,
      ConnectorCredentialsService,
      WebhookIngressLoggerService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // The form connector is the real one over the real resolver; the registry is the lookup that hands it out.
      {
        provide: WebhookFormConnector,
        useFactory: (prisma: unknown, events: unknown, resolver: unknown, credentials: unknown) =>
          new (WebhookFormConnector as any)(prisma, events, resolver, credentials),
        inject: [PrismaService, EventEmitter2, EntityResolutionService, ConnectorCredentialsService],
      },
      {
        provide: ConnectorRegistryService,
        useFactory: (connector: unknown) => ({ get: (type: string) => (type === WEBHOOK_TYPE ? connector : null) }),
        inject: [WebhookFormConnector],
      },
      // The two contact syncs over the same real PrismaService, CrmService and ContactAuditService.
      {
        provide: GoogleContactsSyncService,
        useFactory: (prisma: unknown, crm: unknown, audit: unknown) => new (GoogleContactsSyncService as any)(prisma, crm, audit),
        inject: [PrismaService, CrmService, ContactAuditService],
      },
      {
        provide: OutlookContactsSyncService,
        useFactory: (prisma: unknown, crm: unknown, audit: unknown) => new (OutlookContactsSyncService as any)(prisma, crm, audit),
        inject: [PrismaService, CrmService, ContactAuditService],
      },
      // Side channels off the contact write; the claims here are the rows.
      { provide: CrmTimelineService, useValue: { logEvent: async () => undefined, logContactEvent: async () => undefined } },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: CrmDataQualityService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: CrmRelationshipHealthService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ConversationAiService, useValue: {} },
      { provide: CrmNetworkService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
      // The connect controller's other collaborators (routes not used here).
      { provide: ConnectorFormMappingService, useValue: {} },
      { provide: GoogleFormsMappingService, useValue: {} },
      { provide: GoogleFormsService, useValue: {} },
      { provide: ContactSyncService, useValue: {} },
      { provide: SignatureParserService, useValue: {} },
      { provide: GoogleBusinessProfileService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v71l_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // The global interceptor that binds the request's member and verified tenant (app.module.ts).
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  // The OAuth token helpers read and refresh tokens on the business row; the syncs only need a token
  // to send to the stubbed provider API.
  (app.get(GoogleContactsSyncService) as any).tokens = { getValidAccessToken: async () => 'fake-access-token' };
  (app.get(OutlookContactsSyncService) as any).tokens = { getValidAccessToken: async () => 'fake-access-token' };
  entityResolution = app.get(EntityResolutionService);
  vi.stubGlobal('fetch', fetchStub);
  asyncWrites = trackAsyncWrites([[ContactAuditService.prototype, 'write']]);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  const countries: Record<string, string | null> = {
    [ID.bizS]: null,
    [ID.bizGY]: 'Guyana',
    [ID.bizG]: null,
    [ID.bizO]: null,
    [ID.bizW]: null,
    [ID.bizB]: null,
    [ID.bizBG]: 'Guyana',
    [ID.bizBX]: 'Atlantis',
    [ID.bizBO]: null,
    [ID.bizBC]: null,
  };
  for (const [biz, country] of Object.entries(countries)) {
    await db.business.create({ data: { id: biz, name: `V71L ${biz}`, ownerId: ID.owner, country } });
    await db.membership.create({ data: { id: `${P}m_owner_${biz}`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
  }
  // The Outlook account a sync links contacts to is its binder's (SWEEP-P0-SCOPES WPH2-1): the owner's.
  await db.connectorStatus.create({ data: { businessId: ID.bizO, connectorType: 'outlook_contacts', status: 'connected', metadata: { boundBy: ID.owner } } });
  // The form webhook's per-business secret, stored encrypted by the real credentials service.
  await app.get(ConnectorCredentialsService).setCredentials(ID.bizW, WEBHOOK_TYPE, { webhookSecret: WEBHOOK_SECRET });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (asyncWrites) await asyncWrites.drain();
  asyncWrites?.restore();
  if (app) await app.close();
  if (db) await cleanup();
});

// -----------------------------------------------------------------------------
// 1. The phone duplicate rule (SWP-CRM-SEARCH): the list search
// -----------------------------------------------------------------------------

describe('D-211: the list search reads a number written without a country code in the business country only', () => {
  const C = {
    ravi: `${P}s_ravi`, // '868-555-0101', key '8685550101' (stored the national way, before E.164)
    lala: `${P}s_lala`, // '555-0102', key '5550102' (the seven-digit local spelling)
    ukay: `${P}s_ukay`, // '+44 868 555 0103', a UK number
    guy: `${P}s_guy`, // '+592 555 0104', a Guyana number
    gina: `${P}s_gina`, // bizGY: '555-0105', key '5550105' (a Guyana local number)
  };

  beforeAll(async () => {
    await seedContact(C.ravi, ID.bizS, 'Ravi', '868-555-0101', '8685550101');
    await seedContact(C.lala, ID.bizS, 'Lala', '555-0102', '5550102');
    await seedContact(C.ukay, ID.bizS, 'Ukay', '+44 868 555 0103', '+448685550103');
    await seedContact(C.guy, ID.bizS, 'Guy', '+592 555 0104', '+5925550104');
    await seedContact(C.gina, ID.bizGY, 'Gina', '555-0105', '5550105');
  });

  it("V71L-01 RED-BEFORE: in a Trinidad and Tobago business, '+44 868 555 0101' (a UK number) does not find Ravi, saved as '868-555-0101' (the add-contact form's duplicate check is built on this search)", async () => {
    expect(await search(ID.bizS, '+44 868 555 0101')).toEqual([]);
    expect(await search(ID.bizS, '+44 (868) 555-0101')).toEqual([]);
  });

  it("V71L-02 RED-BEFORE: in a Trinidad and Tobago business, '+592 555 0102' (a Guyana number) does not find Lala, saved as the seven-digit local '555-0102'", async () => {
    expect(await search(ID.bizS, '+592 555 0102')).toEqual([]);
  });

  it("V71L-03 CONTROL: the business's own country code still finds the national spelling: '+1 868 555 0101' and '1 868 555 0101' find Ravi; each foreign number finds the contact holding it; the local spellings find their contacts", async () => {
    expect(await search(ID.bizS, '+1 868 555 0101')).toEqual([C.ravi]);
    expect(await search(ID.bizS, '1 868 555 0101')).toEqual([C.ravi]);
    expect(await search(ID.bizS, '+44 868 555 0103')).toEqual([C.ukay]);
    expect(await search(ID.bizS, '+592 555 0104')).toEqual([C.guy]);
    expect(await search(ID.bizS, '868-555-0101')).toEqual([C.ravi]);
    expect(await search(ID.bizS, '555-0102')).toEqual([C.lala]);
  });

  it("V71L-04 CONTROL: in a Guyana business, '+592 555 0105' finds Gina, saved as the local '555-0105' (its own country's code); the Trinidad and Tobago spelling '+1 868 555 0105' does not", async () => {
    expect(await search(ID.bizGY, '+592 555 0105')).toEqual([C.gina]);
    expect(await search(ID.bizGY, '+1 868 555 0105')).toEqual([]);
  });

  it("V71L-05 CONTROL: POST .../contacts/check-duplicates reads the same way (WA-E164-SERVER): '+44 868 555 0101' and '+592 555 0102' are new numbers in bizS, '+1 868 555 0101' and '555 0102' are Ravi and Lala; '+592 555 0105' is Gina in bizGY", async () => {
    const res = await checkDuplicates(ID.bizS, [
      { phone: '+44 868 555 0101' },
      { phone: '+592 555 0102' },
      { phone: '+1 868 555 0101' },
      { phone: '555 0102' },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const byIndex = new Map<number, any>(res.body.duplicates.map((d: any) => [d.importIndex, d]));
    expect([...byIndex.keys()].sort()).toEqual([2, 3]);
    expect(byIndex.get(2)).toMatchObject({ matchField: 'phone', existingContact: { id: C.ravi } });
    expect(byIndex.get(3)).toMatchObject({ matchField: 'phone', existingContact: { id: C.lala } });
    const gy = await checkDuplicates(ID.bizGY, [{ phone: '+592 555 0105' }]);
    expect(gy.status).toBe(201);
    expect(gy.body.duplicates).toHaveLength(1);
    expect(gy.body.duplicates[0]).toMatchObject({ existingContact: { id: C.gina } });
  });
});

// -----------------------------------------------------------------------------
// 2. The connector contact syncs
// -----------------------------------------------------------------------------

describe.each([
  ['Google Contacts', 'contacts', 'google_contacts', ID.bizG],
  ['Outlook Contacts', 'outlook-contacts', 'outlook_contacts', ID.bizO],
])('D-211: the %s sync keys a phone as the CRM write does', (_label, route, source, biz) => {
  const syncUrl = `/connect/businesses/${biz}/${route}/sync`;
  const tag = route === 'contacts' ? 'g' : 'o';
  const c = (name: string) => `${P}${tag}_${name}`;

  /** The provider answers with these people. */
  function remote(people: Array<{ key: string; first: string; phone?: string; email?: string }>) {
    peopleConnections = people.map((p) => ({
      resourceName: `people/${P}${p.key}`,
      names: [{ givenName: p.first }],
      ...(p.email ? { emailAddresses: [{ value: p.email }] } : {}),
      ...(p.phone ? { phoneNumbers: [{ value: p.phone }] } : {}),
    }));
    graphContacts = people.map((p) => ({
      id: `${P}graph_${p.key}`,
      givenName: p.first,
      ...(p.email ? { emailAddresses: [{ address: p.email }] } : {}),
      ...(p.phone ? { mobilePhone: p.phone } : {}),
      lastModifiedDateTime: new Date(Date.now() + 60_000).toISOString(),
    }));
  }

  async function runSync() {
    outbound.length = 0;
    const res = await agent().post(syncUrl).set('x-test-user', ID.owner);
    if (asyncWrites) await asyncWrites.drain();
    // Only the stubbed provider API was asked (no request leaves the process).
    for (const url of outbound) expect(url.startsWith('https://people.googleapis.com/') || url.startsWith('https://graph.microsoft.com/')).toBe(true);
    return res;
  }

  /** The contacts the provider's people are linked to (ContactExternalMapping), by external id. */
  async function mappings(): Promise<Record<string, string>> {
    const rows: Array<{ external_id: string; contact_id: string }> = await db.$queryRawUnsafe(
      `SELECT external_id, contact_id FROM contact_external_mappings WHERE business_id = $1 AND source = $2`,
      biz,
      source,
    );
    return Object.fromEntries(rows.map((r) => [r.external_id, r.contact_id]));
  }
  const externalId = (key: string) => (tag === 'g' ? `people/${P}${key}` : `${P}graph_${key}`);

  it(`V71L-1${tag === 'g' ? '0' : '5'} RED-BEFORE: a person whose phone is another spelling of a live contact's number (stored with its country code, or before E.164 the national or seven-digit way) is linked to that contact; no second contact holds the number`, async () => {
    await clearContacts(biz);
    const asha = await postContact(biz, { firstName: 'Asha', phone: '+1 868 555 0111' });
    expect(asha.status, JSON.stringify(asha.body).slice(0, 300)).toBe(201);
    expect(await keyOf(asha.body.id)).toBe('+18685550111');
    await seedContact(c('lena'), biz, 'Lena', '868-555-0112', '8685550112');
    await seedContact(c('tara'), biz, 'Tara', '555-0113', '5550113');
    remote([
      { key: `${tag}1`, first: 'Asha', phone: '868-555-0111' },
      { key: `${tag}2`, first: 'Lena', phone: '+1 (868) 555-0112' },
      { key: `${tag}3`, first: 'Tara', phone: '868 555 0113' },
    ]);

    const res = await runSync();
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const live = await liveContacts(biz);
    expect(live.map((r) => r.id).sort()).toEqual([asha.body.id, c('lena'), c('tara')].sort());
    const linked = await mappings();
    expect(linked[externalId(`${tag}1`)]).toBe(asha.body.id);
    expect(linked[externalId(`${tag}2`)]).toBe(c('lena'));
    expect(linked[externalId(`${tag}3`)]).toBe(c('tara'));
    // Each number is held once, under the key the CRM write stores for the spelling the sync wrote.
    const keys = live.map((r) => r.phone_normalized).sort();
    expect(keys).toEqual(['+18685550111', '+18685550112', '+18685550113']);
  });

  it(`V71L-1${tag === 'g' ? '1' : '6'} CONTROL: another country's number with the same digits ('+44 868 555 0111', '+592 555 0113') is a new contact under its own key; the Trinidad and Tobago holders are untouched`, async () => {
    await clearContacts(biz);
    await seedContact(c('asha'), biz, 'Asha', '+1 868 555 0111', '+18685550111');
    await seedContact(c('tara'), biz, 'Tara', '555-0113', '5550113');
    remote([
      { key: `${tag}4`, first: 'Uma', phone: '+44 868 555 0111' },
      { key: `${tag}5`, first: 'Gus', phone: '+592 555 0113' },
    ]);

    const res = await runSync();
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const live = await liveContacts(biz);
    expect(live).toHaveLength(4);
    const byName = new Map(live.map((r) => [r.first_name, r]));
    expect(byName.get('Uma')?.phone_normalized).toBe('+448685550111');
    expect(byName.get('Gus')?.phone_normalized).toBe('+5925550113');
    expect(byName.get('Asha')).toMatchObject({ id: c('asha'), phone: '+1 868 555 0111', phone_normalized: '+18685550111' });
    expect(byName.get('Tara')).toMatchObject({ id: c('tara'), phone: '555-0113', phone_normalized: '5550113' });
  });

  it(`V71L-1${tag === 'g' ? '2' : '7'} RED-BEFORE: a new person's local number is stored in E.164 under the business's country ('868-555-0114' and the seven-digit '555-0115' are +1 868 numbers), so POST .../contacts of another spelling answers 409 contact_phone_taken naming that contact`, async () => {
    await clearContacts(biz);
    remote([
      { key: `${tag}6`, first: 'Nina', phone: '868-555-0114' },
      { key: `${tag}7`, first: 'Omar', phone: '555-0115' },
    ]);
    const res = await runSync();
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const live = await liveContacts(biz);
    const byName = new Map(live.map((r) => [r.first_name, r]));
    expect(byName.get('Nina')).toMatchObject({ phone: '+18685550114', phone_normalized: '+18685550114' });
    expect(byName.get('Omar')).toMatchObject({ phone: '+18685550115', phone_normalized: '+18685550115' });

    const again = await postContact(biz, { firstName: 'Nina', phone: '(868) 555-0114' });
    expect(again.status, JSON.stringify(again.body).slice(0, 300)).toBe(409);
    expect(again.body).toMatchObject({ code: 'contact_phone_taken', details: { existingContactId: byName.get('Nina')?.id } });
    const omar = await postContact(biz, { firstName: 'Omar', phone: '+1 868 555 0115' });
    expect(omar.status).toBe(409);
    expect(omar.body).toMatchObject({ code: 'contact_phone_taken', details: { existingContactId: byName.get('Omar')?.id } });
    expect(await liveContacts(biz)).toHaveLength(2);
  });

  it(`V71L-1${tag === 'g' ? '3' : '8'} RED-BEFORE: a person matched by email whose phone another live contact holds (in another spelling) is written without that number: the holder keeps it and stays its only live holder`, async () => {
    await clearContacts(biz);
    await seedContact(c('lena'), biz, 'Lena', '868-555-0112', '8685550112');
    const xenaEmail = `${P}${tag}.xena@example.test`;
    await seedContact(c('xena'), biz, 'Xena', null, null, { email: xenaEmail, emailNormalized: xenaEmail });
    remote([{ key: `${tag}8`, first: 'Xena', email: xenaEmail, phone: '+1 868 555 0112' }]);

    const res = await runSync();
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const live = await liveContacts(biz);
    expect(live.map((r) => r.id).sort()).toEqual([c('lena'), c('xena')].sort());
    const byId = new Map(live.map((r) => [r.id, r]));
    expect(byId.get(c('xena'))).toMatchObject({ phone: null, phone_normalized: null });
    expect(byId.get(c('lena'))).toMatchObject({ phone: '868-555-0112', phone_normalized: '8685550112' });
    expect((await mappings())[externalId(`${tag}8`)]).toBe(c('xena'));
  });
});

// -----------------------------------------------------------------------------
// 3. EntityResolutionService, through the form webhook
// -----------------------------------------------------------------------------

describe("D-211: EntityResolutionService (POST /webhooks/forms/:businessId/webhook_form) keys a phone and an email as the CRM write does", () => {
  const C = {
    wren: `${P}w_wren`, // '868-555-0122', key '8685550122' (stored before E.164)
    wes: `${P}w_wes`, // '555-0123', key '5550123' (the seven-digit local spelling)
  };
  const WADE_EMAIL = `${P}Wade.Case@example.test`;
  let wade = '';

  beforeAll(async () => {
    const res = await postContact(ID.bizW, { firstName: 'Wade', phone: '+1 868 555 0121', email: WADE_EMAIL });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    wade = res.body.id;
    await seedContact(C.wren, ID.bizW, 'Wren', '868-555-0122', '8685550122');
    await seedContact(C.wes, ID.bizW, 'Wes', '555-0123', '5550123');
  });

  it("V71L-20 CONTROL: the premise: Wade was saved through POST .../contacts with his country code (kept as written, key +18685550121) and his email as typed", async () => {
    const [row] = (await liveContacts(ID.bizW)).filter((r) => r.id === wade);
    expect(row).toMatchObject({ phone: '+1 868 555 0121', phone_normalized: '+18685550121', email: WADE_EMAIL, email_normalized: WADE_EMAIL.toLowerCase() });
  });

  it("V71L-21 RED-BEFORE: a submission with '868-555-0121' (another spelling of Wade's number) resolves to Wade: no new contact", async () => {
    const before = (await liveContacts(ID.bizW)).length;
    const res = await submitForm({ firstName: 'Wade', phone: '868-555-0121' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.contactId).toBe(wade);
    expect(await liveContacts(ID.bizW)).toHaveLength(before);
  });

  it("V71L-22 RED-BEFORE: a contact stored before E.164 holds its number: '+1 868 555 0122' is Wren ('868-555-0122') and '868 555 0123' is Wes (the seven-digit '555-0123')", async () => {
    const before = (await liveContacts(ID.bizW)).length;
    const wren = await submitForm({ firstName: 'Wren', phone: '+1 868 555 0122' });
    expect(wren.status).toBe(201);
    expect(wren.body.contactId).toBe(C.wren);
    const wes = await submitForm({ firstName: 'Wes', phone: '868 555 0123' });
    expect(wes.status).toBe(201);
    expect(wes.body.contactId).toBe(C.wes);
    expect(await liveContacts(ID.bizW)).toHaveLength(before);
  });

  it("V71L-23 RED-BEFORE: another country's number with the same last digits ('+592 555 0123') is a new contact holding it under its E.164 key, not Wes", async () => {
    const res = await submitForm({ firstName: 'Gabe', phone: '+592 555 0123' });
    expect(res.status).toBe(201);
    expect(res.body.contactId).not.toBe(C.wes);
    const [row] = (await liveContacts(ID.bizW)).filter((r) => r.id === res.body.contactId);
    expect(row).toMatchObject({ first_name: 'Gabe', phone: '+592 555 0123', phone_normalized: '+5925550123' });
  });

  it("V71L-24 RED-BEFORE: a new submitter's local number ('555-0124') is stored in E.164 with its key, so POST .../contacts of another spelling answers 409 contact_phone_taken naming that contact (refused on create everywhere)", async () => {
    const res = await submitForm({ firstName: 'Nell', phone: '555-0124' });
    expect(res.status).toBe(201);
    const nell = res.body.contactId;
    expect(nell).toEqual(expect.any(String));
    const [row] = (await liveContacts(ID.bizW)).filter((r) => r.id === nell);
    expect(row).toMatchObject({ phone: '+18685550124', phone_normalized: '+18685550124' });

    const again = await postContact(ID.bizW, { firstName: 'Nell', phone: '868-555-0124' });
    expect(again.status, JSON.stringify(again.body).slice(0, 300)).toBe(409);
    expect(again.body).toMatchObject({ code: 'contact_phone_taken', details: { existingContactId: nell } });
  });

  it("V71L-25 RED-BEFORE: an email in another case ('v71l_wade.case@example.test') is Wade's: the submission resolves to him, no new contact; a new submitter's email is keyed (email_normalized), so POST .../contacts of it answers 409 contact_email_taken", async () => {
    const before = (await liveContacts(ID.bizW)).length;
    const res = await submitForm({ firstName: 'Wade', email: WADE_EMAIL.toLowerCase() });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.contactId).toBe(wade);
    expect(await liveContacts(ID.bizW)).toHaveLength(before);

    const fresh = await submitForm({ firstName: 'Ezra', email: `${P}Ezra@Example.test` });
    expect(fresh.status).toBe(201);
    const [row] = (await liveContacts(ID.bizW)).filter((r) => r.id === fresh.body.contactId);
    expect(row).toMatchObject({ email_normalized: `${P}ezra@example.test` });
    const again = await postContact(ID.bizW, { firstName: 'Ezra', email: `${P}ezra@example.test` });
    expect(again.status, JSON.stringify(again.body).slice(0, 300)).toBe(409);
    expect(again.body).toMatchObject({ code: 'contact_email_taken', details: { existingContactId: fresh.body.contactId } });
  });

  it("V71L-26 RED-BEFORE: with auto-create off for the form, a submission with another spelling of Wade's number ('(868) 555-0121') is still attached to Wade (findContactIdByMatch reads it the same way)", async () => {
    const formId = `${P}form_noauto`;
    await db.$executeRawUnsafe(
      `UPDATE connector_statuses SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{formMappings}', $1::jsonb) WHERE business_id = $2 AND connector_type = $3`,
      JSON.stringify({ [formId]: { autoCreate: false } }),
      ID.bizW,
      WEBHOOK_TYPE,
    );
    const before = (await liveContacts(ID.bizW)).length;
    const res = await submitForm({ formId, firstName: 'Wade', phone: '(868) 555-0121' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.contactId).toBe(wade);
    expect(await liveContacts(ID.bizW)).toHaveLength(before);
  });

  it("V71L-27 RED-BEFORE (the resolver itself, real database): a WhatsApp sender is an international number (Meta sends '447911123456', Twilio 'whatsapp:+18685550125'): stored with '+' and keyed in E.164, never read as a Trinidad and Tobago local number; the same sender again is the same contact", async () => {
    const meta = await entityResolution.resolveContact(ID.bizW, { source: 'whatsapp', phone: '447911123456', firstName: 'Mags' });
    expect(meta.isNew).toBe(true);
    const twilio = await entityResolution.resolveContact(ID.bizW, { source: 'whatsapp', phone: 'whatsapp:+18685550125', firstName: 'Tess' });
    expect(twilio.isNew).toBe(true);
    const rows = new Map((await liveContacts(ID.bizW)).map((r) => [r.id, r]));
    expect(rows.get(meta.contactId)).toMatchObject({ phone: '+447911123456', phone_normalized: '+447911123456' });
    expect(rows.get(twilio.contactId)).toMatchObject({ phone_normalized: '+18685550125' });
    const metaAgain = await entityResolution.resolveContact(ID.bizW, { source: 'whatsapp', phone: '447911123456' });
    expect(metaAgain).toMatchObject({ contactId: meta.contactId, isNew: false, matchedOn: 'phone' });
    const twilioAgain = await entityResolution.resolveContact(ID.bizW, { source: 'whatsapp', phone: '18685550125' });
    expect(twilioAgain).toMatchObject({ contactId: twilio.contactId, isNew: false, matchedOn: 'phone' });
  });
});

// -----------------------------------------------------------------------------
// 4. The backfill: phone_normalized of the rows stored before E.164
// -----------------------------------------------------------------------------

describe('D-211: scripts/backfill-phone-keys.ts rewrites the phone keys stored before E.164 (dry run by default)', () => {
  const B = {
    legacy: `${P}b_legacy`, // '868-555-0131', key '8685550131'           -> +18685550131
    local7: `${P}b_local7`, // '555-0132', key '5550132'                  -> +18685550132
    e164: `${P}b_e164`, // '+1 868 555 0133', key '+18685550133'        (already the write's key)
    nokey: `${P}b_nokey`, // '+18685550134', no key (EntityResolution)  -> +18685550134
    empty: `${P}b_empty`, // 'front desk', key ''                         -> no key
    short: `${P}b_short`, // '12345', key '12345'                         (does not read: kept)
    heldA: `${P}b_heldA`, // '868-555-0135', key '8685550135'           (heldB holds +18685550135: merge)
    heldB: `${P}b_heldB`, // '+18685550135', key '+18685550135'
    pairC: `${P}b_pairC`, // '868-555-0136', key '8685550136'           (pairD is the same number: merge)
    pairD: `${P}b_pairD`, // '555-0136', key '5550136'
    deleted: `${P}b_deleted`, // '868-555-0137', key '8685550137', deleted -> +18685550137
    gyLocal: `${P}b_gyLocal`, // bizBG: '600-1234', key '6001234'      -> +5926001234
    xLocal: `${P}b_xLocal`, // bizBX: '555-0139', key '5550139'          (no rules: kept)
    xPlus: `${P}b_xPlus`, // bizBX: '+1 868 555 0139', key '+18685550139'
    outside: `${P}b_outside`, // bizBO: '868-555-0140', key '8685550140' (outside the run)
    // Codex P2 on #216: a number that does not read is keyed by its digits on a write, so a missing or stale key is
    // rewritten to that key (and takes part in the merge planning), or the resolver cannot see the row.
    shortNull: `${P}b_shortNull`, // '54321', no key                     (does not read) -> '54321'
    xStale: `${P}b_xStale`, // bizBX: '555-0142', key '+18685550142'      (no rules; stale key) -> '5550142'
  };
  const RUN = [`--business=${ID.bizB}`, `--business=${ID.bizBG}`, `--business=${ID.bizBX}`];
  /** The phone digits of every seeded row: none is ever printed. */
  const DIGITS = ['8685550131', '5550132', '8685550133', '8685550134', '8685550135', '8685550136', '5550136', '8685550137', '6001234', '5550139', '54321', '5550142'];

  beforeAll(async () => {
    await seedContact(B.legacy, ID.bizB, 'Legacy', '868-555-0131', '8685550131');
    await seedContact(B.local7, ID.bizB, 'Local', '555-0132', '5550132');
    await seedContact(B.e164, ID.bizB, 'Plus', '+1 868 555 0133', '+18685550133');
    await seedContact(B.nokey, ID.bizB, 'Nokey', '+18685550134', null);
    await seedContact(B.empty, ID.bizB, 'Desk', 'front desk', '');
    await seedContact(B.short, ID.bizB, 'Short', '12345', '12345');
    await seedContact(B.heldA, ID.bizB, 'HeldA', '868-555-0135', '8685550135');
    await seedContact(B.heldB, ID.bizB, 'HeldB', '+18685550135', '+18685550135');
    await seedContact(B.pairC, ID.bizB, 'PairC', '868-555-0136', '8685550136');
    await seedContact(B.pairD, ID.bizB, 'PairD', '555-0136', '5550136');
    await seedContact(B.deleted, ID.bizB, 'Gone', '868-555-0137', '8685550137', { deletedAt: new Date() });
    await seedContact(B.gyLocal, ID.bizBG, 'Georgetown', '600-1234', '6001234');
    await seedContact(B.xLocal, ID.bizBX, 'Atlantean', '555-0139', '5550139');
    await seedContact(B.xPlus, ID.bizBX, 'Traveller', '+1 868 555 0139', '+18685550139');
    await seedContact(B.outside, ID.bizBO, 'Outside', '868-555-0140', '8685550140');
    await seedContact(B.shortNull, ID.bizB, 'ShortNull', '54321', null);
    await seedContact(B.xStale, ID.bizBX, 'Stale', '555-0142', '+18685550142');
  });

  async function keys(): Promise<Record<string, string | null>> {
    const rows: Array<{ id: string; phone_normalized: string | null }> = await db.$queryRawUnsafe(
      `SELECT id, phone_normalized FROM contacts WHERE id LIKE ${sqlLikePrefix(`${P}b_`)} ORDER BY id`,
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.phone_normalized]));
  }

  it('V71L-30 RED-BEFORE: the dry run (the default) lists every row it would rewrite, every number two live contacts hold (for a merge) and every number that does not read, with its counts; it writes nothing and prints no phone number', async () => {
    const { main } = await import('../scripts/backfill-phone-keys');
    const before = await keys();
    const out: string[] = [];
    const err: string[] = [];
    const log = (...a: unknown[]) => out.push(a.join(' '));
    const error = (...a: unknown[]) => err.push(a.join(' '));
    expect(await main(RUN, { db, log, error }), err.join('\n')).toBe(0);
    const dry = out.join('\n');
    expect(dry).toMatch(/DRY RUN/);
    expect(dry).toMatch(/contacts_scanned\s+16\b/);
    expect(dry).toMatch(/key_current\s+3\b/);
    expect(dry).toMatch(/unreadable_kept\s+2\b/);
    expect(dry).toMatch(/needs_merge\s+3\b/);
    expect(dry).toMatch(/would_rewrite\s+8\b/);
    for (const id of [B.legacy, B.local7, B.nokey, B.empty, B.deleted, B.gyLocal, B.shortNull, B.xStale]) expect(dry).toMatch(new RegExp(`${id}\\s+rewrite\\b`));
    for (const id of [B.heldA, B.pairC, B.pairD]) expect(dry).toMatch(new RegExp(`${id}\\s+needs_merge\\b`));
    for (const id of [B.short, B.xLocal]) expect(dry).toMatch(new RegExp(`${id}\\s+unreadable\\b`));
    for (const id of [B.e164, B.heldB, B.xPlus, B.outside]) expect(dry).not.toContain(id);
    for (const digits of DIGITS) expect(dry, 'no phone number is printed').not.toContain(digits);
    expect(await keys(), 'the dry run writes nothing').toEqual(before);
  });

  it('V71L-31 RED-BEFORE: --apply rewrites exactly those keys to the key a contact write stores now (E.164 under the business country; no key for a phone with no digit), leaves the merges, the unreadable numbers and the business outside the run as they were; a second --apply rewrites nothing; bad arguments exit 2', async () => {
    const { main } = await import('../scripts/backfill-phone-keys');
    const out: string[] = [];
    const err: string[] = [];
    const log = (...a: unknown[]) => out.push(a.join(' '));
    const error = (...a: unknown[]) => err.push(a.join(' '));
    expect(await main(['--apply', ...RUN], { db, log, error }), err.join('\n')).toBe(0);
    expect(out.join('\n')).toMatch(/APPLY/);
    expect(out.join('\n')).toMatch(/rewritten\s+8\b/);
    expect(out.join('\n')).toMatch(/needs_merge\s+3\b/);
    expect(await keys()).toEqual({
      [B.legacy]: '+18685550131',
      [B.local7]: '+18685550132',
      [B.e164]: '+18685550133',
      [B.nokey]: '+18685550134',
      [B.empty]: null,
      [B.short]: '12345',
      [B.heldA]: '8685550135',
      [B.heldB]: '+18685550135',
      [B.pairC]: '8685550136',
      [B.pairD]: '5550136',
      [B.deleted]: '+18685550137',
      [B.gyLocal]: '+5926001234',
      [B.xLocal]: '5550139',
      [B.xPlus]: '+18685550139',
      [B.outside]: '8685550140',
      [B.shortNull]: '54321',
      [B.xStale]: '5550142',
    });
    // The phone a contact shows is never changed: only its key.
    const phones: Array<{ id: string; phone: string | null }> = await db.$queryRawUnsafe(`SELECT id, phone FROM contacts WHERE id IN ($1, $2, $3)`, B.legacy, B.local7, B.gyLocal);
    expect(Object.fromEntries(phones.map((r) => [r.id, r.phone]))).toEqual({ [B.legacy]: '868-555-0131', [B.local7]: '555-0132', [B.gyLocal]: '600-1234' });

    out.length = 0;
    expect(await main(['--apply', ...RUN], { db, log, error })).toBe(0);
    expect(out.join('\n')).toMatch(/rewritten\s+0\b/);
    out.length = 0;
    expect(await main(RUN, { db, log, error })).toBe(0);
    expect(out.join('\n')).toMatch(/would_rewrite\s+0\b/);
    expect(out.join('\n')).toMatch(/needs_merge\s+3\b/);

    err.length = 0;
    expect(await main(['--bogus'], { db, log, error })).toBe(2);
    expect(await main(['--business='], { db, log, error })).toBe(2);
    expect(err.join('\n')).toMatch(/Bad arguments/);
  });

  it("V71L-32 CONTROL: after the backfill the rewritten keys are the write's own: POST .../contacts of another spelling of a rewritten number answers 409 naming its holder; a merge pair still answers 409 naming one of its contacts", async () => {
    const legacy = await postContact(ID.bizB, { firstName: 'Again', phone: '(868) 555-0131' });
    expect(legacy.status, JSON.stringify(legacy.body).slice(0, 300)).toBe(409);
    expect(legacy.body).toMatchObject({ code: 'contact_phone_taken', details: { existingContactId: B.legacy } });
    const gy = await postContact(ID.bizBG, { firstName: 'Again', phone: '+592 600 1234' });
    expect(gy.status).toBe(409);
    expect(gy.body).toMatchObject({ code: 'contact_phone_taken', details: { existingContactId: B.gyLocal } });
    const pair = await postContact(ID.bizB, { firstName: 'Again', phone: '868 555 0136' });
    expect(pair.status).toBe(409);
    expect([B.pairC, B.pairD]).toContain(pair.body.details?.existingContactId);
  });

  it('V71L-33 RED-BEFORE: `pnpm backfill:phone-keys` (the package.json command, run as pnpm runs it from apps/server with only DATABASE_URL): the dry run exits 0 and lists the row, then `--apply` rewrites it; the database URL and the phone number are never printed', async () => {
    const legacyId = `${P}b_cli`;
    await seedContact(legacyId, ID.bizBC, 'Cli', '868-555-0141', '8685550141');
    const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8')).scripts;
    const command = scripts['backfill:phone-keys'];
    expect(command, 'apps/server/package.json has a backfill:phone-keys script').toBeTruthy();
    const DATABASE_URL = process.env.DATABASE_URL ?? '';
    const env: NodeJS.ProcessEnv = {
      PATH: [path.join(SERVER_DIR, 'node_modules', '.bin'), path.join(SERVER_DIR, '..', '..', 'node_modules', '.bin'), process.env.PATH ?? ''].join(':'),
      HOME: process.env.HOME ?? '/tmp',
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      DATABASE_URL,
    };
    const run = (args: string) =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
        const child = spawn('sh', ['-c', `${command} ${args}`], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 110_000);
        child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
        child.stderr.setEncoding('utf8').on('data', (s: string) => (err += s));
        child.once('error', reject);
        child.once('close', (code) => {
          clearTimeout(timer);
          resolve({ code, out, err });
        });
      });

    const dry = await run(`--business=${ID.bizBC}`);
    const dryAll = `${dry.out}\n${dry.err}`;
    expect(dry.code, dryAll).toBe(0);
    expect(dry.out, dryAll).toMatch(/DRY RUN/);
    expect(dry.out).toMatch(/would_rewrite\s+1\b/);
    expect(dry.out).toMatch(new RegExp(`${legacyId}\\s+rewrite\\b`));
    expect(dryAll).not.toMatch(/TypeError|Cannot read properties of undefined/);
    if (DATABASE_URL) expect(dryAll).not.toContain(DATABASE_URL);
    expect(dryAll).not.toContain('8685550141');
    expect(await keyOf(legacyId), 'the dry run writes nothing').toBe('8685550141');

    const applied = await run(`--apply --business=${ID.bizBC}`);
    const appliedAll = `${applied.out}\n${applied.err}`;
    expect(applied.code, appliedAll).toBe(0);
    expect(applied.out).toMatch(/rewritten\s+1\b/);
    if (DATABASE_URL) expect(appliedAll).not.toContain(DATABASE_URL);
    expect(await keyOf(legacyId)).toBe('+18685550141');
  }, 240_000);
});
