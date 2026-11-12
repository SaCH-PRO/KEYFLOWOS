/**
 * W11-D116-PROFILE-OWNER — owner rulings D-116 and D-125 (2026-11-12) on the
 * D-11 profile writes, onboarding and the accounting-period gate. REAL database.
 *
 * THE RULE (D-116, read by D-125): an owner-only action needs an OWNER-role
 * Membership of this business. A co-owner (an OWNER membership, not
 * Business.ownerId) IS the owner; Business.ownerId grants nothing on its own;
 * a recorded owner (Business.ownerId) who holds only an ADMIN or STAFF
 * membership is that role.
 *
 * THE DEFECT (at fb00af1c): every owner check below admitted Business.ownerId
 * holding ANY membership, through a second arm
 * `business.findFirst({ where: { id, ownerId: X, members: { some: { userId: X } } } })`
 * (owner ruling D-104 had only required that some Membership exist), and
 * onboarding completion admitted the recorded owner on `ownerId === actorId`
 * with any membership or none (F-17):
 *
 *   PATCH /identity/businesses/:id               IdentityService.assertBusinessOwner
 *   PATCH /finance/businesses/:id/settings       FinanceSettingsService.isProfileOwner (defaultTaxRate)
 *   accounting-periods close/reopen/PATCH/DELETE AccountingPeriodService.assertMayGate (D-50: OWNER or ADMIN)
 *   POST  /business-genesis/.../answers          BusinessGenesisService.isProfileOwner
 *   POST  /businesses/:id/templates/:t/apply     TemplatesService.isProfileOwner
 *   PUT   /site/presence/.../draft, POST publish PresenceService.isSlugOwner
 *   POST  /onboarding-concierge/.../auto-configure and chat (intake)  OnboardingConciergeService.isProfileOwner
 *   POST  /onboarding-concierge/.../complete     OnboardingConciergeService.resolveCompletionActor
 *   POST  /onboarding-concierge/.../seed-demo    DemoDataSeederService.resolveSeedOwner (D-84, no platform bypass, D-46)
 *
 * FIXTURES (prefix v97w_, registered in test/helpers/fixture-prefixes.json):
 *   bizR  Business.ownerId = recStaff, who holds a STAFF membership granted
 *         every module scope at admin (scopes do not matter); coOwner holds an
 *         OWNER membership and is not Business.ownerId.
 *   bizA  Business.ownerId = recAdmin, who holds an ADMIN membership (role defaults).
 *   bizO  Business.ownerId = ownerO, who holds an OWNER membership (the control).
 * Cases tagged RED-BEFORE fail at the packet's base: recStaff and recAdmin were
 * admitted on every route above. The co-owner and the OWNER-holding recorded
 * owner are admitted on each (controls); recAdmin keeps the accounting-period
 * gate (D-50 ADMIN control).
 *
 * COMPOSITION (the contacts-visibility / d11-sibling-writes model): three real
 * Nest apps on the real database, each with the real controllers, services,
 * PrismaService, AuthGuard, BusinessGuard, the production TenantInterceptor
 * (global, as AppModule registers it: completion and reopen read their actor
 * from the tenant context) and the production GlobalHttpExceptionFilter:
 *   profileApp  IdentityController, PresenceController, OnboardingConciergeController
 *               (real IdentityService, PresenceService, OnboardingConciergeService,
 *               DemoDataSeederService, CatalogService);
 *   genesisApp  BusinessGenesisController, TemplatesController (real
 *               BusinessGenesisService, TemplatesService, CatalogService);
 *   financeApp  FinanceController (real FinanceSettingsService, AccountingPeriodService).
 * The one stand-in on the authorization path is identity attachment: a test
 * middleware reads `x-test-user` and attaches the seeded user's
 * { id, email, role } exactly as AuthMiddleware does. Collaborators these
 * routes never authorize with are stubs or recorders (the blueprint records
 * which business it was asked to infer for; the concierge model call answers a
 * fixed reply, no provider traffic).
 *
 * Every row is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and
 * afterAll; rows the server mints (cuid ids) are reached through the fixture
 * businesses. No $transaction wrapping.
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

const P = 'v97w_';
/** A presence-valid slug from the prefix head ('v97w-<tag>'): presence slugs allow no '_'. */
const slugOf = (tag: string) => `${P.slice(0, -1)}-${tag}`;

const ID = {
  recStaff: `${P}recStaff`, // Business.ownerId of bizR; STAFF membership on bizR, every scope admin
  coOwner: `${P}coOwner`,   // OWNER membership on bizR, not Business.ownerId (D-125: the owner)
  recAdmin: `${P}recAdmin`, // Business.ownerId of bizA; ADMIN membership on bizA (role defaults)
  ownerO: `${P}ownerO`,     // Business.ownerId of bizO and its OWNER membership (control)
  bizR: `${P}bizR`,
  bizA: `${P}bizA`,
  bizO: `${P}bizO`,
  template: `${P}tpl`,
};
const USERS = [ID.recStaff, ID.coOwner, ID.recAdmin, ID.ownerO];
const BUSINESSES = [ID.bizR, ID.bizA, ID.bizO];
const OWNER_OF: Record<string, string> = { [ID.bizR]: ID.recStaff, [ID.bizA]: ID.recAdmin, [ID.bizO]: ID.ownerO };
const emailOf = (id: string) => `${id}@v97w.test.local`;

