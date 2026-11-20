/**
 * WA-E164-SERVER (V1-63; journeys C and D, owner ruling 'whatsapp') — a contact's phone and
 * WhatsApp number are stored in E.164, read under the business's country (Business.country;
 * no country means Trinidad and Tobago, +1 868). Against a REAL database, through the HTTP
 * routes.
 *
 * Before: POST .../contacts stored the phone exactly as typed. A Trinidad owner types a
 * customer's mobile the local way, '712-3401', and the row held '712-3401' with the key
 * '7123401'; the same customer typed again as '(868) 712-3401' was another key, so the
 * identity unique (contacts_business_id_phone_normalized_live_key, D-16) let a second live
 * contact hold the same number, and a WhatsApp link (wa.me) cannot be built from '712-3401'.
 *
 * Now (the write paths: POST and PATCH .../contacts, and the CSV import through
 * findOrCreateContact):
 *  - a number typed without its country code is read under the business's country and stored
 *    in E.164 ('712-3401' in Trinidad is '+18687123401'; '600-1234' in Guyana '+5926001234');
 *  - a number typed with its country code ('+1 868 712 3405') is kept as written: its key is
 *    already the E.164 digits, and the required Release 0 case 'the first contact with the
 *    email is created and persisted with the normalized email' (release0-landed.json,
 *    crm-contact-duplicate) pins a '+1 868 555 0100' create to that spelling;
 *  - a number that cannot be read (no digits, too short, a local number under a country the
 *    server has no dialling rules for) is kept as typed, never dropped, and flagged: an open
 *    'invalid_phone' data-quality issue (field 'phone' or 'whatsappNumber') written with the
 *    contact, which the data-quality scan keeps;
 *  - the identity check compares the E.164 value: a punctuation or country-code variant of a
 *    live contact's phone answers 409 contact_phone_taken (the database decides between keys
 *    in E.164), and a live contact stored before this change under another spelling of the
 *    same number (no backfill in v1) holds that number when its stored key, read under the
 *    business's country, is the same E.164 number: POST and PATCH answer the same bounded 409,
 *    and an import row (or a public submission through findOrCreateContact) merges into it
 *    instead of adding a duplicate;
 *  - a soft-deleted contact's phone stays free (D-16; contact-partial-unique stays green).
 *
 * Review repair (SEC-E164-1/2, COR-E164-1..7): the legacy key is read under Business.country,
 * not by the country-agnostic samePhoneKey. In a Trinidad and Tobago business the seven-digit
 * key '7123504' is +1 868 712 3504 (it was missed, so re-typing the number made a second live
 * contact), and it is NOT '+592 712 3504' or any other country's number behind another calling
 * code (it was matched, so a create answered 409 naming an unrelated contact and an anonymous
 * storefront intake merged a stranger's email into that contact). A PATCH that re-sends the
 * contact's own number leaves it as stored; the data-quality fix that reformats a phone to
 * E.164 refuses a number another live contact holds (409, not a raw database error); the import
 * preview (check-duplicates) reads phones the way the create and the import do; the scan keeps
 * a WhatsApp flag over a mere reformat suggestion.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, ValidationPipe,
 * GlobalHttpExceptionFilter, multer, CrmController, CrmService, CrmImportService,
 * EntityResolutionService, CrmStatsService, CrmDataQualityService and ContactAuditService are
 * real against DATABASE_URL; so are the anonymous storefront intake route (SiteController,
 * IntakeService, PublicRateLimitGuard against REDIS_URL, HoneypotGuard). Identity attachment
 * reads `x-test-user` and loads that seeded user row as AuthMiddleware would after token
 * verification; the timeline's side channels, caches, flow, notifications and the storefront
 * event log are recorders, and the plan limit allows. The import's vision model is never called
 * (CSV only), and the data-quality scan's email MX lookup is off (KF_DISABLE_MX=1), so no
 * request leaves the process.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v63k_` prefix (rows created through the
 * API are deleted by business id) and is hard-deleted by raw SQL (sqlLikePrefix) in beforeAll
 * and afterAll. Cases tagged RED-BEFORE fail on the packet's source base (2f774824); CONTROL
 * cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// The data-quality scan validates emails with an MX lookup unless this is set; no lookup leaves
// the process (no contact here has an email either).
const savedMx = process.env.KF_DISABLE_MX;
process.env.KF_DISABLE_MX = '1';

const P = 'v63k_';
const ID = {
  owner: `${P}owner`,       // OWNER of every business here
  staffBook: `${P}staffBk`, // STAFF of bizTT, 'my book' (crm_view=owned, crm_edit=owned)
  bizTT: `${P}bizTT`,       // Business.country unset: Trinidad and Tobago by default
  bizNamed: `${P}bizNm`,    // Business.country 'Trinidad and Tobago' (written out)
  bizGY: `${P}bizGY`,       // Business.country 'Guyana' (+592, seven-digit numbers)
  bizXX: `${P}bizXX`,       // Business.country 'Atlantis' (no dialling rules)
  // Stored before WA-E164-SERVER, the national way (seeded: no backfill in v1).
  legacy: `${P}c_legacy`,   // bizTT, TEAM, owned by the OWNER, phone '868-555-0160' (key '8685550160')
  // Review repair: more contacts stored before E.164, each as the pre-packet create path wrote it
  // (the phone as typed, the key normalizePhone gave it), all in bizTT (no country: Trinidad and
  // Tobago), owned by the OWNER.
  tara: `${P}c_tara`,       // '712-3501' (key '7123501'): a seven-digit local number, the commonest spelling
  neil: `${P}c_neil`,       // '868-555-0277' (key '8685550277')
  tia: `${P}c_tia`,         // '712-3503' (key '7123503'), no email
  lou: `${P}c_lou`,         // '712-3504' (key '7123504')
  ivy: `${P}c_ivy`,         // '712-3505' (key '7123505')
  gil: `${P}c_gil`,         // '712-3506' (key '7123506')
  pairA: `${P}c_pairA`,     // '868-712-3507' (key '8687123507') ...
  pairB: `${P}c_pairB`,     // ... and '+1 868 712 3507' (key '+18687123507'): one number, two keys, as the base allowed
  fixA: `${P}c_fixA`,       // '868-712-3508' (key '8687123508') ...
  fixB: `${P}c_fixB`,       // ... and '+18687123508' (key '+18687123508')
  fixC: `${P}c_fixC`,       // '868-712-3509' (key '8687123509'), no other holder
  rex: `${P}c_rex`,         // '868-712-3512' (key '8687123512'), no other holder
};

let db: any;
let app: any;
let redis: any;
/** What the storefront intake logged (PublicEventsService.logStorefrontEvent), in order. */
const storefrontEvents: Array<Record<string, any>> = [];

