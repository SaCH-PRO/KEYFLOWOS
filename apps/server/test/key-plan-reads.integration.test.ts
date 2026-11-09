/**
 * KEY-R3a-PLAN-READS (owner rulings D-74 and D-37, 2026-11-03): every KEY plan read route shows a
 * member only the plans, steps and step outputs they may see (REAL database).
 *
 * Trial-N repair round 2 recheck residuals this suite closes:
 *   - PLANREAD-TOOLLESS-OUTPUT: visiblePlanSteps showed any step whose dispatched tool is null with
 *     its output. KeyCortexPlannerService stores a step as module.action with no toolName, so the
 *     output of a KEY-cortex crm.list_contacts / search_contacts step (every contact, the OWNER's
 *     PRIVATE ones included) reached an ADMIN, and a crm-read STAFF proposer on their own plan, on
 *     GET ai/plans, GET ai/plans/:planId and the action queue.
 *   - KEY-CORTEX-PLAN-READ: GET /api/v1/cortex/plans/:planId returned any plan of the business,
 *     with steps, inputPayload and outputResult, to any member.
 *   - PLANREAD-ROWVIS-OUTPUT (ruled by D-74): the output of an OWNER-approved step that reached the
 *     OWNER's PRIVATE contact (crm_update_contact, or a note on it) was shown to the crm-read
 *     proposer. D-74: a plan step's output is filtered by the viewer's visibility when it is read;
 *     a row the viewer cannot see is withheld, even when the OWNER approved the step.
 *   - CRM-DUP-PREVIEW-HTTP: GET crm/.../duplicates/preview/:primaryId/:duplicateId answered the
 *     OWNER's PRIVATE contact to a crm-read STAFF (the dispatcher's crm_merge_preview answers
 *     preview:null). Closed on the working branch by FOLLOW3-D2's review repairs (CV-21); kept here
 *     as the packet's regression control.
 *   - QUEUE-PLAN-WINDOW (nit): the queue loaded the newest `limit` plans of the whole business and
 *     then kept the viewer's own, so a STAFF member's plans fell off when others had newer ones.
 *
 * The rule (one for every plan read route): a plan is shown to its proposer, the business OWNER, an
 * ADMIN or a SUPER_ADMIN, and answered as an unknown id to anyone else; a step is shown when the
 * viewer holds read on the module of the tool the executor dispatches for it, or, for a KEY-cortex
 * step with no tool, on its module.action's module (KEY_PLAN_MODULE_SCOPES); and its output is
 * withheld from a viewer whose CRM visibility is restricted (everyone but the OWNER and a
 * SUPER_ADMIN) when the step reads contacts (a registry contact read, or a cortex crm read), when
 * its input names a contact the viewer cannot open, and otherwise has every row (array element or
 * object) naming such a contact removed.
 *
 * WHAT IS REAL: PrismaService and the Prisma client at DATABASE_URL, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, AiController (GET ai/plans, GET ai/plans/:planId),
 * GraphActionsController (GET actions/.../queue), KeyCortexGoalsController (GET cortex/plans/:planId),
 * CrmController (GET duplicates/preview) with CrmDuplicateDetectionService, PlannerService,
 * KeyCortexPlannerService.getPlan, the users, businesses, memberships, contacts, ai_plans and
 * ai_plan_steps rows. Identity is a test middleware (x-test-user, seeded v87a_ users only), as in
 * contacts-visibility. Stand-ins: governance (no pending approvals), the execution history (empty),
 * and every collaborator of the four controllers no case reaches. No provider is reached.
 *
 * Every seeded row carries the `v87a_` prefix (or a v87a_ business id) and is hard-deleted by raw
 * SQL with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v87a_';

const ID = {
  biz: `${P}biz`,
  bizX: `${P}bizX`,
  owner: `${P}owner`, // OWNER of biz (role-default scopes)
  admin: `${P}admin`, // ADMIN of biz (role-default scopes; its visibility excludes another member's PRIVATE contact)
  staff: `${P}staff`, // STAFF of biz: crm read (crm_view all by default), operations write; no revenue
  win: `${P}win`, // STAFF of biz: crm read; one old plan (QUEUE-PLAN-WINDOW)
  other: `${P}other`, // STAFF of biz: crm read; newer plans
  outsider: `${P}outsider`, // OWNER of bizX only
  cTeam: `${P}cTeam`, // the OWNER's TEAM contact
  cPriv: `${P}cPriv`, // the OWNER's PRIVATE contact
  // PLANREAD-TOOLLESS-OUTPUT / KEY-CORTEX-PLAN-READ: the OWNER's KEY-cortex plan
  planCxOwner: `${P}planCxOwner`,
  sCxOwnerList: `${P}sCxOwnerList`, // crm.list_contacts, toolName null; output names cPriv and cTeam
  sCxOwnerBookings: `${P}sCxOwnerBookings`, // bookings.list_bookings, toolName null; rows naming cPriv and cTeam (D-74 row filter)
  // the STAFF member's own KEY-cortex plan (run by the OWNER)
  planCxStaff: `${P}planCxStaff`,
  sCxStaffSearch: `${P}sCxStaffSearch`, // crm.search_contacts, toolName null; output names cPriv and cTeam
  sCxStaffRev: `${P}sCxStaffRev`, // commerce.list_invoices, toolName null (the STAFF member holds no revenue)
  sCxStaffNote: `${P}sCxStaffNote`, // crm.add_note on cTeam, toolName null (visible, output shown)
  // PLANREAD-ROWVIS-OUTPUT: the STAFF member's plan the OWNER approved and the executor ran
  planRowVis: `${P}planRowVis`,
  sRvUpdate: `${P}sRvUpdate`, // crm_update_contact on cPriv; output is cPriv's row
  sRvNote: `${P}sRvNote`, // crm_add_note on cPriv; output names no contact, only the note
  sRvTeam: `${P}sRvTeam`, // crm_update_contact on cTeam (visible, output shown)
  // QUEUE-PLAN-WINDOW
  planWin: `${P}planWin`,
  planOther1: `${P}planOther1`,
  planOther2: `${P}planOther2`,
  planOther3: `${P}planOther3`,
  planOther4: `${P}planOther4`,
  // KEY-R3a review repairs
  // SEC-R3a-1: the STAFF member's KEY-cortex plan with steps under modules mapped to no module scope
  planCxUnmapped: `${P}planCxUnmapped`,
  sUnActivity: `${P}sUnActivity`, // activity.export_audit_log, toolName null (the business-wide audit log)
  sUnGenome: `${P}sUnGenome`, // genome.get_dna, toolName null (the business DNA)
  sUnOps: `${P}sUnOps`, // toolName null, labelled 'operations' (a canonical module the STAFF member writes): shown
  // SEC-R3a-2: the OWNER's plan whose step inputs name the OWNER's PRIVATE contact
  planOwnerInput: `${P}planOwnerInput`,
  sInUpdate: `${P}sInUpdate`, // crm_update_contact on cPriv, run: its input carries the new email and notes
  sInPending: `${P}sInPending`, // crm_add_note on cPriv, not yet run (no output)
  sInTeam: `${P}sInTeam`, // crm_update_contact on cTeam (input and output shown)
  // R3a-CR-1: the OWNER's KEY-cortex plan whose output holds rows as arrays
  planCxTuple: `${P}planCxTuple`,
  sTuple: `${P}sTuple`,
};

const PRIV_NOTES = 'v87a private contact notes';
const PRIV_NOTE_BODY = 'v87a private note body';
const PRIV_EMAIL = `${P}priv@test.local`;
const SECRET_INVOICE = `${P}inv_secret`;
const TEAM_NOTE = `${P}note_team`;
const AUDIT_SECRET = `${P}audit_secret_invoice_paid_9999`;
const DNA_SECRET = `${P}dna_secret_revenue`;
const OPS_OUTPUT = `${P}ops_summary`;
const NEW_PRIV_EMAIL = `${P}newpriv@test.local`;
const NEW_PRIV_NOTE = 'v87a secret note written into the private row';
const PENDING_PRIV_NOTE = 'v87a pending note on the private row';
const TUPLE_PRIV_NAME = 'V87a Tuple Private';
const TUPLE_PRIV_EMAIL = `${P}tuple_priv@secret.test`;
const TUPLE_TEAM_ROW = [`${P}cTeam`, 'V87a Tuple Team', `${P}tuple_team@test.local`];
const CELLS_PRIV_NAME = 'V87a Cells Private';

let db: any;
let aiApp: any;
let graphApp: any;
let cortexApp: any;
let crmApp: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_approval_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plan_steps WHERE plan_id IN (SELECT id FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Identity from the x-test-user header (seeded v87a_ users only), as contacts-visibility attaches it. */
function identity() {
  return async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  };
}

