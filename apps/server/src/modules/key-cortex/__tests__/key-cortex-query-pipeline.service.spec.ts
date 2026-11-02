import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';
import { AdaptiveRouterService } from '../adaptive-router.service';
import { KeyCortexMemoryRetrievalService } from '../key-cortex-memory-retrieval.service';

const mockPrisma = {
  client: {
    cortexSession: {
      create: vi.fn(),
      update: vi.fn(),
    },
    cortexMessage: {
      createMany: vi.fn(),
    },
  },
};

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
};

const mockModelGateway = {
  complete: vi.fn(),
  streamComplete: vi.fn(),
};

const mockContextSnapshot = {
  businessId: 'biz-1',
  genomeStage: 'startup',
  executiveReadiness: 50,
};

const mockPersonalityService = {
  getPersonalityConfig: vi.fn().mockReturnValue({
    persona: 'jarvis',
    temperature: 0.7,
  }),
  buildSystemPrompt: vi.fn().mockReturnValue('You are KEY.'),
  buildValueBlock: vi.fn().mockResolvedValue(''),
  classifyPersona: vi.fn().mockResolvedValue(undefined),
  selectTone: vi.fn().mockResolvedValue({ tone: '', temperatureAdjustment: 0 }),
};

const mockContextService = {
  buildContextSnapshot: vi.fn().mockResolvedValue(mockContextSnapshot),
  formatContextForPrompt: vi.fn().mockReturnValue('Context summary'),
};

const mockActionsService = {
  buildToolDefinitions: vi.fn().mockResolvedValue([]),
  executeActions: vi.fn().mockResolvedValue([]),
};

const mockSession = {
  id: 'session_1',
  businessId: 'biz-1',
  userId: 'user-1',
  status: 'active',
  persona: 'jarvis',
  voice: 'echo',
  mood: 'focused',
  preferredProvider: 'openai',
  messages: [],
  detectedRole: null,
  detectedFunction: null,
};

const mockSessionService = {
  getOrCreateSession: vi.fn().mockResolvedValue(mockSession),
  generateId: vi.fn().mockReturnValue('msg_1'),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateSessionCognitionMetadata: vi.fn().mockResolvedValue(undefined),
  updateRunningSummary: vi.fn().mockResolvedValue(undefined),
};

const mockPromptContextService = {
  buildMemoryContext: vi.fn().mockResolvedValue({}),
  buildMessages: vi.fn().mockReturnValue([]),
};

const mockToolLoopService = {
  handleToolCalls: vi.fn().mockResolvedValue(null),
};

const mockActionDetectionService = {
  detectActions: vi.fn().mockReturnValue([]),
};

const mockSuggestionService = {
  generateSuggestions: vi.fn().mockResolvedValue([]),
};

const mockGenomeContext = {
  recommendations: [],
  signals: [],
  dnaScores: {},
  genomeStage: 'startup',
};

const mockGenomeContextService = {
  getGenomeEnrichedContext: vi.fn().mockResolvedValue(mockGenomeContext),
  getRankedRecommendations: vi.fn().mockResolvedValue([]),
  shouldSuggestProactiveAction: vi.fn().mockResolvedValue(false),
  getProactiveSuggestions: vi.fn().mockResolvedValue([]),
};

const mockSystemPromptService = {
  buildV3SystemPrompt: vi.fn().mockReturnValue('V3 prompt'),
  buildV2SystemPrompt: vi.fn().mockReturnValue('V2 prompt'),
  enrichSnapshotFromGenome: vi.fn(),
  enrichSnapshotFromV2: vi.fn(),
};

const mockStructuredOutputService = {
  classifyTaskCategory: vi.fn().mockReturnValue('general'),
  buildStructuredOutputInstructions: vi.fn().mockReturnValue(''),
  parseStructuredResponse: vi.fn().mockReturnValue({
    role: 'assistant',
    recommendation: 'Hello',
    confidence: 80,
  }),
};

const mockMoodDetectionService = {
  detectMood: vi.fn().mockReturnValue('casual'),
};

const mockGenomeBridgeService = {
  checkAutonomy: vi.fn(),
  reportActionOutcome: vi.fn(),
  createEvidence: vi.fn(),
};

function makeMemoryRetrieval(fragments: any[] = []) {
  const unified = {
    retrieveContext: vi.fn().mockResolvedValue(fragments),
    retrieveEpisodicContext: vi.fn().mockResolvedValue([]),
  } as any;
  return new KeyCortexMemoryRetrievalService(unified);
}

/** One ExecutionRecord as KeyCortexExecutorService.execute() returns it. */
function executionRecord(
  command: any,
  outcome: { success?: boolean; data?: unknown; error?: string; id?: string } = {},
) {
  const success = outcome.success ?? true;
  return {
    id: outcome.id ?? `exec-${command.action}`,
    command,
    result: {
      command,
      success,
      data: 'data' in outcome ? outcome.data : success ? {} : undefined,
      error: outcome.error,
      executionTimeMs: 1,
    },
    startedAt: new Date(0),
    finishedAt: new Date(0),
    durationMs: 1,
    traceId: 'trace',
    rolledBack: false,
  };
}

/** An ApprovalRequest as KeyCortexExecutorService.executeWithApproval() returns it. */
function approvalRequest(command: any, id = `proposal-${command.action}`) {
  return { id, command, status: 'pending', requestedAt: new Date(0), correlationId: 'corr' };
}

/** The ai_execution_logs records the pipeline audited through logExecution. */
function auditedRecords(executorService: { logExecution: any }) {
  return executorService.logExecution.mock.calls.map(([record]: any[]) => record);
}

/** A BatchResult as KeyCortexExecutorService.executeBatch() returns it. */
function batchResult(records: any[], totalCommands = records.length) {
  return {
    results: records,
    totalCommands,
    succeededCount: records.filter((r) => r.result.success).length,
    failedCount: records.filter((r) => !r.result.success).length,
    rolledBackCount: 0,
    durationMs: 1,
    traceId: 'trace',
    stoppedEarly: records.length < totalCommands,
    summary: 'fixture',
  };
}

function createPipeline({
  memoryFragments = [],
  router = new AdaptiveRouterService(),
  genomeBridge = mockGenomeBridgeService,
  connectorService,
  commandService,
  executorService,
  eventService,
  autonomyOrchestrator,
}: {
  memoryFragments?: any[];
  router?: AdaptiveRouterService;
  genomeBridge?: any;
  connectorService?: any;
  commandService?: any;
  executorService?: any;
  eventService?: any;
  autonomyOrchestrator?: any;
} = {}) {
  return new KeyCortexQueryPipelineService(
    mockModelGateway as any,
    mockPrisma as any,
    mockRedis as any,
    mockPersonalityService as any,
    mockContextService as any,
    mockActionsService as any,
    mockSessionService as any,
    mockPromptContextService as any,
    mockToolLoopService as any,
    mockActionDetectionService as any,
    mockSuggestionService as any,
    mockGenomeContextService as any,
    mockSystemPromptService as any,
    mockStructuredOutputService as any,
    mockMoodDetectionService as any,
    makeMemoryRetrieval(memoryFragments),
    router,
    connectorService,
    commandService,
    executorService,
    undefined, // contextV2Service
    genomeBridge,
    eventService,
    undefined, // proactive
    undefined, // trustExplanation
    undefined, // learningService
    autonomyOrchestrator,
  );
}

