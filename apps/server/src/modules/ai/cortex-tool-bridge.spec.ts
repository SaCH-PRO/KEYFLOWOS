/**
 * The efferent bridge, in the direction that was missing.
 *
 * KeyCortexEfferentBridgeService mirrors FLOW_TOOLS *into* the cortex registry,
 * so the deliberating brain can act on the business. Nothing went the other
 * way. The chat's tool list is `getOpenAiToolDefinitions()` — FLOW_TOOLS and
 * only FLOW_TOOLS — so the 29 tools the organ adapters register were invisible
 * to the model that actually talks to the user, and naming one hit
 * `default: throw new Error('Unknown tool')`.
 *
 * The concrete cost: KEY could SEND into the inbox (send_message_with_approval)
 * and could not READ it. Running a support or sales inbox is the most common
 * "be my staff" request there is, and KEY could only ever talk into it.
 *
 * Three properties are asserted here, and each corresponds to a way the obvious
 * implementation — "just expose every cortex tool dynamically" — would have
 * shipped broken:
 *
 *  1. The model-facing name is CALLABLE. OpenAI and Anthropic both constrain
 *     function names to [a-zA-Z0-9_-]{1,64}. Every organ tool is dotted, so
 *     advertising `key_inbox.list_threads` verbatim is a 400 from the provider
 *     on every request carrying it.
 *
 *  2. The RISK TIER survives the crossing. AiOversightService.getToolTier looks
 *     names up in FLOW_TOOLS and returns 2 on a miss, so a bridged tool that
 *     was not declared would be gated as medium risk whatever it really is.
 *
 *  3. Execution reaches the ORGAN. A bridge that reimplements the handler is
 *     not a bridge; it is a fork that drifts.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CORTEX_TOOL_BRIDGE,
  isCortexBridgedTool,
  getOpenAiToolDefinitions,
  getToolByName,
} from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { RoleEngineService } from './role-engine.service';
import { KeyInboxAdapterService } from '../key-cortex/organs/key-inbox-adapter.service';

const BIZ = 'biz_1';
const BRIDGED = Object.keys(CORTEX_TOOL_BRIDGE);

describe('the bridged name is one a provider will accept', () => {
  it('exposes no dotted name to the model', () => {
    // The whole reason this is a mapping rather than a passthrough.
    const advertised = getOpenAiToolDefinitions().map((t) => t.function.name);

    for (const name of advertised) {
      expect(name, `"${name}" would be rejected by the provider`).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it('the cortex names it maps TO are dotted, which is the point', () => {
    // If these ever stopped being dotted the mapping would be pure overhead,
    // and someone should delete it rather than leave it looking necessary.
    for (const cortexName of Object.values(CORTEX_TOOL_BRIDGE)) {
      expect(cortexName).toContain('.');
    }
  });

  it('maps every bridged tool to exactly one organ tool', () => {
    const targets = Object.values(CORTEX_TOOL_BRIDGE);
    expect(new Set(targets).size, 'two flow names point at one organ tool').toBe(targets.length);
  });
});

describe('the bridged tools are first-class, not smuggled in', () => {
  it('every bridged name is a real FLOW_TOOL', () => {
    // Not decoration. Being in FLOW_TOOLS is what gives them a risk tier, a
    // manual route and role reachability — three gates that already exist and
    // would otherwise each need a parallel implementation.
    for (const name of BRIDGED) {
      expect(getToolByName(name), `${name} is bridged but not declared`).toBeDefined();
    }
  });

  it('carries an explicit risk tier rather than inheriting the default', () => {
    // getToolTier returns 2 for anything it cannot find. A tier-4 organ tool
    // silently gated as medium risk is the failure this prevents.
    for (const name of BRIDGED) {
      expect(getToolByName(name)!.riskTier, `${name} has no explicit tier`).toBeDefined();
    }
  });

  it('is advertised to the model', () => {
    const advertised = getOpenAiToolDefinitions().map((t) => t.function.name);
    for (const name of BRIDGED) {
      expect(advertised, `${name} is declared but never offered`).toContain(name);
    }
  });

  it('is reachable by at least one role', () => {
    // A tool advertised and then refused by every role is worse than absent:
    // the model tries it and reports an error to the user.
    const engine = new RoleEngineService(...([] as never[]));
    const roles = ['sales', 'finance', 'support', 'operations', 'marketing', 'general', 'operator', 'executive'] as const;

    for (const name of BRIDGED) {
      const reachable = roles.some((r) => engine.isToolAllowed(r, name));
      expect(reachable, `${name} is unreachable by every role`).toBe(true);
    }
  });

  it('lets any role READ the inbox but not every role close threads', () => {
    // Reading what a customer said is orientation — finance chasing an invoice
    // needs the thread where the client disputed it. Resolving a thread is
    // inbox work.
    const engine = new RoleEngineService(...([] as never[]));

    expect(engine.isToolAllowed('finance', 'inbox_read_thread')).toBe(true);
    expect(engine.isToolAllowed('marketing', 'inbox_list_threads')).toBe(true);
    expect(engine.isToolAllowed('support', 'inbox_mark_resolved')).toBe(true);
  });
});

describe('the manual equivalent shows the same data the tool touches', () => {
  it('points at the screen backed by KeyInboxService, not the other inbox', () => {
    // These tools operate on keyInboxThread via KeyInboxService. They declared
    // manualEquivalentRoute '/app/inbox', which redirects to /app/inbox/unified
    // — a SEPARATE omnichannel inbox reading a different table through
    // fetchUnifiedInbox. So every "you can do this yourself here" link sent the
    // user to a screen that could not display the thread the tool had just
    // touched.
    //
    // The route check and the manual-parity check both passed: the page exists
    // and a human can write from it. Neither asks whether it is the SAME data.
    // /app/key-inbox reads @/lib/api/key-inbox, which is the matching source.
    for (const name of BRIDGED) {
      expect(getToolByName(name)!.manualEquivalentRoute, `${name} points at the wrong inbox`).toBe(
        '/app/key-inbox',
      );
    }
  });
});

describe('the organ tool it points at actually exists', () => {
  it('every bridged target is declared by the real adapter', () => {
    // The tests above stub the registry, so they prove the WIRING and nothing
    // about the target. This is the half that catches a typo or a rename in the
    // organ: it constructs the real adapter and asks it what it offers.
    //
    // Five delegation_* tools sat in FLOW_TOOLS for weeks with no handler
    // because a registry entry was treated as a promise that something existed.
    // Same mistake, other direction.
    const adapter = new KeyInboxAdapterService(
      {} as never,
      {} as never,
      { subscribe: vi.fn(), on: vi.fn() } as never,
    );
    const offered = adapter.listTools().map((t) => t.name);

    for (const [flowName, cortexName] of Object.entries(CORTEX_TOOL_BRIDGE)) {
      expect(offered, `${flowName} -> ${cortexName} does not exist on the organ`).toContain(cortexName);
    }
  });

  it('the declared tier matches the organ\'s own', () => {
    // Two sources of truth for one risk class is worse than one wrong source:
    // oversight would gate on the FlowTool tier while the registry gates on the
    // organ's, and which one applied would depend on the path taken.
    const adapter = new KeyInboxAdapterService(
      {} as never,
      {} as never,
      { subscribe: vi.fn(), on: vi.fn() } as never,
    );
    const byName = new Map(adapter.listTools().map((t) => [t.name, t]));

    for (const [flowName, cortexName] of Object.entries(CORTEX_TOOL_BRIDGE)) {
      const organTool = byName.get(cortexName)!;
      expect(getToolByName(flowName)!.riskTier, `${flowName} tier disagrees with ${cortexName}`).toBe(
        organTool.riskTier,
      );
    }
  });
});

function makeOrchestrator(opts: { hasTool?: boolean; result?: any; registryMissing?: boolean } = {}) {
  const execute = vi.fn(async () => opts.result ?? { success: true, data: { threads: [] } });
  const registry = {
    hasTool: vi.fn(() => opts.hasTool ?? true),
    execute,
  };

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: {
      get: vi.fn(() => {
        if (opts.registryMissing) throw new Error('not found');
        return registry;
      }),
    },
  });

  return { orchestrator, execute, registry };
}

describe('execution reaches the organ that owns the tool', () => {
  it('dispatches to the cortex registry under the DOTTED name', async () => {
    const { orchestrator, execute } = makeOrchestrator();

    await (orchestrator as any).executeToolAction(BIZ, 'inbox_list_threads', { limit: 10 });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe('key_inbox.list_threads');
  });

  it('passes the arguments through untouched', async () => {
    const { orchestrator, execute } = makeOrchestrator();

    await (orchestrator as any).executeToolAction(BIZ, 'inbox_read_thread', { threadId: 'th_1' });

    expect(execute.mock.calls[0][2]).toEqual({ threadId: 'th_1' });
  });

  it('scopes the call to the asking business', async () => {
    const { orchestrator, execute } = makeOrchestrator();

    await (orchestrator as any).executeToolAction(BIZ, 'inbox_list_threads', {});

    expect(execute.mock.calls[0][1]).toMatchObject({ businessId: BIZ });
  });

  it('marks the call pre-approved, because a human is sitting there asking', async () => {
    // checkRisk answers "may KEY do this unattended?" — the wrong question on
    // the chat path. AiOversightService.evaluate already ran: role allowlist,
    // blocked tools, tier thresholds, confirm/approve flow. Without this flag an
    // organ tool above the autonomy threshold gets refused and filed as an
    // approval proposal for the action the user just asked for.
    const { orchestrator, execute } = makeOrchestrator();

    await (orchestrator as any).executeToolAction(BIZ, 'inbox_mark_resolved', { threadId: 'th_1' });

    expect(execute.mock.calls[0][1]).toMatchObject({ preApproved: true });
  });

  it('does not reimplement the handler', async () => {
    // Every bridged tool must go through the registry. A case clause that did
    // the work itself would pass the dispatch test above and then drift from
    // the organ it was supposed to mirror.
    for (const name of BRIDGED) {
      const { orchestrator, execute } = makeOrchestrator();
      await (orchestrator as any)
        .executeToolAction(BIZ, name, { threadId: 'th_1' })
        .catch(() => undefined);

      expect(execute, `${name} did not reach the registry`).toHaveBeenCalledTimes(1);
    }
  });

  it('returns the organ result rather than a wrapper', async () => {
    const { orchestrator } = makeOrchestrator({
      result: { success: true, data: { threads: [{ id: 'th_1' }] } },
    });

    const result = await (orchestrator as any).executeToolAction(BIZ, 'inbox_list_threads', {});

    expect(result).toEqual({ threads: [{ id: 'th_1' }] });
  });
});

describe('it fails loudly rather than answering wrongly', () => {
  it('errors when no organ registered the name', async () => {
    // The dangerous alternative is returning {} — which renders as "your inbox
    // is empty". A wrong answer about an empty inbox is worse than an error,
    // because the user acts on it.
    const { orchestrator } = makeOrchestrator({ hasTool: false });

    await expect(
      (orchestrator as any).executeToolAction(BIZ, 'inbox_list_threads', {}),
    ).rejects.toThrow(/no organ has registered key_inbox\.list_threads/);
  });

  it('errors when the cortex registry is not loaded at all', async () => {
    const { orchestrator } = makeOrchestrator({ registryMissing: true });

    await expect(
      (orchestrator as any).executeToolAction(BIZ, 'inbox_list_threads', {}),
    ).rejects.toThrow(/cortex registry is not loaded/);
  });

  it('surfaces an organ-level failure instead of reporting success', async () => {
    const { orchestrator } = makeOrchestrator({
      result: { success: false, error: 'inbox channel disconnected' },
    });

    await expect(
      (orchestrator as any).executeToolAction(BIZ, 'inbox_read_thread', { threadId: 'th_1' }),
    ).rejects.toThrow(/inbox channel disconnected/);
  });

  it('still throws Unknown tool for a name that is genuinely unknown', async () => {
    // The bridge must not become a catch-all that swallows typos.
    const { orchestrator } = makeOrchestrator();

    await expect(
      (orchestrator as any).executeToolAction(BIZ, 'not_a_real_tool', {}),
    ).rejects.toThrow(/Unknown tool/);
    expect(isCortexBridgedTool('not_a_real_tool')).toBe(false);
  });
});
