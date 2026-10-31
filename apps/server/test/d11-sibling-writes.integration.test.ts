/**
 * R0-09b-D11-SIBLING-WRITES — owner ruling D-11 (editing the business profile is
 * OWNER only, regardless of granted scopes) holds on the two routes that wrote
 * the same Business fields beside the generic PATCH. REAL database.
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
 * REQUIRED (the it.todo entries this packet removes from
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
 * name, slug, currency, timezone, tax, store settings, businessHours, metaData
 * and the rest of UpdateBusinessDto. The presence routes put exactly one of
 * them on the Business row (slug, at publish); every other presence field
 * (branding, sections, seo, customDomain) lives in site_page_drafts /
 * site_pages_published only, so those edits keep today's rule (any member) and
 * the cases tagged "today's rule kept" pin that nothing else was tightened.
 * Every auto-configure call writes Business.metaData (conciergeTemplateId,
 * conciergeSetupAt, the setup milestone), so no auto-configure call writes no
 * owner-only field: the route is owner-only as a whole (case C02).
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real PresenceController, PresenceService, OnboardingConciergeController,
 * OnboardingConciergeService, CatalogService (it creates the template's
 * products), PrismaService, AuthGuard, BusinessGuard and the production
 * GlobalHttpExceptionFilter, against the database at DATABASE_URL. The one
 * stand-in on the authorization path is identity attachment: a test middleware
 * reads `x-test-user`, loads that seeded User row and attaches
 * `{ id, email, role }` exactly as AuthMiddleware does after token
 * verification. Collaborators these routes never authorize with are stubs or
 * recorders (EventEmitter2 records emits; BlueprintService's mirror is
 * best-effort; the presence overview, storefront intelligence, AI usage, demo
 * seeder and onboarding state are not on these routes). The production
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

/** The refusal codes the server answers with (asserted, so a 403 from another layer does not pass). */
const SLUG_CODE = 'PRESENCE_SLUG_OWNER_ONLY';
const CONCIERGE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';

let db: any;
let app: any;
let templateHours: unknown;
const emitted: string[] = [];

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

/** The seeded profile back on a concierge business (name, slug, hours, store off, empty metaData) and no products. */
async function resetConcierge(businessId: string) {
  await db.$executeRawUnsafe('DELETE FROM products WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe(
    `UPDATE businesses SET name = $2, slug = $3, business_hours = $4::jsonb, store_enabled = false, meta_data = '{}'::jsonb WHERE id = $1`,
    businessId, `${businessId}-name`, LIVE[businessId], JSON.stringify(SEEDED_HOURS),
  );
}

async function draftRowText(businessId: string): Promise<string | null> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(d)::text AS j FROM site_page_drafts d WHERE d.business_id = $1', businessId);
  return rows.length ? (rows[0].j as string) : null;
}

async function publishedCount(businessId: string): Promise<number> {
  return db.sitePagePublished.count({ where: { businessId } });
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

async function productCount(businessId: string): Promise<number> {
  return db.product.count({ where: { businessId } });
}

/** A refused write: 403 with the expected code and no Business fields in the body. */
function expectRefusal(res: { status: number; body: any }, code: string, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(code);
  for (const key of ['slug', 'name', 'businessHours', 'storeEnabled', 'metaData', 'ownerId']) expect(res.body).not.toHaveProperty(key);
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
  templateHours = getTemplateById(TEMPLATE)?.businessHours;

  const moduleRef = await Test.createTestingModule({
    controllers: [PresenceController, OnboardingConciergeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      PublicRateLimitGuard,
      PresenceService,
      OnboardingConciergeService,
      CatalogService,
      { provide: EventEmitter2, useValue: { emit: (event: string) => { emitted.push(event); return true; } } },
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      // Not on the draft, publish or auto-configure path.
      { provide: PresenceOverviewService, useValue: {} },
      { provide: StorefrontIntelligenceService, useValue: {} },
      { provide: OnboardingStateService, useValue: {} },
      { provide: DemoDataSeederService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
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
}, 60_000);

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

  it('[D11-S02] RED-BEFORE: a STAFF member (settings:none) publishing a draft that already carries another slug is refused (403): Business row byte-identical, nothing published, the draft untouched', async () => {
    await resetPresence(ID.bizP, payload({ slug: slugOf('pending-slug') }));
    const before = await businessRowText(ID.bizP);
    const draftBefore = await draftRowText(ID.bizP);
    const pub = await publish(ID.staff, ID.bizP);
    expect((await businessRow(ID.bizP))?.slug, `publish ${pub.status}: Business.slug`).toBe(LIVE[ID.bizP]);
    expect(await businessRowText(ID.bizP), 'the Business row is byte-identical').toBe(before);
    expectRefusal(pub, SLUG_CODE, 'STAFF publish of a draft slug');
    expect(await publishedCount(ID.bizP), 'nothing published').toBe(0);
    expect(await draftRowText(ID.bizP), 'the draft row is untouched').toBe(draftBefore);
  });

  it('[D11-S03] RED-BEFORE: STAFF with every scope admin, ADMIN on role defaults and ADMIN granted settings:write are refused both ways (403): a new slug in the draft, and publishing a draft slug; Business row byte-identical', async () => {
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
      expectRefusal(pub2, SLUG_CODE, `${label}: publish of a draft slug`);
      expect(await publishedCount(ID.bizP), `${label}: nothing published`).toBe(0);
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

  it('[D11-C02] RED-BEFORE: a STAFF member (settings:none) asking for no name, hours or storefront (products and payment methods only) is refused too: every auto-configure writes Business.metaData; row byte-identical, no product', async () => {
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
});
