/**
 * V1-84 (FOLLOW3-D16-KEY-CHAT-OPS-SCOPE), owner ruling D-40: KEY member chat offers and runs the
 * command-centre and procurement tools (CANONICAL_MODULE_TOOLS.operations) only up to the
 * member's operations scope (REAL database).
 *
 * D-40 put the command-centre item routes and the procurement routes under the existing
 * `operations` module scope (R0-13g): ModuleScopeGuard refuses a member whose scope map gives
 * operations 'none' on every route, and a member with operations 'read' (STAFF on role defaults)
 * on every mutation. Member chat (POST /ai/businesses/:b/flow/chat, its stream and the confirm
 * route) runs behind AuthGuard and BusinessGuard only, and FlowOrchestratorService picked the
 * tools it offered and ran from the crew detected in the message text: ROLE_BASELINE_TOOLS gives
 * every crew command_list_due_obligations and command_discharge_obligation, and the operations
 * crew ("order supplies from a vendor") procurement_*. Neither the tool menu nor the executor
 * read the member's scope, so a member the routes refuse discharged obligations and created
 * procurement requests through KEY (review SEC-R013g-3, ops-scope OPS-T03, member-chat half).
 *
 * The rule here is the narrowest reading of D-40 for KEY: only the tools in
 * CANONICAL_MODULE_TOOLS.operations are filtered, each by the level its routes require, against
 * the member's operations level read exactly as ModuleScopeGuard reads it (a platform
 * SUPER_ADMIN passes; else the explicit permissionScopes map, a missing key being none; else the
 * role defaults: OWNER and ADMIN admin, STAFF read). A tool above the member's level is not
 * advertised, and a call the model makes to one anyway is refused as a tool error before
 * anything is written. Staff-bridge turns, governed by an envelope JobRolePolicyService issued
 * (it already bounds a position by its holder's membership), are unchanged.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, the user, business,
 * membership, command item, procurement request, policy and confirmation rows, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, the global ValidationPipe,
 * AiFlowController, ProcurementController (the HTTP parity check), RoleEngineService (the crew
 * detected from the message and the tool menu it allows), AiOversightService (the governance
 * decision), KeyActionBoundaryService, JobRolePolicyService (the staff-bridge envelope),
 * CommandService, ProcurementService and FlowOrchestratorService's chat, streamChat,
 * confirmation, tool selection, governToolCall and executor paths are real against DATABASE_URL.
 * The stand-ins: identity attachment (a test middleware loads the seeded user named by
 * `x-test-user` and attaches `{ id, email, role }`, as AuthMiddleware does after token
 * verification); the model gateway (AiUsageService.trackAndComplete / trackAndStream), which
 * records the tool menu it is sent and emits exactly one scripted tool call and then a fixed
 * reply, so no provider is called; the prompt-building context reads chat() makes before the
 * gateway (business graph, memories, blueprint, perception, triage, session persistence), which
 * decide nothing on this path; and the feed, realtime and notification recorders behind
 * CommandService and ProcurementService. The business's policy auto-executes tier 1 and 2
 * (maxAutoTier 2), so a tier-2 write the operations crew is trusted with runs in the turn.
 *
 * Fixtures: prefix `v84p_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw
 * SQL with sqlLikePrefix() in beforeAll and afterAll. No $transaction wrapping. Cases tagged
 * RED-BEFORE fail on the unmodified orchestrator; CONTROL cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84p_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA (operations admin by role default)
  admin: `${P}admin`, // ADMIN of bizA, no explicit scope map (operations admin)
  staffDefault: `${P}staffDefault`, // STAFF of bizA on role defaults (operations read)
  staffNone: `${P}staffNone`, // STAFF of bizA, { crm: 'read', operations: 'none' }
  staffLowered: `${P}staffLowered`, // STAFF of bizA, operations write, lowered to read mid-test
  bizA: `${P}bizA`,
};

/** The operations-crew message of the packet (role-engine ROLE_SWITCH_KEYWORDS.operations). */
const VENDOR = 'order supplies from a vendor';
/** An operations-crew message naming every tool the menu checks, so the 128-tool relevance cap keeps them. */
const MENU = 'procurement from a vendor: list requests, get request, create request, update request, submit for review, list due obligations, discharge obligation';
/** A general-crew message: general's tier ceiling (1) makes a tier-2 write wait for the member's confirmation. */
const GENERAL = 'What is the status overview?';

