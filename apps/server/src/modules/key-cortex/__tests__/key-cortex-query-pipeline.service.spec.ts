import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';
import { AdaptiveRouterService } from '../adaptive-router.service';
import { KeyCortexMemoryRetrievalService } from '../key-cortex-memory-retrieval.service';
import { KeyCortexExpertiseLensService } from '../key-cortex-expertise-lens.service';
import type { PrismaService } from '../../../core/prisma/prisma.service';

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

/** A real lens service — its framing text is what the pipeline must actually carry. */
function makeExpertiseLens() {
  const prisma = {
    client: { jobRole: { findMany: vi.fn().mockResolvedValue([]) } },
  } as unknown as PrismaService;
  return new KeyCortexExpertiseLensService(prisma);
}

function createPipeline({
  memoryFragments = [],
  router = new AdaptiveRouterService(),
  genomeBridge = mockGenomeBridgeService,
  expertiseLens,
}: {
  memoryFragments?: any[];
  router?: AdaptiveRouterService;
  genomeBridge?: any;
  expertiseLens?: KeyCortexExpertiseLensService;
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
    undefined, // connectorService
    undefined, // commandService
    undefined, // executorService
    undefined, // contextV2Service
    genomeBridge,
    undefined, // eventService
    undefined, // proactive
    undefined, // trustExplanation
    undefined, // learningService
    undefined, // autonomyOrchestrator
    undefined, // toolRegistry
    undefined, // lifecycle
    undefined, // qualityService
    undefined, // planner
    expertiseLens,
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

/**
 * The evidence discipline is documented as something that "cannot be opted out
 * of", but it was only ever applied in processQuery. The shipped chat UI streams,
 * so streamQuery is the path that actually reaches users — and it assembled its
 * prompt and called buildMessages without ever consulting the lens. Every
 * user-facing answer therefore went out ungrounded.
 *
 * These lock the lens to BOTH paths, so the streaming path cannot silently drop
 * it again. Note the existing wiring spec hand-copies the append block rather
 * than driving the pipeline, which is why the gap went unnoticed — these drive
 * the real service.
 */
describe('KeyCortexQueryPipelineService — evidence discipline reaches the model', () => {
  /** Drains the generator so prompt assembly actually runs. */
  async function drain(gen: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const c of gen) chunks.push(c);
    return chunks;
  }

  function streamOf(...contents: string[]) {
    return (async function* () {
      for (const content of contents) {
        yield { content, provider: 'openai', model: 'gpt-4o' };
      }
    })();
  }

  /** The system prompt as it was handed to buildMessages. */
  function promptSentToModel(): string {
    const call = mockPromptContextService.buildMessages.mock.calls[0];
    return call[2] as string;
  }

  // clearAllMocks resets call history but keeps implementations, so every
  // stubbed return value is re-established here. Otherwise a test that fails
  // before its cleanup line leaks its stubs into the next one.
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextService.buildContextSnapshot.mockResolvedValue(mockContextSnapshot);
    mockSessionService.getOrCreateSession.mockResolvedValue(mockSession);
    mockSystemPromptService.buildV3SystemPrompt.mockReturnValue('V3 prompt');
    mockStructuredOutputService.buildStructuredOutputInstructions.mockReturnValue('');
    mockModelGateway.streamComplete.mockReturnValue(streamOf('Hello'));
    mockModelGateway.complete.mockResolvedValue({
      content: 'Hello',
      provider: 'openai',
      model: 'gpt-4o',
      usage: { totalTokens: 10, estimatedCost: 0.001 },
      fallbackUsed: false,
    });
  });

  it('streamQuery carries the evidence discipline into the system prompt', async () => {
    const pipeline = createPipeline({ expertiseLens: makeExpertiseLens() });

    await drain(
      pipeline.streamQuery(
        { text: 'reconcile the supplier ledger for March', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );

    const prompt = promptSentToModel();
    expect(prompt).toContain('Evidence:');
    expect(prompt).toMatch(/ground every claim in this business's actual data/i);
    expect(prompt).toMatch(/do not fill the gap with a plausible guess/i);
    expect(prompt).toMatch(/separate what is observed from what is inferred/i);
  });

  it('streamQuery carries the selected lens framing and output format', async () => {
    const pipeline = createPipeline({ expertiseLens: makeExpertiseLens() });

    await drain(
      pipeline.streamQuery(
        { text: 'reconcile the supplier ledger for March', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );

    const prompt = promptSentToModel();
    expect(prompt).toContain('finance professional');
    expect(prompt).toContain('Present the answer as:');
  });

  it('applies the discipline whatever the task — it cannot be routed around by phrasing', async () => {
    for (const text of ['hello', 'why did the deploy fail', 'should we open a second location']) {
      mockPromptContextService.buildMessages.mockClear();
      mockModelGateway.streamComplete.mockReturnValue(streamOf('ok'));

      const pipeline = createPipeline({ expertiseLens: makeExpertiseLens() });
      await drain(
        pipeline.streamQuery(
          { text, businessId: 'biz-1', userId: 'user-1' },
          { integrationV2Enabled: false, genomeV3Enabled: true },
        ),
      );

      expect(promptSentToModel(), `missing discipline for: ${text}`).toContain('Evidence:');
    }
  });

  it('framing precedes the response-format section, matching processQuery ordering', async () => {
    // The lens is appended to systemPrompt *before* the RESPONSE FORMAT marker is
    // considered, so structured-output instructions stay last in both paths.
    mockStructuredOutputService.buildStructuredOutputInstructions.mockReturnValue(
      '=== RESPONSE FORMAT ===\nReturn JSON.',
    );
    const pipeline = createPipeline({ expertiseLens: makeExpertiseLens() });

    await drain(
      pipeline.streamQuery(
        { text: 'reconcile the supplier ledger', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );

    const prompt = promptSentToModel();
    expect(prompt.indexOf('Evidence:')).toBeGreaterThan(-1);
    expect(prompt.indexOf('=== RESPONSE FORMAT ===')).toBeGreaterThan(
      prompt.indexOf('Evidence:'),
    );
  });

  it('does not duplicate the response-format section when the base prompt already has one', async () => {
    mockSystemPromptService.buildV3SystemPrompt.mockReturnValue(
      'V3 prompt\n=== RESPONSE FORMAT ===\nalready here',
    );
    mockStructuredOutputService.buildStructuredOutputInstructions.mockReturnValue(
      '=== RESPONSE FORMAT ===\nReturn JSON.',
    );
    const pipeline = createPipeline({ expertiseLens: makeExpertiseLens() });

    await drain(
      pipeline.streamQuery(
        { text: 'reconcile the supplier ledger', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );

    const prompt = promptSentToModel();
    expect(prompt.split('=== RESPONSE FORMAT ===').length - 1).toBe(1);
    expect(prompt).toContain('Evidence:');
  });

  it('streams normally when no lens is provided — absence must not break the path', async () => {
    const pipeline = createPipeline({ expertiseLens: undefined });

    const chunks = await drain(
      pipeline.streamQuery(
        { text: 'reconcile the supplier ledger', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );

    expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
    expect(promptSentToModel()).not.toContain('Evidence:');
  });

  it('degrades to an unframed prompt if lens selection throws, rather than failing the stream', async () => {
    const broken = {
      select: vi.fn().mockRejectedValue(new Error('boom')),
      buildPromptFraming: vi.fn(),
    } as unknown as KeyCortexExpertiseLensService;
    const pipeline = createPipeline({ expertiseLens: broken });

    const chunks = await drain(
      pipeline.streamQuery(
        { text: 'reconcile the supplier ledger', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );

    expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
    expect(promptSentToModel()).not.toContain('Evidence:');
  });

  it('both paths agree — the same task yields the same discipline in stream and non-stream', async () => {
    const pipelineA = createPipeline({ expertiseLens: makeExpertiseLens() });
    await drain(
      pipelineA.streamQuery(
        { text: 'reconcile the supplier ledger', businessId: 'biz-1', userId: 'user-1' },
        { integrationV2Enabled: false, genomeV3Enabled: true },
      ),
    );
    const streamed = promptSentToModel();

    mockPromptContextService.buildMessages.mockClear();

    const pipelineB = createPipeline({ expertiseLens: makeExpertiseLens() });
    await pipelineB.processQuery(
      { text: 'reconcile the supplier ledger', businessId: 'biz-1', userId: 'user-1' },
      { integrationV2Enabled: false, genomeV3Enabled: true },
    );
    const nonStreamed = promptSentToModel();

    for (const marker of ['Evidence:', 'Approach:', 'Consider:', 'Present the answer as:']) {
      expect(streamed, `stream missing ${marker}`).toContain(marker);
      expect(nonStreamed, `non-stream missing ${marker}`).toContain(marker);
    }
  });

  // The lens is @Optional(), so a missing provider degrades silently — every
  // answer ships ungrounded with nothing in the logs to say so.
  it('warns at startup when the lens provider is missing', () => {
    const pipeline = createPipeline({ expertiseLens: undefined });
    const warn = vi.spyOn((pipeline as any).logger, 'warn').mockImplementation(() => {});

    pipeline.onModuleInit();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/without.*the evidence discipline/i);
  });

  it('stays quiet at startup when the lens is wired', () => {
    const pipeline = createPipeline({ expertiseLens: makeExpertiseLens() });
    const warn = vi.spyOn((pipeline as any).logger, 'warn').mockImplementation(() => {});

    pipeline.onModuleInit();

    expect(warn).not.toHaveBeenCalled();
  });
});