type Actor = { id: string; biz: string; label: string };
/** Owner ruling D-116: the recorded owner holding only STAFF or ADMIN is that role, refused every owner-only action. */
const REFUSED: Actor[] = [
  { id: ID.recStaff, biz: ID.bizR, label: 'the recorded owner (Business.ownerId) holding STAFF with every scope admin' },
  { id: ID.recAdmin, biz: ID.bizA, label: 'the recorded owner (Business.ownerId) holding ADMIN' },
];
/** Owner rulings D-116, D-125: an OWNER membership of this business is the owner, with or without Business.ownerId. */
const ADMITTED: Actor[] = [
  { id: ID.coOwner, biz: ID.bizR, label: 'the co-owner (OWNER membership, not Business.ownerId)' },
  { id: ID.ownerO, biz: ID.bizO, label: 'the recorded owner holding OWNER' },
];

const LIVE: Record<string, string> = {
  [ID.bizR]: slugOf('bizr-live'),
  [ID.bizA]: slugOf('biza-live'),
  [ID.bizO]: slugOf('bizo-live'),
};
const nameOf = (businessId: string) => `${businessId}-name`;
const SEEDED_HOURS = { sat: { open: '07:00', close: '11:00', closed: false } };
const SEEDED_TAX_RATE = 12.5;
const CONCIERGE_TEMPLATE = 'consulting';
const AI_COUNTRY = 'v97w-country';
const AI_INDUSTRY = 'v97w-industry';
const AI_REPLY = `Welcome to KeyFlow!\nEXTRACTED: country=${AI_COUNTRY}\nEXTRACTED: industry=${AI_INDUSTRY}`;
const TEMPLATE_INDUSTRY = `${P}industry`;
const TEMPLATE_ARCHETYPE = 'LOCAL_SERVICE';

const PROFILE_MESSAGE = 'Only the business owner can edit the business profile';
const PROFILE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';
const SLUG_CODE = 'PRESENCE_SLUG_OWNER_ONLY';
const COMPLETE_CODE = 'ONBOARDING_COMPLETE_FORBIDDEN';
const SEED_CODE = 'DEMO_SEED_OWNER_ONLY';

let db: any;
let profileApp: any;
let genesisApp: any;
let financeApp: any;
/** The business ids BlueprintService.inferFromOnboarding was called for (genesis answers and concierge intake). */
const blueprintInferred: string[] = [];