/** A fresh client address per request: each gets its own rate-limit bucket. */
let ipN = 0;
const nextIp = () => `10.63.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Rows created through the API
  // have generated ids, so every table goes by business id.
  for (const sql of [
    `DELETE FROM contact_import_contacts WHERE import_id IN (SELECT id FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_data_issues WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM intake_submissions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

// ---- requests ---------------------------------------------------------------

function post(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ lastName: `${P}api`, ...body });
}

function patch(actor: string, businessId: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function remove(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

function detail(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

/** The contact's open data-quality issues, as GET contacts/:contactId/data-quality answers them. */
async function issues(businessId: string, contactId: string): Promise<Array<Record<string, any>>> {
  const res = await request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}/data-quality`)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp());
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.items;
}

function csvImport(businessId: string, content: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/import/file`)
    .query({ type: 'csv' })
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp())
    .attach('file', Buffer.from(content, 'utf8'), { filename: `${P}contacts.csv`, contentType: 'text/csv' });
}

function scan(businessId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/data-quality/scan`)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp());
}

/** POST .../contacts/check-duplicates: the import preview. */
function checkDuplicates(businessId: string, contacts: Array<Record<string, unknown>>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/check-duplicates`)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp())
    .send({ contacts });
}

/** POST .../data-quality/issues/:issueId/apply, the fix the issue recommends. */
function applyFix(businessId: string, issueId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/data-quality/issues/${issueId}/apply`)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp())
    .send({});
}

function bulkApplyFix(businessId: string, issueIds: string[]) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/data-quality/bulk-apply`)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp())
    .send({ issueIds });
}

