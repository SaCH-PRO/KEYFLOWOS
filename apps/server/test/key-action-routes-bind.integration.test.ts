/**
 * V1-31b-KEY-ACTION-ROUTES-BIND: every KEY "execute action" HTTP route executes
 * only a proposal the server holds, looked up by id inside the guarded
 * business; approval resolution routes need a real principal (REAL database).
 *
 * V1-31 review SEC-V131-1 (M46, KEY-CONFIRM-BIND-001) left the it.todo in
 * flow-confirmation-binding.spec.ts: POST /actions/businesses/:businessId/execute
 * (GraphActionsController.executeAction, AuthGuard + BusinessGuard only)
 * evaluated governance on the CLIENT's toolName and ran executeToolDirect with
 * the CLIENT's args. Census of the sibling routes (every route under
 * modules/ai, key-cortex, key-inbox and autopilot named execute/run/apply or
 * calling a tool executor), read from this base:
 *
 *   GA  POST actions/businesses/:b/execute (graph-actions)      client toolName + args -> executeToolDirect. BOUND here to a stored AiPlanStep.
 *   KI  POST key-inbox/.../threads/:t/actions/:i/execute       stored suggestion by index, but payloadOverride merged ANY client key into
 *                                                               the payload, 'user' stood in for a missing principal, no claim (a double
 *                                                               submit ran twice) and only operations scope (a crm write ran without crm
 *                                                               write). BOUND here: claim, crm scope, editable text only, real principal.
 *   AP  POST autopilot/.../actions/:a/execute                  client contactId/channel/message; the action ids are computed by
 *                                                               CrmActionsService, never stored, so there is no proposal to bind:
 *                                                               REFUSED here (410). It wrote "WhatsApp/email sent" timeline rows for
 *                                                               messages the server never sent, attributed to AI.
 *   AP  POST autopilot/.../tasks/:t/approve                    approvedBy from the BODY. Now the authenticated caller.
 *   AA  POST ai-approvals/.../items/:i/resolve, bulk-resolve   req.user?.id ?? 'user'. Now 401 without a principal (unit: the it.todo in
 *                                                               approval.controller.spec.ts), the real user over HTTP.
 *   Stored-id routes, no client tool or arguments (unchanged): flow/confirm (V1-31), flow/execute-plan, ai/plans/:id/approve,
 *   briefing/:planId/execute-all, ai/approvals/:id/resolve, key-autonomy proposals/:id/execute (V1-32), cortex plans/:id/execute
 *   (V1-10), autopilot loops/:id/run and key/execute (a stored DelegationLoop by id in the business).
 *   Outside this write set, still passing request-body tool names or arguments to an executor (KNOWN_BODY_EXECUTORS below, kind
 *   'open' at V1-31b): cortex POST execute and batch (client module.action + parameters), sandbox/execute (client
 *   code), sandbox/apply (client template parameters), flows/:id/execute (client inputs to a stored flow). code-executor
 *   tool-bridge is kind 'bounded' (a server-minted one-time token, tier 1-2 tools only). V1-31c closes the five (below).
 *
 * WHAT IS REAL: PrismaService and the Prisma client at DATABASE_URL, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, the four controllers,
 * PlannerService.getPlan/updateStepStatus, KeyInboxService.getThread,
 * KeyInboxActionExecutorService (it writes the contact_tasks this suite
 * counts), AutopilotService, AiApprovalsService, the users, businesses,
 * memberships, contacts, ai_plans, ai_plan_steps, ai_approval_items,
 * key_inbox_threads, key_inbox_messages, autopilot_tasks and idempotency_keys
 * rows. Identity attachment is a test middleware (x-test-user, seeded v31b_
 * users only), as in contacts-visibility. Stand-ins: the tool executor
 * (FlowOrchestratorService.executeToolDirect records every call, the external
 * effect, and answers after a short delay so concurrent calls overlap),
 * governance (AiOversightService: evaluate allows unless a tool is listed,
 * createApprovalItem writes a real ai_approval_items row, resolveApproval
 * records), the intent parser and plan generation (no LLM), the business
 * graph, the business-event and contact-timeline sinks (record). No provider
 * is reached.
 *
 * V1-31c-KEY-ACTION-WEB-AND-OPEN-ROUTES (the V1-31b companion) closes the five
 * 'open' census entries, each in KeyCortexController (api/v1/cortex), against
 * the principle of the packet notes (M46 / ACTION-001): an AI-proposed action
 * executes only the server-stored proposal by id; a member-initiated direct
 * action may carry client arguments only when the route checks the action's
 * own module write scope (deny by default), binds the tenant, runs the autonomy
 * gate and audits the member; client code is refused unless a bounded sandbox
 * runs it.
 *   CX  POST execute, POST batch     member-initiated direct commands. Every command (structured, or parsed from the
 *                                    member's words) is checked against cortexCommandRequirement before the executor:
 *                                    the capability registry must list the action for the module, the module must map
 *                                    to a canonical module scope the member holds at write (deny by default; crm is
 *                                    OWNER only because the crm adapter writes with no actor; settings is enforced by
 *                                    its adapter on the actor, R0-09c). A refusal is 403 with an ai_execution_logs row
 *                                    naming the member; the executor's own autonomy gate and audit door run the rest.
 *   SB  POST sandbox/execute, apply  REFUSED (410) for everyone: the cortex sandbox is node:vm with host intrinsics in
 *                                    scope, not a bounded sandbox (SB-03 reaches the host process from it), and apply
 *                                    substitutes client parameters into code text (SB-04).
 *   FL  POST flows/:id/execute       BOUND to the stored FlowDefinition by id in the guarded business (404 otherwise),
 *                                    each effect node checked like a direct command, client inputs data only (an
 *                                    engine key such as _userId refused), the actor set by the server, the autonomy
 *                                    gate per action (V1-02 isUsableAutonomyVerdict, fail closed) and an audit row.
 * V1-31c review repairs:
 *   QY  POST query (SEC-V131c-2)     connector.query ran ANY name as a command, so everything CX refuses ran here
 *                                    unchecked, ungated and unaudited. Bounded: a registry query at the module's read
 *                                    scope; settings through the executor; anything else 403 with a row (CX-10..CX-13).
 *   SB  POST sandbox/auto (-3)       generated code from the member's description and ran it in the same sandbox: 410.
 *   FL  flows/:id/execute (-1, -4)   the run's businessId is the flow's own (an input named businessId picked the tenant
 *                                    of the AI decision's model call); the gate is asked per effect node with the
 *                                    parameters it runs with; a parameter filled only at run time is refused.
 * WHAT IS REAL for these (a second Nest app): PrismaService, AuthGuard, BusinessGuard, KeyCortexController,
 * KeyCortexExecutorService (its autonomy gate call and its ai_execution_logs audit door), KeyCortexFlowStudioService
 * (loadFlow, executeFlow, flow_definitions and flow_executions rows) and KeyCortexSandboxService for the two proofs.
 * Stand-ins: the module connector (records every command, the external effect), the autonomy orchestrator (answers
 * cortexVerdict, records every call), the natural-language parser (no LLM), the sandbox the controller holds (records;
 * no case may reach it), and the controller's collaborators for its other routes.
 *
 * Every seeded row carries the `v31b_` prefix (or a v31b_ business id) and is
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import * as ts from 'typescript';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v31b_';

const ID = {
  owner: `${P}owner`, // OWNER of bizA (role-default scopes)
  staffNoRev: `${P}staffNoRev`, // STAFF of bizA: crm write, revenue read, operations write
  staffNoCrm: `${P}staffNoCrm`, // STAFF of bizA: crm read, operations write
  other: `${P}other`, // OWNER of bizB only
  staffOwned: `${P}staffOwned`, // STAFF of bizA: crm write kept to their own book (crm_view owned, crm_edit owned, crm_delete none), operations write
  staffExp: `${P}staffExp`, // STAFF of bizA: expenses write, revenue read, operations read
  staffRO: `${P}staffRO`, // STAFF of bizA with no scope map (read-only role defaults)
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactPriv: `${P}contactPriv`, // the OWNER's PRIVATE contact
  // graph-action plans
  planA: `${P}planA`,
  planB: `${P}planB`,
  sStored: `${P}sStored`, // crm_add_note, executed with a conflicting client toolName/args
  sConc: `${P}sConc`, // crm_add_note, 8 concurrent executes
  sRev: `${P}sRev`, // commerce_mark_invoice_paid (revenue write)
  sUnmapped: `${P}sUnmapped`, // execute_custom_logic (mapped to no module: denied by default)
  sApproval: `${P}sApproval`, // crm_delete_contact (governance stand-in asks for formal approval)
  sForeign: `${P}sForeign`, // a step of bizB's plan
  // review repairs (planC, draft)
  planC: `${P}planC`,
  sPrivUpdate: `${P}sPrivUpdate`, // crm_update_contact on the OWNER's PRIVATE contact
  sPrivDelete: `${P}sPrivDelete`, // crm_delete_contact on it
  sPrivTag: `${P}sPrivTag`, // tag_contact on it
  sCreate: `${P}sCreate`, // crm_create_contact
  sTask: `${P}sTask`, // create_task (CR-2)
  sPayBill: `${P}sPayBill`, // finance_pay_bill (expenses write, CR-3)
  sExtract: `${P}sExtract`, // contract_extract_terms (operations write, CR-3)
  sListContacts: `${P}sListContacts`, // crm_list_contacts (crm read, CR-3)
  // plans the plan executor drives (SEC-V131b-2)
  planApproved: `${P}planApproved`,
  planExecuting: `${P}planExecuting`,
  planRace: `${P}planRace`, // draft when read, approved before the claim
  sApprovedPlan: `${P}sApprovedPlan`,
  sExecutingPlan: `${P}sExecutingPlan`,
  sRace: `${P}sRace`,
  // key inbox
  threadA: `${P}threadA`,
  threadB: `${P}threadB`,
  msgA: `${P}msgA`,
  msgB: `${P}msgB`,
  // autopilot / approvals
  taskA: `${P}taskA`,
  taskB: `${P}taskB`, // awaiting approval; a read-only member may not resolve it
  taskC: `${P}taskC`, // no approval needed; completed through the status route
  taskD: `${P}taskD`, // awaiting approval; AUTO_EXECUTED is refused on it
  itemA: `${P}itemA`,
  // V1-31c cortex direct actions (their own business, so the V1-31b fixture counts are unchanged)
  cxBiz: `${P}cxBiz`,
  cxOwner: `${P}cxOwner`, // OWNER of cxBiz (role-default scopes)
  cxStaffRO: `${P}cxStaffRO`, // STAFF of cxBiz: projects read, automations read (no write scope)
  cxStaffW: `${P}cxStaffW`, // STAFF of cxBiz: projects write, automations write, revenue read
  cxFlow: `${P}cxFlow`, // trigger -> projects.create_project
  cxFlowRev: `${P}cxFlowRev`, // trigger -> commerce.process_payment (revenue write)
  cxFlowB: `${P}cxFlowB`, // a flow of bizB
  // V1-31c review repairs
  cxFlowAi: `${P}cxFlowAi`, // trigger -> ai_decision (SEC-V131c-1)
  cxFlowTwin: `${P}cxFlowTwin`, // two projects.create_project nodes: a stored name, then {{text}} (SEC-V131c-4 / CRR-2)
  cxFlowStored: `${P}cxFlowStored`, // projects.create_project with a stored name the value check denies (CRR-2)
  cxFlowChain: `${P}cxFlowChain`, // projects.add_task whose title is the first node's output (filled only at run time)
  // Trial-N integration review
  superNM: `${P}superNM`, // role SUPER_ADMIN, a member of no business (D-46)
  planD: `${P}planD`, // the OWNER's draft plan
  sSuperRev: `${P}sSuperRev`, // commerce_mark_invoice_paid (an invoice write)
  sSuperSend: `${P}sSuperSend`, // commerce_send_invoice (an invoice write, GOVERNED_UNGRANTED)
  sOwnerNote: `${P}sOwnerNote`, // crm_add_note proposed by the OWNER (another member may not run it)
  sApproveThenRun: `${P}sApproveThenRun`, // crm_delete_contact: queued for approval, approved, then run
  planNoRev: `${P}planNoRev`, // staffNoRev's own draft plan
  sCreateOwn: `${P}sCreateOwn`, // crm_create_contact
  sNoRevNote: `${P}sNoRevNote`, // crm_add_note (the OWNER may run a member's step)
  planExp: `${P}planExp`, // staffExp's own draft plan
  sPayBillOwn: `${P}sPayBillOwn`, // finance_pay_bill (expenses write)
  planNoCrm: `${P}planNoCrm`, // staffNoCrm's own draft plan
  sListDealsOwn: `${P}sListDealsOwn`, // crm_list_deals (crm read)
  sListContactsOwn: `${P}sListContactsOwn`, // crm_list_contacts (reads every contact, PRIVATE ones included)
  sSearchContactsOwn: `${P}sSearchContactsOwn`, // crm_search_contacts (likewise)
  taskE: `${P}taskE`, // awaiting approval; approved through the cortex autopilot adapter
  taskF: `${P}taskF`, // no approval needed; completed through the cortex autopilot adapter
  cxSuper: `${P}cxSuper`, // role SUPER_ADMIN, not a member of cxBiz (D-46)
  // Trial-N repair round 2: their own business (bizR), so the counts above are unchanged
  bizR: `${P}bizR`,
  rOwner: `${P}rOwner`, // OWNER of bizR (role-default scopes)
  rAdmin: `${P}rAdmin`, // ADMIN of bizR (role-default scopes)
  rStaff: `${P}rStaff`, // STAFF of bizR: crm read (crm_view all by default), operations write; no revenue
  rStaffOwned: `${P}rStaffOwned`, // STAFF of bizR: crm read kept to their own book (crm_view owned)
  rStaffW: `${P}rStaffW`, // STAFF of bizR: crm write, operations write
  rStaffRev: `${P}rStaffRev`, // STAFF of bizR: crm write, revenue read, operations write
  rTeam: `${P}rTeam`, // the OWNER's TEAM contact
  rPriv: `${P}rPriv`, // the OWNER's PRIVATE contact, a duplicate of rTeam by email
  rOwnedC: `${P}rOwnedC`, // rStaffOwned's own TEAM contact
  planRStaff: `${P}planRStaff`, // rStaff's own draft plan
  sRSearch: `${P}sRSearch`, // crm_search_contacts
  sRList: `${P}sRList`, // crm_list_contacts
  sRDup: `${P}sRDup`, // crm_find_duplicates
  sRPreview: `${P}sRPreview`, // crm_merge_preview of rTeam and rPriv
  sRStaffRev: `${P}sRStaffRev`, // commerce_mark_invoice_paid (rStaff holds no revenue scope)
  planROwner: `${P}planROwner`, // the OWNER's draft plan
  sROwnerNote: `${P}sROwnerNote`, // crm_add_note
  sROwnerInv: `${P}sROwnerInv`, // commerce_mark_invoice_paid
  planApvOther: `${P}planApvOther`, // the OWNER's draft plan, crm_add_note (approved by another member)
  planApvOwn: `${P}planApvOwn`, // rStaffW's draft plan, crm_add_note (approved by its proposer)
  planApvRev: `${P}planApvRev`, // rStaffRev's draft plan, commerce_mark_invoice_paid (revenue write)
  planApvSuper: `${P}planApvSuper`, // the OWNER's draft plan, commerce_mark_invoice_paid (D-46)
  planApvList: `${P}planApvList`, // rAdmin's draft plan, crm_list_contacts (run by the plan executor with no principal)
  planRun: `${P}planRun`, // the OWNER's draft plan whose step is queued for approval, approved, then run from the queue (D-70)
  sRunDel: `${P}sRunDel`, // crm_delete_contact (the governance stand-in asks for formal approval)
  taskG: `${P}taskG`, // awaiting approval; denied over HTTP
  taskH: `${P}taskH`, // awaiting approval; denied through the cortex autopilot adapter
  // Trial-N repair round 2 recheck (bizR, proposed by rStaffOwned or rStaffW, so the QR-01 counts are unchanged)
  planApvNoToolList: `${P}planApvNoToolList`, // rStaffOwned's draft plan: a step with no toolName whose action is crm_list_contacts
  planApvNoToolInv: `${P}planApvNoToolInv`, // rStaffOwned's draft plan: a step with no toolName whose action is commerce_create_invoice
  planApvNoToolText: `${P}planApvNoToolText`, // rStaffW's draft plan: an 'analyze' step (no tool, its action names no tool) and a crm_add_note
  planROut: `${P}planROut`, // rStaffOwned's plan whose crm_list_contacts step the plan executor ran with no principal (its output names rPriv)
  sROutList: `${P}sROutList`,
  // CRM-DUP-HTTP: their own business, so no other count changes
  bizDup: `${P}bizDup`,
  dOwner: `${P}dOwner`, // OWNER of bizDup
  dStaff: `${P}dStaff`, // STAFF of bizDup: crm read (crm_view all by default)
  dTeam: `${P}dTeam`, // the OWNER's TEAM contact
  dPriv: `${P}dPriv`, // the OWNER's PRIVATE contact, a duplicate of dTeam by email and by name
};

const STORED_ARGS = { contactId: `${P}contactA`, body: 'v31b stored note' };
const CLIENT_ARGS = { contactId: `${P}contactB`, body: 'v31b client note', force: true };

/** The suggested actions on msgA, by index. */
const ACTIONS = [
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 0' } }, // 0: override refused (non-editable key)
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 1' } }, // 1: 8 concurrent executes
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 2' } }, // 2: staffNoCrm refused
  { type: 'transfer_funds', label: 'Unknown', confidence: 0.9, payload: {} }, // 3: an unmapped type
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 4' } }, // 4: editable title honoured
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 5', dueDate: '2026-12-01T10:00:00.000Z' } }, // 5: title and dueDate, as the dialog sends them
];

const EXECUTOR_DELAY_MS = 40;

let db: any;
let app: any;

