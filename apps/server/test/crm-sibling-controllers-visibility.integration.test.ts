/**
 * FOLLOW3-D3-CRM-SIBLING-CONTROLLERS-VIS (V1-84): the contact-scoped routes of
 * the CRM sibling controllers (crm-ai, deals, accounts, custom fields, privacy)
 * gate on CRM module scope and on the session member's CRM record visibility,
 * and the privacy routes still work on a forgotten (soft-deleted) contact
 * (REAL database).
 *
 * V1-08 gated the contact-scoped reads of crm.controller.ts with
 * assertContactVisible, the rule GET contacts/:contactId applies (review ST-4
 * named the sibling controllers as a follow-up). Before this packet:
 *   - crm-ai.controller.ts ran every route under AuthGuard, BusinessGuard and
 *     FeatureFlagGuard only: a member with crm 'none' read a contact's insight
 *     card (open task titles, lifetime value, best channel) and had the AI
 *     summarize, score or draft for any contact of the business (CS-01);
 *   - the contact-scoped crm-ai routes, contacts/:contactId/deals,
 *     account-suggestion and the privacy routes (audit, export, forget,
 *     forget/cancel) checked the tenant only, so a member with
 *     {crm:'write', crm_view:'owned'} read, exported, forgot, or cancelled the
 *     forgetting of, the owner's PRIVATE contact (CS-02, CS-04).
 * A forget soft-deletes its contact for the grace period and forget/cancel
 * restores it (D-25), so the privacy routes that act on a forgotten contact
 * (audit, export, forget/cancel) apply the same tenant and visibility predicate
 * without the deletedAt filter: the owner, and a member who may open the
 * contact, keep the cancel window (CS-03), while a member who may not answers
 * 404 like an unknown id (CS-04).
 *
 * Nothing on the authorization boundary is mocked: PrismaService over the real
 * client, AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard (bizA has
 * ai_tools on), CrmRateLimitGuard, the user/business/membership/contact rows,
 * the five controllers and the services they call (CrmAiService,
 * CrmJourneyService, ContactInsightService with BestChannelService,
 * CrmDealsService, CrmAccountsService, ContactCustomFieldValueService,
 * ContactAuditService, ContactPrivacyService). Identity is attached by a test
 * middleware from `x-test-user` exactly as the Supabase-verifying
 * AuthMiddleware would after token verification. Stand-ins, so there is no
 * provider traffic: the AI gateway (AiUsageService.callAi) is a recorder, and
 * the export's object storage (ContactPrivacyService's S3 client) is a
 * recorder set on the real service instance. Every service a controller calls
 * sits behind a call recorder, so "refused before any service call" is
 * observed, not inferred.
 *
 * The two in-process rate limiters stay real (CrmRateLimitGuard: 10 calls a
 * minute per handler; checkAiRateLimit: 10 AI calls a minute per business).
 * The suite moves Date.now() one window forward before each request so the
 * cases do not starve each other; `new Date()` and the database clock are not
 * touched.
 *
 * Actors: OWNER; STAFF_CRM_NONE {crm:'none'}; STAFF_OWNED {crm:'write',
 * crm_view:'owned'} (own or shared rows only); a member of bizB. Contacts: the
 * owner's PRIVATE contact, a TEAM contact STAFF_OWNED owns, and forgotten
 * copies of both (forgotten by the OWNER through POST forget in beforeAll).
 *
 * Requires DATABASE_URL. Every seeded row has the `v84c_` prefix (or belongs to
 * a v84c_ business) and is hard-deleted by raw SQL in beforeAll and afterAll.
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

const P = 'v84c_';
const ID = {
  owner: `${P}owner`,           // OWNER of bizA
  crmNone: `${P}crmNone`,       // STAFF of bizA, crm none
  staffOwned: `${P}staffOwned`, // STAFF of bizA, crm write + crm_view owned
  other: `${P}other`,           // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`,           // PRIVATE, owned by the owner (live)
  cTeam: `${P}cTeam`,           // TEAM, owned by STAFF_OWNED (live)
  // Forgotten in beforeAll (POST forget by the OWNER).
  fTeamStaff: `${P}fTeamStaff`, // TEAM, STAFF_OWNED's: STAFF_OWNED reads its audit and cancels
  fTeamOwner: `${P}fTeamOwner`, // TEAM, STAFF_OWNED's: the OWNER reads its audit and cancels
  fPrivHidden: `${P}fPrivHidden`, // PRIVATE, the owner's: STAFF_OWNED is refused
  fPrivOwner: `${P}fPrivOwner`, // PRIVATE, the owner's: the OWNER reads its audit and cancels
  // Live forget targets (a permitted forget consumes its contact).
  gPriv: `${P}gPriv`,           // PRIVATE, the owner's: STAFF_OWNED's refused forget
  gTeam: `${P}gTeam`,           // TEAM, STAFF_OWNED's: STAFF_OWNED's permitted forget
  gOwner: `${P}gOwner`,         // PRIVATE, the owner's: the OWNER's permitted forget
  cB: `${P}cB`,                 // TEAM, bizB
  stage: `${P}stage`,
  cfDef: `${P}cfDef`,
};
const ABSENT = `${P}absent`;
const FORGOTTEN = [ID.fTeamStaff, ID.fTeamOwner, ID.fPrivHidden, ID.fPrivOwner];

const NOT_FOUND_BODY = { statusCode: 404, message: 'Contact not found', error: 'Not Found' };

/** Values only the owner's PRIVATE contact carries: a hidden answer must not contain them. */
const SECRET = {
  deal: 'v84c-sensitive-deal-title-7a1f',
  account: 'v84c-sensitive-account-name-2b9e',
  customField: 'v84c-sensitive-custom-field-4c3d',
  task: 'v84c-sensitive-open-task-5d8a',
  note: 'v84c-sensitive-note-body-6e0b',
};

