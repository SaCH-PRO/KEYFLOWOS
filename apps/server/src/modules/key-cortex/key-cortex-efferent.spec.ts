/**
 * The efferent path — how a thought becomes an action.
 *
 * KEY had two disjoint motor vocabularies sharing ZERO names: 118 bare-named
 * FLOW_TOOLS reachable only from chat, and ~45 dotted cortex tools reachable
 * only from the cortex. KeyCortexConsciousnessService injects the eight
 * cognition layers and nothing else — it could deliberate at length and had no
 * hands.
 *
 * Two properties are pinned here, and the second matters more than the first:
 *
 *  1. CAPABILITY — flow tools are bridged into the canonical registry, so the
 *     cortex can act on CRM, commerce, bookings and projects.
 *
 *  2. THE GATE STAYS IN THE PATHWAY — the bridge deliberately does NOT call
 *     FlowOrchestratorService.executeToolDirectly from cortex code. That method
 *     runs executeToolAction with no governance; oversight is enforced by the
 *     CALLER on the chat path. Registering instead means every bridged tool
 *     inherits the registry's own gate: idempotency, the autonomy kill switch,
 *     daily caps and tier thresholds. A motor neuron that fires without passing
 *     inhibition is a seizure, not an action.
 *
 * Plus the piece that turns refusal into request: a gated tool below tier 4 now
 * files an approval proposal instead of dead-ending. The tier-3 message always
 * claimed the tool "requires explicit user approval" while offering no way to
 * ask for any.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexEfferentBridgeService } from './key-cortex-efferent-bridge.service';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';

class RegistryStub {
  tools = new Map<string, Record<string, unknown>>();
  hasTool = vi.fn((n: string) => this.tools.has(n));
  register = vi.fn((t: { name: string }) => {
    this.tools.set(t.name, t as Record<string, unknown>);
  });
}

class OrchestratorStub {
  executeToolDirectly = vi.fn(() => Promise.resolve({ id: 'inv_1' }));
}

function makeBridge() {
  const registry = new RegistryStub();
  const orchestrator = new OrchestratorStub();
  const moduleRef = { get: vi.fn(() => orchestrator) };
  const bridge = new KeyCortexEfferentBridgeService(registry as never, moduleRef as never);
  return { bridge, registry, orchestrator };
}

describe('flow tools are bridged into the canonical registry', () => {
  let ctx: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    ctx = makeBridge();
    ctx.bridge.onModuleInit();
  });

  it('registers the full flow surface', () => {
    expect(ctx.registry.register.mock.calls.length).toBeGreaterThan(100);
  });

  it('gives the cortex reach into the business domains it could not touch', () => {
    for (const tool of ['crm_create_contact', 'commerce_create_invoice', 'bookings_create_booking']) {
      expect(ctx.registry.tools.has(tool), `${tool} not bridged`).toBe(true);
    }
  });

  it('keeps names EXACTLY as they are, rather than namespacing to flow.*', () => {
    // The planner, ProAutoMonitor and every stored AiPlanStep carry bare flow
    // names. Renaming here would break the proposal pipeline that was only just
    // repaired, and would recreate the vocabulary split this bridge removes.
    for (const name of ctx.registry.tools.keys()) {
      expect(name).not.toMatch(/^flow\./);
    }
  });

  it('carries each tool’s real risk tier through', () => {
    const contact = ctx.registry.tools.get('crm_create_contact') as { riskTier: number };
    const flowDef = FLOW_TOOLS.find((t) => t.name === 'crm_create_contact');
    expect(contact.riskTier).toBe(flowDef?.riskTier);
  });

  it('never shadows a tool an organ already registered', () => {
    // Organ adapters register first and their implementation is authoritative.
    const { bridge, registry } = makeBridge();
    registry.tools.set('crm_create_contact', { name: 'crm_create_contact', module: 'organ' });

    bridge.onModuleInit();

    expect(registry.tools.get('crm_create_contact')).toEqual({
      name: 'crm_create_contact',
      module: 'organ',
    });
  });
});

describe('the gate stays in the pathway', () => {
  it('does not import a direct-execution shortcut into cortex call sites', () => {
    // The whole point: cortex code must go through the registry, which gates.
    const bridge = readSource();
    const executeDirectCalls = (bridge.match(/executeToolDirectly/g) ?? []).length;

    // Exactly one — inside the registered handler, reached only via the
    // registry's execute(), which has already run safety and risk checks.
    expect(executeDirectCalls).toBe(1);
  });

  it('registers a handler rather than exposing a bypass method', () => {
    const bridge = readSource();
    expect(bridge).toMatch(/handler: \(ctx, input\) =>/);
  });
});

describe('dispatch behaviour', () => {
  it('routes to the flow executor with the business and args', async () => {
    const { bridge, registry, orchestrator } = makeBridge();
    bridge.onModuleInit();

    const tool = registry.tools.get('crm_create_contact') as {
      handler: (c: unknown, i: unknown) => Promise<{ success: boolean; data?: unknown }>;
    };
    const out = await tool.handler({ businessId: 'biz_1' }, { firstName: 'Ada' });

    expect(orchestrator.executeToolDirectly).toHaveBeenCalledWith(
      'biz_1',
      'crm_create_contact',
      { firstName: 'Ada' },
    );
    expect(out.success).toBe(true);
  });

  it('converts a thrown failure into a result object', async () => {
    // executeToolDirectly throws; the registry expects a result. A throw here
    // would escape the registry's outcome recording and idempotency bookkeeping.
    const { bridge, registry, orchestrator } = makeBridge();
    orchestrator.executeToolDirectly.mockRejectedValue(new Error('contact exists'));
    bridge.onModuleInit();

    const tool = registry.tools.get('crm_create_contact') as {
      handler: (c: unknown, i: unknown) => Promise<{ success: boolean; error?: string }>;
    };
    const out = await tool.handler({ businessId: 'biz_1' }, {});

    expect(out.success).toBe(false);
    expect(out.error).toContain('contact exists');
  });
});

describe('a refusal becomes a request', () => {
  function makeRegistry(riskTier: 1 | 2 | 3 | 4) {
    const proposals = {
      create: vi.fn(() => Promise.resolve({ id: 'prop_1' })),
    };
    // Permissive stubs that still honour explicit overrides.
    //
    // execute() awaits several collaborators inside its try block —
    // idempotency.complete, safety.recordExecution — so a stub missing any one
    // of them turns a SUCCESSFUL execution into a failure. This test went red
    // twice against correct code for exactly that reason, which is worth
    // remembering: a narrow stub does not prove a defect.
    const stub = (overrides: Record<string, unknown> = {}) =>
      new Proxy(overrides, {
        get: (target, prop) =>
          prop in target
            ? (target as Record<string | symbol, unknown>)[prop]
            : vi.fn(() => Promise.resolve(undefined)),
      });

    const svc = new KeyCortexToolRegistryService(
      { client: stub() } as never,
      stub({ check: vi.fn(() => Promise.resolve({ allowed: true })) }) as never,
      stub({ check: vi.fn(() => Promise.resolve({ status: 'new' })) }) as never,
      stub() as never,
      undefined as never,
      undefined as never,
      undefined as never,
      proposals as never,
    );
    svc.register({
      name: 'commerce_send_invoice',
      module: 'commerce',
      description: 'Send an invoice',
      parameters: { type: 'object', properties: {}, required: [] },
      riskTier,
      requiresApproval: false,
      handler: vi.fn(() => Promise.resolve({ success: true })),
    });
    return { svc, proposals };
  }

  it('files a proposal when autonomy is too low, instead of dead-ending', async () => {
    const { svc, proposals } = makeRegistry(3);
    const out = await svc.execute('commerce_send_invoice', { businessId: 'biz_1', autonomyLevel: 1 });

    expect(proposals.create).toHaveBeenCalledTimes(1);
    expect(out.requiresApproval).toBe(true);
    expect((out.data as { proposalId: string }).proposalId).toBe('prop_1');
  });

  it('files it with the payload shape the executor plugin reads back', async () => {
    // toolName + inputPayload. The plugin used to read payload.parameters,
    // so an approved action executed with {} — approval that silently did
    // nothing is worse than refusal.
    const { svc, proposals } = makeRegistry(3);
    await svc.execute(
      'commerce_send_invoice',
      { businessId: 'biz_1', autonomyLevel: 1 },
      { invoiceId: 'inv_9' },
    );

    const [, input] = proposals.create.mock.calls[0] as unknown as [
      string,
      { actionType: string; payload: { toolName: string; inputPayload: Record<string, unknown> } },
    ];
    expect(input.actionType).toBe('EXECUTE_TOOL');
    expect(input.payload.toolName).toBe('commerce_send_invoice');
    expect(input.payload.inputPayload).toEqual({ invoiceId: 'inv_9' });
  });

  it('tier 4 stays a hard refusal — critical actions are not delegated to a request', async () => {
    const { svc, proposals } = makeRegistry(4);
    const out = await svc.execute('commerce_send_invoice', { businessId: 'biz_1', autonomyLevel: 5 });

    expect(proposals.create).not.toHaveBeenCalled();
    expect(out.success).toBe(false);
    expect(out.requiresApproval).toBeFalsy();
  });

  it('executes normally when autonomy is sufficient', async () => {
    const { svc, proposals } = makeRegistry(1);
    const out = await svc.execute('commerce_send_invoice', { businessId: 'biz_1', autonomyLevel: 4 });

    expect(proposals.create).not.toHaveBeenCalled();
    expect(out.success).toBe(true);
  });

  it('a proposal that cannot be filed degrades to the original refusal', async () => {
    const { svc, proposals } = makeRegistry(3);
    proposals.create.mockRejectedValue(new Error('db down'));

    const out = await svc.execute('commerce_send_invoice', { businessId: 'biz_1', autonomyLevel: 1 });
    expect(out.success).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, 'key-cortex-efferent-bridge.service.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'))
    .join('\n');
}
