/**
 * Approving a KEY-proposed action used to fail 100% of the time.
 *
 * Two independent faults on one line:
 *
 *   const result = await this.toolRegistry.execute(toolName, ctx, payload.parameters ?? {});
 *
 *  1. WRONG REGISTRY. `toolRegistry` is the cortex registry, whose ~60 tools
 *     use dotted namespaces (`cortex.create_task`, `key_inbox.send_reply`).
 *     Every proposal produced by PlanExecutorService or ProAutoMonitorService
 *     carries a FLOW tool name (`commerce_create_invoice`) from the 118-tool
 *     FLOW_TOOLS set. Measured overlap between the two vocabularies: ZERO.
 *     So every approval died with "not found in canonical registry".
 *
 *  2. WRONG PAYLOAD KEY. The producer writes `payload.inputPayload`
 *     (plan-executor.service.ts createStepProposal); this read
 *     `payload.parameters`. Even on a name match the tool would have run with
 *     `{}` and failed required-field validation.
 *
 * Both faults are silent — the proposal simply comes back unsuccessful, which
 * looks like the tool refusing rather than the wiring being wrong.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexActionExecutorPlugin } from './key-cortex-action-executor.plugin';

class RegistryStub {
  register = vi.fn();
}

class CortexToolRegistryStub {
  execute = vi.fn(() => Promise.resolve({ success: true, data: { via: 'cortex' } }));
}

class OrchestratorStub {
  executeToolDirectly = vi.fn(() => Promise.resolve({ via: 'flow' }));
}

/**
 * W4-PROPOSAL-PRINCIPAL: the rows the plugin's run authority reads (plan-step-authority): plan_1's
 * member is user_1, who owns biz_1 and holds its OWNER membership.
 */
class PrismaStub {
  client = {
    aiPlan: { findFirst: vi.fn(async () => ({ userId: 'user_1' })) },
    business: { findFirst: vi.fn(async () => ({ id: 'biz_1' })) },
    membership: { findUnique: vi.fn(async () => ({ id: 'm_1' })) },
    user: { findUnique: vi.fn(async () => ({ role: 'USER' })) },
  };
}

class ModuleRefStub {
  constructor(
    private readonly orchestrator: OrchestratorStub,
    private readonly prisma: PrismaStub,
  ) {}
  get = vi.fn((token: unknown) => (token === PrismaService ? this.prisma : this.orchestrator));
}

function makePlugin() {
  const cortex = new CortexToolRegistryStub();
  const orchestrator = new OrchestratorStub();
  const prisma = new PrismaStub();
  const plugin = new KeyCortexActionExecutorPlugin(
    new RegistryStub() as never,
    cortex as never,
    new ModuleRefStub(orchestrator, prisma) as never,
  );
  return { plugin, cortex, orchestrator, prisma };
}

/**
 * A plan step's proposal as PlanExecutorService.createStepProposal files it: the stored plan columns
 * (W4-PROPOSAL-PRINCIPAL review SEC-W4PP-1: only they make a proposal a plan step's) and the payload.
 */
const PLAN_PROPOSAL = {
  userId: 'user_1',
  sourceType: 'AI_PLAN',
  planId: 'plan_1',
  planStepId: 'step_1',
  payload: {
    toolName: 'commerce_create_invoice',
    inputPayload: { contactId: 'c_1', amount: 500 },
    planContext: { planId: 'plan_1', planStepId: 'step_1' },
  },
} as never;

