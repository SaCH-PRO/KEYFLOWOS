/**
 * KEY Cortex Quality Evaluation Harness — Phase E
 *
 * Runs a small representative query set through processQuery and checks:
 * - Response structure and content presence
 * - Confidence calibration (0..1)
 * - Latency targets by complexity
 * - No crash on edge-case wording
 *
 * In production, expand this to 50–100 real business queries and use
 * human/LLM-as-judge scoring for accuracy, actionability, and tone.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexReasoningService } from '../key-cortex-reasoning.service';
import { AdaptiveRouterService } from '../adaptive-router.service';

const baseContextSnapshot = {
  businessId: 'biz-1',
  genomeDna: { execution: 60, strategy: 55, finance: 50, marketing: 65, operations: 60 },
  genomeStage: 'growth',
  executiveReadiness: 60,
  recentTasks: [],
  recentEvents: [],
  keyMetrics: {},
  activeProjects: [],
  pendingInvoices: 2,
  unreadMessages: 0,
  teamStatus: '',
  timestamp: new Date(),
};

const baseSession = {
  id: 'sess-eval',
  businessId: 'biz-1',
  userId: 'user-1',
  status: 'active',
  persona: 'jarvis',
  voice: 'echo',
  mood: 'focused',
  preferredProvider: 'openai',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
};

function createMocks() {
  return {
    prisma: {
      client: {
        cortexSession: {
          findUnique: vi.fn().mockResolvedValue(baseSession),
          findFirst: vi.fn().mockResolvedValue(baseSession),
          create: vi.fn().mockResolvedValue(baseSession),
          update: vi.fn().mockResolvedValue(baseSession),
        },
        aiMemory: { findUnique: vi.fn(), upsert: vi.fn() },
        cognitionMemory: {
          create: vi.fn().mockResolvedValue({ id: 'cm_1' }),
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
      },
    },
    redis: {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn().mockResolvedValue(undefined),
      getJson: vi.fn().mockResolvedValue(null),
    },
    modelGateway: {
      complete: vi.fn().mockResolvedValue({
        content: `**Role Mode**: CEO
**Analysis**: The business is in a growth stage with moderate readiness.
**Recommendation**: Focus on customer retention and operational efficiency.
**Risk Check**: Cash flow may tighten if receivables are delayed.
**Success Metrics**: Reduce churn by 5%, improve collection time.
**Next Step**: Review overdue invoices and follow up with top customers.
**Confidence**: 75%`,
        provider: 'openai',
        model: 'gpt-4o',
        usage: { totalTokens: 120, promptTokens: 70, completionTokens: 50, estimatedCost: 0.003 },
        fallbackUsed: false,
      }),
      streamComplete: vi.fn().mockImplementation(async function* () {
        yield { content: 'Focus on retention.' };
      }),
    },
    personalityService: {
      getPersonalityConfig: vi.fn().mockReturnValue({ persona: 'jarvis', temperature: 0.7 }),
      buildSystemPrompt: vi.fn().mockReturnValue('You are KEY.'),
      getRoleSystemPrompt: vi.fn().mockReturnValue(''),
    },
    contextService: {
      buildContextSnapshot: vi.fn().mockResolvedValue(baseContextSnapshot),
      formatContextForPrompt: vi.fn().mockReturnValue('Context summary'),
    },
    actionsService: {
      buildToolDefinitions: vi.fn().mockResolvedValue([]),
      executeActions: vi.fn().mockResolvedValue([]),
    },
  };
}

function createEvalService(mocks: ReturnType<typeof createMocks>) {
  return new KeyCortexReasoningService(
    mocks.modelGateway as any,
    mocks.prisma as any,
    mocks.redis as any,
    mocks.personalityService as any,
    mocks.contextService as any,
    mocks.actionsService as any,
    new AdaptiveRouterService(),
  );
}

describe('KEY Cortex Quality Evaluation Harness', () => {
  const queries = [
    { text: 'What should I focus on this week?', complexity: 'simple', targetMs: 1000 },
    { text: 'How can I improve cash flow and reduce overdue invoices?', complexity: 'moderate', targetMs: 2000 },
    { text: 'Create a 90-day growth plan considering my team capacity, customer churn, and current pipeline.', complexity: 'complex', targetMs: 4000 },
    { text: 'My best employee just resigned. What should I do?', complexity: 'moderate', targetMs: 2000 },
    { text: 'Write a follow-up email to a client who has not paid their invoice.', complexity: 'simple', targetMs: 1000 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(queries)(
    'processQuery handles "$text" within $targetMs ms with valid structure',
    async ({ text, targetMs }) => {
      const mocks = createMocks();
      const service = createEvalService(mocks);
      const start = Date.now();

      const response = await service.processQuery({
        text,
        businessId: 'biz-1',
        userId: 'user-1',
      } as any);

      const elapsed = Date.now() - start;

      expect(response.message).toBeDefined();
      expect(response.message.role).toBe('assistant');
      expect(response.message.content.length).toBeGreaterThan(10);
      expect(response.confidence).toBeGreaterThanOrEqual(0);
      expect(response.confidence).toBeLessThanOrEqual(1);
      expect(elapsed).toBeLessThan(targetMs);
    },
  );

  it('produces actionable recommendations for cashflow queries', async () => {
    const mocks = createMocks();
    const service = createEvalService(mocks);

    const response = await service.processQuery({
      text: 'How do I collect overdue invoices faster?',
      businessId: 'biz-1',
      userId: 'user-1',
    } as any);

    expect(response.message.content.length).toBeGreaterThan(20);
    expect(response.nextStep?.length ?? 0).toBeGreaterThan(0);
  });
});