const PRIV_ROW = { id: ID.cPriv, firstName: 'V87a', lastName: 'Private', email: PRIV_EMAIL };
const TEAM_ROW = { id: ID.cTeam, firstName: 'V87a', lastName: 'Team', email: `${P}team@test.local` };
const BOOKING_ROWS = [
  { id: `${P}bk_priv`, contactId: ID.cPriv, title: 'v87a private booking' },
  { id: `${P}bk_text`, summary: `Rescheduled for contact ${ID.cPriv} (v87a)` },
  { id: `${P}bk_team`, contactId: ID.cTeam, title: 'v87a team booking' },
];

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  await cleanup();

  for (const id of [ID.owner, ID.admin, ID.staff, ID.win, ID.other, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V87a Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizX, name: 'V87a Biz X', ownerId: ID.outsider } });
  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes } });
  await m(ID.owner, ID.biz, 'OWNER');
  await m(ID.admin, ID.biz, 'ADMIN');
  await m(ID.staff, ID.biz, 'STAFF', { crm: 'read', operations: 'write' });
  await m(ID.win, ID.biz, 'STAFF', { crm: 'read', operations: 'write' });
  await m(ID.other, ID.biz, 'STAFF', { crm: 'read', operations: 'write' });
  await m(ID.outsider, ID.bizX, 'OWNER');

  await db.contact.create({ data: { ...TEAM_ROW, businessId: ID.biz, visibility: 'TEAM', ownerId: ID.owner } });
  await db.contact.create({ data: { ...PRIV_ROW, businessId: ID.biz, visibility: 'PRIVATE', ownerId: ID.owner, notesInternal: PRIV_NOTES } });

  const plan = (id: string, userId: string, status = 'completed', createdAt?: Date) =>
    db.aiPlan.create({ data: { id, businessId: ID.biz, userId, objective: `v87a ${id.slice(P.length)}`, status, ...(createdAt ? { createdAt } : {}) } });
  const step = (id: string, planId: string, order: number, s: { toolName: string | null; module?: string | null; action: string; inputPayload?: unknown; outputResult?: unknown }) =>
    db.aiPlanStep.create({
      data: {
        id, planId, order, toolName: s.toolName, module: s.module ?? null, action: s.action, description: 'v87a', riskTier: 1,
        inputPayload: s.inputPayload ?? {}, outputResult: s.outputResult ?? undefined, status: 'completed',
      },
    });

  // The finding's repro: an OWNER's KEY-cortex plan step, stored as module.action with no toolName.
  await plan(ID.planCxOwner, ID.owner);
  await step(ID.sCxOwnerList, ID.planCxOwner, 1, { toolName: null, module: 'crm', action: 'list_contacts', inputPayload: { limit: 50 }, outputResult: [PRIV_ROW, TEAM_ROW] });
  // Not a contact read: its rows name contacts, by id or inside a string, so D-74 filters them by row.
  await step(ID.sCxOwnerBookings, ID.planCxOwner, 2, {
    toolName: null, module: 'bookings', action: 'list_bookings', inputPayload: {},
    outputResult: { bookings: BOOKING_ROWS, byContact: { [ID.cPriv]: 1, [ID.cTeam]: 1 }, total: 3 },
  });

  // The STAFF member's own KEY-cortex plan, run by the OWNER (so its reads saw every contact).
  await plan(ID.planCxStaff, ID.staff);
  await step(ID.sCxStaffSearch, ID.planCxStaff, 1, { toolName: null, module: 'crm', action: 'search_contacts', inputPayload: { query: 'V87a' }, outputResult: { contacts: [PRIV_ROW, TEAM_ROW], count: 2 } });
  await step(ID.sCxStaffRev, ID.planCxStaff, 2, { toolName: null, module: 'commerce', action: 'list_invoices', inputPayload: {}, outputResult: { invoices: [{ id: SECRET_INVOICE, total: 999 }] } });
  await step(ID.sCxStaffNote, ID.planCxStaff, 3, { toolName: null, module: 'crm', action: 'add_note', inputPayload: { contactId: ID.cTeam, body: 'v87a team note' }, outputResult: { id: TEAM_NOTE, contactId: ID.cTeam } });

  // PLANREAD-ROWVIS-OUTPUT: the STAFF member's plan, approved by the OWNER and run with no principal.
  await plan(ID.planRowVis, ID.staff);
  await step(ID.sRvUpdate, ID.planRowVis, 1, { toolName: 'crm_update_contact', action: 'Update the contact', inputPayload: { contactId: ID.cPriv, jobTitle: 'v87a' }, outputResult: { ...PRIV_ROW, notes: PRIV_NOTES } });
  await step(ID.sRvNote, ID.planRowVis, 2, { toolName: 'crm_add_note', action: 'Add a note', inputPayload: { contactId: ID.cPriv, body: PRIV_NOTE_BODY }, outputResult: { noteId: `${P}note_priv`, body: PRIV_NOTE_BODY } });
  await step(ID.sRvTeam, ID.planRowVis, 3, { toolName: 'crm_update_contact', action: 'Update the contact', inputPayload: { contactId: ID.cTeam, jobTitle: 'v87a' }, outputResult: TEAM_ROW });

  // QUEUE-PLAN-WINDOW: one old plan of `win`, four newer plans of `other`.
  await plan(ID.planWin, ID.win, 'pending', new Date('2020-01-01T00:00:00.000Z'));
  for (const id of [ID.planOther1, ID.planOther2, ID.planOther3, ID.planOther4]) await plan(id, ID.other, 'pending');

  // SEC-R3a-1: the STAFF member's KEY-cortex plan (run by the OWNER) with steps under modules the
  // connector runs (KeyCortexConnectorService.adapterMap) but KEY_PLAN_MODULE_SCOPES maps to nothing.
  await plan(ID.planCxUnmapped, ID.staff);
  await step(ID.sUnActivity, ID.planCxUnmapped, 1, {
    toolName: null, module: 'activity', action: 'export_audit_log', inputPayload: {},
    outputResult: { data: [{ type: 'invoice', description: `Invoice paid ${AUDIT_SECRET}` }] },
  });
  await step(ID.sUnGenome, ID.planCxUnmapped, 2, { toolName: null, module: 'genome', action: 'get_dna', inputPayload: {}, outputResult: { revenue: 123456, marker: DNA_SECRET } });
  await step(ID.sUnOps, ID.planCxUnmapped, 3, { toolName: null, module: 'operations', action: 'Analyze the inbox backlog', inputPayload: {}, outputResult: { summary: OPS_OUTPUT } });

  // SEC-R3a-2: the OWNER's plan; its inputs carry what the OWNER writes into the PRIVATE row.
  await plan(ID.planOwnerInput, ID.owner);
  await step(ID.sInUpdate, ID.planOwnerInput, 1, {
    toolName: 'crm_update_contact', action: 'Update the contact',
    inputPayload: { contactId: ID.cPriv, email: NEW_PRIV_EMAIL, notes: NEW_PRIV_NOTE },
    outputResult: { ...PRIV_ROW, email: NEW_PRIV_EMAIL },
  });
  await step(ID.sInPending, ID.planOwnerInput, 2, { toolName: 'crm_add_note', action: 'Add a note', inputPayload: { contactId: ID.cPriv, body: PENDING_PRIV_NOTE } });
  await step(ID.sInTeam, ID.planOwnerInput, 3, { toolName: 'crm_update_contact', action: 'Update the contact', inputPayload: { contactId: ID.cTeam, jobTitle: 'v87a team title' }, outputResult: TEAM_ROW });

  // R3a-CR-1: rows held as arrays (a tuple per row; an array of cells inside a record).
  await plan(ID.planCxTuple, ID.owner);
  await step(ID.sTuple, ID.planCxTuple, 1, {
    toolName: null, module: 'bookings', action: 'list_bookings', inputPayload: {},
    outputResult: {
      columns: ['contactId', 'name', 'email'],
      rows: [[ID.cPriv, TUPLE_PRIV_NAME, TUPLE_PRIV_EMAIL], TUPLE_TEAM_ROW],
      records: [{ cells: [ID.cPriv, CELLS_PRIV_NAME] }, { cells: [ID.cTeam, 'V87a Cells Team'] }],
      total: 2,
    },
  });

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { PlannerService } = await import('../src/modules/ai/planner.service');
  const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');
  const { KeyCortexGoalsController } = await import('../src/modules/key-cortex/key-cortex-goals.controller');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
  const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');

  const plannerProvider = {
    provide: PlannerService,
    inject: [PrismaService],
    useFactory: (prisma: any) => new (PlannerService as any)(prisma, {}, {}, {}, {}, {}),
  };
  const guards = [PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard];

  // GET ai/plans, GET ai/plans/:planId.
  const aiRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [...guards, { provide: EventEmitter2, useValue: new EventEmitter2() }, plannerProvider],
  })
    .useMocker(() => ({}))
    .compile();
  aiApp = aiRef.createNestApplication();
  aiApp.use(identity());
  await aiApp.init();

  // GET actions/businesses/:businessId/queue.
  const graphRef = await Test.createTestingModule({
    controllers: [GraphActionsController],
    providers: [
      ...guards,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      plannerProvider,
      { provide: BusinessGraphService, useValue: {} },
      { provide: IntentParserService, useValue: {} },
      { provide: AiOversightService, useValue: { getPendingApprovals: async () => [] } },
      { provide: FlowOrchestratorService, useValue: {} },
      { provide: AiExecutionLogService, useValue: { getHistory: async () => ({ logs: [] }) } },
      { provide: WorkspaceRecommendationsService, useValue: {} },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  graphApp = graphRef.createNestApplication();
  graphApp.use(identity());
  await graphApp.init();

  // GET /api/v1/cortex/plans/:planId. Vitest's transform emits no design:paramtypes; this writes
  // what tsc emits for the controller's constructor (as key-cortex-actor-binding does).
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexGoalsController)) {
    Reflect.defineMetadata('design:paramtypes', [KeyCortexPlannerService, KeyCortexTriggerService, PrismaService], KeyCortexGoalsController);
  }
  const cortexRef = await Test.createTestingModule({
    controllers: [KeyCortexGoalsController],
    providers: [
      ...guards,
      { provide: KeyCortexPlannerService, inject: [PrismaService], useFactory: (prisma: any) => new (KeyCortexPlannerService as any)(prisma, {}, {}, {}) },
      { provide: KeyCortexTriggerService, useValue: {} },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  cortexApp = cortexRef.createNestApplication();
  cortexApp.use(identity());
  await cortexApp.init();

  // GET crm/businesses/:businessId/duplicates/preview/:primaryId/:duplicateId.
  const crmRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      ...guards,
      CrmDuplicateDetectionService,
      {
        provide: CrmStatsService,
        inject: [PrismaService],
        useFactory: (prisma: any) => new (CrmStatsService as any)(prisma, { logEvent: async () => undefined }, { invalidate: async () => undefined }),
      },
      { provide: CrmService, useValue: {} },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  crmApp = crmRef.createNestApplication();
  crmApp.use(identity());
  await crmApp.init();
}, 120_000);

afterAll(async () => {
  for (const a of [aiApp, graphApp, cortexApp, crmApp]) if (a) await a.close();
  if (db) await cleanup();
});

function aiPlans(actor: string, suffix = '', businessId = ID.biz) {
  return request(aiApp.getHttpServer()).get(`/ai/businesses/${businessId}/ai/plans${suffix}`).set('x-test-user', actor);
}

function queue(actor: string, limit = 100, businessId = ID.biz) {
  return request(graphApp.getHttpServer()).get(`/actions/businesses/${businessId}/queue?limit=${limit}`).set('x-test-user', actor);
}

function cortexPlan(actor: string, planId: string, businessId = ID.biz) {
  return request(cortexApp.getHttpServer()).get(`/api/v1/cortex/plans/${planId}?businessId=${businessId}`).set('x-test-user', actor);
}

function preview(actor: string, primaryId: string, duplicateId: string) {
  return request(crmApp.getHttpServer()).get(`/crm/businesses/${ID.biz}/duplicates/preview/${primaryId}/${duplicateId}`).set('x-test-user', actor);
}

type StepView = { id: string; outputResult?: unknown; inputPayload?: unknown };
type PlanView = { id: string; steps: StepView[] };

/** The plan `planId` as each of the four plan read routes answers it to `actor` (null when a route omits it). */
async function planOnEveryRoute(actor: string, planId: string): Promise<Array<{ route: string; plan: PlanView | null; status: number }>> {
  const list = await aiPlans(actor, '?limit=100');
  const detail = await aiPlans(actor, `/${planId}`);
  const q = await queue(actor);
  const cortex = await cortexPlan(actor, planId);
  const fromList = (body: unknown) => (Array.isArray(body) ? (body as PlanView[]).find((p) => p.id === planId) ?? null : null);
  const asPlan = (body: unknown) => (body && typeof body === 'object' && (body as PlanView).id === planId ? (body as PlanView) : null);
  return [
    { route: 'GET ai/plans', plan: fromList(list.body), status: list.status },
    { route: 'GET ai/plans/:planId', plan: asPlan(detail.body), status: detail.status },
    { route: 'GET actions/.../queue', plan: fromList(q.body?.plans), status: q.status },
    { route: 'GET cortex/plans/:planId', plan: asPlan(cortex.body), status: cortex.status },
  ];
}

const stepOf = (plan: PlanView | null, stepId: string) => plan?.steps.find((s) => s.id === stepId);

describe('KEY-R3a-PLAN-READS: one visible-step rule on every plan read route (D-74, D-37)', () => {
  it('fixture sanity (real rows): the plans and steps are seeded', async () => {
    expect(await db.aiPlan.count({ where: { businessId: ID.biz } })).toBe(11);
    expect(await db.aiPlanStep.count({ where: { plan: { businessId: ID.biz } } })).toBe(15);
  });

  it('PR-01 (PLANREAD-TOOLLESS-OUTPUT) the output of a KEY-cortex crm.list_contacts step (toolName null) names no PRIVATE contact to an ADMIN on any route; the step is shown', async () => {
    for (const { route, plan, status } of await planOnEveryRoute(ID.admin, ID.planCxOwner)) {
      expect(status, route).toBe(200);
      expect(plan, route).not.toBeNull();
      expect(stepOf(plan, ID.sCxOwnerList), route).toBeDefined();
      expect(JSON.stringify(plan), route).not.toContain(ID.cPriv);
      expect(JSON.stringify(plan), route).not.toContain(PRIV_EMAIL);
    }
  });

  it('PR-02 (PLANREAD-TOOLLESS-OUTPUT) a crm-read STAFF proposer reads their own KEY-cortex plan without the PRIVATE contact its search output names, without the step of a module they may not read (commerce), and with a visible step\'s output', async () => {
    for (const { route, plan, status } of await planOnEveryRoute(ID.staff, ID.planCxStaff)) {
      expect(status, route).toBe(200);
      expect(plan, route).not.toBeNull();
      const text = JSON.stringify(plan);
      expect(stepOf(plan, ID.sCxStaffSearch), route).toBeDefined();
      expect(text, route).not.toContain(ID.cPriv);
      expect(text, route).not.toContain(PRIV_EMAIL);
      expect(stepOf(plan, ID.sCxStaffRev), route).toBeUndefined();
      expect(text, route).not.toContain(SECRET_INVOICE);
      expect(stepOf(plan, ID.sCxStaffNote)?.outputResult, route).toEqual({ id: TEAM_NOTE, contactId: ID.cTeam });
    }
  });

  it('PR-03 (PLANREAD-ROWVIS-OUTPUT, D-74) an OWNER-approved step that reached the OWNER\'s PRIVATE contact: its output is withheld from the proposer and an ADMIN on every route (the row, and a note on it that names no contact id); a step on a TEAM contact keeps its output', async () => {
    for (const actor of [ID.staff, ID.admin]) {
      for (const { route, plan, status } of await planOnEveryRoute(actor, ID.planRowVis)) {
        const where = `${actor} ${route}`;
        expect(status, where).toBe(200);
        expect(plan, where).not.toBeNull();
        for (const stepId of [ID.sRvUpdate, ID.sRvNote, ID.sRvTeam]) expect(stepOf(plan, stepId), `${where} ${stepId}`).toBeDefined();
        expect(stepOf(plan, ID.sRvUpdate)?.outputResult ?? null, where).toBeNull();
        expect(stepOf(plan, ID.sRvNote)?.outputResult ?? null, where).toBeNull();
        const text = JSON.stringify(plan?.steps.map((s) => s.outputResult));
        for (const hidden of [PRIV_EMAIL, PRIV_NOTES, PRIV_NOTE_BODY, `${P}note_priv`]) expect(text, `${where} ${hidden}`).not.toContain(hidden);
        expect(stepOf(plan, ID.sRvTeam)?.outputResult, where).toEqual(TEAM_ROW);
      }
    }
  });

  it('PR-05 (D-74) the output of a step that is not a contact read keeps the rows the viewer may see and loses each row naming a contact they may not open (by id, inside a string, or as a key), for an ADMIN on every route', async () => {
    for (const { route, plan, status } of await planOnEveryRoute(ID.admin, ID.planCxOwner)) {
      expect(status, route).toBe(200);
      expect(stepOf(plan, ID.sCxOwnerBookings)?.outputResult, route).toEqual({ bookings: [BOOKING_ROWS[2]], byContact: { [ID.cTeam]: 1 }, total: 3 });
    }
    for (const { route, plan } of await planOnEveryRoute(ID.owner, ID.planCxOwner)) {
      expect(stepOf(plan, ID.sCxOwnerBookings)?.outputResult, route).toEqual({ bookings: BOOKING_ROWS, byContact: { [ID.cPriv]: 1, [ID.cTeam]: 1 }, total: 3 });
    }
  });

  it('PR-04 (D-74 regression control) the OWNER reads every step and every stored output, the PRIVATE rows included, on every route', async () => {
    for (const planId of [ID.planCxOwner, ID.planCxStaff, ID.planRowVis]) {
      for (const { route, plan, status } of await planOnEveryRoute(ID.owner, planId)) {
        expect(status, `${planId} ${route}`).toBe(200);
        expect(JSON.stringify(plan), `${planId} ${route}`).toContain(ID.cPriv);
      }
    }
    const [, detail] = await planOnEveryRoute(ID.owner, ID.planRowVis);
    expect(stepOf(detail.plan, ID.sRvNote)?.outputResult).toEqual({ noteId: `${P}note_priv`, body: PRIV_NOTE_BODY });
    const [, cx] = await planOnEveryRoute(ID.owner, ID.planCxStaff);
    expect(stepOf(cx.plan, ID.sCxStaffRev)?.outputResult).toEqual({ invoices: [{ id: SECRET_INVOICE, total: 999 }] });
  });

  it('KC-01 (KEY-CORTEX-PLAN-READ) GET cortex/plans/:planId answers another member\'s plan to a STAFF member exactly as an unknown id: no step, inputPayload or outputResult', async () => {
    const hidden = await cortexPlan(ID.staff, ID.planCxOwner);
    const unknown = await cortexPlan(ID.staff, `${P}no_such_plan`);
    expect(hidden.status).toBe(unknown.status);
    expect(hidden.text).toBe(unknown.text);
    for (const leaked of [ID.sCxOwnerList, ID.cPriv, ID.cTeam, 'list_contacts']) expect(hidden.text, leaked).not.toContain(leaked);
    // The same rule on GET ai/plans/:planId (AR-02) for the same plan.
    const aiHidden = await aiPlans(ID.staff, `/${ID.planCxOwner}`);
    const aiUnknown = await aiPlans(ID.staff, `/${P}no_such_plan`);
    expect(aiHidden.text).toBe(aiUnknown.text);
  });

  it('KC-02 (KEY-CORTEX-PLAN-READ regression control) a member of another business is refused 403 by BusinessGuard naming this one, and naming their own business finds no plan of this one', async () => {
    const cross = await cortexPlan(ID.outsider, ID.planCxOwner);
    expect(cross.status).toBe(403);
    const own = await cortexPlan(ID.outsider, ID.planCxOwner, ID.bizX);
    const unknown = await cortexPlan(ID.outsider, `${P}no_such_plan`, ID.bizX);
    expect(own.text).toBe(unknown.text);
    expect(own.text).not.toContain(ID.cPriv);
  });

  it('QW-01 (QUEUE-PLAN-WINDOW) the queue filters by proposer in the query: a STAFF member\'s older plan is listed when other members have newer ones than the limit', async () => {
    const res = await queue(ID.win, 3);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.plans as Array<{ id: string }>).map((p) => p.id)).toEqual([ID.planWin]);
    // GET ai/plans already filters in the query (AI-PLANS-READ repair): the same answer.
    const list = await aiPlans(ID.win, '?limit=3');
    expect((list.body as Array<{ id: string }>).map((p) => p.id)).toEqual([ID.planWin]);
  });

  it('DP-01 (CRM-DUP-PREVIEW-HTTP) GET duplicates/preview with the OWNER\'s PRIVATE contact answers a crm-read STAFF the 404 of an unknown pair, and neither row; the OWNER gets the preview', async () => {
    const hidden = await preview(ID.staff, ID.cTeam, ID.cPriv);
    const unknown = await preview(ID.staff, ID.cTeam, `${P}no_such_contact`);
    expect(hidden.status).toBe(404);
    expect(hidden.status).toBe(unknown.status);
    expect(hidden.text).toBe(unknown.text);
    for (const leaked of [ID.cPriv, PRIV_EMAIL, PRIV_NOTES]) expect(hidden.text, leaked).not.toContain(leaked);
    const reversed = await preview(ID.staff, ID.cPriv, ID.cTeam);
    expect(reversed.status).toBe(404);

    const owner = await preview(ID.owner, ID.cTeam, ID.cPriv);
    expect(owner.status, owner.text).toBe(200);
    expect(owner.text).toContain(PRIV_EMAIL);
  });
});