/** The anonymous storefront intake form (no signed-in member): POST /site/storefront/public/:slug/intake. */
function publicIntake(slug: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/site/storefront/public/${slug}/intake`)
    .set('x-forwarded-for', nextIp())
    .send({ category: 'Catering', description: 'A quote for a family lime', ...body });
}

/** The contact's open phone issue (kind invalid_phone), as the table holds it. */
async function openPhoneIssue(contactId: string) {
  return db.contactDataIssue.findFirst({ where: { contactId, kind: 'invalid_phone', status: 'open' } });
}

// ---- reads ------------------------------------------------------------------

async function stored(contactId: string) {
  return db.contact.findUnique({
    where: { id: contactId },
    select: { id: true, phone: true, phoneNormalized: true, whatsappNumber: true, deletedAt: true, firstName: true },
  });
}

/** A row as the table holds it, soft-deleted or not (raw SQL bypasses the soft-delete extension). */
async function rawRow(contactId: string): Promise<{ phone: string | null; phone_normalized: string | null; deleted_at: Date | null } | null> {
  const rows: Array<{ phone: string | null; phone_normalized: string | null; deleted_at: Date | null }> = await db.$queryRawUnsafe(
    'SELECT phone, phone_normalized, deleted_at FROM contacts WHERE id = $1', contactId,
  );
  return rows[0] ?? null;
}

/** Live contacts of the business holding exactly this phone key. */
async function liveWithKey(businessId: string, key: string): Promise<number> {
  return db.contact.count({ where: { businessId, phoneNormalized: key, deletedAt: null } });
}

async function liveCount(businessId: string): Promise<number> {
  return db.contact.count({ where: { businessId, deletedAt: null } });
}

/** A created contact's id, failing with the answer when the create was not 201. */
async function created(actor: string, businessId: string, body: Record<string, unknown>): Promise<string> {
  const res = await post(actor, businessId, body);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  expect(res.body.id).toBeTruthy();
  return res.body.id as string;
}

/** The 409 the identity check answers (the filter's shape, as crm-contact-duplicate asserts it). */
function expectPhoneTaken(res: { status: number; body: any }, existingContactId: string | null) {
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(409);
  expect(res.body.statusCode).toBe(409);
  expect(res.body.code).toBe('contact_phone_taken');
  expect(res.body.details).toEqual({ existingContactId });
  expect(typeof res.body.message).toBe('string');
  for (const key of ['contact', 'id', 'email', 'phone', 'firstName']) expect(res.body).not.toHaveProperty(key);
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
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
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
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
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
  // The anonymous storefront intake (review repair SEC-E164-1): findOrCreateContact on the public surface.
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { IntakeService } = await import('../src/modules/site/intake.service');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  const { CustomerReferralService } = await import('../src/modules/site/customer-referral.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const IORedis = (await import('ioredis')).default;
  // The public route's rate limit counts in Redis (each request here comes from a fresh address).
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2 });

  // ---- the real HTTP path (wired before any row is seeded) ---------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, SiteController],
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
      // The importer, the matcher findOrCreateContact consults and the data-quality service are real.
      CrmImportService,
      EntityResolutionService,
      CrmDataQualityService,
      // The scan's duplicate pass: not under test (its failure is caught and logged by the scan).
      { provide: CrmDuplicateDetectionService, useValue: {} },
      // CSV only: the vision model is never reached.
      { provide: AiUsageService, useValue: {} },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // Side channels off the contact write; the claims here are the rows.
      { provide: CrmTimelineService, useValue: { logEvent: async () => undefined, logContactEvent: async () => undefined } },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: CrmRelationshipHealthService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ConversationAiService, useValue: {} },
      { provide: CrmNetworkService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
      // The storefront intake is real (it calls the real CrmService.findOrCreateContact when the
      // visitor has no cookie id); its notification and event log are recorders.
      IntakeService,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: NotificationsService, useValue: { create: async () => undefined } },
      {
        provide: PublicEventsService,
        useValue: {
          logStorefrontEvent: async (event: Record<string, any>) => { storefrontEvents.push(event); },
          backstitchVisitor: async () => undefined,
          upsertStorefrontContact: async () => { throw new Error('not reached: the intakes here carry no visitor id'); },
        },
      },
      { provide: SiteService, useValue: {} },
      { provide: StoreOrderService, useValue: {} },
      { provide: PromoCodeService, useValue: {} },
      { provide: QualificationService, useValue: {} },
      { provide: CustomerReferralService, useValue: {} },
      { provide: CaseStudyService, useValue: {} },
      { provide: PaymentsService, useValue: {} },
      { provide: StorefrontConversionService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
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
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const suffix of ['owner', 'staffBk']) {
    await db.user.create({ data: { id: `${P}${suffix}`, email: `${P}${suffix}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizTT, name: 'V63K Doubles Stand', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizNamed, name: 'V63K Named', ownerId: ID.owner, country: 'Trinidad and Tobago' } });
  await db.business.create({ data: { id: ID.bizGY, name: 'V63K Georgetown', ownerId: ID.owner, country: 'Guyana' } });
  await db.business.create({ data: { id: ID.bizXX, name: 'V63K Atlantis', ownerId: ID.owner, country: 'Atlantis' } });
  for (const biz of [ID.bizTT, ID.bizNamed, ID.bizGY, ID.bizXX]) {
    await db.membership.create({ data: { id: `${P}m_owner_${biz}`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
  }
  await db.membership.create({
    data: {
      id: `${P}m_staffBk_bizTT`, userId: ID.staffBook, businessId: ID.bizTT, role: 'STAFF',
      permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' },
    },
  });

  // A customer stored before E.164 (the key normalizePhone gave '868-555-0160'); no backfill in v1.
  await db.contact.create({
    data: {
      id: ID.legacy, businessId: ID.bizTT, firstName: 'Lena', lastName: `${P}seed`, ownerId: ID.owner,
      phone: '868-555-0160', phoneNormalized: '8685550160',
    },
  });
  // Review repair: more customers stored before E.164 in bizTT (key = normalizePhone(as typed)).
  for (const [id, firstName, phone, phoneNormalized] of [
    [ID.tara, 'Tara', '712-3501', '7123501'],
    [ID.neil, 'Neil', '868-555-0277', '8685550277'],
    [ID.tia, 'Tia', '712-3503', '7123503'],
    [ID.lou, 'Lou', '712-3504', '7123504'],
    [ID.ivy, 'Ivy', '712-3505', '7123505'],
    [ID.gil, 'Gil', '712-3506', '7123506'],
    [ID.pairA, 'PairA', '868-712-3507', '8687123507'],
    [ID.pairB, 'PairB', '+1 868 712 3507', '+18687123507'],
    [ID.fixA, 'FixA', '868-712-3508', '8687123508'],
    [ID.fixB, 'FixB', '+18687123508', '+18687123508'],
    [ID.fixC, 'FixC', '868-712-3509', '8687123509'],
    [ID.rex, 'Rex', '868-712-3512', '8687123512'],
  ] as const) {
    await db.contact.create({
      data: { id, businessId: ID.bizTT, firstName, lastName: `${P}seed`, ownerId: ID.owner, phone, phoneNormalized },
    });
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (redis) await redis.quit().catch(() => undefined);
  if (db) await cleanup();
  if (savedMx === undefined) delete process.env.KF_DISABLE_MX;
  else process.env.KF_DISABLE_MX = savedMx;
});

// -----------------------------------------------------------------------------
// The reader: crm-data-quality.util (pure; no database)
// -----------------------------------------------------------------------------

describe('normalizeToE164 reads a number under the business country (crm-data-quality.util)', () => {
  it("RED-BEFORE: resolvePhoneCountry reads Business.country as written ('TT', 'tt', 'TTO', 'Trinidad and Tobago', 'Trinidad & Tobago'), defaults an unset country to Trinidad and Tobago, and knows no rules for 'Atlantis'", async () => {
    const util: any = await import('../src/modules/crm/crm-data-quality.util');
    expect(typeof util.resolvePhoneCountry).toBe('function');
    for (const written of ['TT', 'tt', 'TTO', 'Trinidad and Tobago', 'trinidad & tobago', ' Trinidad and Tobago ']) {
      expect(util.resolvePhoneCountry(written), written).toMatchObject({ iso: 'TT', callingCode: '1' });
    }
    for (const unset of [null, undefined, '', '  ']) {
      expect(util.resolvePhoneCountry(unset), String(unset)).toMatchObject({ iso: 'TT', callingCode: '1' });
    }
    expect(util.resolvePhoneCountry('Guyana')).toMatchObject({ iso: 'GY', callingCode: '592' });
    expect(util.resolvePhoneCountry('GY')).toMatchObject({ iso: 'GY', callingCode: '592' });
    expect(util.resolvePhoneCountry('Atlantis')).toBeNull();
  });

  it('RED-BEFORE: a Trinidad number in every local spelling is +1 868 and the seven digits; the international prefixes 00 and 011 read as +', async () => {
    const { normalizeToE164 } = await import('../src/modules/crm/crm-data-quality.util');
    for (const typed of ['712-3401', '7123401', '868-712-3401', '(868) 712-3401', '1 (868) 712-3401', '1-868-712-3401', '+1 868 712 3401', '00 1 868 712 3401', '011 1 868 712 3401']) {
      expect(normalizeToE164(typed, 'TT'), typed).toMatchObject({ ok: true, e164: '+18687123401' });
    }
    // An unset business country is Trinidad and Tobago.
    expect(normalizeToE164('712-3401')).toMatchObject({ ok: true, e164: '+18687123401' });
    expect(normalizeToE164('712-3401', null as any)).toMatchObject({ ok: true, e164: '+18687123401' });
  });

  it('RED-BEFORE: other countries by their own rules: a US number needs its area code, Guyana has seven digits, the UK drops its trunk 0', async () => {
    const { normalizeToE164 } = await import('../src/modules/crm/crm-data-quality.util');
    expect(normalizeToE164('212-555-0100', 'US')).toMatchObject({ ok: true, e164: '+12125550100' });
    expect(normalizeToE164('555-0100', 'US').ok).toBe(false); // seven digits: which area code?
    expect(normalizeToE164('600-1234', 'Guyana')).toMatchObject({ ok: true, e164: '+5926001234' });
    expect(normalizeToE164('07911 123456', 'GB')).toMatchObject({ ok: true, e164: '+447911123456' });
  });

  it('RED-BEFORE: a number that cannot be read is not ok: no digits, too short, a NANP number one digit short, a local number under a country with no rules (an international one still reads)', async () => {
    const { normalizeToE164 } = await import('../src/modules/crm/crm-data-quality.util');
    expect(normalizeToE164('ask at the front desk', 'TT').ok).toBe(false);
    expect(normalizeToE164('12345', 'TT')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(normalizeToE164('+1 868 712 340', 'TT').ok).toBe(false);
    expect(normalizeToE164('712-3401', 'Atlantis').ok).toBe(false);
    expect(normalizeToE164('+44 20 7946 0958', 'Atlantis')).toMatchObject({ ok: true, e164: '+442079460958' });
    // Empty is not a number to read, and not an error.
    expect(normalizeToE164('', 'TT')).toEqual({ ok: true });
    expect(normalizeToE164(null, 'TT')).toEqual({ ok: true });
  });

  it("RED-BEFORE (CR-CODEX-E164-1, Codex review of https://github.com/SaCH-PRO/KEYFLOWOS/pull/214): no country calling code starts with 0, so a number written internationally whose code would (after '+', 00 or 011) is not ok, as the web WhatsApp reader refuses it; nor is a business country written as a '+0' code", async () => {
    const { normalizeToE164, resolvePhoneCountry } = await import('../src/modules/crm/crm-data-quality.util');
    for (const typed of ['+0000000', '+0 868 712 3401', '+00 44 20 7946 0958', '00 0 1234 5678', '0001234567']) {
      expect(normalizeToE164(typed, 'TT').ok, typed).toBe(false);
      expect(normalizeToE164(typed, 'Atlantis').ok, `${typed} (Atlantis)`).toBe(false);
    }
    expect(normalizeToE164('011 0 1234 5678', 'TT').ok).toBe(false);
    expect(resolvePhoneCountry('+0')).toBeNull();
    expect(resolvePhoneCountry('+044')).toBeNull();
    expect(normalizeToE164('712-3401', '+0').ok).toBe(false);
    // Controls: the same numbers with a real code still read.
    expect(normalizeToE164('+1 868 712 3401', 'TT')).toMatchObject({ ok: true, e164: '+18687123401' });
    expect(normalizeToE164('00 44 20 7946 0958', 'TT')).toMatchObject({ ok: true, e164: '+442079460958' });
    expect(normalizeToE164('011 44 20 7946 0958', 'TT')).toMatchObject({ ok: true, e164: '+442079460958' });
    expect(resolvePhoneCountry('+44')).toMatchObject({ callingCode: '44' });
  });
});

// -----------------------------------------------------------------------------
// POST .../contacts
// -----------------------------------------------------------------------------

describe('POST .../contacts stores the phone in E.164 using the business country', () => {
  it("RED-BEFORE (journey C, C2): '712-3401' typed for a business with no country set is stored as +18687123401, and GET detail answers it so", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Dara', phone: '712-3401' });
    expect(await stored(id)).toMatchObject({ phone: '+18687123401', phoneNormalized: '+18687123401' });
    const res = await detail(ID.owner, ID.bizTT, id);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.contact.phone).toBe('+18687123401');
    // Read cleanly, so nothing is flagged.
    expect(await issues(ID.bizTT, id)).toEqual([]);
  });

  it("RED-BEFORE: Business.country written out ('Trinidad and Tobago') reads the same: '868-712-3402' and '1 (868) 712-3403' are +1 868 numbers", async () => {
    const a = await created(ID.owner, ID.bizNamed, { firstName: 'Nia', phone: '868-712-3402' });
    const b = await created(ID.owner, ID.bizNamed, { firstName: 'Omar', phone: '1 (868) 712-3403' });
    expect(await stored(a)).toMatchObject({ phone: '+18687123402', phoneNormalized: '+18687123402' });
    expect(await stored(b)).toMatchObject({ phone: '+18687123403', phoneNormalized: '+18687123403' });
  });

  it("RED-BEFORE: the business's country decides: '600-1234' in a Guyana business is +5926001234", async () => {
    const id = await created(ID.owner, ID.bizGY, { firstName: 'Gem', phone: '600-1234' });
    expect(await stored(id)).toMatchObject({ phone: '+5926001234', phoneNormalized: '+5926001234' });
  });

  it("RED-BEFORE: the WhatsApp number is stored in E.164 too: '712-3404' is +18687123404", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Wes', whatsappNumber: '712-3404' });
    expect(await stored(id)).toMatchObject({ whatsappNumber: '+18687123404', phone: null });
  });

  it("CONTROL: a number typed with its country code is kept as written and keyed in E.164 ('+1 868 712 3405'; the Release 0 create case pins that spelling)", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Ida', phone: '+1 868 712 3405' });
    expect(await stored(id)).toMatchObject({ phone: '+1 868 712 3405', phoneNormalized: '+18687123405' });
  });
});

