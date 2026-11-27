import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexStructuredOutputService } from './key-cortex-structured-output.service';
import { KeyCortexQueryPipelineService } from './key-cortex-query-pipeline.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { KeyCortexSessionService } from './key-cortex-session.service';
import { KeyCortexPromptContextService } from './key-cortex-prompt-context.service';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { KeyCortexActionDetectionService } from './key-cortex-action-detection.service';
import { KeyCortexLegacyInsightService } from './key-cortex-legacy-insight.service';
import { KeyCortexProviderSelectionService } from './key-cortex-provider-selection.service';
import { KeyCortexMoodDetectionService } from './key-cortex-mood-detection.service';
import { KeyCortexSuggestionService } from './key-cortex-suggestion.service';
import { KeyCortexGenomeContextService } from './key-cortex-genome-context.service';
import { KeyCortexSystemPromptService } from './key-cortex-system-prompt.service';
import { KeyCortexInteractionService } from './key-cortex-interaction.service';
import { KeyCortexCommandExecutionService } from './key-cortex-command-execution.service';
import { AdaptiveRouterService } from './adaptive-router.service';
import type { CortexContextSnapshot, CortexQuery } from './key-cortex.types';

const PLAIN_ANSWER = 'Plain answer with no sections';
const SECTIONS_NO_CONFIDENCE =
  '**Role Mode**: CFO\n**Recommendation**: Focus on retention.';
const SECTIONS_BOLD_CONFIDENCE =
  '**Role Mode**: CFO\n**Analysis**: Cash is tight.\n**Recommendation**: Tighten AR collections.\n**Confidence**\n85%';
const SECTIONS_COLON_CONFIDENCE =
  '**Role Mode**: CFO\n**Recommendation**: Tighten AR collections.\nConfidence: 85';

const baseContextSnapshot: CortexContextSnapshot = {
  businessId: 'biz-1',
  genomeDna: {
    execution: 50,
    strategy: 50,
    finance: 50,
    marketing: 50,
    operations: 50,
  },
  genomeStage: 'startup',
  executiveReadiness: 50,
  recentTasks: [],
  recentEvents: [],
  keyMetrics: {},
  activeProjects: [],
  pendingInvoices: 0,
  unreadMessages: 0,
  teamStatus: '',
  timestamp: new Date(),
};

const baseSession = {
  id: 'sess-typed-1',
  businessId: 'biz-1',
  userId: 'user-1',
  status: 'active' as const,
  persona: 'jarvis' as const,
  voice: 'echo' as const,
  mood: 'focused' as const,
  preferredProvider: 'openai' as const,
  messages: [],
  detectedRole: undefined,
  detectedFunction: undefined,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
};