// ---- recorders (no provider traffic) --------------------------------------
const AI_REPLY = JSON.stringify({
  summary: 'v84c recorded summary',
  score: 61,
  label: 'Warm',
  suggestedTags: [{ tag: 'v84c-tag', confidence: 0.9, reasoning: 'recorded' }],
  messages: [{ channel: 'email', body: 'v84c recorded draft' }],
});
const aiCalls: Array<{ businessId: string; feature: string }> = [];
const aiGateway = {
  callAi: async (args: { businessId: string; feature: string }) => {
    aiCalls.push({ businessId: args.businessId, feature: args.feature });
    return { content: AI_REPLY, model: 'v84c-recorder', usage: { creditsUsed: 1 } };
  },
};
const storagePuts: string[] = [];
const storageClient = {
  send: async (command: { input?: { Key?: string } }) => {
    storagePuts.push(String(command?.input?.Key ?? ''));
    return {};
  },
};
const serviceCalls: Array<{ service: string; method: string }> = [];

/** The real service behind a call recorder: every method a controller calls is seen. */
function recorded<T extends object>(service: string, target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (typeof prop === 'string' && typeof value === 'function' && !/^on(Module|Application)/.test(prop)) {
        return (...args: unknown[]) => {
          serviceCalls.push({ service, method: prop });
          return value.apply(t, args);
        };
      }
      return value;
    },
  });
}

function resetRecorders() {
  aiCalls.length = 0;
  storagePuts.length = 0;
  serviceCalls.length = 0;
}

// ---- the in-process rate limiters' clock ------------------------------------
const realNow = Date.now.bind(Date);
let clockOffset = 0;
/** One rate-limit window forward (both limiters keep 60 s windows). */
function nextRateWindow() {
  clockOffset += 61_000;
}

let db: any;
let app: any;
let auditService: any;
let assertContactVisible: (prisma: any, businessId: string, contactId: string, actorUserId: string) => Promise<unknown>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_custom_field_values WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM custom_field_definitions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deal_stages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_insight_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_export_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_forget_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const q = (sql: string) => db.$queryRawUnsafe(sql);

/**
 * Every row of bizA a refused route could write, read back by raw SQL (the
 * soft-delete extension hides forgotten contacts from Prisma reads).
 */