describe('KeyCortexQueryPipelineService — Phase C wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextService.buildContextSnapshot.mockResolvedValue(mockContextSnapshot);
    mockModelGateway.complete.mockResolvedValue({
      content: 'Hello',
      provider: 'openai',
      model: 'gpt-4o',
      usage: { totalTokens: 10, estimatedCost: 0.001 },
      fallbackUsed: false,
    });
    mockSessionService.getOrCreateSession.mockResolvedValue(mockSession);
  });

  it('calls genome context service when includeGenomeContext is true', async () => {
    const pipeline = createPipeline();
    await pipeline.processQuery(
      { text: 'What is our revenue forecast?', businessId: 'biz-1', userId: 'user-1' },
      { integrationV2Enabled: false, genomeV3Enabled: true },
    );

    expect(mockGenomeContextService.getGenomeEnrichedContext).toHaveBeenCalledWith('biz-1');
  });

  it('skips genome context when includeGenomeContext is false', async () => {
    const router = new AdaptiveRouterService();
    vi.spyOn(router, 'route').mockReturnValue({
      taskCategory: 'general',
      layers: ['ethics'],
      promptVariant: 'concise',
      includeGenomeContext: false,
      includeMemoryContext: false,
      includeActions: false,
      complexity: 'simple',
      domain: 'general',
      urgency: 'low',
      emotionalWeight: 'low',
      timeHorizon: 'tactical',
      dataRequirement: 'none',
    } as any);

    const pipeline = createPipeline({ router });
    await pipeline.processQuery(
      { text: 'Hello', businessId: 'biz-1', userId: 'user-1' },
      { integrationV2Enabled: false, genomeV3Enabled: true },
    );

    expect(mockGenomeContextService.getGenomeEnrichedContext).not.toHaveBeenCalled();
  });

  it('calls memory retrieval when includeMemoryContext is true', async () => {
    const memoryFragments = [
      {
        id: 'mf_1',
        sourceType: 'ai_memory',
        title: 'preference',
        content: 'timezone: America/Port_of_Spain',
        timestamp: new Date(),
        confidence: 0.95,
        relevanceScore: 0.9,
        recencyScore: 0.9,
        rankScore: 0.9,
      },
    ];
    const pipeline = createPipeline({ memoryFragments });
    await pipeline.processQuery(
      { text: 'What is our revenue forecast?', businessId: 'biz-1', userId: 'user-1' },
      { integrationV2Enabled: false, genomeV3Enabled: true },
    );

    const memoryService = (pipeline as any).memoryRetrieval as KeyCortexMemoryRetrievalService;
    expect((memoryService as any).unifiedMemory.retrieveContext).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ query: 'What is our revenue forecast?', limit: 10 }),
    );
  });

  it('injects memory context block into the system prompt', async () => {
    const memoryFragments = [
      {
        id: 'mf_1',
        sourceType: 'cortex_action_log',
        title: 'CREATE_TASK',
        content: 'CREATE_TASK: success — Follow up',
        timestamp: new Date(),
        confidence: 0.9,
        relevanceScore: 0.9,
        recencyScore: 0.9,
        rankScore: 0.9,
      },
    ];

    const pipeline = createPipeline({ memoryFragments });
    await pipeline.processQuery(
      { text: 'What should I do next?', businessId: 'biz-1', userId: 'user-1' },
      { integrationV2Enabled: false, genomeV3Enabled: true },
    );

    expect(mockSystemPromptService.buildV3SystemPrompt).toHaveBeenCalled();
    const buildMessagesCall = mockPromptContextService.buildMessages.mock.calls[0];
    const enrichedSystemPrompt = buildMessagesCall[2] as string;
    expect(enrichedSystemPrompt).toContain('=== RELEVANT MEMORY ===');
    expect(enrichedSystemPrompt).toContain('CREATE_TASK');
  });
});

