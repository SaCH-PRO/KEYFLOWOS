import { describe, it, expect, beforeEach, vi } from 'vitest';
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
      executeBatch: vi.fn(async (commands: any[]) =>
        commands.map((command) => ({ command, success: true, data: {} })),
      ),
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
});