async function snapshot() {
  const biz = `'${ID.bizA}'`;
  const count = async (table: string) =>
    Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE business_id = ${biz}`))[0].n);
  return {
    contacts: await q(`SELECT id, updated_at, deleted_at, lead_score FROM contacts WHERE business_id = ${biz} ORDER BY id`),
    forgetRequests: await q(`SELECT contact_id, status, cancelled_at FROM contact_forget_requests WHERE business_id = ${biz} ORDER BY contact_id`),
    counts: {
      contactInsightSnapshots: await count('contact_insight_snapshots'),
      contactExportJobs: await count('contact_export_jobs'),
      contactAuditEntries: await count('contact_audit_entries'),
      contactForgetRequests: await count('contact_forget_requests'),
      contactTasks: await count('contact_tasks'),
      contactNotes: await count('contact_notes'),
      deals: await count('deals'),
    },
  };
}

const contactRow = async (contactId: string) =>
  (await q(`SELECT deleted_at, lead_score FROM contacts WHERE id = '${contactId}'`))[0] ?? null;
const forgetRequest = async (contactId: string) =>
  (await q(`SELECT status, cancelled_at FROM contact_forget_requests WHERE contact_id = '${contactId}'`))[0] ?? null;
const auditActions = async (contactId: string) =>
  (await q(`SELECT action FROM contact_audit_entries WHERE business_id = '${ID.bizA}' AND contact_id = '${contactId}' ORDER BY created_at`))
    .map((r: { action: string }) => r.action);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

type Method = 'get' | 'post';

/**
 * Every crm-ai.controller.ts route, with the CRM module level it requires (crm
 * write where the handler writes a contact or business row, read otherwise).
 * A contact-scoped route also names the service method it reaches and the
 * status a permitted call answers today.
 */
type AiRoute = {
  name: string;
  method: Method;
  /** Path under /crm/businesses/:businessId/; `:c` is the contact id. */
  path: string;
  level: 'read' | 'write';
  body?: Record<string, unknown>;
  contactScoped: boolean;
  service?: string;
  ok?: number;
};

const AI_ROUTES: AiRoute[] = [
  { name: 'GET insight-card', method: 'get', path: 'contacts/:c/insight-card', level: 'read', contactScoped: true, service: 'contactInsight.getSnapshot', ok: 200 },
  { name: 'POST insight-card/recompute', method: 'post', path: 'contacts/:c/insight-card/recompute', level: 'read', contactScoped: true, service: 'contactInsight.recompute', ok: 201 },
  { name: 'GET ai-insight', method: 'get', path: 'contacts/:c/ai-insight', level: 'read', contactScoped: true, service: 'journey.generateAiInsight', ok: 200 },
  { name: 'POST ai-tags', method: 'post', path: 'contacts/:c/ai-tags', level: 'read', contactScoped: true, service: 'crmAi.suggestTags', ok: 201 },
  { name: 'POST ai-prep-brief', method: 'post', path: 'contacts/:c/ai-prep-brief', level: 'read', contactScoped: true, service: 'crmAi.generatePrepBrief', ok: 201 },
  { name: 'POST ai-summary', method: 'post', path: 'contacts/:c/ai-summary', level: 'read', contactScoped: true, service: 'crmAi.summarizeContact', ok: 201 },
  { name: 'POST ai-score', method: 'post', path: 'contacts/:c/ai-score', level: 'write', contactScoped: true, service: 'crmAi.scoreContactWithAi', ok: 201 },
  { name: 'POST ai-note-analysis', method: 'post', path: 'contacts/:c/ai-note-analysis', level: 'read', contactScoped: true, body: { noteBody: 'v84c note to analyse' }, service: 'crmAi.analyzeNote', ok: 201 },
  { name: 'POST ai-follow-up-draft', method: 'post', path: 'contacts/:c/ai-follow-up-draft', level: 'read', contactScoped: true, service: 'crmAi.generateFollowUpDraft', ok: 201 },
  // Business-level routes: module scope only (no contact in the path). The
  // bodies are empty, so on unmodified code the POSTs stop at their own 400.
  { name: 'POST ai-command', method: 'post', path: 'ai-command', level: 'read', contactScoped: false, body: {} },
  { name: 'POST ai-analyze', method: 'post', path: 'ai-analyze', level: 'read', contactScoped: false, body: {} },
  { name: 'POST ai-analyze/execute', method: 'post', path: 'ai-analyze/execute', level: 'write', contactScoped: false, body: {} },
  { name: 'GET ai-guidelines', method: 'get', path: 'ai-guidelines', level: 'read', contactScoped: false },
  { name: 'POST ai-guidelines', method: 'post', path: 'ai-guidelines', level: 'write', contactScoped: false, body: {} },
  { name: 'GET ai-churn-risk', method: 'get', path: 'ai-churn-risk', level: 'read', contactScoped: false },
  { name: 'POST ai-search', method: 'post', path: 'ai-search', level: 'read', contactScoped: false, body: {} },
  { name: 'POST ai-execute', method: 'post', path: 'ai-execute', level: 'write', contactScoped: false, body: {} },
  { name: 'GET ai-data-quality', method: 'get', path: 'ai-data-quality', level: 'read', contactScoped: false },
  { name: 'GET ai-duplicates', method: 'get', path: 'ai-duplicates', level: 'read', contactScoped: false },
  { name: 'GET ai-reengagement', method: 'get', path: 'ai-reengagement', level: 'read', contactScoped: false },
  { name: 'GET ai-revenue-opportunities', method: 'get', path: 'ai-revenue-opportunities', level: 'read', contactScoped: false },
];

/** The contact-scoped routes of the other four sibling controllers. */
type ContactRoute = {
  name: string;
  method: Method;
  path: string;
  body?: Record<string, unknown>;
  service: string;
  ok: number;
  /**
   * custom-field-values: ContactCustomFieldValueService.getValuesForContact is
   * itself the gate (the same predicate, applied before any value is read), so
   * a refused call reaches that one method and nothing else.
   */
  gateInService?: boolean;
  /** forget consumes its contact: the hidden and permitted targets differ. */
  target?: { hidden: string; staff: string; owner: string };
};

const CONTACT_ROUTES: ContactRoute[] = [
  { name: 'GET contacts/:contactId/deals', method: 'get', path: 'contacts/:c/deals', service: 'deals.listContactDeals', ok: 200 },
  { name: 'GET contacts/:contactId/account-suggestion', method: 'get', path: 'contacts/:c/account-suggestion', service: 'accounts.suggestForContact', ok: 200 },
  { name: 'GET contacts/:contactId/custom-field-values', method: 'get', path: 'contacts/:c/custom-field-values', service: 'customFieldValues.getValuesForContact', ok: 200, gateInService: true },
  { name: 'GET contacts/:contactId/audit', method: 'get', path: 'contacts/:c/audit', service: 'audit.list', ok: 200 },
  { name: 'POST contacts/:contactId/export', method: 'post', path: 'contacts/:c/export', service: 'privacy.exportContact', ok: 201 },
  {
    name: 'POST contacts/:contactId/forget', method: 'post', path: 'contacts/:c/forget', body: { reason: 'v84c test forget' },
    service: 'privacy.requestForget', ok: 201, target: { hidden: ID.gPriv, staff: ID.gTeam, owner: ID.gOwner },
  },
];

function send(method: Method, routePath: string, actor: string, contactId: string, body?: Record<string, unknown>) {
  nextRateWindow();
  const url = `/crm/businesses/${ID.bizA}/${routePath.replace(':c', contactId)}`;
  const req = request(app.getHttpServer())[method](url).set('x-test-user', actor);
  return body ? req.send(body) : req;
}

const svcCalls = () => serviceCalls.map((c) => `${c.service}.${c.method}`);

/** What the seeding forget of each forgotten contact answered and left. */
const forgetSeeds: Record<string, { status: number; deletedAt: unknown; request: string | null }> = {};

// ---------------------------------------------------------------------------

beforeAll(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { CrmAiController } = await import('../src/modules/crm/crm-ai.controller');
  const { CrmAiService } = await import('../src/modules/crm/crm-ai.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmDealsController } = await import('../src/modules/crm/crm-deals.controller');
  const { CrmDealsService } = await import('../src/modules/crm/crm-deals.service');
  const { DealForecastService } = await import('../src/modules/crm/deal-forecast.service');
  const { DealVelocityService } = await import('../src/modules/crm/deal-velocity.service');
  const { WonLostReasonService } = await import('../src/modules/crm/won-lost-reason.service');
  const { CrmAccountsController } = await import('../src/modules/crm/crm-accounts.controller');
  const { CrmAccountsService } = await import('../src/modules/crm/crm-accounts.service');
  const { CrmCustomFieldsController } = await import('../src/modules/crm/crm-custom-fields.controller');
  const { CustomFieldDefinitionService } = await import('../src/modules/crm/custom-field-definition.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { ContactPrivacyController } = await import('../src/modules/crm/privacy/contact-privacy.controller');
  const { ContactPrivacyService } = await import('../src/modules/crm/privacy/contact-privacy.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  ({ assertContactVisible } = await import('../src/modules/crm/crm-permissions.helper') as any);

  // ---- the real services over the real client -----------------------------
  const prisma = { client: db } as any;
  const events = new EventEmitter2();
  const coreTimeline = new TimelineService(prisma);
  // EvidenceService and TaskAssignmentService: on no route here.
  const crmTimeline = new CrmTimelineService(prisma, events, coreTimeline, {} as any, {} as any);
  // CrmSequenceService: reached only by ai-execute's enroll action, which no case sends.
  const crmAi = new CrmAiService(prisma, aiGateway as any, {} as any, new CrmListsService(prisma), crmTimeline);
  const contactInsight = new ContactInsightService(prisma, aiGateway as any, new BestChannelService(prisma), events);
  const reasons = new WonLostReasonService(prisma);
  auditService = new ContactAuditService(prisma);
  const privacy = new ContactPrivacyService(prisma, auditService);
  // The export's object storage: a recorder on the real instance (no S3 traffic).
  (privacy as any).s3Client = { client: storageClient, bucket: 'v84c-recorded-bucket' };

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmAiController, CrmDealsController, CrmAccountsController, CrmCustomFieldsController, ContactPrivacyController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      { provide: CrmAiService, useValue: recorded('crmAi', crmAi) },
      { provide: CrmJourneyService, useValue: recorded('journey', new CrmJourneyService(prisma)) },
      { provide: ContactInsightService, useValue: recorded('contactInsight', contactInsight) },
      { provide: CrmDealsService, useValue: recorded('deals', new CrmDealsService(prisma, events, crmTimeline, reasons)) },
      { provide: DealForecastService, useValue: recorded('forecast', {}) },
      { provide: DealVelocityService, useValue: recorded('velocity', {}) },
      { provide: WonLostReasonService, useValue: recorded('reasons', reasons) },
      { provide: CrmAccountsService, useValue: recorded('accounts', new CrmAccountsService(prisma)) },
      { provide: CustomFieldDefinitionService, useValue: recorded('customFieldDefinitions', {}) },
      { provide: ContactCustomFieldValueService, useValue: recorded('customFieldValues', new ContactCustomFieldValueService(prisma)) },
      { provide: ContactAuditService, useValue: recorded('audit', auditService) },
      { provide: ContactPrivacyService, useValue: recorded('privacy', privacy) },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only: what AuthMiddleware attaches after Supabase
  // verifies the token, for seeded v84c_ users only. No guard is overridden.
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

  // ---- identities, tenants, memberships ----------------------------------
  for (const id of [ID.owner, ID.crmNone, ID.staffOwned, ID.other]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84C Biz A', ownerId: ID.owner, metaData: { features: { ai_tools: true } } } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84C Biz B', ownerId: ID.other } });
  const m = async (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.crmNone, ID.bizA, 'STAFF', { crm: 'none' });
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'write', crm_view: 'owned' });
  await m(ID.other, ID.bizB, 'OWNER');

  // ---- accounts, contacts and the rows each route reads --------------------
  await db.account.create({ data: { id: `${P}acct_priv`, businessId: ID.bizA, name: SECRET.account } });
  await db.account.create({ data: { id: `${P}acct_team`, businessId: ID.bizA, name: 'V84C team account' } });
  let n = 0;
  const c = async (id: string, businessId: string, visibility: string, ownerId: string, accountId?: string) =>
    db.contact.create({
      data: {
        id, businessId, firstName: id, visibility, ownerId, accountId: accountId ?? null,
        phone: `+1868556${String(1000 + n++)}`,
        email: `${id.slice(P.length).toLowerCase()}@v84c-contacts.test`,
      },
    });
  await c(ID.cPriv, ID.bizA, 'PRIVATE', ID.owner, `${P}acct_priv`);
  await c(ID.cTeam, ID.bizA, 'TEAM', ID.staffOwned, `${P}acct_team`);
  await c(ID.fTeamStaff, ID.bizA, 'TEAM', ID.staffOwned);
  await c(ID.fTeamOwner, ID.bizA, 'TEAM', ID.staffOwned);
  await c(ID.fPrivHidden, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.fPrivOwner, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.gPriv, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.gTeam, ID.bizA, 'TEAM', ID.staffOwned);
  await c(ID.gOwner, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.cB, ID.bizB, 'TEAM', ID.other);

  await db.dealStage.create({ data: { id: ID.stage, businessId: ID.bizA, name: 'V84C Open', slug: 'v84c-open' } });
  await db.customFieldDefinition.create({ data: { id: ID.cfDef, businessId: ID.bizA, name: 'v84c field', label: 'V84C field', type: 'TEXT' } });
  for (const contactId of [ID.cPriv, ID.cTeam]) {
    const tail = contactId.slice(P.length);
    const secret = contactId === ID.cPriv;
    await db.deal.create({
      data: { id: `${P}deal_${tail}`, businessId: ID.bizA, contactId, title: secret ? SECRET.deal : `V84C deal ${tail}`, stageId: ID.stage, value: 1200 },
    });
    await db.contactCustomFieldValue.create({
      data: { id: `${P}cfv_${tail}`, contactId, definitionId: ID.cfDef, value: secret ? SECRET.customField : `v84c value ${tail}` },
    });
    await db.contactTask.create({
      data: { id: `${P}task_${tail}`, businessId: ID.bizA, contactId, title: secret ? SECRET.task : `V84C task ${tail}`, status: 'OPEN' },
    });
    await db.contactNote.create({
      data: { id: `${P}note_${tail}`, businessId: ID.bizA, contactId, body: secret ? SECRET.note : `v84c note ${tail}` },
    });
  }
  for (const contactId of [ID.cPriv, ID.cTeam, ...FORGOTTEN]) {
    await auditService.write({ businessId: ID.bizA, contactId, action: 'created', actor: { type: 'SYSTEM' }, reason: 'v84c seed' });
  }

  // ---- the forgotten contacts: forgotten by the OWNER through the route ----
  for (const contactId of FORGOTTEN) {
    const res = await send('post', 'contacts/:c/forget', ID.owner, contactId, { reason: 'v84c seeded forget' });
    forgetSeeds[contactId] = { status: res.status, deletedAt: (await contactRow(contactId))?.deleted_at ?? null, request: (await forgetRequest(contactId))?.status ?? null };
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  // Let fire-and-forget writes (insight recompute, audit) settle before the rows are removed.
  await new Promise((r) => setTimeout(r, 300));
  if (db) await cleanup();
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows, real visibility rule)', () => {
  it('seeded the actors and contacts; GET detail\'s rule hides the owner\'s PRIVATE contact from STAFF_OWNED and opens its TEAM contact', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(3);
    const staff = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.staffOwned, businessId: ID.bizA } } });
    expect(staff.permissionScopes).toEqual({ crm: 'write', crm_view: 'owned' });
    const biz = await db.business.findUnique({ where: { id: ID.bizA }, select: { metaData: true } });
    expect(biz.metaData).toEqual({ features: { ai_tools: true } });
    const prisma = { client: db };
    const opens = async (actor: string, contactId: string) =>
      assertContactVisible(prisma, ID.bizA, contactId, actor).then(() => true, (err: any) => {
        if (err?.status === 404) return false;
        throw err;
      });
    expect(await opens(ID.staffOwned, ID.cPriv)).toBe(false);
    expect(await opens(ID.staffOwned, ID.gPriv)).toBe(false);
    expect(await opens(ID.staffOwned, ID.cTeam)).toBe(true);
    expect(await opens(ID.owner, ID.cPriv)).toBe(true);
  });

  it('each forgotten contact was forgotten through POST forget: 201, deletedAt set, ContactForgetRequest requested', () => {
    for (const contactId of FORGOTTEN) {
      expect(forgetSeeds[contactId]?.status, contactId).toBe(201);
      expect(forgetSeeds[contactId]?.deletedAt, contactId).not.toBeNull();
      expect(forgetSeeds[contactId]?.request, contactId).toBe('requested');
    }
  });
});

// ---------------------------------------------------------------------------
// CS-01: a crm 'none' member is refused every crm-ai route by ModuleScopeGuard.
// ---------------------------------------------------------------------------

describe('CS-01 every crm-ai route requires CRM module scope (pre-fix FAIL expected)', () => {
  for (const route of AI_ROUTES) {
    it(`${route.name}: a crm 'none' member gets 403 (crm ${route.level}); no service, AI call or row`, async () => {
      const before = await snapshot();
      resetRecorders();
      const res = await send(route.method, route.path, ID.crmNone, ID.cTeam, route.body);

      expect({ status: res.status, message: res.body?.message }, route.name).toEqual({
        status: 403,
        message: `Insufficient permissions: crm requires ${route.level} access (you have none)`,
      });
      expect(svcCalls(), route.name).toEqual([]);
      expect(aiCalls, route.name).toEqual([]);
      expect(await snapshot(), route.name).toEqual(before);
    });
  }
});

// ---------------------------------------------------------------------------
// CS-02: a contact the member cannot open answers 404 like an unknown id,
// before any service call; nothing is written and nothing is reached.
// ---------------------------------------------------------------------------

describe("CS-02 a contact-scoped route refuses a contact the member cannot open (pre-fix FAIL expected, except custom-field-values)", () => {
  const cases = [
    ...AI_ROUTES.filter((r) => r.contactScoped).map((r) => ({ ...r, gateInService: false, target: undefined as ContactRoute['target'] })),
    ...CONTACT_ROUTES,
  ];
  for (const route of cases) {
    const label = route.gateInService ? '(already gated at base by ContactCustomFieldValueService)' : '';
    it(`${route.name}: STAFF_OWNED on the owner's PRIVATE contact answers 404 like an unknown id ${label}`.trim(), async () => {
      const hidden = route.target?.hidden ?? ID.cPriv;
      const before = await snapshot();
      resetRecorders();
      const res = await send(route.method, route.path, ID.staffOwned, hidden, route.body);
      const hiddenCalls = svcCalls();
      const hiddenAi = aiCalls.length;
      const hiddenPuts = storagePuts.length;
      const absent = await send(route.method, route.path, ID.staffOwned, ABSENT, route.body);

      expect(res.status, `${route.name} status`).toBe(404);
      expect(res.body, route.name).toEqual(NOT_FOUND_BODY);
      expect(res.text, `${route.name}: body vs an unknown id`).toBe(absent.text);
      for (const secret of Object.values(SECRET)) expect(res.text, route.name).not.toContain(secret);
      expect(hiddenCalls, `${route.name}: services reached`).toEqual(route.gateInService ? [route.service] : []);
      expect({ ai: hiddenAi, storage: hiddenPuts }, route.name).toEqual({ ai: 0, storage: 0 });
      expect(await snapshot(), `${route.name} rows`).toEqual(before);
    });
  }
});

