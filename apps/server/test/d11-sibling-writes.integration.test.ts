/**
 * R0-09b-D11-SIBLING-WRITES — owner ruling D-11 (editing the business profile is
 * OWNER only, regardless of granted scopes) holds on the routes R0-09's review
 * named, R09-ST-2 and R09-ST-3, and on the concierge chat intake beside them
 * (R0-09b review SEC-2). REAL database.
 *
 * SCOPE, NOT A SWEEP: these are not all the siblings of the generic PATCH.
 * POST /business-genesis/businesses/:id/answers (name, currency, country,
 * businessIntent) and POST /businesses/:id/templates/:templateId/apply
 * (industry, archetype) still write owner-only profile fields for any member;
 * their fixes are outside this write set and they are tracked as it.todo in
 * identity-boundary.integration.test.ts, "OPEN DEFECTS — D-11 sibling write
 * paths" (R0-09b review SEC-1).
 *
 * R0-09-ID-HARDEN made PATCH /identity/businesses/:businessId owner-only. Its
 * review found two sibling routes, guarded by AuthGuard and BusinessGuard only
 * (any member), that still write owner-only profile fields:
 *
 *   R09-ST-2  PUT /site/presence/businesses/:id/draft stores draft.slug and
 *             POST .../publish copies it onto Business.slug
 *             (site/presence/presence.service.ts publish), so a STAFF member
 *             with settings:none changes the public address the PATCH refuses.
 *   R09-ST-3  POST /onboarding-concierge/businesses/:id/auto-configure writes
 *             Business.name (customBusinessName), overwrites businessHours, turns
 *             the store on, mints a slug when there is none and rewrites
 *             metaData, for any member and with no completion precondition
 *             (onboarding-concierge.service.ts autoConfigureFromTemplate).
 *
 * REQUIRED (the R09-ST-2 and R09-ST-3 it.todo entries this packet removes from
 * identity-boundary.integration.test.ts, "OPEN DEFECTS — D-11 sibling write
 * paths"): a non-owner — STAFF of any scope, ADMIN with settings:write — is
 * refused 403 for the slug change and for the auto-configure profile writes,
 * with Business.slug, name and businessHours byte-identical (here: the whole
 * Business row, as row_to_json text). The owner — the OWNER membership or the
 * distinguished owner (Business.ownerId), the two arms
 * IdentityService.assertBusinessOwner and BusinessGuard admit an owner by — and
 * a SUPER_ADMIN (the platform bypass BusinessGuard already grants) still
 * succeed.
 *
 * OWNER-ONLY FIELDS: the ones PATCH /identity/businesses/:id writes (R0-09):
 * name, slug, currency, timezone, tax, store settings, businessHours,
 * businessIntent, industry, archetype, country, the configuration kept in
 * metaData and the rest of UpdateBusinessDto. The presence routes put exactly
 * one of them on the Business row (slug, at publish); every other presence
 * field (branding, sections, seo, customDomain) lives in site_page_drafts /
 * site_pages_published only, so those edits keep today's rule (any member) and
 * the cases tagged "today's rule kept" pin that nothing else was tightened.
 * A non-owner may not put a new slug in the draft (403), and a non-owner's
 * publish never moves Business.slug: the page goes live at the current
 * address and a pending draft slug waits for the owner's publish (cases S02,
 * S09; review CR-1: a draft slug left behind by the owner's PATCH must not
 * block a content publish).
 * Every auto-configure call writes the business's setup configuration into
 * Business.metaData (conciergeTemplateId, conciergeSetupAt, the setup
 * milestone; paymentMethodsConfigured and paymentRecommendations by default),
 * so no auto-configure call writes no owner-only field: the route is
 * owner-only as a whole (case C02). The concierge chat stays open to any
 * member, but only the owner's answers are persisted as intake (businessIntent,
 * industry, archetype, country and the blueprint; cases C07, C08).
 * Business.metaData is not owner-only as a bag: the concierge's display-state
 * keys (conciergeDismissed, conciergeDismissedAt, snoozedNudges, nudgeHistory),
 * which dismiss, resume, snooze and GET nudges write with server-chosen
 * values, carry no profile content and stay open to any member (case C09,
 * review CR-2).
 *
 * R0-09g-D11-DOCUMENT-TEMPLATES (cases D11-D*): the last writer the R0-09f
 * static sweep (src/core/config/d11-owner-writes.spec.ts) pinned as open.
 * PATCH /commerce/businesses/:id/document-templates writes
 * Business.invoiceTemplate and quoteTemplate (UpdateBusinessDto fields, so
 * part of the owner-only profile) and admitted any member holding
 * revenue:write. Every value it accepts is one of those two columns, so the
 * route is owner-only as a whole: a non-owner — STAFF on role defaults or
 * granted every scope, ADMIN on role defaults or with settings:write — is
 * refused 403 BUSINESS_PROFILE_OWNER_ONLY with the Business row byte-identical.
 * The owner by either arm (the OWNER membership, or Business.ownerId with no
 * membership row, whom the route's revenue:write ModuleScopeGuard used to
 * refuse) and a SUPER_ADMIN set the templates; GET .../document-templates
 * stays open to every member (revenue:read included) and a foreign business
 * id writes nothing.
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real PresenceController, PresenceService, OnboardingConciergeController,
 * OnboardingConciergeService, CatalogService (it creates the template's
 * products), CommerceController (its document-templates routes; the
 * collaborators those routes never call are stubs) with the real
 * FinanceSettingsService (whose isProfileOwner it runs), ModuleScopeGuard,
 * PrismaService, AuthGuard, BusinessGuard and the production
 * GlobalHttpExceptionFilter, against the database at DATABASE_URL. The one
 * stand-in on the authorization path is identity attachment: a test middleware
 * reads `x-test-user`, loads that seeded User row and attaches
 * `{ id, email, role }` exactly as AuthMiddleware does after token
 * verification. Collaborators these routes never authorize with are stubs or
 * recorders (EventEmitter2 records emits; BlueprintService's mirror records
 * which business it was asked to infer for; AiUsageService.callAi answers a
 * fixed concierge reply with EXTRACTED lines, so no provider is called; the
 * presence overview, storefront intelligence, demo seeder and onboarding state
 * are not on these routes). The production
 * ValidationPipe needs the parameter types tsc emits, which vitest's esbuild
 * transform does not, so in-process bodies are not whitelisted; nothing here
 * depends on the whitelist.
 *
 * Presence slugs must match /^[a-z0-9-]{1,64}$/ (presence.service.ts), which has
 * no '_', so every slug below is slugOf(tag) = 'k09b-<tag>': the prefix head
 * with a hyphen. Rows are found and deleted by id, never by slug.
 *
 * FIXTURES: every user and business id has the `k09b_` prefix (registered in
 * test/helpers/fixture-prefixes.json, packet 'R0-09 / R0-09b-D11-SIBLING-WRITES')
 * and every row is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and
 * afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k09b_';
/** A presence-valid slug derived from the prefix head ('k09b-<tag>'); presence slugs allow no '_'. */
const slugOf = (tag: string) => `${P.slice(0, -1)}-${tag}`;

