/**
 * R0-09d-D11-GENESIS-TEMPLATES — owner ruling D-11 (editing the business
 * profile is OWNER only, regardless of granted scopes) holds on the last two
 * routes R0-09b's review found writing owner-only Business fields for any
 * member (R0-09b review SEC-1). REAL database.
 *
 *   POST /business-genesis/businesses/:id/answers
 *        BusinessGenesisService.submitAnswers copies answers.businessName,
 *        currency, country and businessIntent onto Business.name, currency,
 *        country and businessIntent (business-genesis.service.ts), so a STAFF
 *        member with settings:none renames the business the owner-only
 *        PATCH /identity/businesses/:id refuses.
 *   POST /businesses/:id/templates/:templateId/apply
 *        TemplatesService.applyTemplate writes the template's industry and
 *        archetype onto the Business row, records which template the business
 *        was set up from (business_template_usages) and creates the template's
 *        products, services and expense categories (templates.service.ts).
 *
 * REQUIRED (the two it.todo entries this packet removes from
 * identity-boundary.integration.test.ts, "OPEN DEFECTS — D-11 sibling write
 * paths"): a non-owner — STAFF on the role defaults (settings:none), ADMIN on
 * the role defaults, ADMIN granted settings:write — is refused 403
 * BUSINESS_PROFILE_OWNER_ONLY (the code the concierge auto-configure refusal
 * already answers, R0-09b) with the Business row byte-identical (row_to_json
 * text) and nothing else written. The owner — an OWNER membership or the
 * distinguished owner (Business.ownerId), the two arms
 * IdentityService.assertBusinessOwner and BusinessGuard admit an owner by — and
 * a SUPER_ADMIN (the platform bypass BusinessGuard grants) still succeed.
 *
 * GENESIS ANSWERS ARE GATED BY FIELD, NOT AS A ROUTE: the same route records
 * the legal disclaimer acceptance ({"legalProfile.disclaimerAcceptedAt": ...},
 * the legal page's LegalDocumentPack and the onboarding GenesisDocumentPackCard)
 * and the other blueprint answers, which live in business_blueprints and not on
 * the Business row; those keep the BusinessGuard rule (any member; case G04).
 * A non-owner whose answers carry any of the four Business-row keys is refused
 * before anything is read or written: no Business write, no blueprint
 * inference, no genome facts (cases G01-G03).
 * TEMPLATE APPLY IS GATED AS A ROUTE: every apply records the business's setup
 * template (business_template_usages) and every seeded template carries an
 * industry and an archetype, so no apply writes no owner-only configuration;
 * the refusal comes before the template is read, so a non-owner learns nothing
 * about which template ids exist (cases T01-T03).
 * THE OWNER CHECK IS BOUND TO THE ROUTE'S BUSINESS (review SEC-T1): a STAFF
 * member of bizG and bizT who owns a business of their own (bizO: an OWNER
 * membership and Business.ownerId) is refused on bizG and bizT, also when the
 * x-business-id header, ?businessId= and the body's businessId all name bizO,
 * with both Business rows byte-identical (cases G09, T06). Without this user an
 * owner check that ignored which business it was asked about (for example
 * `where: { ownerId: actor.id }` without `id: businessId`) would pass every
 * other case, because no other non-owner owns anything.
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real BusinessGenesisController, BusinessGenesisService,
 * GenesisProjectionService, GenesisReadinessScorer, TemplatesController,
 * TemplatesService, CatalogService (it creates the template's products and
 * services), PrismaService, AuthGuard, BusinessGuard and the production
 * GlobalHttpExceptionFilter, against the database at DATABASE_URL. The one
 * stand-in on the authorization path is identity attachment: a test middleware
 * reads `x-test-user`, loads that seeded User row and attaches
 * `{ id, email, role }` exactly as AuthMiddleware does after token
 * verification. Collaborators these routes never authorize with are stubs or
 * recorders: BlueprintService's inferFromOnboarding records which business it
 * was asked to infer for and returns the inferred identity (no
 * business_blueprints row; the blueprint is not the Business row); the model
 * gateway, action plan, document pack, risk register and market strategy are
 * not on these routes; GenomeFactService and GenomeEvidenceService are optional
 * and absent, so no genome fact is written; EventEmitter2 records emits. The
 * production ValidationPipe needs the parameter types tsc emits, which vitest's
 * esbuild transform does not, so in-process bodies are not whitelisted;
 * nothing here depends on the whitelist.
 *
 * FIXTURES: every user, business, membership and template id has the `k09d_`
 * prefix (registered in test/helpers/fixture-prefixes.json, packet
 * 'R0-09 / R0-09d-D11-GENESIS-TEMPLATES'), every unique column written here
 * (User.email, BusinessTemplate.name) contains it, and every row is hard-deleted
 * with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction
 * wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k09d_';

const ID = {
  owner: `${P}owner`,             // the founding owner: OWNER membership + Business.ownerId of bizG and bizT; Business.ownerId of bizS
  coOwner: `${P}coOwner`,         // a second OWNER membership on bizG and bizT, not Business.ownerId (the membership arm alone)
  staff: `${P}staff`,             // STAFF, role-default scopes (settings: none)
  admin: `${P}admin`,             // ADMIN, role-default scopes (settings: admin)
  adminW: `${P}adminW`,           // ADMIN, ADMIN defaults with settings: write
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership anywhere
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizL, no membership row (founding-membership backfill window)
  staffOwner: `${P}staffOwner`,   // STAFF, role defaults, on bizG and bizT; OWNER membership and Business.ownerId of bizO, their own business (review SEC-T1)
  bizG: `${P}bizG`,               // genesis answers: the non-owner refusals, then the owner controls
  bizT: `${P}bizT`,               // template apply: the non-owner refusals, then the owner controls
  bizS: `${P}bizS`,               // the SUPER_ADMIN controls (genesis and templates)
  bizL: `${P}bizL`,               // the distinguished-owner controls (genesis and templates)
  bizO: `${P}bizO`,               // the staff owner's own business: the owner check is bound to the route's business (review SEC-T1)
  template: `${P}tpl`,            // a published business template (industry, archetype, products, services, expense categories)
};
const USERS = [ID.owner, ID.coOwner, ID.staff, ID.admin, ID.adminW, ID.superAdmin, ID.legacyOwner, ID.staffOwner];
const NON_OWNERS: Array<{ id: string; label: string }> = [
  { id: ID.staff, label: 'STAFF, role defaults (settings:none)' },
  { id: ID.adminW, label: 'ADMIN, settings:write' },
  { id: ID.admin, label: 'ADMIN, role defaults (settings:admin)' },
];
const emailOf = (id: string) => `${id}@k09d.test.local`;

/** The owner-set profile every case starts from (a reset puts it back). */
const SEEDED = { currency: 'TTD', country: 'TT', businessIntent: null, industry: null, archetype: null };
const nameOf = (businessId: string) => `${businessId}-name`;