async function cleanup() {
  const biz = `business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE ${biz}`,
    `DELETE FROM team_activity_logs WHERE ${biz}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE ${biz})`,
    `DELETE FROM invoices WHERE ${biz}`,
    `DELETE FROM contacts WHERE ${biz}`,
    `DELETE FROM accounting_periods WHERE ${biz}`,
    `DELETE FROM business_template_usages WHERE ${biz} OR template_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_templates WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE ${biz}`,
    `DELETE FROM services WHERE ${biz}`,
    `DELETE FROM products WHERE ${biz}`,
    `DELETE FROM activities WHERE ${biz}`,
    `DELETE FROM site_pages_published WHERE ${biz}`,
    `DELETE FROM site_page_drafts WHERE ${biz}`,
    `DELETE FROM business_blueprints WHERE ${biz}`,
    `DELETE FROM memberships WHERE ${biz} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

/**
 * The seeded profile back on a business, and nothing any route under test
 * writes left behind (demo rows, activity rows, products, template residue,
 * presence pages, periods). Raw SQL, so the reset itself does not run the code
 * under test.
 */
async function resetBusiness(businessId: string) {
  for (const sql of [
    'DELETE FROM contact_audit_entries WHERE business_id = $1',
    'DELETE FROM team_activity_logs WHERE business_id = $1',
    'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)',
    'DELETE FROM invoices WHERE business_id = $1',
    'DELETE FROM contacts WHERE business_id = $1',
    'DELETE FROM accounting_periods WHERE business_id = $1',
    'DELETE FROM business_template_usages WHERE business_id = $1',
    'DELETE FROM expense_categories WHERE business_id = $1',
    'DELETE FROM services WHERE business_id = $1',
    'DELETE FROM products WHERE business_id = $1',
    'DELETE FROM site_pages_published WHERE business_id = $1',
    'DELETE FROM site_page_drafts WHERE business_id = $1',
    'DELETE FROM business_blueprints WHERE business_id = $1',
  ]) {
    await db.$executeRawUnsafe(sql, businessId);
  }
  await db.$executeRawUnsafe(
    `UPDATE businesses SET name = $2, slug = $3, currency = 'TTD', timezone = 'America/Port_of_Spain', country = NULL,
       business_intent = NULL, industry = NULL, archetype = NULL, business_hours = $4::jsonb, store_enabled = false,
       meta_data = '{}'::jsonb, default_tax_rate = $5, onboarding_complete = false, onboarding_completed_at = NULL,
       onboarding_step = 'welcome' WHERE id = $1`,
    businessId, nameOf(businessId), LIVE[businessId], JSON.stringify(SEEDED_HOURS), SEEDED_TAX_RATE,
  );
  blueprintInferred.length = 0;
}

/** Everything completion or a demo seed writes on a business, counted on the real rows. */
async function demoFootprint(businessId: string) {
  const [demoContacts, invoices, audits, activities] = await Promise.all([
    db.contact.count({ where: { businessId } }),
    db.invoice.count({ where: { businessId } }),
    db.contactAuditEntry.count({ where: { businessId } }),
    db.teamActivityLog.count({ where: { businessId } }),
  ]);
  return { demoContacts, invoices, audits, activities };
}
const NOTHING_WRITTEN = { demoContacts: 0, invoices: 0, audits: 0, activities: 0 };

function expectCode(res: { status: number; body: any }, code: string, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(code);
  for (const key of ['name', 'slug', 'currency', 'defaultTaxRate', 'ownerId', 'contactId', 'invoiceId']) {
    expect(res.body, `${label}: ${key}`).not.toHaveProperty(key);
  }
}

const withActor = (req: any, actor: string) => req.set('x-test-user', actor);
const patchBusiness = (actor: string, businessId: string, body: Record<string, unknown>) =>
  withActor(request(profileApp.getHttpServer()).patch(`/identity/businesses/${businessId}`), actor).send(body);
const putDraft = (actor: string, businessId: string, body: unknown) =>
  withActor(request(profileApp.getHttpServer()).put(`/site/presence/businesses/${businessId}/draft`), actor).send({ payload: body });
const publish = (actor: string, businessId: string) =>
  withActor(request(profileApp.getHttpServer()).post(`/site/presence/businesses/${businessId}/publish`), actor);
const concierge = (actor: string, businessId: string, suffix: string, body: Record<string, unknown> = {}) =>
  withActor(request(profileApp.getHttpServer()).post(`/onboarding-concierge/businesses/${businessId}/${suffix}`), actor).send(body);
const answers = (actor: string, businessId: string, body: Record<string, unknown>) =>
  withActor(request(genesisApp.getHttpServer()).post(`/business-genesis/businesses/${businessId}/answers`), actor).send({ answers: body });
const applyTemplate = (actor: string, businessId: string) =>
  withActor(request(genesisApp.getHttpServer()).post(`/businesses/${businessId}/templates/${ID.template}/apply`), actor).send({});
const patchSettings = (actor: string, businessId: string, body: Record<string, unknown>) =>
  withActor(request(financeApp.getHttpServer()).patch(`/finance/businesses/${businessId}/settings`), actor).send(body);
function period(actor: string, businessId: string, method: 'post' | 'patch' | 'delete', suffix: string, body: Record<string, unknown> = {}) {
  const req = (request(financeApp.getHttpServer()) as any)[method](`/finance/businesses/${businessId}/accounting-periods${suffix}`);
  return withActor(req, actor).send(body);
}

/** A valid presence payload (presence.service.ts presenceSchema), with an optional slug. */
function presencePayload(opts: { slug?: string; headline?: string } = {}) {
  return {
    branding: { primaryColor: '#123456' },
    sections: [{ id: 'sec_hero', type: 'hero', visible: true, data: { headline: opts.headline ?? 'v97w headline' } }],
    seo: { metaTitle: 'v97w title' },
    ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
  };
}

/** One OPEN January 2020 period on the business (ended long ago, so it may be closed). */
async function seedPeriod(businessId: string): Promise<string> {
  await db.$executeRawUnsafe('DELETE FROM accounting_periods WHERE business_id = $1', businessId);
  const id = `${P}per_${businessId.slice(P.length)}`;
  await db.accountingPeriod.create({
    data: { id, businessId, year: 2020, month: 1, startDate: new Date(Date.UTC(2020, 0, 1)), endDate: new Date(Date.UTC(2020, 0, 31, 23, 59, 59, 999)) },
  });
  return id;
}

async function periodRowText(id: string): Promise<string | null> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(p)::text AS j FROM accounting_periods p WHERE p.id = $1', id);
  return rows.length ? (rows[0].j as string) : null;
}

async function periodAudit(businessId: string): Promise<string[]> {
  const rows = await db.teamActivityLog.findMany({
    where: { businessId, module: 'finance', entityType: 'AccountingPeriod' }, orderBy: { createdAt: 'asc' }, select: { action: true, userId: true },
  });
  return rows.map((r: { action: string; userId: string }) => `${r.action}:${r.userId}`);
}

/** The whole gate in order: close, reopen, PATCH (moves it to February), DELETE; every step admitted. */
async function expectGateKept(actor: Actor) {
  const id = await seedPeriod(actor.biz);
  const close = await period(actor.id, actor.biz, 'post', `/${id}/close`);
  expect(close.status, `${actor.label}: close ${JSON.stringify(close.body)}`).toBe(201);
  expect(await db.accountingPeriod.findUnique({ where: { id }, select: { status: true, closedById: true } })).toEqual({ status: 'CLOSED', closedById: actor.id });
  const reopen = await period(actor.id, actor.biz, 'post', `/${id}/reopen`);
  expect(reopen.status, `${actor.label}: reopen ${JSON.stringify(reopen.body)}`).toBe(201);
  const update = await period(actor.id, actor.biz, 'patch', `/${id}`, { month: 2 });
  expect(update.status, `${actor.label}: update ${JSON.stringify(update.body)}`).toBe(200);
  expect(await db.accountingPeriod.findUnique({ where: { id }, select: { status: true, month: true } })).toEqual({ status: 'OPEN', month: 2 });
  const remove = await period(actor.id, actor.biz, 'delete', `/${id}`);
  expect(remove.status, `${actor.label}: delete ${JSON.stringify(remove.body)}`).toBe(200);
  expect(await periodRowText(id), `${actor.label}: the period is deleted`).toBeNull();
  expect(await periodAudit(actor.biz)).toEqual([`PERIOD_CLOSED:${actor.id}`, `PERIOD_REOPENED:${actor.id}`]);
}

/** Identity attachment only, as AuthMiddleware attaches it from the User row. No guard is overridden. */
function attachIdentity(app: any) {
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

async function buildApp(controllers: any[], providers: any[]): Promise<any> {
  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [PrismaService, AuthGuard, BusinessGuard, { provide: APP_INTERCEPTOR, useClass: TenantInterceptor }, ...providers],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  attachIdentity(app);
  await app.init();
  return app;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  // ---- profileApp: identity PATCH, presence, onboarding concierge (the d11-sibling-writes and demo-seed-owner composition)
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const { PresenceController } = await import('../src/modules/site/presence/presence.controller');
  const { PresenceService } = await import('../src/modules/site/presence/presence.service');
  const { PresenceOverviewService } = await import('../src/modules/site/presence/presence-overview.service');
  const { StorefrontIntelligenceService } = await import('../src/modules/site/presence/storefront-intelligence.service');
  const { OnboardingConciergeController } = await import('../src/modules/onboarding-concierge/onboarding-concierge.controller');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { OnboardingStateService } = await import('../src/modules/onboarding-concierge/onboarding-state.service');
  const { DemoDataSeederService } = await import('../src/modules/onboarding-concierge/demo-data-seeder.service');
  profileApp = await buildApp([IdentityController, PresenceController, OnboardingConciergeController], [
    ModuleScopeGuard,
    OptionalAuthGuard,
    PublicRateLimitGuard,
    IdentityService,
    PresenceService,
    OnboardingConciergeService,
    DemoDataSeederService,
    CatalogService,
    { provide: EventEmitter2, useValue: { emit: () => true } },
    {
      provide: BlueprintService,
      useValue: {
        inferFromOnboarding: async (businessId: string) => { blueprintInferred.push(businessId); return null; },
        getBlueprint: async () => null,
        // Completion's genome recommendation is advice; unavailable reads as null.
        calculateGenomeIntegrity: async () => { throw new Error('no genome on this path'); },
      },
    },
    // The concierge chat's model call: a fixed reply, no provider traffic.
    { provide: AiUsageService, useValue: { callAi: async () => ({ content: AI_REPLY }) } },
    // Not on the PATCH, draft, publish, auto-configure, chat, complete or seed-demo path.
    { provide: PresenceOverviewService, useValue: {} },
    { provide: StorefrontIntelligenceService, useValue: {} },
    { provide: OnboardingStateService, useValue: {} },
    { provide: REDIS_CLIENT, useValue: {} },
    { provide: DefaultTriggersService, useValue: {} },
    { provide: IdentitySignupService, useValue: {} },
    { provide: BusinessContextService, useValue: {} },
    { provide: AuthSecurityService, useValue: {} },
    { provide: IdentityPasswordService, useValue: {} },
    { provide: SupabaseAdminService, useValue: {} },
  ]);

  // ---- genesisApp: genesis answers and template apply (the d11-genesis-templates composition)
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');
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
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const blueprintOf = (businessId: string, a: Record<string, unknown> = {}) => ({
    businessId,
    identity: {
      ...(typeof a.businessName === 'string' ? { name: a.businessName } : {}),
      ...(typeof a.country === 'string' ? { country: a.country } : {}),
    },
    complianceProfile: { complianceItems: [] },
  });
  genesisApp = await buildApp([BusinessGenesisController, TemplatesController], [
    BusinessGenesisService,
    GenesisProjectionService,
    GenesisReadinessScorer,
    TemplatesService,
    CatalogService,
    { provide: EventEmitter2, useValue: { emit: () => true } },
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
    { provide: GenomeGateGuard, useValue: { canActivate: () => false } },
  ]);

  // ---- financeApp: settings and accounting periods (the d11-finance-settings / ledger-write-door composition)
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { FinanceSettingsService } = await import('../src/modules/finance/finance-settings.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  // FinanceController's other collaborators: never reached by the settings or period routes.
  const unused = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/posting.service').then((m) => m.PostingService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);
  financeApp = await buildApp([FinanceController], [
    FinanceSettingsService,
    AccountingPeriodService,
    ...unused.map((token) => ({ provide: token, useValue: {} })),
  ]);

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) await db.user.create({ data: { id, email: emailOf(id), name: id, role: 'USER' } });
  for (const businessId of BUSINESSES) {
    await db.business.create({ data: { id: businessId, name: nameOf(businessId), ownerId: OWNER_OF[businessId], slug: LIVE[businessId] } });
    await resetBusiness(businessId);
  }
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    // Scopes do not make an owner: the recorded owner holding STAFF is granted every module scope at admin (connect included).
    { userId: ID.recStaff, businessId: ID.bizR, role: 'STAFF', permissionScopes: Object.fromEntries(Object.keys(ROLE_DEFAULT_SCOPES.OWNER).map((m) => [m, 'admin'])) },
    { userId: ID.coOwner, businessId: ID.bizR, role: 'OWNER' },
    { userId: ID.recAdmin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.ownerO, businessId: ID.bizO, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
  await db.businessTemplate.create({
    data: {
      id: ID.template,
      name: ID.template,
      displayName: `${P}template`,
      description: 'v97w fixture template',
      industry: TEMPLATE_INDUSTRY,
      archetype: TEMPLATE_ARCHETYPE,
      isPublished: true,
      config: {
        products: [{ name: `${P}product`, description: 'v97w', price: 25, category: 'SERVICE' }],
        services: [{ name: `${P}service`, description: 'v97w', price: 40, duration: 30 }],
        expenseCategories: [{ name: `${P}category` }],
      },
    },
  });
}, 180_000);

afterAll(async () => {
  for (const app of [profileApp, genesisApp, financeApp]) if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('W11-D116-PROFILE-OWNER fixture sanity (real rows)', () => {
  it('[ORP-X01] (D-116, D-125) three businesses: bizR recorded to a STAFF member granted every scope admin with a co-owner holding OWNER, bizA recorded to an ADMIN, bizO recorded to its OWNER', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(3);
    const rows = await db.membership.findMany({ where: { id: { startsWith: P } }, select: { userId: true, businessId: true, role: true }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(expect.arrayContaining([
      { userId: ID.recStaff, businessId: ID.bizR, role: 'STAFF' },
      { userId: ID.coOwner, businessId: ID.bizR, role: 'OWNER' },
      { userId: ID.recAdmin, businessId: ID.bizA, role: 'ADMIN' },
      { userId: ID.ownerO, businessId: ID.bizO, role: 'OWNER' },
    ]));
    for (const b of BUSINESSES) expect((await db.business.findUnique({ where: { id: b }, select: { ownerId: true } }))?.ownerId).toBe(OWNER_OF[b]);
    expect(await db.business.count({ where: { ownerId: ID.coOwner } }), 'the co-owner is not Business.ownerId').toBe(0);
    const staffScopes = (await db.membership.findFirst({ where: { userId: ID.recStaff }, select: { permissionScopes: true } }))?.permissionScopes as Record<string, string>;
    expect(Object.keys(staffScopes).length, 'a scope map naming every module').toBeGreaterThan(10);
    expect(Object.values(staffScopes).every((v) => v === 'admin'), 'every scope admin').toBe(true);
  });
});

describe('PATCH /identity/businesses/:id (IdentityService.assertBusinessOwner): owner rulings D-116, D-125', () => {
  it('[ORP-01] RED-BEFORE (D-116): the recorded owner holding STAFF (every scope admin) or ADMIN is refused 403 and the Business row is byte-identical', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await patchBusiness(a.id, a.biz, { name: `${P}hijacked-name`, currency: 'USD' });
      expect(await businessRowText(a.biz), `${a.label}: PATCH ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body?.message, a.label).toBe(PROFILE_MESSAGE);
    }
  });

  it('[ORP-02] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER edit the profile (200)', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await patchBusiness(a.id, a.biz, { name: `${P}owner-name` });
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((await db.business.findUnique({ where: { id: a.biz }, select: { name: true } }))?.name, a.label).toBe(`${P}owner-name`);
    }
  });
});