describe('the identity check compares the E.164 value (contact_phone_taken)', () => {
  let holderId: string;

  beforeAll(async () => {
    const holder = await db.contact.findFirst({ where: { businessId: ID.bizTT, firstName: 'Dara' }, select: { id: true } });
    holderId = holder?.id;
  });

  it("RED-BEFORE: a punctuation or country-code variant of a live contact's phone answers 409 contact_phone_taken naming the holder; the number stays with one live contact", async () => {
    expect(holderId).toBeTruthy();
    for (const variant of ['(868) 712-3401', '868 712 3401', '1-868-712-3401', '+1 868 712 3401', '7123401']) {
      const res = await post(ID.owner, ID.bizTT, { firstName: 'Dup', phone: variant });
      expectPhoneTaken(res, holderId);
    }
    expect(await liveWithKey(ID.bizTT, '+18687123401')).toBe(1);
    expect(await db.contact.count({ where: { businessId: ID.bizTT, firstName: 'Dup' } })).toBe(0);
  });

  it("NEGATIVE CONTROL: the holder id is bounded by the actor's visibility: a 'my book' STAFF gets the same 409 with existingContactId null and the id nowhere in the body", async () => {
    const res = await post(ID.staffBook, ID.bizTT, { firstName: 'Probe', phone: '(868) 712-3401', ownerId: ID.staffBook });
    expectPhoneTaken(res, null);
    expect(JSON.stringify(res.body)).not.toContain(holderId);
  });

  it("RED-BEFORE (the stored spelling; the release itself is contact-partial-unique's D-16 rule): a soft-deleted contact's phone is free: after DELETE, a variant of it answers 201 and the new contact is live, the deleted one keeps its row", async () => {
    const goneId = await created(ID.owner, ID.bizTT, { firstName: 'Gone', phone: '712-3406' });
    const del = await remove(ID.owner, ID.bizTT, goneId);
    expect(del.status, JSON.stringify(del.body).slice(0, 300)).toBe(200);
    const againId = await created(ID.owner, ID.bizTT, { firstName: 'Again', phone: '868 712 3406' });
    expect(await stored(againId)).toMatchObject({ phone: '+18687123406', phoneNormalized: '+18687123406', deletedAt: null });
    const gone = await rawRow(goneId);
    expect(gone?.deleted_at).not.toBeNull();
    expect(gone?.phone_normalized).toBe('+18687123406');
    expect(await liveWithKey(ID.bizTT, '+18687123406')).toBe(1);
  });

  it("RED-BEFORE: a live contact stored before E.164 under another spelling ('868-555-0160', key '8685550160') holds the same number: '+1 868 555 0160' and '555-0160' answer 409 naming it", async () => {
    for (const variant of ['+1 868 555 0160', '555-0160', '1 868 555 0160']) {
      const res = await post(ID.owner, ID.bizTT, { firstName: 'Twin', phone: variant });
      expectPhoneTaken(res, ID.legacy);
    }
    expect(await db.contact.count({ where: { businessId: ID.bizTT, firstName: 'Twin' } })).toBe(0);
  });

  it("CONTROL: the stored spelling of that legacy contact's number still answers 409 naming it, and the 'my book' STAFF is told no id", async () => {
    expectPhoneTaken(await post(ID.owner, ID.bizTT, { firstName: 'Twin', phone: '(868) 555-0160' }), ID.legacy);
    const staff = await post(ID.staffBook, ID.bizTT, { firstName: 'Probe', phone: '868-555-0160', ownerId: ID.staffBook });
    expectPhoneTaken(staff, null);
    expect(JSON.stringify(staff.body)).not.toContain(ID.legacy);
  });

  it('RED-BEFORE: the legacy-spelling refusal is bounded the same way: a my-book STAFF posting a variant of it gets existingContactId null', async () => {
    const res = await post(ID.staffBook, ID.bizTT, { firstName: 'Probe', phone: '(1) 868-555-0160', ownerId: ID.staffBook });
    expectPhoneTaken(res, null);
    expect(JSON.stringify(res.body)).not.toContain(ID.legacy);
  });

  it('RED-BEFORE (the stored spelling): another business may hold the same number (uniqueness is per business)', async () => {
    const id = await created(ID.owner, ID.bizNamed, { firstName: 'Dara', phone: '712-3401' });
    expect(await stored(id)).toMatchObject({ phone: '+18687123401' });
  });
});

