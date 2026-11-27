/**
 * RR-TOOL-EFFECT-CLASS (D-261, D-262; slice 1 of 2, slice 2 is
 * RR-TOOL-EFFECT-METADATA): every FLOW_TOOLS entry declares whether a call
 * reads or writes, and a tool is READ only when that is provable.
 *
 * Premise at main 9a7b5011: the FlowTool contract carried family, riskLevel,
 * riskTier, changedEntities, parameters, outputSchema and
 * manualEquivalentRoute, and nothing that said whether a call reads or
 * writes. Retry, parallel execution and safe mode therefore guessed from the
 * family, which is not a read signal: lookups such as crm_search_contacts are
 * family 'crud', and 115 read-family tools (114 at the plan's snapshot) carried no changedEntities whether
 * or not their handler sent anything.
 *
 * Now FlowTool has a required `effectClass: 'READ' | 'WRITE'`, and
 * `isReadOnlyTool(name)` is true only for a registered tool whose effectClass
 * is 'READ'; an unknown name, an MCP bridged name (mcp__*) or a dotted cortex
 * name answers false. The rules this census enforces, each with a negative
 * control over a fixture tool:
 *   R1 every entry declares effectClass, 'READ' or 'WRITE';
 *   R2 a 'READ' entry has family 'read' and no changedEntities;
 *   R3 a read-family tool known to send or call a provider is 'WRITE'
 *      (KNOWN_SENDERS below, from the handler census recorded in the packet).
 * No tool's name, family, riskTier or route changes (R0 KEEP:
 * job-role-tool-families.spec.ts stays green unchanged).
 *
 * Handler census at 9a7b5011 (every read-family tool's `case` in
 * flow-orchestrator.service.ts followed into the service it delegates to):
 * 117 read-family tools, 115 without changedEntities, 103 provably read-only
 * (READ), 12 candidates WRITE: the eight KNOWN_SENDERS above that call a
 * provider or an external API; deals_list_stages, finance_list_bank_accounts
 * and finance_list_coa, which seed rows on first read (createMany / upsert);
 * present_onboarding_card, whose genome integrity computation updates
 * genome facts; inbox_list_threads and inbox_read_thread, whose organ handler
 * is a pure read but whose bridged dispatch writes a cortex action log, a
 * business event and the autonomy daily count (unsure means WRITE). The
 * aiExecutionLog row executeTool writes for every tool is common
 * infrastructure, not a per-tool write.
 *
 * The exports are read through a namespace import so this file loads on main
 * and names what is missing instead of failing to link.
 */
import { describe, it, expect } from 'vitest';
import * as registry from './flow-tool-registry';
import type { FlowTool } from './flow-tool-registry';

const { FLOW_TOOLS, getToolByName, REVIEWED_NON_READ_FAMILY_READ_TOOLS } = registry;
const isReadOnlyTool: (name: string) => boolean =
  (registry as unknown as { isReadOnlyTool?: (name: string) => boolean }).isReadOnlyTool ?? (() => {
    throw new Error('isReadOnlyTool is not exported from flow-tool-registry');
  });

const VALID_EFFECT_CLASSES = new Set(['READ', 'INTERNAL_WRITE', 'EXTERNAL_EFFECT', 'MONEY', 'DESTRUCTIVE']);
const REVIEWED_READ_NAMES = new Set(REVIEWED_NON_READ_FAMILY_READ_TOOLS.map((entry) => entry.tool));

type Classified = Omit<FlowTool, 'effectClass'> & { effectClass?: unknown };

/**
 * Read-family tools whose handler sends something or calls a provider, so
 * they may never be 'READ' (R3). Filled from the handler census the packet
 * records; a tool listed here with effectClass 'READ' is a census failure.
 */
export const KNOWN_SENDERS: readonly string[] = [
  'reports_generate', // ReportsService.generateReport calls the AI provider (reports.service.ts)
  'inbox_brief', // KeyInboxService.generateBrief: AI completion, writes an insight row and a temporal event
  'payments_list_transactions', // Stripe API and the FX rate fetch (stripe.connector.ts, currency-rates.service.ts)
  'payments_search_transactions', // Stripe API and the FX rate fetch
  'payments_list_links', // Stripe GET /payment_links
  'social_get_analytics', // fetches Facebook, LinkedIn, Twitter and TikTok APIs
  'contract_extract_terms', // AI extraction (document-intelligence.service.ts); also declares changedEntities
  'contract_extract_clauses', // AI extraction (contract-clause.service.ts); also declares changedEntities
];

