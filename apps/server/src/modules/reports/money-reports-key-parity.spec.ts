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

  // A7-SEC-2 (review, should-fix, outside this packet's write set): the KEY Cortex direct-command
  // door (key-cortex.controller.ts CORTEX_MODULE_RULES: finance -> expenses, analytics -> analytics,
  // at write) still serves finance.generate_pnl (finance-adapter.service.ts -> LedgerReportingService.getPnl)
  // and analytics.create_report / export_report (P&L, balance sheet, tax summary, revenue by customer,
  // CSV included) to a member with revenue:none. Closing it needs a per-action rule in the cortex
  // controller; held for a follow-up packet.
  it.todo(
    'A7-SEC-2 (follow-up packet): cortexCommandRefusal refuses finance.generate_pnl and analytics.create_report / export_report to a member without revenue:read',
  );
});