// ---------------------------------------------------------------------------
// CS-03 (must pass before and after): a forgotten contact the member may open
// keeps its cancel window and its audit trail.
// ---------------------------------------------------------------------------

describe('CS-03 the privacy routes still work on a forgotten contact the member may open', () => {
  const cases = [
    { actor: ID.staffOwned, contactId: ID.fTeamStaff, why: 'STAFF_OWNED on its forgotten TEAM contact' },
    { actor: ID.owner, contactId: ID.fTeamOwner, why: 'OWNER on a forgotten TEAM contact' },
    { actor: ID.owner, contactId: ID.fPrivOwner, why: 'OWNER on its forgotten PRIVATE contact' },
  ];
  for (const { actor, contactId, why } of cases) {
    it(`${why}: GET audit answers 200 with its entries; POST forget/cancel answers 201, the contact is live again and the request is cancelled`, async () => {
      expect((await contactRow(contactId)).deleted_at, why).not.toBeNull();
      resetRecorders();
      const audit = await send('get', 'contacts/:c/audit', actor, contactId);
      expect(audit.status, `${why} audit`).toBe(200);
      const actions = audit.body.entries.map((e: { action: string }) => e.action);
      expect(actions, why).toEqual(expect.arrayContaining(['created', 'forget_requested']));
      expect(audit.body.entries.every((e: { contactId: string }) => e.contactId === contactId), why).toBe(true);

      const cancel = await send('post', 'contacts/:c/forget/cancel', actor, contactId);
      expect({ status: cancel.status, body: cancel.body }, `${why} cancel`).toEqual({ status: 201, body: { ok: true } });
      expect((await contactRow(contactId)).deleted_at, why).toBeNull();
      expect((await forgetRequest(contactId)).status, why).toBe('cancelled');
      expect(await auditActions(contactId), why).toContain('forget_cancelled');
      expect(svcCalls(), why).toEqual(['audit.list', 'privacy.cancelForget']);
    });
  }
});