const READS = ['command_list_due_obligations', 'procurement_list_requests', 'procurement_get_request'];
const WRITES = ['command_discharge_obligation', 'procurement_create_request', 'procurement_update_request', 'procurement_submit_for_review'];

let db: any;
let app: any;
let orchestrator: any;
let jobRolePolicy: any;
let roleEngine: any;
let OPERATIONS: Readonly<Record<string, 'read' | 'write' | 'admin'>>;

// ---- the model gateway: records the menu, emits one scripted tool call, then a fixed reply -----
const gateway = {
  /** The single tool call the model emits on the next turn. */
  script: null as null | { name: string; args: Record<string, unknown> },
  seq: 0,
  /** The tool names each first-pass request advertised, in order. */
  menus: [] as string[][],
};
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
type GatewayRequest = { messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> };
const aiUsage = {
  checkRateLimit() {},
  async checkCredits() {
    return { allowed: true };
  },
  async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
    if (req.messages.some((m) => m.role === 'tool')) return { content: 'Done.', toolCalls: [], usage };
    gateway.menus.push((req.tools ?? []).map((t) => t.function.name));
    if (!gateway.script) return { content: 'Hello.', toolCalls: [], usage };
    gateway.seq += 1;
    return {
      content: '',
      toolCalls: [{ id: `call_${gateway.seq}`, type: 'function', function: { name: gateway.script.name, arguments: JSON.stringify(gateway.script.args) } }],
      usage,
    };
  },
  async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
    if (req.messages.some((m) => m.role === 'tool')) {
      yield { type: 'content_delta', content: 'Done.' };
      return;
    }
    gateway.menus.push((req.tools ?? []).map((t) => t.function.name));
    if (!gateway.script) {
      yield { type: 'content_delta', content: 'Hello.' };
      return;
    }
    gateway.seq += 1;
    yield { type: 'tool_call_delta', toolCall: { index: 0, id: `call_${gateway.seq}`, name: gateway.script.name, argumentsDelta: JSON.stringify(gateway.script.args) } };
    yield { type: 'usage', usage };
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM procurement_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let ipSeq = 0;
/** A distinct client address per request, so CrmRateLimitGuard's per-address buckets never cap the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.84.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

const chatUrl = `/ai/businesses/${ID.bizA}/flow/chat`;

/** One member-chat turn in which the model calls `name` with `args` (no script: a plain reply). */
async function chatTurn(actor: string, message: string, script?: { name: string; args: Record<string, unknown> }) {
  gateway.script = script ?? null;
  const res = await request(app.getHttpServer())
    .post(chatUrl)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ message })
    .expect(201);
  gateway.script = null;
  return res.body;
}

/** The tool menu one member-chat turn advertises to the model. */
async function menuFor(actor: string, message = MENU): Promise<string[]> {
  gateway.menus.length = 0;
  await chatTurn(actor, message);
  expect(gateway.menus).toHaveLength(1);
  return gateway.menus[0];
}

/** The member confirms the call KEY asked them to confirm (POST flow/confirm). */
async function confirm(actor: string, pending: { toolCallId: string; confirmationId: string }) {
  const res = await request(app.getHttpServer())
    .post(`/ai/businesses/${ID.bizA}/flow/confirm`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ toolCallId: pending.toolCallId, confirmed: true, confirmationId: pending.confirmationId })
    .expect(201);
  return res.body;
}

/**
 * One member-chat turn that runs `name` to its result: when KEY asks the member to confirm it, the
 * member confirms it, so a call is never left unexecuted only because it waited for a confirmation.
 */
async function memberRuns(actor: string, message: string, name: string, args: Record<string, unknown>) {
  const body = await chatTurn(actor, message, { name, args });
  if (!body.requiresConfirmation) return body;
  return { proposed: body, ...(await confirm(actor, body.pendingConfirmations[0])) };
}