const ID = {
  owner: `${P}owner`,             // OWNER of bizP and bizQ (OWNER membership + Business.ownerId); Business.ownerId of bizS
  staff: `${P}staff`,             // STAFF, role-default scopes (settings: none)
  staffAll: `${P}staffAll`,       // STAFF granted every module scope at admin (settings: admin included)
  admin: `${P}admin`,             // ADMIN, role-default scopes (settings: admin)
  adminW: `${P}adminW`,           // ADMIN, ADMIN defaults with settings: write
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership anywhere
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizL, no membership row (founding-membership backfill window)
  bizP: `${P}bizP`,               // presence: the non-owner refusals, today's-rule cases, then the OWNER control
  bizQ: `${P}bizQ`,               // concierge: the non-owner refusals, then the OWNER control
  bizS: `${P}bizS`,               // the SUPER_ADMIN controls (presence and concierge)
  bizL: `${P}bizL`,               // the distinguished-owner controls (presence and concierge)
};
const USERS = [ID.owner, ID.staff, ID.staffAll, ID.admin, ID.adminW, ID.superAdmin, ID.legacyOwner];
const NON_OWNERS: Array<{ id: string; label: string }> = [
  { id: ID.staff, label: 'STAFF, role defaults (settings:none)' },
  { id: ID.staffAll, label: 'STAFF, every scope admin' },
  { id: ID.admin, label: 'ADMIN, role defaults (settings:admin)' },
  { id: ID.adminW, label: 'ADMIN, settings:write' },
];
const emailOf = (id: string) => `${id}@k09b.test.local`;

/** Each business's seeded (owner-set) slug, keyed by business id. */
const LIVE: Record<string, string> = {
  [ID.bizP]: slugOf('bizp-live'),
  [ID.bizQ]: slugOf('bizq-live'),
  [ID.bizS]: slugOf('bizs-live'),
  [ID.bizL]: slugOf('bizl-live'),
};
/** The owner-set hours on bizQ, so "overwritten" is visible (the template's hours differ). */
const SEEDED_HOURS = { sat: { open: '07:00', close: '11:00', closed: false } };
const TEMPLATE = 'consulting';
/** What the stubbed AI extracts from any concierge chat message (EXTRACTED lines a caller's message can steer). */
const AI_COUNTRY = 'k09b-country';
const AI_INDUSTRY = 'k09b-industry';
const AI_REPLY = `Welcome to KeyFlow!\nEXTRACTED: country=${AI_COUNTRY}\nEXTRACTED: industry=${AI_INDUSTRY}`;

/** The refusal codes the server answers with (asserted, so a 403 from another layer does not pass). */
const SLUG_CODE = 'PRESENCE_SLUG_OWNER_ONLY';
const CONCIERGE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';
const DOCUMENT_TEMPLATES_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';
/** The column default (schema.prisma Business.invoiceTemplate / quoteTemplate), the seeded state of every business. */
const STORED_TEMPLATE = 'classic';

let db: any;
let app: any;
let templateHours: unknown;
const emitted: string[] = [];
/** The business ids BlueprintService.inferFromOnboarding was called for (intake persistence). */
const blueprintInferred: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM site_pages_published WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM site_page_drafts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_blueprints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

async function businessRow(id: string) {
  return db.business.findUnique({
    where: { id },
    select: { slug: true, name: true, businessHours: true, storeEnabled: true, metaData: true },
  });
}

/** A valid presence payload (presence.service.ts presenceSchema), with an optional slug. */
function payload(opts: { slug?: string; headline?: string } = {}) {
  return {
    branding: { primaryColor: '#123456' },
    sections: [{ id: 'sec_hero', type: 'hero', visible: true, data: { headline: opts.headline ?? 'k09b headline' } }],
    seo: { metaTitle: 'k09b title' },
    ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
  };
}

/**
 * Each case starts from the seeded state, so its result does not depend on an
 * earlier case (on the unmodified code the refusal cases change the row): the
 * seeded slug back on the Business row, no draft and no published page,
 * optionally a draft seeded directly (as if saved earlier). Raw SQL, so the
 * reset itself does not touch updated_at.
 */
