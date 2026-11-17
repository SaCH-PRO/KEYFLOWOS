/**
 * FU-WA-CONTACT-PHONE (V1-71; journeys D, E and F; owner rulings D-153 'whatsapp' and D-221
 * 'followups') — the save behind the WhatsApp share's confirm step, against a REAL database,
 * through the HTTP routes.
 *
 * WA-HELPER's security repair (SEC-WAH-1) opens wa.me for a quote or invoice share only for the
 * WhatsApp number the business saved on the contact (Contact.whatsappNumber): Contact.phone can
 * be filled by an anonymous visitor (the storefront intake, bookings and orders fill a blank
 * phone on the contact they match by e-mail), and the share carries the document's bearer link.
 * So a contact created with only a phone (an owner POST, the composer's quick-add, a CSV import)
 * got WhatsApp's chooser. The web now closes that gap with one confirm step: it shows the E.164
 * reading of the phone and one button, 'Use this as their WhatsApp number', which saves the
 * number through the existing contact update route (PATCH
 * /crm/businesses/:businessId/contacts/:contactId) and then opens wa.me. This suite proves what
 * the web relies on from that route:
 *
 *  - the save is the member's own crm write: a member whose crm access is read only is refused
 *    (403, ModuleScopeGuard's 'Insufficient permissions: crm requires write access (you have
 *    read)', the refusal the web says in plain words), and nothing is written: no WhatsApp
 *    number, no ContactAuditEntry, no ContactEvent, no team activity row;
 *  - a member with crm write saves it: the row holds the E.164 number, the phone is untouched,
 *    and the save is audited in the write's own transaction (a ContactAuditEntry 'updated' whose
 *    actor is that member and whose changed fields are exactly whatsappNumber; a contact.updated
 *    ContactEvent naming the member) and in the team activity log (crm contact_updated);
 *  - the saved number is what the member's contact read serves at the next share (GET
 *    .../contacts/:contactId), so the confirm step is asked once;
 *  - a member who may not edit this contact ('my book' STAFF, crm write, and the contact is not
 *    theirs) is refused too, and nothing is written;
 *  - never filled without that confirmation: the anonymous storefront intake that matches the
 *    contact by e-mail fills its blank phone (as before) and leaves the WhatsApp number empty, so
 *    the share still asks.
 *
 * The route needed no server change for this packet: these cases pass on the packet's source
 * base (506e95f6) and pin the contract the web's confirm step relies on (CONTROL).
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, ValidationPipe,
 * GlobalHttpExceptionFilter, CrmController, CrmService, EntityResolutionService, CrmStatsService
 * and ContactAuditService are real against DATABASE_URL; so is the anonymous storefront intake
 * route (SiteController, IntakeService, PublicRateLimitGuard against REDIS_URL, HoneypotGuard).
 * Identity attachment reads `x-test-user` and loads that seeded user row as AuthMiddleware would
 * after token verification; the timeline is a recorder of the ContactEvents a write logs (type and
 * actor), caches, flow, notifications and the storefront event log are recorders, and the plan
 * limit allows. No request leaves the process.
 *
 * Requires DATABASE_URL and REDIS_URL. Every seeded row carries the `v71m_` prefix (rows created
 * through the API are deleted by business id) and is hard-deleted by raw SQL (sqlLikePrefix) in
 * beforeAll and afterAll.
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

const P = 'v71m_';
const ID = {
  owner: `${P}owner`,         // OWNER of biz
  staffRead: `${P}staffRead`, // STAFF, crm: read (can open the customer, cannot edit customers)
  staffWrite: `${P}staffWr`,  // STAFF, crm: write (view all, edit any)
  staffBook: `${P}staffBk`,   // STAFF, crm: write, 'my book' (crm_view owned, crm_edit owned)
  biz: `${P}biz`,             // Business.country unset: Trinidad and Tobago (+1 868)
  // Customers with a phone and no WhatsApp number: what an owner POST, the composer quick-add or
  // a CSV import leaves, and what the share's confirm step offers to save.
  maria: `${P}c_maria`,       // TEAM, owned by the OWNER: the read-only member is refused, the writer saves
  rena: `${P}c_rena`,         // TEAM, owned by the OWNER: the OWNER saves a local spelling
  tom: `${P}c_tom`,           // TEAM, owned by the OWNER: the 'my book' member may not edit him
  // A customer known by e-mail only: the storefront intake fills her blank phone, never her WhatsApp number.
  ivy: `${P}c_ivy`,
};

/** E.164 readings the web's confirm step shows (WA-E164-SERVER stores phones this way). */
const MARIA_E164 = '+18687550123';
const RENA_E164 = '+18687550145';
const TOM_E164 = '+18687550167';