// KF-EXEC-AUTH-FAIL-CLOSED-001. Authority uncertainty may only narrow what can
// execute. Each test drives processQuery through the parsed-command path, the
// executor boundary (executeBatch) and the STEP_5_CHECK_AUTONOMY evidence.
describe('KeyCortexQueryPipelineService parsed-command autonomy fails closed', () => {
  const createInvoice = {
    module: 'commerce',
    action: 'create_invoice',
    parameters: { amount: 100 },
    requiresApproval: false,
    naturalLanguage: 'create an invoice',
  };
  const sendEmail = {
    module: 'outreach',
    action: 'send_email',
    parameters: { to: 'a@example.com' },
    requiresApproval: false,
    naturalLanguage: 'send an email',
  };
  const allow = {
    allowed: true,
    requiresApproval: false,
    tier: 'full',
    confidence: 1,
    reason: 'policy allows',
    ruleTrace: [],
    createdAt: new Date(0),
  };
  const deny = { ...allow, allowed: false, reason: 'policy denies' };

  function setup({
    intents = [createInvoice],
    withOrchestrator = true,
  }: { intents?: any[]; withOrchestrator?: boolean } = {}) {
    const router = new AdaptiveRouterService();
    vi.spyOn(router, 'route').mockReturnValue({
      taskCategory: 'general',
      layers: ['ethics'],
      promptVariant: 'concise',
      includeGenomeContext: false,
      includeMemoryContext: false,
      includeActions: true,
      complexity: 'simple',
      domain: 'general',
      urgency: 'low',
      emotionalWeight: 'low',
      timeHorizon: 'tactical',
      dataRequirement: 'none',
    } as any);

    const commandService = {
      parseIntent: vi.fn().mockResolvedValue(intents),
      toConnectorCommand: vi.fn((intent: any, businessId: string, userId: string) => ({
        module: intent.module,
        action: intent.action,
        parameters: intent.parameters,
        businessId,
        userId,
      })),
    };
    const executorService = {
      // V1-02: the executor answers a BatchResult (an envelope with nested
      // ExecutionRecords), not the array #155's fixture used; #182's mapper
      // rejects that array as an invalid envelope.
      executeBatch: vi.fn(async (commands: any[]) =>
        batchResult(commands.map((command) => executionRecord(command))),
      ),
      // V1-02 review repair: the executor's approval flow and its audit write,
      // which the pipeline uses for the parsed commands it does not execute.
      executeWithApproval: vi.fn(async (command: any) => approvalRequest(command)),
      logExecution: vi.fn().mockResolvedValue(undefined),
    };
    const eventService = { logEvent: vi.fn().mockResolvedValue(undefined) };
    const autonomyOrchestrator = {
      evaluateAction: vi.fn().mockResolvedValue(allow),
    };

    const pipeline = createPipeline({
      router,
      connectorService: { getAllCapabilities: vi.fn().mockReturnValue([]) },
      commandService,
      executorService,
      eventService,
      autonomyOrchestrator: withOrchestrator ? autonomyOrchestrator : undefined,
    });
    const logger = (pipeline as any).logger;
    const logged = {
      error: vi.spyOn(logger, 'error').mockImplementation(() => undefined),
      warn: vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
      log: vi.spyOn(logger, 'log').mockImplementation(() => undefined),
    };

    const run = (flags = { integrationV2Enabled: true, genomeV3Enabled: false }) =>
      pipeline.processQuery(
        {
          text: 'Create an invoice',
          businessId: 'biz-1',
          userId: 'user-1',
          enableActions: true,
        } as any,
        flags,
      );
    const autonomyEvidence = () => {
      const events = eventService.logEvent.mock.calls
        .map(([event]: any[]) => event)
        .filter((event: any) => event.step === 'STEP_5_CHECK_AUTONOMY');
      expect(events).toHaveLength(1);
      return events[0].data;
    };
    const executedCommands = () =>
      executorService.executeBatch.mock.calls.flatMap(([commands]: any[]) => commands);
    const allLogLines = () =>
      [
        ...logged.error.mock.calls,
        ...logged.warn.mock.calls,
        ...logged.log.mock.calls,
      ].map(([line]) => String(line));

    return {
      run,
      executorService,
      autonomyOrchestrator,
      autonomyEvidence,
      executedCommands,
      logged,
      allLogLines,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockContextService.buildContextSnapshot.mockResolvedValue(mockContextSnapshot);
    mockModelGateway.complete.mockResolvedValue({
      content: 'Hello',
      provider: 'openai',
      model: 'gpt-4o',
      usage: { totalTokens: 10, estimatedCost: 0.001 },
      fallbackUsed: false,
    });
    mockSessionService.getOrCreateSession.mockResolvedValue(mockSession);
    mockActionDetectionService.detectActions.mockReturnValue([]);
    mockActionsService.executeActions.mockResolvedValue([]);
    mockGenomeBridgeService.checkAutonomy.mockReset();
  });

  it('AUTH-FC-P01 an autonomy evaluation that throws leaves zero parsed commands executable', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));

    await t.run();

    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledTimes(1);
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.executedCommands()).toEqual([]);
  });

  it('AUTH-FC-P01 a failure on a later command does not keep the approved prefix', async () => {
    const t = setup({ intents: [createInvoice, sendEmail] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockRejectedValueOnce(new Error('oracle down'));

    await t.run();

    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledTimes(2);
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.executedCommands()).toEqual([]);
  });

  it('AUTH-FC-P01 V1-02 an evaluation that throws on command 2 of 3 lets zero commands reach executeBatch', async () => {
    const createTask = {
      module: 'crm',
      action: 'create_task',
      parameters: { title: 'call back' },
      requiresApproval: false,
      naturalLanguage: 'create a task',
    };
    const t = setup({ intents: [createInvoice, sendEmail, createTask] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockRejectedValueOnce(new Error('oracle down'))
      .mockResolvedValueOnce(allow);

    const response = await t.run();

    // The batch stops at the failure: command 3 is never evaluated, and the
    // allowed command 1 is not kept.
    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledTimes(2);
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.executedCommands()).toEqual([]);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(response.actions).toEqual([]);
    expect(t.autonomyEvidence()).toMatchObject({
      totalCommands: 3,
      approvedCommands: 0,
      outcome: 'authority_check_failed_closed',
      authorityCheckFailed: true,
      authorityCheckError: 'oracle down',
    });
  });

  it('AUTH-FC-P01 a genome autonomy check that throws leaves zero parsed commands executable', async () => {
    const t = setup({ withOrchestrator: false });
    mockGenomeBridgeService.checkAutonomy.mockRejectedValue(new Error('genome down'));

    await t.run({ integrationV2Enabled: true, genomeV3Enabled: true });

    expect(mockGenomeBridgeService.checkAutonomy).toHaveBeenCalledTimes(1);
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'allowed'],
    ['an object without allowed', { reason: 'no verdict' }],
  ])(
    'AUTH-FC-P01B an unusable verdict (%s) leaves zero parsed commands executable',
    async (_label, verdict) => {
      const t = setup({ intents: [createInvoice, sendEmail] });
      t.autonomyOrchestrator.evaluateAction
        .mockResolvedValueOnce(allow)
        .mockResolvedValueOnce(verdict as any);

      await t.run();

      expect(t.executorService.executeBatch).not.toHaveBeenCalled();
      expect(t.autonomyEvidence()).toMatchObject({
        approvedCommands: 0,
        outcome: 'authority_check_failed_closed',
      });
    },
  );

  it('AUTH-FC-P01B a verdict whose allowed is truthy but not a boolean leaves zero parsed commands executable', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue({ allowed: 'true' } as any);

    await t.run();

    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.autonomyEvidence()).toMatchObject({
      approvedCommands: 0,
      outcome: 'authority_check_failed_closed',
    });
  });

  // AUTH-FC-F1: `allowed: true` is not an approval on its own. The verdict must
  // also state requiresApproval and a recognized tier; leaving them out is not a
  // statement that no approval is needed. The malformed verdict is the second of
  // the batch, after a well-formed approval, so the whole batch is in question.
  it.each([
    ['no approval or tier metadata', { allowed: true }],
    ['no requiresApproval', { allowed: true, tier: 'full' }],
    ['no tier', { allowed: true, requiresApproval: false }],
    ['an unrecognized tier', { ...allow, tier: 'autonomous' }],
    ['a non-boolean requiresApproval', { ...allow, requiresApproval: null }],
  ])(
    'AUTH-FC-P01B an allowed verdict with %s leaves zero parsed commands executable',
    async (_label, verdict) => {
      const t = setup({ intents: [createInvoice, sendEmail] });
      t.autonomyOrchestrator.evaluateAction
        .mockResolvedValueOnce(allow)
        .mockResolvedValueOnce(verdict as any);

      await t.run();

      expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledTimes(2);
      expect(t.executorService.executeBatch).not.toHaveBeenCalled();
      expect(t.executedCommands()).toEqual([]);
      expect(t.autonomyEvidence()).toEqual({
        totalCommands: 2,
        approvedCommands: 0,
        outcome: 'authority_check_failed_closed',
        authorityCheckFailed: true,
        authorityCheckError: 'Unusable autonomy verdict for outreach.send_email',
        autonomyMap: { 'commerce:create_invoice': true },
      });
    },
  );

  it('AUTH-FC-P01B a genome autonomy verdict of allowed with no approval or tier metadata leaves zero parsed commands executable', async () => {
    const t = setup({ withOrchestrator: false });
    mockGenomeBridgeService.checkAutonomy.mockResolvedValue({ allowed: true });

    await t.run({ integrationV2Enabled: true, genomeV3Enabled: true });

    expect(mockGenomeBridgeService.checkAutonomy).toHaveBeenCalledTimes(1);
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.autonomyEvidence()).toMatchObject({
      approvedCommands: 0,
      outcome: 'authority_check_failed_closed',
      authorityCheckFailed: true,
    });
  });

  it('AUTH-FC-P03 the conversational response completes with no effect when the authority check fails', async () => {
    const t = setup();
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));

    const response = await t.run();

    expect(mockModelGateway.complete).toHaveBeenCalledTimes(1);
    expect(response.message.role).toBe('assistant');
    expect(response.message.content).toBe('Hello');
    expect(response.actions).toEqual([]);
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(mockSessionService.saveMessage).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({ role: 'assistant', content: 'Hello' }),
    );
  });

  it('AUTH-FC-P04 an explicitly allowed command still reaches the executor', async () => {
    const t = setup();

    const response = await t.run();

    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledWith(
      'biz-1',
      'commerce.create_invoice',
      { amount: 100 },
      expect.objectContaining({ proposedBy: 'user-1' }),
    );
    expect(t.executorService.executeBatch).toHaveBeenCalledTimes(1);
    expect(t.executedCommands()).toEqual([
      expect.objectContaining({
        module: 'commerce',
        action: 'create_invoice',
        businessId: 'biz-1',
      }),
    ]);
    expect(response.actions).toEqual([
      expect.objectContaining({ actionType: 'CREATE_INVOICE', status: 'success' }),
    ]);
    expect(t.autonomyEvidence()).toMatchObject({
      totalCommands: 1,
      approvedCommands: 1,
      outcome: 'evaluated',
      authorityCheckFailed: false,
      authorityCheckError: null,
      autonomyMap: { 'commerce:create_invoice': true },
    });
  });

  it('AUTH-FC-P04 only the allowed command of a mixed batch reaches the executor', async () => {
    const t = setup({ intents: [createInvoice, sendEmail] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce(deny);

    await t.run();

    expect(t.executedCommands()).toEqual([
      expect.objectContaining({ action: 'create_invoice' }),
    ]);
    expect(t.autonomyEvidence()).toMatchObject({
      totalCommands: 2,
      approvedCommands: 1,
      outcome: 'evaluated',
      authorityCheckFailed: false,
    });
  });

  it.each([
    ['denied', deny, createInvoice],
    ['manual tier', { ...allow, tier: 'manual' }, createInvoice],
    ['approval required by the verdict', { ...allow, requiresApproval: true }, createInvoice],
    ['approval required by the command', allow, { ...createInvoice, requiresApproval: true }],
  ])(
    'AUTH-FC-P05 a command that is %s stays non-executable',
    async (_label, verdict, intent) => {
      const t = setup({ intents: [intent] });
      t.autonomyOrchestrator.evaluateAction.mockResolvedValue(verdict);

      await t.run();

      expect(t.executorService.executeBatch).not.toHaveBeenCalled();
      expect(t.autonomyEvidence()).toMatchObject({
        totalCommands: 1,
        approvedCommands: 0,
        outcome: 'evaluated',
        authorityCheckFailed: false,
      });
    },
  );

  it('AUTH-FC-P05 no authority oracle stays non-executable and is not reported as a failure', async () => {
    const t = setup({ withOrchestrator: false });

    await t.run();

    expect(mockGenomeBridgeService.checkAutonomy).not.toHaveBeenCalled();
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.autonomyEvidence()).toMatchObject({
      totalCommands: 1,
      approvedCommands: 0,
      outcome: 'evaluated',
      authorityCheckFailed: false,
      autonomyMap: { 'commerce:create_invoice': false },
    });
  });

  it('AUTH-FC-P06 the evidence and the log name a failed authority check as failed closed', async () => {
    const t = setup({ intents: [createInvoice, sendEmail] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockRejectedValueOnce(new Error('oracle down'));

    await t.run();

    expect(t.autonomyEvidence()).toEqual({
      totalCommands: 2,
      approvedCommands: 0,
      outcome: 'authority_check_failed_closed',
      authorityCheckFailed: true,
      authorityCheckError: 'oracle down',
      autonomyMap: { 'commerce:create_invoice': true },
    });
    expect(t.logged.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Autonomy check failed, failing closed: 0/2 parsed commands executable: oracle down',
      ),
    );
    expect(t.allLogLines().filter((line) => /commands approved/.test(line))).toEqual([]);
    expect(
      t.allLogLines().filter((line) => /using all parsed commands/.test(line)),
    ).toEqual([]);
  });

  // ── V1-02 review repair SEC-V102-1: no legacy route after evaluation ──────
  // The legacy branch (detectActions on the completion, then
  // actionsService.executeActions) has a weaker gate keyed on
  // key_cortex.<TYPE>. Once a parsed command has been put to the authority,
  // whatever it decided is final for the turn: nothing reaches that branch.
  // The completion here names an action, so a legacy route would be visible.
  const completionAction = {
    actionType: 'CREATE_INVOICE',
    status: 'pending_approval',
    description: 'invoice',
    result: { amount: 100 },
  };

  it.each([
    ['fails closed (the evaluation throws)', () => Promise.reject(new Error('oracle down'))],
    ['fails closed (an unusable allowed verdict)', () => Promise.resolve({ allowed: true })],
    ['denies the parsed command', () => Promise.resolve(deny)],
  ])(
    'V1-02-LG01 processQuery runs nothing on the legacy executor when the authority %s',
    async (_label, verdict) => {
      const t = setup();
      t.autonomyOrchestrator.evaluateAction.mockImplementation(verdict);
      mockActionDetectionService.detectActions.mockReturnValue([completionAction]);
      mockActionsService.executeActions.mockImplementation(async (actions: any[]) =>
        actions.map((a: any) => ({ ...a, status: 'success', description: 'legacy executed' })),
      );

      const response = await t.run();

      expect(t.executorService.executeBatch).not.toHaveBeenCalled();
      expect(mockActionDetectionService.detectActions).not.toHaveBeenCalled();
      expect(mockActionsService.executeActions).not.toHaveBeenCalled();
      expect(response.actions).toEqual([]);
    },
  );

  it('V1-02-LG02 processQuery with no parsed command keeps the legacy detection path', async () => {
    const t = setup({ intents: [] });
    mockActionDetectionService.detectActions.mockReturnValue([completionAction]);

    await t.run();

    expect(t.autonomyOrchestrator.evaluateAction).not.toHaveBeenCalled();
    expect(mockActionsService.executeActions).toHaveBeenCalledTimes(1);
    expect(mockActionsService.executeActions).toHaveBeenCalledWith(
      [completionAction],
      expect.objectContaining({ id: 'session_1' }),
    );
  });

  it('V1-02-LG03 with the real legacy actions service, a verdict the pipeline rejects as unusable runs no tool', async () => {
    const { KeyCortexActionsService } = await import('../key-cortex-actions.service');
    // The legacy gate reads verdict.allowed with no usability check, so on a
    // legacy route this verdict would execute cortex.create_task.
    const orchestrator = { evaluateAction: vi.fn().mockResolvedValue({ allowed: true }) };
    const toolExecute = vi.fn().mockResolvedValue({ success: true, data: { id: 'task_1' } });
    const realActions = new (KeyCortexActionsService as any)(
      { client: { cortexActionLog: { create: vi.fn().mockResolvedValue({}) } } },
      undefined,
      {},
      { execute: toolExecute },
      undefined,
      orchestrator,
      undefined,
      undefined,
      undefined,
    );
    vi.spyOn(realActions, 'buildToolDefinitions').mockResolvedValue([]);
    const router = new AdaptiveRouterService();
    vi.spyOn(router, 'route').mockReturnValue({
      taskCategory: 'general',
      layers: ['ethics'],
      promptVariant: 'concise',
      includeGenomeContext: false,
      includeMemoryContext: false,
      includeActions: true,
      complexity: 'simple',
      domain: 'general',
      urgency: 'low',
      emotionalWeight: 'low',
      timeHorizon: 'tactical',
      dataRequirement: 'none',
    } as any);
    const executorService = {
      executeBatch: vi.fn(),
      executeWithApproval: vi.fn(),
      logExecution: vi.fn().mockResolvedValue(undefined),
    };
    const eventService = { logEvent: vi.fn().mockResolvedValue(undefined) };
    const pipeline = new KeyCortexQueryPipelineService(
      mockModelGateway as any,
      mockPrisma as any,
      mockRedis as any,
      mockPersonalityService as any,
      mockContextService as any,
      realActions,
      mockSessionService as any,
      mockPromptContextService as any,
      mockToolLoopService as any,
      mockActionDetectionService as any,
      mockSuggestionService as any,
      mockGenomeContextService as any,
      mockSystemPromptService as any,
      mockStructuredOutputService as any,
      mockMoodDetectionService as any,
      makeMemoryRetrieval([]),
      router,
      { getAllCapabilities: vi.fn().mockReturnValue([]) } as any,
      {
        parseIntent: vi.fn().mockResolvedValue([
          { module: 'crm', action: 'create_task', parameters: { title: 't' }, requiresApproval: false, naturalLanguage: 'x' },
        ]),
        toConnectorCommand: vi.fn((intent: any, businessId: string, userId: string) => ({
          module: intent.module,
          action: intent.action,
          parameters: intent.parameters,
          businessId,
          userId,
        })),
      } as any,
      executorService as any,
      undefined,
      mockGenomeBridgeService as any,
      eventService as any,
      undefined,
      undefined,
      undefined,
      orchestrator as any,
    );
    for (const target of [pipeline, realActions]) {
      for (const level of ['error', 'warn', 'log', 'debug']) {
        vi.spyOn((target as any).logger, level).mockImplementation(() => undefined);
      }
    }
    mockActionDetectionService.detectActions.mockReturnValue([
      { actionType: 'CREATE_TASK', status: 'pending_approval', description: 'task', result: { title: 'call Ana' } },
    ]);

    const response = await pipeline.processQuery(
      { text: 'make a task', businessId: 'biz-1', userId: 'user-1', enableActions: true } as any,
      { integrationV2Enabled: true, genomeV3Enabled: false },
    );

    const step5 = eventService.logEvent.mock.calls
      .map(([event]: any[]) => event)
      .find((event: any) => event.step === 'STEP_5_CHECK_AUTONOMY');
    expect(step5.data.outcome).toBe('authority_check_failed_closed');
    expect(toolExecute).not.toHaveBeenCalled();
    expect(executorService.executeBatch).not.toHaveBeenCalled();
    expect(response.actions.filter((a: any) => a.status === 'success')).toEqual([]);
  });

  // ── V1-02 review repair CR-V102-1: approval-required commands ─────────────
  it.each([
    ['the verdict is supervised', { ...allow, tier: 'supervised', requiresApproval: true }, createInvoice],
    ['the command needs approval', allow, { ...createInvoice, requiresApproval: true }],
  ])(
    'V1-02-AP01 processQuery: when %s the executor approval flow records a request and nothing executes',
    async (_label, verdict, intent) => {
      const t = setup({ intents: [intent] });
      t.autonomyOrchestrator.evaluateAction.mockResolvedValue(verdict);

      const response = await t.run();

      expect(t.executorService.executeBatch).not.toHaveBeenCalled();
      expect(mockActionsService.executeActions).not.toHaveBeenCalled();
      expect(t.executorService.executeWithApproval).toHaveBeenCalledTimes(1);
      expect(t.executorService.executeWithApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'commerce',
          action: 'create_invoice',
          businessId: 'biz-1',
          userId: 'user-1',
        }),
      );
      expect(response.actions).toEqual([
        expect.objectContaining({
          actionType: 'CREATE_INVOICE',
          status: 'pending_approval',
          requiresApproval: true,
          approvalRequestId: 'proposal-create_invoice',
        }),
      ]);
      expect(auditedRecords(t.executorService)).toEqual([
        expect.objectContaining({
          id: 'proposal-create_invoice',
          command: expect.objectContaining({ action: 'create_invoice', userId: 'user-1' }),
          result: expect.objectContaining({
            success: false,
            error: 'Approval pending',
            data: { approvalStatus: 'pending' },
          }),
        }),
      ]);
    },
  );

  // ── V1-02 review repair SEC-V102-2: refusals leave an audit row ───────────
  it('V1-02-AU01 processQuery: a denied parsed command leaves one refusal row and only the allowed one executes', async () => {
    const t = setup({ intents: [createInvoice, sendEmail] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce(deny);

    await t.run();

    expect(t.executedCommands()).toEqual([
      expect.objectContaining({ action: 'create_invoice' }),
    ]);
    expect(t.executorService.executeWithApproval).not.toHaveBeenCalled();
    expect(auditedRecords(t.executorService)).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({
          module: 'outreach',
          action: 'send_email',
          businessId: 'biz-1',
          userId: 'user-1',
        }),
        result: expect.objectContaining({ success: false, error: 'policy denies' }),
      }),
    ]);
  });

  it('V1-02-AU02 processQuery: a failed-closed check leaves one refusal row per parsed command and creates no approval', async () => {
    const t = setup({ intents: [createInvoice, { ...sendEmail, requiresApproval: true }] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockRejectedValueOnce(new Error('oracle down'));

    const response = await t.run();

    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.executorService.executeWithApproval).not.toHaveBeenCalled();
    expect(response.actions).toEqual([]);
    const audited = auditedRecords(t.executorService);
    expect(audited.map((r: any) => r.command.action)).toEqual(['create_invoice', 'send_email']);
    for (const record of audited) {
      expect(record.command.userId).toBe('user-1');
      expect(record.result.success).toBe(false);
      expect(record.result.error).toContain('failed closed');
      expect(record.result.error).toContain('oracle down');
    }
  });
});