/** Every tool the executor stand-in was handed. */
const executions: Array<{ businessId: string; toolName: string; args: unknown; planId?: string; planStepId?: string; action?: any }> = [];
/** Every governance evaluation. */
const evaluations: string[] = [];
/** Every approval resolution the oversight stand-in was handed. */
const resolutions: Array<{ kind: string; ids: string[]; businessId: string; resolution: string; userId: unknown }> = [];
/** Every business event and contact timeline row emitted. */
const businessEvents: any[] = [];
const timelineEvents: any[] = [];
/** Tools governance asks a formal approval for. */
const FORMAL_APPROVAL_TOOLS = new Set(['crm_delete_contact']);
/** Run inside governance.evaluate, between the route's step read and its claim (GA-14). */
let beforeEvaluate: (() => Promise<void>) | null = null;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* V1-31c: the cortex app (KeyCortexController) and what its stand-ins recorded. */
let cortexApp: any;
let cortexExecutor: any;
/** Every command the module connector stand-in was handed (the external effect). */
const connectorCalls: Array<{ module: unknown; action: unknown; businessId: unknown; userId: unknown; parameters: unknown }> = [];
/** Every verdict request the autonomy orchestrator stand-in received. */
const cortexAutonomyCalls: Array<{ businessId: unknown; actionKey: unknown; proposedBy: unknown }> = [];
/** Every call the sandbox the controller holds received (no case may reach it). */
const sandboxCalls: string[] = [];
/** What the autonomy stand-in answers: a fully stated allow unless a case sets another verdict or 'throw'. */
const ALLOW = { allowed: true, requiresApproval: false, tier: 'full', reason: 'v31c allows' };
let cortexVerdict: unknown = ALLOW;
/** The parameters each verdict request carried, in the order of cortexAutonomyCalls (review SEC-V131c-4 / CRR-2). */
const cortexGateParams: Array<{ actionKey: unknown; parameters: unknown }> = [];
/**
 * A value check the stand-in applies, as ConstitutionValuesService.checkAction does with a
 * dealbreaker term: a verdict request whose parameters contain this text is denied.
 */
const DEALBREAKER = 'V31C-DEALBREAKER-TERM';
/** The tenant of every model call the flow engine's AI decision made (review SEC-V131c-1). */
const modelGatewayCalls: Array<{ businessId: unknown }> = [];
/** What the natural-language parser stand-in answers (no LLM). */
let parsedIntent: { module: string; action: string; parameters: Record<string, unknown> } = { module: 'projects', action: 'create_project', parameters: { name: 'v31c parsed' } };

