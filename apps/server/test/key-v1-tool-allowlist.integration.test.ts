/**
 * KEY-TOOL-ALLOWLIST (V1-63, P1 launch-track, D-318 Option 1, rulings `payroll` / `hide` / D-119):
 *
 * REAL Postgres (DATABASE_URL), REAL FlowOrchestratorService, REAL KeyCortexToolRegistry,
 * REAL KeyCortexActionsService, REAL ActionBoundary fixture.
 *
 *   [V63C-01] RED-BEFORE: `execute_custom_logic` is refused at dispatch on every surface
 *             (`executeToolByName`, `executeToolDirect`, `executeToolAction`,
 *             `autoExecuteToolForMonitoring`) even for an OWNER, with `'not available in this version'`,
 *             never invokes `getCodeExecutor()`, and writes zero proposals or DB rows.
 *   [V63C-02] RED-BEFORE: Every payroll write tool (`payroll_set_rate`, `payroll_generate_run`,
 *             `payroll_approve_run`, `payroll_mark_paid`) is omitted from `selectToolsForRequest`
 *             and refused at dispatch (`executeToolByName`, `executeToolAction`) even for an OWNER
 *             with `'not available in this version'`, writing zero payroll rows or proposals.
 *   [V63C-03] RED-BEFORE: Owner-only dotted cortex stub tools (`cortex.send_email`,
 *             `cortex.send_message`, `cortex.generate_report`) are excluded from
 *             `KeyCortexActionsService.getAvailableTools()`, `buildToolDefinitions()`, and
 *             `KeyCortexToolRegistry.buildGatewayDefinitions()`, and refused at
 *             `KeyCortexToolRegistry.execute()`, `KeyCortexActionsService.executeAction()`, and
 *             `KeyCortexActionsService.executeActions()` with `'not available in this version'`
 *             and zero proposals/enqueue calls.
 *   [V63C-04] CONTROL: Hidden-module read tools (`projects_list` — domain hiding belongs to
 *             `KEY-TOOL-DOMAIN-HIDE`) and core v1 tools (`crm_list_contacts`) remain offered
 *             and executable for an OWNER against real Postgres.
 *
 * FIXTURES: prefix `v63c_` (test/helpers/fixture-prefixes.json), cleaned in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63c_';
const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`,
  mOwner: `${P}m_owner`,
  contact1: `${P}contact_1`,
};

async function settle<T>(promise: Promise<T>): Promise<{ value?: T; err?: any }> {
  try {
    return { value: await promise };
  } catch (err) {
    return { err };
  }
}

let db: any;
let prisma: any;
let oversight: any;
let registryMap: Map<unknown, unknown>;
let moduleRef: { get: (token: unknown) => any };
let orchestrator: any;
let FlowOrchestratorService: any;
let KeyCortexActionsService: any;
let KeyCortexToolRegistry: any;

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

async function listActions(businessId: string) {
  return db.keyActionProposal.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
}

async function cleanupAll() {
  if (!db) return;
  for (const sql of [
    `DELETE FROM cortex_action_logs WHERE session_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pay_rates WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { CapabilityContractService } = await import('../src/modules/capabilities/capability-contract.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { KeyActionBoundaryService } = await import(
    '../src/modules/key-autonomy/action-boundary/key-action-boundary.service'
  );
  ({ FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service'));
  ({ KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service'));
  ({ KeyCortexToolRegistryService: KeyCortexToolRegistry } = await import(
    '../src/modules/key-cortex/key-cortex-tool-registry.service'
  ));

  prisma = new PrismaService();
  oversight = new AiOversightService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  const capabilities = new CapabilityContractService();
  const temporal = { emit: vi.fn(async () => undefined) };
  const executionLog = { logToolExecution: vi.fn(async () => 'log_1'), log: vi.fn(async () => undefined) };

  registryMap = new Map<unknown, unknown>([
    [CapabilityContractService, capabilities],
    [AiOversightService, oversight],
    [TemporalFlowService, temporal],
    [AiExecutionLogService, executionLog],
  ]);
  moduleRef = {
    get(token: unknown) {
      if (!registryMap.has(token)) throw new Error(`fixture has no provider for ${String((token as any)?.name ?? token)}`);
      return registryMap.get(token);
    },
  };
  const boundary = new KeyActionBoundaryService(prisma, moduleRef as any);
  registryMap.set(KeyActionBoundaryService, boundary);

  await cleanupAll();
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V63C Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: ID.mOwner, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.contact.create({
    data: {
      id: ID.contact1,
      businessId: ID.bizA,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: `${P}ada@test.local`,
      status: 'CLIENT',
    },
  });

  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    moduleRef,
    governance: oversight,
    executionLog,
    businessGraph: {
      invalidateCache: vi.fn(),
      getSnapshot: async () => ({ business: { name: 'V63C Biz' } }),
      buildContextString: () => '',
    },
    aiUsage: { checkRateLimit() {}, checkCredits: async () => ({ allowed: true }) },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    attributeExecutionLog: async () => undefined,
  });
  registryMap.set(FlowOrchestratorService, orchestrator);
}, 180_000);

beforeEach(async () => {
  await db.$executeRawUnsafe(`DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM autopilot_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.autopilotSettings.create({
    data: {
      businessId: ID.bizA,
      autonomyLevel: 4,
      blockedTools: [],
      approvedTools: [
        'execute_custom_logic',
        'payroll_set_rate',
        'payroll_generate_run',
        'payroll_approve_run',
        'payroll_mark_paid',
      ],
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupAll();
});

describe('KEY-TOOL-ALLOWLIST (V1-63, D-318 Option 1): real-DB runtime refusal & tool menu enforcement', () => {
  it('[V63C-01] RED-BEFORE: execute_custom_logic is refused at dispatch on every surface with "not available in this version" and never invokes sandbox', async () => {
    const sandboxExecute = vi.fn(async () => ({ success: true, result: 'should-not-run' }));
    const getCodeExecutorSpy = vi.spyOn(orchestrator, 'getCodeExecutor' as any).mockReturnValue({
      execute: sandboxExecute,
    });

    // 1. executeToolByName with OWNER on CUSTOM_LOGIC and MEMBER_CHAT
    for (const surface of ['CUSTOM_LOGIC', 'MEMBER_CHAT'] as const) {
      const res = await settle(
        orchestrator.executeToolByName(
          ID.bizA,
          'execute_custom_logic',
          { code: 'return 1;', inputs: {} },
          { surface, onBehalfOfUserId: ID.owner },
        ),
      );
      const errText = res.err ? String(res.err.message ?? res.err) : JSON.stringify(res.value);
      expect(res.err || res.value?.success === false, `${surface}: must refuse`).toBeTruthy();
      expect(errText.toLowerCase(), `${surface}: refusal text`).toContain('not available in this version');
    }

    // 2. executeTool (member chat tool call path)
    const toolRes = await orchestrator.executeTool(
      ID.bizA,
      'execute_custom_logic',
      { code: 'return 1;', inputs: {} },
      'call_v63c_1',
      undefined,
      { surface: 'MEMBER_CHAT', principalUserId: ID.owner },
    );
    expect(toolRes.success).toBe(false);
    expect(String(toolRes.error ?? '').toLowerCase()).toContain('not available in this version');

    // 3. executeToolDirect (6-arg signature: businessId, toolName, args, planId, planStepId, action)
    const directRes = await orchestrator.executeToolDirect(
      ID.bizA,
      'execute_custom_logic',
      { code: 'return 1;', inputs: {} },
      undefined,
      undefined,
      { surface: 'MEMBER_CHAT', principalUserId: ID.owner },
    );
    expect(directRes.success).toBe(false);
    expect(String(directRes.error ?? '').toLowerCase()).toContain('not available in this version');

    // 4. autoExecuteToolForMonitoring (for owner & for no member)
    for (const opts of [{ memberId: ID.owner }, {}]) {
      const autoRes = await orchestrator.autoExecuteToolForMonitoring(
        ID.bizA,
        'execute_custom_logic',
        { code: 'return 1;', inputs: {} },
        opts,
      );
      expect(autoRes.success).toBe(false);
      expect(String(autoRes.error ?? '').toLowerCase()).toContain('not available in this version');
    }

    expect(sandboxExecute).not.toHaveBeenCalled();
    expect(getCodeExecutorSpy).not.toHaveBeenCalled();
    expect(await listActions(ID.bizA)).toHaveLength(0);
  });

  it('[V63C-02] RED-BEFORE: payroll write tools are omitted from selectToolsForRequest and refused at dispatch for an OWNER with zero writes', async () => {
    const payrollTools = [
      'payroll_set_rate',
      'payroll_generate_run',
      'payroll_approve_run',
      'payroll_mark_paid',
    ] as const;

    const menu = await orchestrator.selectToolsForRequest(
      ID.bizA,
      [],
      'set payroll rate generate approve mark paid payroll run',
      undefined,
      ID.owner,
    );
    const menuNames = menu.map((t: { function: { name: string } }) => t.function.name);
    for (const tool of payrollTools) {
      expect(menuNames, `${tool} must not appear in selectToolsForRequest`).not.toContain(tool);
    }

    for (const tool of payrollTools) {
      const byName = await settle(
        orchestrator.executeToolByName(
          ID.bizA,
          tool,
          { staffId: ID.owner, payType: 'FIXED', rate: 1000, periodStart: '2026-11-01', periodEnd: '2026-11-15', runId: `${P}run1` },
          { surface: 'MEMBER_CHAT', principalUserId: ID.owner },
        ),
      );
      const errText = byName.err ? String(byName.err.message ?? byName.err) : JSON.stringify(byName.value);
      expect(byName.err || byName.value?.success === false, `${tool} executeToolByName must refuse`).toBeTruthy();
      expect(errText.toLowerCase(), `${tool} refusal text`).toContain('not available in this version');

      const toolRes = await orchestrator.executeTool(
        ID.bizA,
        tool,
        { staffId: ID.owner, payType: 'FIXED', rate: 1000, periodStart: '2026-11-01', periodEnd: '2026-11-15', runId: `${P}run1` },
        `call_${tool}`,
        undefined,
        { surface: 'MEMBER_CHAT', principalUserId: ID.owner },
      );
      expect(toolRes.success, `${tool} executeTool must refuse`).toBe(false);
      expect(String(toolRes.error ?? '').toLowerCase()).toContain('not available in this version');
    }

    expect(await db.payRate.count({ where: { businessId: ID.bizA } })).toBe(0);
    expect(await db.payrollRun.count({ where: { businessId: ID.bizA } })).toBe(0);
    expect(await listActions(ID.bizA)).toHaveLength(0);
  });

  it('[V63C-03] RED-BEFORE: cortex stub tools (send_email, send_message, generate_report) are excluded from tool menus and refused at dispatch with zero side effects', async () => {
    const commandEnqueue = vi.fn(async () => ({ id: `${P}cmd_1` }));
    const proposalCreate = vi.fn(async () => ({ id: `${P}apr_1` }));
    const safety = {
      check: vi.fn(async () => ({ allowed: true, requiresApproval: false })),
      recordExecution: vi.fn(async () => undefined),
    };
    const idempotency = {
      check: vi.fn(async () => ({ status: 'new', claimId: `${P}claim_1` })),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    const eventBus = { emit: vi.fn() };
    const saga = {
      startSaga: vi.fn(async () => ({ id: `${P}saga_1` })),
      recordStep: vi.fn(async () => undefined),
      completeSaga: vi.fn(async () => undefined),
      failSaga: vi.fn(async () => undefined),
    };
    const registry = new KeyCortexToolRegistry(
      prisma,
      safety as any,
      idempotency as any,
      saga as any,
      undefined,
      undefined,
      eventBus as any,
    );
    const autonomyOrchestrator = {
      evaluateAction: vi.fn(async () => ({
        allowed: true,
        requiresApproval: false,
        tier: 'full',
        reason: 'Allowed',
        confidence: 1,
        ruleTrace: [],
        createdAt: new Date(),
      })),
    };
    const autonomyLevelService = {
      resolve: vi.fn(async () => ({ level: 4, mode: 'pro_auto', maxAutoRiskTier: 4, label: 'full' })),
    };

    const actionsService = new KeyCortexActionsService(
      prisma,
      { enqueue: commandEnqueue } as any,
      registry,
      { create: proposalCreate, list: vi.fn() } as any,
      autonomyOrchestrator as any,
      autonomyLevelService as any,
      eventBus as any,
      undefined,
    );
    for (const lvl of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn((actionsService as any).logger, lvl).mockImplementation(() => undefined);
      vi.spyOn((registry as any).logger, lvl).mockImplementation(() => undefined);
    }
    actionsService.onModuleInit();

    const removed = ['cortex.send_email', 'cortex.send_message', 'cortex.generate_report'];

    // 1. Excluded from every model-facing menu
    const available = (await actionsService.getAvailableTools(ID.bizA)).map((t: { name: string }) => t.name);
    const built = (await actionsService.buildToolDefinitions(ID.bizA)).map((d: any) => d.function.name);
    const gateway = registry.buildGatewayDefinitions().map((d: any) => d.function.name);
    for (const name of removed) {
      expect(available, `getAvailableTools must exclude ${name}`).not.toContain(name);
      expect(built, `buildToolDefinitions must exclude ${name}`).not.toContain(name);
      expect(gateway, `registry.buildGatewayDefinitions must exclude ${name}`).not.toContain(name);
    }

    // 2. Direct registry.execute refuses with 'not available in this version' before safety/idempotency
    for (const name of removed) {
      const r = await registry.execute(name, { businessId: ID.bizA, userId: ID.owner, autonomyLevel: 4 }, {});
      expect(r.success, `registry.execute(${name}) must fail`).toBe(false);
      expect(String(r.error ?? '').toLowerCase()).toContain('not available in this version');
    }
    expect(safety.check).not.toHaveBeenCalled();
    expect(idempotency.check).not.toHaveBeenCalled();

    // 3. KeyCortexActionsService.executeAction + executeActions refuse with status 'blocked' & zero proposals/enqueues
    const session = { id: `${P}sess_1`, businessId: ID.bizA, userId: ID.owner } as any;
    const stubActions = [
      { actionType: 'SEND_EMAIL' as const, status: 'pending_approval' as const, description: 'Email', result: { to: 'a@b.com', subject: 'hi', body: 'hi' } },
      { actionType: 'SEND_MESSAGE' as const, status: 'pending_approval' as const, description: 'Msg', result: { recipientId: 'r1', content: 'hi' } },
      { actionType: 'GENERATE_REPORT' as const, status: 'pending_approval' as const, description: 'Rpt', result: { reportType: 'sales' } },
    ];

    for (const action of stubActions) {
      const direct = await actionsService.executeAction(action, ID.bizA, ID.owner, session.id);
      expect(direct.status, `executeAction(${action.actionType})`).toBe('blocked');
      expect(String(direct.error ?? '').toLowerCase()).toContain('not available in this version');
    }

    const batch = await actionsService.executeActions(stubActions, session);
    expect(batch).toHaveLength(3);
    for (const r of batch) {
      expect(r.status, `executeActions(${r.actionType})`).toBe('blocked');
      expect(r.requiresApproval).toBe(false);
      expect(String(r.error ?? '').toLowerCase()).toContain('not available in this version');
    }
    expect(proposalCreate).not.toHaveBeenCalled();
    expect(commandEnqueue).not.toHaveBeenCalled();
  });

  it('[V63C-04] CONTROL: projects_list (deferred to KEY-TOOL-DOMAIN-HIDE) and crm_list_contacts remain offered and crm_list_contacts executes cleanly', async () => {
    const menu = await orchestrator.selectToolsForRequest(
      ID.bizA,
      [],
      'list projects and list crm contacts',
      undefined,
      ID.owner,
    );
    const names = menu.map((t: { function: { name: string } }) => t.function.name);
    expect(names).toContain('projects_list');
    expect(names).toContain('crm_list_contacts');

    const res = await orchestrator.executeTool(
      ID.bizA,
      'crm_list_contacts',
      { limit: 10 },
      'call_v63c_ctrl',
      undefined,
      { surface: 'MEMBER_CHAT', principalUserId: ID.owner },
    );
    expect(res.success, JSON.stringify(res)).toBe(true);
  });
});
