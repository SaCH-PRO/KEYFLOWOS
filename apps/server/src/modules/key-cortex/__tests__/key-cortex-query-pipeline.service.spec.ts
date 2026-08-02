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
}: {
  memoryFragments?: any[];
  router?: AdaptiveRouterService;
  genomeBridge?: any;
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