async function cleanup() {
  for (const sql of [
    `DELETE FROM flow_executions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM flow_definitions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_messages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_threads WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_approval_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plan_steps WHERE plan_id IN (SELECT id FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function http() {
  return request(app.getHttpServer());
}

function executeGraph(actor: string | null, body: Record<string, unknown>, businessId = ID.bizA) {
  const req = http().post(`/actions/businesses/${businessId}/execute`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

function executeInbox(actor: string | null, threadId: string, index: number | string, body: Record<string, unknown>, businessId = ID.bizA) {
  const req = http().post(`/key-inbox/businesses/${businessId}/threads/${threadId}/actions/${index}/execute`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

async function stepStatus(id: string): Promise<string | null> {
  const row = await db.aiPlanStep.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

async function seedStep(id: string, planId: string, order: number, toolName: string, inputPayload: Record<string, unknown>) {
  await db.aiPlanStep.create({
    data: { id, planId, order, toolName, action: `v31b ${toolName}`, description: 'v31b', riskTier: 1, inputPayload, status: 'pending' },
  });
}

async function contactTasks(title?: string) {
  return db.contactTask.findMany({ where: { businessId: ID.bizA, ...(title ? { title } : {}) } });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
  const { AiApprovalsController } = await import('../src/modules/ai/ai-approvals.controller');
  const { KeyInboxController } = await import('../src/modules/key-inbox/key-inbox.controller');
  const { AutopilotController } = await import('../src/modules/autopilot/autopilot.controller');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
  const { PlannerService } = await import('../src/modules/ai/planner.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');
  const { AiApprovalsService } = await import('../src/modules/ai/ai-approvals.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { KeyInboxService } = await import('../src/modules/key-inbox/key-inbox.service');
  const { KeyInboxActionExecutorService } = await import('../src/modules/key-inbox/key-inbox-action-executor.service');
  const { KeyInboxIntelligenceService } = await import('../src/modules/key-inbox/key-inbox-intelligence.service');
  const { KeyInboxAnalysisService } = await import('../src/modules/key-inbox/key-inbox-analysis.service');
  const { KeyInboxActionService } = await import('../src/modules/key-inbox/key-inbox-action.service');
  const { KeyInboxTemporalEmitterService } = await import('../src/modules/key-inbox/key-inbox-temporal-emitter.service');
  const { KeyInboxReplySenderService } = await import('../src/modules/key-inbox/key-inbox-reply-sender.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');
  const { AutopilotAiService } = await import('../src/modules/autopilot/autopilot-ai.service');
  const { DelegationLoopService } = await import('../src/modules/autopilot/delegation-loop.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');

  const governance = {
    evaluate: async (_businessId: string, toolName: string) => {
      evaluations.push(toolName);
      if (beforeEvaluate) await beforeEvaluate();
      const base = { allowed: true, requiresQuickConfirm: false, requiresFormalApproval: false, requiresAdminApproval: false, tier: 1 };
      return FORMAL_APPROVAL_TOOLS.has(toolName)
        ? { ...base, tier: 3, requiresFormalApproval: true, reason: 'Tier 3 action requires explicit approval before execution' }
        : { ...base, reason: 'v31b allows' };
    },
    createApprovalItem: async (businessId: string, data: any) =>
      db.aiApprovalItem.create({
        data: {
          id: `${P}approval_${Math.random().toString(36).slice(2, 10)}`,
          businessId,
          toolName: data.toolName,
          title: data.title,
          description: data.description ?? null,
          inputPayload: data.inputPayload ?? undefined,
          planId: data.planId ?? null,
          planStepId: data.planStepId ?? null,
          riskTier: 3,
        },
      }),
    resolveApproval: async (itemId: string, businessId: string, resolution: string, userId: unknown) => {
      resolutions.push({ kind: 'one', ids: [itemId], businessId, resolution, userId });
      return { id: itemId, status: resolution };
    },
    resolveApprovalsBatch: async (businessId: string, ids: string[], resolution: string, userId: unknown) => {
      resolutions.push({ kind: 'batch', ids, businessId, resolution, userId });
      return { succeeded: ids.length, failed: 0, total: ids.length };
    },
    // Trial-N repair round 2 (QUEUE-READ): the real rows, as AiOversightService.getPendingApprovals reads them.
    getPendingApprovals: async (businessId: string, limit = 20) =>
      db.aiApprovalItem.findMany({ where: { businessId, status: 'pending' }, orderBy: [{ riskTier: 'desc' }, { createdAt: 'asc' }], take: limit }),
    getAutonomySettings: async () => ({ mode: 'pro_auto', maxAutoTier: 2, blockedTools: [], blockedModules: [] }),
  };

  const orchestrator = {
    executeToolDirect: async (businessId: string, toolName: string, args: unknown, planId?: string, planStepId?: string, action?: any) => {
      executions.push({ businessId, toolName, args, planId, planStepId, action });
      await pause(EXECUTOR_DELAY_MS);
      return { toolCallId: `manual_${toolName}`, name: toolName, result: { ok: true }, changedEntities: [], followOnSuggestions: [], success: true };
    },
  };

  /** Plan generation without an LLM: writes the plan the way PlannerService.createPlan does, and answers its shape (no step ids). */
  const createPlan = async (businessId: string, intent: any, userId?: string) => {
    const plan = await db.aiPlan.create({
      data: {
        id: `${P}planGen_${Math.random().toString(36).slice(2, 10)}`,
        businessId,
        userId: userId ?? null,
        objective: intent.objective,
        status: 'draft',
        maxRiskTier: 1,
        steps: { create: [{ order: 1, toolName: 'crm_add_note', action: 'Add a note', description: 'v31b', riskTier: 1, inputPayload: STORED_ARGS, status: 'pending' }] },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    return {
      id: plan.id, status: plan.status, objective: plan.objective, urgency: plan.urgency, modules: plan.modules,
      maxRiskTier: plan.maxRiskTier, startedAt: null, completedAt: null, createdAt: plan.createdAt,
      steps: plan.steps.map((s: any) => ({ order: s.order, toolName: s.toolName, module: s.module, action: s.action, description: s.description ?? '', riskTier: s.riskTier, requiresApproval: false, dependsOn: [], inputPayload: s.inputPayload, expectedBenefit: null })),
    };
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [GraphActionsController, AiApprovalsController, KeyInboxController, AutopilotController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      {
        provide: BusinessGraphService,
        useValue: { getSnapshot: async () => ({ links: [], entities: { topContacts: [], overdueInvoices: [], catalogProducts: [] }, automations: {} }) },
      },
      {
        provide: IntentParserService,
        useValue: { parse: async (_b: string, input: string) => ({ objective: input, rawInput: input, urgency: 'normal', modules: ['crm'], scope: [], missingInfo: [], actionCandidates: [], clarificationNeeded: false }) },
      },
      {
        provide: PlannerService,
        inject: [PrismaService],
        useFactory: (prisma: any) => {
          const planner: any = new (PlannerService as any)(prisma, {}, {}, {}, {}, {});
          planner.createPlan = createPlan;
          return planner;
        },
      },
      { provide: AiOversightService, useValue: governance },
      { provide: FlowOrchestratorService, useValue: orchestrator },
      AiExecutionLogService,
      { provide: WorkspaceRecommendationsService, useValue: {} },
      AiApprovalsService,
      KeyInboxService,
      KeyInboxActionExecutorService,
      { provide: KeyInboxIntelligenceService, useValue: {} },
      { provide: KeyInboxAnalysisService, useValue: {} },
      { provide: KeyInboxActionService, useValue: {} },
      { provide: KeyInboxTemporalEmitterService, useValue: {} },
      { provide: KeyInboxReplySenderService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: BusinessEventService, useValue: { emit: async (e: any) => void businessEvents.push(e), getTimeline: async () => [] } },
      AutopilotService,
      { provide: CrmTimelineService, useValue: { logEvent: async (...args: any[]) => void timelineEvents.push(args) } },
      { provide: AutopilotAiService, useValue: {} },
      { provide: DelegationLoopService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
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

  await cleanup();

  for (const id of [ID.owner, ID.staffNoRev, ID.staffNoCrm, ID.other, ID.staffOwned, ID.staffExp, ID.staffRO]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V31b Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V31b Biz B', ownerId: ID.other } });
  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.staffNoRev, ID.bizA, 'STAFF', { crm: 'write', revenue: 'read', operations: 'write' });
  await m(ID.staffNoCrm, ID.bizA, 'STAFF', { crm: 'read', operations: 'write' });
  await m(ID.other, ID.bizB, 'OWNER');
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'write', crm_view: 'owned', crm_edit: 'owned', crm_delete: 'none', operations: 'write' });
  await m(ID.staffExp, ID.bizA, 'STAFF', { expenses: 'write', revenue: 'read', operations: 'read' });
  await m(ID.staffRO, ID.bizA, 'STAFF');

  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V31b A', visibility: 'TEAM' } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V31b B', visibility: 'TEAM' } });
  await db.contact.create({ data: { id: ID.contactPriv, businessId: ID.bizA, firstName: 'V31b Private', visibility: 'PRIVATE', ownerId: ID.owner } });

  await db.aiPlan.create({ data: { id: ID.planA, businessId: ID.bizA, userId: ID.owner, objective: 'v31b plan A', status: 'draft' } });
  await db.aiPlan.create({ data: { id: ID.planB, businessId: ID.bizB, userId: ID.other, objective: 'v31b plan B', status: 'draft' } });
  await seedStep(ID.sStored, ID.planA, 1, 'crm_add_note', STORED_ARGS);
  await seedStep(ID.sConc, ID.planA, 2, 'crm_add_note', STORED_ARGS);
  await seedStep(ID.sRev, ID.planA, 3, 'commerce_mark_invoice_paid', { invoiceId: `${P}inv` });
  await seedStep(ID.sUnmapped, ID.planA, 4, 'execute_custom_logic', { code: 'return 1' });
  await seedStep(ID.sApproval, ID.planA, 5, 'crm_delete_contact', { contactId: ID.contactA });
  await seedStep(ID.sForeign, ID.planB, 1, 'crm_add_note', { contactId: ID.contactB, body: 'b' });
  await db.aiPlan.create({ data: { id: ID.planC, businessId: ID.bizA, userId: ID.owner, objective: 'v31b plan C', status: 'draft' } });
  await seedStep(ID.sPrivUpdate, ID.planC, 1, 'crm_update_contact', { contactId: ID.contactPriv, email: `${P}attacker@test.local` });
  await seedStep(ID.sPrivDelete, ID.planC, 2, 'crm_delete_contact', { contactId: ID.contactPriv });
  await seedStep(ID.sPrivTag, ID.planC, 3, 'tag_contact', { contactId: ID.contactPriv, tag: 'v31b' });
  await seedStep(ID.sCreate, ID.planC, 4, 'crm_create_contact', { firstName: 'V31b Created' });
  await seedStep(ID.sTask, ID.planC, 5, 'create_task', { contactId: ID.contactA, title: 'v31b graph task' });
  await seedStep(ID.sPayBill, ID.planC, 6, 'finance_pay_bill', { billId: `${P}bill` });
  await seedStep(ID.sExtract, ID.planC, 7, 'contract_extract_terms', { contractId: `${P}contract` });
  await seedStep(ID.sListContacts, ID.planC, 8, 'crm_list_contacts', {});
  for (const [planId, status, stepId] of [
    [ID.planApproved, 'approved', ID.sApprovedPlan],
    [ID.planExecuting, 'executing', ID.sExecutingPlan],
    [ID.planRace, 'draft', ID.sRace],
  ] as const) {
    await db.aiPlan.create({ data: { id: planId, businessId: ID.bizA, userId: ID.owner, objective: `v31b ${status}`, status } });
    await seedStep(stepId, planId, 1, 'crm_add_note', STORED_ARGS);
  }
  // Trial-N integration review.
  await db.user.create({ data: { id: ID.superNM, email: `${P}superNM@test.local`, role: 'SUPER_ADMIN' } });
  await db.aiPlan.create({ data: { id: ID.planD, businessId: ID.bizA, userId: ID.owner, objective: 'v31b plan D', status: 'draft' } });
  await seedStep(ID.sSuperRev, ID.planD, 1, 'commerce_mark_invoice_paid', { invoiceId: `${P}inv` });
  await seedStep(ID.sSuperSend, ID.planD, 2, 'commerce_send_invoice', { invoiceId: `${P}inv` });
  await seedStep(ID.sOwnerNote, ID.planD, 3, 'crm_add_note', STORED_ARGS);
  await seedStep(ID.sApproveThenRun, ID.planD, 4, 'crm_delete_contact', { contactId: ID.contactA });
  for (const [planId, userId] of [[ID.planNoRev, ID.staffNoRev], [ID.planExp, ID.staffExp], [ID.planNoCrm, ID.staffNoCrm]] as const) {
    await db.aiPlan.create({ data: { id: planId, businessId: ID.bizA, userId, objective: `v31b ${userId}`, status: 'draft' } });
  }
  await seedStep(ID.sCreateOwn, ID.planNoRev, 1, 'crm_create_contact', { firstName: 'V31b Created' });
  await seedStep(ID.sNoRevNote, ID.planNoRev, 2, 'crm_add_note', STORED_ARGS);
  await seedStep(ID.sPayBillOwn, ID.planExp, 1, 'finance_pay_bill', { billId: `${P}bill` });
  await seedStep(ID.sListDealsOwn, ID.planNoCrm, 1, 'crm_list_deals', {});
  await seedStep(ID.sListContactsOwn, ID.planNoCrm, 2, 'crm_list_contacts', {});
  await seedStep(ID.sSearchContactsOwn, ID.planNoCrm, 3, 'crm_search_contacts', { query: 'V31b' });

  await db.keyInboxThread.create({ data: { id: ID.threadA, businessId: ID.bizA, channel: 'email', contactId: ID.contactA, subject: 'v31b A' } });
  await db.keyInboxThread.create({ data: { id: ID.threadB, businessId: ID.bizB, channel: 'email', contactId: ID.contactB, subject: 'v31b B' } });
  await db.keyInboxMessage.create({
    data: { id: ID.msgA, businessId: ID.bizA, threadId: ID.threadA, channel: 'email', direction: 'INBOUND', contentText: 'hi', receivedAt: new Date(), suggestedActions: ACTIONS },
  });
  await db.keyInboxMessage.create({
    data: { id: ID.msgB, businessId: ID.bizB, threadId: ID.threadB, channel: 'email', direction: 'INBOUND', contentText: 'hi', receivedAt: new Date(), suggestedActions: [ACTIONS[0]] },
  });

  await db.autopilotTask.create({ data: { id: ID.taskA, businessId: ID.bizA, title: 'v31b approve me', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
  await db.autopilotTask.create({ data: { id: ID.taskB, businessId: ID.bizA, title: 'v31b not yours to resolve', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
  await db.autopilotTask.create({ data: { id: ID.taskC, businessId: ID.bizA, title: 'v31b complete me', category: 'OPERATIONS', status: 'PENDING', requiresApproval: false } });
  await db.autopilotTask.create({ data: { id: ID.taskD, businessId: ID.bizA, title: 'v31b not auto-executed', category: 'OPERATIONS', status: 'PENDING', requiresApproval: true } });
  await db.autopilotTask.create({ data: { id: ID.taskE, businessId: ID.bizA, title: 'v31b approved by a member through KEY', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
  await db.autopilotTask.create({ data: { id: ID.taskF, businessId: ID.bizA, title: 'v31b completed by a member through KEY', category: 'OPERATIONS', status: 'PENDING', requiresApproval: false } });
  await db.aiApprovalItem.create({ data: { id: ID.itemA, businessId: ID.bizA, toolName: 'crm_add_note', title: 'v31b item', riskTier: 1 } });
  await db.autopilotTask.create({ data: { id: ID.taskG, businessId: ID.bizA, title: 'v31b denied over HTTP', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
  await db.autopilotTask.create({ data: { id: ID.taskH, businessId: ID.bizA, title: 'v31b denied through KEY', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });

  // Trial-N repair round 2: bizR.
  for (const id of [ID.rOwner, ID.rAdmin, ID.rStaff, ID.rStaffOwned, ID.rStaffW, ID.rStaffRev]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizR, name: 'V31b Biz R', ownerId: ID.rOwner } });
  await m(ID.rOwner, ID.bizR, 'OWNER');
  await m(ID.rAdmin, ID.bizR, 'ADMIN');
  await m(ID.rStaff, ID.bizR, 'STAFF', { crm: 'read', operations: 'write' });
  await m(ID.rStaffOwned, ID.bizR, 'STAFF', { crm: 'read', crm_view: 'owned', operations: 'write' });
  await m(ID.rStaffW, ID.bizR, 'STAFF', { crm: 'write', operations: 'write' });
  await m(ID.rStaffRev, ID.bizR, 'STAFF', { crm: 'write', revenue: 'read', operations: 'write' });
  // rTeam and rPriv share an email (emailNormalized left null, so the live unique index is not involved): one duplicate pair.
  await db.contact.create({ data: { id: ID.rTeam, businessId: ID.bizR, firstName: 'Rdup', lastName: 'Person', email: `${P}rdup@test.local`, visibility: 'TEAM', ownerId: ID.rOwner } });
  await db.contact.create({ data: { id: ID.rPriv, businessId: ID.bizR, firstName: 'Rdup', lastName: 'Private', email: `${P}rdup@test.local`, visibility: 'PRIVATE', ownerId: ID.rOwner } });
  await db.contact.create({ data: { id: ID.rOwnedC, businessId: ID.bizR, firstName: 'Rdup', lastName: 'Owned', visibility: 'TEAM', ownerId: ID.rStaffOwned } });
  const planR = (id: string, userId: string) =>
    db.aiPlan.create({ data: { id, businessId: ID.bizR, userId, objective: `v31b ${id.slice(P.length)}`, status: 'draft' } });
  await planR(ID.planRStaff, ID.rStaff);
  await seedStep(ID.sRSearch, ID.planRStaff, 1, 'crm_search_contacts', { query: 'Rdup' });
  await seedStep(ID.sRList, ID.planRStaff, 2, 'crm_list_contacts', {});
  await seedStep(ID.sRDup, ID.planRStaff, 3, 'crm_find_duplicates', {});
  await seedStep(ID.sRPreview, ID.planRStaff, 4, 'crm_merge_preview', { primaryId: ID.rTeam, duplicateId: ID.rPriv });
  await seedStep(ID.sRStaffRev, ID.planRStaff, 5, 'commerce_mark_invoice_paid', { invoiceId: `${P}rinv_staff` });
  await planR(ID.planROwner, ID.rOwner);
  await seedStep(ID.sROwnerNote, ID.planROwner, 1, 'crm_add_note', { contactId: ID.rTeam, body: 'v31b owner-only note text' });
  await seedStep(ID.sROwnerInv, ID.planROwner, 2, 'commerce_mark_invoice_paid', { invoiceId: `${P}rinv_owner` });
  for (const [planId, userId, toolName, payload] of [
    [ID.planApvOther, ID.rOwner, 'crm_add_note', { contactId: ID.rTeam, body: 'v31b approve other' }],
    [ID.planApvOwn, ID.rStaffW, 'crm_add_note', { contactId: ID.rTeam, body: 'v31b approve own' }],
    [ID.planApvRev, ID.rStaffRev, 'commerce_mark_invoice_paid', { invoiceId: `${P}rinv_apv` }],
    [ID.planApvSuper, ID.rOwner, 'commerce_mark_invoice_paid', { invoiceId: `${P}rinv_super` }],
    [ID.planApvList, ID.rAdmin, 'crm_list_contacts', {}],
  ] as const) {
    await planR(planId, userId);
    await seedStep(`${planId}_s1`, planId, 1, toolName, payload);
  }
  await planR(ID.planRun, ID.rOwner);
  await seedStep(ID.sRunDel, ID.planRun, 1, 'crm_delete_contact', { contactId: ID.rTeam });

  // Trial-N repair round 2 recheck. A step with no toolName, as PlannerService stores the model's
  // step when its tool is not in the registry: PlanExecutorService runs `toolName ?? action`.
  const noToolStep = (id: string, planId: string, order: number, action: string, inputPayload: Record<string, unknown>) =>
    db.aiPlanStep.create({ data: { id, planId, order, toolName: null, action, description: 'v31b', riskTier: 1, inputPayload, status: 'pending' } });
  await planR(ID.planApvNoToolList, ID.rStaffOwned);
  await noToolStep(`${ID.planApvNoToolList}_s1`, ID.planApvNoToolList, 1, 'crm_list_contacts', { limit: 50 });
  await planR(ID.planApvNoToolInv, ID.rStaffOwned);
  await noToolStep(`${ID.planApvNoToolInv}_s1`, ID.planApvNoToolInv, 1, 'commerce_create_invoice', { contactId: ID.rTeam, items: [] });
  await planR(ID.planApvNoToolText, ID.rStaffW);
  await noToolStep(`${ID.planApvNoToolText}_s1`, ID.planApvNoToolText, 1, 'Analyze which contacts went quiet last month', {});
  await seedStep(`${ID.planApvNoToolText}_s2`, ID.planApvNoToolText, 2, 'crm_add_note', { contactId: ID.rTeam, body: 'v31b analyze then note' });
  // A contact read the plan executor ran with no principal after the OWNER approved it: its
  // output is every contact, the OWNER's PRIVATE one included (what ai_plan_steps.output_result holds).
  await db.aiPlan.create({ data: { id: ID.planROut, businessId: ID.bizR, userId: ID.rStaffOwned, objective: 'v31b planROut', status: 'completed' } });
  await db.aiPlanStep.create({
    data: {
      id: ID.sROutList, planId: ID.planROut, order: 1, toolName: 'crm_list_contacts', action: 'v31b crm_list_contacts', description: 'v31b', riskTier: 1,
      inputPayload: { limit: 50 }, status: 'completed',
      outputResult: { contacts: [{ id: ID.rPriv, firstName: 'Rdup', lastName: 'Private' }, { id: ID.rTeam, firstName: 'Rdup', lastName: 'Person' }] },
    },
  });

  // CRM-DUP-HTTP: bizDup.
  for (const id of [ID.dOwner, ID.dStaff]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizDup, name: 'V31b Biz Dup', ownerId: ID.dOwner } });
  await m(ID.dOwner, ID.bizDup, 'OWNER');
  await m(ID.dStaff, ID.bizDup, 'STAFF', { crm: 'read' });
  // Same email (emailNormalized left null, so the live unique index is not involved) and same name:
  // one pair for findCandidatesScoped and one name group for the legacy groups shape.
  await db.contact.create({ data: { id: ID.dTeam, businessId: ID.bizDup, firstName: 'Ddup', lastName: 'Same', email: `${P}ddup@test.local`, visibility: 'TEAM', ownerId: ID.dOwner } });
  await db.contact.create({ data: { id: ID.dPriv, businessId: ID.bizDup, firstName: 'Ddup', lastName: 'Same', email: `${P}ddup@test.local`, visibility: 'PRIVATE', ownerId: ID.dOwner } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

/** The cortex controller's collaborators for its other routes; the routes under test reach none of them. */
const CORTEX_OFF_BOUNDARY = new Set([
  'KeyCortexReasoningService', 'KeyCortexConversationService', 'KeyCortexVoiceService', 'KeyCortexPersonalityService',
  'KeyCortexActionsService', 'KeyCortexContextService', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service',
  'KeyCortexEvolutionService', 'KeyCortexPhoneService', 'KeyCortexDocumentService', 'KeyCortexLearningService',
  'KeyAutonomySafetyService', 'KeyCortexApprovalOrchestratorService', 'KeyCortexConsciousnessService',
  'KeyCortexSessionService', 'KeyCortexAwarenessService',
]);

beforeAll(async () => {
  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const controllerModule: any = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexController } = controllerModule;
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');
  const { AutonomyOrchestratorService } = await import('../src/modules/key-autonomy/autonomy-orchestrator.service');

  // The production build (tsc, emitDecoratorMetadata) records the constructor
  // parameter types Nest injects by; vitest's esbuild transform does not. This
  // writes what tsc emits for the 23 typed parameters (as key-cortex-tenant-binding
  // does); a parameter declared with @Inject() names its own token.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
      KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
      KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
      KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
      KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
      KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
    ], KeyCortexController);
  }
  // The body classes the ValidationPipe reads, for the handlers driven here (the principal is Object).
  for (const [method, types] of [
    ['executeCommand', [controllerModule.ExecuteCommandDto, Object, Object]],
    ['executeBatch', [controllerModule.ExecuteBatchDto, Object, Object]],
    ['queryModule', [controllerModule.QueryModuleDto, Object, Object]],
  ] as const) {
    if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, method)) {
      Reflect.defineMetadata('design:paramtypes', types, KeyCortexController.prototype, method);
    }
  }

  const connector: any = {
    execute: async (c: any) => {
      connectorCalls.push({ module: c?.module, action: c?.action, businessId: c?.businessId, userId: c?.userId, parameters: c?.parameters });
      return { success: true, data: { ok: true }, executionTimeMs: 1, command: c };
    },
    // As KeyCortexConnectorService.query: any name becomes a command handed to execute (review SEC-V131c-2).
    query: async (module: unknown, queryName: unknown, parameters: unknown, businessId: unknown, userId: unknown) =>
      connector.execute({ module, action: queryName, parameters, businessId, userId, source: 'key_cortex', timestamp: new Date(), correlationId: 'v31c_q' }),
    getAllCapabilities: () => [],
  };
  const autonomy = {
    evaluateAction: async (businessId: unknown, actionKey: unknown, params: unknown, opts?: { proposedBy?: unknown }) => {
      cortexAutonomyCalls.push({ businessId, actionKey, proposedBy: opts?.proposedBy });
      cortexGateParams.push({ actionKey, parameters: params });
      if (cortexVerdict === 'throw') throw new Error('v31c: the autonomy orchestrator is down');
      if (JSON.stringify(params ?? {}).includes(DEALBREAKER)) {
        return { allowed: false, requiresApproval: false, tier: 'manual', reason: 'v31c: a dealbreaker term' };
      }
      return cortexVerdict;
    },
  };
  // The model gateway the flow engine's AI decision calls: records the tenant it was named, answers an option.
  const modelGateway = {
    complete: async (req: { businessId?: unknown }) => {
      modelGatewayCalls.push({ businessId: req?.businessId });
      return { content: 'yes' };
    },
  };
  const command = {
    parseIntent: async () => [{ intent: 'v31c', confidence: 0.9, module: parsedIntent.module, action: parsedIntent.action, parameters: { ...parsedIntent.parameters }, requiresApproval: false, naturalLanguage: 'v31c' }],
    toConnectorCommand: (intent: any, businessId: string, userId: string) => ({
      module: intent.module, action: intent.action, parameters: intent.parameters ?? {}, businessId, userId,
      source: 'key_cortex', timestamp: new Date(), correlationId: `v31c_${Math.random().toString(36).slice(2, 8)}`,
    }),
  };
  const sandbox = new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : async () => { sandboxCalls.push(String(prop)); return { output: 'v31c', exitCode: 0, executionTimeMs: 0 }; }),
  });
  const off = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : () => { throw new Error(`v31c: ${name}.${String(prop)} is off this path`); }),
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      { provide: KeyCortexConnectorService, useValue: connector },
      {
        provide: KeyCortexExecutorService,
        inject: [PrismaService],
        useFactory: (prisma: any) => new KeyCortexExecutorService(connector as any, prisma, { emit: () => true } as any, {} as any, autonomy as any, undefined, undefined),
      },
      {
        provide: KeyCortexFlowStudioService,
        inject: [PrismaService],
        useFactory: (prisma: any) => new KeyCortexFlowStudioService(prisma, connector as any, modelGateway as any, off('aiUsage') as any, new EventEmitter2()),
      },
      { provide: KeyCortexCommandService, useValue: command },
      { provide: KeyCortexContextV2Service, useValue: { getFullContext: async () => ({}) } },
      { provide: KeyCortexSandboxService, useValue: sandbox },
      { provide: AutonomyOrchestratorService, useValue: autonomy },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return CORTEX_OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();
  cortexExecutor = moduleRef.get(KeyCortexExecutorService);

  cortexApp = moduleRef.createNestApplication();
  cortexApp.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  cortexApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await cortexApp.init();

  for (const id of [ID.cxOwner, ID.cxStaffRO, ID.cxStaffW]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.user.create({ data: { id: ID.cxSuper, email: `${P}cxSuper@test.local`, role: 'SUPER_ADMIN' } });
  await db.business.create({ data: { id: ID.cxBiz, name: 'V31c Cortex Biz', ownerId: ID.cxOwner } });
  const m = (userId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_cx`, userId, businessId: ID.cxBiz, role, permissionScopes } });
  await m(ID.cxOwner, 'OWNER');
  await m(ID.cxStaffRO, 'STAFF', { projects: 'read', automations: 'read' });
  await m(ID.cxStaffW, 'STAFF', { projects: 'write', automations: 'write', revenue: 'read' });

  const flow = (id: string, businessId: string, module: string, action: string, parameters: Record<string, unknown>) =>
    db.flowDefinition.create({
      data: {
        id,
        businessId,
        name: `v31c ${module}.${action}`,
        status: 'active',
        trigger: { type: 'manual', config: {} },
        nodes: [
          { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start' }, inputs: [], outputs: ['a1'] },
          { id: 'a1', type: 'action', position: { x: 0, y: 100 }, data: { label: 'Act', module, action, parameters }, inputs: ['t1'], outputs: [] },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'a1' }],
      },
    });
  await flow(ID.cxFlow, ID.cxBiz, 'projects', 'create_project', { name: '{{projectName}}' });
  await flow(ID.cxFlowRev, ID.cxBiz, 'commerce', 'process_payment', { invoiceId: `${P}inv` });
  await flow(ID.cxFlowB, ID.bizB, 'projects', 'create_project', { name: 'b' });
  // Review repairs: a flow of its nodes as given, in cxBiz.
  const flowOf = (id: string, nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>) =>
    db.flowDefinition.create({
      data: {
        id,
        businessId: ID.cxBiz,
        name: `v31c ${id}`,
        status: 'active',
        trigger: { type: 'manual', config: {} },
        nodes: nodes.map((n, i) => ({
          ...n,
          position: { x: 0, y: i * 100 },
          inputs: i === 0 ? [] : [nodes[i - 1].id],
          outputs: i === nodes.length - 1 ? [] : [nodes[i + 1].id],
        })),
        edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
      },
    });
  const start = { id: 't1', type: 'trigger', data: { label: 'Start' } };
  // SEC-V131c-1: trigger -> AI decision (the engine calls the model gateway for context.businessId).
  await flowOf(ID.cxFlowAi, [start, { id: 'd1', type: 'ai_decision', data: { label: 'Decide', prompt: 'v31c decide', options: ['yes', 'no'] } }]);
  // SEC-V131c-4 / CRR-2: the same action twice, a stored parameter and one filled from the inputs.
  await flowOf(ID.cxFlowTwin, [
    start,
    { id: 'a1', type: 'action', data: { label: 'First', module: 'projects', action: 'create_project', parameters: { name: 'v31c benign' } } },
    { id: 'a2', type: 'action', data: { label: 'Second', module: 'projects', action: 'create_project', parameters: { name: '{{text}}' } } },
  ]);
  // A stored parameter the value check denies.
  await flowOf(ID.cxFlowStored, [
    start,
    { id: 'a1', type: 'action', data: { label: 'Only', module: 'projects', action: 'create_project', parameters: { name: `v31c ${DEALBREAKER}` } } },
  ]);
  // A parameter filled only while the flow runs (the first node's output).
  await flowOf(ID.cxFlowChain, [
    start,
    { id: 'a1', type: 'action', data: { label: 'First', module: 'projects', action: 'create_project', parameters: { name: 'v31c chain' } } },
    { id: 'a2', type: 'action', data: { label: 'Second', module: 'projects', action: 'add_task', parameters: { title: '{{a1_output}}' } } },
  ]);
}, 120_000);

afterAll(async () => {
  if (cortexExecutor?.approvalCleanupInterval) clearInterval(cortexExecutor.approvalCleanupInterval);
  if (cortexApp) await cortexApp.close();
});

/*
 * Trial-N repair round 2 (PLAN-APPROVE): a third app with AiController, for POST
 * ai/businesses/:b/ai/plans/:planId/approve. REAL: PrismaService, AuthGuard, BusinessGuard,
 * CrmRateLimitGuard, AiController and PlannerService.approvePlan. Stand-ins: every other
 * collaborator of AiController (no case reaches one) and the event bus, which records
 * 'plan.approved' (on which PlanExecutorService enqueues the plan's steps with no principal).
 */
let aiApp: any;
const planApprovedEvents: Array<{ planId: unknown; businessId: unknown }> = [];

beforeAll(async () => {
  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { PlannerService } = await import('../src/modules/ai/planner.service');

  const events = new EventEmitter2();
  events.on('plan.approved', (payload: { planId: unknown; businessId: unknown }) => void planApprovedEvents.push(payload));
  const moduleRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: events },
      {
        provide: PlannerService,
        inject: [PrismaService],
        useFactory: (prisma: any) => new (PlannerService as any)(prisma, {}, {}, {}, {}, {}),
      },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  aiApp = moduleRef.createNestApplication();
  aiApp.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await aiApp.init();
}, 120_000);

afterAll(async () => {
  if (aiApp) await aiApp.close();
});

