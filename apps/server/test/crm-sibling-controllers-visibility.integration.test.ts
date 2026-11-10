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
 * the five controllers and the services they call (CrmAiService with
 * CrmSequenceService and CrmListsService,
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
 * Review repairs (ST-1..ST-4, CR-1) add: STAFF_WRITE {crm:'write'} (sees TEAM,
 * delete scope 'owned'), STAFF_DELETE_NONE {crm:'write', crm_delete:'none'}, an
 * ADMIN member (crm admin by role); the owner's TEAM contact and one STAFF_WRITE
 * owns (forget targets); and two PROSPECT twins with the same name, the owner's
 * PRIVATE one and STAFF_OWNED's TEAM one, which every business scan lists.
 *
 * V1-89 W3-CRM-AI-VISIBILITY (the FOLLOW3-D3 residuals ST-1 and ST-2) adds:
 * the TenantInterceptor, as in production (it binds the request's member,
 * whose CRM visibility CrmDealsService.listDeals applies to the deals'
 * contacts); a prompt on each AI gateway record; three contacts tagged
 * `v84c-bulk-scope` for bulk_status_change (the owner's PRIVATE and TEAM ones
 * and a TEAM one STAFF_OWNED owns); and live cases for the unfiltered deal
 * list, the AI prompts, the scans' aggregate counts, ai-analyze's body
 * contactIds and a member's bulk_status_change, which replace the residual
 * todos and the earlier bulk_status_change refusal.
 *
 * V1-89 review repairs (SEC-V89-1..5) add: CrmAiService over the real
 * CrmService (bulk_status_change writes through bulkUpdateContacts; the stats
 * and flow caches are recorders); ai-execute change_status and toggle_favorite
 * under PATCH contacts/:contactId's edit scope; bulk_status_change's audit,
 * events and param checks; and listDeals withholding a hidden contact's copied
 * company and account, and matching nothing on a hidden contactId. Each of
 * these cases creates its own contacts and removes them when it ends.
 *
 * W9-CRM-RESIDUALS turns the two V1-89 residual todos live (D-37): GET
 * deals/:dealId and the velocity report (now the real DealVelocityService)
 * withhold a hidden contact as GET deals does, an account's deals leave out a
 * deal of a hidden contact as GET deals?accountId= does, and ai-command's
 * prompt counts sequence enrollments and list members over the contacts the
 * member may open. Each case seeds its own deals, stage, sequence or list and
 * removes them when it ends.
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
  staffWrite: `${P}staffWrite`, // STAFF of bizA, crm write (sees TEAM; delete scope 'owned')
  staffDelNone: `${P}staffDelNone`, // STAFF of bizA, crm write + crm_delete none
  admin: `${P}admin`,           // ADMIN of bizA (crm admin by role)
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
  hTeamOwner: `${P}hTeamOwner`, // TEAM, the owner's: STAFF_WRITE and STAFF_DELETE_NONE may not forget it
  hTeamWrite: `${P}hTeamWrite`, // TEAM, STAFF_WRITE's: STAFF_WRITE's permitted forget
  tPriv: `${P}tPriv`,           // PRIVATE, the owner's PROSPECT twin (hidden from STAFF_OWNED)
  tTeam: `${P}tTeam`,           // TEAM, STAFF_OWNED's PROSPECT twin
  // bulk_status_change targets (V1-89), LEAD and tagged BULK_TAG.
  bPriv: `${P}bPriv`,           // PRIVATE, the owner's: hidden from ADMIN and STAFF_OWNED
  bTeam: `${P}bTeam`,           // TEAM, the owner's: ADMIN may open it, STAFF_OWNED may not
  bStaff: `${P}bStaff`,         // TEAM, STAFF_OWNED's
  // Members created by the V1-89 bulk_status_change case only.
  editOwned: `${P}editOwned`,   // STAFF of bizA, crm write + crm_edit owned
  editNone: `${P}editNone`,     // STAFF of bizA, crm write + crm_edit none
  // Created (and removed) by the V1-89 review-repair cases only.
  eOwn: `${P}eOwn`,             // TEAM, editOwned's (SEC-V89-1)
  aTeam: `${P}aTeam`,           // TEAM, the owner's, LEAD, AUDIT_TAG (SEC-V89-2)
  aPriv: `${P}aPriv`,           // PRIVATE, the owner's, LEAD, AUDIT_TAG (SEC-V89-2)
  vLead: `${P}vLead`,           // TEAM, the owner's, LEAD, VALIDATE_TAG (SEC-V89-3)
  vClient: `${P}vClient`,       // TEAM, the owner's, CLIENT, VALIDATE_TAG (SEC-V89-3)
  dPriv: `${P}dPriv`,           // PRIVATE, the owner's, with a company and an account (SEC-V89-4)
  stage: `${P}stage`,
  cfDef: `${P}cfDef`,
};
const ABSENT = `${P}absent`;
/** The twins' shared name (a duplicate cluster) and tag (a bulk_status_change filter). */
const TWIN = { firstName: 'V84C Twin', lastName: 'Prospect', tag: 'v84c-bulk' };
const FORGOTTEN = [ID.fTeamStaff, ID.fTeamOwner, ID.fPrivHidden, ID.fPrivOwner];
/** The tag of the V1-89 bulk_status_change targets (no other contact carries it). */
const BULK_TAG = 'v84c-bulk-scope';
/** The tags of the V1-89 review-repair bulk_status_change cases (no other contact carries them). */
const AUDIT_TAG = 'v84c-bulk-audit';
const VALIDATE_TAG = 'v84c-bulk-validate';
/** The company of the owner's PRIVATE contact dPriv, which createDeal copies onto its deal (SEC-V89-4). */
const SECRET_COMPANY = 'v84c-secret-company-9z';
/** Live contacts of bizA STAFF_OWNED may not open (crm_view 'owned'; it owns none of them). */
const HIDDEN_FROM_STAFF_OWNED = [ID.cPriv, ID.tPriv, ID.hTeamOwner, ID.bPriv, ID.bTeam];

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
/** Each AI call, with its prompt (every message's content) so a case can read what the model was told. */
const aiCalls: Array<{ businessId: string; feature: string; prompt: string }> = [];
const aiGateway = {
  callAi: async (args: { businessId: string; feature: string; messages?: Array<{ content: string }> }) => {
    aiCalls.push({ businessId: args.businessId, feature: args.feature, prompt: (args.messages ?? []).map((m) => m.content).join('\n') });
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
/**
 * The CRM stats and flow caches CrmService invalidates after a contact write
 * (recorders: the bulk path's invalidation is observed, V1-89 SEC-V89-2).
 */
const cacheInvalidations: string[] = [];
const statsCache = { invalidateCache: (businessId: string) => { cacheInvalidations.push(`stats:${businessId}`); } };
const flowCache = { invalidateCache: (businessId: string) => { cacheInvalidations.push(`flow:${businessId}`); } };

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
let dealsService: any;
let runWithTenant: <T>(businessId: string, userId: string, fn: () => T) => T;
let assertContactVisible: (prisma: any, businessId: string, contactId: string, actorUserId: string) => Promise<unknown>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_custom_field_values WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM custom_field_definitions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_sequence_enrollments WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_sequences WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_list_members WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_lists WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

type Method = 'get' | 'post' | 'patch';

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
  const { CrmSequenceService } = await import('../src/modules/crm/crm-sequence.service');
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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  ({ runWithTenant } = await import('../src/core/tenant/tenant-context'));
  ({ assertContactVisible } = await import('../src/modules/crm/crm-permissions.helper') as any);

  // ---- the real services over the real client -----------------------------
  const prisma = { client: db } as any;
  const events = new EventEmitter2();
  const coreTimeline = new TimelineService(prisma);
  // EvidenceService and TaskAssignmentService: on no route here.
  const crmTimeline = new CrmTimelineService(prisma, events, coreTimeline, {} as any, {} as any);
  auditService = new ContactAuditService(prisma);
  // CrmService: the real contact writer bulk_status_change goes through (its
  // audit, timeline and cache invalidation, V1-89 SEC-V89-2), with the real
  // ContactAuditService and CrmTimelineService and recorders for the two
  // caches. SubscriptionsService, EntityResolutionService and the custom
  // field values: on no path here.
  const crmService = new CrmService(
    prisma, events, {} as any, crmTimeline, statsCache as any, new CrmListsService(prisma), flowCache as any, {} as any, auditService, {} as any,
  );
  // CrmSequenceService: the real one (ai-reengagement lists the sequences).
  const crmAi = new CrmAiService(
    prisma, aiGateway as any, new CrmSequenceService(prisma, crmTimeline), new CrmListsService(prisma), crmTimeline, crmService,
  );
  const contactInsight = new ContactInsightService(prisma, aiGateway as any, new BestChannelService(prisma), events);
  const reasons = new WonLostReasonService(prisma);
  dealsService = new CrmDealsService(prisma, events, crmTimeline, reasons);
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
      { provide: CrmDealsService, useValue: recorded('deals', dealsService) },
      { provide: DealForecastService, useValue: recorded('forecast', {}) },
      // W9-CRM-RESIDUALS: the real report (its outliers name each deal's contact).
      { provide: DealVelocityService, useValue: recorded('velocity', new DealVelocityService(prisma)) },
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
  // The production pipeline's TenantInterceptor (a global APP_INTERCEPTOR in
  // app.module.ts): it binds the request's member to the tenant BusinessGuard
  // verified, which CrmDealsService.listDeals reads (V1-89).
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const id of [ID.owner, ID.crmNone, ID.staffOwned, ID.other, ID.staffWrite, ID.staffDelNone, ID.admin]) {
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
  await m(ID.staffWrite, ID.bizA, 'STAFF', { crm: 'write' });
  await m(ID.staffDelNone, ID.bizA, 'STAFF', { crm: 'write', crm_delete: 'none' });
  await m(ID.admin, ID.bizA, 'ADMIN');

  // ---- accounts, contacts and the rows each route reads --------------------
  await db.account.create({ data: { id: `${P}acct_priv`, businessId: ID.bizA, name: SECRET.account } });
  await db.account.create({ data: { id: `${P}acct_team`, businessId: ID.bizA, name: 'V84C team account' } });
  let n = 0;
  const c = async (id: string, businessId: string, visibility: string, ownerId: string, accountId?: string) =>
    db.contact.create({
      data: {
        id, businessId, firstName: id, visibility, ownerId, accountId: accountId ?? null,
        phone: `+1868556${String(1000 + n++)}`,
        email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`,
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
  await c(ID.hTeamOwner, ID.bizA, 'TEAM', ID.owner);
  await c(ID.hTeamWrite, ID.bizA, 'TEAM', ID.staffWrite);
  for (const [id, visibility, ownerId] of [[ID.tPriv, 'PRIVATE', ID.owner], [ID.tTeam, 'TEAM', ID.staffOwned]] as const) {
    await db.contact.create({
      data: {
        id, businessId: ID.bizA, firstName: TWIN.firstName, lastName: TWIN.lastName, visibility, ownerId,
        status: 'PROSPECT', leadScore: 80, tags: [TWIN.tag],
        phone: `+1868556${String(1000 + n++)}`, email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`,
      },
    });
  }

  for (const [id, visibility, ownerId] of [[ID.bPriv, 'PRIVATE', ID.owner], [ID.bTeam, 'TEAM', ID.owner], [ID.bStaff, 'TEAM', ID.staffOwned]] as const) {
    await db.contact.create({
      data: {
        id, businessId: ID.bizA, firstName: id, visibility, ownerId, status: 'LEAD', tags: [BULK_TAG],
        phone: `+1868556${String(1000 + n++)}`, email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`,
      },
    });
  }

  await db.dealStage.create({ data: { id: ID.stage, businessId: ID.bizA, name: 'V84C Open', slug: `${P}open` } });
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
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(6);
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

  it("the OWNER of bizA on bizB's forgotten contact, through bizA's path: audit, export and forget/cancel answer 404 like an unknown id (the tenant term stays without deletedAt)", async () => {
    nextRateWindow();
    const forgotB = await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizB}/contacts/${ID.cB}/forget`).set('x-test-user', ID.other).send({});
    expect(forgotB.status).toBe(201);
    expect((await contactRow(ID.cB)).deleted_at).not.toBeNull();
    resetRecorders();
    const statuses: Record<string, number> = {};
    for (const [method, routePath] of [['get', 'contacts/:c/audit'], ['post', 'contacts/:c/export'], ['post', 'contacts/:c/forget/cancel']] as const) {
      const res = await send(method, routePath, ID.owner, ID.cB);
      const absent = await send(method, routePath, ID.owner, ABSENT);
      statuses[routePath] = res.status;
      expect(res.body, routePath).toEqual(NOT_FOUND_BODY);
      expect(res.text, `${routePath}: body vs an unknown id`).toBe(absent.text);
    }
    expect(statuses).toEqual({ 'contacts/:c/audit': 404, 'contacts/:c/export': 404, 'contacts/:c/forget/cancel': 404 });
    expect(svcCalls()).toEqual([]);
    expect(storagePuts).toEqual([]);
    expect((await contactRow(ID.cB)).deleted_at).not.toBeNull();
    expect((await forgetRequest(ID.cB)).status).toBe('requested');
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

// ---------------------------------------------------------------------------
// Review repairs (FOLLOW3-D3 review ST-1..ST-4, CR-1).
// ---------------------------------------------------------------------------

const opensFor = (actor: string, contactId: string) =>
  assertContactVisible({ client: db }, ID.bizA, contactId, actor).then(() => true, (err: any) => {
    if (err?.status === 404) return false;
    throw err;
  });
const contactState = async (contactId: string) =>
  (await q(`SELECT status, tags, updated_at, last_interaction_at, deleted_at FROM contacts WHERE id = '${contactId}'`))[0] ?? null;
const rowCount = async (table: string, contactId: string) =>
  Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE contact_id = '${contactId}'`))[0].n);

/** The crm_edit 'owned' and 'none' members of bizA (V1-89 (d)), created on first use. */
async function ensureEditScopeMembers() {
  for (const [id, crmEdit] of [[ID.editOwned, 'owned'], [ID.editNone, 'none']] as const) {
    await db.user.upsert({ where: { id }, update: {}, create: { id, email: `${P}${id.slice(P.length).toLowerCase()}@test.local`, role: 'USER' } });
    await db.membership.upsert({
      where: { userId_businessId: { userId: id, businessId: ID.bizA } },
      update: {},
      create: { id: `${P}m_${id.slice(P.length)}_bizA`, userId: id, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_edit: crmEdit } },
    });
  }
}

/** A contact of bizA created by a review-repair case (removed again by dropContacts). */
let extraPhone = 0;
const seedContact = (id: string, data: { visibility: string; ownerId: string; status?: string; tags?: string[]; companyName?: string; accountId?: string }) =>
  db.contact.create({
    data: {
      id, businessId: ID.bizA, firstName: id, status: data.status ?? 'LEAD', tags: data.tags ?? [], visibility: data.visibility, ownerId: data.ownerId,
      companyName: data.companyName ?? null, accountId: data.accountId ?? null,
      phone: `+1868557${String(1000 + extraPhone++)}`, email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`,
    },
  });

/** Hard-deletes contacts a review-repair case created, with every row it wrote for them, so later cases see the seeded fixture. */
async function dropContacts(ids: string[]) {
  const list = ids.map((id) => `'${id}'`).join(', ');
  for (const sql of [
    `DELETE FROM deals WHERE contact_id IN (${list})`,
    `DELETE FROM contact_audit_entries WHERE contact_id IN (${list})`,
    `DELETE FROM contact_notes WHERE contact_id IN (${list})`,
    `DELETE FROM contact_tasks WHERE contact_id IN (${list})`,
    `DELETE FROM contact_events WHERE contact_id IN (${list})`,
    `DELETE FROM activities WHERE business_id = '${ID.bizA}' AND contact_id IN (${list})`,
    `DELETE FROM contacts WHERE id IN (${list})`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort; afterAll removes every v84c_ row */ }
  }
}

describe('ST-1 GET deals?contactId= holds the contacts/:contactId/deals rule', () => {
  it("STAFF_OWNED filtering on the owner's PRIVATE contact answers 404 like an unknown id; the deals service is not reached", async () => {
    resetRecorders();
    const res = await send('get', 'deals?contactId=:c', ID.staffOwned, ID.cPriv);
    const calls = svcCalls();
    const absent = await send('get', 'deals?contactId=:c', ID.staffOwned, ABSENT);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND_BODY);
    expect(res.text, 'body vs an unknown id').toBe(absent.text);
    expect(calls, 'services reached').toEqual([]);
    for (const secret of Object.values(SECRET)) expect(res.text).not.toContain(secret);
    expect(res.text).not.toContain(ID.cPriv);
  });

  it("controls: STAFF_OWNED on its TEAM contact and the OWNER on its PRIVATE contact list that contact's deals (200)", async () => {
    const staff = await send('get', 'deals?contactId=:c', ID.staffOwned, ID.cTeam);
    expect(staff.status).toBe(200);
    expect(staff.body.deals.map((d: { id: string }) => d.id)).toEqual([`${P}deal_cTeam`]);
    const owner = await send('get', 'deals?contactId=:c', ID.owner, ID.cPriv);
    expect(owner.status).toBe(200);
    expect(owner.body.deals.map((d: { title: string }) => d.title)).toEqual([SECRET.deal]);
  });

  it("V1-89 ST-1: the unfiltered GET deals lists a deal of a contact the member cannot open without that contact (contact and contactId null, no name); a contact it may open stays joined; the OWNER's list is unchanged", async () => {
    const dealOf = (body: any, contactTail: string) => body.deals.find((d: { id: string }) => d.id === `${P}deal_${contactTail}`);
    for (const actor of [ID.staffOwned, ID.admin]) {
      resetRecorders();
      const res = await send('get', 'deals', actor, '');
      expect(res.status, `${actor}: ${res.text.slice(0, 200)}`).toBe(200);
      expect(svcCalls(), actor).toEqual(['deals.listDeals']);
      const hidden = dealOf(res.body, 'cPriv');
      expect(hidden, `${actor}: the hidden contact's deal is still listed`).toBeDefined();
      expect({ contact: hidden.contact, contactId: hidden.contactId }, actor).toEqual({ contact: null, contactId: null });
      expect(res.text, `${actor}: the hidden contact's id or name`).not.toContain(ID.cPriv);
      expect(res.text, `${actor}: the hidden contact's email`).not.toContain(`${P}cpriv@contacts.test`);
      // cTeam is TEAM and STAFF_OWNED's: both may open it.
      expect(dealOf(res.body, 'cTeam').contact, actor).toMatchObject({ id: ID.cTeam, firstName: ID.cTeam });
      expect(dealOf(res.body, 'cTeam').contactId, actor).toBe(ID.cTeam);
    }

    const owner = await send('get', 'deals', ID.owner, '');
    expect(owner.status).toBe(200);
    expect(dealOf(owner.body, 'cPriv').contactId).toBe(ID.cPriv);
    expect(dealOf(owner.body, 'cPriv').contact).toMatchObject({ id: ID.cPriv, firstName: ID.cPriv });
  });

  it('V1-89 ST-1: listDeals with no member bound to the call (a queue run, D-88) keeps the OWNER view: every deal carries its contact', async () => {
    const result = await dealsService.listDeals({ businessId: ID.bizA });
    const hidden = result.deals.find((d: { id: string }) => d.id === `${P}deal_cPriv`);
    expect(hidden.contactId).toBe(ID.cPriv);
    expect(hidden.contact).toMatchObject({ id: ID.cPriv });
  });

  it("V1-89 ST-1 SEC-V89-4: a deal of a contact the member cannot open is listed without the company name and account createDeal copied from that contact, and search= and accountId= do not match it; the OWNER's list, search and account filter are unchanged", async () => {
    await seedContact(ID.dPriv, { visibility: 'PRIVATE', ownerId: ID.owner, companyName: SECRET_COMPANY, accountId: `${P}acct_priv` });
    try {
      const deal = await dealsService.createDeal({ businessId: ID.bizA, contactId: ID.dPriv, title: 'v84c copied deal', stageId: ID.stage, value: 10 });
      expect({ companyName: deal.companyName, accountId: deal.accountId }, 'fixture: copied from the contact').toEqual({
        companyName: SECRET_COMPANY, accountId: `${P}acct_priv`,
      });
      const ids = (res: { body: { deals: Array<{ id: string }> } }) => res.body.deals.map((d) => d.id);
      for (const actor of [ID.staffOwned, ID.admin]) {
        const list = await send('get', 'deals', actor, '');
        expect(list.status, actor).toBe(200);
        const row = list.body.deals.find((d: { id: string }) => d.id === deal.id);
        expect(row, `${actor}: the deal is still listed`).toBeDefined();
        expect({ contactId: row.contactId, contact: row.contact, companyName: row.companyName, accountId: row.accountId }, actor).toEqual({
          contactId: null, contact: null, companyName: null, accountId: null,
        });
        expect(list.text, `${actor}: the hidden contact's company`).not.toContain(SECRET_COMPANY);
        expect(list.text, `${actor}: the hidden contact's id`).not.toContain(ID.dPriv);

        const search = await send('get', `deals?search=${SECRET_COMPANY}`, actor, '');
        const noMatch = await send('get', 'deals?search=v84c-no-deal-has-this-text', actor, '');
        expect(search.status, actor).toBe(200);
        expect(search.text, `${actor}: search on the hidden company vs no match`).toBe(noMatch.text);

        const byAccount = await send('get', `deals?accountId=${P}acct_priv`, actor, '');
        expect(byAccount.status, actor).toBe(200);
        expect(ids(byAccount), `${actor}: the account filter`).not.toContain(deal.id);
      }

      const owner = await send('get', 'deals', ID.owner, '');
      expect(owner.body.deals.find((d: { id: string }) => d.id === deal.id)).toMatchObject({
        contactId: ID.dPriv, companyName: SECRET_COMPANY, accountId: `${P}acct_priv`, contact: { id: ID.dPriv, companyName: SECRET_COMPANY },
      });
      expect(ids(await send('get', `deals?search=${SECRET_COMPANY}`, ID.owner, ''))).toEqual([deal.id]);
      expect(ids(await send('get', `deals?accountId=${P}acct_priv`, ID.owner, ''))).toEqual([deal.id]);
    } finally {
      await dropContacts([ID.dPriv]);
    }
  });

  it("V1-89 ST-1 SEC-V89-5 (D-37): listDeals filtered by a contact the bound member cannot open lists nothing, exactly as for an unknown id (the path KEY's deals_list takes); its own contact and the OWNER's list are unchanged", async () => {
    const listFor = (userId: string, contactId: string) =>
      runWithTenant(ID.bizA, userId, () => dealsService.listDeals({ businessId: ID.bizA, contactId }));
    const hidden = await listFor(ID.staffOwned, ID.cPriv);
    const absent = await listFor(ID.staffOwned, ABSENT);
    expect(hidden).toEqual({ deals: [], total: 0, skip: 0, take: 50 });
    expect(hidden).toEqual(absent);
    expect(JSON.stringify(hidden)).not.toContain(SECRET.deal);

    expect((await listFor(ID.staffOwned, ID.cTeam)).deals.map((d: { id: string }) => d.id)).toEqual([`${P}deal_cTeam`]);
    const owner = await listFor(ID.owner, ID.cPriv);
    expect(owner.deals.map((d: { title: string }) => d.title), 'the OWNER, unchanged').toEqual([SECRET.deal]);
    expect(owner.total).toBe(1);
  });

  // W9-CRM-RESIDUALS (was one it.todo: "GET deals/:dealId (CrmDealsService.getDeal), the deal velocity
  // report and an account's deals still join the contact of a deal whose contact the member cannot
  // open"): each read now holds the rule GET deals applies (V1-89, D-37).
  it("residual (W9-CRM-RESIDUALS, was it.todo): GET deals/:dealId serves a deal whose contact the member cannot open without that contact (contact, contactId, companyName and accountId null, as GET deals lists it; D-37); a contact it may open stays joined; the OWNER's deal is unchanged", async () => {
    const dealPath = (contactTail: string) => `deals/${P}deal_${contactTail}`;
    for (const actor of [ID.staffOwned, ID.admin]) {
      resetRecorders();
      const res = await send('get', dealPath('cPriv'), actor, '');
      expect(res.status, `${actor}: ${res.text.slice(0, 200)}`).toBe(200);
      expect(svcCalls(), actor).toEqual(['deals.getDeal']);
      expect(res.body.id, `${actor}: the deal itself is served`).toBe(`${P}deal_cPriv`);
      expect({ contactId: res.body.contactId, contact: res.body.contact, companyName: res.body.companyName, accountId: res.body.accountId }, actor).toEqual({
        contactId: null, contact: null, companyName: null, accountId: null,
      });
      expect(res.text, `${actor}: the hidden contact's id or name`).not.toContain(ID.cPriv);
      expect(res.text, `${actor}: the hidden contact's email`).not.toContain(`${P}cpriv@contacts.test`);

      const team = await send('get', dealPath('cTeam'), actor, '');
      expect(team.status, actor).toBe(200);
      expect(team.body.contactId, actor).toBe(ID.cTeam);
      expect(team.body.contact, actor).toMatchObject({ id: ID.cTeam, firstName: ID.cTeam });
    }

    const owner = await send('get', dealPath('cPriv'), ID.owner, '');
    expect(owner.status).toBe(200);
    expect(owner.body.contactId).toBe(ID.cPriv);
    expect(owner.body.contact).toMatchObject({ id: ID.cPriv, firstName: ID.cPriv });
  });

  it("residual (W9-CRM-RESIDUALS, was it.todo): GET deals/intelligence/velocity lists an outlier deal whose contact the member cannot open without that contact (contact null; D-37); a contact it may open stays named; the OWNER's report is unchanged", async () => {
    const stageId = `${P}vstage`;
    const now = Date.now();
    const dealId = (tail: string) => `${P}vdeal_${tail}`;
    await db.dealStage.create({ data: { id: stageId, businessId: ID.bizA, name: 'V84C velocity stage', slug: `${P}velocity`, position: 9 } });
    try {
      // Two deals 100 days in the stage and four fresh ones: the stage averages about 33 days, so
      // the outlier threshold is 50 days and both old deals are outliers.
      const seed = (tail: string, contactId: string, daysAgo: number) =>
        db.deal.create({
          data: {
            id: dealId(tail), businessId: ID.bizA, contactId, title: `V84C velocity ${tail}`, stageId, value: 10,
            lastStageChangedAt: new Date(now - daysAgo * 86_400_000),
          },
        });
      await seed('priv', ID.cPriv, 100);
      await seed('team', ID.cTeam, 100);
      for (let i = 0; i < 4; i += 1) await seed(`fresh${i}`, ID.cTeam, 0);
      const outlierOf = (body: any, tail: string) => body.outliers.find((o: { dealId: string }) => o.dealId === dealId(tail));

      for (const actor of [ID.staffOwned, ID.admin]) {
        resetRecorders();
        const res = await send('get', 'deals/intelligence/velocity', actor, '');
        expect(res.status, `${actor}: ${res.text.slice(0, 200)}`).toBe(200);
        expect(svcCalls(), actor).toEqual(['velocity.getReport']);
        const hidden = outlierOf(res.body, 'priv');
        expect(hidden, `${actor}: the hidden contact's deal is still an outlier`).toBeDefined();
        expect(hidden.contact, actor).toBeNull();
        expect(res.text, `${actor}: the hidden contact's id or name`).not.toContain(ID.cPriv);
        expect(outlierOf(res.body, 'team')?.contact, actor).toMatchObject({ id: ID.cTeam, displayName: ID.cTeam });
      }

      const owner = await send('get', 'deals/intelligence/velocity', ID.owner, '');
      expect(owner.status).toBe(200);
      expect(outlierOf(owner.body, 'priv')?.contact).toMatchObject({ id: ID.cPriv, displayName: ID.cPriv });
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM deals WHERE stage_id = '${stageId}'`);
      await db.$executeRawUnsafe(`DELETE FROM deal_stages WHERE id = '${stageId}'`);
    }
  });

  it("residual (W9-CRM-RESIDUALS, was it.todo): an account's deals (GET accounts/:accountId and its insight) leave out a deal whose contact the member cannot open, as GET deals?accountId= does (SEC-V89-4, D-37); a contact it may open stays joined; the OWNER's account is unchanged", async () => {
    const account = `${P}acct_team`;
    const privDeal = `${P}adeal_priv`;
    const teamDeal = `${P}adeal_team`;
    for (const [id, contactId] of [[privDeal, ID.cPriv], [teamDeal, ID.cTeam]] as const) {
      await db.deal.create({ data: { id, businessId: ID.bizA, contactId, accountId: account, title: `V84C account deal ${id.slice(-4)}`, stageId: ID.stage, value: 100 } });
    }
    try {
      const ids = (deals: Array<{ id: string }>) => deals.map((d) => d.id).sort();
      for (const actor of [ID.staffOwned, ID.admin]) {
        resetRecorders();
        const res = await send('get', `accounts/${account}`, actor, '');
        expect(res.status, `${actor}: ${res.text.slice(0, 200)}`).toBe(200);
        expect(svcCalls(), actor).toEqual(['accounts.getAccountDetail']);
        expect(ids(res.body.deals), actor).toEqual([teamDeal]);
        expect(res.body.deals[0].contact, actor).toMatchObject({ id: ID.cTeam, firstName: ID.cTeam });
        expect(res.body.rollup.dealCount, actor).toBe(1);
        expect(res.text, `${actor}: the hidden contact's id or name`).not.toContain(ID.cPriv);

        const list = await send('get', `deals?accountId=${account}`, actor, '');
        expect(ids(list.body.deals), `${actor}: GET deals?accountId= agrees`).toEqual(ids(res.body.deals));

        const insight = await send('get', `accounts/${account}/insight`, actor, '');
        expect(insight.status, actor).toBe(200);
        expect(insight.body.dealCount, actor).toBe(1);
      }

      const owner = await send('get', `accounts/${account}`, ID.owner, '');
      expect(owner.status).toBe(200);
      expect(ids(owner.body.deals)).toEqual([privDeal, teamDeal].sort());
      expect(owner.body.deals.find((d: { id: string }) => d.id === privDeal).contact).toMatchObject({ id: ID.cPriv });
      expect(owner.body.rollup.dealCount).toBe(2);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM deals WHERE id IN ('${privDeal}', '${teamDeal}')`);
    }
  });
});

describe('ST-2 crm-ai: a contact id in the body and the business scans hold the record-visibility rule', () => {
  const CONTACT_ACTIONS: Array<{ action: string; params: Record<string, unknown> }> = [
    { action: 'add_note', params: { body: 'v84c planted note' } },
    { action: 'add_task', params: { title: 'v84c planted task' } },
    { action: 'change_status', params: { status: 'LOST' } },
    { action: 'toggle_favorite', params: {} },
    { action: 'log_communication', params: { channel: 'call', notes: 'v84c planted call' } },
    { action: 'add_to_list', params: { listName: 'v84c' } },
    { action: 'remove_from_list', params: { listName: 'v84c' } },
    { action: 'enroll_sequence', params: { sequenceName: 'v84c' } },
    { action: 'unenroll_sequence', params: { sequenceName: 'v84c' } },
  ];
  for (const { action, params } of CONTACT_ACTIONS) {
    it(`POST ai-execute ${action}: STAFF_OWNED on the owner's PRIVATE contact answers 404 like an unknown id; nothing is written`, async () => {
      const before = await snapshot();
      const stateBefore = await contactState(ID.cPriv);
      const eventsBefore = await rowCount('contact_events', ID.cPriv);
      resetRecorders();
      const res = await send('post', 'ai-execute', ID.staffOwned, '', { action, contactId: ID.cPriv, params });
      const calls = svcCalls();
      const absent = await send('post', 'ai-execute', ID.staffOwned, '', { action, contactId: ABSENT, params });

      expect(res.status, action).toBe(404);
      expect(res.body, action).toEqual(NOT_FOUND_BODY);
      expect(res.text, `${action}: body vs an unknown id`).toBe(absent.text);
      expect(calls, `${action}: services reached`).toEqual([]);
      expect(await contactState(ID.cPriv), action).toEqual(stateBefore);
      expect(await rowCount('contact_events', ID.cPriv), action).toBe(eventsBefore);
      expect(await snapshot(), action).toEqual(before);
    });
  }

  it('POST ai-execute controls: STAFF_OWNED adds a note to its TEAM contact and the OWNER to its PRIVATE contact (201, success, the note is written)', async () => {
    for (const { actor, contactId } of [{ actor: ID.staffOwned, contactId: ID.cTeam }, { actor: ID.owner, contactId: ID.cPriv }]) {
      const notesBefore = await rowCount('contact_notes', contactId);
      resetRecorders();
      const res = await send('post', 'ai-execute', actor, '', { action: 'add_note', contactId, params: { body: 'v84c permitted note' } });
      expect({ status: res.status, success: res.body?.success }, `${actor} ${contactId}`).toEqual({ status: 201, success: true });
      expect(svcCalls()).toEqual(['crmAi.executeAiCommand']);
      expect(await rowCount('contact_notes', contactId)).toBe(notesBefore + 1);
    }
  });

  it("V1-89 (d): POST ai-execute bulk_status_change changes only the matching contacts the member may open and edit (ADMIN, STAFF_OWNED, crm_edit 'owned'); a hidden match answers like no match; crm_edit 'none' is refused 403; the OWNER still reaches the PRIVATE one", async () => {
    const bulk = (actor: string, fromStatus: string, toStatus: string, filter = BULK_TAG) =>
      send('post', 'ai-execute', actor, '', { action: 'bulk_status_change', params: { fromStatus, toStatus, filter } });
    const status = async (contactId: string) => (await contactState(contactId)).status;
    const privBefore = await contactState(ID.bPriv);
    const twinsBefore = [await contactState(ID.tPriv), await contactState(ID.tTeam)];

    // ADMIN: crm admin by role, opens TEAM rows but not the owner's PRIVATE one.
    resetRecorders();
    const admin = await bulk(ID.admin, 'LEAD', 'PROSPECT');
    expect({ status: admin.status, body: admin.body }).toEqual({
      status: 201, body: { success: true, message: 'Changed 2 contacts from LEAD to PROSPECT', data: { count: 2 } },
    });
    expect(svcCalls()).toEqual(['crmAi.executeAiCommand']);
    expect([await status(ID.bTeam), await status(ID.bStaff)]).toEqual(['PROSPECT', 'PROSPECT']);
    expect(await contactState(ID.bPriv), 'the PRIVATE match is untouched').toEqual(privBefore);

    // Only the hidden PRIVATE contact still matches LEAD: the answer is a no-match answer.
    const hiddenOnly = await bulk(ID.admin, 'LEAD', 'LOST');
    const noMatch = await bulk(ID.admin, 'LEAD', 'LOST', 'v84c-no-contact-has-this-tag');
    expect({ status: hiddenOnly.status, body: hiddenOnly.body }).toEqual({
      status: 201, body: { success: true, message: 'Changed 0 contacts from LEAD to LOST', data: { count: 0 } },
    });
    expect(hiddenOnly.text, 'body vs no match').toBe(noMatch.text);
    expect(await contactState(ID.bPriv)).toEqual(privBefore);

    // STAFF_OWNED (crm_view 'owned'): its own contact only.
    const staff = await bulk(ID.staffOwned, 'PROSPECT', 'CLIENT');
    expect({ status: staff.status, count: staff.body?.data?.count }).toEqual({ status: 201, count: 1 });
    expect([await status(ID.bTeam), await status(ID.bStaff)]).toEqual(['PROSPECT', 'CLIENT']);

    // crm_edit 'owned' opens the TEAM rows but may edit only its own; crm_edit 'none' may edit none.
    await ensureEditScopeMembers();
    const editOwned = await bulk(ID.editOwned, 'PROSPECT', 'LOST');
    expect({ status: editOwned.status, count: editOwned.body?.data?.count }).toEqual({ status: 201, count: 0 });
    expect(await status(ID.bTeam)).toBe('PROSPECT');
    resetRecorders();
    const editNone = await bulk(ID.editNone, 'PROSPECT', 'LOST');
    expect({ status: editNone.status, message: editNone.body?.message }).toEqual({
      status: 403, message: 'You do not have permission to edit contacts',
    });
    expect(svcCalls()).toEqual([]);
    expect(await status(ID.bTeam)).toBe('PROSPECT');

    // The OWNER reaches every matching contact, the PRIVATE one included.
    const owner = await bulk(ID.owner, 'LEAD', 'LOST');
    expect({ status: owner.status, count: owner.body?.data?.count }).toEqual({ status: 201, count: 1 });
    expect(await status(ID.bPriv)).toBe('LOST');
    expect([await contactState(ID.tPriv), await contactState(ID.tTeam)], 'the twins are untouched').toEqual(twinsBefore);
  });

  it("V1-89 (d) SEC-V89-1: POST ai-execute change_status and toggle_favorite hold PATCH contacts/:contactId's edit scope: crm_edit 'none' is refused 403 on any contact, crm_edit 'owned' 403 on a TEAM contact it does not own, 404 on a hidden one and 201 on its own; a refused contact is unchanged", async () => {
    await ensureEditScopeMembers();
    await seedContact(ID.eOwn, { visibility: 'TEAM', ownerId: ID.editOwned });
    try {
      const exec = (actor: string, action: string, contactId: string, params: Record<string, unknown>) =>
        send('post', 'ai-execute', actor, '', { action, contactId, params });
      for (const { action, params } of [{ action: 'change_status', params: { status: 'CLIENT' } }, { action: 'toggle_favorite', params: {} }]) {
        // crm_edit 'none': refused before the contact is looked up, as PATCH refuses it (a TEAM contact it may open, a hidden one, an unknown id).
        for (const contactId of [ID.hTeamOwner, ID.cPriv, ABSENT]) {
          const before = await contactState(contactId);
          resetRecorders();
          const res = await exec(ID.editNone, action, contactId, params);
          expect({ status: res.status, message: res.body?.message }, `${action} crm_edit none ${contactId}`).toEqual({
            status: 403, message: 'You do not have permission to edit contacts',
          });
          expect(svcCalls(), `${action} crm_edit none ${contactId}`).toEqual([]);
          expect(await contactState(contactId), `${action} crm_edit none ${contactId}`).toEqual(before);
        }

        // crm_edit 'owned': the owner's TEAM contact it may open but does not own is 403, as PATCH answers.
        const teamBefore = await contactState(ID.hTeamOwner);
        resetRecorders();
        const notOwned = await exec(ID.editOwned, action, ID.hTeamOwner, params);
        expect({ status: notOwned.status, message: notOwned.body?.message }, `${action} crm_edit owned, not its own`).toEqual({
          status: 403, message: 'You can only edit contacts you own',
        });
        expect(svcCalls(), action).toEqual([]);
        expect(await contactState(ID.hTeamOwner), action).toEqual(teamBefore);
        // A contact it cannot open stays a 404 like an unknown id.
        const hidden = await exec(ID.editOwned, action, ID.cPriv, params);
        const absent = await exec(ID.editOwned, action, ABSENT, params);
        expect(hidden.status, action).toBe(404);
        expect(hidden.text, `${action}: body vs an unknown id`).toBe(absent.text);

        // Its own contact.
        resetRecorders();
        const own = await exec(ID.editOwned, action, ID.eOwn, params);
        expect({ status: own.status, success: own.body?.success }, `${action} crm_edit owned, its own`).toEqual({ status: 201, success: true });
        expect(svcCalls()).toEqual(['crmAi.executeAiCommand']);
      }
      expect(await contactState(ID.eOwn)).toMatchObject({ status: 'CLIENT', tags: ['favorite'] });

      // The OWNER is unchanged.
      const owner = await exec(ID.owner, 'change_status', ID.eOwn, { status: 'PROSPECT' });
      expect({ status: owner.status, success: owner.body?.success }).toEqual({ status: 201, success: true });
      expect((await contactState(ID.eOwn)).status).toBe('PROSPECT');

      // A note is a child row of the contact, not an edit of it: add_note keeps the rule of POST
      // contacts/:contactId/notes (record visibility), which admits a crm_edit 'none' member.
      const notesBefore = await rowCount('contact_notes', ID.hTeamOwner);
      const note = await exec(ID.editNone, 'add_note', ID.hTeamOwner, { body: 'v84c note by crm_edit none' });
      expect({ status: note.status, success: note.body?.success }).toEqual({ status: 201, success: true });
      expect(await rowCount('contact_notes', ID.hTeamOwner)).toBe(notesBefore + 1);
    } finally {
      await dropContacts([ID.eOwn]);
      await db.$executeRawUnsafe(`DELETE FROM contact_notes WHERE contact_id = '${ID.hTeamOwner}' AND body = 'v84c note by crm_edit none'`);
    }
  });

  it("V1-89 (d) SEC-V89-2: POST ai-execute bulk_status_change writes through CrmService.bulkUpdateContacts as PATCH contacts/bulk does: each changed contact gets a 'bulk_updated' audit entry and a bulk.updated event naming the member (USER), and the CRM caches are invalidated; a hidden match gets neither", async () => {
    await seedContact(ID.aTeam, { visibility: 'TEAM', ownerId: ID.owner, tags: [AUDIT_TAG] });
    await seedContact(ID.aPriv, { visibility: 'PRIVATE', ownerId: ID.owner, tags: [AUDIT_TAG] });
    try {
      cacheInvalidations.length = 0;
      const res = await send('post', 'ai-execute', ID.admin, '', { action: 'bulk_status_change', params: { fromStatus: 'LEAD', toStatus: 'PROSPECT', filter: AUDIT_TAG } });
      expect({ status: res.status, body: res.body }).toEqual({
        status: 201, body: { success: true, message: 'Changed 1 contacts from LEAD to PROSPECT', data: { count: 1 } },
      });
      expect([(await contactState(ID.aTeam)).status, (await contactState(ID.aPriv)).status]).toEqual(['PROSPECT', 'LEAD']);

      const events = await q(`SELECT contact_id, type, actor_type, actor_id FROM contact_events WHERE contact_id IN ('${ID.aTeam}', '${ID.aPriv}')`);
      expect(events).toEqual([{ contact_id: ID.aTeam, type: 'bulk.updated', actor_type: 'USER', actor_id: ID.admin }]);
      // The audit entry is written once the write has committed (fire-and-forget, as CrmService writes it).
      let audit: Array<{ contact_id: string; action: string; actor: unknown; after: unknown }> = [];
      for (let i = 0; i < 40 && audit.length === 0; i++) {
        audit = await q(`SELECT contact_id, action, actor, after FROM contact_audit_entries WHERE contact_id IN ('${ID.aTeam}', '${ID.aPriv}')`);
        if (audit.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(audit).toEqual([{ contact_id: ID.aTeam, action: 'bulk_updated', actor: { type: 'USER', id: ID.admin }, after: { status: 'PROSPECT' } }]);
      expect(cacheInvalidations).toEqual(expect.arrayContaining([`stats:${ID.bizA}`, `flow:${ID.bizA}`]));
    } finally {
      await dropContacts([ID.aTeam, ID.aPriv]);
    }
  });

  it("V1-89 (d) SEC-V89-3: POST ai-execute bulk_status_change writes a toStatus from the contact status vocabulary only and takes fromStatus as one status and filter as one tag; anything else (an unknown status, an object as a Prisma operator) is refused and nothing is written", async () => {
    await seedContact(ID.vLead, { visibility: 'TEAM', ownerId: ID.owner, tags: [VALIDATE_TAG] });
    await seedContact(ID.vClient, { visibility: 'TEAM', ownerId: ID.owner, status: 'CLIENT', tags: [VALIDATE_TAG] });
    try {
      const bulk = (actor: string, params: Record<string, unknown>) => send('post', 'ai-execute', actor, '', { action: 'bulk_status_change', params });
      const BOGUS = 'NOT_A_REAL_STATUS_v84c';
      const refusals: Array<{ params: Record<string, unknown>; message: string }> = [
        { params: { fromStatus: 'LEAD', toStatus: BOGUS, filter: VALIDATE_TAG }, message: 'toStatus must be one of LEAD, PROSPECT, CLIENT, LOST' },
        { params: { fromStatus: 'LEAD', toStatus: { set: 'LOST' }, filter: VALIDATE_TAG }, message: 'toStatus must be one of LEAD, PROSPECT, CLIENT, LOST' },
        { params: { fromStatus: { not: '__nope__' }, toStatus: 'LOST', filter: VALIDATE_TAG }, message: 'fromStatus must be one status' },
        { params: { fromStatus: ['LEAD', 'CLIENT'], toStatus: 'LOST', filter: VALIDATE_TAG }, message: 'fromStatus must be one status' },
        { params: { fromStatus: 'LEAD', toStatus: 'LOST', filter: { isEmpty: false } }, message: 'filter must be one tag' },
      ];
      for (const actor of [ID.owner, ID.admin]) {
        for (const { params, message } of refusals) {
          const before = [await contactState(ID.vLead), await contactState(ID.vClient)];
          const res = await bulk(actor, params);
          expect({ status: res.status, body: res.body }, `${actor} ${JSON.stringify(params)}`).toEqual({
            status: 201, body: { success: false, message, data: null },
          });
          expect([await contactState(ID.vLead), await contactState(ID.vClient)], `${actor} ${JSON.stringify(params)}`).toEqual(before);
        }
      }
      expect(Number((await q(`SELECT count(*)::int AS n FROM contacts WHERE status = '${BOGUS}'`))[0].n)).toBe(0);

      // Control: a valid change still changes the matching contact only.
      const ok = await bulk(ID.owner, { fromStatus: 'LEAD', toStatus: 'PROSPECT', filter: VALIDATE_TAG });
      expect({ status: ok.status, count: ok.body?.data?.count }).toEqual({ status: 201, count: 1 });
      expect([(await contactState(ID.vLead)).status, (await contactState(ID.vClient)).status]).toEqual(['PROSPECT', 'CLIENT']);
    } finally {
      await dropContacts([ID.vLead, ID.vClient]);
    }
  });

  it("V1-89 ST-2: POST ai-analyze naming a contact the member cannot open answers 404 like an unknown id, before the AI is called; its own contact answers 201 with a prompt about the contacts it may open only", async () => {
    const body = (contactIds: string[]) => ({ prompt: 'v84c analyse these contacts', contactIds });
    resetRecorders();
    const hidden = await send('post', 'ai-analyze', ID.staffOwned, '', body([ID.cPriv]));
    const mixed = await send('post', 'ai-analyze', ID.staffOwned, '', body([ID.cTeam, ID.cPriv]));
    const calls = svcCalls();
    const ai = aiCalls.length;
    const absent = await send('post', 'ai-analyze', ID.staffOwned, '', body([ABSENT]));

    expect({ hidden: hidden.status, mixed: mixed.status }).toEqual({ hidden: 404, mixed: 404 });
    expect(hidden.body).toEqual(NOT_FOUND_BODY);
    expect(hidden.text, 'body vs an unknown id').toBe(absent.text);
    expect(mixed.text, 'body vs an unknown id').toBe(absent.text);
    expect({ services: calls, ai }).toEqual({ services: [], ai: 0 });

    resetRecorders();
    const own = await send('post', 'ai-analyze', ID.staffOwned, '', body([ID.cTeam]));
    expect(own.status, own.text.slice(0, 200)).toBe(201);
    expect(svcCalls()).toEqual(['crmAi.analyzeContacts']);
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].prompt).toContain(ID.cTeam);
    for (const id of HIDDEN_FROM_STAFF_OWNED) expect(aiCalls[0].prompt).not.toContain(id);
    for (const secret of Object.values(SECRET)) expect(aiCalls[0].prompt).not.toContain(secret);

    resetRecorders();
    const owner = await send('post', 'ai-analyze', ID.owner, '', body([ID.cPriv]));
    expect(owner.status, 'the OWNER, unchanged').toBe(201);
    expect(aiCalls[0].prompt).toContain(ID.cPriv);
  });

  it("POST ai-analyze/execute: STAFF_OWNED's task on the owner's PRIVATE contact is not created and counts as failed, like one on an unknown id", async () => {
    const task = (contactId: string) => ({ contactId, title: 'v84c ai task', dueDate: new Date().toISOString(), priority: 'LOW' });
    const privBefore = await rowCount('contact_tasks', ID.cPriv);
    const teamBefore = await rowCount('contact_tasks', ID.cTeam);

    const mixed = await send('post', 'ai-analyze/execute', ID.staffOwned, '', { tasks: [task(ID.cPriv), task(ID.cTeam)] });
    expect({ status: mixed.status, body: mixed.body }).toEqual({ status: 201, body: { created: 1, failed: 1 } });

    resetRecorders();
    const hidden = await send('post', 'ai-analyze/execute', ID.staffOwned, '', { tasks: [task(ID.cPriv)] });
    const calls = svcCalls();
    const absent = await send('post', 'ai-analyze/execute', ID.staffOwned, '', { tasks: [task(ABSENT)] });
    expect({ status: hidden.status, body: hidden.body }).toEqual({ status: 201, body: { created: 0, failed: 1 } });
    expect(hidden.text, 'body vs an unknown id').toBe(absent.text);
    expect(calls, 'services reached').toEqual([]);

    expect(await rowCount('contact_tasks', ID.cPriv)).toBe(privBefore);
    expect(await rowCount('contact_tasks', ID.cTeam)).toBe(teamBefore + 1);

    const owner = await send('post', 'ai-analyze/execute', ID.owner, '', { tasks: [task(ID.cPriv), task(ABSENT)] });
    expect({ status: owner.status, body: owner.body }, 'the OWNER, unchanged').toEqual({ status: 201, body: { created: 1, failed: 1 } });
    expect(await rowCount('contact_tasks', ID.cPriv)).toBe(privBefore + 1);
  });

  type Scan = { name: string; method: Method; path: string; ok: number; body?: Record<string, unknown>; ids: (body: any) => string[] };
  const SCANS: Scan[] = [
    { name: 'GET ai-data-quality', method: 'get', path: 'ai-data-quality', ok: 200, ids: (b) => b.topIssues.map((i: { contactId: string }) => i.contactId) },
    {
      name: 'GET ai-duplicates', method: 'get', path: 'ai-duplicates', ok: 200,
      ids: (b) => b.duplicateClusters.flatMap((c: { contacts: Array<{ id: string }> }) => c.contacts.map((x) => x.id)),
    },
    { name: 'GET ai-reengagement', method: 'get', path: 'ai-reengagement', ok: 200, ids: (b) => b.suggestions.map((s: { contactId: string }) => s.contactId) },
    {
      name: 'GET ai-revenue-opportunities', method: 'get', path: 'ai-revenue-opportunities', ok: 200,
      ids: (b) => b.opportunities.map((o: { contactId: string }) => o.contactId),
    },
    { name: 'POST ai-search', method: 'post', path: 'ai-search', ok: 201, body: { query: 'v84c every contact' }, ids: (b) => b.contacts.map((c: { id: string }) => c.id) },
  ];
  for (const scan of SCANS) {
    it(`${scan.name}: STAFF_OWNED's answer names only contacts it may open; the OWNER's still names the PRIVATE twin`, async () => {
      const staff = await send(scan.method, scan.path, ID.staffOwned, '', scan.body);
      expect(staff.status, `${scan.name}: ${staff.text.slice(0, 200)}`).toBe(scan.ok);
      const staffIds = scan.ids(staff.body);
      for (const id of staffIds) expect(await opensFor(ID.staffOwned, id), `${scan.name} lists ${id}`).toBe(true);
      for (const hidden of [ID.cPriv, ID.tPriv, ID.hTeamOwner]) expect(staff.text, scan.name).not.toContain(hidden);
      for (const secret of Object.values(SECRET)) expect(staff.text, scan.name).not.toContain(secret);
      if (scan.path === 'ai-duplicates') {
        // The twins' name cluster keeps one contact STAFF_OWNED may open: it is no cluster.
        expect(staffIds, scan.name).not.toContain(ID.tTeam);
      } else {
        expect(staffIds, scan.name).toContain(ID.tTeam);
      }

      const owner = await send(scan.method, scan.path, ID.owner, '', scan.body);
      expect(owner.status, scan.name).toBe(scan.ok);
      const ownerIds = scan.ids(owner.body);
      expect(ownerIds, `${scan.name}: the OWNER, unchanged`).toEqual(expect.arrayContaining([ID.tPriv, ID.tTeam]));
    });
  }

  const PROMPTS: Array<{ name: string; method: Method; path: string; ok: number; feature: string; body?: Record<string, unknown> }> = [
    { name: 'POST ai-command', method: 'post', path: 'ai-command', ok: 201, feature: 'crm_command', body: { command: 'v84c who should I call today' } },
    { name: 'POST ai-analyze', method: 'post', path: 'ai-analyze', ok: 201, feature: 'crm_analysis', body: { prompt: 'v84c who should I call today' } },
    { name: 'GET ai-churn-risk', method: 'get', path: 'ai-churn-risk', ok: 200, feature: 'churn_detection' },
  ];
  for (const route of PROMPTS) {
    it(`V1-89 ST-2: ${route.name} builds the AI prompt from the contacts STAFF_OWNED may open only; the OWNER's prompt still names the PRIVATE twin`, async () => {
      resetRecorders();
      const staff = await send(route.method, route.path, ID.staffOwned, '', route.body);
      expect(staff.status, `${route.name}: ${staff.text.slice(0, 200)}`).toBe(route.ok);
      expect(aiCalls.map((c) => c.feature), route.name).toEqual([route.feature]);
      const prompt = aiCalls[0].prompt;
      expect(prompt, route.name).toContain(ID.tTeam);
      for (const id of HIDDEN_FROM_STAFF_OWNED) expect(prompt, `${route.name} names ${id}`).not.toContain(id);
      for (const secret of Object.values(SECRET)) expect(prompt, route.name).not.toContain(secret);

      resetRecorders();
      const owner = await send(route.method, route.path, ID.owner, '', route.body);
      expect(owner.status, route.name).toBe(route.ok);
      expect(aiCalls[0].prompt, `${route.name}: the OWNER, unchanged`).toContain(ID.tPriv);
    });
  }

  it("V1-89 ST-2: the scans' aggregate counts count only the contacts STAFF_OWNED may open; the OWNER's count every live contact", async () => {
    const live: Array<{ id: string; status: string }> = await q(
      `SELECT id, status FROM contacts WHERE business_id = '${ID.bizA}' AND deleted_at IS NULL ORDER BY id`,
    );
    const visible: typeof live = [];
    for (const row of live) if (await opensFor(ID.staffOwned, row.id)) visible.push(row);
    expect(visible.length, 'fixture: some live contacts are hidden from STAFF_OWNED').toBeLessThan(live.length);
    const clientsOrProspects = (rows: typeof live) => rows.filter((r) => r.status === 'CLIENT' || r.status === 'PROSPECT').length;
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

    for (const [actor, rows] of [[ID.staffOwned, visible], [ID.owner, live]] as const) {
      const quality = await send('get', 'ai-data-quality', actor, '');
      expect(quality.status, actor).toBe(200);
      // Every seeded contact lacks an industry and a job title, so each one has issues.
      expect({ totalContacts: quality.body.totalContacts, contactsWithIssues: quality.body.contactsWithIssues }, `${actor} ai-data-quality`)
        .toEqual({ totalContacts: rows.length, contactsWithIssues: rows.length });
      const industry = quality.body.fieldBreakdown.find((f: { field: string }) => f.field === 'industry');
      expect(industry, `${actor} ai-data-quality industry`).toEqual({ field: 'industry', missing: rows.length, percentage: 100 });

      const duplicates = await send('get', 'ai-duplicates', actor, '');
      expect(duplicates.body.totalContacts, `${actor} ai-duplicates`).toBe(rows.length);

      const revenue = await send('get', 'ai-revenue-opportunities', actor, '');
      expect(revenue.body.contactsAnalyzed, `${actor} ai-revenue-opportunities`).toBe(clientsOrProspects(rows));
      expect(revenue.body.totalEstimatedRevenue, `${actor} ai-revenue-opportunities`)
        .toBe(sum(revenue.body.opportunities.map((o: { estimatedValue: number }) => o.estimatedValue)));

      const stale = await send('get', 'ai-reengagement', actor, '');
      expect(stale.body.totalStale, `${actor} ai-reengagement`).toBe(stale.body.suggestions.length);
    }
  });

  // W9-CRM-RESIDUALS (was it.todo: "ai-command's prompt lists the business's sequences and contact
  // lists with their enrollment and member counts, which still count contacts the member cannot open").
  it("residual (W9-CRM-RESIDUALS, was it.todo): ai-command's prompt counts a sequence's enrollments and a contact list's members over the contacts the member may open only (D-37); the OWNER's prompt counts every one", async () => {
    const sequence = `${P}seq`;
    const list = `${P}list`;
    await db.crmSequence.create({ data: { id: sequence, businessId: ID.bizA, name: 'V84C sequence', steps: [] } });
    await db.contactList.create({ data: { id: list, businessId: ID.bizA, name: 'V84C list' } });
    // Two contacts STAFF_OWNED may not open (the owner's PRIVATE ones) and one it may (its TEAM contact).
    for (const contactId of [ID.cPriv, ID.tPriv, ID.cTeam]) {
      await db.crmSequenceEnrollment.create({ data: { sequenceId: sequence, contactId } });
      await db.contactListMember.create({ data: { listId: list, contactId } });
    }
    try {
      expect(await opensFor(ID.staffOwned, ID.cTeam), 'fixture').toBe(true);
      expect(await opensFor(ID.staffOwned, ID.cPriv), 'fixture').toBe(false);
      expect(await opensFor(ID.staffOwned, ID.tPriv), 'fixture').toBe(false);
      const body = { command: 'v84c enroll my contact in the sequence' };

      resetRecorders();
      const staff = await send('post', 'ai-command', ID.staffOwned, '', body);
      expect(staff.status, staff.text.slice(0, 200)).toBe(201);
      expect(aiCalls.map((c) => c.feature)).toEqual(['crm_command']);
      expect(aiCalls[0].prompt).toContain(`V84C sequence (${sequence}) [active] - 1 enrolled`);
      expect(aiCalls[0].prompt).toContain(`V84C list (${list}) [MANUAL] - 1 members`);

      resetRecorders();
      const owner = await send('post', 'ai-command', ID.owner, '', body);
      expect(owner.status).toBe(201);
      expect(aiCalls[0].prompt, 'the OWNER, unchanged').toContain(`V84C sequence (${sequence}) [active] - 3 enrolled`);
      expect(aiCalls[0].prompt, 'the OWNER, unchanged').toContain(`V84C list (${list}) [MANUAL] - 3 members`);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM crm_sequence_enrollments WHERE sequence_id = '${sequence}'`);
      await db.$executeRawUnsafe(`DELETE FROM crm_sequences WHERE id = '${sequence}'`);
      await db.$executeRawUnsafe(`DELETE FROM contact_list_members WHERE list_id = '${list}'`);
      await db.$executeRawUnsafe(`DELETE FROM contact_lists WHERE id = '${list}'`);
    }
  });
});

describe('ST-3 / CR-1 POST forget holds the delete scope of DELETE contacts/:contactId', () => {
  const refusals = [
    { actor: ID.staffWrite, who: "{crm:'write'} (delete scope 'owned')", message: 'You can only delete contacts you own' },
    { actor: ID.staffDelNone, who: "{crm:'write', crm_delete:'none'}", message: 'You do not have permission to delete contacts' },
  ];
  for (const { actor, who, message } of refusals) {
    it(`${who} on the owner's TEAM contact it may open: 403 '${message}' as DELETE answers; the contact stays live, no forget request or audit entry`, async () => {
      expect(await opensFor(actor, ID.hTeamOwner), 'the member may open the contact').toBe(true);
      const before = await snapshot();
      const auditBefore = await auditActions(ID.hTeamOwner);
      resetRecorders();
      const res = await send('post', 'contacts/:c/forget', actor, ID.hTeamOwner, { reason: 'v84c refused forget' });

      expect({ status: res.status, message: res.body?.message }).toEqual({ status: 403, message });
      expect(svcCalls(), 'services reached').toEqual([]);
      expect((await contactRow(ID.hTeamOwner)).deleted_at).toBeNull();
      expect(await forgetRequest(ID.hTeamOwner)).toBeNull();
      expect(await auditActions(ID.hTeamOwner)).toEqual(auditBefore);
      expect(await snapshot()).toEqual(before);
    });
  }

  it('a contact the member cannot open answers 404 like an unknown id before the delete scope is read (no 403 for a hidden contact)', async () => {
    resetRecorders();
    const res = await send('post', 'contacts/:c/forget', ID.staffDelNone, ID.gPriv, { reason: 'v84c refused forget' });
    const absent = await send('post', 'contacts/:c/forget', ID.staffDelNone, ABSENT, { reason: 'v84c refused forget' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND_BODY);
    expect(res.text).toBe(absent.text);
    expect(svcCalls()).toEqual([]);
    expect((await contactRow(ID.gPriv)).deleted_at).toBeNull();
  });

  it("control: {crm:'write'} forgets a TEAM contact it owns (201, deletedAt set, request 'requested')", async () => {
    resetRecorders();
    const res = await send('post', 'contacts/:c/forget', ID.staffWrite, ID.hTeamWrite, { reason: 'v84c permitted forget' });
    expect(res.status, res.text.slice(0, 200)).toBe(201);
    expect(svcCalls()).toEqual(['privacy.requestForget']);
    expect((await contactRow(ID.hTeamWrite)).deleted_at).not.toBeNull();
    expect((await forgetRequest(ID.hTeamWrite)).status).toBe('requested');
  });
});