// -----------------------------------------------------------------------------
// Review repair: a key stored before E.164 is read under the business country
// -----------------------------------------------------------------------------

describe("review repair: a contact stored before E.164 holds the number its key reads as under the business's country, and no other (SEC-E164-1/2, COR-E164-1/2)", () => {
  it("RED-BEFORE (SEC-E164-2, COR-E164-1): re-typing a seven-digit legacy number ('712-3504', key '7123504') answers 409 naming that contact, in every spelling; the number stays with one live contact", async () => {
    for (const variant of ['712-3504', '(868) 712-3504', '+1 868 712 3504', '1-868-712-3504']) {
      const res = await post(ID.owner, ID.bizTT, { firstName: 'Lu', phone: variant });
      expectPhoneTaken(res, ID.lou);
    }
    expect(await db.contact.count({ where: { businessId: ID.bizTT, firstName: 'Lu' } })).toBe(0);
    expect(await liveWithKey(ID.bizTT, '+18687123504')).toBe(0);
    expect(await stored(ID.lou)).toMatchObject({ phone: '712-3504', phoneNormalized: '7123504', deletedAt: null });
  });

  it("RED-BEFORE (SEC-E164-2): the refusal is bounded the same way: a 'my book' STAFF re-typing that number gets existingContactId null and the id nowhere in the body", async () => {
    const res = await post(ID.staffBook, ID.bizTT, { firstName: 'Probe', phone: '712-3504', ownerId: ID.staffBook });
    expectPhoneTaken(res, null);
    expect(JSON.stringify(res.body)).not.toContain(ID.lou);
    // Refused for Lou's number, not for a second holder an earlier write left under the E.164 key.
    expect(await liveWithKey(ID.bizTT, '+18687123504')).toBe(0);
  });

  it("RED-BEFORE (SEC-E164-2): PATCH of another contact onto the seven-digit legacy number answers 409 naming its holder, and the row is unchanged", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Penn' });
    expectPhoneTaken(await patch(ID.owner, ID.bizTT, id, { phone: '712-3504' }), ID.lou);
    expect(await stored(id)).toMatchObject({ phone: null, phoneNormalized: null });
  });

  it("RED-BEFORE (SEC-E164-1): another country's number with the same last digits is a different number: '+592 712 3501' (Guyana) is created beside Tara ('712-3501') and Tara is untouched", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Gita', phone: '+592 712 3501' });
    expect(await stored(id)).toMatchObject({ phone: '+592 712 3501', phoneNormalized: '+5927123501' });
    expect(await stored(ID.tara)).toMatchObject({ phone: '712-3501', phoneNormalized: '7123501', firstName: 'Tara' });
  });

  it("RED-BEFORE (SEC-E164-1): '+44 868 555 0277' (UK) is not Neil's '868-555-0277' (Trinidad): created, not refused naming Neil", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Uma', phone: '+44 868 555 0277' });
    expect(await stored(id)).toMatchObject({ phone: '+44 868 555 0277', phoneNormalized: '+448685550277' });
    expect(await stored(ID.neil)).toMatchObject({ phone: '868-555-0277', phoneNormalized: '8685550277' });
  });

  it("RED-BEFORE (SEC-E164-1): an anonymous storefront intake with '+592 712 3503' does not merge into Tia ('712-3503'): a new contact holds the submitter's name, email and number; Tia keeps no email and the submission is logged on the new contact", async () => {
    const liveBefore = await liveCount(ID.bizTT);
    const eventsBefore = storefrontEvents.length;
    const res = await publicIntake(ID.bizTT, { name: 'Gita Guyana', email: `${P}gita@example.test`, phone: '+592 712 3503' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(await liveCount(ID.bizTT)).toBe(liveBefore + 1);
    const tia = await db.contact.findUnique({ where: { id: ID.tia } });
    expect(tia).toMatchObject({ firstName: 'Tia', email: null, emailNormalized: null, phone: '712-3503', phoneNormalized: '7123503' });
    const gita = await db.contact.findFirst({ where: { businessId: ID.bizTT, emailNormalized: `${P}gita@example.test`, deletedAt: null } });
    expect(gita).toMatchObject({ firstName: 'Gita', lastName: 'Guyana', phone: '+592 712 3503', phoneNormalized: '+5927123503' });
    const logged = storefrontEvents.slice(eventsBefore);
    expect(logged.map((e) => `${e.type}:${e.contactId}`)).toEqual([`lead_form.submitted:${gita.id}`]);
  });

  it("RED-BEFORE (COR-E164-2): an anonymous storefront intake with Tia's number as she was stored ('712-3503', which the base matched by exact key) or in another spelling ('868 712 3503') is Tia: merged into her, no new contact", async () => {
    const liveBefore = await liveCount(ID.bizTT);
    let res = await publicIntake(ID.bizTT, { name: 'Tia Again', email: `${P}tia@example.test`, phone: '712-3503' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    res = await publicIntake(ID.bizTT, { name: 'Tia Third', email: `${P}tia3@example.test`, phone: '868 712 3503' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(await liveCount(ID.bizTT)).toBe(liveBefore);
    expect(await liveWithKey(ID.bizTT, '+18687123503')).toBe(0);
    expect(await db.contact.findUnique({ where: { id: ID.tia } })).toMatchObject({ emailNormalized: `${P}tia@example.test`, phone: '712-3503', phoneNormalized: '7123503' });
  });
});

describe('a number that cannot be read is kept as typed and flagged, never dropped', () => {
  it("RED-BEFORE: 'ask at the front desk' is kept as typed and the contact carries an open invalid_phone issue on 'phone'", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Fay', phone: 'ask at the front desk' });
    expect(await stored(id)).toMatchObject({ phone: 'ask at the front desk' });
    const open = await issues(ID.bizTT, id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'invalid_phone', field: 'phone', status: 'open' });
  });

  it("RED-BEFORE: a second contact whose phone has no digits is kept too ('mobile unknown'): a phone with no digits holds no identity key (it held '' and answered 409)", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Hal', phone: 'mobile unknown' });
    expect(await stored(id)).toMatchObject({ phone: 'mobile unknown', phoneNormalized: null });
    expect((await issues(ID.bizTT, id)).map((i) => `${i.kind}:${i.field}`)).toEqual(['invalid_phone:phone']);
  });

  it("RED-BEFORE: a WhatsApp number that cannot be read ('12345') is kept and flagged on 'whatsappNumber' while the phone reads", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Gus', phone: '712-3413', whatsappNumber: '12345' });
    expect(await stored(id)).toMatchObject({ phone: '+18687123413', whatsappNumber: '12345' });
    const open = await issues(ID.bizTT, id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'invalid_phone', field: 'whatsappNumber', status: 'open' });
  });

  it("RED-BEFORE: under a country with no dialling rules ('Atlantis') a local number is kept and flagged, while a number typed with its country code reads and is not flagged", async () => {
    const local = await created(ID.owner, ID.bizXX, { firstName: 'Lo', phone: '712-3407' });
    expect(await stored(local)).toMatchObject({ phone: '712-3407' });
    expect((await issues(ID.bizXX, local)).map((i) => i.field)).toEqual(['phone']);
    const intl = await created(ID.owner, ID.bizXX, { firstName: 'In', phone: '+44 20 7946 0958' });
    expect(await stored(intl)).toMatchObject({ phone: '+44 20 7946 0958', phoneNormalized: '+442079460958' });
    expect(await issues(ID.bizXX, intl)).toEqual([]);
  });

  it("RED-BEFORE (CR-CODEX-E164-1): a phone written '+0000000' and a WhatsApp number written '00 0123 45678' (a country code starting with 0) are kept as typed and flagged, not stored as valid E.164 (one invalid_phone issue per contact, so one contact each)", async () => {
    const zed = await created(ID.owner, ID.bizTT, { firstName: 'Zed', phone: '+0000000' });
    expect(await stored(zed)).toMatchObject({ phone: '+0000000' });
    expect((await issues(ID.bizTT, zed)).map((i) => `${i.kind}:${i.field}:${i.status}`)).toEqual(['invalid_phone:phone:open']);
    const zia = await created(ID.owner, ID.bizTT, { firstName: 'Zia', phone: '712-3520', whatsappNumber: '00 0123 45678' });
    expect(await stored(zia)).toMatchObject({ phone: '+18687123520', whatsappNumber: '00 0123 45678' });
    expect((await issues(ID.bizTT, zia)).map((i) => `${i.kind}:${i.field}:${i.status}`)).toEqual(['invalid_phone:whatsappNumber:open']);
  });

  it("CONTROL (COR-E164-6, written here, scanned below): a phone typed with '+' and spaces ('+1 868 712 3511', kept as typed) beside a WhatsApp number that cannot be read: the contact is flagged on 'whatsappNumber'", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Wade', phone: '+1 868 712 3511', whatsappNumber: 'ask at the desk' });
    expect(await stored(id)).toMatchObject({ phone: '+1 868 712 3511', whatsappNumber: 'ask at the desk' });
    expect((await issues(ID.bizTT, id)).map((i) => `${i.kind}:${i.field}:${i.status}`)).toEqual(['invalid_phone:whatsappNumber:open']);
  });
});