describe('flow-named tools reach the flow executor', () => {
  let ctx: ReturnType<typeof makePlugin>;

  beforeEach(() => {
    ctx = makePlugin();
  });

  it('does NOT send a flow tool to the cortex registry', async () => {
    // The two vocabularies share zero names, so this was a guaranteed failure.
    await ctx.plugin.execute('biz_1', PLAN_PROPOSAL);
    expect(ctx.cortex.execute).not.toHaveBeenCalled();
  });

  it('dispatches through the flow orchestrator', async () => {
    const out = await ctx.plugin.execute('biz_1', PLAN_PROPOSAL);

    expect(ctx.orchestrator.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
  });

  it('passes the arguments the producer actually wrote', async () => {
    // inputPayload, not parameters. This is the difference between the tool
    // running and the tool receiving {}.
    await ctx.plugin.execute('biz_1', PLAN_PROPOSAL);

    const [businessId, toolName, args] = ctx.orchestrator.executeToolDirectly.mock
      .calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(businessId).toBe('biz_1');
    expect(toolName).toBe('commerce_create_invoice');
    expect(args).toEqual({ contactId: 'c_1', amount: 500 });
  });

  it('forwards planContext so the step stays attached to its plan', async () => {
    // FeedbackLoopService only engages when planId AND planStepId are present.
    await ctx.plugin.execute('biz_1', PLAN_PROPOSAL);

    const planContext = ctx.orchestrator.executeToolDirectly.mock.calls[0][3];
    expect(planContext).toEqual({ planId: 'plan_1', planStepId: 'step_1' });
  });

  it('still accepts the legacy `parameters` key', async () => {
    const legacy = {
      payload: { toolName: 'crm_create_contact', parameters: { name: 'Ada' } },
    } as never;

    await ctx.plugin.execute('biz_1', legacy);
    expect(ctx.orchestrator.executeToolDirectly.mock.calls[0][2]).toEqual({ name: 'Ada' });
  });

  it('reports a tool failure as unsuccessful rather than throwing', async () => {
    // executeToolDirectly throws on failure; a throw here would surface as an
    // unhandled error in the approval UI instead of a failed execution.
    ctx.orchestrator.executeToolDirectly.mockRejectedValue(new Error('contact not found'));

    const out = await ctx.plugin.execute('biz_1', PLAN_PROPOSAL);
    expect(out.success).toBe(false);
    expect(out.error).toContain('contact not found');
  });
});

describe('dotted tools still use the cortex registry', () => {
  it('routes cortex-namespaced names to the canonical registry', async () => {
    const { plugin, cortex, orchestrator } = makePlugin();
    const proposal = {
      payload: { toolName: 'key_inbox.send_reply', inputPayload: { threadId: 't_1' } },
    } as never;

    const out = await plugin.execute('biz_1', proposal);

    expect(cortex.execute).toHaveBeenCalledTimes(1);
    expect(orchestrator.executeToolDirectly).not.toHaveBeenCalled();
    expect(out.success).toBe(true);
  });

  it('gives the cortex registry the same corrected arguments', async () => {
    const { plugin, cortex } = makePlugin();
    const proposal = {
      payload: { toolName: 'cortex.create_task', inputPayload: { title: 'call Ada' } },
    } as never;

    await plugin.execute('biz_1', proposal);
    expect(cortex.execute.mock.calls[0][2]).toEqual({ title: 'call Ada' });
  });
});

describe('guards', () => {
  it('rejects a proposal with no tool name', async () => {
    const { plugin } = makePlugin();
    const out = await plugin.execute('biz_1', { payload: {} } as never);

    expect(out.success).toBe(false);
    expect(out.error).toContain('missing payload.toolName');
  });
});

describe('W4-PROPOSAL-PRINCIPAL review SEC-W4PP-1: only the stored plan makes a proposal a plan step', () => {
  it("refuses a payload.planContext naming a plan the proposal was not filed for (no stored planId), whatever its sourceType; nothing dispatched, no plan read", async () => {
    for (const sourceType of ['AI_PLAN', 'MANUAL']) {
      const { plugin, orchestrator, prisma } = makePlugin();
      const forged = {
        userId: 'user_2',
        sourceType,
        payload: { toolName: 'crm_list_contacts', inputPayload: {}, planContext: { planId: 'plan_1', planStepId: 'step_1' } },
      } as never;
      const out = await plugin.execute('biz_1', forged, 'user_2');
      expect(out.success, sourceType).toBe(false);
      expect(out.error, sourceType).toMatch(/^Refused: .*names a plan it was not filed for/);
      expect(orchestrator.executeToolDirectly).not.toHaveBeenCalled();
      expect(prisma.client.aiPlan.findFirst).not.toHaveBeenCalled();
    }
  });

  it('forwards the plan as stored, never another key of the payload planContext (an actorUserId the execution log would be attributed to)', async () => {
    const { plugin, orchestrator } = makePlugin();
    const proposal = {
      ...(PLAN_PROPOSAL as object),
      payload: { toolName: 'commerce_create_invoice', inputPayload: {}, planContext: { planId: 'plan_1', planStepId: 'step_1', actorUserId: 'u_forged', role: 'OWNER' } },
    } as never;
    await plugin.execute('biz_1', proposal);
    expect(orchestrator.executeToolDirectly.mock.calls[0][3]).toEqual({ planId: 'plan_1', planStepId: 'step_1' });
  });
});
