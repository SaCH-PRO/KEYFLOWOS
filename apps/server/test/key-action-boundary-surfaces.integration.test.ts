/**
 * KF-EXEC-ACTION-001 — every surface that can run helpdesk_create_ticket goes
 * through the one boundary (P7), and a confirmation is the server's, not the
 * client's (P3). REAL database, REAL boundary, REAL orchestrator executor.
 *
 * The surfaces are driven through the classes that own them (the phone voice
 * service, the conversational service, the dispatcher, the executor plugin,
 * the efferent bridge, the graph controller, the flow controller), wired to the
 * real `FlowOrchestratorService` tool path. What is stubbed is what a surface
 * needs in order to be constructed and never consults on this path.
 *
 * Every test runs with the most permissive autonomy a business can configure
 * (level 4, with the tool on the approved list) unless it says otherwise. That
 * is deliberate: under it, the legacy oversight decision is "auto-execute", so
 * a surface that still reached the executor around the boundary would create a
 * ticket and fail its test.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBoundaryFixture, settle } from './helpers/key-action-boundary.fixture';

type BoundaryFixture = Awaited<ReturnType<typeof buildBoundaryFixture>>;

const TOOL = 'helpdesk_create_ticket';
let fx: BoundaryFixture;
let ID: BoundaryFixture['ID'];
let orchestrator: any;
let FlowOrchestratorService: any;
let executionLog: { logToolExecution: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

beforeAll(async () => {
  fx = await buildBoundaryFixture('kas_');
  ID = fx.ID;
  await fx.seed();

  ({ FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service'));
  executionLog = { logToolExecution: vi.fn(async () => undefined), log: vi.fn(async () => undefined) };

  // The real class, with the real tool path (executeTool, executeToolAction and
  // the public entries over them). Only what chat() needs before it reaches a
  // confirmation is stubbed, and none of that is consulted by the tool path.
  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma: fx.prisma,
    moduleRef: fx.moduleRef,
    governance: fx.oversight,
    executionLog,
    businessGraph: {
      invalidateCache: vi.fn(),
      getSnapshot: async () => ({ business: { name: 'Boundary A' } }),
      buildContextString: () => '',
    },
    aiUsage: { checkRateLimit() {}, checkCredits: async () => ({ allowed: true }) },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    selectToolsForRequest: async () => [],
    // A turn with no explicit role resolves its crew from the message; the
    // confirm route sends none, so this is what it gets.
    resolveTurnAuthority: async () => ({ primary: 'general', crew: [], scores: {} }),
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
  });
  fx.provide(FlowOrchestratorService, orchestrator);

  // Loaded once, here: the first import of a surface class pulls in most of
  // the server and would otherwise be charged to whichever test ran first.
  await import('../src/modules/phone-voice/phone-voice.service');
  await import('../src/modules/ai/conversational-ai.service');
  await import('../src/modules/ai/action-dispatcher.service');
  await import('../src/modules/key-cortex/key-cortex-action-executor.plugin');
  await import('../src/modules/key-cortex/key-cortex-efferent-bridge.service');
  await import('../src/modules/ai/graph-actions.controller');
  await import('../src/modules/ai/flow.controller');
}, 300_000);

afterAll(async () => {
  if (fx) await fx.cleanup();
});

beforeEach(async () => {
  await fx.reset();
  fx.provide(FlowOrchestratorService, orchestrator);
  await fx.setAutonomy(4, { approvedTools: [TOOL] });
  executionLog.logToolExecution.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fx.assertNoUnknownState();
});

const ARGS = { title: 'Take a message', description: 'Caller wants a call back' };
const noTickets = async () => expect(await fx.tickets()).toHaveLength(0);

// ---------------------------------------------------------------------------
describe('P7 — no surface reaches the ticket write around the boundary', () => {
  describe('the orchestrator’s executor entries, called the way each surface used to call them', () => {
    it('executeToolByName with no context (the old E4 and E11 call shape)', async () => {
      const r = await settle(orchestrator.executeToolByName(ID.bizA, TOOL, { ...ARGS }));
      expect(r.err).toBeInstanceOf(fx.errors.ActionNotClearedError);
      expect(r.err.code).toBe('UNTRUSTED_TENANT_BINDING');
      await noTickets();
      expect(await fx.actions()).toHaveLength(0);
    });

    it('executeToolDirectly with no context (the old E5, E7, E8 and E9 call shape)', async () => {
      const r = await settle(orchestrator.executeToolDirectly(ID.bizA, TOOL, { ...ARGS }));
      expect(r.err).toBeInstanceOf(fx.errors.ActionNotClearedError);
      expect(r.err.retryable).toBe(false);
      // Refused as a caller nobody can place, not queued for approval: a
      // surface that forgot its context must not write into a tenant.
      expect(r.err.code).toBe('UNTRUSTED_TENANT_BINDING');
      await noTickets();
      expect(await fx.actions()).toHaveLength(0);
    });

    it('executeToolDirect with no context (the old E10 call shape)', async () => {
      const result = await orchestrator.executeToolDirect(ID.bizA, TOOL, { ...ARGS });
      expect(result.success).toBe(false);
      expect(result.notCleared).toMatchObject({ disposition: 'DENIED', code: 'UNTRUSTED_TENANT_BINDING' });
      await noTickets();
    });

    it('autoExecuteToolForMonitoring, which overrides the oversight mode', async () => {
      const result = await orchestrator.autoExecuteToolForMonitoring(ID.bizA, TOOL, { ...ARGS });
      expect(result.success).toBe(false);
      await noTickets();
      // It declared itself, so it left a proposal for a human instead.
      const rows = await fx.actions(ID.bizA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ execution_surface: 'PRO_AUTO_MONITOR', status: 'PENDING', requested_by: null });
    });

    it('execute_custom_logic’s inner executor', async () => {
      // The orchestrator hands the sandbox a closure; this is that closure.
      let inner: any;
      vi.spyOn(orchestrator, 'getCodeExecutor' as any).mockReturnValue({
        execute: async (opts: any) => {
          inner = opts.innerToolExecutor;
          return settle(inner(ID.bizA, TOOL, { ...ARGS }));
        },
      });
      const outcome = await orchestrator.executeToolByName(ID.bizA, 'execute_custom_logic', { code: '/* calls the tool */', inputs: {} }, { surface: 'CUSTOM_LOGIC' });
      expect(outcome.err).toBeInstanceOf(fx.errors.ActionNotClearedError);
      expect(outcome.err.disposition).toBe('AWAITING_APPROVAL');
      await noTickets();
      expect((await fx.actions(ID.bizA))[0]).toMatchObject({ execution_surface: 'CUSTOM_LOGIC', requested_by: null });
    });
  });

  describe('the classes that own each surface', () => {
    it('E4 — PhoneVoiceService tells the model nothing was done, and nothing was', async () => {
      const { PhoneVoiceService } = await import('../src/modules/phone-voice/phone-voice.service');
      const phone: any = new PhoneVoiceService({} as any, {} as any, orchestrator, fx.prisma as any);
      phone.logger = quiet;

      const reply = await phone.executeVoiceTool(ID.bizA, TOOL, { ...ARGS }, { callSid: 'CA1', transcript: [] });
      expect(reply).toEqual({ error: expect.stringMatching(/Nothing was done/) });
      await noTickets();
      // Not even a proposal: the tenant on this surface is a query-string value.
      expect(await fx.actions()).toHaveLength(0);
    });

    it('E5 — ConversationalAIService: a confident model does not stand in for a person', async () => {
      const { ConversationalAIService } = await import('../src/modules/ai/conversational-ai.service');
      const stubs = Array.from({ length: 14 }, () => ({}) as any);
      stubs[0] = fx.prisma;
      stubs[3] = orchestrator;
      stubs[4] = fx.oversight;
      const convo: any = new (ConversationalAIService as any)(...stubs);
      convo.logger = quiet;

      const r = await settle(
        convo.executeAction(ID.bizA, { action: 'create_ticket', toolName: TOOL, payload: { ...ARGS }, confidence: 0.99, description: '', requiresConfirmation: false }),
      );
      expect(r.err).toBeInstanceOf(fx.errors.ActionNotClearedError);
      expect(r.err.disposition).toBe('AWAITING_APPROVAL');
      await noTickets();
      expect((await fx.actions(ID.bizA))[0]).toMatchObject({ execution_surface: 'INBOUND_CONVERSATION', requested_by: null, status: 'PENDING' });
    });

    it('E7 — ActionDispatcherService: one proposal, no retries, no ticket', async () => {
      const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const dispatcher: any = new ActionDispatcherService(
        fx.prisma as any,
        new EventEmitter2() as any,
        executionLog as any,
        fx.oversight,
        orchestrator,
        { registerAction: async () => undefined } as any,
      );
      dispatcher.logger = quiet;
      const direct = vi.spyOn(orchestrator, 'executeToolDirectly');

      const result = await dispatcher.dispatch({ businessId: ID.bizA, toolName: TOOL, args: { ...ARGS }, planId: 'plan_1', planStepId: 'step_1', source: 'plan_worker', retryCount: 2 });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/sent for approval/);
      // The boundary's answer is final for these inputs; the retry loop stops.
      expect(direct).toHaveBeenCalledTimes(1);
      await noTickets();
      const rows = await fx.actions(ID.bizA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ execution_surface: 'PLAN_QUEUE', plan_step_id: 'step_1', requested_by: null });
      // The worker is told the step is waiting, not that the tool failed.
      expect(result.awaitingApproval).toEqual({ actionId: rows[0].id });
    }, 30_000);

    it('E7 — proposals filed by the dispatcher never open the tool’s circuit breaker', async () => {
      const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const dispatcher: any = new ActionDispatcherService(
        fx.prisma as any,
        new EventEmitter2() as any,
        executionLog as any,
        fx.oversight,
        orchestrator,
        { registerAction: async () => undefined } as any,
      );
      dispatcher.logger = quiet;
      const direct = vi.spyOn(orchestrator, 'executeToolDirectly');

      // The breaker opens at five failures. Eight different plan steps.
      const results = [];
      for (let i = 0; i < 8; i++) {
        results.push(await dispatcher.dispatch({ businessId: ID.bizA, toolName: TOOL, args: { ...ARGS }, planId: 'plan_1', planStepId: `step_${i}`, source: 'plan_worker' }));
      }

      expect(results.map((r) => r.error).filter((e) => /Circuit breaker open/.test(e))).toEqual([]);
      expect(results.every((r) => r.awaitingApproval)).toBe(true);
      expect(direct).toHaveBeenCalledTimes(8);
      expect(await fx.actions(ID.bizA)).toHaveLength(8);
      await noTickets();
    }, 30_000);

    it('E7 — the approved step, run again by the dispatcher, executes once', async () => {
      const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const dispatcher: any = new ActionDispatcherService(
        fx.prisma as any,
        new EventEmitter2() as any,
        executionLog as any,
        fx.oversight,
        orchestrator,
        { registerAction: async () => undefined } as any,
      );
      dispatcher.logger = quiet;
      const step = { businessId: ID.bizA, toolName: TOOL, args: { ...ARGS }, planId: 'plan_1', planStepId: 'step_1', source: 'plan_worker' };

      const waiting = await dispatcher.dispatch(step);
      await fx.proposals.approve(ID.bizA, waiting.awaitingApproval.actionId, ID.admin);
      const done = await dispatcher.dispatch(step);
      const again = await dispatcher.dispatch(step);

      expect(done.success).toBe(true);
      expect(again.success).toBe(true);
      expect(again.result.id).toBe(done.result.id);
      expect(await fx.tickets(ID.bizA)).toHaveLength(1);
      expect(await fx.actions(ID.bizA)).toHaveLength(1);
    }, 30_000);

    it('E8 — the executor plugin admits a proposal by its id against its sealed envelope, or not at all', async () => {
      const { KeyCortexActionExecutorPlugin } = await import('../src/modules/key-cortex/key-cortex-action-executor.plugin');
      const plugin = new KeyCortexActionExecutorPlugin({ register() {} } as any, {} as any, fx.moduleRef as any);
      const wrapper = { sourceType: 'AI_PLAN' as const, title: 'Step', actionType: 'EXECUTE_TOOL' as const, payload: { toolName: TOOL, inputPayload: { ...ARGS } } };

      // Not approved: refused.
      const pending = await fx.proposals.create(ID.bizA, wrapper);
      const unapproved = await plugin.execute(ID.bizA, pending, ID.admin);
      expect(unapproved.success).toBe(false);
      await noTickets();

      // Approved, but the payload handed to the plugin is not the sealed one.
      await fx.proposals.approve(ID.bizA, pending.id, ID.admin);
      const swapped = await plugin.execute(ID.bizA, { ...pending, payload: { toolName: TOOL, inputPayload: { title: 'Swapped in after approval' } } }, ID.admin);
      expect(swapped.success).toBe(false);
      expect(swapped.error).toMatch(/not the ones recorded/);
      await noTickets();

      // Approved and unchanged: one ticket, the sealed one.
      const ok = await plugin.execute(ID.bizA, pending, ID.admin);
      expect(ok.success).toBe(true);
      const tickets = await fx.tickets(ID.bizA);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toBe(ARGS.title);
    });

    it('E8 — KeyActionProposalService.execute never reaches the plugin for this capability', async () => {
      const wrapper = { sourceType: 'AI_PLAN' as const, title: 'Step', actionType: 'EXECUTE_TOOL' as const, payload: { toolName: TOOL, inputPayload: { ...ARGS } } };
      const proposal = await fx.proposals.create(ID.bizA, wrapper);
      // "Proposal must be approved before execution": the status gate is kept.
      await expect(fx.proposals.execute(ID.bizA, proposal.id, ID.admin, true, true)).rejects.toThrow(/must be approved/);
      await noTickets();

      // A status alone, written the way the old approve() wrote it, clears nothing.
      await fx.db.keyActionProposal.update({ where: { id: proposal.id }, data: { status: 'APPROVED', approvedBy: ID.admin } });
      await expect(fx.proposals.execute(ID.bizA, proposal.id, ID.admin, true, true)).rejects.toThrow(/approve/i);
      await noTickets();
    });

    it('E9 — KeyCortexEfferentBridgeService: a context user id is not a principal', async () => {
      const { KeyCortexEfferentBridgeService } = await import('../src/modules/key-cortex/key-cortex-efferent-bridge.service');
      const bridge: any = new KeyCortexEfferentBridgeService({} as any, fx.moduleRef as any);
      bridge.logger = quiet;

      // The owner's id, in a field any caller of the registry can set.
      const result = await bridge.dispatch(TOOL, { businessId: ID.bizA, userId: ID.owner, autonomyLevel: 5, preApproved: true }, { ...ARGS });
      expect(result.success).toBe(false);
      await noTickets();
      const [row] = await fx.actions(ID.bizA);
      expect(row).toMatchObject({ execution_surface: 'CORTEX_BRIDGE', requested_by: null, status: 'PENDING' });
      // Told to the registry as "not executed, sent for approval", which it
      // does not score as the tool failing.
      expect(result).toMatchObject({ notExecuted: true, requiresApproval: true, data: { proposalId: row.id } });
    });

    it('E10 — GraphActionsController: an authenticated caller is asked to confirm; quick-confirm is no longer ignored', async () => {
      await fx.setAutonomy(null); // default policy: tier 2 needs a confirmation
      const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const controller: any = new (GraphActionsController as any)({}, {}, {}, fx.oversight, orchestrator, {}, {}, fx.prisma, new EventEmitter2());

      const response = await controller.executeAction(ID.bizA, { toolName: TOOL, args: { ...ARGS } }, { user: { id: ID.staff } });
      expect(response).toMatchObject({ success: false, requiresConfirmation: true, requiresApproval: false });
      expect(response.confirmationId).toEqual(expect.any(String));
      await noTickets();

      const row = await fx.action(response.confirmationId);
      expect(row).toMatchObject({ execution_surface: 'GRAPH_ACTION', requested_by: ID.staff, proposed_by: ID.staff, status: 'PENDING' });

      // The same caller confirms by id and it runs.
      await fx.boundary.confirmAndExecute(ID.bizA, response.confirmationId, ID.staff);
      expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    });

    it('E10 — with autonomy that clears tier 2, a trusted caller’s action runs, and is attributed', async () => {
      const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const controller: any = new (GraphActionsController as any)({}, {}, {}, fx.oversight, orchestrator, {}, {}, fx.prisma, new EventEmitter2());

      const response = await controller.executeAction(ID.bizA, { toolName: TOOL, args: { ...ARGS } }, { user: { id: ID.staff } });
      expect(response.success).toBe(true);
      const [row] = await fx.actions(ID.bizA);
      expect(row.outcome_evidence.principalChain).toMatchObject({ requestedBy: ID.staff, executedFor: ID.staff, executedBy: ID.staff, approvedBy: null });
      expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    });

    it('E6 — executePlan: plan approval is not a confirmation of the action', async () => {
      await fx.setAutonomy(null);
      const updates: Array<[string, string]> = [];
      orchestrator.planner = {
        updatePlanStatus: async () => undefined,
        updateStepStatus: async (id: string, status: string) => void updates.push([id, status]),
      };
      // The plan read is the orchestrator's own; the boundary keeps the real client.
      const plan = {
        id: 'plan_1',
        status: 'approved',
        objective: 'o',
        maxRiskTier: 2,
        role: null,
        steps: [{ id: 'step_1', action: 'Open a ticket', description: null, toolName: TOOL, inputPayload: { ...ARGS }, dependsOn: [], role: null }],
      };
      orchestrator.prisma = { client: { aiPlan: { findFirst: async () => plan } } };

      let result: any;
      try {
        result = await orchestrator.executePlan(ID.bizA, 'plan_1', ID.staff);
      } finally {
        orchestrator.prisma = fx.prisma;
      }

      expect(result.results).toEqual([expect.objectContaining({ stepId: 'step_1', status: 'awaiting_approval' })]);
      expect(updates).toContainEqual(['step_1', 'awaiting_approval']);
      await noTickets();
      const [row] = await fx.actions(ID.bizA);
      expect(row).toMatchObject({ execution_surface: 'PLAN_HTTP', requested_by: ID.staff, plan_step_id: 'step_1', status: 'PENDING' });
      expect(row.control_requirement.shadow).toMatchObject({ legacy: 'EXECUTE', boundary: 'ASK_CONFIRMATION', parity: 'BOUNDARY_STRICTER' });
    });
  });
});

