import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AI_CREDIT_COSTS } from '../subscriptions/plans';

/**
 * R0-07a: the OpenAI SDK the direct helpers (trackEmbedding, trackVision,
 * trackAudio) construct. The REAL constructor runs, so a missing key is refused
 * exactly as in production; only the resource methods a helper calls are
 * stubs, so no request can leave the process. `attempts` records every
 * `new OpenAI(options)` before the real constructor runs; `clients` records the
 * key and base URL of every client it accepted.
 */
const sdk = vi.hoisted(() => ({
  attempts: [] as Array<{ apiKey?: string; baseURL?: string }>,
  clients: [] as Array<{ apiKey: string; baseURL: string }>,
  embeddingsCreate: vi.fn(),
  chatCreate: vi.fn(),
  speechCreate: vi.fn(),
  transcriptionsCreate: vi.fn(),
}));

vi.mock('openai', async (importOriginal) => {
  const actual: any = await importOriginal();
  const RealOpenAI = actual.default;
  class RecordingOpenAI extends RealOpenAI {
    constructor(options: any = {}) {
      sdk.attempts.push({ apiKey: options.apiKey, baseURL: options.baseURL });
      super(options);
      const self = this as any;
      sdk.clients.push({ apiKey: self.apiKey, baseURL: self.baseURL });
      self.embeddings = { create: (...args: any[]) => sdk.embeddingsCreate(...args) };
      self.chat = { completions: { create: (...args: any[]) => sdk.chatCreate(...args) } };
      self.audio = {
        speech: { create: (...args: any[]) => sdk.speechCreate(...args) },
        transcriptions: { create: (...args: any[]) => sdk.transcriptionsCreate(...args) },
      };
    }
  }
  return { ...actual, default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

const mockPrismaClient = {
  aiUsageLog: {
    create: vi.fn().mockResolvedValue({}),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
};

const mockSubscriptionsService = {
  getActiveSubscription: vi.fn(),
};

const mockOutputTemplateService = {
  resolveTemplate: vi.fn(),
};

const mockGateway = {
  complete: vi.fn(),
  getBudgetStatus: vi.fn(),
};

function createService(): AiUsageService {
  return new AiUsageService(
    mockPrisma as any,
    mockSubscriptionsService as any,
    mockOutputTemplateService as any,
    mockGateway as any,
  );
}

function mockFreePlan(creditsLimit = 50) {
  mockSubscriptionsService.getActiveSubscription.mockResolvedValue({
    plan: 'FREE',
    status: 'ACTIVE',
    limits: { aiCreditsPerMonth: creditsLimit },
    subscription: null,
  });
}

function mockUnlimitedPlan() {
  mockSubscriptionsService.getActiveSubscription.mockResolvedValue({
    plan: 'KEYFLOW',
    status: 'ACTIVE',
    limits: { aiCreditsPerMonth: -1 },
    subscription: { currency: 'TTD', priceMonthly: 500 },
  });
}

function mockGatewaySuccess(content = 'AI response content that is long enough to pass validation checks for general category output.') {
  const longContent = content.length < 100
    ? content + ' '.repeat(100 - content.length) + 'padding text to meet minimum length.'
    : content;
  mockGateway.complete.mockResolvedValue({
    content: longContent,
    provider: 'openai',
    model: 'gpt-4o-mini',
    usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, estimatedCost: 0.001 },
    latencyMs: 250,
    fallbackUsed: false,
    fallbackProvider: undefined,
  });
}

describe('AiUsageService', () => {
  let service: AiUsageService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockPrismaClient.aiUsageLog.create.mockResolvedValue({});
    mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 0, estimatedCost: 0 } });
    mockPrismaClient.aiUsageLog.groupBy.mockResolvedValue([]);
    mockPrismaClient.aiUsageLog.findMany.mockResolvedValue([]);
    mockPrismaClient.aiUsageLog.count.mockResolvedValue(0);
    mockOutputTemplateService.resolveTemplate.mockResolvedValue({
      category: 'general',
      tone: 'professional',
      formality: 'medium',
      targetLength: 'medium',
      requiredSections: [],
      customInstructions: null,
    });
    service = createService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  describe('Rate limiting', () => {
    it('allows calls under the 120/minute limit', () => {
      for (let i = 0; i < 119; i++) {
        expect(() => service.checkRateLimit('biz-1')).not.toThrow();
      }
    });

    it('throws 429 when 120 calls/minute exceeded', () => {
      for (let i = 0; i < 120; i++) {
        service.checkRateLimit('biz-1');
      }

      try {
        service.checkRateLimit('biz-1');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        const response = (err as HttpException).getResponse();
        expect((response as any).statusCode).toBe(429);
        expect((response as any).code).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('tracks rate limits per business independently', () => {
      for (let i = 0; i < 120; i++) {
        service.checkRateLimit('biz-1');
      }

      expect(() => service.checkRateLimit('biz-2')).not.toThrow();
    });

    it('resets rate limit after 60 seconds elapse', () => {
      for (let i = 0; i < 120; i++) {
        service.checkRateLimit('biz-1');
      }

      expect(() => service.checkRateLimit('biz-1')).toThrow();

      vi.advanceTimersByTime(60_001);

      expect(() => service.checkRateLimit('biz-1')).not.toThrow();
    });

    it('cleanup timer removes stale entries', () => {
      service.checkRateLimit('biz-stale');

      vi.advanceTimersByTime(60_001);
      vi.advanceTimersByTime(60_000);

      const rateLimitMap = (service as any).rateLimitMap as Map<string, number[]>;
      expect(rateLimitMap.has('biz-stale')).toBe(false);
    });

    it('cleanup timer keeps active entries', () => {
      service.checkRateLimit('biz-active');

      vi.advanceTimersByTime(30_000);

      service.checkRateLimit('biz-active');

      vi.advanceTimersByTime(60_000);

      const rateLimitMap = (service as any).rateLimitMap as Map<string, number[]>;
      expect(rateLimitMap.has('biz-active')).toBe(true);
      expect(rateLimitMap.get('biz-active')!.length).toBe(1);
    });

    it('onModuleDestroy clears the cleanup timer', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalledOnce();
    });
  });

  describe('Credit checking', () => {
    it('allows when credits remaining exceed needed amount', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 10 } });

      const result = await service.checkCredits('biz-1', 5);

      expect(result.allowed).toBe(true);
      expect(result.used).toBe(10);
      expect(result.limit).toBe(50);
      expect(result.remaining).toBe(40);
      expect(result.isUnlimited).toBe(false);
    });

    it('denies when credits used equals the limit', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 50 } });

      const result = await service.checkCredits('biz-1', 1);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('denies when credits remaining less than needed', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 48 } });

      const result = await service.checkCredits('biz-1', 3);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(2);
    });

    it('always allows unlimited plans', async () => {
      mockUnlimitedPlan();

      const result = await service.checkCredits('biz-1', 100);

      expect(result.allowed).toBe(true);
      expect(result.isUnlimited).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(-1);
    });

    it('queries only current month usage', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 0 } });

      await service.checkCredits('biz-1');

      const call = mockPrismaClient.aiUsageLog.aggregate.mock.calls[0][0];
      expect(call.where.businessId).toBe('biz-1');
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
      const gte = call.where.createdAt.gte as Date;
      expect(gte.getDate()).toBe(1);
      expect(gte.getHours()).toBe(0);
    });

    it('defaults creditsNeeded to 1', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 49 } });

      const result = await service.checkCredits('biz-1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('handles null aggregate (no usage rows)', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: null } });

      const result = await service.checkCredits('biz-1');

      expect(result.used).toBe(0);
      expect(result.remaining).toBe(50);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Feature-to-task-category mapping', () => {
    it('maps flow_chat to tool-calling', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('flow_chat')).toBe('tool-calling');
    });

    it('maps plan_decompose to reasoning', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('plan_decompose')).toBe('reasoning');
    });

    it('maps intent_parse to classification', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('intent_parse')).toBe('classification');
    });

    it('maps briefing to summarization', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('briefing')).toBe('summarization');
    });

    it('maps seo_score to extraction', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('seo_score')).toBe('extraction');
    });

    it('maps campaign_content to content-generation', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('campaign_content')).toBe('content-generation');
    });

    it('maps chat to general', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('chat')).toBe('general');
    });

    it('defaults unknown features to general', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('unknown_feature')).toBe('general');
    });

    it('prefers explicit taskCategory over feature mapping', () => {
      const resolve = (service as any).resolveTaskCategory.bind(service);
      expect(resolve('chat', 'reasoning')).toBe('reasoning');
    });
  });

  describe('callAi - usage logging', () => {
    beforeEach(() => {
      mockFreePlan(100);
      mockGatewaySuccess();
    });

    it('persists usage log with correct fields', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockPrismaClient.aiUsageLog.create).toHaveBeenCalledOnce();
      const data = mockPrismaClient.aiUsageLog.create.mock.calls[0][0].data;
      expect(data.businessId).toBe('biz-1');
      expect(data.feature).toBe('chat');
      expect(data.model).toBe('gpt-4o-mini');
      expect(data.provider).toBe('openai');
      expect(data.promptTokens).toBe(50);
      expect(data.completionTokens).toBe(100);
      expect(data.totalTokens).toBe(150);
      expect(data.creditsUsed).toBe(AI_CREDIT_COSTS['chat']);
      expect(data.latencyMs).toBe(250);
      expect(data.fallbackUsed).toBe(false);
      expect(data.taskCategory).toBe('general');
      expect(data.metadata).toEqual({
        maxTokens: 500,
        temperature: 0.7,
        outputCategory: 'general',
      });
    });

    it('uses correct credit cost from AI_CREDIT_COSTS for known features', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'briefing',
        messages: [{ role: 'user', content: 'Brief me' }],
      });

      const data = mockPrismaClient.aiUsageLog.create.mock.calls[0][0].data;
      expect(data.creditsUsed).toBe(2);
    });

    it('defaults to 1 credit for unknown features', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'unknown_feature',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const data = mockPrismaClient.aiUsageLog.create.mock.calls[0][0].data;
      expect(data.creditsUsed).toBe(1);
    });

    it('rounds estimatedCost to 4 decimal places', async () => {
      mockGateway.complete.mockResolvedValue({
        content: 'x'.repeat(150),
        provider: 'openai',
        model: 'gpt-4o',
        usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, estimatedCost: 0.00123456789 },
        latencyMs: 200,
        fallbackUsed: false,
      });

      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const data = mockPrismaClient.aiUsageLog.create.mock.calls[0][0].data;
      expect(data.estimatedCost).toBe(0.0012);
    });

    it('returns correct AiCallResult shape', async () => {
      const result = await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('provider', 'openai');
      expect(result).toHaveProperty('model', 'gpt-4o-mini');
      expect(result.usage).toEqual({
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
        creditsUsed: 1,
        estimatedCost: 0.001,
      });
    });
  });

  describe('callAi - credit enforcement', () => {
    it('throws ForbiddenException when credits exhausted', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 50 } });

      await expect(
        service.callAi({
          businessId: 'biz-1',
          feature: 'chat',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ForbiddenException message includes usage numbers', async () => {
      mockFreePlan(50);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 50 } });

      try {
        await service.callAi({
          businessId: 'biz-1',
          feature: 'chat',
          messages: [{ role: 'user', content: 'Hello' }],
        });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect((err as ForbiddenException).message).toContain('50/50');
      }
    });

    it('checks rate limit before credit check', async () => {
      for (let i = 0; i < 120; i++) {
        service.checkRateLimit('biz-1');
      }

      try {
        await service.callAi({
          businessId: 'biz-1',
          feature: 'chat',
          messages: [{ role: 'user', content: 'Hello' }],
        });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(429);
      }

      expect(mockSubscriptionsService.getActiveSubscription).not.toHaveBeenCalled();
    });
  });

  describe('callAi - quality directive injection', () => {
    beforeEach(() => {
      mockFreePlan(100);
      mockGatewaySuccess();
    });

    it('injects quality directives for user_text mode (default)', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'Hello' }],
      });

      expect(mockOutputTemplateService.resolveTemplate).toHaveBeenCalledWith('biz-1', 'general');
      const gatewayCall = mockGateway.complete.mock.calls[0][0];
      expect(gatewayCall.messages[0].content).toContain('UNIVERSAL QUALITY STANDARDS');
    });

    it('skips quality directives for structured_json mode', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'intent_parse',
        messages: [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: '{}' }],
        responseMode: 'structured_json',
      });

      expect(mockOutputTemplateService.resolveTemplate).not.toHaveBeenCalled();
    });

    it('skips quality directives for legacy skipQualityDirectives flag', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'intent_parse',
        messages: [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: '{}' }],
        skipQualityDirectives: true,
      });

      expect(mockOutputTemplateService.resolveTemplate).not.toHaveBeenCalled();
    });

    it('adds system message with directives when no system message exists', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const gatewayCall = mockGateway.complete.mock.calls[0][0];
      expect(gatewayCall.messages[0].role).toBe('system');
      expect(gatewayCall.messages[0].content).toContain('UNIVERSAL QUALITY STANDARDS');
      expect(gatewayCall.messages[1].content).toBe('Hello');
    });

    it('gracefully continues when template resolution fails', async () => {
      mockOutputTemplateService.resolveTemplate.mockRejectedValue(new Error('DB error'));

      const result = await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('callAi - retry on validation failure', () => {
    beforeEach(() => {
      mockFreePlan(100);
    });

    it('retries when output validation fails and accumulates tokens', async () => {
      mockGateway.complete
        .mockResolvedValueOnce({
          content: 'short',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60, estimatedCost: 0.001 },
          latencyMs: 200,
          fallbackUsed: false,
        })
        .mockResolvedValueOnce({
          content: 'A'.repeat(150),
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200, estimatedCost: 0.002 },
          latencyMs: 300,
          fallbackUsed: false,
        });

      const result = await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockGateway.complete).toHaveBeenCalledTimes(2);

      expect(result.usage.promptTokens).toBe(130);
      expect(result.usage.completionTokens).toBe(130);
      expect(result.usage.totalTokens).toBe(260);
      expect(result.usage.estimatedCost).toBe(0.003);
    });

    it('includes validation issues in retry message', async () => {
      mockGateway.complete
        .mockResolvedValueOnce({
          content: 'x',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60, estimatedCost: 0.001 },
          latencyMs: 200,
          fallbackUsed: false,
        })
        .mockResolvedValueOnce({
          content: 'B'.repeat(150),
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200, estimatedCost: 0.002 },
          latencyMs: 300,
          fallbackUsed: false,
        });

      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const retryCall = mockGateway.complete.mock.calls[1][0];
      const lastMsg = retryCall.messages[retryCall.messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toContain('quality standards');
    });

    it('does not retry for structured_json mode', async () => {
      mockGateway.complete.mockResolvedValue({
        content: '{"tiny": true}',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60, estimatedCost: 0.001 },
        latencyMs: 200,
        fallbackUsed: false,
      });

      await service.callAi({
        businessId: 'biz-1',
        feature: 'intent_parse',
        messages: [{ role: 'user', content: 'parse this' }],
        responseMode: 'structured_json',
      });

      expect(mockGateway.complete).toHaveBeenCalledTimes(1);
    });

    it('uses first result if retry also fails', async () => {
      mockGateway.complete
        .mockResolvedValueOnce({
          content: 'short',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60, estimatedCost: 0.001 },
          latencyMs: 200,
          fallbackUsed: false,
        })
        .mockRejectedValueOnce(new Error('Retry failed'));

      const result = await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('short');
      expect(result.usage.totalTokens).toBe(60);
    });
  });

  describe('callAi - gateway parameters', () => {
    beforeEach(() => {
      mockFreePlan(100);
      mockGatewaySuccess();
    });

    it('passes maxTokens and temperature from options', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1000,
        temperature: 0.3,
      });

      const call = mockGateway.complete.mock.calls[0][0];
      expect(call.maxTokens).toBe(1000);
      expect(call.temperature).toBe(0.3);
    });

    it('defaults maxTokens to 500 and temperature to 0.7', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const call = mockGateway.complete.mock.calls[0][0];
      expect(call.maxTokens).toBe(500);
      expect(call.temperature).toBe(0.7);
    });

    it('passes modelOverride and providerOverride when model specified', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
      });

      const call = mockGateway.complete.mock.calls[0][0];
      expect(call.modelOverride).toBe('gpt-4o');
      expect(call.providerOverride).toBe('openai');
    });

    it('does not set providerOverride when no model specified', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const call = mockGateway.complete.mock.calls[0][0];
      expect(call.modelOverride).toBeUndefined();
      expect(call.providerOverride).toBeUndefined();
    });

    it('resolves taskCategory from feature map', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'flow_chat',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const call = mockGateway.complete.mock.calls[0][0];
      expect(call.taskCategory).toBe('tool-calling');
    });

    it('uses explicit taskCategory when provided', async () => {
      await service.callAi({
        businessId: 'biz-1',
        feature: 'chat',
        messages: [{ role: 'user', content: 'Hello' }],
        taskCategory: 'summarization',
      });

      const call = mockGateway.complete.mock.calls[0][0];
      expect(call.taskCategory).toBe('summarization');
    });
  });

  describe('callAi - error propagation', () => {
    beforeEach(() => {
      mockFreePlan(100);
    });

    it('re-throws ForbiddenException from credit check', async () => {
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 100 } });

      await expect(
        service.callAi({
          businessId: 'biz-1',
          feature: 'chat',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('re-throws gateway errors', async () => {
      mockGateway.complete.mockRejectedValue(new Error('Gateway timeout'));

      await expect(
        service.callAi({
          businessId: 'biz-1',
          feature: 'chat',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Gateway timeout');
    });
  });

  describe('getUsageSummary', () => {
    it('returns correct summary for limited plan', async () => {
      mockSubscriptionsService.getActiveSubscription.mockResolvedValue({
        plan: 'FLOW',
        status: 'ACTIVE',
        limits: { aiCreditsPerMonth: 100 },
        subscription: { currency: 'TTD', priceMonthly: 200 },
      });
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({
        _sum: { creditsUsed: 60, estimatedCost: 0.05 },
      });
      mockPrismaClient.aiUsageLog.groupBy.mockResolvedValue([
        { feature: 'chat', _sum: { creditsUsed: 40, estimatedCost: 0.03 }, _count: 40 },
        { feature: 'briefing', _sum: { creditsUsed: 20, estimatedCost: 0.02 }, _count: 10 },
      ]);
      mockGateway.getBudgetStatus.mockRejectedValue(new Error('not configured'));

      const summary = await service.getUsageSummary('biz-1');

      expect(summary.currentPlan).toBe('FLOW');
      expect(summary.creditsUsed).toBe(60);
      expect(summary.creditsLimit).toBe(100);
      expect(summary.creditsRemaining).toBe(40);
      expect(summary.isUnlimited).toBe(false);
      expect(summary.overageCredits).toBe(0);
      expect(summary.byFeature).toHaveLength(2);
      expect(summary.periodStart).toBeInstanceOf(Date);
      expect(summary.periodEnd).toBeInstanceOf(Date);
    });

    it('calculates overage costs in TTD', async () => {
      mockSubscriptionsService.getActiveSubscription.mockResolvedValue({
        plan: 'FLOW',
        status: 'ACTIVE',
        limits: { aiCreditsPerMonth: 50 },
        subscription: { currency: 'TTD', priceMonthly: 200 },
      });
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({
        _sum: { creditsUsed: 70, estimatedCost: 0.05 },
      });
      mockPrismaClient.aiUsageLog.groupBy.mockResolvedValue([]);
      mockGateway.getBudgetStatus.mockRejectedValue(new Error('not configured'));

      const summary = await service.getUsageSummary('biz-1');

      expect(summary.overageCredits).toBe(20);
      expect(summary.overageCost).toBe(50);
      expect(summary.overageCurrency).toBe('TTD');
    });

    it('calculates overage costs in USD', async () => {
      mockSubscriptionsService.getActiveSubscription.mockResolvedValue({
        plan: 'FLOW',
        status: 'ACTIVE',
        limits: { aiCreditsPerMonth: 50 },
        subscription: { currency: 'USD', priceMonthly: 30 },
      });
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({
        _sum: { creditsUsed: 60, estimatedCost: 0.05 },
      });
      mockPrismaClient.aiUsageLog.groupBy.mockResolvedValue([]);
      mockGateway.getBudgetStatus.mockRejectedValue(new Error('not configured'));

      const summary = await service.getUsageSummary('biz-1');

      expect(summary.overageCredits).toBe(10);
      expect(summary.overageCost).toBe(3.5);
      expect(summary.overageCurrency).toBe('USD');
    });

    it('reports no overage for unlimited plans', async () => {
      mockUnlimitedPlan();
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({
        _sum: { creditsUsed: 5000, estimatedCost: 10 },
      });
      mockPrismaClient.aiUsageLog.groupBy.mockResolvedValue([]);
      mockGateway.getBudgetStatus.mockRejectedValue(new Error('not configured'));

      const summary = await service.getUsageSummary('biz-1');

      expect(summary.isUnlimited).toBe(true);
      expect(summary.overageCredits).toBe(0);
      expect(summary.overageCost).toBe(0);
      expect(summary.creditsRemaining).toBe(-1);
    });
  });
});

/**
 * R0-07a-AI-DIRECT-503 (COST-LEDGER-001 section 4 and section 7 item 1). The
 * embedding, vision and audio helpers call OpenAI directly, not through the
 * model gateway, so R0-07's structured 503 did not cover them: with no OpenAI
 * key the SDK constructor threw a plain OpenAIError, which a route surfaces as
 * a 500. With neither AI_INTEGRATIONS_OPENAI_API_KEY nor OPENAI_API_KEY set,
 * each helper must refuse with the gateway's 503 shape
 * { code: 'provider_not_configured', service: 'ai' } before it constructs a
 * client, calls the provider, spends a rate-limit slot, checks credits or
 * writes an AiUsageLog row. With a key (SDK stubbed) nothing changes.
 */
describe('AiUsageService direct OpenAI helpers fail visibly when no OpenAI key is configured (R0-07a)', () => {
  const ENV_KEYS = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_BASE_URL', 'OPENAI_BASE_URL'];
  const saved: Record<string, string | undefined> = {};
  let service: AiUsageService;

  /** The structured 503 the model gateway answers when no AI provider is configured (R0-07). */
  async function expectNotConfigured(call: Promise<unknown>) {
    const err: any = await call.then(
      () => { throw new Error('expected the call to be refused'); },
      (e: unknown) => e,
    );
    expect(err, String(err?.stack ?? err)).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'ai', error: 'Service Unavailable' });
    expect(typeof err.getResponse().message).toBe('string');
    expect(err.getResponse().message.length).toBeGreaterThan(0);
  }

  /** Nothing ran: no client, no provider call, no credit check, no usage row. */
  function expectNothingRan() {
    expect(sdk.attempts).toEqual([]);
    expect(sdk.embeddingsCreate).not.toHaveBeenCalled();
    expect(sdk.chatCreate).not.toHaveBeenCalled();
    expect(sdk.speechCreate).not.toHaveBeenCalled();
    expect(sdk.transcriptionsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsService.getActiveSubscription).not.toHaveBeenCalled();
    expect(mockPrismaClient.aiUsageLog.aggregate).not.toHaveBeenCalled();
    expect(mockPrismaClient.aiUsageLog.create).not.toHaveBeenCalled();
  }

  /** The refused call spent no rate-limit slot: all 120 of this minute's calls are still free. */
  function expectNoRateLimitSlotSpent(businessId: string) {
    for (let i = 0; i < 120; i++) service.checkRateLimit(businessId);
    expect(() => service.checkRateLimit(businessId)).toThrow();
  }

  beforeEach(() => {
    vi.resetAllMocks();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    sdk.attempts.length = 0;
    sdk.clients.length = 0;
    mockPrismaClient.aiUsageLog.create.mockResolvedValue({});
    mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 0, estimatedCost: 0 } });
    mockUnlimitedPlan();
    mockSubscriptionsService.getActiveSubscription.mockClear();
    service = createService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('with neither AI_INTEGRATIONS_OPENAI_API_KEY nor OPENAI_API_KEY set', () => {
    it('trackEmbedding answers 503 {code: provider_not_configured, service: ai} before any client, provider call, credit check or usage row', async () => {
      await expectNotConfigured(service.trackEmbedding('biz-r07a', 'user-1', 'semantic_embedding', ['hello']));
      expectNothingRan();
      expectNoRateLimitSlotSpent('biz-r07a');
    });

    it('trackVision answers 503 {code: provider_not_configured, service: ai} before any client, provider call, credit check or usage row', async () => {
      await expectNotConfigured(
        service.trackVision('biz-r07a', undefined, 'vision_contact', [{ role: 'user', content: [{ type: 'text', text: 'card' }] }]),
      );
      expectNothingRan();
      expectNoRateLimitSlotSpent('biz-r07a');
    });

    it('trackAudio (tts) answers 503 {code: provider_not_configured, service: ai} before any client, provider call, credit check or usage row', async () => {
      await expectNotConfigured(service.trackAudio('biz-r07a', undefined, 'audio_tts', 'tts', { text: 'Hello there', voice: 'alloy' }));
      expectNothingRan();
      expectNoRateLimitSlotSpent('biz-r07a');
    });

    it('trackAudio (stt) answers 503 {code: provider_not_configured, service: ai} before any client, provider call, credit check or usage row', async () => {
      await expectNotConfigured(
        service.trackAudio('biz-r07a', undefined, 'audio_stt', 'stt', { audioFile: Buffer.from('r07a-audio'), fileName: 'a.webm' }),
      );
      expectNothingRan();
      expectNoRateLimitSlotSpent('biz-r07a');
    });

    it('an empty AI_INTEGRATIONS_OPENAI_API_KEY counts as not configured: no client is built with an empty key', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = '';
      await expectNotConfigured(service.trackEmbedding('biz-r07a', undefined, 'semantic_embedding', ['hello']));
      expectNothingRan();
    });
  });

  describe('with a key configured (SDK stubbed): behaviour is unchanged', () => {
    it('trackEmbedding builds its client from AI_INTEGRATIONS_OPENAI_API_KEY and the base URL, returns the vectors and logs the usage', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = 'http://r07a-openai.test/v1';
      sdk.embeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });

      const out = await service.trackEmbedding('biz-r07a', 'user-1', 'semantic_embedding', ['abcd', 'efgh'], 'text-embedding-3-small');

      expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
      expect(sdk.clients).toEqual([{ apiKey: 'r07a-test-not-a-real-key', baseURL: 'http://r07a-openai.test/v1' }]);
      expect(sdk.embeddingsCreate).toHaveBeenCalledWith({ model: 'text-embedding-3-small', input: ['abcd', 'efgh'] });
      expect(mockPrismaClient.aiUsageLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.aiUsageLog.create.mock.calls[0][0].data).toMatchObject({
        businessId: 'biz-r07a',
        userId: 'user-1',
        feature: 'semantic_embedding',
        provider: 'openai',
        model: 'text-embedding-3-small',
        creditsUsed: AI_CREDIT_COSTS.semantic_embedding,
      });
    });

    it('trackVision returns the completion and logs the usage', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      sdk.chatCreate.mockResolvedValue({
        choices: [{ message: { content: '{"firstName":"Ada"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });

      const out = await service.trackVision('biz-r07a', undefined, 'vision_contact', [{ role: 'user', content: 'card' }], 500, 0.2, 'gpt-4o');

      expect(out.content).toBe('{"firstName":"Ada"}');
      expect(out.usage).toMatchObject({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
      expect(sdk.clients.map((c) => c.apiKey)).toEqual(['r07a-test-not-a-real-key']);
      expect(sdk.chatCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o', max_tokens: 500, temperature: 0.2 }));
      expect(mockPrismaClient.aiUsageLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.aiUsageLog.create.mock.calls[0][0].data).toMatchObject({ feature: 'vision_contact', provider: 'openai', totalTokens: 120 });
    });

    it('trackAudio synthesizes (tts) and transcribes (stt) and logs each', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      sdk.speechCreate.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
      sdk.transcriptionsCreate.mockResolvedValue({ text: 'hello from whisper' });

      const audio = await service.trackAudio('biz-r07a', undefined, 'audio_tts', 'tts', { text: 'Hello', voice: 'nova', model: 'gpt-4o-mini-tts' });
      const text = await service.trackAudio('biz-r07a', undefined, 'audio_stt', 'stt', { audioFile: Buffer.from('r07a'), fileName: 'u.webm', model: 'whisper-1' });

      expect(Buffer.isBuffer(audio)).toBe(true);
      expect([...(audio as Buffer)]).toEqual([1, 2, 3]);
      expect(text).toBe('hello from whisper');
      expect(sdk.speechCreate).toHaveBeenCalledWith({ model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Hello' });
      expect(sdk.transcriptionsCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'whisper-1' }));
      expect(mockPrismaClient.aiUsageLog.create.mock.calls.map((c: any[]) => c[0].data.feature)).toEqual(['audio_tts', 'audio_stt']);
    });

    it('OPENAI_API_KEY alone (the production container name) still serves the call with that key', async () => {
      process.env.OPENAI_API_KEY = 'r07a-test-container-key';
      sdk.embeddingsCreate.mockResolvedValue({ data: [{ embedding: [1] }] });

      await expect(service.trackEmbedding('biz-r07a', undefined, 'semantic_embedding', ['x'])).resolves.toEqual([[1]]);
      expect(sdk.clients.map((c) => c.apiKey)).toEqual(['r07a-test-container-key']);
    });

    it('a configured provider that fails keeps its own error: a provider failure is not reported as not configured', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      sdk.chatCreate.mockRejectedValue(new Error('r07a: provider answered 500'));

      await expect(
        service.trackVision('biz-r07a', undefined, 'vision_contact', [{ role: 'user', content: 'card' }]),
      ).rejects.toThrow('r07a: provider answered 500');
      expect(mockPrismaClient.aiUsageLog.create).not.toHaveBeenCalled();
    });

    it('credits are still enforced before the provider is called', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      mockFreePlan(10);
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({ _sum: { creditsUsed: 10 } });

      await expect(
        service.trackVision('biz-r07a', undefined, 'vision_contact', [{ role: 'user', content: 'card' }]),
      ).rejects.toThrow(ForbiddenException);
      expect(sdk.chatCreate).not.toHaveBeenCalled();
    });
  });
});