describe('PATCH /finance/businesses/:id/settings defaultTaxRate (FinanceSettingsService.isProfileOwner): owner rulings D-116, D-125', () => {
  it('[ORP-03] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN changing the tax rate is refused 403 BUSINESS_PROFILE_OWNER_ONLY and the Business row is byte-identical', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await patchSettings(a.id, a.biz, { defaultTaxRate: 99 });
      expect(await businessRowText(a.biz), `${a.label}: settings ${res.status}: the Business row is byte-identical`).toBe(before);
      expectCode(res, PROFILE_CODE, a.label);
    }
  });

  it('[ORP-04] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER change the tax rate (200)', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await patchSettings(a.id, a.biz, { defaultTaxRate: 15 });
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((await db.business.findUnique({ where: { id: a.biz }, select: { defaultTaxRate: true } }))?.defaultTaxRate, a.label).toBe(15);
    }
  });
});

describe('accounting-period close / reopen / update / delete (AccountingPeriodService.assertMayGate): owner rulings D-116, D-50', () => {
  it('[ORP-05] RED-BEFORE (D-116): the recorded owner holding STAFF (every scope admin) is refused close, reopen, update and delete (403): the period row is unchanged and no audit row is written', async () => {
    const { id: actor, biz } = REFUSED[0];
    await resetBusiness(biz);
    const id = await seedPeriod(biz);
    const open = await periodRowText(id);
    for (const [label, send] of [
      ['close', () => period(actor, biz, 'post', `/${id}/close`)],
      ['update', () => period(actor, biz, 'patch', `/${id}`, { month: 2 })],
      ['delete', () => period(actor, biz, 'delete', `/${id}`)],
    ] as const) {
      const res = await send();
      expect(await periodRowText(id), `${label} ${res.status}: the period row is unchanged`).toBe(open);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body?.message).toBe(`Only the business owner or an admin can ${label} an accounting period.`);
    }
    expect(await periodAudit(biz)).toEqual([]);

    // Reopen needs a closed period: the co-owner closes it (an owner's call), then the STAFF recorded owner tries.
    const closed = await period(ID.coOwner, biz, 'post', `/${id}/close`);
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    const closedRow = await periodRowText(id);
    const reopen = await period(actor, biz, 'post', `/${id}/reopen`);
    expect(await periodRowText(id), `reopen ${reopen.status}: the period row is unchanged`).toBe(closedRow);
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(403);
    expect(reopen.body?.message).toBe('Only the business owner or an admin can reopen an accounting period.');
    expect(await periodAudit(biz)).toEqual([`PERIOD_CLOSED:${ID.coOwner}`]);
  });

  it('[ORP-06] controls (D-50, D-116, D-125): the recorded owner holding ADMIN keeps the gate as an ADMIN, and the co-owner and the recorded owner holding OWNER keep it as the owner: close, reopen, update and delete, each change audited against them', async () => {
    for (const a of [REFUSED[1], ...ADMITTED]) {
      await resetBusiness(a.biz);
      await expectGateKept(a);
    }
  });
});