// ---------------------------------------------------------------------------
describe('P3 — a client-resubmitted confirmation cannot execute', () => {
  const chatConfirm = (pending: Record<string, unknown>, userId?: string) =>
    orchestrator.chat(ID.bizA, 'Yes, proceed.', [], { toolCallId: 'call_1', confirmed: true, ...pending }, undefined, undefined, undefined, undefined, userId);

  /** The server issues a confirmation for a staff member's chat request. */
  async function issueConfirmation(args: Record<string, unknown> = { title: 'As asked' }) {
    await fx.setAutonomy(null);
    const governed = await orchestrator.governToolCall(
      ID.bizA,
      { id: 'call_1', name: TOOL, arguments: args, riskLevel: 'medium' },
      await fx.oversight.evaluate(ID.bizA, TOOL),
      { surface: 'CHAT', principalUserId: ID.staff, sourceId: 'call_1' },
    );
    expect(governed.decision).toMatchObject({ allowed: true, requiresQuickConfirm: true });
    expect(governed.confirmationId).toEqual(expect.any(String));
    return governed.confirmationId as string;
  }

  it('a resubmitted tool name and arguments execute nothing and never reach the executor', async () => {
    const executeTool = vi.spyOn(orchestrator, 'executeTool' as any);

    const response = await chatConfirm({ toolName: TOOL, toolArgs: { title: 'Whatever the client says' } }, ID.staff);

    expect(response.reply).toMatch(/was not executed/);
    expect(response.toolResults).toBeUndefined();
    expect(executeTool).not.toHaveBeenCalled();
    await noTickets();
    expect(await fx.actions()).toHaveLength(0);
  });

  it('even an owner’s resubmission executes nothing', async () => {
    const response = await chatConfirm({ toolName: TOOL, toolArgs: { title: 'Owner says so' } }, ID.owner);
    expect(response.reply).toMatch(/was not executed/);
    await noTickets();
  });

  it('the server-issued id executes what the server recorded, whatever the client sends beside it', async () => {
    const confirmationId = await issueConfirmation({ title: 'As asked', priority: 'LOW' });

    const response = await chatConfirm({ confirmationId, toolName: 'commerce_create_invoice', toolArgs: { title: 'Swapped by the client', priority: 'URGENT' } }, ID.staff);

    expect(response.reply).toMatch(/^Done!/);
    expect(response.toolResults).toHaveLength(1);
    expect(response.toolResults[0]).toMatchObject({ name: TOOL, toolCallId: 'call_1', success: true });
    const tickets = await fx.tickets(ID.bizA);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ title: 'As asked', priority: 'LOW' });
  });

  it('replaying the confirmation creates no second ticket', async () => {
    const confirmationId = await issueConfirmation();
    const responses = await Promise.all(Array.from({ length: 8 }, () => chatConfirm({ confirmationId }, ID.staff)));

    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect(await fx.claims(ID.bizA)).toHaveLength(1);
    // Later replays are told about the same ticket.
    const again = await chatConfirm({ confirmationId }, ID.staff);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect([...responses, again].every((r) => typeof r.reply === 'string')).toBe(true);
  }, 60_000);

  it('someone else’s confirmation id does not confirm for them', async () => {
    const confirmationId = await issueConfirmation();
    const response = await chatConfirm({ confirmationId }, ID.staff2);
    expect(response.reply).toMatch(/was not executed/);
    await noTickets();
    expect((await fx.action(confirmationId)).status).toBe('PENDING');
  });

  it('a confirmation with no authenticated user is not one', async () => {
    const confirmationId = await issueConfirmation();
    const response = await chatConfirm({ confirmationId }, undefined);
    expect(response.reply).toMatch(/authenticated user is required/);
    await noTickets();
  });

  it('"No, cancel" ends the action: a later confirmation executes nothing', async () => {
    const confirmationId = await issueConfirmation();
    const cancelled = await orchestrator.chat(ID.bizA, 'No, cancel.', [], { toolCallId: 'call_1', confirmed: false, confirmationId }, undefined, undefined, undefined, undefined, ID.staff);
    expect(cancelled.reply).toMatch(/cancelled/);
    expect((await fx.action(confirmationId)).status).toBe('CANCELLED');

    const late = await chatConfirm({ confirmationId }, ID.staff);
    expect(late.reply).toMatch(/was not executed/);
    await noTickets();
  });

  it('the pending confirmation sent to the client carries the id and is not what gets executed', async () => {
    await fx.setAutonomy(null);
    const tc = { id: 'call_9', name: TOOL, arguments: { title: 'Shown to the user' }, riskLevel: 'medium' };
    const governed = await orchestrator.governToolCall(ID.bizA, tc, await fx.oversight.evaluate(ID.bizA, TOOL), { surface: 'CHAT_STREAM', principalUserId: ID.staff, sourceId: tc.id });
    const row = await fx.action(governed.confirmationId);
    expect(row).toMatchObject({ execution_surface: 'CHAT_STREAM', requested_by: ID.staff, source_id: 'call_9', status: 'PENDING' });
    expect(row.action_envelope.material.title).toBe('Shown to the user');
  });

  describe('the confirm route', () => {
    it('passes the authenticated user and the confirmation id, and executes by id', async () => {
      const { AiFlowController } = await import('../src/modules/ai/flow.controller');
      const controller = new AiFlowController(orchestrator);
      const confirmationId = await issueConfirmation({ title: 'Via the route' });

      const response: any = await controller.confirmAction(ID.bizA, { toolCallId: 'call_1', confirmed: true, confirmationId } as any, { id: ID.staff } as any);

      expect(response.reply).toMatch(/^Done!/);
      const [ticket] = await fx.tickets(ID.bizA);
      expect(ticket.title).toBe('Via the route');
      expect((await fx.action(confirmationId)).outcome_evidence.principalChain.approvedBy).toBe(ID.staff);
    });

    it('with the old body (a tool name and arguments, no id) executes nothing', async () => {
      const { AiFlowController } = await import('../src/modules/ai/flow.controller');
      const controller = new AiFlowController(orchestrator);

      const response: any = await controller.confirmAction(ID.bizA, { toolCallId: 'call_1', toolName: TOOL, toolArgs: { title: 'Old client' }, confirmed: true } as any, { id: ID.owner } as any);

      expect(response.reply).toMatch(/was not executed/);
      await noTickets();
    });
  });
});
