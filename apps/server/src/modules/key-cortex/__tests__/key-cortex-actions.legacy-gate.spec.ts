/**
 * V1-02b-KEY-LEGACY-GATE: the legacy Cortex action gate
 * (KeyCortexActionsService.executeActions) applies the same usability check as
 * the parsed-command gate (KeyCortexQueryPipelineService, V1-02).
 *
 * The legacy gate is reached when a turn has no parsed command, or when the v2
 * integration is disabled (processQuery and streamQuery both call
 * actionsService.executeActions with the actions detected in the completion).
 * It puts each action to the autonomy authority as `key_cortex.<TYPE>`.
 *
 * RED-BEFORE (V1-02 deviation): the gate read `verdict.allowed` with no
 * usability check, so a malformed verdict (`{ allowed: true }` with the
 * approval semantics left out, a truthy non-boolean `allowed`, an unknown
 * tier) let the action run; actions evaluated before a failing evaluation in
 * the same batch had already run; and a refused action left no audit row.
 *
 * GREEN-AFTER: a throwing evaluation or an unusable verdict blocks the batch
 * (fail closed, atomic like the parsed-command gate), no tool runs, no
 * approval is created, and every refused action goes through the legacy
 * gate's audit door (trackActionExecution -> cortexActionLog).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as actionsModule from '../key-cortex-actions.service';
import { KeyCortexActionsService } from '../key-cortex-actions.service';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';

const allow = {
  allowed: true,
  requiresApproval: false,
  tier: 'full' as const,
  reason: 'Allowed',
  confidence: 1,
  ruleTrace: [],
  createdAt: new Date(),
};

const supervised = {
  ...allow,
  requiresApproval: true,
  tier: 'supervised' as const,
  reason: 'Supervised',
};

const deny = {
  ...allow,
  allowed: false,
  tier: 'manual' as const,
  reason: 'Constitution values conflict',
};

const session = { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any;

const createTask = {
  actionType: 'CREATE_TASK' as const,
  status: 'pending_approval' as const,
  description: 'Create follow-up task',
  result: { title: 'Call Ana' },
};

const createEvent = {
  actionType: 'CREATE_EVENT' as const,
  status: 'pending_approval' as const,
  description: 'Book a call',
  result: { title: 'Call', startTime: '2026-11-03T10:00:00Z' },
};

const createDocument = {
  actionType: 'CREATE_DOCUMENT' as const,
  status: 'pending_approval' as const,
  description: 'Write notes',
  result: { title: 'Notes', content: 'x' },
};

function setup() {
  const cortexActionLogCreate = vi.fn().mockResolvedValue({});
  const prisma = { client: { cortexActionLog: { create: cortexActionLogCreate } } };
  const toolExecute = vi.fn().mockResolvedValue({ success: true, data: { id: 'row_1' } });
  const keyCortexToolRegistry = {
    registerMany: vi.fn(),
    execute: toolExecute,
    listTools: vi.fn().mockReturnValue([]),
    buildGatewayDefinitions: vi.fn().mockReturnValue([]),
  };
  const proposalService = { create: vi.fn().mockResolvedValue({ id: 'apr_1' }), list: vi.fn() };
  const autonomyOrchestrator = { evaluateAction: vi.fn() };
  const autonomyLevelService = {
    resolve: vi.fn().mockResolvedValue({ level: 4, mode: 'pro_auto', maxAutoRiskTier: 4, label: 't' }),
  };
  const eventBus = { emit: vi.fn() };

  const service = new KeyCortexActionsService(
    prisma as any,
    undefined,
    { enqueue: vi.fn() } as any,
    keyCortexToolRegistry as any,
    proposalService as any,
    autonomyOrchestrator as any,
    autonomyLevelService as any,
    eventBus as any,
    undefined,
  );
  const logger = (service as any).logger;
  const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  for (const level of ['warn', 'log', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation(() => undefined);
  }

  return {
    service,
    autonomyOrchestrator,
    toolExecute,
    proposalService,
    cortexActionLogCreate,
    loggerError,
    auditRows: () => cortexActionLogCreate.mock.calls.map(([arg]: any[]) => arg.data),
  };
}

const failedClosed = expect.stringContaining('Authority check failed closed');

describe('V1-02b legacy Cortex action gate — fail closed', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['rejects with an Error', (o: any) => o.evaluateAction.mockRejectedValue(new Error('oracle down'))],
    ['rejects with a non-Error value', (o: any) => o.evaluateAction.mockRejectedValue('oracle down')],
    [
      'throws synchronously',
      (o: any) =>
        o.evaluateAction.mockImplementation(() => {
          throw new Error('oracle down');
        }),
    ],
  ])(
    'V1-02b-LG01 an evaluation that %s blocks the action, runs no tool, creates no approval and is audited',
    async (_label, arrange) => {
      const t = setup();
      arrange(t.autonomyOrchestrator);

      const results = await t.service.executeActions([createTask], session);

      expect(t.toolExecute).not.toHaveBeenCalled();
      expect(t.proposalService.create).not.toHaveBeenCalled();
      expect(results).toEqual([
        expect.objectContaining({
          actionType: 'CREATE_TASK',
          status: 'blocked',
          requiresApproval: false,
          error: failedClosed,
        }),
      ]);
      expect(results[0].error).toContain('oracle down');
      expect(t.auditRows()).toEqual([
        expect.objectContaining({
          sessionId: 'sess_1',
          actionType: 'CREATE_TASK',
          status: 'blocked',
          error: failedClosed,
          requiresApproval: false,
        }),
      ]);
    },
  );

  // The same verdict shapes the parsed-command gate rejects since V1-02
  // (AUTH-FC-P01B, AUTH-FC-F1): an `allowed` with the approval semantics left
  // out is not a statement that no approval is needed.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'allowed'],
    ['an object without allowed', { reason: 'no verdict' }],
    ['a truthy non-boolean allowed', { allowed: 'true' }],
    ['allowed with no approval or tier metadata', { allowed: true }],
    ['allowed with no requiresApproval', { allowed: true, tier: 'full' }],
    ['allowed with no tier', { allowed: true, requiresApproval: false }],
    ['an unrecognized tier', { ...allow, tier: 'autonomous' }],
    ['a non-boolean requiresApproval', { ...allow, requiresApproval: null }],
    ['a numeric allowed', { ...allow, allowed: 1 }],
  ])(
    'V1-02b-LG02 an unusable verdict (%s) blocks the action, runs no tool, creates no approval and is audited',
    async (_label, verdict) => {
      const t = setup();
      t.autonomyOrchestrator.evaluateAction.mockResolvedValue(verdict as any);

      const results = await t.service.executeActions([createTask], session);

      expect(t.toolExecute).not.toHaveBeenCalled();
      expect(t.proposalService.create).not.toHaveBeenCalled();
      expect(results).toEqual([
        expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked', error: failedClosed }),
      ]);
      expect(results[0].error).toContain('Unusable autonomy verdict for key_cortex.CREATE_TASK');
      expect(t.auditRows()).toEqual([
        expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked', error: failedClosed }),
      ]);
    },
  );

  it('V1-02b-LG03 an evaluation that throws on action 2 of 3 lets zero actions run, and each is blocked and audited', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockRejectedValueOnce(new Error('oracle down'))
      .mockResolvedValue(allow);

    const results = await t.service.executeActions([createTask, createEvent, createDocument], session);

    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(t.proposalService.create).not.toHaveBeenCalled();
    expect(results.map((r) => [r.actionType, r.status])).toEqual([
      ['CREATE_TASK', 'blocked'],
      ['CREATE_EVENT', 'blocked'],
      ['CREATE_DOCUMENT', 'blocked'],
    ]);
    for (const r of results) expect(r.error).toEqual(failedClosed);
    expect(t.auditRows().map((row: any) => [row.actionType, row.status])).toEqual([
      ['CREATE_TASK', 'blocked'],
      ['CREATE_EVENT', 'blocked'],
      ['CREATE_DOCUMENT', 'blocked'],
    ]);
  });

  it('V1-02b-LG04 an unusable verdict after a well-formed allow lets zero actions run', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce({ allowed: true } as any);

    const results = await t.service.executeActions([createTask, createEvent], session);

    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(results.map((r) => r.status)).toEqual(['blocked', 'blocked']);
    expect(results[1].error).toContain('Unusable autonomy verdict for key_cortex.CREATE_EVENT');
  });

  it('V1-02b-LG05 a failed-closed batch creates no approval even for a high-impact action', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(supervised)
      .mockResolvedValueOnce({ allowed: 'yes' } as any);

    const results = await t.service.executeActions(
      [
        { actionType: 'CREATE_INVOICE', status: 'pending_approval', description: 'invoice', result: { customerId: 'c', items: [] } },
        createTask,
      ],
      session,
    );

    expect(t.proposalService.create).not.toHaveBeenCalled();
    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(results.map((r) => r.status)).toEqual(['blocked', 'blocked']);
    expect(results.every((r) => !r.approvalRequestId)).toBe(true);
  });

  it('V1-02b-LG06 the failed-closed refusal is logged as an error naming the action key', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue({ allowed: true } as any);

    await t.service.executeActions([createTask], session);

    const messages = t.loggerError.mock.calls.map(([m]) => String(m)).join('\n');
    expect(messages).toContain('key_cortex.CREATE_TASK');
    expect(messages).toMatch(/fail(ed|ing) closed/i);
  });

  it('V1-02b-LG07 an audit write that fails does not change the answer', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));
    t.cortexActionLogCreate.mockRejectedValue(new Error('db down'));

    const results = await t.service.executeActions([createTask], session);

    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(results.map((r) => r.status)).toEqual(['blocked']);
  });

  it('V1-02b-LG08 a well-formed denial is blocked and audited, and only the allowed action of the batch runs', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValueOnce(deny).mockResolvedValueOnce(allow);

    const results = await t.service.executeActions([createTask, createEvent], session);

    expect(results.map((r) => [r.actionType, r.status])).toEqual([
      ['CREATE_TASK', 'blocked'],
      ['CREATE_EVENT', 'success'],
    ]);
    expect(results[0].error).toBe('Constitution values conflict');
    expect(t.toolExecute).toHaveBeenCalledTimes(1);
    expect(t.toolExecute).toHaveBeenCalledWith('cortex.create_event', expect.anything(), expect.anything());
    expect(t.auditRows().map((row: any) => [row.actionType, row.status])).toEqual([
      ['CREATE_TASK', 'blocked'],
      ['CREATE_EVENT', 'success'],
    ]);
  });
});

describe('V1-02b legacy Cortex action gate — regression controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('V1-02b-RC01 a well-formed full verdict still executes through the canonical registry', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(allow);

    const results = await t.service.executeActions([createTask], session);

    expect(results.map((r) => r.status)).toEqual(['success']);
    expect(t.toolExecute).toHaveBeenCalledWith(
      'cortex.create_task',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', sessionId: 'sess_1' }),
      { title: 'Call Ana' },
    );
  });

  it.each([
    ['a supervised verdict', supervised],
    ['a manual tier that is allowed', { ...allow, tier: 'manual' as const }],
  ])('V1-02b-RC02 %s creates a proposal and runs no tool', async (_label, verdict) => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(verdict);

    const results = await t.service.executeActions([createTask], session);

    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(t.proposalService.create).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      expect.objectContaining({ status: 'pending_approval', approvalRequestId: 'apr_1', requiresApproval: true }),
    ]);
  });

  it('V1-02b-RC03 the legacy gate puts each action to the authority as key_cortex.<TYPE> with the session actor', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(allow);

    await t.service.executeActions([createTask], session);

    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledWith(
      'biz_1',
      'key_cortex.CREATE_TASK',
      { title: 'Call Ana' },
      { proposedBy: 'user_1' },
    );
  });
});

describe('V1-02b the legacy gate applies the parsed-command gate usability check', () => {
  const pipelineCheck = (verdict: unknown): boolean =>
    (KeyCortexQueryPipelineService.prototype as any).isUsableAutonomyVerdict.call(undefined, verdict);

  it.each([
    ['a full allow', allow, true],
    ['a supervised allow', supervised, true],
    ['a manual denial', deny, true],
    ['undefined', undefined, false],
    ['null', null, false],
    ['a string', 'allowed', false],
    ['a number', 1, false],
    ['an object without allowed', { reason: 'x' }, false],
    ['a truthy non-boolean allowed', { allowed: 'true', requiresApproval: false, tier: 'full' }, false],
    ['allowed only', { allowed: true }, false],
    ['no requiresApproval', { allowed: true, tier: 'full' }, false],
    ['no tier', { allowed: true, requiresApproval: false }, false],
    ['an unrecognized tier', { ...allow, tier: 'autonomous' }, false],
    ['a null requiresApproval', { ...allow, requiresApproval: null }, false],
  ])('V1-02b-UV01 %s: the legacy predicate agrees with the pipeline', (_label, verdict, usable) => {
    const legacyCheck = (actionsModule as Record<string, unknown>).isUsableAutonomyVerdict as
      | ((v: unknown) => boolean)
      | undefined;
    expect(typeof legacyCheck).toBe('function');
    expect(pipelineCheck(verdict)).toBe(usable);
    expect(legacyCheck!(verdict)).toBe(usable);
  });
});