// ---------------------------------------------------------------------------
// CS-04: a forgotten contact the member may not open stays forgotten.
// ---------------------------------------------------------------------------

describe("CS-04 a forgotten contact the member cannot open answers 404 on audit and forget/cancel (pre-fix FAIL expected)", () => {
  it("STAFF_OWNED on the owner's forgotten PRIVATE contact: audit and forget/cancel answer 404 like an unknown id; it stays forgotten", async () => {
    const before = await snapshot();
    const auditBefore = await auditActions(ID.fPrivHidden);
    resetRecorders();
    const audit = await send('get', 'contacts/:c/audit', ID.staffOwned, ID.fPrivHidden);
    const cancel = await send('post', 'contacts/:c/forget/cancel', ID.staffOwned, ID.fPrivHidden);
    const calls = svcCalls();
    const absentAudit = await send('get', 'contacts/:c/audit', ID.staffOwned, ABSENT);
    const absentCancel = await send('post', 'contacts/:c/forget/cancel', ID.staffOwned, ABSENT);

    expect({ audit: audit.status, cancel: cancel.status }).toEqual({ audit: 404, cancel: 404 });
    expect(audit.body).toEqual(NOT_FOUND_BODY);
    expect(cancel.body).toEqual(NOT_FOUND_BODY);
    expect(audit.text, 'audit body vs an unknown id').toBe(absentAudit.text);
    expect(cancel.text, 'cancel body vs an unknown id').toBe(absentCancel.text);
    expect(calls, 'services reached').toEqual([]);
    expect((await contactRow(ID.fPrivHidden)).deleted_at).not.toBeNull();
    expect((await forgetRequest(ID.fPrivHidden)).status).toBe('requested');
    expect(await auditActions(ID.fPrivHidden)).toEqual(auditBefore);
    expect(await auditActions(ID.fPrivHidden)).not.toContain('forget_cancelled');
    expect(await snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// CONTROLS (pass before and after): the routes answer as today for a member
// who may open the contact, and a member of another business is refused.
// ---------------------------------------------------------------------------

describe('CONTROLS: permitted callers answer as today; another business is refused', () => {
  const contactAiRoutes = AI_ROUTES.filter((r) => r.contactScoped);
  for (const route of [...contactAiRoutes, ...CONTACT_ROUTES.map((r) => ({ ...r, level: undefined }))]) {
    const target = (route as ContactRoute).target;
    it(`${route.name}: the OWNER on its PRIVATE contact and STAFF_OWNED on its TEAM contact answer ${route.ok}; the service is reached`, async () => {
      for (const { actor, contactId } of [
        { actor: ID.owner, contactId: target?.owner ?? ID.cPriv },
        { actor: ID.staffOwned, contactId: target?.staff ?? ID.cTeam },
      ]) {
        resetRecorders();
        const res = await send(route.method, route.path, actor, contactId, route.body);
        expect(res.status, `${route.name} ${actor} ${contactId}: ${res.text.slice(0, 300)}`).toBe(route.ok);
        expect(svcCalls(), `${route.name} ${actor}`).toContain(route.service);
        if (target) {
          expect((await contactRow(contactId)).deleted_at, `${route.name} ${actor}`).not.toBeNull();
          expect((await forgetRequest(contactId)).status, `${route.name} ${actor}`).toBe('requested');
        }
      }
    });
  }

  it('the answers carry the contact\'s own rows (deals, account, custom field values, audit, export token)', async () => {
    const deals = await send('get', 'contacts/:c/deals', ID.staffOwned, ID.cTeam);
    expect(deals.body.map((d: { id: string }) => d.id)).toEqual([`${P}deal_cTeam`]);
    const ownerDeals = await send('get', 'contacts/:c/deals', ID.owner, ID.cPriv);
    expect(ownerDeals.body.map((d: { title: string }) => d.title)).toEqual([SECRET.deal]);
    const account = await send('get', 'contacts/:c/account-suggestion', ID.staffOwned, ID.cTeam);
    expect(account.body).toMatchObject({ reason: 'linked', account: { id: `${P}acct_team` } });
    const values = await send('get', 'contacts/:c/custom-field-values', ID.staffOwned, ID.cTeam);
    expect(values.body.map((v: { id: string }) => v.id)).toEqual([`${P}cfv_cTeam`]);
    const audit = await send('get', 'contacts/:c/audit', ID.staffOwned, ID.cTeam);
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toContain('created');
    resetRecorders();
    const exported = await send('post', 'contacts/:c/export', ID.staffOwned, ID.cTeam);
    expect(exported.status).toBe(201);
    expect(typeof exported.body.token).toBe('string');
    expect(storagePuts).toHaveLength(2);
  });

  it("a crm 'none' member is refused the non-AI contact routes as today (403, unchanged)", async () => {
    for (const route of CONTACT_ROUTES) {
      resetRecorders();
      const res = await send(route.method, route.path, ID.crmNone, ID.cTeam, route.body);
      expect(res.status, route.name).toBe(403);
      expect(svcCalls(), route.name).toEqual([]);
    }
  });

  it('a member of bizB is refused every route on bizA (403); no service or AI call', async () => {
    const before = await snapshot();
    const routes = [...AI_ROUTES, ...CONTACT_ROUTES, { name: 'POST forget/cancel', method: 'post' as Method, path: 'contacts/:c/forget/cancel' }];
    for (const route of routes) {
      resetRecorders();
      const res = await send(route.method, route.path, ID.other, ID.cTeam, (route as AiRoute).body);
      expect(res.status, route.name).toBe(403);
      expect(svcCalls(), route.name).toEqual([]);
      expect(aiCalls, route.name).toEqual([]);
    }
    expect(await snapshot()).toEqual(before);
  });
});