/** The single tool result of a turn, asserting the tool ran. */
function onlyResult(body: any, name: string) {
  expect(body.toolResults, JSON.stringify(body).slice(0, 400)).toHaveLength(1);
  const [r] = body.toolResults;
  expect(r.name).toBe(name);
  expect(r.success, r.error).toBe(true);
  return r.result;
}

/** The single (failed) tool result of a turn: the call was refused as a tool error. */
function onlyFailure(body: any, name: string) {
  expect(body.toolResults, JSON.stringify(body).slice(0, 400)).toHaveLength(1);
  const [r] = body.toolResults;
  expect(r.name).toBe(name);
  expect(r.success, JSON.stringify(r).slice(0, 400)).toBe(false);
  return r.error as string;
}

/** The refusal names the operations scope, the level the tool needs and the member's own. */
function expectScopeRefusal(error: string, needs: 'read' | 'write' | 'admin', has: string) {
  expect(error).toMatch(/operations/);
  expect(error).toContain(needs);
  expect(error).toContain(`you have ${has}`);
}

let seq = 0;
async function seedObligation() {
  seq += 1;
  return db.commandItem.create({
    data: {
      id: `${P}ci_${seq}`,
      businessId: ID.bizA,
      sourceModule: 'v84p',
      title: `${P}Obligation ${seq}`,
      category: 'WORK',
      actionType: 'v84p_file',
      status: 'OPEN',
      kind: 'OBLIGATION',
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    },
  });
}

async function seedRequest() {
  seq += 1;
  return db.procurementRequest.create({
    data: {
      id: `${P}pr_${seq}`,
      businessId: ID.bizA,
      status: 'DRAFT',
      priority: 'normal',
      userPrompt: `${P}need ${seq}`,
      interpretedNeed: { category: 'v84p' },
      estimatedBudget: { min: 0, max: 250 },
    },
  });
}

const requestCount = () => db.procurementRequest.count({ where: { businessId: ID.bizA } });
/** One command item as a whole row (to_jsonb text): what "no row change" compares. */
async function itemRow(id: string): Promise<string | undefined> {
  const rows = await db.$queryRawUnsafe('SELECT to_jsonb(t)::text AS row FROM command_items t WHERE id = $1', id);
  return rows[0]?.row;
}
async function requestRow(id: string): Promise<string | undefined> {
  const rows = await db.$queryRawUnsafe('SELECT to_jsonb(t)::text AS row FROM procurement_requests t WHERE id = $1', id);
  return rows[0]?.row;
}