describe('POST /business-genesis/businesses/:id/answers (BusinessGenesisService.isProfileOwner): owner rulings D-116, D-125', () => {
  it('[ORP-07] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN submitting businessName, currency, country and businessIntent is refused 403 BUSINESS_PROFILE_OWNER_ONLY: the Business row byte-identical, no blueprint inference', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await answers(a.id, a.biz, { businessName: `${P}hijacked-name`, currency: 'USD', country: 'JM', businessIntent: `${P}hijacked intent` });
      expect(await businessRowText(a.biz), `${a.label}: answers ${res.status}: the Business row is byte-identical`).toBe(before);
      expectCode(res, PROFILE_CODE, a.label);
      expect(blueprintInferred, `${a.label}: no blueprint inference`).toEqual([]);
    }
  });

  it('[ORP-08] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER submit the profile answers (201): the Business row takes them and the blueprint is inferred', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await answers(a.id, a.biz, { businessName: `${P}owner-name`, currency: 'USD', country: 'JM', businessIntent: `${P}owner intent` });
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(await db.business.findUnique({ where: { id: a.biz }, select: { name: true, currency: true, country: true, businessIntent: true } }), a.label)
        .toEqual({ name: `${P}owner-name`, currency: 'USD', country: 'JM', businessIntent: `${P}owner intent` });
      expect(blueprintInferred, a.label).toEqual([a.biz]);
    }
  });
});

