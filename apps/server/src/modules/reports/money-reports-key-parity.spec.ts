/**
 * V1-81 (FOLLOW3-A7-MONEY-REPORTS) review repairs A7-SEC-1 / CRR-A7-1 / CRR-A7-2 — the
 * KEY doors to the money reports ask for what the HTTP routes ask for (kernel K2).
 *
 * Item 9 (owner ruling D-57) put GET reports/{generate, pnl, cashflow, balance-sheet,
 * tax-summary, ar-aging, revenue-by} and GET commerce revenue-reports/:preset behind
 * revenue:read. The KEY tools that call the same services were left where they were:
 *  - the five finance report tools were in no canonical table, so the legacy `finance`
 *    JobRole key (no revenue scope) still reached them through `finance_*`;
 *  - reports_generate was in no canonical table either, so POST actions/.../execute of a
 *    stored reports_generate step fell back to the `reports_` prefix rule and asked only
 *    for analytics:read (graph-actions.controller GRAPH_ACTION_TOOL_MODULES).
 * CANONICAL_MODULE_TOOLS.revenue now lists the six at 'read'. This spec reads the route
 * decorators themselves (the metadata ModuleScopeGuard reads) and pins that the job-role
 * envelope and the graph-action route bound each tool by the same requirement.
 * job-role-tool-families.spec.ts derives the table from the decorators; the per-map K2 cases
 * with the real ModuleScopeGuard are in job-role-policy.service.spec.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { MODULE_SCOPE_KEY } from '../../core/auth/module-scope.guard';
import { ReportsController } from './reports.controller';
import { RevenueReportingController } from '../commerce/revenue-reporting.controller';
import { CANONICAL_MODULE_TOOLS, JobRolePolicyService } from '../structure/job-role-policy.service';
import { graphActionModuleScope, graphActionRequirement, graphPlanReadScope, visiblePlanSteps } from '../ai/graph-actions.controller';
import {
  cortexCommandRefusal,
  cortexCommandRequirement,
  type CortexMemberAuthority,
} from '../key-cortex/key-cortex.controller';
import { defaultScopesForRole } from '../../core/authority/module-vocabulary';
import { KeyCortexQueryPipelineService } from '../key-cortex/key-cortex-query-pipeline.service';
import * as planAuthority from '../key-cortex/key-cortex-plan-authority';
import { KeyCortexCapabilityRegistryService } from '../key-cortex/key-cortex-capability-registry.service';
import { AiController } from '../ai/ai.controller';

/** The KEY tool that reads what each revenue-gated report route reads. */
const TOOL_ROUTE: ReadonlyArray<readonly [tool: string, handler: keyof ReportsController]> = [
  ['finance_profit_and_loss', 'pnl'],
  ['finance_cashflow', 'cashflow'],
  ['finance_balance_sheet', 'balanceSheet'],
  ['finance_tax_summary', 'taxSummary'],
  ['finance_revenue_breakdown', 'revenueBy'],
  ['reports_generate', 'generateReport'],
];
const REPORT_TOOLS = TOOL_ROUTE.map(([t]) => t);

const scopeOf = (proto: object, handler: string) =>
  Reflect.getMetadata(MODULE_SCOPE_KEY, (proto as Record<string, unknown>)[handler] as object);

/**
 * A7-SEC-2 (W9-MONEY-REPORTS-KEY, D-57): the KEY Cortex direct commands that read a money report,
 * the module scope their connector module already needs at write, and the report route whose
 * requirement they carry (generate_pnl reads the P&L; create_report / export_report read any report
 * GET reports/generate serves, P&L, cash flow, balance sheet, tax summary and revenue by included).
 */
const MONEY_REPORT_COMMANDS: ReadonlyArray<
  readonly [module: string, action: string, moduleScope: string, handler: keyof ReportsController]
> = [
  ['finance', 'generate_pnl', 'expenses', 'pnl'],
  ['analytics', 'create_report', 'analytics', 'generateReport'],
  ['analytics', 'export_report', 'analytics', 'generateReport'],
];

const member = (scopes: Record<string, string>, role = 'STAFF'): CortexMemberAuthority => ({
  userId: 'usr_v95h_member',
  businessId: 'biz_v95h_report',
  role,
  superAdmin: false,
  scopes,
  member: true,
});

const policy = new JobRolePolicyService();

