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
import { BRIEFING_OBJECTIVE_PREFIX, BRIEFING_RAW_INPUT, BRIEFING_SCOPE } from '../ai/morning-briefing.service';
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
 * member is user_1, who owns biz_1 and holds its OWNER membership (the owner rule since owner rulings
 * D-116 and D-125, W11-D116-KEY-OWNER: an OWNER membership, never Business.ownerId alone).
 */
class PrismaStub {
  client = {
    aiPlan: { findFirst: vi.fn(async () => ({ userId: 'user_1' })) },
    business: { findFirst: vi.fn(async () => ({ id: 'biz_1' })) },
    membership: { findUnique: vi.fn(async () => ({ id: 'm_1', role: 'OWNER', permissionScopes: null })) },
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

/**
 * W8-CALL-TASK-NO-MEMBER (D-73; review CR-W8CTNM-1): noMemberToolRefusal refuses call_create_task, a
 * change on this surface too. An AI_PLAN proposal of a plan with no member, or with no stored plan, ran
 * before for the member who executed it (onBehalfOfUserId), and the call task recorded them as its
 * caller (W7-CALL-TASK-CALLER). It is now refused before dispatch: a plan step's proposal runs as the
 * plan's member, the approver neither widens nor narrows that run (W4-PROPOSAL-PRINCIPAL), and a plan
 * with no member has none to record (D-73). A plan's member, the daily briefing's owner (D-93) and the
 * executor of any other proposal still run it.
 */
describe('W8-CALL-TASK-NO-MEMBER review CR-W8CTNM-1 (D-73): call_create_task on the proposal surface', () => {
  const CALL_ARGS = { contactId: 'c_1', callerId: 'user_9', notes: 'call Ada' };
  const callProposal = (fields: Record<string, unknown>) =>
    ({ ...fields, payload: { toolName: 'call_create_task', inputPayload: CALL_ARGS } }) as never;
  const REFUSED = /^Refused: "call_create_task" names a contact and records the member it runs for as the caller, and a KEY plan or monitor with no member principal has no member to record \(D-73\)$/;

  it('CTNM-P1 W8-CALL-TASK-NO-MEMBER (D-73): a stored plan with no member (not the daily briefing): its call_create_task step proposal, executed by a member, is refused before dispatch; the executor is not taken as its caller', async () => {
    const { plugin, orchestrator, prisma } = makePlugin();
    prisma.client.aiPlan.findFirst.mockResolvedValue({ userId: null, objective: 'journey x', rawInput: 'r', scope: [] } as never);
    const out = await plugin.execute('biz_1', callProposal({ userId: null, sourceType: 'AI_PLAN', planId: 'plan_1', planStepId: 'step_1' }), 'user_2');
    expect(out.success).toBe(false);
    expect(out.error).toMatch(REFUSED);
    expect(orchestrator.executeToolDirectly).not.toHaveBeenCalled();
  });

  it('CTNM-P2 W8-CALL-TASK-NO-MEMBER (D-73): an AI_PLAN proposal with no stored plan (a plan step with no member), executed by a member: refused before dispatch, no plan read', async () => {
    const { plugin, orchestrator, prisma } = makePlugin();
    const out = await plugin.execute('biz_1', callProposal({ userId: 'user_2', sourceType: 'AI_PLAN' }), 'user_2');
    expect(out.success).toBe(false);
    expect(out.error).toMatch(REFUSED);
    expect(orchestrator.executeToolDirectly).not.toHaveBeenCalled();
    expect(prisma.client.aiPlan.findFirst).not.toHaveBeenCalled();
  });

  it("CTNM-P3 W8-CALL-TASK-NO-MEMBER regression control (D-73, D-93): a member's plan step runs call_create_task as the plan's member (its principal), the daily briefing's as the business owner, and any other proposal for the member who executes it", async () => {
    const member = makePlugin();
    const ran = await member.plugin.execute('biz_1', callProposal({ userId: 'user_1', sourceType: 'AI_PLAN', planId: 'plan_1', planStepId: 'step_1' }), 'user_2');
    expect(ran.success).toBe(true);
    expect(member.orchestrator.executeToolDirectly.mock.calls[0]?.[4]).toMatchObject({ surface: 'PROPOSAL', principalUserId: 'user_1' });

    const briefing = makePlugin();
    briefing.prisma.client.aiPlan.findFirst.mockResolvedValue({
      userId: null, objective: `${BRIEFING_OBJECTIVE_PREFIX}today`, rawInput: BRIEFING_RAW_INPUT, scope: [BRIEFING_SCOPE],
    } as never);
    Object.assign(briefing.prisma.client.business, { findUnique: vi.fn(async () => ({ ownerId: 'owner_1' })) });
    const brief = await briefing.plugin.execute('biz_1', callProposal({ userId: null, sourceType: 'AI_PLAN', planId: 'plan_b', planStepId: 'step_b' }), 'user_2');
    expect(brief.success).toBe(true);
    expect(briefing.orchestrator.executeToolDirectly.mock.calls[0]?.[4]).toMatchObject({ surface: 'PROPOSAL', principalUserId: 'owner_1' });

    const manual = makePlugin();
    const filed = await manual.plugin.execute('biz_1', callProposal({ userId: 'user_3', sourceType: 'MANUAL' }), 'user_2');
    expect(filed.success).toBe(true);
    const action = manual.orchestrator.executeToolDirectly.mock.calls[0]?.[4] as Record<string, unknown> | undefined;
    expect(action).toMatchObject({ surface: 'PROPOSAL', onBehalfOfUserId: 'user_2' });
    expect(action).not.toHaveProperty('principalUserId');
  });
});