/**
 * KEY-R3a-PLAN-READS review repairs (REAL database, the same four routes):
 *   - SEC-R3a-1: a KEY-cortex step with no tool whose module KEY_PLAN_MODULE_SCOPES maps to nothing
 *     (activity, genome: the connector runs both) was shown with its output to every viewer, though
 *     the executor refuses such a module to a member held to module scopes (deny by default).
 *   - SEC-R3a-2: D-74 withheld the output of a step whose input names a contact the viewer cannot
 *     open, but answered its inputPayload verbatim, carrying what the OWNER wrote into that row.
 *   - R3a-CR-1: the D-74 row filter read an array inside a list (a tuple row) as a list, so it
 *     dropped only the hidden contact's id and kept the rest of that row.
 */
describe('KEY-R3a-PLAN-READS review repairs', () => {
  it('RR-01 (SEC-R3a-1) a KEY-cortex step with no tool under a module mapped to no module scope (activity, genome) is shown to no member held to module scopes, on any route: not its STAFF proposer, not an ADMIN; a step labelled with a module the viewer reads stays; the OWNER reads every step', async () => {
    for (const actor of [ID.staff, ID.admin]) {
      for (const { route, plan, status } of await planOnEveryRoute(actor, ID.planCxUnmapped)) {
        const where = `${actor} ${route}`;
        expect(status, where).toBe(200);
        expect(plan, where).not.toBeNull();
        expect(stepOf(plan, ID.sUnActivity), where).toBeUndefined();
        expect(stepOf(plan, ID.sUnGenome), where).toBeUndefined();
        const text = JSON.stringify(plan);
        for (const hidden of [AUDIT_SECRET, DNA_SECRET, 'export_audit_log', 'get_dna']) expect(text, `${where} ${hidden}`).not.toContain(hidden);
        expect(stepOf(plan, ID.sUnOps)?.outputResult, where).toEqual({ summary: OPS_OUTPUT });
      }
    }
    for (const { route, plan, status } of await planOnEveryRoute(ID.owner, ID.planCxUnmapped)) {
      expect(status, route).toBe(200);
      expect(stepOf(plan, ID.sUnActivity)?.outputResult, route).toEqual({ data: [{ type: 'invoice', description: `Invoice paid ${AUDIT_SECRET}` }] });
      expect(stepOf(plan, ID.sUnGenome)?.outputResult, route).toEqual({ revenue: 123456, marker: DNA_SECRET });
    }
  });

  it('RR-02 (SEC-R3a-2, D-74) a step whose input names a contact the viewer cannot open is answered with its inputPayload withheld as well as its output, run or not yet run, to an ADMIN and to the proposer on every route; a step on a TEAM contact keeps its input; the OWNER reads every input', async () => {
    for (const { route, plan, status } of await planOnEveryRoute(ID.admin, ID.planOwnerInput)) {
      expect(status, route).toBe(200);
      for (const stepId of [ID.sInUpdate, ID.sInPending, ID.sInTeam]) expect(stepOf(plan, stepId), `${route} ${stepId}`).toBeDefined();
      for (const stepId of [ID.sInUpdate, ID.sInPending]) {
        expect(stepOf(plan, stepId)?.inputPayload ?? null, `${route} ${stepId}`).toBeNull();
        expect(stepOf(plan, stepId)?.outputResult ?? null, `${route} ${stepId}`).toBeNull();
      }
      const text = JSON.stringify(plan);
      for (const hidden of [NEW_PRIV_EMAIL, NEW_PRIV_NOTE, PENDING_PRIV_NOTE, ID.cPriv, PRIV_EMAIL]) expect(text, `${route} ${hidden}`).not.toContain(hidden);
      expect(stepOf(plan, ID.sInTeam)?.inputPayload, route).toEqual({ contactId: ID.cTeam, jobTitle: 'v87a team title' });
      expect(stepOf(plan, ID.sInTeam)?.outputResult, route).toEqual(TEAM_ROW);
    }
    // The proposer of a plan whose steps reached the OWNER's PRIVATE contact (PR-03's plan).
    for (const { route, plan } of await planOnEveryRoute(ID.staff, ID.planRowVis)) {
      expect(stepOf(plan, ID.sRvUpdate)?.inputPayload ?? null, route).toBeNull();
      expect(stepOf(plan, ID.sRvNote)?.inputPayload ?? null, route).toBeNull();
      expect(JSON.stringify(plan), route).not.toContain(ID.cPriv);
      expect(stepOf(plan, ID.sRvTeam)?.inputPayload, route).toEqual({ contactId: ID.cTeam, jobTitle: 'v87a' });
    }
    for (const { route, plan } of await planOnEveryRoute(ID.owner, ID.planOwnerInput)) {
      expect(stepOf(plan, ID.sInUpdate)?.inputPayload, route).toEqual({ contactId: ID.cPriv, email: NEW_PRIV_EMAIL, notes: NEW_PRIV_NOTE });
      expect(stepOf(plan, ID.sInPending)?.inputPayload, route).toEqual({ contactId: ID.cPriv, body: PENDING_PRIV_NOTE });
    }
  });

  it('RR-03 (R3a-CR-1, D-74) a row held as an array (a tuple in a list of rows, or an array of cells inside a record) that names a contact the viewer cannot open is removed whole, for an ADMIN on every route; the OWNER reads every row', async () => {
    for (const { route, plan, status } of await planOnEveryRoute(ID.admin, ID.planCxTuple)) {
      expect(status, route).toBe(200);
      expect(stepOf(plan, ID.sTuple)?.outputResult, route).toEqual({
        columns: ['contactId', 'name', 'email'],
        rows: [TUPLE_TEAM_ROW],
        records: [{ cells: [ID.cTeam, 'V87a Cells Team'] }],
        total: 2,
      });
      const text = JSON.stringify(plan);
      for (const hidden of [ID.cPriv, TUPLE_PRIV_NAME, TUPLE_PRIV_EMAIL, CELLS_PRIV_NAME]) expect(text, `${route} ${hidden}`).not.toContain(hidden);
    }
    for (const { route, plan } of await planOnEveryRoute(ID.owner, ID.planCxTuple)) {
      const out = stepOf(plan, ID.sTuple)?.outputResult as { rows: unknown[]; records: unknown[] } | undefined;
      expect(out?.rows, route).toEqual([[ID.cPriv, TUPLE_PRIV_NAME, TUPLE_PRIV_EMAIL], TUPLE_TEAM_ROW]);
      expect(out?.records, route).toHaveLength(2);
    }
  });
});