async function resetPresence(businessId: string, draft?: Record<string, unknown>) {
  await db.$executeRawUnsafe('DELETE FROM site_pages_published WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('DELETE FROM site_page_drafts WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('UPDATE businesses SET slug = $2 WHERE id = $1', businessId, LIVE[businessId]);
  if (draft) await db.sitePageDraft.create({ data: { businessId, payload: draft, status: 'DRAFT', version: 1 } });
}

/**
 * The seeded profile back on a concierge business (name, slug, hours, store off,
 * empty metaData, no intake answers), no products, and the blueprint recorder
 * cleared.
 */
async function resetConcierge(businessId: string) {
  await db.$executeRawUnsafe('DELETE FROM products WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe(
    `UPDATE businesses SET name = $2, slug = $3, business_hours = $4::jsonb, store_enabled = false, meta_data = '{}'::jsonb,
       business_intent = NULL, industry = NULL, archetype = NULL, country = NULL WHERE id = $1`,
    businessId, `${businessId}-name`, LIVE[businessId], JSON.stringify(SEEDED_HOURS),
  );
  blueprintInferred.length = 0;
}

/** The Business row as Postgres stores it, without meta_data and updated_at: "every other column". */
async function businessRowTextExceptMeta(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe(
    `SELECT (to_jsonb(b) - 'meta_data' - 'updated_at')::text AS j FROM businesses b WHERE b.id = $1`, id,
  );
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

async function draftRowText(businessId: string): Promise<string | null> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(d)::text AS j FROM site_page_drafts d WHERE d.business_id = $1', businessId);
  return rows.length ? (rows[0].j as string) : null;
}

async function publishedCount(businessId: string): Promise<number> {
  return db.sitePagePublished.count({ where: { businessId } });
}

/** The live page's payload (site_pages_published), or undefined. */
async function publishedPayload(businessId: string): Promise<Record<string, any> | undefined> {
  const page = await db.sitePagePublished.findUnique({ where: { businessId } });
  return (page?.payload as Record<string, any> | undefined) ?? undefined;
}

/** The draft's payload (site_page_drafts), or undefined. */
async function draftPayload(businessId: string): Promise<Record<string, any> | undefined> {
  const draft = await db.sitePageDraft.findUnique({ where: { businessId } });
  return (draft?.payload as Record<string, any> | undefined) ?? undefined;
}

function putDraft(actor: string, businessId: string, body: unknown) {
  return request(app.getHttpServer())
    .put(`/site/presence/businesses/${businessId}/draft`)
    .set('x-test-user', actor)
    .send({ payload: body });
}

function publish(actor: string, businessId: string) {
  return request(app.getHttpServer()).post(`/site/presence/businesses/${businessId}/publish`).set('x-test-user', actor);
}

function autoConfigure(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/onboarding-concierge/businesses/${businessId}/auto-configure`)
    .set('x-test-user', actor)
    .send(body);
}

function chat(actor: string, businessId: string, message: string) {
  return request(app.getHttpServer())
    .post(`/onboarding-concierge/businesses/${businessId}/chat`)
    .set('x-test-user', actor)
    .send({ message, history: [] });
}

function conciergePost(actor: string, businessId: string, suffix: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post(`/onboarding-concierge/businesses/${businessId}/${suffix}`)
    .set('x-test-user', actor)
    .send(body);
}

/** The intake columns a concierge chat persists. */
async function intakeColumns(businessId: string) {
  return db.business.findUnique({
    where: { id: businessId },
    select: { businessIntent: true, industry: true, archetype: true, country: true },
  });
}

async function productCount(businessId: string): Promise<number> {
  return db.product.count({ where: { businessId } });
}

/** A refused write: 403 with the expected code and no Business fields in the body. */
function expectRefusal(res: { status: number; body: any }, code: string, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(code);
  for (const key of ['slug', 'name', 'businessHours', 'storeEnabled', 'metaData', 'ownerId']) expect(res.body).not.toHaveProperty(key);
}

function patchDocumentTemplates(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/commerce/businesses/${businessId}/document-templates`)
    .set('x-test-user', actor)
    .send(body);
}

function getDocumentTemplates(actor: string, businessId: string) {
  return request(app.getHttpServer()).get(`/commerce/businesses/${businessId}/document-templates`).set('x-test-user', actor);
}

/** The seeded (column default) templates back on a business. Raw SQL, so the reset itself does not touch updated_at. */
async function resetDocumentTemplates(businessId: string) {
  await db.$executeRawUnsafe('UPDATE businesses SET invoice_template = $2, quote_template = $2 WHERE id = $1', businessId, STORED_TEMPLATE);
}

async function documentTemplateColumns(businessId: string) {
  return db.business.findUnique({ where: { id: businessId }, select: { invoiceTemplate: true, quoteTemplate: true } });
}

/** The ids GET .../document-templates marks as the default, per document type. */
function defaultsOf(body: any): { invoice: string[]; quote: string[] } {
  const templates: Array<{ id: string; type: string; isDefault: boolean }> = body?.templates ?? [];
  return {
    invoice: templates.filter((t) => t.type === 'invoice' && t.isDefault).map((t) => t.id),
    quote: templates.filter((t) => t.type === 'quote' && t.isDefault).map((t) => t.id),
  };
}