let db: any;
let app: any;
let redis: any;
/** ContactEvents the timeline recorded (CrmTimelineService.logEvent), in order. */
const contactEvents: Array<{ businessId: string; contactId: string; type: string; actorId?: string | null }> = [];

/** A fresh client address per request: each gets its own rate-limit bucket. */
let ipN = 0;
const nextIp = () => `10.71.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Rows created through the API
  // have generated ids, so every table goes by business id.
  for (const sql of [
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

/** The confirm step's save: PATCH .../contacts/:contactId with the WhatsApp number alone, as the web sends it. */
function saveWhatsApp(actor: string, contactId: string, whatsappNumber: string) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${ID.biz}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ whatsappNumber });
}

/** The member's own contact read, as the share makes it (GET .../contacts/:contactId). */
function detail(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.biz}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

/** The anonymous storefront intake form (no signed-in member): POST /site/storefront/public/:slug/intake. */
function publicIntake(body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/site/storefront/public/${ID.biz}/intake`)
    .set('x-forwarded-for', nextIp())
    .send({ category: 'Catering', description: 'A quote for a family lime', ...body });
}

// ---- reads ------------------------------------------------------------------

async function stored(contactId: string) {
  return db.contact.findUnique({
    where: { id: contactId },
    select: { id: true, phone: true, phoneNormalized: true, whatsappNumber: true, email: true, firstName: true },
  });
}

async function audits(contactId: string) {
  return db.contactAuditEntry.findMany({ where: { businessId: ID.biz, contactId }, orderBy: { createdAt: 'asc' } });
}

async function teamRows(contactId: string) {
  return db.teamActivityLog.findMany({ where: { businessId: ID.biz, entityId: contactId } });
}

/** The team activity row is written after the response (TeamAuditInterceptor, fire-and-forget): wait for it. */
async function teamRowsSettled(contactId: string, expected: number) {
  await vi.waitFor(async () => expect(await teamRows(contactId)).toHaveLength(expected), { timeout: 5_000, interval: 50 });
  return teamRows(contactId);
}

