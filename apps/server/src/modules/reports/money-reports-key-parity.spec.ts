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
import { describe, it, expect } from 'vitest';
import { MODULE_SCOPE_KEY } from '../../core/auth/module-scope.guard';
import { ReportsController } from './reports.controller';
import { RevenueReportingController } from '../commerce/revenue-reporting.controller';
import { CANONICAL_MODULE_TOOLS, JobRolePolicyService } from '../structure/job-role-policy.service';
import { graphActionModuleScope, graphActionRequirement } from '../ai/graph-actions.controller';
import {
  cortexCommandRefusal,
  cortexCommandRequirement,
  type CortexMemberAuthority,
} from '../key-cortex/key-cortex.controller';
import { defaultScopesForRole } from '../../core/authority/module-vocabulary';

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
  it.todo(
    'SEC-W9MRK-1 / MRK-CR-1 (follow-up packet, outside the W9-MONEY-REPORTS-KEY write set): a KEY plan step finance.generate_pnl, analytics.create_report or analytics.export_report is refused to a member without revenue:read (memberPlanStepScopeRefusal, D-57, D-71)',
  );
  it.todo(
    'SEC-W9MRK-2 (follow-up packet, outside the W9-MONEY-REPORTS-KEY write set): the stored output of a money-report KEY step is withheld from a plan or execution-log viewer without revenue:read (planStepReadRule, visibleExecutionLogs, D-57, D-74)',
  );
  it.todo(
    'SEC-W9MRK-3 (follow-up packet, outside the W9-MONEY-REPORTS-KEY write set): a command parsed on POST cortex/chat or the chat stream with enableActions is refused to a member the cortexCommandRefusal rule refuses, the money reports included (D-57)',
  );
});
