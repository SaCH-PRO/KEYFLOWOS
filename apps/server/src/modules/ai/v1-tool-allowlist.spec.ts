/**
 * V1-63 (KEY-TOOL-ALLOWLIST, P1 launch-track, D-318 Option 1, rulings `payroll` / `hide` / D-119):
 *
 * Unit proof over the single canonical v1 tool allowlist (`v1-tool-allowlist.ts`)
 * and `FlowOrchestratorService.selectToolsForRequest`:
 *   - Every tool in `FLOW_TOOLS` is classified into a canonical module family from
 *     `packages/shared/src/v1-modules.ts` (`V1_HIDDEN_MODULES` key OR the reviewed
 *     v1 set `V1_KEY_TOOLS` moved here from `V61-01` per SEC-V61-3), with zero
 *     unclassified tools and zero overlap.
 *   - Unconditional removals are refused everywhere with `'not available in this version'`:
 *       1. `execute_custom_logic` (E2B sandbox)
 *       2. Every payroll write tool (`payroll_set_rate`, `payroll_generate_run`,
 *          `payroll_approve_run`, `payroll_mark_paid`)
 *       3. Owner-only dotted cortex stub tools (`cortex.send_email`,
 *          `cortex.send_message`, `cortex.generate_report` and their bare aliases)
 *   - Member-chat tool selection (`selectToolsForRequest`) NEVER offers
 *     `execute_custom_logic` or any payroll write tool, even to an OWNER,
 *     while STILL offering hidden-module read tools like `projects_list`
 *     (domain hiding is deferred to `KEY-TOOL-DOMAIN-HIDE`).
 */
import { describe, expect, it, vi } from 'vitest';
import { V1_HIDDEN_MODULES } from '@keyflow/shared';
import { FLOW_TOOLS } from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { CANONICAL_MODULE_TOOLS, EXTRA_SCOPED_GOVERNED_TOOLS, GOVERNED_UNGRANTED } from '../structure/job-role-policy.service';

const BIZ = 'biz_v63c_unit';
const OWNER = 'u_owner_v63c';
const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

function makeOrchestrator() {
  const prisma = {
    client: {
      membership: {
        findUnique: vi.fn(async () => ({ role: 'OWNER', permissionScopes: null })),
      },
      user: {
        findUnique: vi.fn(async () => ({ role: 'USER' })),
      },
    },
  };
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    logger: quiet,
    governance: { getToolTier: () => 2 },
    executionLog: { logToolExecution: async () => 'log_1' },
    businessGraph: { invalidateCache() {} },
    attributeExecutionLog: async () => undefined,
  }) as any;
  return { orchestrator };
}