/** R1 to R3 over a list of tools, as `name: problem` strings; empty means the census passes. */
export function effectClassProblems(
  tools: readonly Classified[],
  knownSenders: readonly string[] = KNOWN_SENDERS,
  reviewedNonReadFamilyReads: ReadonlySet<string> = REVIEWED_READ_NAMES,
): string[] {
  const problems: string[] = [];
  for (const tool of tools) {
    if (typeof tool.effectClass !== 'string' || !VALID_EFFECT_CLASSES.has(tool.effectClass)) {
      problems.push(`${tool.name}: effectClass must be one of READ | INTERNAL_WRITE | EXTERNAL_EFFECT | MONEY | DESTRUCTIVE (got ${JSON.stringify(tool.effectClass)})`);
      continue;
    }
    if (tool.effectClass === 'READ') {
      if (tool.family !== 'read' && !reviewedNonReadFamilyReads.has(tool.name)) {
        problems.push(`${tool.name}: READ but family is '${tool.family}'`);
      }
      if (tool.changedEntities && tool.changedEntities.length > 0) {
        problems.push(`${tool.name}: READ but declares changedEntities ${JSON.stringify(tool.changedEntities)}`);
      }
      if (knownSenders.includes(tool.name)) problems.push(`${tool.name}: READ but its handler sends or calls a provider`);
    }
  }
  return problems;
}

const fixture = (over: Partial<Classified>): Classified => ({
  name: 'fixture_tool',
  description: 'fixture',
  family: 'read',
  riskLevel: 'low',
  riskTier: 1,
  parameters: { type: 'object', properties: {}, required: [] },
  outputSchema: { type: 'object', description: 'fixture', fields: {} },
  manualEquivalentRoute: '/app/keyflow-command',
  effectClass: 'READ',
  idempotency: 'NATURAL',
  reversibility: 'REVERSIBLE',
  contractVersion: 1,
  ...over,
});

describe('RR-TOOL-EFFECT-CLASS: every FLOW_TOOLS entry declares an effect class', () => {
  it('DoD RED: every entry declares effectClass and the census rules hold', () => {
    const problems = effectClassProblems(FLOW_TOOLS as Classified[]);
    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
  });

  it('DoD RED: isReadOnlyTool is exported and true only for a registered READ tool', () => {
    expect(isReadOnlyTool('fetch_business_summary')).toBe(true);
    expect(isReadOnlyTool('crm_create_contact')).toBe(false);
    expect(isReadOnlyTool('no_such_tool')).toBe(false);
    expect(isReadOnlyTool('mcp__s__x')).toBe(false);
    expect(isReadOnlyTool('cortex.create_task')).toBe(false);
  });

  it('isReadOnlyTool agrees with the registry for every tool, and every non-read family is non-READ unless explicitly reviewed', () => {
    for (const tool of FLOW_TOOLS as Classified[]) {
      expect(isReadOnlyTool(tool.name), tool.name).toBe(tool.effectClass === 'READ');
      if (tool.family !== 'read' && !REVIEWED_READ_NAMES.has(tool.name)) {
        expect(tool.effectClass, tool.name).not.toBe('READ');
      }
    }
  });

  it('negative controls: the rule function rejects a READ tool with changedEntities, a READ crud tool, a missing or foreign value, and a known sender marked READ', () => {
    expect(effectClassProblems([fixture({ changedEntities: ['invoice'] })])).toEqual([
      "fixture_tool: READ but declares changedEntities [\"invoice\"]",
    ]);
    expect(effectClassProblems([fixture({ family: 'crud' })])).toEqual(["fixture_tool: READ but family is 'crud'"]);
    expect(effectClassProblems([fixture({ effectClass: undefined })])).toHaveLength(1);
    expect(effectClassProblems([fixture({ effectClass: 'read' })])).toHaveLength(1);
    expect(effectClassProblems([fixture({ effectClass: 'WRITE' })])).toHaveLength(1);
    expect(effectClassProblems([fixture({ name: 'sender_tool' })], ['sender_tool'])).toEqual([
      'sender_tool: READ but its handler sends or calls a provider',
    ]);
    // and accepts the valid shapes
    expect(effectClassProblems([fixture({}), fixture({ name: 'w', family: 'crud', effectClass: 'INTERNAL_WRITE', changedEntities: ['contact'] })])).toEqual([]);
  });

  it('R0 KEEP: no tool changed name, family, riskTier or route; getToolByName still resolves every tool; the count is unchanged', () => {
    // +3 canonical finance intelligence READ tools (TOF-FINANCE-CANONICAL-TOOLS, P44)
    expect(FLOW_TOOLS).toHaveLength(289);
    for (const tool of FLOW_TOOLS) {
      expect(getToolByName(tool.name)).toBe(tool);
      expect(['read', 'draft', 'organize', 'execute', 'crud']).toContain(tool.family);
      expect(typeof tool.manualEquivalentRoute).toBe('string');
    }
    const readFamily = FLOW_TOOLS.filter((t) => t.family === 'read');
    expect(readFamily).toHaveLength(120);
    expect(readFamily.filter((t) => !t.changedEntities || t.changedEntities.length === 0)).toHaveLength(118);
  });
});