// V1-02-KEY-CORTEX-FAILCLOSED (#182, PRS-M20). executeBatch answers a
// BatchResult. The pipeline consumes it through mapCortexBatchResult and never
// replays a v2 attempt on the legacy executor (actionsService.executeActions):
// once the v2 executor may have written, an outcome it cannot read is reported
// as one 'unverified' result. The stream path is held to the same parsed-command
// autonomy gate as processQuery before anything reaches executeBatch.
describe('KeyCortexQueryPipelineService v2 BatchResult is consumed without legacy replay', () => {
  const createInvoice = {
    module: 'commerce',
    action: 'create_invoice',
    parameters: { amount: 100 },
    requiresApproval: false,
    naturalLanguage: 'create an invoice',
  };
  const detectedTask = {
    actionType: 'CREATE_TASK',
    status: 'pending_approval',
    description: 'follow up with Ana',
    requiresApproval: false,
  };
  const detectedEvent = {
    actionType: 'CREATE_EVENT',
    status: 'pending_approval',
    description: 'book the quarterly review',
    requiresApproval: false,
  };
  const detectedReport = {
    actionType: 'GENERATE_REPORT',
    status: 'pending_approval',
    description: 'monthly revenue report',
    requiresApproval: false,
  };
  const allow = {
    allowed: true,
    requiresApproval: false,
    tier: 'full',
    confidence: 1,
    reason: 'policy allows',
    ruleTrace: [],
    createdAt: new Date(0),
  };
  const deny = { ...allow, allowed: false, reason: 'policy denies' };

  function setup({
    intents = [createInvoice],
    detected = [] as any[],
  }: { intents?: any[]; detected?: any[] } = {}) {
    const router = new AdaptiveRouterService();
    vi.spyOn(router, 'route').mockReturnValue({
      taskCategory: 'general',
      layers: ['ethics'],
      promptVariant: 'concise',
      includeGenomeContext: false,
      includeMemoryContext: false,
      includeActions: true,
      complexity: 'simple',
      domain: 'general',
      urgency: 'low',
      emotionalWeight: 'low',
      timeHorizon: 'tactical',
      dataRequirement: 'none',
    } as any);

    const commandService = {
      parseIntent: vi.fn().mockResolvedValue(intents),
      toConnectorCommand: vi.fn((intent: any, businessId: string, userId: string) => ({
        module: intent.module,
        action: intent.action,
        parameters: intent.parameters,
        businessId,
        userId,
      })),
    };
    const executorService = {
      executeBatch: vi.fn(async (commands: any[]) =>
        batchResult(commands.map((command) => executionRecord(command))),
      ),
      executeWithApproval: vi.fn(async (command: any) => approvalRequest(command)),
      logExecution: vi.fn().mockResolvedValue(undefined),
    };
    const autonomyOrchestrator = {
      evaluateAction: vi.fn().mockResolvedValue(allow),
    };
    const eventService = { logEvent: vi.fn().mockResolvedValue(undefined) };
    mockActionDetectionService.detectActions.mockReturnValue(detected);
    // A legacy replay, were one attempted, would visibly "succeed".
    mockActionsService.executeActions.mockImplementation(async (actions: any[]) =>
      actions.map((a: any) => ({ ...a, status: 'success', description: 'legacy replay' })),
    );

    const pipeline = createPipeline({
      router,
      connectorService: { getAllCapabilities: vi.fn().mockReturnValue([]) },
      commandService,
      executorService,
      eventService,
      autonomyOrchestrator,
    });
    const logger = (pipeline as any).logger;
    const logged = {
      error: vi.spyOn(logger, 'error').mockImplementation(() => undefined),
      warn: vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
      log: vi.spyOn(logger, 'log').mockImplementation(() => undefined),
    };
    const query = {
      text: 'Create an invoice',
      businessId: 'biz-1',
      userId: 'user-1',
      enableActions: true,
    } as any;
    const flags = { integrationV2Enabled: true, genomeV3Enabled: false };

    const run = () => pipeline.processQuery(query, flags);
    const stream = async () => {
      const chunks: any[] = [];
      for await (const chunk of pipeline.streamQuery(query, flags)) chunks.push(chunk);
      return chunks;
    };
    /** The action_delta chunks the stream yields after the detection proposals. */
    const streamedResults = (chunks: any[]) =>
      chunks
        .filter((c) => c.type === 'action_delta')
        .slice(detected.length)
        .map((c) => c.action);
    const executedCommands = () =>
      executorService.executeBatch.mock.calls.flatMap(([commands]: any[]) => commands);
    const loggedSteps = () =>
      eventService.logEvent.mock.calls.map(([event]: any[]) => event);

    return {
      run,
      stream,
      streamedResults,
      executorService,
      autonomyOrchestrator,
      executedCommands,
      loggedSteps,
      logged,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockContextService.buildContextSnapshot.mockResolvedValue(mockContextSnapshot);
    mockModelGateway.complete.mockResolvedValue({
      content: 'Hello',
      provider: 'openai',
      model: 'gpt-4o',
      usage: { totalTokens: 10, estimatedCost: 0.001 },
      fallbackUsed: false,
    });
    mockModelGateway.streamComplete.mockImplementation(async function* () {
      yield { content: 'Done.', provider: 'openai', model: 'gpt-4o' };
    });
    mockSessionService.getOrCreateSession.mockResolvedValue(mockSession);
    mockGenomeBridgeService.checkAutonomy.mockReset();
  });

  // ── processQuery ──────────────────────────────────────────

  it('V1-02-BR01 processQuery consumes a real BatchResult and does not replay it on the legacy executor', async () => {
    const t = setup({ detected: [detectedTask] });
    t.executorService.executeBatch.mockImplementation(async (commands: any[]) =>
      batchResult(commands.map((c) => executionRecord(c, { data: { id: 'inv_1' } }))),
    );

    const response = await t.run();

    expect(t.executorService.executeBatch).toHaveBeenCalledTimes(1);
    expect(t.executorService.executeBatch).toHaveBeenCalledWith(
      [expect.objectContaining({ module: 'commerce', action: 'create_invoice' })],
      { sourceInfo: { businessId: 'biz-1', userId: 'user-1' } },
    );
    expect(response.actions).toEqual([
      expect.objectContaining({
        actionType: 'CREATE_INVOICE',
        status: 'success',
        result: { id: 'inv_1' },
      }),
    ]);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(mockActionDetectionService.detectActions).not.toHaveBeenCalled();
  });

  it('V1-02-BR02 processQuery reports a failed nested record as an error, not a success', async () => {
    const t = setup({ detected: [detectedTask] });
    t.executorService.executeBatch.mockImplementation(async (commands: any[]) =>
      batchResult(commands.map((c) => executionRecord(c, { success: false, error: 'denied' }))),
    );

    const response = await t.run();

    expect(response.actions).toEqual([
      expect.objectContaining({ actionType: 'CREATE_INVOICE', status: 'error', error: 'denied' }),
    ]);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
  });

  it('V1-02-BR03 processQuery reports a pending approval record as pending approval', async () => {
    const t = setup();
    t.executorService.executeBatch.mockImplementation(async (commands: any[]) =>
      batchResult(
        commands.map((c) =>
          executionRecord(c, {
            success: false,
            data: { approvalStatus: 'pending' },
            error: 'Approval pending',
            id: 'proposal_1',
          }),
        ),
      ),
    );

    const response = await t.run();

    expect(response.actions).toEqual([
      expect.objectContaining({
        actionType: 'CREATE_INVOICE',
        status: 'pending_approval',
        requiresApproval: true,
        approvalRequestId: 'proposal_1',
      }),
    ]);
  });

  it('V1-02-BR04 processQuery reports one unverified result, and replays nothing, when executeBatch throws', async () => {
    const t = setup({ detected: [detectedTask] });
    t.executorService.executeBatch.mockRejectedValue(new Error('connector timeout'));

    const response = await t.run();

    expect(t.executorService.executeBatch).toHaveBeenCalledTimes(1);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(mockActionDetectionService.detectActions).not.toHaveBeenCalled();
    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]).toMatchObject({
      actionType: 'EXECUTE_TOOL',
      status: 'error',
      requiresApproval: false,
    });
    expect(response.actions[0].description).toContain('unverified');
    expect(response.actions[0].error).toContain('not attempted');
  });

  it('V1-02-BR05 processQuery reports one unverified result, and replays nothing, for an unreadable batch envelope', async () => {
    const t = setup({ detected: [detectedTask] });
    // The legacy array shape the pipeline used to expect.
    t.executorService.executeBatch.mockImplementation(async (commands: any[]) =>
      commands.map((command) => ({ command, success: true, data: {} })),
    );

    const response = await t.run();

    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]).toMatchObject({ actionType: 'EXECUTE_TOOL', status: 'error' });
    expect(response.actions[0].description).toContain('unverified');
  });

  it('V1-02-BR06 processQuery does not invent results for commands a stopped batch never attempted', async () => {
    const createTask = { ...createInvoice, module: 'crm', action: 'create_task' };
    const t = setup({ intents: [createInvoice, createTask] });
    t.executorService.executeBatch.mockImplementation(async (commands: any[]) =>
      batchResult([executionRecord(commands[0], { success: false, error: 'denied' })], commands.length),
    );

    const response = await t.run();

    expect(t.executedCommands()).toHaveLength(2);
    expect(response.actions).toEqual([
      expect.objectContaining({ actionType: 'CREATE_INVOICE', status: 'error' }),
    ]);
    expect(t.logged.warn).toHaveBeenCalledWith(
      expect.stringContaining('v2 batch stopped early; trailing commands were not attempted'),
    );
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
  });

  // ── streamQuery ───────────────────────────────────────────

  it('V1-02-ST01 streamQuery: an evaluation that throws on command 2 of 3 lets zero commands reach executeBatch', async () => {
    const t = setup({ detected: [detectedTask, detectedEvent, detectedReport] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockRejectedValueOnce(new Error('oracle down'))
      .mockResolvedValueOnce(allow);

    const chunks = await t.stream();

    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenCalledTimes(2);
    expect(t.autonomyOrchestrator.evaluateAction).toHaveBeenNthCalledWith(
      1,
      'biz-1',
      'autopilot.create_task',
      { description: 'follow up with Ana' },
      expect.objectContaining({ proposedBy: 'user-1' }),
    );
    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    // V1-02 review repair (SEC-V102-2): every detection-time proposal is
    // resolved as blocked; none is left reading as a pending approval.
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked' }),
      expect.objectContaining({ actionType: 'CREATE_EVENT', status: 'blocked' }),
      expect.objectContaining({ actionType: 'GENERATE_REPORT', status: 'blocked' }),
    ]);
    expect(t.logged.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[streamQuery\]\[[^\]]+\] Autonomy check failed, failing closed: 0\/3 parsed commands executable: oracle down$/,
      ),
    );
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('V1-02-ST02 streamQuery: a malformed verdict lets zero commands reach executeBatch', async () => {
    const t = setup({ detected: [detectedTask, detectedEvent] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce({ allowed: true } as any);

    const chunks = await t.stream();

    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(t.executorService.executeWithApproval).not.toHaveBeenCalled();
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked' }),
      expect.objectContaining({ actionType: 'CREATE_EVENT', status: 'blocked' }),
    ]);
  });

  it('V1-02-ST03 streamQuery: only the explicitly allowed command of a mixed batch reaches executeBatch', async () => {
    const t = setup({ detected: [detectedTask, detectedEvent] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce(deny);

    const chunks = await t.stream();

    expect(t.executedCommands()).toEqual([
      expect.objectContaining({ module: 'autopilot', action: 'create_task', businessId: 'biz-1' }),
    ]);
    expect(t.executorService.executeBatch).toHaveBeenCalledWith(expect.any(Array), {
      sourceInfo: { businessId: 'biz-1', userId: 'user-1' },
    });
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'success' }),
      expect.objectContaining({ actionType: 'CREATE_EVENT', status: 'blocked' }),
    ]);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
  });

  it('V1-02-ST04 streamQuery consumes a real BatchResult and does not replay it on the legacy executor', async () => {
    const t = setup({ detected: [detectedTask] });

    const chunks = await t.stream();

    expect(t.executorService.executeBatch).toHaveBeenCalledTimes(1);
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'success' }),
    ]);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
  });

  it('V1-02-ST05 streamQuery yields one unverified result, not a replay, when executeBatch throws', async () => {
    const t = setup({ detected: [detectedTask, detectedEvent] });
    t.executorService.executeBatch.mockRejectedValue(new Error('connector timeout'));

    const chunks = await t.stream();

    expect(t.executorService.executeBatch).toHaveBeenCalledTimes(1);
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    const results = t.streamedResults(chunks);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ actionType: 'EXECUTE_TOOL', status: 'error' });
    expect(results[0].description).toContain('unverified');
    expect(t.logged.error).toHaveBeenCalledWith(
      expect.stringContaining('v2 batch outcome unavailable: connector timeout'),
    );
  });

  it('V1-02-ST06 streamQuery yields one unverified result, not a replay, for an unreadable batch envelope', async () => {
    const t = setup({ detected: [detectedTask] });
    t.executorService.executeBatch.mockImplementation(async (commands: any[]) =>
      commands.map((command) => ({ command, success: true, data: {} })),
    );

    const chunks = await t.stream();

    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    const results = t.streamedResults(chunks);
    expect(results).toHaveLength(1);
    expect(results[0].description).toContain('unverified');
  });

  // ── streamQuery: V1-02 review repair (CR-V102-1, SEC-V102-2) ──────────────

  const detectedInvoice = {
    actionType: 'CREATE_INVOICE',
    status: 'pending_approval',
    description: 'invoice Ana for the retainer',
    requiresApproval: true,
  };
  const supervised = { ...allow, requiresApproval: true, tier: 'supervised', reason: 'needs approval' };

  it.each([
    ['the detector flags it', [detectedInvoice], allow, 'create_invoice', 'CREATE_INVOICE'],
    ['the verdict is supervised', [detectedTask], supervised, 'create_task', 'CREATE_TASK'],
  ])(
    'V1-02-ST07 streamQuery: an allowed action that needs approval because %s gets an approval request from the executor approval flow, not an execution',
    async (_label, detected, verdict, action, actionType) => {
      const t = setup({ detected });
      t.autonomyOrchestrator.evaluateAction.mockResolvedValue(verdict);

      const chunks = await t.stream();

      expect(t.executorService.executeBatch).not.toHaveBeenCalled();
      expect(mockActionsService.executeActions).not.toHaveBeenCalled();
      expect(t.executorService.executeWithApproval).toHaveBeenCalledTimes(1);
      expect(t.executorService.executeWithApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'autopilot',
          action,
          businessId: 'biz-1',
          userId: 'user-1',
          source: 'key_cortex',
        }),
      );
      expect(t.streamedResults(chunks)).toEqual([
        expect.objectContaining({
          actionType,
          status: 'pending_approval',
          approvalRequestId: `proposal-${action}`,
        }),
      ]);
      expect(auditedRecords(t.executorService)).toEqual([
        expect.objectContaining({
          id: `proposal-${action}`,
          command: expect.objectContaining({ action, userId: 'user-1' }),
          result: expect.objectContaining({ success: false, error: 'Approval pending' }),
        }),
      ]);
    },
  );

  it('V1-02-ST08 streamQuery: a denied action leaves one refusal row naming the actor and a blocked follow-up delta', async () => {
    const t = setup({ detected: [detectedTask] });
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(deny);

    const chunks = await t.stream();

    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.executorService.executeWithApproval).not.toHaveBeenCalled();
    expect(auditedRecords(t.executorService)).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({
          module: 'autopilot',
          action: 'create_task',
          businessId: 'biz-1',
          userId: 'user-1',
        }),
        result: expect.objectContaining({ success: false, error: 'policy denies' }),
      }),
    ]);
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked' }),
    ]);
  });

  it('V1-02-ST09 streamQuery: a failed-closed check is evidenced, audits one refusal per action, and creates no approval', async () => {
    const t = setup({ detected: [detectedInvoice, detectedTask] });
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));

    const chunks = await t.stream();

    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(t.executorService.executeWithApproval).not.toHaveBeenCalled();
    const evidence = t.loggedSteps().filter((e: any) => e.step === 'STREAM_CHECK_AUTONOMY');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].data).toEqual({
      totalCommands: 2,
      approvedCommands: 0,
      outcome: 'authority_check_failed_closed',
      authorityCheckFailed: true,
      authorityCheckError: 'oracle down',
      autonomyMap: {},
    });
    const audited = auditedRecords(t.executorService);
    expect(audited.map((r: any) => r.command.action)).toEqual(['create_invoice', 'create_task']);
    for (const record of audited) {
      expect(record.command.userId).toBe('user-1');
      expect(record.result.success).toBe(false);
      expect(record.result.error).toContain('failed closed');
    }
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_INVOICE', status: 'blocked' }),
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked' }),
    ]);
  });

  it('V1-02-ST10 streamQuery: the autonomy evidence of an evaluated batch is logged', async () => {
    const t = setup({ detected: [detectedTask, detectedEvent] });
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce(deny);

    await t.stream();

    const evidence = t.loggedSteps().filter((e: any) => e.step === 'STREAM_CHECK_AUTONOMY');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].data).toEqual({
      totalCommands: 2,
      approvedCommands: 1,
      outcome: 'evaluated',
      authorityCheckFailed: false,
      authorityCheckError: null,
      autonomyMap: { 'autopilot:create_task': true, 'autopilot:create_event': false },
    });
  });

  it('V1-02-ST11 streamQuery: an approval request that cannot be created is a refusal, never an execution', async () => {
    const t = setup({ detected: [detectedInvoice] });
    t.executorService.executeWithApproval.mockRejectedValue(new Error('proposal store down'));

    const chunks = await t.stream();

    expect(t.executorService.executeBatch).not.toHaveBeenCalled();
    expect(mockActionsService.executeActions).not.toHaveBeenCalled();
    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_INVOICE', status: 'blocked' }),
    ]);
    expect(auditedRecords(t.executorService)).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          success: false,
          error: expect.stringContaining('proposal store down'),
        }),
      }),
    ]);
  });

  it('V1-02-ST12 streamQuery: an audit write that fails does not change the answer', async () => {
    const t = setup({ detected: [detectedTask] });
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(deny);
    t.executorService.logExecution.mockRejectedValue(new Error('audit db down'));

    const chunks = await t.stream();

    expect(t.streamedResults(chunks)).toEqual([
      expect.objectContaining({ actionType: 'CREATE_TASK', status: 'blocked' }),
    ]);
    expect(t.logged.error).toHaveBeenCalledWith(expect.stringContaining('audit db down'));
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  // ── static ────────────────────────────────────────────────

  it('V1-02-SRC the pipeline keeps no fail-open fallback and no untyped executor cast', () => {
    const source = readFileSync(
      join(__dirname, '..', 'key-cortex-query-pipeline.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/using all parsed commands/);
    expect(source).not.toMatch(/executorService\s+as\s+any/);
  });
});