/*
 * Trial-N repair round 2 recheck (CRM-DUP-HTTP): a fourth app with CrmController, for GET
 * crm/businesses/:b/duplicates. REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, CrmController, CrmDuplicateDetectionService (the pairs) and
 * CrmStatsService.findDuplicates (the legacy groups, reached through CrmService.findDuplicates).
 * Stand-ins: CrmService answers findDuplicates from the real CrmStatsService; CrmStatsService's
 * timeline and cache, and every other collaborator of CrmController (no case reaches one).
 */
let crmApp: any;

beforeAll(async () => {
  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      CrmDuplicateDetectionService,
      {
        provide: CrmStatsService,
        inject: [PrismaService],
        useFactory: (prisma: any) => new (CrmStatsService as any)(prisma, { logEvent: async () => undefined }, { invalidate: async () => undefined }),
      },
      {
        provide: CrmService,
        inject: [CrmStatsService],
        useFactory: (stats: any) => ({ findDuplicates: (businessId: string) => stats.findDuplicates(businessId) }),
      },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  crmApp = moduleRef.createNestApplication();
  crmApp.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await crmApp.init();
}, 120_000);

afterAll(async () => {
  if (crmApp) await crmApp.close();
});

describe('fixture sanity (real rows)', () => {
  it('seeded the plans, steps, inbox thread and memberships', async () => {
    expect(await db.aiPlanStep.count({ where: { planId: ID.planA, status: 'pending' } })).toBe(5);
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(6);
    expect(await db.aiPlanStep.count({ where: { planId: ID.planC, status: 'pending' } })).toBe(8);
    const msg = await db.keyInboxMessage.findUnique({ where: { id: ID.msgA } });
    expect(msg.suggestedActions).toHaveLength(ACTIONS.length);
  });
});

describe('V1-31b GA: POST /actions/businesses/:businessId/execute executes only a stored plan step', () => {
  it('GA-01 a client tool name and arguments without a stored plan step are refused 400 and nothing runs', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { toolName: 'crm_add_note', args: CLIENT_ARGS });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/plan step/i);
    expect(executions.length).toBe(before);
  });

  it('GA-02 a stored step runs its own tool and arguments; a client toolName and args sent beside the ids are ignored', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sStored, toolName: 'crm_delete_contact', args: CLIENT_ARGS });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    const ran = executions.slice(before);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ businessId: ID.bizA, toolName: 'crm_add_note', args: STORED_ARGS, planId: ID.planA, planStepId: ID.sStored });
    expect(ran[0].action).toMatchObject({ surface: 'GRAPH_ACTION', principalUserId: ID.owner });
    expect(evaluations).not.toContain('crm_delete_contact');
    expect(await stepStatus(ID.sStored)).toBe('completed');

    // Spent: a replay runs nothing.
    const replay = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sStored });
    expect(replay.status).toBe(409);
    expect(executions.length).toBe(before + 1);
  });

  it("GA-03 another business's step id answers 404 byte-identical to an unknown id and runs nothing", async () => {
    const before = executions.length;
    const foreign = await executeGraph(ID.owner, { planId: ID.planB, planStepId: ID.sForeign });
    const unknown = await executeGraph(ID.owner, { planId: `${P}nope`, planStepId: `${P}nope` });
    const mixed = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sForeign });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(mixed.status).toBe(404);
    expect(foreign.text).toBe(unknown.text);
    expect(mixed.text).toBe(unknown.text);
    expect(executions.length).toBe(before);
    expect(await stepStatus(ID.sForeign)).toBe('pending');
  });

  it('GA-04 eight concurrent executes of one stored step run it exactly once; the others are 409', async () => {
    const before = executions.length;
    const responses = await Promise.all(Array.from({ length: 8 }, () => executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sConc })));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(executions.slice(before).filter((e) => e.planStepId === ID.sConc)).toHaveLength(1);
    expect(await stepStatus(ID.sConc)).toBe('completed');
  });

  it("GA-05 the executed tool's module write scope is checked: a member without revenue write is refused 403 and nothing runs", async () => {
    const before = executions.length;
    const res = await executeGraph(ID.staffNoRev, { planId: ID.planA, planStepId: ID.sRev });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/revenue/);
    expect(executions.length).toBe(before);
    expect(await stepStatus(ID.sRev)).toBe('pending');
  });

  it('GA-06 a tool mapped to no module scope is denied by default, even to the OWNER', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sUnmapped });
    expect(res.status).toBe(403);
    expect(executions.length).toBe(before);
    expect(await stepStatus(ID.sUnmapped)).toBe('pending');
  });

  it('GA-07 a stored step that needs formal approval queues one approval item with the stored payload, requested by the real user', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sApproval, args: CLIENT_ARGS });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: false, requiresApproval: true, approvalId: expect.any(String) });
    const item = await db.aiApprovalItem.findUnique({ where: { id: res.body.approvalId } });
    expect(item).toMatchObject({ businessId: ID.bizA, toolName: 'crm_delete_contact', planId: ID.planA, planStepId: ID.sApproval, userId: ID.owner });
    expect(item.inputPayload).toEqual({ contactId: ID.contactA });
    expect(await stepStatus(ID.sApproval)).toBe('awaiting_approval');
    expect(executions.length).toBe(before);

    const again = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sApproval });
    expect(again.status).toBe(409);
    expect(await db.aiApprovalItem.count({ where: { businessId: ID.bizA, planStepId: ID.sApproval } })).toBe(1);
  });

  it('GA-08 no principal is 401 and runs nothing', async () => {
    const before = executions.length;
    const res = await executeGraph(null, { planId: ID.planA, planStepId: ID.sRev });
    expect(res.status).toBe(401);
    expect(executions.length).toBe(before);
  });

  it('GA-09 the plan route answers the stored step ids the execute route takes', async () => {
    const res = await http().post(`/actions/businesses/${ID.bizA}/plan`).set('x-test-user', ID.owner).send({ input: 'note the client' });
    expect(res.status).toBe(201);
    const steps = res.body.plan.steps;
    const rows = await db.aiPlanStep.findMany({ where: { planId: res.body.plan.id }, orderBy: { order: 'asc' } });
    expect(steps.map((s: any) => s.id)).toEqual(rows.map((r: any) => r.id));
  });
});

describe('V1-31b review repairs: who may run a stored step, and when', () => {
  it('GA-10 (SEC-V131b-1) a crm-write member kept to their own book cannot run the contact writes the dispatcher makes without an actor; nothing runs', async () => {
    const before = executions.length;
    for (const stepId of [ID.sPrivUpdate, ID.sPrivDelete, ID.sPrivTag, ID.sCreate]) {
      const res = await executeGraph(ID.staffOwned, { planId: ID.planC, planStepId: stepId });
      expect(res.status, stepId).toBe(403);
      expect(await stepStatus(stepId)).toBe('pending');
    }
    expect(executions.length).toBe(before);
  });

  it('GA-11 (SEC-V131b-1) the row-visibility contact writes run only for the OWNER; crm_create_contact runs for crm_view all with crm_edit any', async () => {
    const before = executions.length;
    // crm write with the default sub-permissions (crm_view all, crm_edit any) still cannot reach another member's PRIVATE contact over HTTP.
    const staff = await executeGraph(ID.staffNoRev, { planId: ID.planC, planStepId: ID.sPrivUpdate });
    expect(staff.status).toBe(403);
    expect(JSON.stringify(staff.body)).toMatch(/business owner/);
    expect(executions.length).toBe(before);

    // Trial-N review (NEW-2): a step runs for the member who proposed it (or the OWNER), so the
    // crm_create_contact case is a step of staffNoRev's own plan (planC is the OWNER's).
    const create = await executeGraph(ID.staffNoRev, { planId: ID.planNoRev, planStepId: ID.sCreateOwn });
    expect(create.status).toBe(201);
    const owner = await executeGraph(ID.owner, { planId: ID.planC, planStepId: ID.sPrivUpdate });
    expect(owner.status).toBe(201);
    const ran = executions.slice(before);
    expect(ran.map((e) => e.toolName)).toEqual(['crm_create_contact', 'crm_update_contact']);
    expect(ran[0].action).toMatchObject({ principalUserId: ID.staffNoRev });
    expect(ran[1].action).toMatchObject({ principalUserId: ID.owner });
  });

  it('GA-12 (CR-2) a stored create_task step runs for the OWNER, and every registry tool is mapped or refused by name', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planC, planStepId: ID.sTask });
    expect(res.status).toBe(201);
    expect(executions.slice(before)).toMatchObject([{ toolName: 'create_task', planStepId: ID.sTask }]);

    const { FLOW_TOOLS } = await import('../src/modules/ai/flow-tool-registry');
    const { graphActionRequirement } = await import('../src/modules/ai/graph-actions.controller');
    const names = FLOW_TOOLS.map((t: { name: string }) => t.name);
    expect(names.filter((n: string) => graphActionRequirement(n) === null)).toEqual([]);
    expect(names.filter((n: string) => 'refused' in (graphActionRequirement(n) ?? {}))).toEqual(['execute_custom_logic']);
  });

  it('GA-13 (CR-3) a tool some route governs needs exactly the module and level of CANONICAL_MODULE_TOOLS', async () => {
    const { CANONICAL_MODULE_TOOLS } = await import('../src/modules/structure/job-role-policy.service');
    const { graphActionModuleScope } = await import('../src/modules/ai/graph-actions.controller');
    const mismatches: string[] = [];
    for (const [module, tools] of Object.entries(CANONICAL_MODULE_TOOLS)) {
      for (const [tool, level] of Object.entries(tools as Record<string, string>)) {
        const got = graphActionModuleScope(tool);
        if (!got || got.module !== module || got.minLevel !== level) mismatches.push(`${tool}: ${module}:${level} != ${got?.module}:${got?.minLevel}`);
      }
    }
    expect(mismatches).toEqual([]);

    // Trial-N review: the members run steps of their own plans (NEW-2), and the crm read case is
    // crm_list_deals, because crm_list_contacts reads every contact with no actor (NEW-4, GA-18).
    const before = executions.length;
    const pay = await executeGraph(ID.staffExp, { planId: ID.planExp, planStepId: ID.sPayBillOwn });
    expect(pay.status).toBe(201);
    const extract = await executeGraph(ID.staffExp, { planId: ID.planC, planStepId: ID.sExtract });
    expect(extract.status).toBe(403);
    expect(JSON.stringify(extract.body)).toMatch(/operations requires write/);
    const list = await executeGraph(ID.staffNoCrm, { planId: ID.planNoCrm, planStepId: ID.sListDealsOwn });
    expect(list.status).toBe(201);
    expect(executions.slice(before).map((e) => e.toolName)).toEqual(['finance_pay_bill', 'crm_list_deals']);
    expect(await stepStatus(ID.sExtract)).toBe('pending');
  });

  it('GA-14 (SEC-V131b-2) a step of a plan the plan executor drives is 409; a plan approved between the read and the claim loses the claim; nothing runs', async () => {
    const before = executions.length;
    const approved = await executeGraph(ID.owner, { planId: ID.planApproved, planStepId: ID.sApprovedPlan });
    const executing = await executeGraph(ID.owner, { planId: ID.planExecuting, planStepId: ID.sExecutingPlan });
    expect([approved.status, executing.status]).toEqual([409, 409]);

    beforeEvaluate = async () => {
      await db.aiPlan.update({ where: { id: ID.planRace }, data: { status: 'approved' } });
    };
    try {
      const raced = await executeGraph(ID.owner, { planId: ID.planRace, planStepId: ID.sRace });
      expect(raced.status).toBe(409);
    } finally {
      beforeEvaluate = null;
    }
    expect(executions.length).toBe(before);
    for (const stepId of [ID.sApprovedPlan, ID.sExecutingPlan, ID.sRace]) expect(await stepStatus(stepId)).toBe('pending');
  });

  it('GA-15 (SEC-V131b-5) an executed step and a queued approval are on record under the member who asked', async () => {
    const logs = await db.aiExecutionLog.findMany({ where: { businessId: ID.bizA, planStepId: { in: [ID.sTask, ID.sApproval, ID.sPrivUpdate] } } });
    expect(logs.find((l: any) => l.planStepId === ID.sTask)).toMatchObject({
      action: 'graph_action:execute', actor: 'user', userId: ID.owner, toolName: 'create_task', planId: ID.planC, success: true,
    });
    expect(logs.find((l: any) => l.planStepId === ID.sPrivUpdate)).toMatchObject({ action: 'graph_action:execute', userId: ID.owner });
    expect(logs.find((l: any) => l.planStepId === ID.sApproval)).toMatchObject({ action: 'approval_queued_graph_action', userId: ID.owner, planId: ID.planA });
  });
});