function createPipelineHarness() {
  const prisma = {
    client: {
      cortexSession: {
        findUnique: vi.fn().mockResolvedValue(baseSession),
        findFirst: vi.fn().mockResolvedValue(baseSession),
        create: vi.fn().mockResolvedValue(baseSession),
        update: vi.fn().mockResolvedValue(baseSession),
      },
      cortexMessage: { createMany: vi.fn() },
      aiMemory: { findUnique: vi.fn(), upsert: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ role: 'USER' })) },
      membership: {
        findUnique: vi.fn(async () => ({
          role: 'OWNER',
          permissionScopes: null,
        })),
      },
      business: { findFirst: vi.fn(async () => ({ id: 'biz-1' })) },
      cognitionMemory: {
        create: vi.fn().mockResolvedValue({ id: 'cm_typed_1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    },
  };

  const redis = {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue(undefined),
    setJson: vi.fn().mockResolvedValue(undefined),
    getJson: vi.fn().mockResolvedValue(null),
  };

  const modelGateway = {
    complete: vi.fn(),
    streamComplete: vi.fn(),
  };

  const personalityService = {
    getPersonalityConfig: vi.fn().mockReturnValue({
      persona: 'jarvis',
      temperature: 0.7,
    }),
    buildSystemPrompt: vi.fn().mockReturnValue('You are KEY.'),
    getRoleSystemPrompt: vi.fn().mockReturnValue(''),
    buildValueBlock: vi.fn().mockResolvedValue(''),
    classifyPersona: vi.fn().mockResolvedValue(undefined),
    selectTone: vi.fn().mockResolvedValue({ tone: '', temperatureAdjustment: 0 }),
  };

  const contextService = {
    buildContextSnapshot: vi.fn().mockResolvedValue(baseContextSnapshot),
    formatContextForPrompt: vi.fn().mockReturnValue('Context summary'),
  };

  const actionsService = {
    buildToolDefinitions: vi.fn().mockResolvedValue([]),
    executeActions: vi.fn().mockResolvedValue([]),
  };

  const sessionService = {
    getOrCreateSession: vi.fn().mockResolvedValue(baseSession),
    generateId: vi.fn().mockReturnValue('msg_typed_1'),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    updateSessionCognitionMetadata: vi.fn().mockResolvedValue(undefined),
    updateRunningSummary: vi.fn().mockResolvedValue(undefined),
  };

  const promptContextService = {
    buildMemoryContext: vi.fn().mockResolvedValue({}),
    buildMessages: vi.fn().mockReturnValue([]),
  };

  const toolLoopService = {
    handleToolCalls: vi.fn().mockResolvedValue(null),
  };

  const actionDetectionService = {
    detectActions: vi.fn().mockReturnValue([]),
  };

  const suggestionService = {
    generateSuggestions: vi.fn().mockResolvedValue([]),
  };

  const genomeContextService = {
    getGenomeEnrichedContext: vi.fn().mockResolvedValue(null),
    getRankedRecommendations: vi.fn().mockResolvedValue([]),
    shouldSuggestProactiveAction: vi.fn().mockResolvedValue(false),
    getProactiveSuggestions: vi.fn().mockResolvedValue([]),
  };

  const systemPromptService = {
    buildV3SystemPrompt: vi.fn().mockReturnValue('V3 prompt'),
    buildV2SystemPrompt: vi.fn().mockReturnValue('V2 prompt'),
    enrichSnapshotFromGenome: vi.fn(),
    enrichSnapshotFromV2: vi.fn(),
  };

  const structuredOutputService = new KeyCortexStructuredOutputService();
  const moodDetectionService = new KeyCortexMoodDetectionService();

  const learningService = {
    recordObservation: vi.fn().mockResolvedValue(undefined),
    retrieveLessons: vi.fn().mockResolvedValue([]),
    calibrateConfidence: vi.fn(async (raw: number) => ({
      calibrated: raw,
      gap: 0,
      reliable: false,
    })),
  };

  const pipeline = new KeyCortexQueryPipelineService(
    modelGateway as any,
    prisma as any,
    redis as any,
    personalityService as any,
    contextService as any,
    actionsService as any,
    sessionService as any,
    promptContextService as any,
    toolLoopService as any,
    actionDetectionService as any,
    suggestionService as any,
    genomeContextService as any,
    systemPromptService as any,
    structuredOutputService,
    moodDetectionService,
    undefined, // memoryRetrieval
    undefined, // adaptiveRouter
    undefined, // connectorService
    undefined, // commandService
    undefined, // executorService
    undefined, // contextV2Service
    undefined, // genomeBridgeService
    undefined, // eventService
    undefined, // proactive
    undefined, // trustExplanation
    learningService as any,
  );

  for (const level of ['error', 'warn', 'log', 'debug']) {
    vi.spyOn((pipeline as any).logger, level).mockImplementation(() => undefined);
  }

  return {
    pipeline,
    modelGateway,
    sessionService,
    learningService,
    structuredOutputService,
    prisma,
  };
}

function createReasoningService(
  structuredOutputService: KeyCortexStructuredOutputService,
): KeyCortexReasoningService {
  const prisma = {
    client: {
      cortexSession: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      aiMemory: { findUnique: vi.fn(), upsert: vi.fn() },
    },
  };
  const redis = {
    get: vi.fn(),
    setex: vi.fn(),
    setJson: vi.fn(),
    getJson: vi.fn(),
  };
  const modelGateway = {
    complete: vi.fn(),
    streamComplete: vi.fn(),
    getProviderHealth: vi.fn(),
  };
  const personalityService = {
    getPersonalityConfig: vi.fn().mockReturnValue({
      persona: 'jarvis',
      temperature: 0.7,
    }),
    buildSystemPrompt: vi.fn().mockReturnValue('You are KEY.'),
    getRoleSystemPrompt: vi.fn().mockReturnValue(''),
    buildValueBlock: vi.fn().mockResolvedValue(''),
    classifyPersona: vi.fn().mockResolvedValue(undefined),
    selectTone: vi.fn().mockResolvedValue({ tone: '', temperatureAdjustment: 0 }),
  };
  const contextService = {
    buildContextSnapshot: vi.fn().mockResolvedValue(baseContextSnapshot),
    formatContextForPrompt: vi.fn().mockReturnValue('Context summary'),
  };
  const actionsService = {
    buildToolDefinitions: vi.fn().mockResolvedValue([]),
    executeActions: vi.fn().mockResolvedValue([]),
  };

  const sessionService = new KeyCortexSessionService(prisma as any, redis as any);
  const promptContextService = new KeyCortexPromptContextService(
    contextService as any,
  );
  const moodDetectionService = new KeyCortexMoodDetectionService();
  const actionDetectionService = new KeyCortexActionDetectionService();
  const providerSelectionService = new KeyCortexProviderSelectionService();
  const systemPromptService = new KeyCortexSystemPromptService(
    personalityService as any,
  );
  const genomeContextService = new KeyCortexGenomeContextService(redis as any);
  const suggestionService = new KeyCortexSuggestionService(
    modelGateway as any,
    contextService as any,
  );
  const legacyInsightService = new KeyCortexLegacyInsightService(
    modelGateway as any,
    prisma as any,
    contextService as any,
  );
  const toolLoopService = new KeyCortexToolLoopService(
    modelGateway as any,
    prisma as any,
  );
  const interactionService = new KeyCortexInteractionService(
    modelGateway as any,
    prisma as any,
    redis as any,
    genomeContextService,
  );
  const commandExecutionService = new KeyCortexCommandExecutionService(
    prisma as any,
  );
  const queryPipeline = new KeyCortexQueryPipelineService(
    modelGateway as any,
    prisma as any,
    redis as any,
    personalityService as any,
    contextService as any,
    actionsService as any,
    sessionService,
    promptContextService,
    toolLoopService,
    actionDetectionService,
    suggestionService,
    genomeContextService,
    systemPromptService,
    structuredOutputService,
    moodDetectionService,
  );

  return new KeyCortexReasoningService(
    modelGateway as any,
    prisma as any,
    redis as any,
    personalityService as any,
    contextService as any,
    actionsService as any,
    sessionService,
    promptContextService,
    toolLoopService,
    actionDetectionService,
    legacyInsightService,
    providerSelectionService,
    structuredOutputService,
    moodDetectionService,
    suggestionService,
    genomeContextService,
    systemPromptService,
    interactionService,
    commandExecutionService,
    queryPipeline,
    new AdaptiveRouterService(),
  );
}

const baseQuery: CortexQuery = {
  text: 'What should I focus on this week?',
  businessId: 'biz-1',
  userId: 'user-1',
};

const baseFlags = { integrationV2Enabled: false, genomeV3Enabled: false };

describe('RR-CORTEX-TYPED-RESULT: typed structured output & honest confidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('KeyCortexStructuredOutputService.parseStructuredResponse', () => {
    const parser = new KeyCortexStructuredOutputService();

    it('returns state "unstructured" and confidence null for plain text with no sections', () => {
      const parsed = parser.parseStructuredResponse(PLAIN_ANSWER) as any;

      expect(parsed.state).toBe('unstructured');
      expect(parsed.confidence).toBeNull();
      expect(parsed.recommendation).toBe(PLAIN_ANSWER);
    });

    it('returns state "unstructured" and confidence null for bold text with no recognized sections', () => {
      const text = 'Plain answer with **bold emphasis** and no sections';
      const parsed = parser.parseStructuredResponse(text) as any;

      expect(parsed.state).toBe('unstructured');
      expect(parsed.confidence).toBeNull();
      expect(parsed.recommendation).toBe(text);
    });

    it('returns state "sections" and confidence null when sections exist but Confidence is absent', () => {
      const parsed = parser.parseStructuredResponse(
        SECTIONS_NO_CONFIDENCE,
      ) as any;

      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBeNull();
      expect(parsed.role).toBe('CFO');
      expect(parsed.recommendation).toBe('Focus on retention.');
    });

    it('returns state "sections" and confidence null when Confidence section has no number', () => {
      const parsed = parser.parseStructuredResponse(
        '**Recommendation**: Focus on retention.\n**Confidence**: Unable to quantify',
      ) as any;

      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBeNull();
    });

    it('returns state "sections" and numeric confidence for **Confidence**\\n85% (positive control)', () => {
      const parsed = parser.parseStructuredResponse(
        SECTIONS_BOLD_CONFIDENCE,
      ) as any;

      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBe(85);
      expect(parsed.recommendation).toBe('Tighten AR collections.');
    });

    it('returns state "sections" and numeric confidence for Confidence: 85 (positive control)', () => {
      const parsed = parser.parseStructuredResponse(
        SECTIONS_COLON_CONFIDENCE,
      ) as any;

      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBe(85);
    });

    it('preserves explicit 0% confidence as 0 rather than null', () => {
      const parsed = parser.parseStructuredResponse(
        '**Recommendation**: Wait for audited numbers.\n**Confidence**: 0%',
      ) as any;

      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBe(0);
    });
  });

  describe('KeyCortexQueryPipelineService.processQuery', () => {
    it('omits metadata.confidence, records parseState "unstructured", calls calculateConfidence, and passes estimated confidenceSource to recordObservation', async () => {
      const { pipeline, modelGateway, sessionService, learningService } =
        createPipelineHarness();
      modelGateway.complete.mockResolvedValue({
        content: PLAIN_ANSWER,
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          totalTokens: 40,
          promptTokens: 25,
          completionTokens: 15,
          estimatedCost: 0.001,
        },
        fallbackUsed: false,
      });

      const calcSpy = vi.spyOn(pipeline as any, 'calculateConfidence');

      const response = await pipeline.processQuery(baseQuery, baseFlags);

      const metadata = response.message.metadata as Record<string, unknown>;
      expect(metadata).toBeDefined();
      expect('confidence' in metadata).toBe(false);
      expect(metadata.confidence).toBeUndefined();
      expect(metadata.parseState).toBe('unstructured');

      expect(calcSpy).toHaveBeenCalledTimes(1);
      const estimated = calcSpy.mock.results[0].value as number;
      expect(estimated).toBe(0.5);

      expect(learningService.recordObservation).toHaveBeenCalledTimes(1);
      expect(learningService.recordObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: estimated,
          confidenceSource: 'estimated',
        }),
      );
      expect(learningService.calibrateConfidence).toHaveBeenCalledWith(
        estimated,
        'biz-1',
        expect.any(Object),
      );

      const savedAssistant = sessionService.saveMessage.mock.calls
        .map(([, msg]: any[]) => msg)
        .find((m: any) => m.role === 'assistant');
      expect(savedAssistant).toBeDefined();
      expect('confidence' in savedAssistant.metadata).toBe(false);
      expect(savedAssistant.metadata.parseState).toBe('unstructured');
    });

    it('omits metadata.confidence and uses estimated confidence when sections exist without Confidence', async () => {
      const { pipeline, modelGateway, learningService } =
        createPipelineHarness();
      modelGateway.complete.mockResolvedValue({
        content: SECTIONS_NO_CONFIDENCE,
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          totalTokens: 50,
          promptTokens: 30,
          completionTokens: 20,
          estimatedCost: 0.001,
        },
        fallbackUsed: false,
      });

      const calcSpy = vi.spyOn(pipeline as any, 'calculateConfidence');

      const response = await pipeline.processQuery(baseQuery, baseFlags);

      const metadata = response.message.metadata as Record<string, unknown>;
      expect('confidence' in metadata).toBe(false);
      expect(metadata.parseState).toBe('sections');
      expect(calcSpy).toHaveBeenCalledTimes(1);
      const estimated = calcSpy.mock.results[0].value as number;
      expect(learningService.recordObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: estimated,
          confidenceSource: 'estimated',
        }),
      );
    });

    it('stores metadata.confidence 0.85, parseState "sections", and passes stated confidenceSource when Confidence: 85 is present (negative control)', async () => {
      const { pipeline, modelGateway, learningService } =
        createPipelineHarness();
      modelGateway.complete.mockResolvedValue({
        content: SECTIONS_COLON_CONFIDENCE,
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          totalTokens: 60,
          promptTokens: 30,
          completionTokens: 30,
          estimatedCost: 0.002,
        },
        fallbackUsed: false,
      });

      const calcSpy = vi.spyOn(pipeline as any, 'calculateConfidence');

      const response = await pipeline.processQuery(baseQuery, baseFlags);

      const metadata = response.message.metadata as Record<string, unknown>;
      expect(metadata.confidence).toBe(0.85);
      expect(metadata.parseState).toBe('sections');
      expect(calcSpy).not.toHaveBeenCalled();

      expect(learningService.recordObservation).toHaveBeenCalledTimes(1);
      expect(learningService.recordObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: 0.85,
          confidenceSource: 'stated',
        }),
      );
      expect(learningService.calibrateConfidence).toHaveBeenCalledWith(
        0.85,
        'biz-1',
        expect.any(Object),
      );
    });
  });

  describe('KeyCortexQueryPipelineService.streamQuery', () => {
    it('mirrors processQuery for unstructured stream output (no metadata.confidence, parseState "unstructured", calculateConfidence + estimated observation)', async () => {
      const { pipeline, modelGateway, sessionService, learningService } =
        createPipelineHarness();
      modelGateway.streamComplete.mockImplementation(async function* () {
        yield {
          type: 'content_delta',
          content: PLAIN_ANSWER,
          provider: 'openai',
          model: 'gpt-4o',
        };
        yield { type: 'done', provider: 'openai', model: 'gpt-4o' };
      });

      const calcSpy = vi.spyOn(pipeline as any, 'calculateConfidence');

      for await (const _chunk of pipeline.streamQuery(baseQuery, baseFlags)) {
        void _chunk;
      }

      const savedAssistant = sessionService.saveMessage.mock.calls
        .map(([, msg]: any[]) => msg)
        .find((m: any) => m.role === 'assistant');
      expect(savedAssistant).toBeDefined();
      expect('confidence' in savedAssistant.metadata).toBe(false);
      expect(savedAssistant.metadata.confidence).toBeUndefined();
      expect(savedAssistant.metadata.parseState).toBe('unstructured');

      expect(calcSpy).toHaveBeenCalledTimes(1);
      const estimated = calcSpy.mock.results[0].value as number;
      expect(estimated).toBe(0.5);

      expect(learningService.recordObservation).toHaveBeenCalledTimes(1);
      expect(learningService.recordObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: estimated,
          confidenceSource: 'estimated',
        }),
      );
    });

    it('mirrors processQuery for structured stream output with Confidence: 85 (0.85, parseState "sections", stated observation)', async () => {
      const { pipeline, modelGateway, sessionService, learningService } =
        createPipelineHarness();
      modelGateway.streamComplete.mockImplementation(async function* () {
        yield {
          type: 'content_delta',
          content: SECTIONS_COLON_CONFIDENCE,
          provider: 'openai',
          model: 'gpt-4o',
        };
        yield { type: 'done', provider: 'openai', model: 'gpt-4o' };
      });

      const calcSpy = vi.spyOn(pipeline as any, 'calculateConfidence');

      for await (const _chunk of pipeline.streamQuery(baseQuery, baseFlags)) {
        void _chunk;
      }

      const savedAssistant = sessionService.saveMessage.mock.calls
        .map(([, msg]: any[]) => msg)
        .find((m: any) => m.role === 'assistant');
      expect(savedAssistant).toBeDefined();
      expect(savedAssistant.metadata.confidence).toBe(0.85);
      expect(savedAssistant.metadata.parseState).toBe('sections');
      expect(calcSpy).not.toHaveBeenCalled();

      expect(learningService.recordObservation).toHaveBeenCalledTimes(1);
      expect(learningService.recordObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: 0.85,
          confidenceSource: 'stated',
        }),
      );
    });
  });

  describe('KeyCortexReasoningService.parseStructuredResponse delegation', () => {
    it('delegates to KeyCortexStructuredOutputService and returns the exact same result for both structured and unstructured inputs', () => {
      const structuredOutputService = new KeyCortexStructuredOutputService();
      const reasoningService = createReasoningService(structuredOutputService);
      const parseSpy = vi.spyOn(
        structuredOutputService,
        'parseStructuredResponse',
      );

      for (const sample of [
        PLAIN_ANSWER,
        SECTIONS_NO_CONFIDENCE,
        SECTIONS_BOLD_CONFIDENCE,
        SECTIONS_COLON_CONFIDENCE,
      ]) {
        parseSpy.mockClear();
        const actual = reasoningService.parseStructuredResponse(sample);
        expect(parseSpy).toHaveBeenCalledTimes(1);
        expect(parseSpy).toHaveBeenCalledWith(sample);
        const expected = structuredOutputService.parseStructuredResponse(sample);
        expect(actual).toEqual(expected);
      }
    });
  });

  describe('KeyCortexLearningService.recordObservation confidenceSource persistence', () => {
    it('persists confidenceSource into cognitionMemory metadata when provided', async () => {
      const createMock = vi.fn().mockResolvedValue({ id: 'cm_1' });
      const learning = new KeyCortexLearningService({
        client: { cognitionMemory: { create: createMock } },
      } as any);

      await learning.recordObservation({
        sessionId: 'sess-1',
        businessId: 'biz-1',
        query: 'How is cash flow?',
        recommendation: PLAIN_ANSWER,
        confidence: 0.5,
        confidenceSource: 'estimated',
        metadata: { parseState: 'unstructured' },
      } as any);

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            confidence: 0.5,
            metadata: expect.objectContaining({
              parseState: 'unstructured',
              confidenceSource: 'estimated',
            }),
          }),
        }),
      );
    });
  });
});
