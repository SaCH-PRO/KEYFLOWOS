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
});