describe('POST /businesses/:id/templates/:templateId/apply (TemplatesService.isProfileOwner): owner rulings D-116, D-125', () => {
  const residue = async (businessId: string) => ({
    products: await db.product.count({ where: { businessId } }),
    services: await db.service.count({ where: { businessId } }),
    categories: await db.expenseCategory.count({ where: { businessId } }),
    usages: await db.businessTemplateUsage.count({ where: { businessId } }),
  });

  it('[ORP-09] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN applying a template is refused 403 BUSINESS_PROFILE_OWNER_ONLY: the Business row byte-identical, no product, service, expense category or template usage', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await applyTemplate(a.id, a.biz);
      expect(await businessRowText(a.biz), `${a.label}: apply ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(await residue(a.biz), `${a.label}: nothing else written`).toEqual({ products: 0, services: 0, categories: 0, usages: 0 });
      expectCode(res, PROFILE_CODE, a.label);
    }
  });

  it("[ORP-10] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER apply the template (201): industry and archetype take the template's and its rows and usage are written", async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await applyTemplate(a.id, a.biz);
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(await db.business.findUnique({ where: { id: a.biz }, select: { industry: true, archetype: true } }), a.label)
        .toEqual({ industry: TEMPLATE_INDUSTRY, archetype: TEMPLATE_ARCHETYPE });
      expect(await residue(a.biz), a.label).toEqual({ products: 1, services: 1, categories: 1, usages: 1 });
    }
  });
});

describe('presence draft and publish (PresenceService.isSlugOwner): owner rulings D-116, D-125', () => {
  it('[ORP-11] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN saving a draft with a new slug is refused 403 PRESENCE_SLUG_OWNER_ONLY (no draft saved), and publishing a draft that carries a pending slug goes live at the current address (201) with the Business row byte-identical', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const put = await putDraft(a.id, a.biz, presencePayload({ slug: slugOf(`hijack-${a.biz.slice(P.length).toLowerCase()}`) }));
      expect(await businessRowText(a.biz), `${a.label}: draft ${put.status}: the Business row is byte-identical`).toBe(before);
      expect(await db.sitePageDraft.count({ where: { businessId: a.biz } }), `${a.label}: no draft saved`).toBe(0);
      expectCode(put, SLUG_CODE, `${a.label}: draft`);

      // A draft slug saved earlier (as the owner would have): the recorded owner's publish must not apply it.
      const pending = slugOf(`pending-${a.biz.slice(P.length).toLowerCase()}`);
      await db.sitePageDraft.create({ data: { businessId: a.biz, payload: presencePayload({ slug: pending, headline: 'v97w pending' }), status: 'DRAFT', version: 1 } });
      const pub = await publish(a.id, a.biz);
      expect((await db.business.findUnique({ where: { id: a.biz }, select: { slug: true } }))?.slug, `${a.label}: publish ${pub.status}: Business.slug`).toBe(LIVE[a.biz]);
      expect(await businessRowText(a.biz), `${a.label}: the Business row is byte-identical`).toBe(before);
      expect(pub.status, `${a.label}: publish ${JSON.stringify(pub.body)}`).toBe(201);
      const page = await db.sitePagePublished.findUnique({ where: { businessId: a.biz } });
      expect((page?.payload as Record<string, unknown> | undefined)?.slug, `${a.label}: live at the current address`).toBe(LIVE[a.biz]);
    }
  });

  it('[ORP-12] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER save a new slug (200) and publish it (201): Business.slug becomes the draft slug', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const next = slugOf(`owner-${a.biz.slice(P.length).toLowerCase()}`);
      const put = await putDraft(a.id, a.biz, presencePayload({ slug: next }));
      expect(put.status, `${a.label}: draft ${JSON.stringify(put.body)}`).toBe(200);
      const pub = await publish(a.id, a.biz);
      expect(pub.status, `${a.label}: publish ${JSON.stringify(pub.body)}`).toBe(201);
      expect((await db.business.findUnique({ where: { id: a.biz }, select: { slug: true } }))?.slug, a.label).toBe(next);
    }
  });
});

describe('onboarding concierge auto-configure and chat intake (OnboardingConciergeService.isProfileOwner): owner rulings D-116, D-125', () => {
  const intake = (businessId: string) =>
    db.business.findUnique({ where: { id: businessId }, select: { businessIntent: true, industry: true, archetype: true, country: true } });

  it('[ORP-13] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN is refused auto-configure 403 BUSINESS_PROFILE_OWNER_ONLY: the Business row byte-identical, no product created', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await concierge(a.id, a.biz, 'auto-configure', { templateId: CONCIERGE_TEMPLATE, customBusinessName: `${P}hijacked-name` });
      expect(await businessRowText(a.biz), `${a.label}: auto-configure ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(await db.product.count({ where: { businessId: a.biz } }), `${a.label}: no product`).toBe(0);
      expectCode(res, PROFILE_CODE, a.label);
    }
  });

  it('[ORP-14] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN chats with the concierge and gets the reply (201), but the intake is not persisted: the Business row byte-identical, no blueprint inference', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await concierge(a.id, a.biz, 'chat', { message: `v97w ${a.id} intent`, history: [] });
      expect(await businessRowText(a.biz), `${a.label}: chat ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(await intake(a.biz), `${a.label}: no intake persisted`).toEqual({ businessIntent: null, industry: null, archetype: null, country: null });
      expect(blueprintInferred, `${a.label}: no blueprint inference`).toEqual([]);
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body?.content, `${a.label}: the reply`).toContain('Welcome to KeyFlow');
    }
  });

  it('[ORP-15] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER auto-configure (201, the name applies and the products exist) and their chat persists the intake (201, blueprint inferred)', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await concierge(a.id, a.biz, 'auto-configure', { templateId: CONCIERGE_TEMPLATE, customBusinessName: `${P}owner-name` });
      expect(res.status, `${a.label}: auto-configure ${JSON.stringify(res.body)}`).toBe(201);
      expect(await db.business.findUnique({ where: { id: a.biz }, select: { name: true, slug: true } }), a.label).toEqual({ name: `${P}owner-name`, slug: LIVE[a.biz] });
      expect(await db.product.count({ where: { businessId: a.biz } }), a.label).toBeGreaterThan(0);

      await resetBusiness(a.biz);
      const chat = await concierge(a.id, a.biz, 'chat', { message: `v97w ${a.id} intent`, history: [] });
      expect(chat.status, `${a.label}: chat ${JSON.stringify(chat.body)}`).toBe(201);
      expect(await intake(a.biz), a.label).toMatchObject({ businessIntent: `v97w ${a.id} intent`, industry: AI_INDUSTRY, country: AI_COUNTRY });
      expect(blueprintInferred, a.label).toEqual([a.biz]);
    }
  });
});

describe('POST /onboarding-concierge/businesses/:id/complete (OnboardingConciergeService.resolveCompletionActor): owner rulings D-116, D-125 (F-17)', () => {
  it('[ORP-16] RED-BEFORE (D-116, F-17): the recorded owner holding STAFF or ADMIN is refused 403 ONBOARDING_COMPLETE_FORBIDDEN: no business update (row byte-identical), no demo contact or invoice, no team_activity_logs row', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await concierge(a.id, a.biz, 'complete');
      expect(await businessRowText(a.biz), `${a.label}: complete ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(await demoFootprint(a.biz), `${a.label}: nothing written`).toEqual(NOTHING_WRITTEN);
      expectCode(res, COMPLETE_CODE, a.label);
      expect(res.body?.message).toBe('Only the business owner can finish onboarding.');
    }
  });

  it('[ORP-17] controls (D-116, D-125): the co-owner and the recorded owner holding OWNER complete onboarding (201): the business is complete and the completion is recorded against them', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await concierge(a.id, a.biz, 'complete');
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toMatchObject({ complete: true });
      const row = await db.business.findUnique({ where: { id: a.biz }, select: { onboardingComplete: true, onboardingCompletedAt: true } });
      expect(row?.onboardingComplete, a.label).toBe(true);
      expect(row?.onboardingCompletedAt, a.label).not.toBeNull();
      const completed = await db.teamActivityLog.findMany({ where: { businessId: a.biz, action: 'onboarding_completed' }, select: { userId: true } });
      expect(completed, a.label).toEqual([{ userId: a.id }]);
    }
  });
});