/** The streamed member chat (POST flow/chat/stream), parsed into its event chunks. */
async function streamTurn(actor: string, message: string, script: { name: string; args: Record<string, unknown> }) {
  gateway.script = script;
  const res = await request(app.getHttpServer())
    .post(`${chatUrl}/stream`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ message })
    .buffer(true)
    .parse((r: any, cb: any) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => { text += c; });
      r.on('end', () => cb(null, text));
    });
  gateway.script = null;
  return String(res.body)
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map((l) => JSON.parse(l.slice('data: '.length)));
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const policyModule = await import('../src/modules/structure/job-role-policy.service');
  const { JobRolePolicyService, CANONICAL_MODULE_TOOLS } = policyModule;
  const { CommandService } = await import('../src/modules/command/command.service');
  const { ProcurementService } = await import('../src/modules/procurement/procurement.service');
  const { ProcurementController } = await import('../src/modules/procurement/procurement.controller');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  OPERATIONS = CANONICAL_MODULE_TOOLS.operations;

  Logger.overrideLogger(false);
  const prisma = new PrismaService();
  jobRolePolicy = new JobRolePolicyService();
  const recorder = { emit() { return true; }, async recordEvent() { return undefined; }, async create() { return undefined; } };
  roleEngine = new RoleEngineService(prisma as any, {} as any, recorder as any);
  const commands = new CommandService(prisma as any, recorder as any, recorder as any, recorder as any);
  const procurement = new ProcurementService(prisma as any, recorder as any, recorder as any);

  // The orchestrator's lazy cross-module edges, real where this path consults them.
  const registry = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!registry.has(token)) throw new Error(`test moduleRef has no provider for ${token?.name ?? String(token)}`);
      return registry.get(token);
    },
  };
  registry.set(KeyActionBoundaryService, new KeyActionBoundaryService(prisma as any, moduleRef as any));
  registry.set(JobRolePolicyService, jobRolePolicy);
  registry.set(CommandService, commands);
  registry.set(ProcurementService, procurement);
  // execute_custom_logic's sandbox (KO-04): the real executor, local child-process backend.
  const { CodeExecutorService } = await import('../src/modules/ai/code-executor.service');
  registry.set(CodeExecutorService, new CodeExecutorService());

  const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
  // The real class: chat, streamChat, the confirmation claim, resolveTurnAuthority (the crew),
  // selectToolsForRequest (the menu), governToolCall, executeTool and executeToolAction are its
  // own. Only the prompt-building context reads are stubbed.
  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    moduleRef,
    aiUsage,
    roleEngine,
    governance: new AiOversightService(prisma as any, {} as any, {} as any, roleEngine, {} as any, jobRolePolicy),
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async () => ({ business: { name: 'V84P Biz A' } }),
      buildContextString: () => '',
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    genomeFacts: { listTopFacts: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
  });

  // ProcurementController has no @Inject on its constructor; tsc's emitted parameter type, which
  // vitest's transform does not emit (as ops-scope-command-procurement does).
  Reflect.defineMetadata('design:paramtypes', [ProcurementService], ProcurementController);

  const testing = await Test.createTestingModule({
    controllers: [AiFlowController, ProcurementController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      { provide: FlowOrchestratorService, useValue: orchestrator },
      { provide: ProcurementService, useValue: procurement },
      { provide: TimelineService, useValue: recorder },
    ],
  }).compile();

  app = testing.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only. No guard is overridden.
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

  for (const name of ['owner', 'admin', 'staffDefault', 'staffNone', 'staffLowered'] as const) {
    await db.user.create({ data: { id: ID[name], email: `${P}${name}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84P Biz A', ownerId: ID.owner } });
  const m = (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.staffDefault, 'STAFF');
  await m(ID.staffNone, 'STAFF', { crm: 'read', operations: 'none' });
  await m(ID.staffLowered, 'STAFF', { crm: 'read', operations: 'write' });

  // The business's policy: tier 1 and 2 auto-execute (the operations crew's own ceiling is 2).
  await db.aiMemory.create({
    data: { id: `${P}autonomy`, businessId: ID.bizA, category: 'settings', key: 'autonomy', value: JSON.stringify({ mode: 'assisted', maxAutoTier: 2 }) },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

beforeEach(() => {
  gateway.script = null;
  gateway.menus.length = 0;
});

describe('preconditions', () => {
  it('CONTROL: the packet messages staff the operations crew (role-engine), and the general message the general crew alone', async () => {
    for (const message of [VENDOR, MENU]) {
      const { crew } = await roleEngine.resolveCrew({ message });
      expect(crew, message).toContain('operations');
    }
    expect((await roleEngine.resolveCrew({ message: GENERAL })).crew).toEqual(['general']);
    // The reads and writes this suite checks are operations tools at the levels their routes require (D-40).
    for (const t of READS) expect(OPERATIONS[t], t).toBe('read');
    for (const t of WRITES) expect(OPERATIONS[t], t).toBe('write');
  });
});

describe("KO-01 STAFF { operations: 'none' }: no operations tool is offered, and a forced call is refused as a tool error", () => {
  it("KO-01a RED-BEFORE: the member's chat menu advertises no CANONICAL_MODULE_TOOLS.operations tool (command_list_due_obligations and command_discharge_obligation are no longer baseline for them)", async () => {
    const menu = await menuFor(ID.staffNone);
    expect(menu.length).toBeGreaterThan(0);
    expect(menu.filter((t) => Object.prototype.hasOwnProperty.call(OPERATIONS, t))).toEqual([]);
  });

  it('KO-01b RED-BEFORE: a forced command_discharge_obligation(itemId) is refused with a tool error and the item is unchanged (dischargedAt stays null)', async () => {
    const item = await seedObligation();
    const before = await itemRow(item.id);
    const body = await memberRuns(ID.staffNone, VENDOR, 'command_discharge_obligation', { obligationId: item.id });
    expectScopeRefusal(onlyFailure(body, 'command_discharge_obligation'), 'write', 'none');
    expect(body.requiresConfirmation, 'a refused call is not proposed for confirmation').toBeFalsy();
    expect(await itemRow(item.id)).toBe(before);
    expect((await db.commandItem.findUnique({ where: { id: item.id } })).dischargedAt).toBeNull();
  });

  it('KO-01c RED-BEFORE: a forced procurement_create_request on the vendor message is refused with a tool error and no ProcurementRequest row is created', async () => {
    const before = await requestCount();
    const body = await memberRuns(ID.staffNone, VENDOR, 'procurement_create_request', { userPrompt: `${P}printer paper` });
    expectScopeRefusal(onlyFailure(body, 'procurement_create_request'), 'write', 'none');
    expect(await requestCount()).toBe(before);
  });

  it('KO-01d RED-BEFORE: the operations reads are refused too (operations none reads nothing over HTTP): command_list_due_obligations, procurement_list_requests and procurement_get_request answer a tool error', async () => {
    const req = await seedRequest();
    for (const [name, args] of [
      ['command_list_due_obligations', {}],
      ['procurement_list_requests', {}],
      ['procurement_get_request', { requestId: req.id }],
    ] as const) {
      const body = await chatTurn(ID.staffNone, VENDOR, { name, args });
      expectScopeRefusal(onlyFailure(body, name), 'read', 'none');
      expect(JSON.stringify(body), `${name} discloses the request`).not.toContain(`${P}need`);
    }
  });

  it('KO-01e RED-BEFORE: the streamed member chat (POST flow/chat/stream) refuses the same forced command_discharge_obligation as a tool error and leaves the item unchanged', async () => {
    const item = await seedObligation();
    const before = await itemRow(item.id);
    const chunks = await streamTurn(ID.staffNone, VENDOR, { name: 'command_discharge_obligation', args: { obligationId: item.id } });
    expect(chunks.find((c) => c.type === 'confirmation_required'), 'a refused call is not proposed for confirmation').toBeUndefined();
    const results = chunks.find((c) => c.type === 'tool_results');
    expect(results, JSON.stringify(chunks).slice(0, 400)).toBeTruthy();
    expect(results.toolResults).toHaveLength(1);
    expect(results.toolResults[0].success).toBe(false);
    expectScopeRefusal(results.toolResults[0].error, 'write', 'none');
    expect(await itemRow(item.id)).toBe(before);
  });

  it("KO-01f RED-BEFORE: a write KEY proposed while the member held operations write (the general crew's ceiling makes it wait for a confirmation) and confirmed after their scope was lowered to read is refused at confirmation as a tool error: the scope is read when the call runs, as the route reads it per request", async () => {
    const item = await seedObligation();
    const before = await itemRow(item.id);
    const proposed = await chatTurn(ID.staffLowered, GENERAL, { name: 'command_discharge_obligation', args: { obligationId: item.id } });
    expect(proposed.requiresConfirmation, JSON.stringify(proposed).slice(0, 400)).toBe(true);
    await db.membership.update({ where: { id: `${P}m_staffLowered` }, data: { permissionScopes: { crm: 'read', operations: 'read' } } });
    try {
      const body = await confirm(ID.staffLowered, proposed.pendingConfirmations[0]);
      expectScopeRefusal(onlyFailure(body, 'command_discharge_obligation'), 'write', 'read');
      expect(await itemRow(item.id)).toBe(before);
    } finally {
      await db.membership.update({ where: { id: `${P}m_staffLowered` }, data: { permissionScopes: { crm: 'read', operations: 'write' } } });
    }
  });
});

describe("KO-02 STAFF on role defaults (operations read): the operations reads run, the writes are refused", () => {
  it('KO-02a RED-BEFORE: the menu offers the operations reads and no operations write (every operations tool it advertises is a read)', async () => {
    const menu = await menuFor(ID.staffDefault);
    for (const t of READS) expect(menu, t).toContain(t);
    for (const t of WRITES) expect(menu, t).not.toContain(t);
    for (const t of menu.filter((n) => Object.prototype.hasOwnProperty.call(OPERATIONS, n))) expect(OPERATIONS[t], t).toBe('read');
  });

  it('KO-02b CONTROL: command_list_due_obligations, procurement_list_requests and procurement_get_request run for the member', async () => {
    const item = await seedObligation();
    const req = await seedRequest();
    const due = onlyResult(await chatTurn(ID.staffDefault, VENDOR, { name: 'command_list_due_obligations', args: {} }), 'command_list_due_obligations');
    expect(JSON.stringify(due)).toContain(item.id);
    const list = onlyResult(await chatTurn(ID.staffDefault, VENDOR, { name: 'procurement_list_requests', args: {} }), 'procurement_list_requests');
    expect((list.requests as Array<{ id: string }>).map((r) => r.id)).toContain(req.id);
    const one = onlyResult(await chatTurn(ID.staffDefault, VENDOR, { name: 'procurement_get_request', args: { requestId: req.id } }), 'procurement_get_request');
    expect(one.request.id).toBe(req.id);
  });

  it("KO-02c RED-BEFORE: the packet's turn ('order supplies from a vendor', the model calling procurement_create_request) creates no ProcurementRequest row for the member: a tool error naming operations write", async () => {
    const before = await requestCount();
    const body = await memberRuns(ID.staffDefault, VENDOR, 'procurement_create_request', { userPrompt: `${P}printer toner` });
    expectScopeRefusal(onlyFailure(body, 'procurement_create_request'), 'write', 'read');
    expect(await requestCount()).toBe(before);
  });

  it('KO-02d RED-BEFORE: the other operations writes are refused with no row change: command_discharge_obligation, procurement_update_request and procurement_submit_for_review', async () => {
    const item = await seedObligation();
    const req = await seedRequest();
    const itemBefore = await itemRow(item.id);
    const reqBefore = await requestRow(req.id);
    for (const [name, args] of [
      ['command_discharge_obligation', { obligationId: item.id }],
      ['procurement_update_request', { requestId: req.id, priority: 'urgent', internalNotes: `${P}changed` }],
      ['procurement_submit_for_review', { requestId: req.id }],
    ] as const) {
      const body = await memberRuns(ID.staffDefault, VENDOR, name, args);
      expectScopeRefusal(onlyFailure(body, name), 'write', 'read');
    }
    expect(await itemRow(item.id)).toBe(itemBefore);
    expect(await requestRow(req.id)).toBe(reqBefore);
  });
});

describe('KO-03 parity with the routes, and what stays unchanged', () => {
  it('KO-03a RED-BEFORE: STAFF on role defaults is refused procurement_create_request in chat exactly where the HTTP route (POST procurement/businesses/:b) refuses them 403', async () => {
    const before = await requestCount();
    const http = await request(app.getHttpServer())
      .post(`/procurement/businesses/${ID.bizA}`)
      .set('x-test-user', ID.staffDefault)
      .set('x-forwarded-for', nextIp())
      .send({ userPrompt: `${P}over http` });
    expect(http.status).toBe(403);
    const body = await memberRuns(ID.staffDefault, VENDOR, 'procurement_create_request', { userPrompt: `${P}over chat` });
    onlyFailure(body, 'procurement_create_request');
    expect(await requestCount()).toBe(before);
  });

  it('KO-03b CONTROL: the OWNER and the ADMIN are unchanged: the menu offers the operations reads and writes, procurement_create_request creates the request and command_discharge_obligation discharges the item', async () => {
    for (const actor of [ID.owner, ID.admin]) {
      const menu = await menuFor(actor);
      for (const t of [...READS, ...WRITES]) expect(menu, `${actor} ${t}`).toContain(t);

      const before = await requestCount();
      const created = onlyResult(await memberRuns(actor, VENDOR, 'procurement_create_request', { userPrompt: `${P}by ${actor}` }), 'procurement_create_request');
      expect(await requestCount()).toBe(before + 1);
      expect((await db.procurementRequest.findUnique({ where: { id: created.id } })).businessId).toBe(ID.bizA);

      const item = await seedObligation();
      const discharged = onlyResult(await memberRuns(actor, VENDOR, 'command_discharge_obligation', { obligationId: item.id }), 'command_discharge_obligation');
      expect(discharged.id).toBe(item.id);
      expect((await db.commandItem.findUnique({ where: { id: item.id } })).dischargedAt).not.toBeNull();
    }
  });

  it('KO-03c CONTROL: a staff-bridge turn governed by an envelope JobRolePolicyService issued is unchanged: an operations-write position is offered the procurement and command writes and procurement_create_request runs; an operations-read position is offered the reads only', async () => {
    const position = (level: string) =>
      jobRolePolicy.envelopeForJobRole({ id: `${P}jr_${level}`, name: `V84P ops ${level}`, permissions: { operations: level } });
    const bridgeTurn = (envelope: unknown, script?: { name: string; args: Record<string, unknown> }) => {
      gateway.script = script ?? null;
      return orchestrator
        .chat(ID.bizA, MENU, [], undefined, { surface: 'staff_whatsapp', route: '/channel/whatsapp', hints: [] }, undefined, undefined, undefined, undefined, { jobRoleEnvelope: envelope })
        .finally(() => { gateway.script = null; });
    };

    const write = position('write');
    gateway.menus.length = 0;
    await bridgeTurn(write);
    for (const t of [...READS, ...WRITES]) expect(gateway.menus[0], t).toContain(t);
    const before = await requestCount();
    const body = await bridgeTurn(write, { name: 'procurement_create_request', args: { userPrompt: `${P}by the bridge` } });
    onlyResult(body, 'procurement_create_request');
    expect(await requestCount()).toBe(before + 1);

    gateway.menus.length = 0;
    await bridgeTurn(position('read'));
    for (const t of READS) expect(gateway.menus[0], t).toContain(t);
    for (const t of WRITES) expect(gateway.menus[0], t).not.toContain(t);
  });
});

/**
 * Review SEC-D16-1 / D16-CR-1: execute_custom_logic runs a snippet whose api.callTool re-enters the
 * dispatcher on the CUSTOM_LOGIC surface with no principal, so the scope rule above never saw the
 * inner call. A message that staffs the operator crew (ceiling 3, execute_custom_logic allowed) in a
 * business that auto-executes tier 3 ran it in the member's own turn. Each inner call is now held
 * to the operations scope of the member whose chat turn ran the snippet.
 */
describe("KO-04 execute_custom_logic: every api.callTool in the snippet is held to the member's operations scope (review SEC-D16-1)", () => {
  /** resolveCrew staffs the operator crew first: its ceiling (3) admits execute_custom_logic. */
  const OPERATOR = 'execute it: run, process, handle and complete the work';
  let backend: string | undefined;

  beforeAll(async () => {
    // The local child-process sandbox, whatever the environment configures: no provider is called.
    backend = process.env.CODE_EXECUTOR_BACKEND;
    process.env.CODE_EXECUTOR_BACKEND = 'local';
    // The business auto-executes up to tier 3 (AutopilotSettings autonomyLevel 3 gives the same).
    await db.aiMemory.update({ where: { id: `${P}autonomy` }, data: { value: JSON.stringify({ mode: 'assisted', maxAutoTier: 3 }) } });
  });

  afterAll(async () => {
    if (backend === undefined) delete process.env.CODE_EXECUTOR_BACKEND;
    else process.env.CODE_EXECUTOR_BACKEND = backend;
    await db.aiMemory.update({ where: { id: `${P}autonomy` }, data: { value: JSON.stringify({ mode: 'assisted', maxAutoTier: 2 }) } });
  });

  /** The one execute_custom_logic result of a member's turn: the snippet ran in the turn. */
  async function snippet(actor: string, code: string) {
    const body = await chatTurn(actor, OPERATOR, { name: 'execute_custom_logic', args: { code } });
    expect(body.requiresConfirmation, JSON.stringify(body).slice(0, 400)).toBeFalsy();
    return onlyResult(body, 'execute_custom_logic') as { ok: boolean; value?: any; error?: string };
  }

  it('CONTROL: the operator crew is staffed first, and the operations-none member is offered execute_custom_logic and no operations tool', async () => {
    expect((await roleEngine.resolveCrew({ message: OPERATOR })).crew[0]).toBe('operator');
    const menu = await menuFor(ID.staffNone, OPERATOR);
    expect(menu).toContain('execute_custom_logic');
    expect(menu.filter((t) => Object.prototype.hasOwnProperty.call(OPERATIONS, t))).toEqual([]);
  });

  it("KO-04a RED-BEFORE: STAFF { operations: 'none' }: a snippet calling procurement_create_request is refused inside the sandbox and no ProcurementRequest row is created", async () => {
    const before = await requestCount();
    const r = await snippet(ID.staffNone, `return await api.callTool('procurement_create_request', { userPrompt: '${P}via custom logic' });`);
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(false);
    expectScopeRefusal(r.error as string, 'write', 'none');
    expect(await requestCount()).toBe(before);
  });

  it("KO-04b RED-BEFORE: STAFF { operations: 'none' }: a snippet calling command_discharge_obligation is refused and the item is unchanged (dischargedAt stays null); a read (command_list_due_obligations) is refused too", async () => {
    const item = await seedObligation();
    const before = await itemRow(item.id);
    const r = await snippet(ID.staffNone, `return await api.callTool('command_discharge_obligation', { obligationId: '${item.id}' });`);
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(false);
    expectScopeRefusal(r.error as string, 'write', 'none');
    expect(await itemRow(item.id)).toBe(before);
    expect((await db.commandItem.findUnique({ where: { id: item.id } })).dischargedAt).toBeNull();

    const read = await snippet(ID.staffNone, `return await api.callTool('command_list_due_obligations', {});`);
    expect(read.ok).toBe(false);
    expectScopeRefusal(read.error as string, 'read', 'none');
    expect(JSON.stringify(read)).not.toContain(item.id);
  });

  it('KO-04c RED-BEFORE: STAFF on role defaults (operations read): in one snippet the operations read runs and the write is refused (no row), the snippet seeing the refusal as a rejected api.callTool', async () => {
    const req = await seedRequest();
    const before = await requestCount();
    const r = await snippet(
      ID.staffDefault,
      `const list = await api.callTool('procurement_list_requests', {});
       let refused = null;
       try { await api.callTool('procurement_create_request', { userPrompt: '${P}via custom logic read' }); } catch (e) { refused = e.message; }
       return { listed: list.requests.map((x) => x.id), refused };`,
    );
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
    expect(r.value.listed).toContain(req.id);
    expectScopeRefusal(r.value.refused, 'write', 'read');
    expect(await requestCount()).toBe(before);
  });

  it('KO-04d RED-BEFORE: the streamed member chat (POST flow/chat/stream) holds the snippet to the same scope: the discharge is refused and the item is unchanged', async () => {
    const item = await seedObligation();
    const before = await itemRow(item.id);
    const chunks = await streamTurn(ID.staffNone, OPERATOR, {
      name: 'execute_custom_logic',
      args: { code: `return await api.callTool('command_discharge_obligation', { obligationId: '${item.id}' });` },
    });
    const results = chunks.find((c) => c.type === 'tool_results');
    expect(results, JSON.stringify(chunks).slice(0, 400)).toBeTruthy();
    expect(results.toolResults).toHaveLength(1);
    expect(results.toolResults[0].name).toBe('execute_custom_logic');
    expect(results.toolResults[0].result.ok).toBe(false);
    expectScopeRefusal(results.toolResults[0].result.error, 'write', 'none');
    expect(await itemRow(item.id)).toBe(before);
  });

  it('KO-04e CONTROL: the OWNER is unchanged: the snippet creates the request and discharges the item', async () => {
    const item = await seedObligation();
    const before = await requestCount();
    const r = await snippet(
      ID.owner,
      `const created = await api.callTool('procurement_create_request', { userPrompt: '${P}owner via custom logic' });
       const done = await api.callTool('command_discharge_obligation', { obligationId: '${item.id}' });
       return { created: created.id, discharged: done.id };`,
    );
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
    expect(await requestCount()).toBe(before + 1);
    expect((await db.procurementRequest.findUnique({ where: { id: r.value.created } })).businessId).toBe(ID.bizA);
    expect(r.value.discharged).toBe(item.id);
    expect((await db.commandItem.findUnique({ where: { id: item.id } })).dischargedAt).not.toBeNull();
  });
});
