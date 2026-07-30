import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexReasoningService } from '../key-cortex-reasoning.service';
import { AdaptiveRouterService } from '../adaptive-router.service';
import { KeyCortexSessionService } from '../key-cortex-session.service';
import { KeyCortexPromptContextService } from '../key-cortex-prompt-context.service';
import { KeyCortexToolLoopService } from '../key-cortex-tool-loop.service';
import { KeyCortexActionDetectionService } from '../key-cortex-action-detection.service';
import { KeyCortexLegacyInsightService } from '../key-cortex-legacy-insight.service';
import { KeyCortexProviderSelectionService } from '../key-cortex-provider-selection.service';
import { KeyCortexStructuredOutputService } from '../key-cortex-structured-output.service';
import { KeyCortexMoodDetectionService } from '../key-cortex-mood-detection.service';
import { KeyCortexSuggestionService } from '../key-cortex-suggestion.service';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
import { KeyCortexSystemPromptService } from '../key-cortex-system-prompt.service';
import { KeyCortexInteractionService } from '../key-cortex-interaction.service';
import { KeyCortexCommandExecutionService } from '../key-cortex-command-execution.service';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';

const mockPrisma = {
  client: {
    cortexSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiMemory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
};

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  setJson: vi.fn(),
  getJson: vi.fn(),
};

const mockModelGateway = {
  complete: vi.fn(),
  streamComplete: vi.fn(),
  getProviderHealth: vi.fn(),
};

const mockPersonalityService = {
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

const mockContextService = {
  buildContextSnapshot: vi.fn().mockResolvedValue({
    businessId: 'biz-1',
    genomeStage: 'startup',
    executiveReadiness: 50,
  }),
  formatContextForPrompt: vi.fn().mockReturnValue('Context summary'),
};

const mockActionsService = {
  buildToolDefinitions: vi.fn().mockResolvedValue([]),
  executeActions: vi.fn().mockResolvedValue([]),
};

const sessionService = new KeyCortexSessionService(
  mockPrisma as any,
  mockRedis as any,
);
const promptContextService = new KeyCortexPromptContextService(
  mockContextService as any,
);
const structuredOutputService = new KeyCortexStructuredOutputService();
const moodDetectionService = new KeyCortexMoodDetectionService();
const actionDetectionService = new KeyCortexActionDetectionService();
const providerSelectionService = new KeyCortexProviderSelectionService();
const systemPromptService = new KeyCortexSystemPromptService(
  mockPersonalityService as any,
);
const genomeContextService = new KeyCortexGenomeContextService(mockRedis as any);
const suggestionService = new KeyCortexSuggestionService(
  mockModelGateway as any,
  mockContextService as any,
);
const legacyInsightService = new KeyCortexLegacyInsightService(
  mockModelGateway as any,
  mockPrisma as any,
  mockContextService as any,
);
const toolLoopService = new KeyCortexToolLoopService(
  mockModelGateway as any,
  mockPrisma as any,
);
const interactionService = new KeyCortexInteractionService(
  mockModelGateway as any,
  mockPrisma as any,
  mockRedis as any,
  genomeContextService,
);
const commandExecutionService = new KeyCortexCommandExecutionService(
  mockPrisma as any,
);
const queryPipeline = new KeyCortexQueryPipelineService(
  mockModelGateway as any,
  mockPrisma as any,
  mockRedis as any,
  mockPersonalityService as any,
  mockContextService as any,
  mockActionsService as any,
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

function createService(): KeyCortexReasoningService {
  return new KeyCortexReasoningService(
    mockModelGateway as any,
    mockPrisma as any,
    mockRedis as any,
    mockPersonalityService as any,
    mockContextService as any,
    mockActionsService as any,
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
  );
}

function createServiceWithRouter(): KeyCortexReasoningService {
  return new KeyCortexReasoningService(
    mockModelGateway as any,
    mockPrisma as any,
    mockRedis as any,
    mockPersonalityService as any,
    mockContextService as any,
    mockActionsService as any,
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

describe('KeyCortexReasoningService — construction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('constructs with delegate services', () => {
    const service = createService();
    expect(service).toBeDefined();
    expect((service as any).queryPipeline).toBe(queryPipeline);
  });

  it('adaptiveRouter is injected', () => {
    const service = createServiceWithRouter();
    expect((service as any).adaptiveRouter).toBeInstanceOf(AdaptiveRouterService);
  });
});

describe('KeyCortexReasoningService — public API delegation', () => {
  let service: KeyCortexReasoningService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = createService();
  });

  it('detectActions delegates to action detection service', async () => {
    const actions = await service.detectActions(
      '[[ACTION:CREATE_TASK]]Follow up[[/ACTION]]',
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe('CREATE_TASK');
  });

  it('detectMood delegates to mood detection service', () => {
    expect(service.detectMood('URGENT: system is down')).toBe('urgent');
    expect(service.detectMood('hello')).toBe('casual');
  });

  it('selectProvider delegates to provider selection service', async () => {
    const result = await service.selectProvider(
      { text: 'Hello', businessId: 'b', userId: 'u' } as any,
      {} as any,
    );
    expect(result.provider).toBeDefined();
    expect(result.model).toBeDefined();
  });
});