/**
 * SEC-W9MRK-3 (W10-CORTEX-CHAT-SCOPE, D-57): the KEY chat pipeline behind POST cortex/chat (processQuery)
 * and the chat stream (streamQuery), run with the v2 integration on as KeyCortexReasoningService runs it:
 * the commands parsed from the member's words, or detected in the stream's answer, are put to the
 * autonomy authority (which allows everything here) and run through the executor's executeBatch. The
 * member is the one the membership row names; every other collaborator is a stand-in.
 */
const CHAT_USER = 'usr_v96r_chat_member';
const CHAT_BIZ = 'biz_v96r_chat';

function chatPipeline(opts: {
  membership: { role: string; permissionScopes: Record<string, string> | null } | null;
  intents?: Array<{ module: string; action: string }>;
  detected?: Array<{ actionType: string }>;
}) {
  const allow = { allowed: true, requiresApproval: false, tier: 'full', confidence: 1, reason: 'policy allows', ruleTrace: [], createdAt: new Date(0) };
  const record = (command: any) => ({
    id: `exec-${command.action}`,
    command,
    result: { command, success: true, data: { ran: true }, executionTimeMs: 1 },
    startedAt: new Date(0),
    finishedAt: new Date(0),
    durationMs: 1,
    traceId: 'trace',
    rolledBack: false,
  });
  const executor = {
    executeBatch: vi.fn(async (commands: any[]) => ({
      results: commands.map(record),
      totalCommands: commands.length,
      succeededCount: commands.length,
      failedCount: 0,
      rolledBackCount: 0,
      durationMs: 1,
      traceId: 'trace',
      stoppedEarly: false,
      summary: 'stand-in',
    })),
    executeWithApproval: vi.fn(async (command: any) => ({ id: `proposal-${command.action}`, command, status: 'pending', requestedAt: new Date(0) })),
    logExecution: vi.fn(async (_row: unknown) => undefined),
  };
  const prisma = {
    client: {
      user: { findUnique: vi.fn(async () => ({ role: 'USER' })) },
      membership: { findUnique: vi.fn(async () => opts.membership) },
      business: { findFirst: vi.fn(async () => null) },
    },
  };
  const session = { id: 'sess_v96r_chat', businessId: CHAT_BIZ, userId: CHAT_USER, status: 'active', persona: 'jarvis', messages: [], detectedRole: null, detectedFunction: null };
  const route = {
    taskCategory: 'general', layers: ['ethics'], promptVariant: 'concise', includeGenomeContext: false, includeMemoryContext: false,
    includeActions: true, complexity: 'simple', domain: 'general', urgency: 'low', emotionalWeight: 'low', timeHorizon: 'tactical', dataRequirement: 'none',
  };
  const pipeline = new KeyCortexQueryPipelineService(
    {
      complete: async () => ({ content: 'Done.', provider: 'openai', model: 'stand-in', usage: { totalTokens: 1, estimatedCost: 0 }, fallbackUsed: false }),
      streamComplete: async function* () {
        yield { content: 'Done.', provider: 'openai', model: 'stand-in' };
      },
    } as any,
    prisma as any,
    { get: async () => null, setex: async () => undefined } as any,
    {
      getPersonalityConfig: () => ({ persona: 'jarvis', temperature: 0.5 }),
      buildSystemPrompt: () => 'You are KEY.',
      buildValueBlock: async () => '',
      classifyPersona: async () => undefined,
      selectTone: async () => ({ tone: '', temperatureAdjustment: 0 }),
    } as any,
    { buildContextSnapshot: async () => ({ businessId: CHAT_BIZ, genomeStage: 'startup', executiveReadiness: 50 }), formatContextForPrompt: () => '' } as any,
    { buildToolDefinitions: async () => [], executeActions: vi.fn(async () => []) } as any,
    {
      getOrCreateSession: async () => session,
      generateId: () => 'msg_v96r',
      saveMessage: async () => undefined,
      updateSessionCognitionMetadata: async () => undefined,
      updateRunningSummary: async () => undefined,
    } as any,
    { buildMemoryContext: async () => ({}), buildMessages: () => [] } as any,
    { handleToolCalls: async () => null } as any,
    {
      detectActions: () =>
        (opts.detected ?? []).map((d) => ({ actionType: d.actionType, status: 'pending_approval', description: `detected ${d.actionType}`, requiresApproval: false })),
    } as any,
    { generateSuggestions: async () => [] } as any,
    {} as any,
    { buildV2SystemPrompt: () => 'V2', buildV3SystemPrompt: () => 'V3', enrichSnapshotFromV2: () => undefined, enrichSnapshotFromGenome: () => undefined } as any,
    {
      classifyTaskCategory: () => 'general',
      buildStructuredOutputInstructions: () => '',
      parseStructuredResponse: () => ({ role: 'assistant', recommendation: 'Done.', confidence: 80 }),
    } as any,
    { detectMood: () => 'casual' } as any,
    undefined,
    { route: async () => route } as any,
    { getAllCapabilities: () => [] } as any,
    {
      parseIntent: async () =>
        (opts.intents ?? []).map((i) => ({ ...i, parameters: {}, requiresApproval: false, naturalLanguage: `${i.module}.${i.action}` })),
      toConnectorCommand: (intent: any, businessId: string, userId: string) => ({
        module: intent.module,
        action: intent.action,
        parameters: intent.parameters,
        businessId,
        userId,
        source: 'key_cortex',
      }),
    } as any,
    executor as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { evaluateAction: vi.fn(async () => allow) } as any,
  );
  for (const level of ['error', 'warn', 'log', 'debug'] as const) {
    vi.spyOn((pipeline as any).logger, level).mockImplementation(() => undefined);
  }
  const query = { text: 'run it', businessId: CHAT_BIZ, userId: CHAT_USER, enableActions: true } as any;
  const flags = { integrationV2Enabled: true, genomeV3Enabled: false };
  return {
    executor,
    chat: () => pipeline.processQuery(query, flags),
    stream: async () => {
      const chunks: any[] = [];
      for await (const chunk of pipeline.streamQuery(query, flags)) chunks.push(chunk);
      return chunks;
    },
    executed: () => executor.executeBatch.mock.calls.flatMap(([commands]: any[]) => commands),
    refusals: () => executor.logExecution.mock.calls.map(([row]: any[]) => row),
  };
}
const reaches = (permissions: Record<string, string>, tool: string) =>
  policy.isToolAllowed(policy.envelopeForJobRole({ id: 'jr_v81', name: 'Position', permissions }), tool);