/** The genesis answer keys submitAnswers copies onto the Business row, and the column each one writes. */
const PROFILE_ANSWERS: Record<string, { column: string; value: string }> = {
  businessName: { column: 'name', value: `${P}hijacked-name` },
  currency: { column: 'currency', value: 'USD' },
  country: { column: 'country', value: 'JM' },
  businessIntent: { column: 'businessIntent', value: `${P}hijacked intent` },
};
const ALL_PROFILE_ANSWERS = Object.fromEntries(Object.entries(PROFILE_ANSWERS).map(([k, v]) => [k, v.value]));

const TEMPLATE_INDUSTRY = `${P}industry`;
const TEMPLATE_ARCHETYPE = 'LOCAL_SERVICE';
const TEMPLATE_PRODUCT = `${P}product`;
const TEMPLATE_SERVICE = `${P}service`;
const TEMPLATE_CATEGORY = `${P}category`;

/** The refusal code the server answers with (asserted, so a 403 from another layer does not pass). */
const PROFILE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';

let db: any;
let app: any;
const emitted: string[] = [];
/** The business ids BlueprintService.inferFromOnboarding was called for (blueprint writes). */
const blueprintInferred: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_template_usages WHERE business_id LIKE ${sqlLikePrefix(P)} OR template_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_templates WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function profile(id: string) {
  return db.business.findUnique({
    where: { id },
    select: { name: true, currency: true, country: true, businessIntent: true, industry: true, archetype: true },
  });
}