/** A refused document-templates PATCH: 403 BUSINESS_PROFILE_OWNER_ONLY, no success flag and no template echoed. */
function expectTemplateRefusal(res: { status: number; body: any }, label: string) {
  expectRefusal(res, DOCUMENT_TEMPLATES_CODE, label);
  for (const key of ['success', 'invoiceTemplate', 'quoteTemplate']) expect(res.body, `${label}: ${key}`).not.toHaveProperty(key);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PresenceController } = await import('../src/modules/site/presence/presence.controller');
  const { PresenceService } = await import('../src/modules/site/presence/presence.service');
  const { PresenceOverviewService } = await import('../src/modules/site/presence/presence-overview.service');
  const { StorefrontIntelligenceService } = await import('../src/modules/site/presence/storefront-intelligence.service');
  const { OnboardingConciergeController } = await import('../src/modules/onboarding-concierge/onboarding-concierge.controller');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { OnboardingStateService } = await import('../src/modules/onboarding-concierge/onboarding-state.service');
  const { DemoDataSeederService } = await import('../src/modules/onboarding-concierge/demo-data-seeder.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { getTemplateById } = await import('../src/modules/onboarding-concierge/industry-templates');
  // R0-09g: the document-templates routes and the guards and interceptor
  // CommerceController's other routes declare (Nest builds them at init).
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { FinanceSettingsService } = await import('../src/modules/finance/finance-settings.service');
  templateHours = getTemplateById(TEMPLATE)?.businessHours;

  const moduleRef = await Test.createTestingModule({
    controllers: [PresenceController, OnboardingConciergeController, CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      PresenceService,
      OnboardingConciergeService,
      CatalogService,
      // The owner test the document-templates PATCH runs (R0-09g): real, on the real database.
      FinanceSettingsService,
      // CommerceController's collaborators: not on the document-templates routes.
      { provide: CommerceService, useValue: {} },
      { provide: TimeEntryService, useValue: {} },
      { provide: InvoiceReceiptBuilderService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
      { provide: EventEmitter2, useValue: { emit: (event: string) => { emitted.push(event); return true; } } },
      {
        provide: BlueprintService,
        useValue: {
          inferFromOnboarding: async (businessId: string) => { blueprintInferred.push(businessId); return null; },
          getBlueprint: async () => null,
        },
      },
      // The concierge chat's model call: a fixed reply, no provider traffic.
      { provide: AiUsageService, useValue: { callAi: async () => ({ content: AI_REPLY }) } },
      // Not on the draft, publish, auto-configure, chat, dismiss, resume or snooze path.
      { provide: PresenceOverviewService, useValue: {} },
      { provide: StorefrontIntelligenceService, useValue: {} },
      { provide: OnboardingStateService, useValue: {} },
      { provide: DemoDataSeederService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizP, name: `${ID.bizP}-name`, ownerId: ID.owner, slug: LIVE[ID.bizP] } });
  await db.business.create({
    data: { id: ID.bizQ, name: `${ID.bizQ}-name`, ownerId: ID.owner, slug: LIVE[ID.bizQ], businessHours: SEEDED_HOURS, storeEnabled: false, metaData: {} },
  });
  await db.business.create({
    data: { id: ID.bizS, name: `${ID.bizS}-name`, ownerId: ID.owner, slug: LIVE[ID.bizS], businessHours: SEEDED_HOURS, storeEnabled: false, metaData: {} },
  });
  await db.business.create({
    data: { id: ID.bizL, name: `${ID.bizL}-name`, ownerId: ID.legacyOwner, slug: LIVE[ID.bizL], businessHours: SEEDED_HOURS, storeEnabled: false, metaData: {} },
  });
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  for (const businessId of [ID.bizP, ID.bizQ]) {
    const memberships: Array<{ userId: string; role: string; permissionScopes?: Record<string, string> }> = [
      { userId: ID.owner, role: 'OWNER' },
      { userId: ID.staff, role: 'STAFF' },
      { userId: ID.staffAll, role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.OWNER } },
      { userId: ID.admin, role: 'ADMIN' },
      { userId: ID.adminW, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
    ];
    for (const m of memberships) {
      await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${businessId.slice(P.length)}`, businessId, ...m } });
    }
  }
}, 120_000); // CommerceController's import graph is large; the dynamic imports count toward the hook clock

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('R0-09b fixture sanity (real rows)', () => {
  it('[D11-X01] seeded four tenants, seven users and ten memberships; bizL, bizS and the super admin have no membership', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(7);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(10);
    expect(await db.membership.count({ where: { businessId: { in: [ID.bizL, ID.bizS] } } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(templateHours, 'the template sets hours').toBeTruthy();
    expect(JSON.stringify(templateHours)).not.toBe(JSON.stringify(SEEDED_HOURS));
  });
});

describe('R0-09b presence draft and publish cannot change Business.slug for a non-owner (D-11, review R09-ST-2)', () => {
  it('[D11-S01] RED-BEFORE: a STAFF member (settings:none) saves a draft with a new slug and publishes it: the save is refused (403) and Business.slug and the Business row stay byte-identical', async () => {
    await resetPresence(ID.bizP);
    const before = await businessRowText(ID.bizP);
    const put = await putDraft(ID.staff, ID.bizP, payload({ slug: slugOf('staff-hijack') }));
    const pub = await publish(ID.staff, ID.bizP);
    expect((await businessRow(ID.bizP))?.slug, `PUT ${put.status}, publish ${pub.status}: Business.slug`).toBe(LIVE[ID.bizP]);
    expect(await businessRowText(ID.bizP), 'the Business row is byte-identical').toBe(before);
    expectRefusal(put, SLUG_CODE, 'STAFF draft save with a new slug');
    expect(await draftRowText(ID.bizP), 'no draft was saved').toBeNull();
    expect(await publishedCount(ID.bizP)).toBe(0);
  });

  it('[D11-S02] RED-BEFORE: a STAFF member (settings:none) publishing a draft that already carries another slug cannot change Business.slug: the page goes live at the current address (201), the Business row is byte-identical and the pending slug waits in the draft until the OWNER publishes it', async () => {
    await resetPresence(ID.bizP, payload({ slug: slugOf('pending-slug'), headline: 'k09b pending content' }));
    const before = await businessRowText(ID.bizP);
    const pub = await publish(ID.staff, ID.bizP);
    expect((await businessRow(ID.bizP))?.slug, `publish ${pub.status}: Business.slug`).toBe(LIVE[ID.bizP]);
    expect(await businessRowText(ID.bizP), 'the Business row is byte-identical').toBe(before);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const page = await publishedPayload(ID.bizP);
    expect(page?.slug, 'the page is live at the current Business.slug').toBe(LIVE[ID.bizP]);
    expect(JSON.stringify(page)).toContain('k09b pending content');
    expect((await draftPayload(ID.bizP))?.slug, 'the pending slug is still in the draft').toBe(slugOf('pending-slug'));

    // The owner's publish of the same draft moves the address (the pending slug is the owner's to apply).
    const ownerPub = await publish(ID.owner, ID.bizP);
    expect(ownerPub.status, JSON.stringify(ownerPub.body)).toBe(201);
    expect((await businessRow(ID.bizP))?.slug).toBe(slugOf('pending-slug'));
    expect((await publishedPayload(ID.bizP))?.slug).toBe(slugOf('pending-slug'));
  });

  it('[D11-S03] RED-BEFORE: STAFF with every scope admin, ADMIN on role defaults and ADMIN granted settings:write cannot change Business.slug either way: a new slug in the draft is refused (403), and a draft slug they publish does not go live (201 at the current address); Business row byte-identical', async () => {
    for (const { id, label } of NON_OWNERS.slice(1)) {
      await resetPresence(ID.bizP);
      const before = await businessRowText(ID.bizP);
      const put = await putDraft(id, ID.bizP, payload({ slug: slugOf('member-hijack') }));
      const pub1 = await publish(id, ID.bizP);
      expect((await businessRow(ID.bizP))?.slug, `${label}: PUT ${put.status}, publish ${pub1.status}`).toBe(LIVE[ID.bizP]);
      expectRefusal(put, SLUG_CODE, `${label}: draft save with a new slug`);

      await resetPresence(ID.bizP, payload({ slug: slugOf('pending-slug') }));
      const pub2 = await publish(id, ID.bizP);
      expect((await businessRow(ID.bizP))?.slug, `${label}: publish of a draft slug ${pub2.status}`).toBe(LIVE[ID.bizP]);
      expect(pub2.status, `${label}: publish of a draft slug: ${JSON.stringify(pub2.body)}`).toBe(201);
      expect((await publishedPayload(ID.bizP))?.slug, `${label}: the page is live at the current address`).toBe(LIVE[ID.bizP]);
      expect(await businessRowText(ID.bizP), `${label}: the Business row is byte-identical`).toBe(before);
    }
  });

  it("[D11-S04] today's rule kept, RED-BEFORE (publish rewrote an unchanged slug, bumping the row): a STAFF member (settings:none) edits the page keeping the current slug, saves (200) and publishes (201); the page carries the edit and the Business row is byte-identical", async () => {
    await resetPresence(ID.bizP);
    const before = await businessRowText(ID.bizP);
    const put = await putDraft(ID.staff, ID.bizP, payload({ slug: LIVE[ID.bizP], headline: 'k09b staff edit' }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const pub = await publish(ID.staff, ID.bizP);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const page = await db.sitePagePublished.findUnique({ where: { businessId: ID.bizP } });
    expect(JSON.stringify(page?.payload)).toContain('k09b staff edit');
    expect(page?.publishedById).toBe(ID.staff);
    expect(await businessRowText(ID.bizP), 'the Business row is byte-identical').toBe(before);
  });

  it("[D11-S05] today's rule kept: a STAFF member (settings:none) saving a draft that keeps the draft's pending slug, or carries no slug, is not refused (200); the pending slug stays as the draft had it", async () => {
    await resetPresence(ID.bizP, payload({ slug: slugOf('pending-slug') }));
    const keep = await putDraft(ID.staff, ID.bizP, payload({ slug: slugOf('pending-slug'), headline: 'k09b staff keeps pending' }));
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
    expect(keep.body?.payload?.slug).toBe(slugOf('pending-slug'));

    const before = await businessRowText(ID.bizP);
    const none = await putDraft(ID.staff, ID.bizP, payload({ headline: 'k09b staff no slug' }));
    expect(none.status, JSON.stringify(none.body)).toBe(200);
    expect(none.body?.payload).not.toHaveProperty('slug');
    const pub = await publish(ID.staff, ID.bizP);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect(await businessRowText(ID.bizP), 'a slug-less publish leaves the Business row byte-identical').toBe(before);
  });

  it('[D11-S06] positive control: the OWNER saves a new slug (200) and publishes it (201); Business.slug becomes the draft slug', async () => {
    await resetPresence(ID.bizP);
    const put = await putDraft(ID.owner, ID.bizP, payload({ slug: slugOf('owner-new') }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const pub = await publish(ID.owner, ID.bizP);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect((await businessRow(ID.bizP))?.slug).toBe(slugOf('owner-new'));
    expect(emitted).toContain('SITE_PUBLISHED');
  });

  it('[D11-S07] pinned: a SUPER_ADMIN with no membership keeps the platform bypass BusinessGuard grants: saves and publishes a new slug (200, 201)', async () => {
    await resetPresence(ID.bizS);
    const put = await putDraft(ID.superAdmin, ID.bizS, payload({ slug: slugOf('super-new') }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const pub = await publish(ID.superAdmin, ID.bizS);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect((await businessRow(ID.bizS))?.slug).toBe(slugOf('super-new'));
  });

  it('[D11-S08] pinned: the distinguished owner (Business.ownerId) with no membership row saves and publishes a new slug (200, 201)', async () => {
    await resetPresence(ID.bizL);
    const put = await putDraft(ID.legacyOwner, ID.bizL, payload({ slug: slugOf('legacy-new') }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const pub = await publish(ID.legacyOwner, ID.bizL);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect((await businessRow(ID.bizL))?.slug).toBe(slugOf('legacy-new'));
  });

  it("[D11-S09] RED-BEFORE (review CR-1): after the OWNER moves Business.slug through the owner-only PATCH, a STAFF member (settings:none) whose draft still carries the old slug saves a content edit (200) and publishes it (201): the page goes live at the owner's address and the Business row is byte-identical", async () => {
    await resetPresence(ID.bizP, payload({ slug: LIVE[ID.bizP] }));
    // PATCH /identity/businesses/:id (owner-only since R0-09) as raw SQL: the draft is not told about the new slug.
    await db.$executeRawUnsafe('UPDATE businesses SET slug = $2 WHERE id = $1', ID.bizP, slugOf('owner-renamed'));
    const before = await businessRowText(ID.bizP);
    const put = await putDraft(ID.staff, ID.bizP, payload({ slug: LIVE[ID.bizP], headline: 'k09b staff content edit' }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const pub = await publish(ID.staff, ID.bizP);
    expect((await businessRow(ID.bizP))?.slug, `publish ${pub.status}: Business.slug`).toBe(slugOf('owner-renamed'));
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect(await businessRowText(ID.bizP), 'the Business row is byte-identical').toBe(before);
    const page = await publishedPayload(ID.bizP);
    expect(page?.slug, "the page is live at the owner's address").toBe(slugOf('owner-renamed'));
    expect(JSON.stringify(page)).toContain('k09b staff content edit');
  });

  it.todo(
    'REQUIRED (follow-up; identity.service.ts updateBusiness — outside the R0-09b write set; review CR-1, already true before R0-09b): ' +
      'when the OWNER moves Business.slug through PATCH /identity/businesses/:id, a draft still carrying the old slug follows it, so the ' +
      "owner's next presence publish does not put the old slug back on Business.slug (the draft cannot tell a stale slug from a pending one)",
  );
});

describe('R0-09b onboarding concierge auto-configure cannot change the business profile for a non-owner (D-11, review R09-ST-3)', () => {
  it('[D11-C01] RED-BEFORE: a STAFF member (settings:none) auto-configures with customBusinessName: 403, the Business row (name, businessHours, storeEnabled, slug, metaData) byte-identical, no product created', async () => {
    await resetConcierge(ID.bizQ);
    const before = await businessRowText(ID.bizQ);
    const res = await autoConfigure(ID.staff, ID.bizQ, { templateId: TEMPLATE, customBusinessName: `${P}hijacked-name` });
    const row = await businessRow(ID.bizQ);
    expect(row?.name, `auto-configure ${res.status}: Business.name`).toBe(`${ID.bizQ}-name`);
    expect(row?.businessHours, 'businessHours').toEqual(SEEDED_HOURS);
    expect(await businessRowText(ID.bizQ), 'the Business row is byte-identical').toBe(before);
    expectRefusal(res, CONCIERGE_CODE, 'STAFF auto-configure');
    expect(await productCount(ID.bizQ), 'no product created').toBe(0);
  });

  it("[D11-C02] RED-BEFORE: a STAFF member (settings:none) asking for no name, hours or storefront (products and payment methods only) is refused too: every auto-configure writes the business's setup configuration (template, payment methods) into Business.metaData; row byte-identical, no product", async () => {
    await resetConcierge(ID.bizQ);
    const before = await businessRowText(ID.bizQ);
    const res = await autoConfigure(ID.staff, ID.bizQ, {
      templateId: TEMPLATE, createProducts: true, setPaymentMethods: true, setBusinessHours: false, configureStorefront: false,
    });
    expect(await businessRowText(ID.bizQ), `auto-configure ${res.status}: the Business row is byte-identical`).toBe(before);
    expectRefusal(res, CONCIERGE_CODE, 'STAFF auto-configure without profile flags');
    expect(await productCount(ID.bizQ), 'no product created').toBe(0);
  });

  it('[D11-C03] RED-BEFORE: STAFF with every scope admin, ADMIN on role defaults and ADMIN granted settings:write are refused (403): row byte-identical, no product', async () => {
    await resetConcierge(ID.bizQ);
    for (const { id, label } of NON_OWNERS.slice(1)) {
      const before = await businessRowText(ID.bizQ);
      const res = await autoConfigure(id, ID.bizQ, { templateId: TEMPLATE, customBusinessName: `${P}member-name` });
      expect(await businessRowText(ID.bizQ), `${label}: auto-configure ${res.status}: the Business row is byte-identical`).toBe(before);
      expectRefusal(res, CONCIERGE_CODE, `${label}: auto-configure`);
      expect(await productCount(ID.bizQ), `${label}: no product created`).toBe(0);
    }
  });

  it("[D11-C04] positive control: the OWNER auto-configures (201): the name, the template's hours and the store setting apply, the slug is kept and the template's products exist", async () => {
    await resetConcierge(ID.bizQ);
    const res = await autoConfigure(ID.owner, ID.bizQ, { templateId: TEMPLATE, customBusinessName: `${P}owner-name` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ templateId: TEMPLATE, businessHoursSet: true, storefrontEnabled: true });
    const row = await businessRow(ID.bizQ);
    expect(row).toMatchObject({ name: `${P}owner-name`, slug: LIVE[ID.bizQ], storeEnabled: true });
    expect(row?.businessHours).toEqual(templateHours);
    expect((row?.metaData as Record<string, unknown>)?.conciergeTemplateId).toBe(TEMPLATE);
    expect(await productCount(ID.bizQ)).toBeGreaterThan(0);
  });

  it('[D11-C05] pinned: a SUPER_ADMIN with no membership keeps the platform bypass BusinessGuard grants: auto-configure applies (201)', async () => {
    await resetConcierge(ID.bizS);
    const res = await autoConfigure(ID.superAdmin, ID.bizS, { templateId: TEMPLATE, customBusinessName: `${P}super-name` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await businessRow(ID.bizS);
    expect(row).toMatchObject({ name: `${P}super-name`, storeEnabled: true });
    expect(row?.businessHours).toEqual(templateHours);
  });

  it('[D11-C06] pinned: the distinguished owner (Business.ownerId) with no membership row auto-configures (201)', async () => {
    await resetConcierge(ID.bizL);
    const res = await autoConfigure(ID.legacyOwner, ID.bizL, { templateId: TEMPLATE, customBusinessName: `${P}legacy-name` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await businessRow(ID.bizL);
    expect(row).toMatchObject({ name: `${P}legacy-name`, storeEnabled: true });
    expect(row?.businessHours).toEqual(templateHours);
  });

  it('[D11-C07] RED-BEFORE (review SEC-2): STAFF on role defaults (settings:none) or every scope admin, ADMIN on role defaults and ADMIN granted settings:write chat with the concierge and get the reply (201), but their answers are not persisted: businessIntent, industry, archetype and country stay unset, the Business row is byte-identical and no blueprint inference runs', async () => {
    for (const { id, label } of NON_OWNERS) {
      await resetConcierge(ID.bizQ);
      const before = await businessRowText(ID.bizQ);
      const res = await chat(id, ID.bizQ, `k09b ${label} intent`);
      expect(await businessRowText(ID.bizQ), `${label}: chat ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(await intakeColumns(ID.bizQ), `${label}: no intake answer persisted`).toEqual({ businessIntent: null, industry: null, archetype: null, country: null });
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body?.content, `${label}: the reply`).toContain('Welcome to KeyFlow');
      expect(blueprintInferred, `${label}: no blueprint inference`).toEqual([]);
    }
  });

  it("[D11-C08] positive control: the OWNER's and the distinguished owner's (Business.ownerId, no membership) concierge chats persist the intake (201): businessIntent is the message, industry and country come from the EXTRACTED lines, and the blueprint is inferred", async () => {
    for (const [actor, businessId] of [[ID.owner, ID.bizQ], [ID.legacyOwner, ID.bizL]] as const) {
      await resetConcierge(businessId);
      const res = await chat(actor, businessId, `k09b ${actor} intent`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await intakeColumns(businessId)).toMatchObject({ businessIntent: `k09b ${actor} intent`, industry: AI_INDUSTRY, country: AI_COUNTRY });
      expect(blueprintInferred).toEqual([businessId]);
    }
  });

  it("[D11-C09] today's rule kept (review CR-2): a STAFF member (settings:none) dismisses the concierge, snoozes a nudge and resumes (201 each): only the concierge's display-state keys of Business.metaData change; every other column and every other metaData key stays as the owner left it", async () => {
    await resetConcierge(ID.bizQ);
    const ownerMeta = { conciergeTemplateId: TEMPLATE, paymentMethodsConfigured: true, setupMilestones: ['conciergeSetupComplete'] };
    await db.$executeRawUnsafe('UPDATE businesses SET meta_data = $2::jsonb WHERE id = $1', ID.bizQ, JSON.stringify(ownerMeta));
    const before = await businessRowTextExceptMeta(ID.bizQ);
    const dismiss = await conciergePost(ID.staff, ID.bizQ, 'dismiss');
    expect(dismiss.status, JSON.stringify(dismiss.body)).toBe(201);
    const snooze = await conciergePost(ID.staff, ID.bizQ, 'nudges/products/snooze', { days: 2 });
    expect(snooze.status, JSON.stringify(snooze.body)).toBe(201);
    const resume = await conciergePost(ID.staff, ID.bizQ, 'resume');
    expect(resume.status, JSON.stringify(resume.body)).toBe(201);

    expect(await businessRowTextExceptMeta(ID.bizQ), 'every column but meta_data and updated_at is byte-identical').toBe(before);
    const meta = (await businessRow(ID.bizQ))?.metaData as Record<string, unknown>;
    expect(meta).toMatchObject({ ...ownerMeta, conciergeDismissed: false });
    const DISPLAY_STATE = ['conciergeDismissed', 'conciergeDismissedAt', 'snoozedNudges'];
    expect(Object.keys(meta).filter((k) => !(k in ownerMeta)).sort(), 'only display-state keys were added').toEqual(DISPLAY_STATE);
  });
});