describe('V1-81 review repairs: the KEY doors to the money reports need revenue:read, as the routes do (K2)', () => {
  it('the routes require revenue:read (the decorators ModuleScopeGuard reads)', () => {
    for (const handler of ['generateReport', 'pnl', 'cashflow', 'balanceSheet', 'taxSummary', 'arAging', 'revenueBy']) {
      expect(scopeOf(ReportsController.prototype, handler), handler).toEqual({ module: 'revenue', minLevel: 'read' });
    }
    expect(scopeOf(RevenueReportingController.prototype, 'getPreset')).toEqual({ module: 'revenue', minLevel: 'read' });
    // control (scope ruling): ap-aging and expense-by carry no revenue and declare no scope
    for (const handler of ['apAging', 'expenseBy']) expect(scopeOf(ReportsController.prototype, handler), handler).toBeUndefined();
  });

  it.each(TOOL_ROUTE)('A7-SEC-1: %s is in CANONICAL_MODULE_TOOLS at the level of its route (%s)', (tool, handler) => {
    const route = scopeOf(ReportsController.prototype, handler);
    expect(CANONICAL_MODULE_TOOLS.revenue[tool]).toBe(route.minLevel);
    for (const [module, tools] of Object.entries(CANONICAL_MODULE_TOOLS)) {
      if (module !== 'revenue') expect(Object.keys(tools), `${module} grants ${tool}`).not.toContain(tool);
    }
  });

  it.each(REPORT_TOOLS)('A7-SEC-1: a JobRole without revenue:read does not reach %s; revenue:read does', (tool) => {
    for (const permissions of [
      { finance: 'read' },
      { finance: 'admin', expenses: 'admin' },
      { analytics: 'admin' },
      { revenue: 'none', finance: 'admin' },
      { Revenue: 'read' },
    ]) {
      expect(reaches(permissions, tool), `${JSON.stringify(permissions)} -> ${tool}`).toBe(false);
    }
    expect(reaches({ revenue: 'read' }, tool)).toBe(true);
  });

  it('control: expense-by declares no scope, so the legacy finance key keeps finance_expense_breakdown', () => {
    expect(scopeOf(ReportsController.prototype, 'expenseBy')).toBeUndefined();
    expect(reaches({ finance: 'read' }, 'finance_expense_breakdown')).toBe(true);
  });

  it.each(REPORT_TOOLS)('CRR-A7-2: a stored %s step executed from POST actions/.../execute needs revenue:read, not analytics', (tool) => {
    expect(graphActionModuleScope(tool)).toEqual({ module: 'revenue', minLevel: 'read' });
    expect(graphActionRequirement(tool)).toEqual({ scopes: [{ module: 'revenue', minLevel: 'read' }] });
  });

  // A7-SEC-2 (W9-MONEY-REPORTS-KEY, owner ruling D-57): the KEY Cortex direct-command door
  // (key-cortex.controller.ts CORTEX_MODULE_RULES: finance -> expenses, analytics -> analytics, at
  // write) served finance.generate_pnl (finance-adapter.service.ts -> LedgerReportingService.getPnl)
  // and analytics.create_report / export_report (P&L, cash flow, balance sheet, tax summary, revenue
  // by customer, CSV included) to a member with revenue:none. Those three now also need revenue:read,
  // the requirement the REST money reports declare, on top of their module's own write scope.
  it.each(MONEY_REPORT_COMMANDS)(
    'A7-SEC-2 (W9-MONEY-REPORTS-KEY, was it.todo): cortexCommandRefusal refuses %s.%s to a member without revenue:read (D-57)',
    (module, action, moduleScope) => {
      for (const scopes of [
        { [moduleScope]: 'write' },
        { [moduleScope]: 'admin', revenue: 'none' },
        { [moduleScope]: 'admin', finance: 'admin', expenses: 'admin', analytics: 'admin', reports: 'admin' },
        { [moduleScope]: 'admin', Revenue: 'read' },
        { [moduleScope]: 'admin', revenue: 'owner' },
      ]) {
        const level = (scopes as Record<string, string>).revenue ?? 'none';
        expect(cortexCommandRefusal(member(scopes), module, action), `${JSON.stringify(scopes)} -> ${module}.${action}`).toBe(
          `Insufficient permissions: revenue requires read access (you have ${level})`,
        );
      }
      for (const level of ['read', 'write', 'admin']) {
        expect(cortexCommandRefusal(member({ [moduleScope]: 'write', revenue: level }), module, action), level).toBeNull();
      }
    },
  );

  it.each(MONEY_REPORT_COMMANDS)(
    'A7-SEC-2 (W9-MONEY-REPORTS-KEY): %s.%s asks for what the money report route asks for (the decorator ModuleScopeGuard reads, D-57)',
    (module, action, moduleScope, handler) => {
      const route = scopeOf(ReportsController.prototype, handler);
      expect(route).toEqual({ module: 'revenue', minLevel: 'read' });
      expect(cortexCommandRequirement(module, action)).toEqual({ scope: moduleScope, alsoRequires: route });
    },
  );

  it('A7-SEC-2 (W9-MONEY-REPORTS-KEY) control: revenue:read does not replace the module write scope; other finance and analytics actions, the role defaults and SUPER_ADMIN are unchanged (D-57)', () => {
    // revenue alone is not the module's own write scope
    expect(cortexCommandRefusal(member({ revenue: 'admin' }), 'finance', 'generate_pnl')).toBe(
      'Insufficient permissions: expenses requires write access (you have none)',
    );
    expect(cortexCommandRefusal(member({ revenue: 'admin', analytics: 'read' }), 'analytics', 'export_report')).toBe(
      'Insufficient permissions: analytics requires write access (you have read)',
    );
    // the actions that read no money report keep the module rule alone
    const others: ReadonlyArray<readonly [module: string, action: string, moduleScope: string]> = [
      ['finance', 'record_expense', 'expenses'],
      ['finance', 'create_budget', 'expenses'],
      ['analytics', 'create_dashboard', 'analytics'],
      ['analytics', 'track_event', 'analytics'],
    ];
    for (const [module, action, moduleScope] of others) {
      expect(cortexCommandRequirement(module, action), `${module}.${action}`).toEqual({ scope: moduleScope });
      for (const scopes of [{ [moduleScope]: 'write' }, { [moduleScope]: 'write', revenue: 'none' }]) {
        expect(cortexCommandRefusal(member(scopes), module, action), `${module}.${action}`).toBeNull();
      }
    }
    for (const [module, action] of MONEY_REPORT_COMMANDS) {
      // OWNER and ADMIN role defaults hold revenue admin; STAFF defaults stop at the module write scope, as before
      expect(cortexCommandRefusal(member(defaultScopesForRole('OWNER'), 'OWNER'), module, action)).toBeNull();
      expect(cortexCommandRefusal(member(defaultScopesForRole('ADMIN'), 'ADMIN'), module, action)).toBeNull();
      expect(cortexCommandRefusal(member(defaultScopesForRole('STAFF'), 'STAFF'), module, action)).toMatch(/requires write access \(you have read\)$/);
      // ModuleScopeGuard admits SUPER_ADMIN on the REST money reports; D-46 is about invoice writes
      for (const isMember of [true, false]) {
        expect(cortexCommandRefusal({ ...member({}, 'SUPER_ADMIN'), superAdmin: true, member: isMember }, module, action)).toBeNull();
      }
    }
  });

  // W9-MONEY-REPORTS-KEY review round 1 (owner ruling D-57): three other KEY doors still reach the
  // same money reports without revenue:read. Each was reproduced (a throwaway probe, deleted, or
  // the code path read) and none can be closed in this packet's write set (the cortexCommandRefusal
  // implementation and this spec), so each stays it.todo for a follow-up packet:
  //  - SEC-W9MRK-1 / MRK-CR-1, the plan door: memberPlanStepScopeRefusal (key-cortex-plan-authority.ts,
  //    called by KeyCortexPlannerService.assertMemberSteps for POST cortex/plans/:planId/execute and
  //    chat goal plans) maps finance to expenses and analytics to analytics with no per-action rule:
  //    it returns null for finance.generate_pnl with { expenses: 'write', revenue: 'none' } and for
  //    analytics.create_report / export_report with { analytics: 'write', revenue: 'none' }, where
  //    cortexCommandRefusal now refuses. assertMemberSteps also skips that check for an ADMIN (D-71:
  //    an ADMIN keeps every module), while the direct-command door holds an ADMIN's explicit scopes;
  //    the follow-up needs a ruling on an ADMIN with explicit revenue 'none'.
  //  - SEC-W9MRK-2, the read door: planStepReadRule (graph-actions.controller.ts; GET ai/plans,
  //    GET ai/plans/:planId, GET cortex/plans/:planId, and GET ai/execution-logs through
  //    visibleExecutionLogs, which reuses it) judges a KEY-cortex step by its module's read scope
  //    alone, so an ADMIN (seesEveryPlan) with { expenses: 'read', analytics: 'read', revenue: 'none' }
  //    reads the stored output of the OWNER's finance.generate_pnl or analytics.create_report step
  //    intact (the executor stores the whole report in outputResult and the execution log row).
  //  - SEC-W9MRK-3, the chat door: POST cortex/chat and its stream with enableActions run the parsed
  //    commands through executorService.executeBatch after the autonomy authority alone
  //    (key-cortex-query-pipeline.service.ts, evaluateParsedCommandAutonomy); no member scope rule
  //    (cortexCommandRefusal or any membership read) applies, and the batch result data is returned.
  //    Pre-existing, and wider than the money reports: it holds for every registry action.
  //    W10-CORTEX-CHAT-SCOPE turned it live (below).
  //    W10-KEY-PLAN-SCOPE turned SEC-W9MRK-1 and SEC-W9MRK-2 live (below), under owner ruling D-114.

  // SEC-W9MRK-1 / MRK-CR-1 (W10-KEY-PLAN-SCOPE, owner rulings D-57 and D-114): the plan door asks what the
  // direct-command door asks. A member held to module scopes needs revenue:read for a money report step,
  // on top of its module's own scope (memberPlanStepScopeRefusal). D-114 amends D-71's ADMIN bypass for an
  // explicit revenue 'none' only: an ADMIN whose explicit scope map sets revenue to none (an absent key
  // reads 'none', as ModuleScopeGuard reads it) is refused money steps, the money reports and the invoice
  // actions (commerce); an ADMIN with role-default scopes keeps every step, and an ADMIN keeps every other
  // module whatever its map says (adminPlanStepScopeRefusal).
  it('SEC-W9MRK-1 / MRK-CR-1 (W10-KEY-PLAN-SCOPE, D-114, was it.todo): a KEY plan step finance.generate_pnl, analytics.create_report or analytics.export_report is refused to a member without revenue:read, and to an ADMIN whose explicit scope map sets revenue to none (memberPlanStepScopeRefusal, adminPlanStepScopeRefusal, D-57, D-71)', () => {
    const { memberPlanStepScopeRefusal, adminPlanStepScopeRefusal, planStepReadsMoneyReport } = planAuthority as any;
    for (const [module, action, moduleScope] of MONEY_REPORT_COMMANDS) {
      const label = `${module}.${action}`;
      expect(planStepReadsMoneyReport(module, action), label).toBe(true);
      // the plan door asks what the direct-command door asks: the module's own scope, and revenue:read
      expect(cortexCommandRequirement(module, action), label).toEqual({ scope: moduleScope, alsoRequires: { module: 'revenue', minLevel: 'read' } });
      for (const scopes of [
        { [moduleScope]: 'write' },
        { [moduleScope]: 'admin', revenue: 'none' },
        { [moduleScope]: 'admin', finance: 'admin', expenses: 'admin', analytics: 'admin', reports: 'admin' },
        { [moduleScope]: 'admin', Revenue: 'read' },
        { [moduleScope]: 'admin', revenue: 'owner' },
      ]) {
        const level = (scopes as Record<string, string>).revenue ?? 'none';
        expect(memberPlanStepScopeRefusal(module, action, scopes), `${JSON.stringify(scopes)} -> ${label}`).toBe(
          `Insufficient permissions: revenue requires read access (you have ${level}); plan step "${label}" reads a money report, so it is not run (D-57)`,
        );
      }
      for (const level of ['read', 'write', 'admin']) {
        expect(memberPlanStepScopeRefusal(module, action, { [moduleScope]: 'write', revenue: level }), `${label} revenue ${level}`).toBeNull();
      }
      // the module's own scope is still checked first (revenue alone is not the module's write scope)
      expect(memberPlanStepScopeRefusal(module, action, { revenue: 'admin' }), label).toBe(
        `Insufficient permissions: ${moduleScope} requires write access (you have none); plan step "${label}" is not run (D-71)`,
      );
    }

    // D-114: an ADMIN whose explicit map sets revenue to none (or leaves it out) is refused every money step
    const adminNoRevenue = { ...defaultScopesForRole('ADMIN'), revenue: 'none' };
    const adminWithoutRevenueKey = Object.fromEntries(Object.entries(defaultScopesForRole('ADMIN')).filter(([key]) => key !== 'revenue'));
    const moneySteps: ReadonlyArray<readonly [string, string]> = [
      ...MONEY_REPORT_COMMANDS.map(([module, action]) => [module, action] as const),
      ['commerce', 'create_invoice'],
      ['commerce', 'process_payment'],
      ['commerce', 'get_revenue_summary'],
    ];
    for (const [module, action] of moneySteps) {
      const label = `${module}.${action}`;
      for (const explicit of [adminNoRevenue, adminWithoutRevenueKey, { revenue: 'none' }, { revenue: 'Read' }]) {
        const level = (explicit as Record<string, string>).revenue ?? 'none';
        expect(adminPlanStepScopeRefusal(module, action, explicit), `${JSON.stringify(explicit)} -> ${label}`).toBe(
          `Insufficient permissions: revenue requires read access (you have ${level}); plan step "${label}" is a money step, and an ADMIN whose revenue access is set to none runs no money step (D-114)`,
        );
      }
      // control: role-default scopes (no explicit map) keep D-71; an explicit revenue read or above runs it
      expect(adminPlanStepScopeRefusal(module, action, null), `${label} role defaults`).toBeNull();
      for (const level of ['read', 'write', 'admin']) {
        expect(adminPlanStepScopeRefusal(module, action, { ...adminNoRevenue, revenue: level }), `${label} revenue ${level}`).toBeNull();
      }
    }
    // control: an ADMIN keeps every other module, whatever its explicit map says (D-114 amends D-71 for money steps only)
    const denied = { revenue: 'none', expenses: 'none', bookings: 'none', analytics: 'none', crm: 'none' };
    for (const [module, action] of [['finance', 'record_expense'], ['bookings', 'create_booking'], ['analytics', 'create_dashboard'], ['crm', 'update_contact'], [null, 'analyze']] as const) {
      expect(adminPlanStepScopeRefusal(module, action, denied), `${module}.${action}`).toBeNull();
    }
  });

  it('SEC-W9MRK-1 (W10-KEY-PLAN-SCOPE, D-57, D-114) control: the plan door and the direct-command door name the same money report actions (every registry action: planStepReadsMoneyReport exactly where cortexCommandRequirement also requires revenue:read)', () => {
    const { planStepReadsMoneyReport } = planAuthority as any;
    let money = 0;
    for (const capability of new KeyCortexCapabilityRegistryService().getAllCapabilities()) {
      for (const { name } of capability.actions) {
        const requirement = cortexCommandRequirement(capability.module, name) as { alsoRequires?: unknown };
        const label = `${String(capability.module)}.${name}`;
        expect(planStepReadsMoneyReport(capability.module, name), label).toBe(!!requirement.alsoRequires);
        if (requirement.alsoRequires) money += 1;
      }
    }
    expect(money).toBe(MONEY_REPORT_COMMANDS.length);
  });

  // SEC-W9MRK-2 (W10-KEY-PLAN-SCOPE, owner rulings D-57, D-74 and D-114): the plan read rule (planStepReadRule,
  // which GET ai/plans, GET ai/plans/:planId, GET cortex/plans/:planId and, through visibleExecutionLogs,
  // GET ai/execution-logs apply) shows a money report KEY-cortex step to a viewer who reads its module, and
  // its stored output (the whole report) only to one who also reads revenue. The viewer's scopes are the
  // ones the real graphPlanReadScope reads from the membership row (an ADMIN's explicit map included).
  it('SEC-W9MRK-2 (W10-KEY-PLAN-SCOPE, D-114, was it.todo): the stored output of a money-report KEY step is withheld from a plan or execution-log viewer without revenue:read (planStepReadRule, visibleExecutionLogs, D-57, D-74)', async () => {
    const BIZ = 'biz_v96s_reads';
    const VIEWER = 'usr_v96s_viewer';
    const OWNER = 'usr_v96s_owner';
    const REPORT = { revenue: 98765, netProfit: 4321, marker: 'v96s_money_report' };
    const EXPENSE = { id: 'v96s_expense_row', amount: 12 };
    const steps = [
      ...MONEY_REPORT_COMMANDS.map(([module, action]) => ({ toolName: null, module, action, inputPayload: { period: 'month' }, outputResult: REPORT })),
      { toolName: null, module: 'finance', action: 'record_expense', inputPayload: { amount: 12 }, outputResult: EXPENSE },
    ];
    const logs = steps.map((step, i) => ({
      id: `log_v96s_${i}`,
      businessId: BIZ,
      userId: OWNER,
      toolName: `${step.module}.${step.action}`,
      module: step.module,
      action: step.action,
      inputSummary: { actorId: OWNER, parameters: step.inputPayload },
      outputSummary: { data: step.outputResult, rolledBack: false },
      errorMessage: null,
      success: true,
    }));
    type Viewer = { role: string; permissionScopes: Record<string, string> | null };
    const read = async (membership: Viewer) => {
      const prisma = {
        client: {
          user: { findUnique: vi.fn(async () => ({ id: VIEWER, role: 'USER' })) },
          membership: { findUnique: vi.fn(async () => membership) },
          business: { findFirst: vi.fn(async () => null) },
          aiExecutionLog: {
            groupBy: vi.fn(async () => logs.map(({ toolName, action, module }) => ({ toolName, action, module }))),
            findMany: vi.fn(async () => logs),
            count: vi.fn(async () => logs.length),
          },
        },
      };
      const scope = await graphPlanReadScope(prisma as any, BIZ, { id: VIEWER, role: 'USER' });
      const planSteps = await visiblePlanSteps(steps, scope);
      const controller = Object.create(AiController.prototype);
      Object.assign(controller, { prisma, executionLog: { getHistory: vi.fn(async () => ({ logs, total: logs.length, limit: 1000, offset: 0 })) } });
      const served = await controller.getExecutionLogs(BIZ, { user: { id: VIEWER, role: 'USER' } }, undefined, undefined, '1000');
      return { planSteps, logs: served.logs as typeof logs };
    };
    const moneyLabels = MONEY_REPORT_COMMANDS.map(([module, action]) => `${module}.${action}`);

    // an ADMIN (who sees every plan) whose explicit map holds expenses and analytics but sets revenue to
    // none, and a STAFF member reading its own plan with the same reads: each money report step is shown
    // with its input, its output withheld; the expense step keeps its output
    const withheldFrom: Viewer[] = [
      { role: 'ADMIN', permissionScopes: { ...defaultScopesForRole('ADMIN'), revenue: 'none' } },
      { role: 'ADMIN', permissionScopes: { expenses: 'read', analytics: 'read', revenue: 'none' } },
      { role: 'STAFF', permissionScopes: { expenses: 'read', analytics: 'read', revenue: 'none' } },
    ];
    for (const membership of withheldFrom) {
      const who = JSON.stringify(membership);
      const { planSteps, logs: served } = await read(membership);
      expect(planSteps.map((s) => `${s.module}.${s.action}`), who).toEqual([...moneyLabels, 'finance.record_expense']);
      for (const step of planSteps.slice(0, moneyLabels.length)) {
        expect(step, `${who} ${step.module}.${step.action}`).toMatchObject({ outputResult: null, inputPayload: { period: 'month' } });
      }
      expect(planSteps[moneyLabels.length].outputResult, who).toEqual(EXPENSE);
      if (membership.role === 'ADMIN') {
        // GET ai/execution-logs: the same rule over the rows the KEY executor wrote for those steps
        expect(served.map((l) => l.toolName), who).toEqual([...moneyLabels, 'finance.record_expense']);
        for (const row of served.slice(0, moneyLabels.length)) {
          expect(row, `${who} ${row.toolName}`).toMatchObject({ outputSummary: null, errorMessage: null, inputSummary: { parameters: { period: 'month' } } });
        }
        expect(served[moneyLabels.length].outputSummary, who).toEqual({ data: EXPENSE, rolledBack: false });
      }
    }

    // control: an ADMIN with role-default scopes (revenue admin), an ADMIN whose explicit map holds revenue
    // read, and a STAFF member with revenue read are served every output as stored
    const servedTo: Viewer[] = [
      { role: 'ADMIN', permissionScopes: null },
      { role: 'ADMIN', permissionScopes: { expenses: 'read', analytics: 'read', revenue: 'read' } },
      { role: 'STAFF', permissionScopes: { expenses: 'read', analytics: 'read', revenue: 'read' } },
    ];
    for (const membership of servedTo) {
      const who = JSON.stringify(membership);
      const { planSteps, logs: served } = await read(membership);
      expect(planSteps.map((s) => s.outputResult), who).toEqual([REPORT, REPORT, REPORT, EXPENSE]);
      if (membership.role === 'ADMIN') {
        expect(served.map((l) => l.outputSummary), who).toEqual(steps.map((s) => ({ data: s.outputResult, rolledBack: false })));
      }
    }
  });

  // SEC-W9MRK-3 (W10-CORTEX-CHAT-SCOPE, owner ruling D-57): a parsed chat command runs through the
  // executor POST cortex/execute runs a direct command through, so it is held to the same rule
  // (cortexCommandRefusal) for the member the chat runs for. A refused command reaches neither
  // executeBatch nor an approval request, and is put on record through the executor's audit door with
  // its refusal. The stream's detected actions (autopilot commands) are held to it too.
  it.each(MONEY_REPORT_COMMANDS)(
    'SEC-W9MRK-3 (W10-CORTEX-CHAT-SCOPE, D-57, was it.todo): a command parsed on POST cortex/chat or the chat stream with enableActions is refused to a member the cortexCommandRefusal rule refuses, the money reports included: %s.%s',
    async (module, action, moduleScope) => {
      // the chat door: a STAFF member with the module's write scope and revenue none
      const refused = chatPipeline({
        membership: { role: 'STAFF', permissionScopes: { [moduleScope]: 'write', revenue: 'none' } },
        intents: [{ module, action }],
      });
      await refused.chat();
      expect(refused.executor.executeBatch, `${module}.${action}`).not.toHaveBeenCalled();
      expect(refused.executor.executeWithApproval).not.toHaveBeenCalled();
      expect(refused.refusals()).toEqual([
        expect.objectContaining({
          command: expect.objectContaining({ module, action, businessId: CHAT_BIZ, userId: CHAT_USER }),
          result: expect.objectContaining({
            success: false,
            error: 'Insufficient permissions: revenue requires read access (you have none)',
          }),
        }),
      ]);

      // control: the same member with revenue:read has the report run
      const allowed = chatPipeline({
        membership: { role: 'STAFF', permissionScopes: { [moduleScope]: 'write', revenue: 'read' } },
        intents: [{ module, action }],
      });
      await allowed.chat();
      expect(allowed.executed()).toEqual([expect.objectContaining({ module, action, userId: CHAT_USER })]);
      expect(allowed.refusals()).toEqual([]);

      // the chat stream: its detected actions run as autopilot commands, held to the same rule
      const streamRefused = chatPipeline({
        membership: { role: 'STAFF', permissionScopes: { automations: 'read', [moduleScope]: 'admin', revenue: 'admin' } },
        detected: [{ actionType: 'CREATE_TASK' }],
      });
      const chunks = await streamRefused.stream();
      expect(streamRefused.executor.executeBatch).not.toHaveBeenCalled();
      expect(streamRefused.refusals()).toEqual([
        expect.objectContaining({
          command: expect.objectContaining({ module: 'autopilot', action: 'create_task', userId: CHAT_USER }),
          result: expect.objectContaining({ success: false, error: 'Insufficient permissions: automations requires write access (you have read)' }),
        }),
      ]);
      expect(chunks.filter((c) => c.type === 'action_delta').slice(1).map((c) => c.action)).toEqual([
        expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked' }),
      ]);
      // control: automations write runs it
      const streamAllowed = chatPipeline({
        membership: { role: 'STAFF', permissionScopes: { automations: 'write' } },
        detected: [{ actionType: 'CREATE_TASK' }],
      });
      await streamAllowed.stream();
      expect(streamAllowed.executed()).toEqual([expect.objectContaining({ module: 'autopilot', action: 'create_task' })]);
    },
  );
});