/**
 * Each case starts from the seeded profile (on the unmodified code the refusal
 * cases change the row), with no template products, services, expense
 * categories or usage row, and the blueprint recorder cleared. Raw SQL.
 */
async function reset(businessId: string) {
  await db.$executeRawUnsafe('DELETE FROM business_template_usages WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('DELETE FROM expense_categories WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('DELETE FROM services WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('DELETE FROM products WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe(
    `UPDATE businesses SET name = $2, currency = $3, country = $4, business_intent = NULL, industry = NULL, archetype = NULL WHERE id = $1`,
    businessId, nameOf(businessId), SEEDED.currency, SEEDED.country,
  );
  blueprintInferred.length = 0;
}

/** What a template apply leaves behind besides the Business row. */
async function templateResidue(businessId: string) {
  const [products, services, categories, usages] = await Promise.all([
    db.product.count({ where: { businessId } }),
    db.service.count({ where: { businessId } }),
    db.expenseCategory.count({ where: { businessId } }),
    db.businessTemplateUsage.count({ where: { businessId } }),
  ]);
  return { products, services, categories, usages };
}
const NO_RESIDUE = { products: 0, services: 0, categories: 0, usages: 0 };

function answers(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/business-genesis/businesses/${businessId}/answers`)
    .set('x-test-user', actor)
    .send({ answers: body });
}

function applyTemplate(actor: string, businessId: string, templateId: string = ID.template) {
  return request(app.getHttpServer())
    .post(`/businesses/${businessId}/templates/${templateId}/apply`)
    .set('x-test-user', actor)
    .send({});
}

/**
 * Review SEC-T1: the same writes, with every other place a request can name a
 * tenant (the x-business-id header the web client sends, ?businessId= and a
 * body businessId) pointing at `elsewhere` while the route names `businessId`.
 */
function answersNaming(actor: string, businessId: string, elsewhere: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/business-genesis/businesses/${businessId}/answers?businessId=${elsewhere}`)
    .set('x-test-user', actor)
    .set('x-business-id', elsewhere)
    .send({ answers: body, businessId: elsewhere });
}

function applyTemplateNaming(actor: string, businessId: string, elsewhere: string) {
  return request(app.getHttpServer())
    .post(`/businesses/${businessId}/templates/${ID.template}/apply?businessId=${elsewhere}`)
    .set('x-test-user', actor)
    .set('x-business-id', elsewhere)
    .send({ businessId: elsewhere });
}

/** A refused write: 403 with the expected code and no Business fields in the body. */
function expectRefusal(res: { status: number; body: any }, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(PROFILE_CODE);
  for (const key of ['name', 'currency', 'country', 'businessIntent', 'industry', 'archetype', 'ownerId', 'blueprint']) {
    expect(res.body).not.toHaveProperty(key);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { BusinessGenesisController } = await import('../src/modules/business-genesis/business-genesis.controller');
  const { BusinessGenesisService } = await import('../src/modules/business-genesis/business-genesis.service');
  const { GenesisProjectionService } = await import('../src/modules/business-genesis/projection-engine.service');
  const { GenesisReadinessScorer } = await import('../src/modules/business-genesis/readiness-scorer.service');
  const { GenesisActionPlanBuilder } = await import('../src/modules/business-genesis/action-plan-builder.service');
  const { GenesisDocumentPackService } = await import('../src/modules/business-genesis/genesis-document-pack.service');
  const { GenesisRiskRegisterService } = await import('../src/modules/business-genesis/genesis-risk-register.service');
  const { GenesisMarketStrategyService } = await import('../src/modules/business-genesis/genesis-market-strategy.service');
  const { TemplatesController } = await import('../src/modules/templates/templates.controller');
  const { TemplatesService } = await import('../src/modules/templates/templates.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');

  /** The blueprint stand-in: the identity an inference would record, never a business_blueprints row. */
  const blueprintOf = (businessId: string, a: Record<string, unknown> = {}) => ({
    businessId,
    identity: {
      ...(typeof a.businessName === 'string' ? { name: a.businessName } : {}),
      ...(typeof a.businessIntent === 'string' ? { oneLiner: a.businessIntent } : {}),
      ...(typeof a.country === 'string' ? { country: a.country } : {}),
    },
    complianceProfile: { complianceItems: [] },
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [BusinessGenesisController, TemplatesController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      BusinessGenesisService,
      GenesisProjectionService,
      GenesisReadinessScorer,
      TemplatesService,
      CatalogService,
      { provide: EventEmitter2, useValue: { emit: (event: string) => { emitted.push(event); return true; } } },
      {
        provide: BlueprintService,
        useValue: {
          inferFromOnboarding: async (businessId: string, a: Record<string, unknown>) => {
            blueprintInferred.push(businessId);
            return blueprintOf(businessId, a);
          },
          updateBlueprint: async (businessId: string, patch: Record<string, unknown>) => ({ ...blueprintOf(businessId), ...patch }),
          getBlueprint: async (businessId: string) => blueprintOf(businessId),
        },
      },
      // Not on the answers or apply path (no model call, no generated documents).
      { provide: ModelGatewayService, useValue: {} },
      { provide: GenesisActionPlanBuilder, useValue: {} },
      { provide: GenesisDocumentPackService, useValue: {} },
      { provide: GenesisRiskRegisterService, useValue: {} },
      { provide: GenesisMarketStrategyService, useValue: {} },
      // The generate-* routes' guard; never reached here.
      { provide: GenomeGateGuard, useValue: { canActivate: () => false } },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard on these routes is overridden.
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
  for (const [businessId, ownerId] of [[ID.bizG, ID.owner], [ID.bizT, ID.owner], [ID.bizS, ID.owner], [ID.bizL, ID.legacyOwner], [ID.bizO, ID.staffOwner]]) {
    await db.business.create({
      data: { id: businessId, name: nameOf(businessId), ownerId, currency: SEEDED.currency, country: SEEDED.country },
    });
  }
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  for (const businessId of [ID.bizG, ID.bizT]) {
    const memberships: Array<{ userId: string; role: string; permissionScopes?: Record<string, string> }> = [
      { userId: ID.owner, role: 'OWNER' },
      { userId: ID.coOwner, role: 'OWNER' },
      { userId: ID.staff, role: 'STAFF' },
      { userId: ID.admin, role: 'ADMIN' },
      { userId: ID.adminW, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
      { userId: ID.staffOwner, role: 'STAFF' },
    ];
    for (const m of memberships) {
      await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${businessId.slice(P.length)}`, businessId, ...m } });
    }
  }
  // The staff owner's own business: both owner arms (OWNER membership and Business.ownerId), so an
  // owner check that ignored which business it was asked about would admit them on bizG and bizT.
  await db.membership.create({
    data: { id: `${P}m_${ID.staffOwner.slice(P.length)}_${ID.bizO.slice(P.length)}`, businessId: ID.bizO, userId: ID.staffOwner, role: 'OWNER' },
  });
  await db.businessTemplate.create({
    data: {
      id: ID.template,
      name: ID.template,
      displayName: `${P}template`,
      description: 'k09d fixture template',
      industry: TEMPLATE_INDUSTRY,
      archetype: TEMPLATE_ARCHETYPE,
      isPublished: true,
      config: {
        products: [{ name: TEMPLATE_PRODUCT, description: 'k09d', price: 25, category: 'SERVICE' }],
        services: [{ name: TEMPLATE_SERVICE, description: 'k09d', price: 40, duration: 30 }],
        expenseCategories: [{ name: TEMPLATE_CATEGORY }],
      },
    },
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('R0-09d fixture sanity (real rows)', () => {
  it('[D11G-X01] seeded five tenants, eight users, thirteen memberships and one template; bizL, bizS and the super admin have no membership; the co-owner is not Business.ownerId; the staff owner is STAFF on bizG and bizT and owns bizO (OWNER membership and Business.ownerId)', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(5);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(13);
    expect(await db.businessTemplate.count({ where: { id: { startsWith: P } } })).toBe(1);
    expect(await db.membership.count({ where: { businessId: { in: [ID.bizL, ID.bizS] } } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(await db.business.count({ where: { ownerId: ID.coOwner } })).toBe(0);
    const staffOwnerRoles = await db.membership.findMany({
      where: { userId: ID.staffOwner }, select: { businessId: true, role: true }, orderBy: { businessId: 'asc' },
    });
    expect(staffOwnerRoles).toEqual([
      { businessId: ID.bizG, role: 'STAFF' },
      { businessId: ID.bizO, role: 'OWNER' },
      { businessId: ID.bizT, role: 'STAFF' },
    ]);
    expect((await db.business.findMany({ where: { ownerId: ID.staffOwner }, select: { id: true } })).map((b: { id: string }) => b.id)).toEqual([ID.bizO]);
  });
});

describe('R0-09d business-genesis answers cannot change the business profile for a non-owner (D-11, R0-09b review SEC-1)', () => {
  it('[D11G-G01] RED-BEFORE: a STAFF member (settings:none) submits businessName, currency, country and businessIntent: 403, the Business row byte-identical, no blueprint inference', async () => {
    await reset(ID.bizG);
    const before = await businessRowText(ID.bizG);
    const res = await answers(ID.staff, ID.bizG, ALL_PROFILE_ANSWERS);
    expect((await profile(ID.bizG))?.name, `answers ${res.status}: Business.name`).toBe(nameOf(ID.bizG));
    expect(await businessRowText(ID.bizG), 'the Business row is byte-identical').toBe(before);
    expectRefusal(res, 'STAFF genesis answers');
    expect(blueprintInferred, 'no blueprint inference').toEqual([]);
  });

  it('[D11G-G02] RED-BEFORE: an ADMIN granted settings:write and an ADMIN on role defaults are refused too (403): the Business row byte-identical, no blueprint inference', async () => {
    for (const { id, label } of NON_OWNERS.slice(1)) {
      await reset(ID.bizG);
      const before = await businessRowText(ID.bizG);
      const res = await answers(id, ID.bizG, ALL_PROFILE_ANSWERS);
      expect(await businessRowText(ID.bizG), `${label}: answers ${res.status}: the Business row is byte-identical`).toBe(before);
      expectRefusal(res, `${label}: genesis answers`);
      expect(blueprintInferred, `${label}: no blueprint inference`).toEqual([]);
    }
  });

  it('[D11G-G03] RED-BEFORE: each Business-row answer alone (businessName, currency, country, businessIntent), sent beside a blueprint-only answer by a STAFF member (settings:none) or an ADMIN granted settings:write, is refused (403) and nothing of the submission is written', async () => {
    for (const { id, label } of NON_OWNERS.slice(0, 2)) {
      for (const [key, { value }] of Object.entries(PROFILE_ANSWERS)) {
        await reset(ID.bizG);
        const before = await businessRowText(ID.bizG);
        const res = await answers(id, ID.bizG, { [key]: value, revenueModel: 'subscription' });
        expect(await businessRowText(ID.bizG), `${label}, ${key}: answers ${res.status}: the Business row is byte-identical`).toBe(before);
        expectRefusal(res, `${label}, ${key}`);
        expect(blueprintInferred, `${label}, ${key}: no blueprint inference`).toEqual([]);
      }
    }
  });

  it("[D11G-G04] today's rule kept: a STAFF member (settings:none) and an ADMIN granted settings:write submit answers that carry no Business-row key (the legal disclaimer acceptance, a blueprint-only answer): 201, the blueprint is inferred and the Business row is byte-identical", async () => {
    for (const { id, label } of NON_OWNERS.slice(0, 2)) {
      for (const body of [{ 'legalProfile.disclaimerAcceptedAt': '2026-11-01T00:00:00.000Z' }, { revenueModel: 'subscription', teamSize: 'SOLO' }]) {
        await reset(ID.bizG);
        const before = await businessRowText(ID.bizG);
        const res = await answers(id, ID.bizG, body);
        expect(res.status, `${label}, ${Object.keys(body).join(',')}: ${JSON.stringify(res.body)}`).toBe(201);
        expect(res.body).toHaveProperty('readiness');
        expect(blueprintInferred, `${label}: the blueprint is inferred`).toEqual([ID.bizG]);
        expect(await businessRowText(ID.bizG), `${label}: the Business row is byte-identical`).toBe(before);
      }
    }
  });

  it('[D11G-G05] positive control (onboarding): the founding OWNER (OWNER membership and Business.ownerId) submits the onboarding review answers (201): Business name, currency, country and businessIntent take the trimmed answers and the blueprint is inferred', async () => {
    await reset(ID.bizG);
    const res = await answers(ID.owner, ID.bizG, {
      businessName: `  ${P}owner-name  `, currency: ' USD ', country: ' JM ', businessIntent: ` ${P}owner intent `, revenueModel: 'subscription',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toHaveProperty('blueprint');
    expect(res.body).toHaveProperty('readiness');
    expect(await profile(ID.bizG)).toMatchObject({ name: `${P}owner-name`, currency: 'USD', country: 'JM', businessIntent: `${P}owner intent` });
    expect(blueprintInferred).toEqual([ID.bizG]);
  });

  it('[D11G-G06] positive control: a second OWNER membership that is not Business.ownerId (the membership arm alone) changes the four Business fields (201)', async () => {
    await reset(ID.bizG);
    const res = await answers(ID.coOwner, ID.bizG, { businessName: `${P}coowner-name`, currency: 'EUR', country: 'BB', businessIntent: `${P}coowner intent` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await profile(ID.bizG)).toMatchObject({ name: `${P}coowner-name`, currency: 'EUR', country: 'BB', businessIntent: `${P}coowner intent` });
  });

  it('[D11G-G07] pinned: the distinguished owner (Business.ownerId) with no membership row changes the four Business fields (201)', async () => {
    await reset(ID.bizL);
    const res = await answers(ID.legacyOwner, ID.bizL, { businessName: `${P}legacy-name`, currency: 'USD', country: 'GY', businessIntent: `${P}legacy intent` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await profile(ID.bizL)).toMatchObject({ name: `${P}legacy-name`, currency: 'USD', country: 'GY', businessIntent: `${P}legacy intent` });
  });

  it('[D11G-G08] pinned: a SUPER_ADMIN with no membership keeps the platform bypass BusinessGuard grants: changes the four Business fields (201)', async () => {
    await reset(ID.bizS);
    const res = await answers(ID.superAdmin, ID.bizS, { businessName: `${P}super-name`, currency: 'USD', country: 'LC', businessIntent: `${P}super intent` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await profile(ID.bizS)).toMatchObject({ name: `${P}super-name`, currency: 'USD', country: 'LC', businessIntent: `${P}super intent` });
  });

  it("[D11G-G09] RED-BEFORE (review SEC-T1): the owner check is bound to the route's business: a STAFF member of bizG who owns another business (OWNER membership and Business.ownerId of bizO) is refused on bizG (403), also when the x-business-id header, ?businessId= and the body's businessId all name bizO; both Business rows byte-identical, no blueprint inference; on bizO itself the same answers are the owner's (201)", async () => {
    for (const [variant, send] of [
      ['route only', () => answers(ID.staffOwner, ID.bizG, ALL_PROFILE_ANSWERS)],
      ['header, query and body name bizO', () => answersNaming(ID.staffOwner, ID.bizG, ID.bizO, ALL_PROFILE_ANSWERS)],
    ] as const) {
      await reset(ID.bizG);
      await reset(ID.bizO);
      const beforeG = await businessRowText(ID.bizG);
      const beforeO = await businessRowText(ID.bizO);
      const res = await send();
      expect(await businessRowText(ID.bizG), `${variant}: answers ${res.status}: bizG byte-identical`).toBe(beforeG);
      expect(await businessRowText(ID.bizO), `${variant}: answers ${res.status}: bizO byte-identical`).toBe(beforeO);
      expectRefusal(res, `staff owner of bizO on bizG, ${variant}`);
      expect(blueprintInferred, `${variant}: no blueprint inference`).toEqual([]);
    }
    // The fixture really makes them an owner: on their own business the same answers are admitted.
    await reset(ID.bizO);
    const own = await answers(ID.staffOwner, ID.bizO, ALL_PROFILE_ANSWERS);
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(await profile(ID.bizO)).toMatchObject({ name: PROFILE_ANSWERS.businessName.value, currency: 'USD', country: 'JM' });
    expect((await profile(ID.bizG))?.name).toBe(nameOf(ID.bizG));
    await reset(ID.bizO);
  });
});

describe('R0-09d template apply cannot change the business profile for a non-owner (D-11, R0-09b review SEC-1)', () => {
  it('[D11G-T01] RED-BEFORE: a STAFF member (settings:none) applies a template: 403, the Business row (industry, archetype) byte-identical, no product, service, expense category or template usage written', async () => {
    await reset(ID.bizT);
    const before = await businessRowText(ID.bizT);
    const res = await applyTemplate(ID.staff, ID.bizT);
    const row = await profile(ID.bizT);
    expect({ industry: row?.industry, archetype: row?.archetype }, `apply ${res.status}`).toEqual({ industry: null, archetype: null });
    expect(await businessRowText(ID.bizT), 'the Business row is byte-identical').toBe(before);
    expect(await templateResidue(ID.bizT), 'nothing else written').toEqual(NO_RESIDUE);
    expectRefusal(res, 'STAFF template apply');
  });

  it('[D11G-T02] RED-BEFORE: an ADMIN granted settings:write and an ADMIN on role defaults are refused too (403): Business row byte-identical, nothing else written', async () => {
    for (const { id, label } of NON_OWNERS.slice(1)) {
      await reset(ID.bizT);
      const before = await businessRowText(ID.bizT);
      const res = await applyTemplate(id, ID.bizT);
      expect(await businessRowText(ID.bizT), `${label}: apply ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(await templateResidue(ID.bizT), `${label}: nothing else written`).toEqual(NO_RESIDUE);
      expectRefusal(res, `${label}: template apply`);
    }
  });

  it('[D11G-T03] RED-BEFORE: the refusal comes before the template is read: a STAFF member (settings:none) applying an unknown template id gets the same 403, not 404', async () => {
    await reset(ID.bizT);
    const before = await businessRowText(ID.bizT);
    const res = await applyTemplate(ID.staff, ID.bizT, `${P}no-such-template`);
    expectRefusal(res, 'STAFF apply of an unknown template');
    expect(await businessRowText(ID.bizT)).toBe(before);
  });

  it("[D11G-T04] positive control: the OWNER applies the template (201): industry and archetype take the template's, its product, service and expense category exist and the usage is recorded", async () => {
    await reset(ID.bizT);
    const res = await applyTemplate(ID.owner, ID.bizT);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, templateName: `${P}template` });
    expect(await profile(ID.bizT)).toMatchObject({ industry: TEMPLATE_INDUSTRY, archetype: TEMPLATE_ARCHETYPE, name: nameOf(ID.bizT) });
    expect(await templateResidue(ID.bizT)).toEqual({ products: 1, services: 1, categories: 1, usages: 1 });
    expect(await db.product.count({ where: { businessId: ID.bizT, name: TEMPLATE_PRODUCT } })).toBe(1);
  });

  it('[D11G-T05] positive controls: a second OWNER membership that is not Business.ownerId, the distinguished owner (Business.ownerId, no membership) and a SUPER_ADMIN with no membership apply the template (201)', async () => {
    for (const [actor, businessId] of [[ID.coOwner, ID.bizT], [ID.legacyOwner, ID.bizL], [ID.superAdmin, ID.bizS]] as const) {
      await reset(businessId);
      const res = await applyTemplate(actor, businessId);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(await profile(businessId), actor).toMatchObject({ industry: TEMPLATE_INDUSTRY, archetype: TEMPLATE_ARCHETYPE });
      expect((await templateResidue(businessId)).usages, actor).toBe(1);
    }
  });

  it("[D11G-T06] RED-BEFORE (review SEC-T1): the owner check is bound to the route's business: a STAFF member of bizT who owns another business (OWNER membership and Business.ownerId of bizO) is refused on bizT (403), also when the x-business-id header, ?businessId= and the body's businessId all name bizO; both Business rows byte-identical, nothing else written in either; on bizO itself the apply is the owner's (201)", async () => {
    for (const [variant, send] of [
      ['route only', () => applyTemplate(ID.staffOwner, ID.bizT)],
      ['header, query and body name bizO', () => applyTemplateNaming(ID.staffOwner, ID.bizT, ID.bizO)],
    ] as const) {
      await reset(ID.bizT);
      await reset(ID.bizO);
      const beforeT = await businessRowText(ID.bizT);
      const beforeO = await businessRowText(ID.bizO);
      const res = await send();
      expect(await businessRowText(ID.bizT), `${variant}: apply ${res.status}: bizT byte-identical`).toBe(beforeT);
      expect(await businessRowText(ID.bizO), `${variant}: apply ${res.status}: bizO byte-identical`).toBe(beforeO);
      expect(await templateResidue(ID.bizT), `${variant}: nothing written in bizT`).toEqual(NO_RESIDUE);
      expect(await templateResidue(ID.bizO), `${variant}: nothing written in bizO`).toEqual(NO_RESIDUE);
      expectRefusal(res, `staff owner of bizO on bizT, ${variant}`);
    }
    // The fixture really makes them an owner: on their own business the apply is admitted.
    await reset(ID.bizO);
    const own = await applyTemplate(ID.staffOwner, ID.bizO);
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(await profile(ID.bizO)).toMatchObject({ industry: TEMPLATE_INDUSTRY, archetype: TEMPLATE_ARCHETYPE });
    expect(await templateResidue(ID.bizT)).toEqual(NO_RESIDUE);
    await reset(ID.bizO);
  });
});

// R0-09d review CR-1 (the templates page swallowed the 403 a non-owner's apply
// now answers) is FIXED by R0-09f-D11-FINANCE-TAX-AND-WEB: the page shows the
// server's refusal and no success state, proven in
// apps/web/src/app/app/templates/__tests__/templates-apply-refusal.test.tsx.