describe('R0-09g commerce document templates cannot change the business profile for a non-owner (D-11, R0-09f sweep)', () => {
  const CHANGE = { invoiceTemplate: 'modern', quoteTemplate: 'minimal' };

  it('[D11-D01] RED-BEFORE: STAFF granted every scope admin (revenue:admin) is refused (403 BUSINESS_PROFILE_OWNER_ONLY) changing both templates, either one alone, or sending no field at all; the Business row is byte-identical', async () => {
    await resetDocumentTemplates(ID.bizP);
    const before = await businessRowText(ID.bizP);
    for (const body of [CHANGE, { invoiceTemplate: 'modern' }, { quoteTemplate: 'minimal' }, {}]) {
      const res = await patchDocumentTemplates(ID.staffAll, ID.bizP, body);
      expect(await businessRowText(ID.bizP), `${JSON.stringify(body)} -> ${res.status}: the Business row is byte-identical`).toBe(before);
      expectTemplateRefusal(res, `STAFF every scope admin, ${JSON.stringify(body)}`);
    }
    expect(await documentTemplateColumns(ID.bizP)).toEqual({ invoiceTemplate: STORED_TEMPLATE, quoteTemplate: STORED_TEMPLATE });
  });

  it('[D11-D02] RED-BEFORE: ADMIN on role defaults (revenue:admin, settings:admin) and ADMIN granted settings:write are refused (403 BUSINESS_PROFILE_OWNER_ONLY); the Business row is byte-identical', async () => {
    await resetDocumentTemplates(ID.bizP);
    for (const { id, label } of NON_OWNERS.slice(2)) {
      const before = await businessRowText(ID.bizP);
      for (const body of [CHANGE, { invoiceTemplate: 'minimal' }, { quoteTemplate: 'modern' }]) {
        const res = await patchDocumentTemplates(id, ID.bizP, body);
        expect(await businessRowText(ID.bizP), `${label}, ${JSON.stringify(body)} -> ${res.status}: the Business row is byte-identical`).toBe(before);
        expectTemplateRefusal(res, `${label}, ${JSON.stringify(body)}`);
      }
    }
  });

  it("[D11-D03] RED-BEFORE (the route's revenue:write gate answered a generic 403): STAFF on role defaults (revenue:read, settings:none) is refused with the owner-only code, 403 BUSINESS_PROFILE_OWNER_ONLY; the Business row is byte-identical", async () => {
    await resetDocumentTemplates(ID.bizP);
    const before = await businessRowText(ID.bizP);
    const res = await patchDocumentTemplates(ID.staff, ID.bizP, CHANGE);
    expect(await businessRowText(ID.bizP), `PATCH ${res.status}: the Business row is byte-identical`).toBe(before);
    expectTemplateRefusal(res, 'STAFF role defaults');
  });

  it('[D11-D04] positive control: the OWNER (OWNER membership) sets both templates (200 { success, invoiceTemplate, quoteTemplate }); the row carries them and GET marks them as the defaults', async () => {
    await resetDocumentTemplates(ID.bizP);
    const res = await patchDocumentTemplates(ID.owner, ID.bizP, CHANGE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true, ...CHANGE });
    expect(await documentTemplateColumns(ID.bizP)).toEqual(CHANGE);
    const read = await getDocumentTemplates(ID.owner, ID.bizP);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(defaultsOf(read.body)).toEqual({ invoice: ['modern'], quote: ['minimal'] });

    const one = await patchDocumentTemplates(ID.owner, ID.bizP, { quoteTemplate: 'classic' });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(await documentTemplateColumns(ID.bizP), 'a one-field PATCH leaves the other template').toEqual({ invoiceTemplate: 'modern', quoteTemplate: 'classic' });
  });

  it("[D11-D05] today's rule kept: GET .../document-templates stays open to every member, revenue:read included (STAFF on role defaults, STAFF every scope admin, ADMIN on role defaults, ADMIN with settings:write): 200 with the stored defaults marked", async () => {
    await resetDocumentTemplates(ID.bizP);
    // The owner's stored choice, as raw SQL so this case does not depend on the PATCH.
    await db.$executeRawUnsafe('UPDATE businesses SET invoice_template = $2, quote_template = $3 WHERE id = $1', ID.bizP, CHANGE.invoiceTemplate, CHANGE.quoteTemplate);
    const before = await businessRowText(ID.bizP);
    for (const { id, label } of NON_OWNERS) {
      const read = await getDocumentTemplates(id, ID.bizP);
      expect(read.status, `${label}: ${JSON.stringify(read.body)}`).toBe(200);
      expect(defaultsOf(read.body), `${label}: the stored defaults`).toEqual({ invoice: ['modern'], quote: ['minimal'] });
      expect(read.body?.templates, `${label}: three templates per type`).toHaveLength(6);
    }
    expect(await businessRowText(ID.bizP), 'a GET writes nothing').toBe(before);
  });

  it('[D11-D06] pinned: a SUPER_ADMIN with no membership keeps the platform bypass BusinessGuard grants: sets the templates (200)', async () => {
    await resetDocumentTemplates(ID.bizS);
    const res = await patchDocumentTemplates(ID.superAdmin, ID.bizS, CHANGE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await documentTemplateColumns(ID.bizS)).toEqual(CHANGE);
  });

  it("[D11-D07] RED-BEFORE (the route's ModuleScopeGuard refused a member-less owner): the distinguished owner (Business.ownerId) with no membership row sets the templates (200), the owner rule's second arm", async () => {
    await resetDocumentTemplates(ID.bizL);
    const res = await patchDocumentTemplates(ID.legacyOwner, ID.bizL, CHANGE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await documentTemplateColumns(ID.bizL)).toEqual(CHANGE);
    const read = await getDocumentTemplates(ID.legacyOwner, ID.bizL);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(defaultsOf(read.body)).toEqual({ invoice: ['modern'], quote: ['minimal'] });
  });

  it('[D11-D08] a foreign business id writes nothing: the owner of bizP and STAFF every scope admin (members of bizP and bizQ only) are refused bizL (403), the Business row byte-identical; an unknown business id is refused (403 or 404) and no business row appears', async () => {
    await resetDocumentTemplates(ID.bizL);
    const before = await businessRowText(ID.bizL);
    for (const actor of [ID.owner, ID.staffAll]) {
      const res = await patchDocumentTemplates(actor, ID.bizL, CHANGE);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body).not.toHaveProperty('success');
      expect(await businessRowText(ID.bizL), `${actor}: the foreign Business row is byte-identical`).toBe(before);
    }
    const unknown = `${P}bizNone`;
    const res = await patchDocumentTemplates(ID.owner, unknown, CHANGE);
    expect([403, 404], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).not.toHaveProperty('success');
    expect(await db.business.count({ where: { id: unknown } })).toBe(0);
  });
});