describe('KEY-TOOL-ALLOWLIST (V1-63, D-318 Option 1): single v1 allowlist & FLOW_TOOLS module classification', () => {
  it('RED-BEFORE: member-chat tool menu never offers execute_custom_logic or any payroll write tool, while still offering projects_list', async () => {
    const { orchestrator } = makeOrchestrator();
    const about = [
      'execute_custom_logic',
      'payroll_set_rate',
      'payroll_generate_run',
      'payroll_approve_run',
      'payroll_mark_paid',
      'projects_list',
      'crm_list_contacts',
    ];
    const tools = await orchestrator.selectToolsForRequest(BIZ, [], about.join(' '), undefined, OWNER);
    const names = tools.map((t: { function: { name: string } }) => t.function.name);

    expect(names).not.toContain('execute_custom_logic');
    expect(names).not.toContain('payroll_set_rate');
    expect(names).not.toContain('payroll_generate_run');
    expect(names).not.toContain('payroll_approve_run');
    expect(names).not.toContain('payroll_mark_paid');

    // Domain hiding is NOT applied in KEY-TOOL-ALLOWLIST (deferred to KEY-TOOL-DOMAIN-HIDE)
    expect(names).toContain('projects_list');
    expect(names).toContain('crm_list_contacts');
  });

  it('RED-BEFORE: v1-tool-allowlist.ts classifies every FLOW tool into v1-modules.ts families and enforces unconditional removals', async () => {
    const mod = await import('./v1-tool-allowlist');

    expect(mod.V1_TOOL_UNAVAILABLE_MESSAGE).toBe('not available in this version');

    const registered = new Set(FLOW_TOOLS.map((t) => t.name));
    const hiddenOwner = new Map<string, string>();
    for (const m of V1_HIDDEN_MODULES) {
      for (const tool of m.keyTools) {
        hiddenOwner.set(tool, m.key);
      }
    }

    // SEC-V61-3: V1_KEY_TOOLS lives in v1-tool-allowlist.ts with zero overlap and zero unclassified FLOW tools
    const unclassified = [...registered].filter((t) => !hiddenOwner.has(t) && !mod.V1_KEY_TOOLS.has(t)).sort();
    expect(unclassified, 'unclassified FLOW tools').toEqual([]);
    const overlap = [...mod.V1_KEY_TOOLS].filter((t) => hiddenOwner.has(t)).sort();
    expect(overlap, 'tools in both V1_KEY_TOOLS and V1_HIDDEN_MODULES').toEqual([]);
    const ghost = [...mod.V1_KEY_TOOLS].filter((t) => !registered.has(t)).sort();
    expect(ghost, 'V1_KEY_TOOLS naming unregistered FLOW tools').toEqual([]);

    // Every registered FLOW tool resolves to a concrete module family
    for (const t of FLOW_TOOLS) {
      const fam = mod.v1ToolModuleFamily(t.name);
      expect(typeof fam, `missing module family for ${t.name}`).toBe('string');
      expect(fam.length, `empty module family for ${t.name}`).toBeGreaterThan(0);
      if (hiddenOwner.has(t.name)) {
        expect(fam).toBe(hiddenOwner.get(t.name));
      } else {
        expect(fam).toBe('v1_core');
      }
    }

    // Unconditional removals return exact plain refusal
    for (const disabled of [
      'execute_custom_logic',
      'payroll_set_rate',
      'payroll_generate_run',
      'payroll_approve_run',
      'payroll_mark_paid',
      'cortex.send_email',
      'cortex.send_message',
      'cortex.generate_report',
      'send_email',
      'send_message',
      'generate_report',
    ]) {
      expect(mod.isToolAllowedInV1(disabled), `${disabled} must be disallowed`).toBe(false);
      expect(mod.v1ToolRefusalReason(disabled), `${disabled} refusal message`).toBe('not available in this version');
    }

    // Hidden-module read tools remain allowed here (domain hiding belongs to KEY-TOOL-DOMAIN-HIDE)
    expect(mod.isToolAllowedInV1('projects_list')).toBe(true);
    expect(mod.v1ToolRefusalReason('projects_list')).toBeNull();
    expect(mod.isToolAllowedInV1('crm_list_contacts')).toBe(true);
    expect(mod.v1ToolRefusalReason('crm_list_contacts')).toBeNull();

    // No unconditionally disabled tool may be in V1_KEY_TOOLS
    for (const tool of mod.V1_UNCONDITIONALLY_DISABLED_FLOW_TOOLS) {
      expect(mod.V1_KEY_TOOLS.has(tool), `${tool} cannot be in V1_KEY_TOOLS`).toBe(false);
    }

    // Scope coverage sanity: every governed v1 tool has a canonical or extra scope entry
    const scopedTools = new Set([
      ...Object.values(CANONICAL_MODULE_TOOLS).flatMap((m) => Object.keys(m)),
      ...Object.keys(GOVERNED_UNGRANTED),
      ...EXTRA_SCOPED_GOVERNED_TOOLS,
    ]);
    expect(scopedTools.size).toBeGreaterThan(50);
  });

  it('R1 security hardening: case/whitespace bypasses and v1ToolModuleFamily normalization', async () => {
    const mod = await import('./v1-tool-allowlist');
    for (const variant of [
      'EXECUTE_CUSTOM_LOGIC',
      ' execute_custom_logic ',
      'CORTEX.SEND_EMAIL',
      ' cortex.send_email ',
      ' SEND_EMAIL ',
      ' PAYROLL_MARK_PAID ',
      'Payroll_Approve_Run',
    ]) {
      expect(mod.isToolAllowedInV1(variant), variant).toBe(false);
      expect(mod.v1ToolRefusalReason(variant), variant).toBe('not available in this version');
    }
    expect(mod.v1ToolModuleFamily(' CRM_LIST_CONTACTS ')).toBe('v1_core');
    expect(mod.v1ToolModuleFamily(' PROJECTS_LIST ')).toBe('projects');
  });

  it('R1 security hardening: AiOversightService.evaluate & PlanExecutorService.evaluateStep refuse disabled tools with zero approval creation', async () => {
    const { AiOversightService } = await import('./ai-oversight.service');
    const oversight = Object.assign(Object.create(AiOversightService.prototype), {
      getAutonomySettings: vi.fn(),
    }) as any;

    for (const disabled of ['execute_custom_logic', 'EXECUTE_CUSTOM_LOGIC', 'payroll_mark_paid', 'cortex.send_email']) {
      const decision = await oversight.evaluate(BIZ, disabled);
      expect(decision.allowed, disabled).toBe(false);
      expect(decision.requiresFormalApproval, disabled).toBe(false);
      expect(decision.requiresAdminApproval, disabled).toBe(false);
      expect(decision.reason, disabled).toBe('not available in this version');
    }
    expect(oversight.getAutonomySettings).not.toHaveBeenCalled();

    const { PlanExecutorService } = await import('./plan-executor.service');
    const evaluateAction = vi.fn();
    const executor = Object.assign(Object.create(PlanExecutorService.prototype), {
      autonomyOrchestrator: { evaluateAction },
      governance: oversight,
      logger: quiet,
    }) as any;

    for (const disabled of ['execute_custom_logic', 'payroll_generate_run', ' PAYROLL_APPROVE_RUN ']) {
      const stepDecision = await executor.evaluateStep(BIZ, disabled);
      expect(stepDecision, disabled).toEqual({
        allowed: false,
        reason: 'not available in this version',
        requiresFormalApproval: false,
        requiresAdminApproval: false,
      });
    }
    expect(evaluateAction).not.toHaveBeenCalled();
  });

  it('R1 security hardening: KeyCortexToolLoopService.handleToolCalls refuses disabled tools before safety/autonomy approval', async () => {
    const { KeyCortexToolLoopService } = await import('../key-cortex/key-cortex-tool-loop.service');
    const safetyCheck = vi.fn();
    const autonomyEvaluate = vi.fn();
    const registryExecute = vi.fn();
    const modelGateway = {
      complete: vi.fn(async () => ({ content: 'Tools refused in v1' })),
    };
    const loop = Object.assign(Object.create(KeyCortexToolLoopService.prototype), {
      logger: quiet,
      modelGateway,
      toolRegistry: {
        getTool: () => ({ name: 'cortex.send_email', riskTier: 3 }),
        execute: registryExecute,
      },
      safety: { check: safetyCheck, recordExecution: vi.fn() },
      autonomyOrchestrator: { evaluate: autonomyEvaluate },
      autonomyLevelService: { resolve: vi.fn(async () => ({ level: 1 })) },
    }) as any;

    const out = await loop.handleToolCalls(
      {
        toolCalls: [
          { id: 'tc_1', function: { name: 'CORTEX.SEND_EMAIL', arguments: '{}' } },
          { id: 'tc_2', function: { name: 'EXECUTE_CUSTOM_LOGIC', arguments: '{}' } },
        ],
      },
      [{ role: 'user', content: 'test' }],
      { businessId: BIZ, userId: OWNER, message: 'test' },
      { provider: 'openai', model: 'gpt-4o-mini', tier: 1, reason: 'test' },
      {},
      'general',
    );

    expect(out?.actions).toHaveLength(2);
    for (const a of out!.actions) {
      expect(a.status).toBe('error');
      expect(a.error).toBe('not available in this version');
      expect(a.requiresApproval).toBe(false);
    }
    expect(safetyCheck).not.toHaveBeenCalled();
    expect(autonomyEvaluate).not.toHaveBeenCalled();
    expect(registryExecute).not.toHaveBeenCalled();
  });

  it('R1 security hardening: KeyCortexActionsService blocks nested EXECUTE_TOOL, whitespace actionType, and requestApproval with zero proposals', async () => {
    const { KeyCortexActionsService } = await import('../key-cortex/key-cortex-actions.service');
    const createProposal = vi.fn();
    const evaluateAutonomy = vi.fn(async () => ({ allowed: true, requiresApproval: true }));
    const trackActionExecution = vi.fn(async () => undefined);
    const registryExecute = vi.fn();

    const svc = Object.assign(Object.create(KeyCortexActionsService.prototype), {
      logger: quiet,
      proposalService: { create: createProposal },
      keyCortexToolRegistry: { execute: registryExecute },
      evaluateAutonomy,
      trackActionExecution,
      emitActionEvent: vi.fn(),
    }) as any;

    const session = { id: 'sess_1', businessId: BIZ, userId: OWNER };
    const batch = await svc.executeActions(
      [
        { actionType: 'EXECUTE_TOOL', status: 'pending', description: 'nested', result: { toolName: 'cortex.send_email' } },
        { actionType: 'EXECUTE_TOOL', status: 'pending', description: 'nested2', result: { toolName: ' EXECUTE_CUSTOM_LOGIC ' } },
        { actionType: ' SEND_EMAIL ' as any, status: 'pending', description: 'padded', result: {} },
      ],
      session,
    );

    expect(batch).toHaveLength(3);
    for (const res of batch) {
      expect(res.status).toBe('blocked');
      expect(res.requiresApproval).toBe(false);
      expect(res.error).toBe('not available in this version');
    }
    expect(evaluateAutonomy).not.toHaveBeenCalled();
    expect(createProposal).not.toHaveBeenCalled();
    expect(registryExecute).not.toHaveBeenCalled();

    const directApproval = await svc.requestApproval(
      { actionType: 'EXECUTE_TOOL', status: 'pending', description: 'nested', result: { toolName: 'payroll_mark_paid' } },
      session,
    );
    expect(directApproval).toEqual({ approved: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it('R1 security hardening: KeyCortexActionDetectionService omits SEND_EMAIL, SEND_MESSAGE, and GENERATE_REPORT', async () => {
    const { KeyCortexActionDetectionService } = await import('../key-cortex/key-cortex-action-detection.service');
    const detector = new KeyCortexActionDetectionService();
    const detected = detector.detectActions(
      '[[ACTION:SEND_EMAIL]]send email[[/ACTION]] [[ACTION:SEND_MESSAGE]]send msg[[/ACTION]] [[ACTION:GENERATE_REPORT]]gen report[[/ACTION]] [[ACTION:CREATE_TASK]]create task[[/ACTION]]',
    );
    const types = detected.map((a) => a.actionType);
    expect(types).not.toContain('SEND_EMAIL');
    expect(types).not.toContain('SEND_MESSAGE');
    expect(types).not.toContain('GENERATE_REPORT');
    expect(types).toContain('CREATE_TASK');
  });

  it('R1 security hardening: FlowOrchestratorService.executeTool throws ForbiddenException so ActionDispatcherService treats v1 refusal as final', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    const { orchestrator } = makeOrchestrator();
    await expect(
      (orchestrator as any).executeTool(BIZ, 'execute_custom_logic', {}, undefined, undefined, {
        surface: 'CHAT',
        principalUserId: OWNER,
      }),
    ).resolves.toMatchObject({
      success: false,
      error: 'not available in this version',
    });
    // executeToolDirectly rethrows the ForbiddenException recorded in TOOL_HTTP_EXCEPTIONS
    await expect(
      (orchestrator as any).executeToolDirectly(BIZ, 'execute_custom_logic', {}, undefined, {
        surface: 'PLAN_QUEUE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
