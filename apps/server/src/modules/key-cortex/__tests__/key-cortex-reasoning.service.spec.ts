import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexReasoningService } from '../key-cortex-reasoning.service';
import { AdaptiveRouterService } from '../adaptive-router.service';

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

function createService(): KeyCortexReasoningService {
  return new KeyCortexReasoningService(
    mockModelGateway as any,
    mockPrisma as any,
    mockRedis as any,
    mockPersonalityService as any,
    mockContextService as any,
    mockActionsService as any,
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
    new AdaptiveRouterService(),
  );
}

describe('KeyCortexReasoningService — KEY 10/10 helpers', () => {
  let service: KeyCortexReasoningService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = createService();
  });

  describe('classifyTaskCategory', () => {
    it('classifies reasoning queries', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'Should I cut prices to increase market share?',
      } as any);
      expect(category).toBe('reasoning');
    });

    it('classifies emotion-analysis queries', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'My team seems stressed and burned out.',
      } as any);
      expect(category).toBe('emotion-analysis');
    });

    it('classifies creative queries', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'Brainstorm marketing campaign ideas for Q3.',
      } as any);
      expect(category).toBe('creative');
    });

    it('classifies code queries', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'Write a TypeScript function to calculate churn rate.',
      } as any);
      expect(category).toBe('code');
    });

    it('classifies forecasting queries', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'Forecast my revenue for next quarter.',
      } as any);
      expect(category).toBe('forecasting');
    });

    it('classifies action/tool-calling queries when actions enabled', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'Create a task to follow up with the client.',
        enableActions: true,
      } as any);
      expect(category).toBe('tool-calling');
    });

    it('defaults to general for simple queries', () => {
      const category = (service as any).classifyTaskCategory({
        businessId: 'biz-1',
        userId: 'user-1',
        text: 'Hello, how are you?',
      } as any);
      expect(category).toBe('general');
    });
  });

  describe('parseStructuredResponse', () => {
    it('extracts all sections from a well-formatted response', () => {
      const content = `
**Role Mode**: CFO

**Analysis**: Cash flow is tight because receivables are delayed.

**Hidden Signals**:
- Two major clients are 15 days overdue
- Expenses rose 12% last month

**Recommendation**: Call the overdue clients today and defer non-critical spend.

**Risk Check**: Clients may push back on payment terms.

**Success Metrics**:
- Days Sales Outstanding under 30
- Cash runway above 3 months

**Next Step**: Schedule client calls this afternoon.

**Confidence**: 85% — strong data, but client response uncertain.
      `.trim();

      const parsed = (service as any).parseStructuredResponse(content);

      expect(parsed.role).toBe('CFO');
      expect(parsed.analysis).toContain('Cash flow is tight');
      expect(parsed.hiddenSignals).toHaveLength(2);
      expect(parsed.recommendation).toContain('Call the overdue clients today');
      expect(parsed.risks).toHaveLength(1);
      expect(parsed.successMetrics).toHaveLength(2);
      expect(parsed.nextStep).toContain('Schedule client calls');
      expect(parsed.confidence).toBe(85);
    });

    it('falls back gracefully for unformatted content', () => {
      const content = 'Here is a simple recommendation without sections.';
      const parsed = (service as any).parseStructuredResponse(content);

      expect(parsed.recommendation).toBe(content);
      expect(parsed.confidence).toBe(70);
      expect(parsed.hiddenSignals).toHaveLength(0);
    });

    it('returns default values for empty content', () => {
      const parsed = (service as any).parseStructuredResponse('');
      expect(parsed.recommendation).toBe('');
      expect(parsed.confidence).toBe(70);
    });

    it('clips confidence to 100', () => {
      const parsed = (service as any).parseStructuredResponse('**Confidence**: 150%');
      expect(parsed.confidence).toBe(100);
    });
  });
});

describe('KeyCortexReasoningService — Phase C adaptive + memory wiring', () => {
  let service: KeyCortexReasoningService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = createServiceWithRouter();
  });

  describe('buildMessages', () => {
    it('includes system prompt, context, user query', () => {
      const messages = (service as any).buildMessages(
        { text: 'Hello', businessId: 'biz_1', userId: 'user_1' } as any,
        { businessId: 'biz_1', genomeStage: 'startup', executiveReadiness: 50 } as any,
        'You are KEY.',
      );

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('You are KEY.');
      expect(messages[messages.length - 1].role).toBe('user');
      expect(messages[messages.length - 1].content).toBe('Hello');
    });

    it('includes running summary and recent messages when session provided', () => {
      const session = {
        id: 'sess_1',
        businessId: 'biz_1',
        userId: 'user_1',
        messages: [
          { role: 'user', content: 'Prior message 1' },
          { role: 'assistant', content: 'Prior answer 1' },
        ],
        runningSummary: 'User is asking about revenue.',
      } as any;

      const messages = (service as any).buildMessages(
        { text: 'What about next month?', businessId: 'biz_1', userId: 'user_1' } as any,
        { businessId: 'biz_1', genomeStage: 'startup', executiveReadiness: 50 } as any,
        'You are KEY.',
        session,
      );

      const summaryMsg = messages.find((m: any) => m.content?.includes('CONVERSATION SUMMARY'));
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg?.content).toContain('User is asking about revenue.');

      const recentUser = messages.find((m: any) => m.content === 'Prior message 1');
      const recentAssistant = messages.find((m: any) => m.content === 'Prior answer 1');
      expect(recentUser).toBeDefined();
      expect(recentAssistant).toBeDefined();
    });

    it('includes aiMemory and semanticMemory context when provided', () => {
      const messages = (service as any).buildMessages(
        { text: 'Hello', businessId: 'biz_1', userId: 'user_1' } as any,
        { businessId: 'biz_1', genomeStage: 'startup', executiveReadiness: 50 } as any,
        'You are KEY.',
        undefined,
        {
          aiMemory: 'USER PREFERENCES: concise, formal',
          semanticMemory: 'RELEVANT PAST: previous revenue discussion',
        },
      );

      expect(messages.some((m: any) => m.content.includes('USER PREFERENCES'))).toBe(true);
      expect(messages.some((m: any) => m.content.includes('RELEVANT PAST'))).toBe(true);
    });
  });

  describe('generateRunningSummary', () => {
    it('creates a summary from a single turn', () => {
      const summary = (service as any).generateRunningSummary(
        '',
        'What is our revenue this month?',
        'Revenue is $50k, up 10% from last month.',
      );
      expect(summary).toContain('revenue');
      expect(summary).toContain('Latest turn');
    });

    it('appends to an existing summary', () => {
      const summary = (service as any).generateRunningSummary(
        'User asked about revenue.',
        'What about expenses?',
        'Expenses are $30k.',
      );
      expect(summary).toContain('User asked about revenue.');
      expect(summary).toContain('expenses');
    });

    it('caps summary length at 800 characters', () => {
      const longSummary = 'a'.repeat(900);
      const summary = (service as any).generateRunningSummary(
        longSummary,
        'Hello',
        'Hi',
      );
      expect(summary.length).toBeLessThanOrEqual(800);
    });
  });

  describe('adaptive router integration', () => {
    it('adaptiveRouter is injected', () => {
      expect((service as any).adaptiveRouter).toBeInstanceOf(AdaptiveRouterService);
    });
  });
});