describe('POST /onboarding-concierge/businesses/:id/seed-demo (DemoDataSeederService.resolveSeedOwner, D-84): owner rulings D-116, D-125', () => {
  it('[ORP-18] RED-BEFORE (D-116): the recorded owner holding STAFF or ADMIN is refused 403 DEMO_SEED_OWNER_ONLY and nothing is written (no demo contact, invoice, contact audit or activity row)', async () => {
    for (const a of REFUSED) {
      await resetBusiness(a.biz);
      const before = await businessRowText(a.biz);
      const res = await concierge(a.id, a.biz, 'seed-demo');
      expect(await demoFootprint(a.biz), `${a.label}: seed ${res.status}: nothing written`).toEqual(NOTHING_WRITTEN);
      expect(await businessRowText(a.biz), `${a.label}: the Business row is byte-identical`).toBe(before);
      expectCode(res, SEED_CODE, a.label);
    }
  });

  it('[ORP-19] controls (D-84, D-116, D-125): the co-owner and the recorded owner holding OWNER seed the demo data (201): one demo contact and one DRAFT invoice, audited against them', async () => {
    for (const a of ADMITTED) {
      await resetBusiness(a.biz);
      const res = await concierge(a.id, a.biz, 'seed-demo');
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toMatchObject({ alreadySeeded: false });
      expect(await db.contact.count({ where: { businessId: a.biz, source: 'demo' } }), a.label).toBe(1);
      expect(await db.invoice.count({ where: { businessId: a.biz, status: 'DRAFT' } }), a.label).toBe(1);
      const seeded = await db.teamActivityLog.findMany({ where: { businessId: a.biz, action: 'demo_data_seeded' }, select: { userId: true } });
      expect(seeded, a.label).toEqual([{ userId: a.id }]);
    }
  });
});