describe('ST-4 privacy-settings require CRM admin scope', () => {
  const grace = async () => Number((await q(`SELECT forget_grace_days AS g FROM businesses WHERE id = '${ID.bizA}'`))[0].g);

  it("a crm 'none' member and crm 'write' members are refused GET and PATCH (403); the grace window is unchanged", async () => {
    const before = await grace();
    for (const [actor, level] of [[ID.crmNone, 'none'], [ID.staffOwned, 'write'], [ID.staffWrite, 'write']] as const) {
      resetRecorders();
      const get = await send('get', 'privacy-settings', actor, '');
      const patch = await send('patch', 'privacy-settings', actor, '', { forgetGraceDays: 0 });
      const expected = { status: 403, message: `Insufficient permissions: crm requires admin access (you have ${level})` };
      expect({ status: get.status, message: get.body?.message }, `${actor} GET`).toEqual(expected);
      expect({ status: patch.status, message: patch.body?.message }, `${actor} PATCH`).toEqual(expected);
      expect(get.text, actor).not.toContain('recentForget');
      expect(svcCalls(), actor).toEqual([]);
    }
    expect(await grace()).toBe(before);
  });

  it('the OWNER and an ADMIN member read the settings with the recent forget requests; the OWNER saves them (200)', async () => {
    const before = await grace();
    for (const actor of [ID.owner, ID.admin]) {
      const res = await send('get', 'privacy-settings', actor, '');
      expect(res.status, actor).toBe(200);
      expect(res.body.forgetGraceDays, actor).toBe(before);
      expect(res.body.recentForget.length, actor).toBeGreaterThan(0);
    }
    const saved = await send('patch', 'privacy-settings', ID.owner, '', { forgetGraceDays: before });
    expect({ status: saved.status, grace: saved.body?.forgetGraceDays }).toEqual({ status: 200, grace: before });
  });
});