const eventsFor = (contactId: string) => contactEvents.filter((e) => e.contactId === contactId);

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
  // The anonymous storefront intake: findOrCreateContact on the public surface.
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
      // The matcher findOrCreateContact consults is real.
      EntityResolutionService,
      { provide: CrmImportService, useValue: {} },
      { provide: CrmDataQualityService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // A recorder of each ContactEvent a write logs (type and actor; a refused write logs none);
      // the timeline's feed and announcement side channels are not under test.
      {
        provide: CrmTimelineService,
        useValue: {
          logEvent: async (businessId: string, contactId: string, type: string, _payload: unknown, opts?: { actorId?: string | null }) => {
            contactEvents.push({ businessId, contactId, type, actorId: opts?.actorId ?? null });
          },
          logContactEvent: async () => undefined,
        },
      },
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
          logStorefrontEvent: async () => undefined,
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

  // ---- identities, tenant, memberships -----------------------------------
  for (const suffix of ['owner', 'staffRead', 'staffWr', 'staffBk']) {
    await db.user.create({ data: { id: `${P}${suffix}`, email: `${P}${suffix}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71M Sweet Treats', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_staffRead`, userId: ID.staffRead, businessId: ID.biz, role: 'STAFF', permissionScopes: { crm: 'read' } },
  });
  await db.membership.create({
    data: { id: `${P}m_staffWr`, userId: ID.staffWrite, businessId: ID.biz, role: 'STAFF', permissionScopes: { crm: 'write' } },
  });
  await db.membership.create({
    data: {
      id: `${P}m_staffBk`, userId: ID.staffBook, businessId: ID.biz, role: 'STAFF',
      permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' },
    },
  });

  // Phone-only customers, stored as WA-E164-SERVER stores an owner's create (the phone in E.164,
  // keyed by it), with no WhatsApp number.
  for (const [id, firstName, phone] of [
    [ID.maria, 'Maria', MARIA_E164],
    [ID.rena, 'Rena', RENA_E164],
    [ID.tom, 'Tom', TOM_E164],
  ] as const) {
    await db.contact.create({
      data: { id, businessId: ID.biz, firstName, lastName: `${P}seed`, ownerId: ID.owner, phone, phoneNormalized: phone },
    });
  }
  await db.contact.create({
    data: {
      id: ID.ivy, businessId: ID.biz, firstName: 'Ivy', lastName: `${P}seed`, ownerId: ID.owner,
      email: `${P}ivy@example.test`, emailNormalized: `${P}ivy@example.test`,
    },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (redis) await redis.quit().catch(() => undefined);
  if (db) await cleanup();
});

// -----------------------------------------------------------------------------

describe("the confirm step's save is the member's own crm write (PATCH .../contacts/:contactId { whatsappNumber })", () => {
  it('CONTROL: a member whose crm access is read only can open the customer the share reads (no WhatsApp number, a phone)', async () => {
    const res = await detail(ID.staffRead, ID.maria);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.contact).toMatchObject({ id: ID.maria, phone: MARIA_E164, whatsappNumber: null });
  });

  it("CONTROL: that member's save is refused with ModuleScopeGuard's crm write refusal, and nothing is written (no number, no audit entry, no event, no team activity)", async () => {
    const eventsBefore = eventsFor(ID.maria).length;
    const res = await saveWhatsApp(ID.staffRead, ID.maria, MARIA_E164);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(403);
    // The words the web reads (lib/module-scope-refusal.ts isModuleScopeRefusal) to say the refusal plainly.
    expect(res.body.message).toBe('Insufficient permissions: crm requires write access (you have read)');
    expect(await stored(ID.maria)).toMatchObject({ phone: MARIA_E164, phoneNormalized: MARIA_E164, whatsappNumber: null });
    expect(await audits(ID.maria)).toEqual([]);
    expect(eventsFor(ID.maria).length).toBe(eventsBefore);
    // Give a stray after-response write the time it would take, then check none was made.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await teamRows(ID.maria)).toEqual([]);
  });

  it('CONTROL: a member with crm write saves it: the row holds the E.164 number and the phone is untouched', async () => {
    const res = await saveWhatsApp(ID.staffWrite, ID.maria, MARIA_E164);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.maria, whatsappNumber: MARIA_E164, phone: MARIA_E164 });
    expect(await stored(ID.maria)).toMatchObject({ phone: MARIA_E164, phoneNormalized: MARIA_E164, whatsappNumber: MARIA_E164 });
  });

  it('CONTROL: the save is audited in its own transaction: one ContactAuditEntry updated by that member, changing exactly whatsappNumber', async () => {
    const entries = await audits(ID.maria);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', entityType: 'contact', actor: { type: 'USER', id: ID.staffWrite } });
    expect([...entries[0].changedFields]).toEqual(['whatsappNumber']);
    expect(entries[0].before).toMatchObject({ whatsappNumber: null });
    expect(entries[0].after).toMatchObject({ whatsappNumber: MARIA_E164 });
  });

  it('CONTROL: and on the timeline and in the team activity log, as that member', async () => {
    expect(eventsFor(ID.maria).map((e) => `${e.type}:${e.actorId}`)).toEqual([`contact.updated:${ID.staffWrite}`]);
    const rows = await teamRowsSettled(ID.maria, 1);
    expect(rows[0]).toMatchObject({ userId: ID.staffWrite, module: 'crm', action: 'contact_updated', entityType: 'contact', entityId: ID.maria });
  });

  it("CONTROL: the next share's read serves the saved number, so the confirm step is asked once", async () => {
    for (const member of [ID.staffRead, ID.staffWrite, ID.owner]) {
      const res = await detail(member, ID.maria);
      expect(res.status, `${member}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      expect(res.body.contact.whatsappNumber, member).toBe(MARIA_E164);
    }
  });

  it("CONTROL: the owner's save of a local spelling is stored in E.164 under the business's country (WA-E164-SERVER) and audited as the owner", async () => {
    const res = await saveWhatsApp(ID.owner, ID.rena, '755-0145');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(await stored(ID.rena)).toMatchObject({ phone: RENA_E164, whatsappNumber: RENA_E164 });
    const entries = await audits(ID.rena);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.owner } });
    expect([...entries[0].changedFields]).toEqual(['whatsappNumber']);
  });

  it("CONTROL: a member with crm write who may not edit this customer ('my book', not theirs) is refused, and nothing is written", async () => {
    const res = await saveWhatsApp(ID.staffBook, ID.tom, TOM_E164);
    expect([403, 404], JSON.stringify(res.body).slice(0, 300)).toContain(res.status);
    expect(await stored(ID.tom)).toMatchObject({ phone: TOM_E164, whatsappNumber: null });
    expect(await audits(ID.tom)).toEqual([]);
    expect(eventsFor(ID.tom)).toEqual([]);
  });
});

describe('never filled without that confirmation', () => {
  it("CONTROL: the anonymous storefront intake that matches a customer by e-mail fills her blank phone and leaves her WhatsApp number empty (the share still asks)", async () => {
    const res = await publicIntake({ name: 'Ivy Visitor', email: `${P}ivy@example.test`, phone: '755-0189' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const ivy = await stored(ID.ivy);
    expect(ivy).toMatchObject({ firstName: 'Ivy', phone: '+18687550189', whatsappNumber: null });
    const read = await detail(ID.owner, ID.ivy);
    expect(read.status).toBe(200);
    expect(read.body.contact).toMatchObject({ phone: '+18687550189', whatsappNumber: null });
  });
});