// -----------------------------------------------------------------------------
// PATCH .../contacts/:contactId
// -----------------------------------------------------------------------------

describe('PATCH .../contacts/:contactId stores the phone in E.164 too', () => {
  let id: string;

  beforeAll(async () => {
    id = await created(ID.owner, ID.bizTT, { firstName: 'Pat' });
  });

  it("RED-BEFORE: PATCH phone '712-3408' and whatsappNumber '712-3409' store +18687123408 and +18687123409", async () => {
    const res = await patch(ID.owner, ID.bizTT, id, { phone: '712-3408', whatsappNumber: '712-3409' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(id)).toMatchObject({ phone: '+18687123408', phoneNormalized: '+18687123408', whatsappNumber: '+18687123409' });
  });

  it("RED-BEFORE: PATCH onto a variant of another live contact's phone answers 409 contact_phone_taken naming it, and the row is unchanged", async () => {
    const holder = await db.contact.findFirst({ where: { businessId: ID.bizTT, firstName: 'Dara' }, select: { id: true } });
    expectPhoneTaken(await patch(ID.owner, ID.bizTT, id, { phone: '868-712-3401' }), holder.id);
    expectPhoneTaken(await patch(ID.owner, ID.bizTT, id, { phone: '+1 868 555 0160' }), ID.legacy);
    expect(await stored(id)).toMatchObject({ phone: '+18687123408', phoneNormalized: '+18687123408' });
  });

  it("RED-BEFORE (the stored spelling): re-sending the contact's own number in another spelling is not a conflict (200)", async () => {
    const res = await patch(ID.owner, ID.bizTT, id, { phone: '(868) 712-3408', jobTitle: 'Chef' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(id)).toMatchObject({ phone: '+18687123408' });
  });

  it('RED-BEFORE: a PATCH to a phone that cannot be read keeps it and flags it; a PATCH back to a readable number resolves the flag', async () => {
    let res = await patch(ID.owner, ID.bizTT, id, { phone: 'mobile unknown' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(id)).toMatchObject({ phone: 'mobile unknown' });
    expect((await issues(ID.bizTT, id)).map((i) => `${i.kind}:${i.field}`)).toEqual(['invalid_phone:phone']);
    res = await patch(ID.owner, ID.bizTT, id, { phone: '712-3410' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(id)).toMatchObject({ phone: '+18687123410' });
    expect(await issues(ID.bizTT, id)).toEqual([]);
  });
});

describe("review repair (COR-E164-3): a PATCH that re-sends the contact's own number leaves it as stored", () => {
  it("RED-BEFORE: PairA ('868-712-3507', key '8687123507'), whose number PairB also holds as '+18687123507' (two keys the base allowed), is edited with its phone re-sent as the full form does: 200, the edit lands, the phone and key are as stored", async () => {
    const res = await patch(ID.owner, ID.bizTT, ID.pairA, { phone: '868-712-3507', jobTitle: 'Chef' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await db.contact.findUnique({ where: { id: ID.pairA } }))
      .toMatchObject({ jobTitle: 'Chef', phone: '868-712-3507', phoneNormalized: '8687123507', deletedAt: null });
  });

  it("RED-BEFORE: the same number in another spelling ('(868) 712-3507') is the same number: 200, nothing about the phone changes", async () => {
    const res = await patch(ID.owner, ID.bizTT, ID.pairA, { phone: '(868) 712-3507', jobTitle: 'Head chef' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await db.contact.findUnique({ where: { id: ID.pairA } }))
      .toMatchObject({ jobTitle: 'Head chef', phone: '868-712-3507', phoneNormalized: '8687123507' });
    expect(await stored(ID.pairB)).toMatchObject({ phone: '+1 868 712 3507', phoneNormalized: '+18687123507' });
  });

  it("RED-BEFORE (SEC-E164-2): a PATCH of PairA onto a different number another live contact holds is still 409 naming it (Lou's '712-3504', typed '868-712-3504'), and PairA keeps its number", async () => {
    expectPhoneTaken(await patch(ID.owner, ID.bizTT, ID.pairA, { phone: '868-712-3504' }), ID.lou);
    expect(await stored(ID.pairA)).toMatchObject({ phone: '868-712-3507', phoneNormalized: '8687123507' });
  });

  it("CONTROL (the packet head's behaviour, kept): a PATCH that re-spells the contact's own number under the same key writes the new spelling (Ira '+1 868 712 3513' to '+18687123513')", async () => {
    const id = await created(ID.owner, ID.bizTT, { firstName: 'Ira', phone: '+1 868 712 3513' });
    expect(await stored(id)).toMatchObject({ phone: '+1 868 712 3513', phoneNormalized: '+18687123513' });
    const res = await patch(ID.owner, ID.bizTT, id, { phone: '+18687123513' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(id)).toMatchObject({ phone: '+18687123513', phoneNormalized: '+18687123513' });
  });

  it("CONTROL (the packet head's behaviour, kept): a contact stored before E.164 whose number no other live contact holds is stored in E.164 when its phone is re-sent with an edit (Rex '868-712-3512' to +18687123512)", async () => {
    const res = await patch(ID.owner, ID.bizTT, ID.rex, { phone: '868-712-3512', jobTitle: 'Driver' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(ID.rex)).toMatchObject({ phone: '+18687123512', phoneNormalized: '+18687123512' });
    expect(await db.contact.findUnique({ where: { id: ID.rex } })).toMatchObject({ jobTitle: 'Driver' });
  });
});

// -----------------------------------------------------------------------------
// CSV import (POST .../import/file -> findOrCreateContact)
// -----------------------------------------------------------------------------

describe('a CSV import stores E.164 and finds the customer it already has', () => {
  let importRes: any;

  beforeAll(async () => {
    importRes = await csvImport(ID.bizTT, [
      'first_name,last_name,phone,whatsapp',
      `Imp,${P}one,712-3411,712-3412`,
      `Dara,${P}again,(868) 712-3401,`,
      `Fern,${P}three,front desk,`,
      `Lena,${P}again,00 1 868 555 0160,`,
    ].join('\n'));
  });

  it('RED-BEFORE: the import completes: four rows, four contacts resolved (on the base the variant row collides with a key an earlier case left and fails)', () => {
    expect(importRes.status, JSON.stringify(importRes.body).slice(0, 300)).toBe(201);
    expect(importRes.body).toMatchObject({ status: 'COMPLETED', totalRows: 4, processedRows: 4 });
  });

  it("RED-BEFORE: a new row's phone and WhatsApp number are stored in E.164", async () => {
    const row = await db.contact.findFirst({ where: { businessId: ID.bizTT, lastName: `${P}one` } });
    expect(row).toMatchObject({ phone: '+18687123411', phoneNormalized: '+18687123411', whatsappNumber: '+18687123412' });
  });

  it("RED-BEFORE: a row with a variant of a live contact's phone merges into that contact: no second contact holds the number", async () => {
    expect(await liveWithKey(ID.bizTT, '+18687123401')).toBe(1);
    expect(await db.contact.count({ where: { businessId: ID.bizTT, lastName: `${P}again`, firstName: 'Dara' } })).toBe(0);
  });

  it("RED-BEFORE: a row with an international spelling ('00 1 868 555 0160') of a contact stored before E.164 merges into it (no duplicate of '868-555-0160')", async () => {
    expect(await db.contact.count({ where: { businessId: ID.bizTT, firstName: 'Lena', deletedAt: null } })).toBe(1);
    expect(await stored(ID.legacy)).toMatchObject({ phone: '868-555-0160', phoneNormalized: '8685550160' });
  });

  it("RED-BEFORE: a row whose phone cannot be read is created, kept as typed and flagged", async () => {
    const row = await db.contact.findFirst({ where: { businessId: ID.bizTT, lastName: `${P}three` } });
    expect(row).toMatchObject({ phone: 'front desk' });
    expect((await issues(ID.bizTT, row.id)).map((i) => `${i.kind}:${i.field}`)).toEqual(['invalid_phone:phone']);
  });
});

describe("review repair (COR-E164-2, SEC-E164-1): a CSV import reads a legacy key under the business's country", () => {
  let importRes: any;
  let liveBefore: number;

  beforeAll(async () => {
    liveBefore = await liveCount(ID.bizTT);
    importRes = await csvImport(ID.bizTT, [
      'first_name,last_name,phone',
      `Ivy,${P}imp2,712-3505`,
      `Gwen,${P}imp2,+592 712 3506`,
    ].join('\n'));
  });

  it('CONTROL: the import completes: two rows, both processed', () => {
    expect(importRes.status, JSON.stringify(importRes.body).slice(0, 300)).toBe(201);
    expect(importRes.body).toMatchObject({ status: 'COMPLETED', totalRows: 2, processedRows: 2 });
  });

  it("RED-BEFORE (COR-E164-2): the row with Ivy's number as she was stored ('712-3505', which the base matched by exact key) merges into Ivy: no second contact holds +1 868 712 3505", async () => {
    expect(await liveWithKey(ID.bizTT, '+18687123505')).toBe(0);
    expect(await db.contact.count({ where: { businessId: ID.bizTT, lastName: `${P}imp2`, firstName: 'Ivy', deletedAt: null } })).toBe(0);
    expect(await stored(ID.ivy)).toMatchObject({ phone: '712-3505', phoneNormalized: '7123505', deletedAt: null });
  });

  it("RED-BEFORE (SEC-E164-1): the row with '+592 712 3506' (Guyana) is a new contact, not Gil ('712-3506', Trinidad): Gil is untouched", async () => {
    const gwen = await db.contact.findFirst({ where: { businessId: ID.bizTT, lastName: `${P}imp2`, firstName: 'Gwen', deletedAt: null } });
    expect(gwen).toMatchObject({ phone: '+592 712 3506', phoneNormalized: '+5927123506' });
    expect(await stored(ID.gil)).toMatchObject({ firstName: 'Gil', phone: '712-3506', phoneNormalized: '7123506' });
    expect(await liveCount(ID.bizTT)).toBe(liveBefore + 1);
  });
});

describe('review repair (COR-E164-5): the import preview (check-duplicates) reads a phone the way the create and the import do', () => {
  it("RED-BEFORE: '712-3510' previews as the contact saved from '(868) 712-3510' (+18687123510), and a POST of it answers 409 naming the same contact", async () => {
    const holderId = await created(ID.owner, ID.bizTT, { firstName: 'Cleo', phone: '(868) 712-3510' });
    expect(await stored(holderId)).toMatchObject({ phone: '+18687123510' });
    const res = await checkDuplicates(ID.bizTT, [{ firstName: 'Cleo', phone: '712-3510' }]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({ total: 1, newCount: 0, duplicateCount: 1 });
    expect(res.body.duplicates[0]).toMatchObject({ importIndex: 0, matchField: 'phone', existingContact: { id: holderId } });
    expectPhoneTaken(await post(ID.owner, ID.bizTT, { firstName: 'Cleo', phone: '712-3510' }), holderId);
  });

  it("RED-BEFORE: a legacy seven-digit key ('7123504', Lou) previews as Lou for '868 712 3504' and '+1 868 712 3504'; '+592 712 3504' (Guyana) and '+44 712 3504' are new", async () => {
    const res = await checkDuplicates(ID.bizTT, [
      { phone: '868 712 3504' },
      { phone: '+1 868 712 3504' },
      { phone: '+592 712 3504' },
      { phone: '+44 712 3504' },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const byIndex = new Map<number, any>(res.body.duplicates.map((d: any) => [d.importIndex, d]));
    expect(byIndex.get(0)).toMatchObject({ matchField: 'phone', existingContact: { id: ID.lou } });
    expect(byIndex.get(1)).toMatchObject({ matchField: 'phone', existingContact: { id: ID.lou } });
    expect(byIndex.has(2)).toBe(false);
    expect(byIndex.has(3)).toBe(false);
    expect(res.body).toMatchObject({ total: 4, duplicateCount: 2, newCount: 2 });
  });
});

// -----------------------------------------------------------------------------
// The data-quality scan reads the same way and keeps the write's flags
// -----------------------------------------------------------------------------

describe('POST .../data-quality/scan reads phones under the business country and keeps the flags', () => {
  beforeAll(async () => {
    const res = await scan(ID.bizTT);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it('RED-BEFORE: a contact stored in E.164 has no phone issue after the scan', async () => {
    const dara = await db.contact.findFirst({ where: { businessId: ID.bizTT, firstName: 'Dara' }, select: { id: true } });
    expect((await issues(ID.bizTT, dara.id)).filter((i) => i.kind === 'invalid_phone')).toEqual([]);
  });

  it("RED-BEFORE: the contact stored before E.164 ('868-555-0160') reads as a Trinidad number: a low-severity reformat to +18685550160, not 'not recognisable'", async () => {
    const phoneIssues = (await issues(ID.bizTT, ID.legacy)).filter((i) => i.kind === 'invalid_phone');
    expect(phoneIssues).toHaveLength(1);
    expect(phoneIssues[0]).toMatchObject({
      severity: 'low', field: 'phone', recommendedFix: { action: 'replace_phone', value: '+18685550160' },
    });
  });

  it("RED-BEFORE: the WhatsApp flag written with the contact stays open after the scan", async () => {
    const gus = await db.contact.findFirst({ where: { businessId: ID.bizTT, firstName: 'Gus' }, select: { id: true } });
    const open = (await issues(ID.bizTT, gus.id)).filter((i) => i.kind === 'invalid_phone');
    expect(open.map((i) => `${i.kind}:${i.field}:${i.status}`)).toEqual(['invalid_phone:whatsappNumber:open']);
  });

  it("CONTROL: the phone flag written with the contact stays open after the scan", async () => {
    const fay = await db.contact.findFirst({ where: { businessId: ID.bizTT, firstName: 'Fay' }, select: { id: true } });
    const open = (await issues(ID.bizTT, fay.id)).filter((i) => i.kind === 'invalid_phone');
    expect(open.map((i) => `${i.kind}:${i.field}:${i.status}`)).toEqual(['invalid_phone:phone:open']);
  });

  it("RED-BEFORE (COR-E164-6): the WhatsApp flag outranks a mere reformat suggestion: Wade's phone typed '+1 868 712 3511' (kept as typed) does not take the contact's one phone issue from his unreadable WhatsApp number", async () => {
    const wade = await db.contact.findFirst({ where: { businessId: ID.bizTT, firstName: 'Wade' }, select: { id: true } });
    const open = (await issues(ID.bizTT, wade.id)).filter((i) => i.kind === 'invalid_phone');
    expect(open.map((i) => `${i.kind}:${i.field}:${i.status}`)).toEqual(['invalid_phone:whatsappNumber:open']);
    expect(open[0]).toMatchObject({ recommendedFix: { action: 'edit_whatsapp' } });
  });

  it('CONTROL: the business still has every contact this file created live (nothing was dropped)', async () => {
    expect(await liveCount(ID.bizTT)).toBeGreaterThanOrEqual(11);
  });
});

describe('review repair (COR-E164-4): applying the data-quality phone fix keeps the identity rule', () => {
  let fixAIssue: any;

  beforeAll(async () => {
    const res = await scan(ID.bizTT);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    fixAIssue = await openPhoneIssue(ID.fixA);
  });

  it("CONTROL: the scan offers FixA ('868-712-3508', key '8687123508') a low-severity reformat to +18687123508, the number FixB holds as '+18687123508'", () => {
    expect(fixAIssue).toMatchObject({
      severity: 'low', field: 'phone', status: 'open', recommendedFix: { action: 'replace_phone', value: '+18687123508' },
    });
  });

  it('RED-BEFORE: applying it answers 409 contact_phone_taken naming FixB (not a 500); FixA keeps its phone and the issue stays open', async () => {
    const res = await applyFix(ID.bizTT, fixAIssue.id);
    expectPhoneTaken(res, ID.fixB);
    expect(await stored(ID.fixA)).toMatchObject({ phone: '868-712-3508', phoneNormalized: '8687123508' });
    expect(await stored(ID.fixB)).toMatchObject({ phone: '+18687123508', phoneNormalized: '+18687123508' });
    expect(await openPhoneIssue(ID.fixA)).toMatchObject({ id: fixAIssue.id, status: 'open' });
  });

  it('RED-BEFORE: bulk-apply reports that issue failed with the same plain message, and no database or server text reaches the client', async () => {
    const res = await bulkApplyFix(ID.bizTT, [fixAIssue.id]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({ applied: 0, failed: 1 });
    expect(res.body.results).toEqual([
      { issueId: fixAIssue.id, ok: false, error: 'A contact with this phone number already exists in this business' },
    ]);
    const text = JSON.stringify(res.body);
    for (const needle of ['prisma', 'Prisma', 'invocation', '.ts', 'Unique constraint', '/home/']) expect(text).not.toContain(needle);
    expect(await stored(ID.fixA)).toMatchObject({ phone: '868-712-3508', phoneNormalized: '8687123508' });
  });

  it("CONTROL: applying the reformat for FixC ('868-712-3509'), whose number no other contact holds, stores +18687123509 and resolves the issue", async () => {
    const issue = await openPhoneIssue(ID.fixC);
    expect(issue).toMatchObject({ recommendedFix: { action: 'replace_phone', value: '+18687123509' } });
    const res = await applyFix(ID.bizTT, issue.id);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({ issueId: issue.id, status: 'resolved', applied: true });
    expect(await stored(ID.fixC)).toMatchObject({ phone: '+18687123509', phoneNormalized: '+18687123509' });
    expect(await openPhoneIssue(ID.fixC)).toBeNull();
  });
});