describe('Trial-N integration review: who may run a stored step, what it may read, and an approved step', () => {
  it('GA-16 (NEW-1, D-46) a platform SUPER_ADMIN who is not a member of the business does not write its invoices: 403 and nothing runs', async () => {
    const before = executions.length;
    for (const stepId of [ID.sSuperRev, ID.sSuperSend]) {
      const res = await executeGraph(ID.superNM, { planId: ID.planD, planStepId: stepId });
      expect(res.status, `${stepId} ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/not a member/i);
      expect(await stepStatus(stepId)).toBe('pending');
    }
    expect(executions.length).toBe(before);
  });

  it("GA-17 (NEW-2) a step runs for the member who proposed it or the business OWNER: another member holding the tool's scopes is 403 and nothing runs", async () => {
    const before = executions.length;
    const other = await executeGraph(ID.staffNoRev, { planId: ID.planD, planStepId: ID.sOwnerNote });
    expect(other.status, JSON.stringify(other.body)).toBe(403);
    expect(JSON.stringify(other.body)).toMatch(/proposed it or the business owner/);
    expect(await stepStatus(ID.sOwnerNote)).toBe('pending');
    expect(executions.length).toBe(before);

    // The OWNER may run a member's step (as KeyCortexPlannerService.assertMayExecutePlan admits for a KEY plan).
    const owner = await executeGraph(ID.owner, { planId: ID.planNoRev, planStepId: ID.sNoRevNote });
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect(executions.slice(before)).toMatchObject([{ toolName: 'crm_add_note', planStepId: ID.sNoRevNote, action: { principalUserId: ID.owner } }]);
  });

  // Aligned in trial-N repair round 2 (CONTACT-READ-ABORT, D-37): this case pinned the first repair's
  // OWNER-only rule, which answered 403 to every other member (ADMIN included), so a control-tower run
  // that starts with a contact lookup stopped. The reads now run for a crm-read member AS that member
  // (the executor is handed them as principal) and the dispatcher applies their CRM visibility, so the
  // OWNER's PRIVATE contact still never reaches them (GA-21 runs the real dispatcher on the real rows).
  it('GA-18 (NEW-4) the contact reads the dispatcher makes run for a crm-read member as that member (their visibility applies, GA-21) and for the OWNER', async () => {
    const before = executions.length;
    const member = await executeGraph(ID.staffNoCrm, { planId: ID.planNoCrm, planStepId: ID.sSearchContactsOwn });
    expect(member.status, JSON.stringify(member.body)).toBe(201);
    const owner = await executeGraph(ID.owner, { planId: ID.planNoCrm, planStepId: ID.sListContactsOwn });
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect(executions.slice(before)).toMatchObject([
      { toolName: 'crm_search_contacts', action: { principalUserId: ID.staffNoCrm } },
      { toolName: 'crm_list_contacts', action: { principalUserId: ID.owner } },
    ]);
  });

  it('GA-19 (correctness NEW-3) a step queued for approval runs once it is approved: no second approval item, and it runs once with its stored arguments', async () => {
    const before = executions.length;
    const queued = await executeGraph(ID.owner, { planId: ID.planD, planStepId: ID.sApproveThenRun });
    expect(queued.status).toBe(201);
    expect(queued.body).toMatchObject({ success: false, requiresApproval: true, approvalId: expect.any(String) });
    expect(await stepStatus(ID.sApproveThenRun)).toBe('awaiting_approval');

    // What AiOversightService.finalizeResolution writes when the item is approved.
    await db.aiApprovalItem.update({ where: { id: queued.body.approvalId }, data: { status: 'approved', resolvedAt: new Date(), resolution: 'approved' } });
    await db.aiPlanStep.update({ where: { id: ID.sApproveThenRun }, data: { status: 'pending' } });

    const ran = await executeGraph(ID.owner, { planId: ID.planD, planStepId: ID.sApproveThenRun });
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    expect(ran.body).toMatchObject({ success: true });
    expect(await db.aiApprovalItem.count({ where: { businessId: ID.bizA, planStepId: ID.sApproveThenRun } })).toBe(1);
    expect(executions.slice(before)).toMatchObject([{ toolName: 'crm_delete_contact', args: { contactId: ID.contactA }, planStepId: ID.sApproveThenRun }]);
    expect(await stepStatus(ID.sApproveThenRun)).toBe('completed');

    const replay = await executeGraph(ID.owner, { planId: ID.planD, planStepId: ID.sApproveThenRun });
    expect(replay.status).toBe(409);
    expect(executions.length).toBe(before + 1);
  });

  it("GA-20 (correctness NEW-2 / CRR-1) the planner stores a step whose tool the registry does not list (its 'analyze' step) with no tool, so the web callers skip it and run the next step", async () => {
    const { PlannerService } = await import('../src/modules/ai/planner.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const aiUsage = {
      callAi: async () => ({
        content: JSON.stringify({
          steps: [
            { order: 1, toolName: 'analyze', module: 'crm', action: 'Review the contact', description: 'v31b analyze', riskTier: 1, inputPayload: null },
            { order: 2, toolName: 'crm_add_note', module: 'crm', action: 'Add a note', description: 'v31b note', riskTier: 1, inputPayload: STORED_ARGS },
          ],
        }),
      }),
    };
    const graph = { getSnapshot: async () => ({}), buildContextString: () => 'v31b' };
    const memory = { buildContextBlock: async () => ({}), buildPromptSection: () => '' };
    const blueprint = { getBlueprintContext: async () => null };
    const governance = { getToolTier: () => 1 };
    const planner = new PlannerService(app.get(PrismaService), aiUsage as any, graph as any, governance as any, memory as any, blueprint as any);
    const intent = { objective: 'v31b planner', rawInput: 'v31b planner', urgency: 'normal', modules: ['crm'], scope: [], missingInfo: [], actionCandidates: [], clarificationNeeded: false };
    const plan = await planner.createPlan(ID.bizA, intent as any, ID.owner);
    const rows = await db.aiPlanStep.findMany({ where: { planId: plan.id }, orderBy: { order: 'asc' } });
    expect(rows.map((r: any) => r.toolName)).toEqual([null, 'crm_add_note']);

    const before = executions.length;
    const analyze = await executeGraph(ID.owner, { planId: plan.id, planStepId: rows[0].id });
    expect(analyze.status).toBe(400);
    const note = await executeGraph(ID.owner, { planId: plan.id, planStepId: rows[1].id });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(executions.slice(before).map((e) => e.toolName)).toEqual(['crm_add_note']);
  });
});

/**
 * Trial-N repair round 2. The real dispatcher (FlowOrchestratorService's tool switch) on the real
 * contact rows, for the principal the graph route hands it; its other collaborators are off this
 * path (the contact reads use only Prisma and, for the duplicate tools, CrmDuplicateDetectionService).
 */
async function realContactDispatcher() {
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const prisma = app.get(PrismaService);
  const duplicates = new CrmDuplicateDetectionService(prisma);
  const moduleRef = {
    get: (token: any) => {
      if (token === CrmDuplicateDetectionService) return duplicates;
      throw new Error(`v31b: ${token?.name ?? String(token)} is off the contact-read path`);
    },
  };
  // FlowOrchestratorService's 17 constructor parameters: Prisma first, ModuleRef last.
  const orchestrator: any = new (FlowOrchestratorService as any)(prisma, ...Array.from({ length: 15 }, () => ({})), moduleRef);
  return (toolName: string, args: Record<string, unknown>, principalUserId: string | null) =>
    orchestrator.executeToolAction(ID.bizR, toolName, args, { surface: 'GRAPH_ACTION', principalUserId });
}

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

function queue(actor: string, businessId = ID.bizR) {
  return http().get(`/actions/businesses/${businessId}/queue?limit=100`).set('x-test-user', actor);
}

function approvePlanRoute(actor: string, planId: string, businessId = ID.bizR) {
  return request(aiApp.getHttpServer()).post(`/ai/businesses/${businessId}/ai/plans/${planId}/approve`).set('x-test-user', actor).send({});
}

const planStatus = async (id: string) => (await db.aiPlan.findUnique({ where: { id }, select: { status: true } }))?.status ?? null;

describe('Trial-N repair round 2: contact reads under the member\'s visibility, plan approval, the action queue, deny actor, D-46 on KEY plans (separate suite), D-70', () => {
  it('GA-21 (CONTACT-READ-ABORT, D-37) crm_search_contacts and crm_list_contacts run for a crm-read member (and an ADMIN) under their visibility: the OWNER\'s PRIVATE contact never reaches them; the OWNER reads it', async () => {
    const before = executions.length;
    for (const [actor, stepId] of [[ID.rStaff, ID.sRSearch], [ID.rStaff, ID.sRList]] as const) {
      const res = await executeGraph(actor, { planId: ID.planRStaff, planStepId: stepId }, ID.bizR);
      expect(res.status, `${stepId} ${JSON.stringify(res.body)}`).toBe(201);
    }
    expect(executions.slice(before)).toMatchObject([
      { toolName: 'crm_search_contacts', action: { principalUserId: ID.rStaff } },
      { toolName: 'crm_list_contacts', action: { principalUserId: ID.rStaff } },
    ]);

    const run = await realContactDispatcher();
    for (const tool of ['crm_search_contacts', 'crm_list_contacts']) {
      const args = tool === 'crm_search_contacts' ? { query: 'Rdup' } : { limit: 50 };
      expect(idsOf((await run(tool, args, ID.rStaff)).contacts), `${tool} rStaff`).toEqual([ID.rOwnedC, ID.rTeam].sort());
      expect(idsOf((await run(tool, args, ID.rAdmin)).contacts), `${tool} rAdmin`).toEqual([ID.rOwnedC, ID.rTeam].sort());
      expect(idsOf((await run(tool, args, ID.rStaffOwned)).contacts), `${tool} rStaffOwned`).toEqual([ID.rOwnedC]);
      expect(idsOf((await run(tool, args, ID.rOwner)).contacts), `${tool} rOwner`).toEqual([ID.rOwnedC, ID.rPriv, ID.rTeam].sort());
    }
  });

  it('GA-22 (NEW-4-REST) crm_find_duplicates and crm_merge_preview apply the member\'s visibility: a pair or a preview that names a contact the member cannot open is not answered; the OWNER\'s is', async () => {
    const run = await realContactDispatcher();
    const pairKey = (p: { primaryId: string; duplicateId: string }) => [p.primaryId, p.duplicateId].sort().join('|');
    const privPair = [ID.rPriv, ID.rTeam].sort().join('|');

    const owner = await run('crm_find_duplicates', { minConfidence: 0.9 }, ID.rOwner);
    expect(owner.pairs.map(pairKey)).toContain(privPair);
    for (const actor of [ID.rStaff, ID.rAdmin, ID.rStaffOwned]) {
      const res = await run('crm_find_duplicates', { minConfidence: 0.9 }, actor);
      expect(res.pairs.map(pairKey), actor).not.toContain(privPair);
      expect(JSON.stringify(res), actor).not.toContain(ID.rPriv);
      expect(res.total, actor).toBe(res.pairs.length);
    }

    const ownerPreview = await run('crm_merge_preview', { primaryId: ID.rTeam, duplicateId: ID.rPriv }, ID.rOwner);
    expect(ownerPreview.preview).not.toBeNull();
    for (const actor of [ID.rStaff, ID.rAdmin]) {
      const res = await run('crm_merge_preview', { primaryId: ID.rTeam, duplicateId: ID.rPriv }, actor);
      expect(res, actor).toEqual({ preview: null });
    }

    // The graph route runs both for a crm-read member, as that member.
    const before = executions.length;
    for (const stepId of [ID.sRDup, ID.sRPreview]) {
      const res = await executeGraph(ID.rStaff, { planId: ID.planRStaff, planStepId: stepId }, ID.bizR);
      expect(res.status, `${stepId} ${JSON.stringify(res.body)}`).toBe(201);
    }
    expect(executions.slice(before)).toMatchObject([
      { toolName: 'crm_find_duplicates', action: { principalUserId: ID.rStaff } },
      { toolName: 'crm_merge_preview', action: { principalUserId: ID.rStaff } },
    ]);
  });

  it('QR-01 (QUEUE-READ) GET actions/.../queue shows a STAFF member only their own plans and only the steps whose module they may read: no other member\'s plan, step id or inputPayload', async () => {
    const res = await queue(ID.rStaff);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const text = JSON.stringify(res.body);
    const planIds = (res.body.plans as Array<{ id: string }>).map((p) => p.id);
    expect(planIds).toEqual([ID.planRStaff]);
    for (const hidden of [ID.planROwner, ID.sROwnerNote, ID.sROwnerInv, 'v31b owner-only note text', `${P}rinv_owner`, ID.planApvOther, ID.planRun, ID.sRunDel]) {
      expect(text, hidden).not.toContain(hidden);
    }
    // Their own plan's revenue step (no revenue scope) is not shown either.
    const own = (res.body.plans as Array<{ id: string; steps: Array<{ id: string }> }>)[0];
    expect(own.steps.map((s) => s.id)).not.toContain(ID.sRStaffRev);
    expect(text).not.toContain(`${P}rinv_staff`);
  });

  it('QR-02 (QUEUE-READ) the OWNER and an ADMIN see every plan of the business with its steps', async () => {
    for (const actor of [ID.rOwner, ID.rAdmin]) {
      const res = await queue(actor);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const planIds = (res.body.plans as Array<{ id: string }>).map((p) => p.id);
      for (const planId of [ID.planRStaff, ID.planROwner, ID.planApvOther, ID.planRun]) expect(planIds, `${actor} ${planId}`).toContain(planId);
      const ownerPlan = (res.body.plans as Array<{ id: string; steps: Array<{ id: string }> }>).find((p) => p.id === ID.planROwner)!;
      expect(ownerPlan.steps.map((s) => s.id).sort(), actor).toEqual([ID.sROwnerInv, ID.sROwnerNote].sort());
    }
  });

  it('PA-01 (PLAN-APPROVE) another member\'s draft plan is not approved by a STAFF member holding its scopes: 403, the plan stays draft and nothing is enqueued; an ADMIN approves it', async () => {
    const res = await approvePlanRoute(ID.rStaffW, ID.planApvOther);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/proposed it/);
    expect(await planStatus(ID.planApvOther)).toBe('draft');
    expect(planApprovedEvents.map((e) => e.planId)).not.toContain(ID.planApvOther);

    const admin = await approvePlanRoute(ID.rAdmin, ID.planApvOther);
    expect(admin.status, JSON.stringify(admin.body)).toBe(201);
    expect(await planStatus(ID.planApvOther)).toBe('approved');
    expect(planApprovedEvents.filter((e) => e.planId === ID.planApvOther)).toHaveLength(1);
  });

  it('PA-02 (PLAN-APPROVE) the proposer approves their own plan only when they hold its steps\' module scopes: revenue read is 403 for an invoice write; crm write approves a note', async () => {
    const rev = await approvePlanRoute(ID.rStaffRev, ID.planApvRev);
    expect(rev.status, JSON.stringify(rev.body)).toBe(403);
    expect(JSON.stringify(rev.body)).toMatch(/revenue requires write/);
    expect(await planStatus(ID.planApvRev)).toBe('draft');

    const own = await approvePlanRoute(ID.rStaffW, ID.planApvOwn);
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(await planStatus(ID.planApvOwn)).toBe('approved');
    expect(planApprovedEvents.map((e) => e.planId)).not.toContain(ID.planApvRev);
  });

  it('PA-03 (PLAN-APPROVE, D-46) a platform SUPER_ADMIN who is not a member does not approve a plan that writes the business\'s invoices', async () => {
    const res = await approvePlanRoute(ID.superNM, ID.planApvSuper);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/not a member/i);
    expect(await planStatus(ID.planApvSuper)).toBe('draft');
    expect(planApprovedEvents.map((e) => e.planId)).not.toContain(ID.planApvSuper);
  });

  it('PA-04 (PLAN-APPROVE) a plan whose contact read the plan executor runs with no principal (no visibility applies) is approved only by the OWNER, not by an ADMIN who proposed it', async () => {
    const admin = await approvePlanRoute(ID.rAdmin, ID.planApvList);
    expect(admin.status, JSON.stringify(admin.body)).toBe(403);
    expect(JSON.stringify(admin.body)).toMatch(/business owner/);
    expect(await planStatus(ID.planApvList)).toBe('draft');
    const owner = await approvePlanRoute(ID.rOwner, ID.planApvList);
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect(await planStatus(ID.planApvList)).toBe('approved');
  });

  it('RUN-01 (D-70) an approved queued step is listed on the queue with its stored ids for a member who may run it (not for one who may not), and running it from there executes exactly that step once', async () => {
    const queued = await executeGraph(ID.rOwner, { planId: ID.planRun, planStepId: ID.sRunDel }, ID.bizR);
    expect(queued.status).toBe(201);
    expect(queued.body).toMatchObject({ requiresApproval: true, approvalId: expect.any(String) });
    // What AiOversightService.finalizeResolution writes when the item is approved.
    await db.aiApprovalItem.update({ where: { id: queued.body.approvalId }, data: { status: 'approved', resolvedAt: new Date(), resolution: 'approved' } });
    await db.aiPlanStep.update({ where: { id: ID.sRunDel }, data: { status: 'pending' } });

    const ownerQueue = await queue(ID.rOwner);
    expect(ownerQueue.status).toBe(200);
    const item = (ownerQueue.body.items as Array<Record<string, unknown>>).find((i) => i.planStepId === ID.sRunDel);
    expect(item).toMatchObject({ type: 'approved_step', status: 'approved', planId: ID.planRun, planStepId: ID.sRunDel, approvalId: queued.body.approvalId, toolName: 'crm_delete_contact' });
    const staffQueue = await queue(ID.rStaff);
    expect(JSON.stringify(staffQueue.body)).not.toContain(ID.sRunDel);

    const before = executions.length;
    const ran = await executeGraph(ID.rOwner, { planId: item!.planId, planStepId: item!.planStepId }, ID.bizR);
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    expect(ran.body).toMatchObject({ success: true });
    expect(executions.slice(before)).toMatchObject([{ toolName: 'crm_delete_contact', args: { contactId: ID.rTeam }, planStepId: ID.sRunDel }]);
    const after = await queue(ID.rOwner);
    expect((after.body.items as Array<Record<string, unknown>>).filter((i) => i.planStepId === ID.sRunDel)).toEqual([]);
  });

  it('AP-06 (DENY-ACTOR) a denied autopilot task names the member who denied it on the audit trail (a BusinessEvent, D-08), over HTTP and through the cortex adapter', async () => {
    const from = businessEvents.length;
    const res = await http().post(`/autopilot/businesses/${ID.bizA}/tasks/${ID.taskG}/deny`).set('x-test-user', ID.owner).send({});
    expect(res.status).toBe(201);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskG } })).toMatchObject({ status: 'SKIPPED' });

    const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');
    const { AutopilotAdapterService } = await import('../src/modules/key-cortex/adapters/autopilot-adapter.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const adapter = new AutopilotAdapterService(app.get(AutopilotService), {} as any, app.get(PrismaService));
    const rejected = await adapter.execute({
      module: 'autopilot', action: 'reject_task', parameters: { taskId: ID.taskH, reason: 'v31b no' }, businessId: ID.bizA, userId: ID.staffNoRev,
      source: 'key_cortex', timestamp: new Date(), correlationId: 'v31b_ap06',
    } as any);
    expect(rejected.success, JSON.stringify(rejected)).toBe(true);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskH } })).toMatchObject({ status: 'SKIPPED' });

    const denied = businessEvents.slice(from).filter((e) => e.subjectType === 'autopilot_task');
    expect(denied).toMatchObject([
      { businessId: ID.bizA, subjectId: ID.taskG, actorType: 'human', actorId: ID.owner, action: 'deny', after: { status: 'SKIPPED' } },
      { businessId: ID.bizA, subjectId: ID.taskH, actorType: 'human', actorId: ID.staffNoRev, action: 'deny', after: { status: 'SKIPPED' } },
    ]);
  });
});

function aiPlans(actor: string, suffix = '', businessId = ID.bizR) {
  return request(aiApp.getHttpServer()).get(`/ai/businesses/${businessId}/ai/plans${suffix}`).set('x-test-user', actor);
}

function crmDuplicates(actor: string, businessId = ID.bizDup) {
  return request(crmApp.getHttpServer()).get(`/crm/businesses/${businessId}/duplicates?minConfidence=0.5`).set('x-test-user', actor);
}

/**
 * Trial-N repair round 2, recheck (items still open after round 1):
 *   - APPROVE-NOTOOL: POST ai/plans/:planId/approve skipped a step whose toolName is null ("runs
 *     nothing"), but PlanExecutorService runs `step.toolName ?? step.action`, and PlannerService
 *     stores the model's action verbatim. So a step named only by its action skipped the scope,
 *     owner-only, D-46 and no-principal contact-read checks. Required: the approval checks the tool
 *     the executor will run; a step whose action names nothing the dispatcher runs (an analyze
 *     step) still needs nothing.
 *   - AI-PLANS-READ: GET ai/plans and GET ai/plans/:planId returned every plan's steps, inputPayload
 *     and outputResult to any member (the QUEUE-READ rule, undone). Required: the queue's rule
 *     (a plan to its proposer, the OWNER, an ADMIN or a SUPER_ADMIN; a step under its tool's module
 *     read), another member's plan answered as an unknown one; and the output of a contact read
 *     the plan executor ran with no principal (every contact, PRIVATE ones included) shown only
 *     to the OWNER (or a SUPER_ADMIN), on the plans routes and the queue alike.
 *   - CRM-DUP-HTTP: GET crm/.../duplicates returned findCandidatesScoped's pairs and the legacy
 *     groups with no visibility clause, so a crm-read STAFF member got pairs and groups naming the
 *     OWNER's PRIVATE contact. Required: what the dispatcher's crm_find_duplicates applies (D-37):
 *     only pairs, and groups of at least two contacts, the member may open.
 */
describe('Trial-N repair round 2 recheck: plan approval of tool-less steps, the plans read, GET duplicates', () => {
  it('PA-05 (APPROVE-NOTOOL) a step stored with no toolName runs its action as the tool, so approval checks that action: crm_list_contacts and commerce_create_invoice named only by their action are 403 for their STAFF proposer; nothing is approved or enqueued; the OWNER approves the contact read', async () => {
    const list = await approvePlanRoute(ID.rStaffOwned, ID.planApvNoToolList);
    expect(list.status, JSON.stringify(list.body)).toBe(403);
    expect(JSON.stringify(list.body)).toMatch(/business owner/);
    const inv = await approvePlanRoute(ID.rStaffOwned, ID.planApvNoToolInv);
    expect(inv.status, JSON.stringify(inv.body)).toBe(403);
    expect(JSON.stringify(inv.body)).toMatch(/revenue requires write/);
    for (const planId of [ID.planApvNoToolList, ID.planApvNoToolInv]) {
      expect(await planStatus(planId), planId).toBe('draft');
      expect(planApprovedEvents.map((e) => e.planId), planId).not.toContain(planId);
    }

    const owner = await approvePlanRoute(ID.rOwner, ID.planApvNoToolList);
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect(await planStatus(ID.planApvNoToolList)).toBe('approved');
  });

  it('PA-06 (APPROVE-NOTOOL) regression control: a step with no toolName whose action names no tool the dispatcher runs (an analyze step) needs nothing; its proposer approves the plan', async () => {
    const res = await approvePlanRoute(ID.rStaffW, ID.planApvNoToolText);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await planStatus(ID.planApvNoToolText)).toBe('approved');
    expect(planApprovedEvents.filter((e) => e.planId === ID.planApvNoToolText)).toHaveLength(1);
  });

  it('AR-01 (AI-PLANS-READ) GET ai/plans shows a STAFF member only their own plans and only the steps whose module they may read: no other member\'s plan, step id or inputPayload', async () => {
    const res = await aiPlans(ID.rStaff, '?limit=100');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const text = JSON.stringify(res.body);
    expect((res.body as Array<{ id: string }>).map((p) => p.id)).toEqual([ID.planRStaff]);
    for (const hidden of [ID.planROwner, ID.sROwnerNote, ID.sROwnerInv, 'v31b owner-only note text', `${P}rinv_owner`, ID.planApvOther, ID.planRun, ID.sRunDel, ID.planROut]) {
      expect(text, hidden).not.toContain(hidden);
    }
    const own = (res.body as Array<{ id: string; steps: Array<{ id: string }> }>)[0];
    expect(own.steps.map((s) => s.id)).toContain(ID.sRSearch);
    expect(own.steps.map((s) => s.id)).not.toContain(ID.sRStaffRev);
    expect(text).not.toContain(`${P}rinv_staff`);
  });

  it('AR-02 (AI-PLANS-READ) GET ai/plans/:planId answers another member\'s plan exactly as an unknown id, and the viewer\'s own plan without the steps they may not read', async () => {
    const hidden = await aiPlans(ID.rStaff, `/${ID.planROwner}`);
    const unknown = await aiPlans(ID.rStaff, `/${P}no_such_plan`);
    expect(hidden.status).toBe(unknown.status);
    expect(hidden.text).toBe(unknown.text);
    expect(hidden.text).not.toContain(ID.sROwnerInv);

    const own = await aiPlans(ID.rStaff, `/${ID.planRStaff}`);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({ id: ID.planRStaff });
    const stepIds = (own.body.steps as Array<{ id: string }>).map((s) => s.id);
    expect(stepIds).toContain(ID.sRSearch);
    expect(stepIds).not.toContain(ID.sRStaffRev);
    expect(own.text).not.toContain(`${P}rinv_staff`);
  });

  it('AR-03 (AI-PLANS-READ) regression control: the OWNER and an ADMIN see every plan of the business, and the OWNER every step', async () => {
    for (const actor of [ID.rOwner, ID.rAdmin]) {
      const res = await aiPlans(actor, '?limit=100');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const planIds = (res.body as Array<{ id: string }>).map((p) => p.id);
      for (const planId of [ID.planRStaff, ID.planROwner, ID.planApvOther, ID.planRun, ID.planROut]) expect(planIds, `${actor} ${planId}`).toContain(planId);
      const detail = await aiPlans(actor, `/${ID.planROwner}`);
      expect((detail.body.steps as Array<{ id: string }>).map((s) => s.id).sort(), actor).toEqual([ID.sROwnerInv, ID.sROwnerNote].sort());
    }
  });

  it('AR-04 (AI-PLANS-READ) the output of a contact read the plan executor ran with no principal (it names the OWNER\'s PRIVATE contact) reaches only the OWNER: not its STAFF proposer on GET ai/plans, GET ai/plans/:planId or the queue, nor an ADMIN', async () => {
    for (const res of [await queue(ID.rStaffOwned), await aiPlans(ID.rStaffOwned, '?limit=100'), await aiPlans(ID.rStaffOwned, `/${ID.planROut}`)]) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.text).toContain(ID.sROutList);
      expect(res.text).not.toContain(ID.rPriv);
    }
    const admin = await aiPlans(ID.rAdmin, `/${ID.planROut}`);
    expect(admin.status).toBe(200);
    expect(JSON.stringify(admin.body.steps)).not.toContain(ID.rPriv);

    const owner = await aiPlans(ID.rOwner, `/${ID.planROut}`);
    expect(owner.status).toBe(200);
    expect(JSON.stringify(owner.body.steps)).toContain(ID.rPriv);
  });

  it('DUP-01 (CRM-DUP-HTTP) GET crm/.../duplicates applies the member\'s visibility: a crm-read STAFF member gets no pair and no group naming the OWNER\'s PRIVATE contact; the OWNER gets both', async () => {
    const pairKey = (p: { primaryId: string; duplicateId: string }) => [p.primaryId, p.duplicateId].sort().join('|');
    const privPair = [ID.dPriv, ID.dTeam].sort().join('|');

    const owner = await crmDuplicates(ID.dOwner);
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(owner.body.pairs.map(pairKey)).toContain(privPair);
    expect(owner.body.groups.some((g: { contacts: Array<{ id: string }> }) => g.contacts.some((c) => c.id === ID.dPriv))).toBe(true);

    const staff = await crmDuplicates(ID.dStaff);
    expect(staff.status, JSON.stringify(staff.body)).toBe(200);
    expect(staff.text).not.toContain(ID.dPriv);
    expect(staff.body.pairs).toEqual([]);
    expect(staff.body.total).toBe(0);
    expect(staff.body.groups).toEqual([]);
  });
});

describe('V1-31b AA: ai-approvals resolution records the real principal', () => {
  it('AA-01 resolve and bulk-resolve hand the authenticated user to oversight', async () => {
    resolutions.length = 0;
    const one = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/${ID.itemA}/resolve`).set('x-test-user', ID.owner).send({ resolution: 'approved' });
    const bulk = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/bulk-resolve`).set('x-test-user', ID.owner).send({ ids: [ID.itemA], resolution: 'rejected' });
    expect(one.status).toBe(201);
    expect(bulk.status).toBe(201);
    expect(resolutions.map((r) => r.userId)).toEqual([ID.owner, ID.owner]);
  });

  it('AA-02 without a principal both routes answer 401 and resolve nothing', async () => {
    resolutions.length = 0;
    const one = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/${ID.itemA}/resolve`).send({ resolution: 'approved' });
    const bulk = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/bulk-resolve`).send({ ids: [ID.itemA], resolution: 'approved' });
    expect([one.status, bulk.status]).toEqual([401, 401]);
    expect(resolutions).toEqual([]);
  });
});

describe('V1-31b KI: key-inbox executes a stored suggestion once, under its module scope', () => {
  it('KI-01 a payloadOverride key the suggestion does not let a member edit is refused 400; nothing is written', async () => {
    const tasksBefore = (await contactTasks()).length;
    const eventsBefore = businessEvents.length;
    const res = await executeInbox(ID.owner, ID.threadA, 0, { confirmed: true, messageId: ID.msgA, payloadOverride: { title: 'v31b x', contactId: ID.contactB } });
    expect(res.status).toBe(400);
    expect((await contactTasks()).length).toBe(tasksBefore);
    expect(businessEvents.length).toBe(eventsBefore);
  });

  it('KI-02 eight concurrent executes of one suggestion create one task; the others are 409', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => executeInbox(ID.owner, ID.threadA, 1, { confirmed: true, messageId: ID.msgA })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await contactTasks('v31b stored title 1')).toHaveLength(1);
  });

  it('KI-03 a create_task suggestion needs crm write: a member with crm read is refused 403 and no task is written', async () => {
    const res = await executeInbox(ID.staffNoCrm, ID.threadA, 2, { confirmed: true, messageId: ID.msgA });
    expect(res.status).toBe(403);
    expect(await contactTasks('v31b stored title 2')).toHaveLength(0);
  });

  it('KI-04 a suggestion type mapped to no module scope is refused 400 before any event or execution', async () => {
    const eventsBefore = businessEvents.length;
    const res = await executeInbox(ID.owner, ID.threadA, 3, { confirmed: true, messageId: ID.msgA });
    expect(res.status).toBe(400);
    expect(businessEvents.length).toBe(eventsBefore);
  });

  it("KI-05 another business's thread answers 404 byte-identical to an unknown thread", async () => {
    const foreign = await executeInbox(ID.owner, ID.threadB, 0, { confirmed: true });
    const unknown = await executeInbox(ID.owner, `${P}nothread`, 0, { confirmed: true });
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(unknown.text);
  });

  it('KI-06 an editable title is honoured and the events name the real user', async () => {
    businessEvents.length = 0;
    const res = await executeInbox(ID.owner, ID.threadA, 4, { confirmed: true, messageId: ID.msgA, payloadOverride: { title: 'v31b edited title' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, type: 'create_task' });
    expect(await contactTasks('v31b edited title')).toHaveLength(1);
    expect(businessEvents.map((e) => e.actorId)).toEqual([ID.owner, ID.owner]);
  });

  it('KI-07 (CR-1) a create_task confirm with the title and due date the dialog sends is executed', async () => {
    const res = await executeInbox(ID.owner, ID.threadA, 5, {
      confirmed: true,
      messageId: ID.msgA,
      payloadOverride: { title: 'v31b edited title 5', dueDate: '2026-12-02T09:00:00.000Z' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, type: 'create_task' });
    expect(await contactTasks('v31b edited title 5')).toHaveLength(1);
  });
});

describe('V1-31b AP: autopilot', () => {
  it('AP-01 actions/:actionId/execute has no stored proposal to bind: it is refused 410 and writes nothing', async () => {
    timelineEvents.length = 0;
    const res = await http()
      .post(`/autopilot/businesses/${ID.bizA}/actions/checkin_${ID.contactA}/execute`)
      .set('x-test-user', ID.owner)
      .send({ contactId: ID.contactB, channel: 'whatsapp', message: 'v31b forged send' });
    expect(res.status).toBe(410);
    expect(timelineEvents).toEqual([]);
  });

  it('AP-02 approving an autopilot task records the authenticated user, not the body approvedBy', async () => {
    const res = await http()
      .post(`/autopilot/businesses/${ID.bizA}/tasks/${ID.taskA}/approve`)
      .set('x-test-user', ID.owner)
      .send({ approvedBy: `${P}someone_else` });
    expect(res.status).toBe(201);
    const task = await db.autopilotTask.findUnique({ where: { id: ID.taskA } });
    expect(task.approvedBy).toBe(ID.owner);
  });

  it('AP-03 (SEC-V131b-3) a read-only member can neither approve nor deny (automations write); the OWNER can deny', async () => {
    const approve = await http().post(`/autopilot/businesses/${ID.bizA}/tasks/${ID.taskB}/approve`).set('x-test-user', ID.staffRO).send({});
    const deny = await http().post(`/autopilot/businesses/${ID.bizA}/tasks/${ID.taskB}/deny`).set('x-test-user', ID.staffRO).send({});
    expect([approve.status, deny.status]).toEqual([403, 403]);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskB } })).toMatchObject({ status: 'AWAITING_APPROVAL', approvedBy: null, approvedAt: null });

    const ownerDeny = await http().post(`/autopilot/businesses/${ID.bizA}/tasks/${ID.taskB}/deny`).set('x-test-user', ID.owner).send({});
    expect(ownerDeny.status).toBe(201);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskB } })).toMatchObject({ status: 'SKIPPED' });
  });

  it('AP-04 (SEC-V131b-4) the status route names the caller, never takes executedBy from the body, and never records AUTO_EXECUTED', async () => {
    const route = (taskId: string) => `/autopilot/businesses/${ID.bizA}/tasks/${taskId}/status`;
    const readOnly = await http().patch(route(ID.taskD)).set('x-test-user', ID.staffRO).send({ status: 'AUTO_EXECUTED', executedBy: ID.owner });
    expect(readOnly.status).toBe(403);
    const auto = await http().patch(route(ID.taskD)).set('x-test-user', ID.owner).send({ status: 'AUTO_EXECUTED', executedBy: ID.owner });
    expect(auto.status).toBe(400);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskD } })).toMatchObject({ status: 'PENDING', executedBy: null, executedAt: null });

    const done = await http().patch(route(ID.taskC)).set('x-test-user', ID.owner).send({ status: 'COMPLETED', executedBy: `${P}someone_else` });
    expect(done.status).toBe(200);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskC } })).toMatchObject({ status: 'COMPLETED', executedBy: ID.owner });
  });

  it("AP-05 (trial-N review NEW-3) the cortex autopilot adapter (POST cortex/execute and batch) records the member the command acts for as approver and executor, not 'key-cortex'", async () => {
    const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');
    const { AutopilotAdapterService } = await import('../src/modules/key-cortex/adapters/autopilot-adapter.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const adapter = new AutopilotAdapterService(app.get(AutopilotService), {} as any, app.get(PrismaService));
    const command = (action: string, taskId: string) => ({
      module: 'autopilot', action, parameters: { taskId }, businessId: ID.bizA, userId: ID.staffNoRev,
      source: 'key_cortex', timestamp: new Date(), correlationId: 'v31b_ap05',
    });
    const approved = await adapter.execute(command('approve_task', ID.taskE) as any);
    expect(approved.success, JSON.stringify(approved)).toBe(true);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskE } })).toMatchObject({ status: 'COMPLETED', approvedBy: ID.staffNoRev });
    const completed = await adapter.execute(command('complete_task', ID.taskF) as any);
    expect(completed.success, JSON.stringify(completed)).toBe(true);
    expect(await db.autopilotTask.findUnique({ where: { id: ID.taskF } })).toMatchObject({ status: 'COMPLETED', executedBy: ID.staffNoRev });
  });
});

describe('V1-31b review CR-4 (closed by V1-31c): the control-tower web callers execute only stored plan steps', () => {
  it('CR-4 priority-queue and daily-plan plan in words and execute stored step ids; executePlanStep sends only the ids (behaviour: apps/web control-tower __tests__/action-routes-web.test.tsx)', () => {
    const WEB = path.resolve(__dirname, '../../web/src');
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const file of ['app/app/control-tower/components/priority-queue.tsx', 'app/app/control-tower/components/daily-plan.tsx']) {
      const src = strip(readFileSync(path.join(WEB, file), 'utf8'));
      expect(src, file).not.toMatch(/\bexecuteAction\s*\(/);
      expect(src, file).toMatch(/\brunPlannedAction\s*\(/);
    }
    const client = strip(readFileSync(path.join(WEB, 'lib/client.ts'), 'utf8'));
    const start = client.indexOf('export async function executePlanStep(');
    expect(start).toBeGreaterThan(-1);
    const fn = client.slice(start, client.indexOf('\n}\n', start));
    expect(fn).toMatch(/body:\s*\{\s*planId,\s*planStepId\s*\}/);
    expect(fn).not.toMatch(/toolName|args/);
  });
});

/* ------------------------------------------------------------------------ */
/*  V1-31c: the cortex direct-action routes (KeyCortexController)            */
/* ------------------------------------------------------------------------ */

function cortex(route: string, actor: string | null, body: Record<string, unknown>) {
  const req = request(cortexApp.getHttpServer()).post(`/api/v1/cortex/${route}`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

const structuredCmd = (module: string, action: string, parameters: Record<string, unknown> = {}, businessId = ID.cxBiz) =>
  ({ businessId, command: '', module, action, parameters });

/** The ai_execution_logs rows written for cxBiz since `since` (a row-id snapshot), oldest first. */
async function cxAuditIds(): Promise<Set<string>> {
  const rows = await db.aiExecutionLog.findMany({ where: { businessId: { in: [ID.cxBiz, ID.bizB] } }, select: { id: true } });
  return new Set(rows.map((r: any) => r.id));
}
async function cxAuditSince(since: Set<string>) {
  const rows = await db.aiExecutionLog.findMany({ where: { businessId: { in: [ID.cxBiz, ID.bizB] } }, orderBy: { createdAt: 'asc' } });
  return rows.filter((r: any) => !since.has(r.id));
}
const flowRuns = (flowId: string) => db.flowExecution.count({ where: { flowId } });

describe('V1-31c CX: POST execute and POST batch run a member-initiated command only under its own module write scope', () => {
  it('CX-01 a member without the module write scope (projects read) is refused 403, nothing reaches the connector, and a row names the member', async () => {
    const before = connectorCalls.length;
    const audit = await cxAuditIds();
    const res = await cortex('execute', ID.cxStaffRO, structuredCmd('projects', 'create_project', { name: 'v31c ro' }));
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/projects requires write/);
    expect(connectorCalls.length).toBe(before);
    const rows = await cxAuditSince(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.cxBiz, userId: ID.cxStaffRO, actor: 'user', module: 'projects', action: 'create_project', success: false });
    expect(String(rows[0].errorMessage)).toMatch(/projects requires write/);
  });

  it('CX-02 a member of another business naming this one is refused 403 by BusinessGuard and nothing runs', async () => {
    const before = { connector: connectorCalls.length, autonomy: cortexAutonomyCalls.length };
    const res = await cortex('execute', ID.other, structuredCmd('projects', 'create_project', { name: 'v31c cross' }));
    expect(res.status).toBe(403);
    const batch = await cortex('batch', ID.other, { businessId: ID.cxBiz, commands: [{ type: 'structured', module: 'projects', action: 'create_project', parameters: {} }] });
    expect(batch.status).toBe(403);
    expect(connectorCalls.length).toBe(before.connector);
    expect(cortexAutonomyCalls.length).toBe(before.autonomy);
  });

  it('CX-03 a member holding projects write runs it once, named for the member, through the executor gate and audit door', async () => {
    const before = { connector: connectorCalls.length, autonomy: cortexAutonomyCalls.length };
    const audit = await cxAuditIds();
    const res = await cortex('execute', ID.cxStaffW, { ...structuredCmd('projects', 'create_project', { name: 'v31c w' }), userId: ID.cxOwner });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ success: true });
    expect(connectorCalls.slice(before.connector)).toEqual([
      { module: 'projects', action: 'create_project', businessId: ID.cxBiz, userId: ID.cxStaffW, parameters: { name: 'v31c w' } },
    ]);
    expect(cortexAutonomyCalls.slice(before.autonomy)).toEqual([{ businessId: ID.cxBiz, actionKey: 'projects.create_project', proposedBy: ID.cxStaffW }]);
    const rows = await cxAuditSince(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ID.cxStaffW, actor: 'user', module: 'projects', action: 'create_project', success: true });
  });

  it('CX-04 deny by default: an unmapped module, an action the capability registry does not list, and a refused module are 403 even for the OWNER', async () => {
    const before = connectorCalls.length;
    for (const [module, action] of [['keystore', 'export_all'], ['projects', 'drop_everything'], ['activity', 'delete_old_logs']] as const) {
      const res = await cortex('execute', ID.cxOwner, structuredCmd(module, action));
      expect(res.status, `${module}.${action} ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(connectorCalls.length).toBe(before);
  });

  it('CX-05 a crm command is the OWNER\'s only: the crm adapter writes contacts with no actor, so row visibility cannot be applied', async () => {
    const before = connectorCalls.length;
    const staff = await cortex('execute', ID.cxStaffW, structuredCmd('crm', 'update_contact', { contactId: `${P}c`, email: `${P}x@test.local` }));
    expect(staff.status).toBe(403);
    expect(JSON.stringify(staff.body)).toMatch(/business owner/);
    expect(connectorCalls.length).toBe(before);
    const owner = await cortex('execute', ID.cxOwner, structuredCmd('crm', 'add_note', { contactId: `${P}c`, note: 'v31c' }));
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(connectorCalls.slice(before).map((c) => `${c.module}.${c.action}:${c.userId}`)).toEqual([`crm.add_note:${ID.cxOwner}`]);
  });

  it('CX-06 batch: one command outside the member\'s scope refuses the whole batch before anything runs; a batch inside it runs', async () => {
    const before = connectorCalls.length;
    const refused = await cortex('batch', ID.cxStaffW, {
      businessId: ID.cxBiz,
      commands: [
        { type: 'structured', module: 'projects', action: 'create_project', parameters: { name: 'v31c b1' } },
        { type: 'structured', module: 'commerce', action: 'process_payment', parameters: { invoiceId: `${P}inv` } },
      ],
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/revenue requires write/);
    expect(connectorCalls.length).toBe(before);

    const ran = await cortex('batch', ID.cxStaffW, {
      businessId: ID.cxBiz,
      commands: [
        { type: 'structured', module: 'projects', action: 'create_project', parameters: { name: 'v31c b2' } },
        { type: 'structured', module: 'projects', action: 'add_task', parameters: { title: 'v31c b3' } },
      ],
    });
    expect(ran.status, JSON.stringify(ran.body)).toBe(200);
    expect(ran.body.summary).toMatchObject({ total: 2, succeeded: 2 });
    expect(connectorCalls.slice(before).map((c) => `${c.module}.${c.action}:${c.userId}`)).toEqual([
      `projects.create_project:${ID.cxStaffW}`, `projects.add_task:${ID.cxStaffW}`,
    ]);
  });

  it('CX-07 natural language: the command parsed from the member\'s words is checked the same way (refused for projects read, run for projects write)', async () => {
    parsedIntent = { module: 'projects', action: 'create_project', parameters: { name: 'v31c parsed' } };
    const before = connectorCalls.length;
    const refused = await cortex('execute', ID.cxStaffRO, { businessId: ID.cxBiz, command: 'start a project called v31c' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    const batchRefused = await cortex('batch', ID.cxStaffRO, { businessId: ID.cxBiz, commands: [{ type: 'natural', command: 'start a project' }] });
    expect(batchRefused.status, JSON.stringify(batchRefused.body)).toBe(403);
    expect(connectorCalls.length).toBe(before);
    const ran = await cortex('execute', ID.cxStaffW, { businessId: ID.cxBiz, command: 'start a project called v31c' });
    expect(ran.status, JSON.stringify(ran.body)).toBe(200);
    expect(connectorCalls.slice(before).map((c) => `${c.module}.${c.action}:${c.userId}`)).toEqual([`projects.create_project:${ID.cxStaffW}`]);
  });

  it('CX-08 every action the capability registry lists has a requirement: a module scope, its adapter, or a refusal by name', async () => {
    const { KeyCortexCapabilityRegistryService } = await import('../src/modules/key-cortex/key-cortex-capability-registry.service');
    const { cortexCommandRequirement } = await import('../src/modules/key-cortex/key-cortex.controller');
    const unmapped: string[] = [];
    const refusedModules = new Set<string>();
    for (const cap of new (KeyCortexCapabilityRegistryService as any)().getAllCapabilities()) {
      for (const a of cap.actions) {
        const req = cortexCommandRequirement(cap.module, a.name);
        if (!req) unmapped.push(`${cap.module}.${a.name}`);
        else if ('refused' in req) refusedModules.add(cap.module);
      }
    }
    expect(unmapped).toEqual([]);
    expect([...refusedModules].sort()).toEqual(['activity', 'genome']);
    expect(cortexCommandRequirement('projects', 'not_in_the_registry')).toMatchObject({ refused: expect.any(String) });
    expect(cortexCommandRequirement('settings', 'update_business_profile')).toMatchObject({ adapterEnforced: expect.any(String) });
  });

  it('CX-10 (review SEC-V131c-2) POST query does not run what POST execute refuses: an action, a crm write, a refused module and an executor-blocked action are 403 with a row each, and nothing reaches the connector or the gate', async () => {
    const before = { connector: connectorCalls.length, autonomy: cortexAutonomyCalls.length };
    const audit = await cxAuditIds();
    const cases = [
      [ID.cxStaffRO, 'projects', 'create_project'], // an action (a write): POST execute refuses it for projects read
      [ID.cxStaffW, 'projects', 'create_project'], // an action even with projects write: it runs through POST execute, gated and audited
      [ID.cxStaffW, 'crm', 'update_contact'],
      [ID.cxOwner, 'activity', 'delete_old_logs'],
      [ID.cxOwner, 'projects', 'UPDATE_RECORD'],
      [ID.cxOwner, 'keystore', 'export_all'],
    ] as const;
    for (const [actor, module, query] of cases) {
      const res = await cortex('query', actor, { businessId: ID.cxBiz, module, query, parameters: { name: 'v31c query' } });
      expect(res.status, `${actor} ${module}.${query} ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(connectorCalls.length).toBe(before.connector);
    expect(cortexAutonomyCalls.length).toBe(before.autonomy);
    const rows = await cxAuditSince(audit);
    expect(rows.map((r: any) => `${r.userId}:${r.module}.${r.action}:${r.success}`).sort()).toEqual(
      cases.map(([actor, module, query]) => `${actor}:${module}.${query}:false`).sort(),
    );
  });

  it('CX-11 POST query runs a query the capability registry lists under the module\'s read scope, for the member; crm reads are the OWNER\'s only', async () => {
    const before = connectorCalls.length;
    const read = await cortex('query', ID.cxStaffRO, { businessId: ID.cxBiz, module: 'projects', query: 'get_projects', parameters: {} });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ success: true });
    // expenses: none in cxStaffRO's explicit scope map.
    const noScope = await cortex('query', ID.cxStaffRO, { businessId: ID.cxBiz, module: 'finance', query: 'get_expense_summary', parameters: {} });
    expect(noScope.status, JSON.stringify(noScope.body)).toBe(403);
    expect(JSON.stringify(noScope.body)).toMatch(/expenses requires read/);
    const crmStaff = await cortex('query', ID.cxStaffW, { businessId: ID.cxBiz, module: 'crm', query: 'search_contacts', parameters: { query: 'v31c' } });
    expect(crmStaff.status, JSON.stringify(crmStaff.body)).toBe(403);
    expect(JSON.stringify(crmStaff.body)).toMatch(/business owner/);
    const crmOwner = await cortex('query', ID.cxOwner, { businessId: ID.cxBiz, module: 'crm', query: 'search_contacts', parameters: { query: 'v31c' } });
    expect(crmOwner.status, JSON.stringify(crmOwner.body)).toBe(200);
    expect(connectorCalls.slice(before).map((c) => `${c.module}.${c.action}:${c.userId}`)).toEqual([
      `projects.get_projects:${ID.cxStaffRO}`, `crm.search_contacts:${ID.cxOwner}`,
    ]);
  });

  it('CX-12 POST query on settings (enforced by its adapter on the actor) runs as POST execute does: one autonomy verdict and an audit row naming the member', async () => {
    const before = { connector: connectorCalls.length, autonomy: cortexAutonomyCalls.length };
    const audit = await cxAuditIds();
    const res = await cortex('query', ID.cxOwner, { businessId: ID.cxBiz, module: 'settings', query: 'update_branding', parameters: { primaryColor: '#000000' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(connectorCalls.slice(before.connector).map((c) => `${c.module}.${c.action}:${c.userId}`)).toEqual([`settings.update_branding:${ID.cxOwner}`]);
    expect(cortexAutonomyCalls.slice(before.autonomy)).toEqual([{ businessId: ID.cxBiz, actionKey: 'settings.update_branding', proposedBy: ID.cxOwner }]);
    const rows = await cxAuditSince(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ID.cxOwner, actor: 'user', module: 'settings', action: 'update_branding', success: true });
  });

  it('CX-13 POST query across tenants is refused 403 by BusinessGuard and nothing runs', async () => {
    const before = connectorCalls.length;
    const res = await cortex('query', ID.other, { businessId: ID.cxBiz, module: 'projects', query: 'get_projects', parameters: {} });
    expect(res.status).toBe(403);
    expect(connectorCalls.length).toBe(before);
  });

  it('CX-14 (trial-N review NEW-1, D-46) a platform SUPER_ADMIN who is not a member does not write the business\'s invoices: execute, batch and a flow with a commerce node are 403, a row names it, and nothing reaches the connector', async () => {
    const before = { connector: connectorCalls.length, autonomy: cortexAutonomyCalls.length };
    const audit = await cxAuditIds();
    const execute = await cortex('execute', ID.cxSuper, structuredCmd('commerce', 'process_payment', { invoiceId: `${P}inv` }));
    expect(execute.status, JSON.stringify(execute.body)).toBe(403);
    expect(JSON.stringify(execute.body)).toMatch(/not a member/i);
    const batch = await cortex('batch', ID.cxSuper, {
      businessId: ID.cxBiz,
      commands: [{ type: 'structured', module: 'commerce', action: 'create_invoice', parameters: { contactId: `${P}c` } }],
    });
    expect(batch.status, JSON.stringify(batch.body)).toBe(403);
    const flow = await cortex(`flows/${ID.cxFlowRev}/execute`, ID.cxSuper, { businessId: ID.cxBiz, inputs: {} });
    expect(flow.status, JSON.stringify(flow.body)).toBe(403);
    expect(await flowRuns(ID.cxFlowRev)).toBe(0);
    expect(connectorCalls.length).toBe(before.connector);
    const rows = await cxAuditSince(audit);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ businessId: ID.cxBiz, userId: ID.cxSuper, module: 'commerce', action: 'process_payment', success: false });
  });

  it.todo(
    'CX-09 (deviation, outside the write set) V1-02 isUsableAutonomyVerdict on POST execute and batch: the autonomy gate these routes run is KeyCortexExecutorService.execute\'s (one evaluateAction per command, fail closed on a throw or a deny, audited), which reads only verdict.allowed and verdict.requiresApproval; a verdict that omits requiresApproval or tier still runs. Making it V1-02-strict is a change to key-cortex-executor.service.ts, and the k34c suite (key-cortex-actor-binding) and key-cortex.controller.principal.spec.ts pin exactly one evaluateAction per command with a tier-less allow, so a second, controller-side evaluation cannot be added without editing them.',
  );
});

describe('V1-31c SB: client code is not executed (the cortex sandbox is not bounded)', () => {
  it('SB-01 POST sandbox/execute is 410 for the OWNER and a scope-less member, 403 across tenants, and the sandbox is never reached', async () => {
    const before = sandboxCalls.length;
    for (const actor of [ID.cxOwner, ID.cxStaffRO]) {
      const res = await cortex('sandbox/execute', actor, { businessId: ID.cxBiz, code: 'return 1', language: 'javascript' });
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(410);
    }
    const cross = await cortex('sandbox/execute', ID.other, { businessId: ID.cxBiz, code: 'return 1', language: 'javascript' });
    expect(cross.status).toBe(403);
    expect(sandboxCalls.slice(before)).toEqual([]);
  });

  it('SB-02 POST sandbox/apply is 410 likewise: a template\'s client parameters are never substituted or run', async () => {
    const before = sandboxCalls.length;
    for (const actor of [ID.cxOwner, ID.cxStaffRO]) {
      const res = await cortex('sandbox/apply', actor, { businessId: ID.cxBiz, templateId: 'weekly-report', parameters: { reportData: '{}' } });
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(410);
    }
    const cross = await cortex('sandbox/apply', ID.other, { businessId: ID.cxBiz, templateId: 'weekly-report', parameters: {} });
    expect(cross.status).toBe(403);
    expect(sandboxCalls.slice(before)).toEqual([]);
  });

  it('SB-03 (proof) the sandbox puts host intrinsics in scope: code that passes its audit reaches the host process, while the context\'s own realm has none', async () => {
    const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
    const prisma = { client: { sandboxExecutionLog: { create: async () => ({}) } } };
    const sandbox = new (KeyCortexSandboxService as any)({}, {}, prisma, {});
    const host = await sandbox.executeCode({ code: "return Object['constr' + 'uctor']('return typeof process')();", language: 'javascript', context: { businessId: ID.cxBiz } });
    expect(host).toMatchObject({ success: true, output: 'object' });
    // Control: the same reach from an object the context itself created finds no process.
    const own = await sandbox.executeCode({ code: "return ({})['constr' + 'uctor']['constr' + 'uctor']('return typeof process')();", language: 'javascript', context: { businessId: ID.cxBiz } });
    expect(own).toMatchObject({ success: true, output: 'undefined' });
  });

  it('SB-04 (proof) sandbox/apply substitutes a client parameter the template does not declare into code, outside any string literal', async () => {
    const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
    const sandbox: any = new (KeyCortexSandboxService as any)({}, {}, { client: {} }, {});
    let ran = '';
    sandbox.executeCode = async (req: any) => { ran = req.code; return { success: true, output: '' }; };
    await sandbox.applyTemplate('bulk-personalized-emails', { contacts: '[]', subject: 's', body: 'b', firstName: 'v31c_code' }, { businessId: ID.cxBiz });
    expect(ran).toContain('.replace(/v31c_code/g');
  });

  it('SB-05 (review SEC-V131c-3) POST sandbox/auto is 410 likewise, whether or not it asks to execute, and the sandbox is never reached', async () => {
    const before = sandboxCalls.length;
    for (const actor of [ID.cxOwner, ID.cxStaffRO]) {
      for (const body of [
        { businessId: ID.cxBiz, description: 'return typeof process' },
        { businessId: ID.cxBiz, description: 'return typeof process', execute: true },
        { businessId: ID.cxBiz, description: 'return typeof process', execute: false },
      ]) {
        const res = await cortex('sandbox/auto', actor, body);
        expect(res.status, `${actor} ${JSON.stringify(body)} ${JSON.stringify(res.body)}`).toBe(410);
      }
    }
    const cross = await cortex('sandbox/auto', ID.other, { businessId: ID.cxBiz, description: 'return 1' });
    expect(cross.status).toBe(403);
    expect(sandboxCalls.slice(before)).toEqual([]);
  });

  it('SB-06 (proof) sandbox.auto runs the code it generates in the same unbounded sandbox: generated code reaches the host process', async () => {
    const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
    const prisma = { client: { sandboxExecutionLog: { create: async () => ({}) } } };
    const sandbox: any = new (KeyCortexSandboxService as any)({}, {}, prisma, {});
    // The generation step (an LLM call) is not run: it answers what a member could steer it to write.
    sandbox.generate = async () => ({ code: "return Object['constr' + 'uctor']('return typeof process')();", language: 'javascript', explanation: 'v31c' });
    const out = await sandbox.auto('return typeof process', { businessId: ID.cxBiz });
    expect(out).toMatchObject({ executed: true, output: 'object' });
  });
});

describe('V1-31c FL: POST flows/:id/execute runs only a stored flow of the guarded business, under each action\'s scope and the autonomy gate', () => {
  const execFlow = (flowId: string, actor: string | null, body: Record<string, unknown>) => cortex(`flows/${flowId}/execute`, actor, body);

  it('FL-01 a member without automations write is refused 403: no node runs, no execution row, and a row names the member', async () => {
    const before = connectorCalls.length;
    const audit = await cxAuditIds();
    const res = await execFlow(ID.cxFlow, ID.cxStaffRO, { businessId: ID.cxBiz, inputs: { projectName: 'v31c ro' } });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/automations requires write/);
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlow)).toBe(0);
    const rows = await cxAuditSince(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.cxBiz, userId: ID.cxStaffRO, module: 'flow', action: 'trigger_flow', success: false });
  });

  it('FL-02 across tenants: a member of B naming A is 403; naming B with A\'s flow id is 404 byte-identical to an unknown id; nothing runs', async () => {
    const before = connectorCalls.length;
    const named = await execFlow(ID.cxFlow, ID.other, { businessId: ID.cxBiz, inputs: {} });
    expect(named.status).toBe(403);
    const foreign = await execFlow(ID.cxFlow, ID.other, { businessId: ID.bizB, inputs: {} });
    const unknown = await execFlow(`${P}noflow`, ID.other, { businessId: ID.bizB, inputs: {} });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(foreign.text).toBe(unknown.text);
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlow)).toBe(0);
  });

  it('FL-03 a member holding automations and projects write runs the stored flow: its action runs once for that member with the inputs as data, an execution row and an audit row', async () => {
    const before = { connector: connectorCalls.length, autonomy: cortexAutonomyCalls.length };
    const audit = await cxAuditIds();
    const res = await execFlow(ID.cxFlow, ID.cxStaffW, { businessId: ID.cxBiz, inputs: { projectName: 'v31c flow' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ executionId: expect.any(String), status: 'completed' });
    expect(connectorCalls.slice(before.connector)).toEqual([
      { module: 'projects', action: 'create_project', businessId: ID.cxBiz, userId: ID.cxStaffW, parameters: { name: 'v31c flow' } },
    ]);
    expect(cortexAutonomyCalls.slice(before.autonomy).map((c) => `${c.actionKey}:${c.proposedBy}`)).toEqual([
      `flow.trigger_flow:${ID.cxStaffW}`, `projects.create_project:${ID.cxStaffW}`,
    ]);
    expect(await flowRuns(ID.cxFlow)).toBe(1);
    const rows = await cxAuditSince(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ID.cxStaffW, actor: 'user', module: 'flow', action: 'trigger_flow', success: true });
  });

  it('FL-04 an engine key in the inputs (_userId naming the OWNER) is refused 400 and nothing runs', async () => {
    const before = connectorCalls.length;
    const runs = await flowRuns(ID.cxFlow);
    const res = await execFlow(ID.cxFlow, ID.cxStaffW, { businessId: ID.cxBiz, inputs: { projectName: 'x', _userId: ID.cxOwner } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const notObject = await execFlow(ID.cxFlow, ID.cxStaffW, { businessId: ID.cxBiz, inputs: ['x'] });
    expect(notObject.status).toBe(400);
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlow)).toBe(runs);
  });

  it('FL-05 an action node outside the member\'s scope (commerce.process_payment, revenue read) refuses the whole flow', async () => {
    const before = connectorCalls.length;
    const res = await execFlow(ID.cxFlowRev, ID.cxStaffW, { businessId: ID.cxBiz, inputs: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/revenue requires write/);
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlowRev)).toBe(0);
  });

  it('FL-06 the autonomy gate fails closed: an unusable verdict or an error is 503, a deny or an approval requirement is 403, and nothing runs', async () => {
    const before = connectorCalls.length;
    const runs = await flowRuns(ID.cxFlow);
    for (const [verdict, status] of [
      [{ allowed: true, requiresApproval: false }, 503], // no tier: not a statement that nothing needs approval
      ['throw', 503],
      [{ allowed: false, requiresApproval: false, tier: 'manual', reason: 'v31c locked' }, 403],
      [{ allowed: true, requiresApproval: true, tier: 'supervised', reason: 'v31c approve first' }, 403],
      [{ allowed: true, requiresApproval: false, tier: 'manual' }, 403],
    ] as const) {
      cortexVerdict = verdict;
      try {
        const res = await execFlow(ID.cxFlow, ID.cxStaffW, { businessId: ID.cxBiz, inputs: { projectName: 'v31c gate' } });
        expect(res.status, `${JSON.stringify(verdict)} ${JSON.stringify(res.body)}`).toBe(status);
      } finally {
        cortexVerdict = ALLOW;
      }
    }
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlow)).toBe(runs);
  });

  it('FL-07 (review SEC-V131c-1) an input named businessId never picks the tenant: the AI decision\'s model call is the flow\'s own business, with or without it', async () => {
    const before = modelGatewayCalls.length;
    const named = await execFlow(ID.cxFlowAi, ID.cxOwner, { businessId: ID.cxBiz, inputs: { businessId: ID.bizB } });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect(named.body).toMatchObject({ status: 'completed' });
    const none = await execFlow(ID.cxFlowAi, ID.cxOwner, { businessId: ID.cxBiz, inputs: {} });
    expect(none.status, JSON.stringify(none.body)).toBe(200);
    expect(modelGatewayCalls.slice(before)).toEqual([{ businessId: ID.cxBiz }, { businessId: ID.cxBiz }]);
  });

  it('FL-08 (review SEC-V131c-4 / CRR-2) the autonomy gate is asked once per action node, with the parameters that node runs with (stored, or filled from the inputs)', async () => {
    const before = { connector: connectorCalls.length, gate: cortexGateParams.length };
    const res = await execFlow(ID.cxFlowTwin, ID.cxStaffW, { businessId: ID.cxBiz, inputs: { text: 'v31c from input' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(cortexGateParams.slice(before.gate)).toEqual([
      { actionKey: 'flow.trigger_flow', parameters: { flowId: ID.cxFlowTwin, inputs: { text: 'v31c from input' } } },
      { actionKey: 'projects.create_project', parameters: { name: 'v31c benign' } },
      { actionKey: 'projects.create_project', parameters: { name: 'v31c from input' } },
    ]);
    // What the gate saw is what ran.
    expect(connectorCalls.slice(before.connector).map((c) => c.parameters)).toEqual([{ name: 'v31c benign' }, { name: 'v31c from input' }]);
  });

  it('FL-09 (review SEC-V131c-4 / CRR-2) a value the gate denies refuses the whole flow before any node runs: in an input filled into the second node, or in a stored parameter', async () => {
    const before = connectorCalls.length;
    const runs = { twin: await flowRuns(ID.cxFlowTwin), stored: await flowRuns(ID.cxFlowStored) };
    const viaInput = await execFlow(ID.cxFlowTwin, ID.cxStaffW, { businessId: ID.cxBiz, inputs: { text: `v31c ${DEALBREAKER}` } });
    expect(viaInput.status, JSON.stringify(viaInput.body)).toBe(403);
    expect(JSON.stringify(viaInput.body)).toMatch(/dealbreaker/);
    const stored = await execFlow(ID.cxFlowStored, ID.cxStaffW, { businessId: ID.cxBiz, inputs: {} });
    expect(stored.status, JSON.stringify(stored.body)).toBe(403);
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlowTwin)).toBe(runs.twin);
    expect(await flowRuns(ID.cxFlowStored)).toBe(runs.stored);
  });

  it('FL-10 a parameter filled only while the flow runs (another node\'s output) cannot be checked before the run: the flow is refused 403 and nothing runs', async () => {
    const before = connectorCalls.length;
    const audit = await cxAuditIds();
    const res = await execFlow(ID.cxFlowChain, ID.cxStaffW, { businessId: ID.cxBiz, inputs: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/a1_output/);
    expect(connectorCalls.length).toBe(before);
    expect(await flowRuns(ID.cxFlowChain)).toBe(0);
    const rows = await cxAuditSince(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ID.cxStaffW, module: 'flow', action: 'trigger_flow', success: false });
  });
});

/* ------------------------------------------------------------------------ */
/*  Census: no controller route passes request-body tool names/arguments    */
/*  to an executor unless it is listed here with a reason.                  */
/* ------------------------------------------------------------------------ */

/**
 * WHAT IS READ (typescript AST, every non-test *.controller.ts under apps/server/src):
 * each route handler (a method decorated Get/Post/Put/Patch/Delete/All) and
 * its @Body() parameters. A value is BODY-DERIVED when it is the body
 * parameter itself, any property of it other than an id (a name that is `id`
 * or ends in `Id`/`Ids` selects a stored row), or a local whose initializer
 * contains such a value (in source order, so taint carries through locals).
 * A handler is FLAGGED when it passes a body-derived value in the arguments of
 * an EXECUTOR call: executeToolDirect, executeToolDirectly, executeTool,
 * executeToolAction, autoExecuteToolForMonitoring, handleToolBridge,
 * confirmAndExecute, executeBatch, applyTemplate, executeApproved, executeFlow
 * (V1-31c), `.execute(...)` or `.executeAction(...)` on any receiver other than
 * bare `this`, `connector.query(...)` and `sandbox.auto(...)` (V1-31c review), or
 * a call of innerToolExecutor.
 *
 * WHAT IS REQUIRED: the flagged handlers are exactly KNOWN_BODY_EXECUTORS. A new
 * one fails until it is bound to a stored proposal or listed with a reason; a
 * listed one that no longer passes body data fails until its entry is removed.
 *
 * WHAT THIS CANNOT DO: it does not follow a body value through a call into
 * another method (`this.helper(body)` that executes is not seen), and it trusts
 * the id naming rule. Real behaviour is proven by the HTTP cases above.
 */
/**
 * V1-31c: an entry is 'bound' (the route executes a stored object by id; the body only selects it or carries data the
 * stored object reads) or 'bounded' (a member-initiated direct action under the direct-action principle, or a route
 * that runs nothing), each with its reason. There is no 'open' kind any more (CS-03).
 */
const KNOWN_BODY_EXECUTORS: Record<string, { kind: 'bound' | 'bounded'; reason: string }> = {
  'modules/key-inbox/key-inbox.controller.ts#KeyInboxController.executeAction': {
    kind: 'bounded',
    reason:
      'V1-31b: the action (type, thread, contact) is the stored suggestion by index; the only body data passed is the member-edited text the confirm dialog shows (title and dueDate for create_task and schedule_followup; draft/content), per type, every other key refused 400 (KI-01, KI-07).',
  },
  'modules/ai/code-executor.controller.ts#CodeExecutorController.toolBridge': {
    kind: 'bounded',
    reason:
      'E2B sandbox bridge, not a member route: a server-minted one-time execution token bound to one business; tier 1-2 tools only, a budget per execution (CodeExecutorService.validateToolCall).',
  },
  'modules/command/command.controller.ts#CommandController.execute': {
    kind: 'bounded',
    reason:
      'Runs no tool: CommandService.execute marks a stored CommandItem (by id, in the business) EXECUTED and stores the body result as the outcome the member reports. (Its timeline actorType for a KEY-executable item is a G5-EB matter.)',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.flowApplyTemplate': {
    kind: 'bounded',
    reason:
      'Runs nothing: KeyCortexFlowStudioService.applyTemplate builds a flow definition from a built-in template with the member name and parameters; the flow only runs through flows/:id/execute (bound below).',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.executeCommand': {
    kind: 'bounded',
    reason:
      "V1-31c: POST api/v1/cortex/execute is a member-initiated direct command (structured, or parsed from the member's words). Before the executor every command passes cortexCommandRequirement for the member CortexMemberAuthorityGuard loaded in the guarded tenant: the registry must list the action and the module must map to a canonical module scope held at write (deny by default; crm OWNER only; settings enforced by its adapter on the actor); a refusal is 403 with an ai_execution_logs row naming the member (CX-01..CX-08). The executor runs the autonomy gate and audits the rest (CX-09: not yet V1-02-strict).",
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.executeBatch': {
    kind: 'bounded',
    reason:
      'V1-31c: POST api/v1/cortex/batch: every command, structured or parsed, is checked as for POST execute before any of them runs; one refusal refuses the whole batch (CX-06, CX-07).',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.flowExecute': {
    kind: 'bound',
    reason:
      'V1-31c: POST api/v1/cortex/flows/:id/execute runs only the stored FlowDefinition by id in the guarded business (404 otherwise). The body inputs are data the stored nodes read (an engine key such as _userId is refused 400; the actor and businessId are set by the server, FL-07); automations write and every effect node are checked as direct commands, the autonomy gate runs per effect node with the parameters it runs with (isUsableAutonomyVerdict, fail closed; a parameter filled only at run time is refused) and the member is audited (FL-01..FL-10).',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.queryModule': {
    kind: 'bounded',
    reason:
      'V1-31c review SEC-V131c-2: POST api/v1/cortex/query (connector.query runs any name as a command). Deny by default (cortexQueryRefusal): only a query the capability registry lists for the module, under its scope at read (crm OWNER only); settings, enforced by its adapter on the actor, runs through the executor (autonomy gate, blocked actions, audit row); anything else, an action included, is 403 with a row naming the member (CX-10..CX-13).',
  },
};

const SRC = path.resolve(__dirname, '../src');
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All']);
const ALWAYS_EXECUTORS = new Set([
  'executeToolDirect', 'executeToolDirectly', 'executeTool', 'executeToolAction', 'autoExecuteToolForMonitoring',
  'handleToolBridge', 'confirmAndExecute', 'executeBatch', 'applyTemplate', 'executeApproved',
  // V1-31c: the flow studio's engine entry point (flows/:id/execute calls it by this name).
  'executeFlow',
]);
/**
 * V1-31c review SEC-V131c-2 / SEC-V131c-3: executors reached by a method name too generic to flag alone, so
 * named with their receiver (`this.<receiver>.<method>(...)`): KeyCortexConnectorService.query hands any name to the
 * module adapter as a command, and KeyCortexSandboxService.auto runs the code it generates. The census missed both.
 */
const RECEIVER_EXECUTORS = new Set(['connector.query', 'sandbox.auto']);
const ID_FIELD = /^(id|ids|.*Id|.*Ids)$/;

function listControllerFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) listControllerFiles(full, out);
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function decoratorName(d: ts.Decorator): string | undefined {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ?? [];
}

function isExecutorCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'innerToolExecutor';
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const name = callee.name.text;
  if (ALWAYS_EXECUTORS.has(name)) return true;
  if (ts.isPropertyAccessExpression(callee.expression) && RECEIVER_EXECUTORS.has(`${callee.expression.name.text}.${name}`)) return true;
  const bareThis = callee.expression.kind === ts.SyntaxKind.ThisKeyword;
  return (name === 'execute' || name === 'executeAction') && !bareThis;
}

/** True when `node` contains a body-derived value (see the census comment). */
function carriesBody(node: ts.Node, body: ReadonlySet<string>, tainted: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      // The name side of `x.name`, a property key, or a declared name is not a read.
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) return;
      if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === n) return;
      if (parent && ts.isVariableDeclaration(parent) && parent.name === n) return;
      if (tainted.has(n.text)) { found = true; return; }
      if (body.has(n.text)) {
        if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === n && ID_FIELD.test(parent.name.text)) return;
        found = true;
        return;
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

/** The flagged route handlers of one source file, as `<rel>#<Class>.<method>`. */
function flaggedHandlers(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const flagged: string[] = [];
  const visitClass = (cls: ts.ClassDeclaration) => {
    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) continue;
      if (!decoratorsOf(member).some((d) => ROUTE_DECORATORS.has(decoratorName(d) ?? ''))) continue;
      const body = new Set<string>();
      for (const p of member.parameters) {
        if (decoratorsOf(p).some((d) => decoratorName(d) === 'Body')) bindingNames(p.name, []).forEach((n) => body.add(n));
      }
      if (body.size === 0) continue;
      const tainted = new Set<string>();
      let passes = false;
      const walk = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && n.initializer && carriesBody(n.initializer, body, tainted)) {
          if (ts.isObjectBindingPattern(n.name) && ts.isIdentifier(n.initializer) && body.has(n.initializer.text)) {
            for (const el of n.name.elements) {
              const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : '';
              if (!ID_FIELD.test(key)) bindingNames(el.name).forEach((x) => tainted.add(x));
            }
          } else {
            bindingNames(n.name).forEach((x) => tainted.add(x));
          }
        }
        if (ts.isCallExpression(n) && isExecutorCall(n) && n.arguments.some((a) => carriesBody(a, body, tainted))) passes = true;
        ts.forEachChild(n, walk);
      };
      walk(member.body);
      if (passes) flagged.push(`${path.relative(SRC, fileName).split(path.sep).join('/')}#${cls.name?.text ?? '?'}.${(member.name as ts.Identifier).text}`);
    }
  };
  const top = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n)) visitClass(n);
    ts.forEachChild(n, top);
  };
  top(sf);
  return flagged;
}

describe('V1-31b CS: census of controller routes that hand request-body tool names or arguments to an executor', () => {
  it('CS-01 the flagged routes are exactly the known, reasoned list (a new one fails)', () => {
    const flagged = listControllerFiles(SRC).flatMap((f) => flaggedHandlers(f, readFileSync(f, 'utf8'))).sort();
    expect(flagged).toEqual(Object.keys(KNOWN_BODY_EXECUTORS).sort());
  });

  it('CS-02 the reader flags a body tool name, a tainted local and the whole body, and not a stored-id lookup', () => {
    const src = `
      class Synthetic {
        @Post('a') a(@Body() body: any) { return this.orchestrator.executeToolDirect(b, body.toolName, {}); }
        @Post('b') b(@Body() dto: any) { const cmd = { module: dto.module, action: dto.action }; return this.executor.execute(cmd); }
        @Post('c') c(@Body() body: any) { return this.bridge.handleToolBridge(token, body ?? {}); }
        @Post('d') async d(@Body() body: any) {
          const step = await this.prisma.client.aiPlanStep.findFirst({ where: { id: body.planStepId } });
          return this.orchestrator.executeToolDirect(b, step.toolName, step.inputPayload, body.planId, body.planStepId);
        }
        @Post('e') e(@Body() { toolName }: any) { return this.orchestrator.executeTool(b, toolName, {}); }
      }`;
    expect(flaggedHandlers(path.join(SRC, 'modules/x/synthetic.controller.ts'), src)).toEqual([
      'modules/x/synthetic.controller.ts#Synthetic.a',
      'modules/x/synthetic.controller.ts#Synthetic.b',
      'modules/x/synthetic.controller.ts#Synthetic.c',
      'modules/x/synthetic.controller.ts#Synthetic.e',
    ]);
  });

  it('CS-04 (V1-31c review SEC-V131c-2/-3) the reader flags a body module/query handed to connector.query and a body description handed to sandbox.auto, and not code generation alone', () => {
    const src = `
      class Synthetic {
        @Post('q') q(@Body() dto: any) { return this.connector.query(dto.module, dto.query, dto.parameters ?? {}, dto.businessId, actor); }
        @Post('auto') auto(@Body() dto: any) { return this.sandbox.auto(dto.description, { execute: true, businessId: dto.businessId }); }
        @Post('gen') gen(@Body() dto: any) { return this.sandbox.generate(dto.description, { businessId: dto.businessId }); }
        @Post('read') read(@Body() dto: any) { return this.prisma.query(dto.sql); }
      }`;
    expect(flaggedHandlers(path.join(SRC, 'modules/x/synthetic.controller.ts'), src)).toEqual([
      'modules/x/synthetic.controller.ts#Synthetic.q',
      'modules/x/synthetic.controller.ts#Synthetic.auto',
    ]);
  });

  it("CS-03 (V1-31c) no listed route is 'open': each is 'bound' or 'bounded', with its reason", () => {
    const entries = Object.entries(KNOWN_BODY_EXECUTORS) as Array<[string, { kind: string; reason: string }]>;
    expect(entries.filter(([, e]) => e.kind !== 'bound' && e.kind !== 'bounded').map(([k]) => k)).toEqual([]);
    expect(entries.filter(([, e]) => e.reason.trim().length < 40).map(([k]) => k)).toEqual([]);
  });
});
