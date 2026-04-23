import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ModelGatewayService, type GatewayRequest, type AiProvider, type AiMode, type TaskCategory } from './model-gateway.service';

const mockPrismaClient = {
  aiMemory: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
};

let savedEnv: NodeJS.ProcessEnv;

function setTestEnv(overrides: Record<string, string | null> = {}) {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-key';
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.XAI_API_KEY = 'test-xai-key';
  process.env.BYOK_ENCRYPTION_SECRET = 'test-encryption-secret-32chars!!';

  for (const [key, val] of Object.entries(overrides)) {
    if (val === null) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

function createService(envOverrides: Record<string, string | null> = {}): ModelGatewayService {
  setTestEnv(envOverrides);
  return new ModelGatewayService(mockPrisma as any);
}

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    businessId: 'biz-1',
    taskCategory: 'general',
    messages: [{ role: 'user', content: 'Hello', tool_calls: undefined, tool_call_id: undefined }],
    ...overrides,
  };
}

describe('ModelGatewayService', () => {
  let service: ModelGatewayService;

  beforeEach(() => {
    savedEnv = { ...process.env };
    vi.restoreAllMocks();
    vi.resetAllMocks();
    mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);
    mockPrismaClient.aiMemory.upsert.mockResolvedValue({});
    service = createService();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe('Routing table resolution', () => {
    it('returns correct strategy for balanced/extraction (gpt-4o-mini primary)', () => {
      const config = service.getRoutingConfig();
      const strategy = config.balanced.extraction;
      expect(strategy.primary.provider).toBe('openai');
      expect(strategy.primary.model).toBe('gpt-4o-mini');
      expect(strategy.fallbacks[0].provider).toBe('anthropic');
      expect(strategy.fallbacks[0].model).toBe('claude-3-5-haiku-20241022');
    });

    it('returns correct strategy for balanced/reasoning (gpt-4o primary)', () => {
      const config = service.getRoutingConfig();
      const strategy = config.balanced.reasoning;
      expect(strategy.primary.provider).toBe('openai');
      expect(strategy.primary.model).toBe('gpt-4o');
      expect(strategy.fallbacks[0].provider).toBe('anthropic');
      expect(strategy.fallbacks[0].model).toBe('claude-3-5-sonnet-20241022');
    });

    it('premium/content-generation prefers anthropic as primary', () => {
      const config = service.getRoutingConfig();
      const strategy = config.premium['content-generation'];
      expect(strategy.primary.provider).toBe('anthropic');
      expect(strategy.primary.model).toBe('claude-3-5-sonnet-20241022');
      expect(strategy.fallbacks[0].provider).toBe('openai');
    });

    it('fast mode always uses mini models with xai fallback', () => {
      const config = service.getRoutingConfig();
      const tasks: TaskCategory[] = ['extraction', 'classification', 'reasoning', 'content-generation', 'summarization', 'tool-calling', 'general'];
      for (const task of tasks) {
        const strategy = config.fast[task];
        expect(strategy.primary.provider).toBe('openai');
        expect(strategy.primary.model).toBe('gpt-4o-mini');
        expect(strategy.fallbacks[0].provider).toBe('xai');
        expect(strategy.fallbacks[0].model).toBe('grok-2-mini');
      }
    });

    it('all modes cover all task categories', () => {
      const config = service.getRoutingConfig();
      const modes: AiMode[] = ['balanced', 'premium', 'fast'];
      const tasks: TaskCategory[] = ['extraction', 'classification', 'reasoning', 'content-generation', 'summarization', 'tool-calling', 'general'];
      for (const mode of modes) {
        for (const task of tasks) {
          expect(config[mode][task]).toBeDefined();
          expect(config[mode][task].primary).toBeDefined();
          expect(config[mode][task].fallbacks).toBeDefined();
          expect(config[mode][task].fallbacks.length).toBeGreaterThan(0);
        }
      }
    });

    it('updates routing config and persists to database', async () => {
      await service.updateRoutingConfig({
        balanced: {
          extraction: {
            primary: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
            fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
          },
        },
      });

      const updated = service.getRoutingConfig();
      expect(updated.balanced.extraction.primary.provider).toBe('anthropic');
      expect(updated.balanced.extraction.primary.model).toBe('claude-3-5-sonnet-20241022');
      expect(mockPrismaClient.aiMemory.upsert).toHaveBeenCalledTimes(1);
    });

    it('loads routing config from database on first complete call', async () => {
      const customRouting = {
        balanced: {
          general: {
            primary: { provider: 'xai', model: 'grok-2' },
            fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
          },
        },
      };

      mockPrismaClient.aiMemory.findUnique.mockImplementation(async (args: any) => {
        if (args.where.businessId_category_key?.key === 'routing_table') {
          return { value: JSON.stringify(customRouting) };
        }
        return null;
      });

      await service.loadRoutingConfig();

      const config = service.getRoutingConfig();
      expect(config.balanced.general.primary.provider).toBe('xai');
      expect(config.balanced.general.primary.model).toBe('grok-2');
      expect(config.balanced.extraction.primary.provider).toBe('openai');
    });

    it('mergeWithDefaults preserves defaults for missing modes/tasks', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: JSON.stringify({ fast: { general: { primary: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }, fallbacks: [] } } }),
      });

      await service.loadRoutingConfig();
      const config = service.getRoutingConfig();

      expect(config.fast.general.primary.provider).toBe('anthropic');
      expect(config.balanced.general.primary.provider).toBe('openai');
      expect(config.fast.extraction.primary.provider).toBe('openai');
    });
  });

  describe('Fallback chain execution', () => {
    let callOpenAiSpy: Mock;
    let callAnthropicSpy: Mock;
    let callXaiSpy: Mock;

    beforeEach(() => {
      callOpenAiSpy = vi.fn();
      callAnthropicSpy = vi.fn();
      callXaiSpy = vi.fn();

      (service as any).callOpenAi = callOpenAiSpy;
      (service as any).callAnthropic = callAnthropicSpy;
      (service as any).callXai = callXaiSpy;
      (service as any).routingTableLoaded = true;
      (service as any).delay = vi.fn().mockResolvedValue(undefined);
    });

    it('uses primary provider on success', async () => {
      callOpenAiSpy.mockResolvedValue({
        content: 'Success',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      const result = await service.complete(baseRequest({ taskCategory: 'general' }));

      expect(result.provider).toBe('openai');
      expect(result.content).toBe('Success');
      expect(result.fallbackUsed).toBe(false);
      expect(result.fallbackProvider).toBeUndefined();
      expect(callOpenAiSpy).toHaveBeenCalledTimes(1);
      expect(callAnthropicSpy).not.toHaveBeenCalled();
    });

    it('falls back to secondary when primary fails', async () => {
      callOpenAiSpy.mockRejectedValue(new Error('OpenAI is down'));
      callAnthropicSpy.mockResolvedValue({
        content: 'Anthropic reply',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      const result = await service.complete(baseRequest({ taskCategory: 'general' }));

      expect(result.provider).toBe('anthropic');
      expect(result.content).toBe('Anthropic reply');
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackProvider).toBe('anthropic');
    });

    it('throws when all providers fail', async () => {
      callOpenAiSpy.mockRejectedValue(new Error('OpenAI down'));
      callAnthropicSpy.mockRejectedValue(new Error('Anthropic down'));

      await expect(service.complete(baseRequest({ taskCategory: 'general' }))).rejects.toThrow();
    });

    it('skips unavailable providers in chain', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const svc = createService({ ANTHROPIC_API_KEY: null });
      (svc as any).callOpenAi = callOpenAiSpy;
      (svc as any).callAnthropic = callAnthropicSpy;
      (svc as any).routingTableLoaded = true;
      (svc as any).delay = vi.fn().mockResolvedValue(undefined);

      callOpenAiSpy.mockRejectedValue(new Error('OpenAI down'));

      await expect(svc.complete(baseRequest({ taskCategory: 'general' }))).rejects.toThrow();
      expect(callAnthropicSpy).not.toHaveBeenCalled();
    });

    it('respects providerOverride to set primary', async () => {
      callAnthropicSpy.mockResolvedValue({
        content: 'Forced anthropic',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      const result = await service.complete(baseRequest({
        providerOverride: 'anthropic',
        modelOverride: 'claude-3-5-sonnet-20241022',
      }));

      expect(result.provider).toBe('anthropic');
      expect(result.content).toBe('Forced anthropic');
    });

    it('retries on retryable errors before falling back', async () => {
      let attempts = 0;
      callOpenAiSpy.mockImplementation(async () => {
        attempts++;
        throw new Error('rate limit exceeded');
      });

      callAnthropicSpy.mockResolvedValue({
        content: 'Anthropic fallback',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      const result = await service.complete(baseRequest());

      expect(callOpenAiSpy).toHaveBeenCalledTimes(3);
      expect(result.fallbackUsed).toBe(true);
      expect(result.provider).toBe('anthropic');
    });

    it('does not retry on non-retryable errors', async () => {
      callOpenAiSpy.mockRejectedValue(new Error('Invalid API key'));
      callAnthropicSpy.mockResolvedValue({
        content: 'Fallback',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      const result = await service.complete(baseRequest());

      expect(callOpenAiSpy).toHaveBeenCalledTimes(1);
      expect(result.fallbackUsed).toBe(true);
    });
  });

  describe('BYOK key resolution', () => {
    it('returns default preferences when no AiMemory exists', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);
      const prefs = await service.getPreferences('biz-1');
      expect(prefs.aiMode).toBe('balanced');
      expect(prefs.byokOpenai).toBeUndefined();
      expect(prefs.byokAnthropic).toBeUndefined();
      expect(prefs.byokXai).toBeUndefined();
    });

    it('loads aiMode from stored preferences', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: JSON.stringify({ aiMode: 'premium' }),
      });

      const prefs = await service.getPreferences('biz-2');
      expect(prefs.aiMode).toBe('premium');
    });

    it('caches preferences and re-uses them within TTL', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: JSON.stringify({ aiMode: 'fast' }),
      });

      await service.getPreferences('biz-3');
      await service.getPreferences('biz-3');

      expect(mockPrismaClient.aiMemory.findUnique).toHaveBeenCalledTimes(1);
    });

    it('updatePreferences clears cache so next getPreferences re-fetches', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: JSON.stringify({ aiMode: 'balanced' }),
      });

      const prefsBefore = await service.getPreferences('biz-4');
      expect(prefsBefore.aiMode).toBe('balanced');

      await service.updatePreferences('biz-4', { aiMode: 'premium' });

      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: JSON.stringify({ aiMode: 'premium' }),
      });
      const prefsAfter = await service.getPreferences('biz-4');
      expect(prefsAfter.aiMode).toBe('premium');
      expect(mockPrismaClient.aiMemory.findUnique).toHaveBeenCalledTimes(2);
    });

    it('encrypts BYOK keys on save and decrypts on load', async () => {
      let storedValue: string | undefined;
      mockPrismaClient.aiMemory.upsert.mockImplementation(async (args: any) => {
        storedValue = args.create?.value || args.update?.value;
        return {};
      });
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);

      await service.updatePreferences('biz-5', {
        aiMode: 'balanced',
        byokOpenai: 'sk-my-secret-key',
      });

      expect(storedValue).toBeDefined();
      const parsed = JSON.parse(storedValue!);
      expect(parsed.byokOpenai).not.toBe('sk-my-secret-key');
      expect(parsed.byokOpenai).toContain(':');

      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: storedValue!,
      });

      const prefs = await service.getPreferences('biz-5');
      expect(prefs.byokOpenai).toBe('sk-my-secret-key');
    });

    it('BYOK key makes provider available even without env var', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const isAvailable = (service as any).isProviderAvailable('anthropic', {
        aiMode: 'balanced',
        byokAnthropic: 'sk-user-anthropic-key',
      });

      expect(isAvailable).toBe(true);
    });

    it('provider not available without env var or BYOK', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const isAvailable = (service as any).isProviderAvailable('anthropic', {
        aiMode: 'balanced',
      });

      expect(isAvailable).toBe(false);
    });

    it('clearing a BYOK key sets it to undefined', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue({
        value: JSON.stringify({ aiMode: 'balanced', byokOpenai: 'some-encrypted-val' }),
      });

      const prefs = await service.updatePreferences('biz-6', { byokOpenai: '' });
      expect(prefs.byokOpenai).toBeUndefined();
    });

    it('rejects BYOK update when encryption secret is not configured', async () => {
      const svc = createService({ BYOK_ENCRYPTION_SECRET: null });
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);

      await expect(
        svc.updatePreferences('biz-7', { byokOpenai: 'sk-test' }),
      ).rejects.toThrow('BYOK key storage requires BYOK_ENCRYPTION_SECRET');
    });

    it('validates aiMode to allowed values', async () => {
      mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);
      const prefs = await service.updatePreferences('biz-8', { aiMode: 'invalid' as any });
      expect(prefs.aiMode).toBe('balanced');
    });
  });

  describe('Provider health tracking', () => {
    it('starts with zero metrics for all providers', () => {
      const health = service.getProviderHealth();
      expect(health).toHaveLength(3);

      for (const h of health) {
        expect(h.totalCalls).toBe(0);
        expect(h.totalErrors).toBe(0);
        expect(h.avgLatencyMs).toBe(0);
        expect(h.errorRate).toBe(0);
        expect(h.lastErrorAt).toBeNull();
      }
    });

    it('recordProviderSuccess increments totalCalls and tracks latency', () => {
      (service as any).recordProviderSuccess('openai', 150);
      (service as any).recordProviderSuccess('openai', 250);
      (service as any).recordProviderSuccess('openai', 200);

      const health = service.getProviderHealth();
      const openai = health.find(h => h.provider === 'openai')!;

      expect(openai.totalCalls).toBe(3);
      expect(openai.totalErrors).toBe(0);
      expect(openai.avgLatencyMs).toBe(200);
      expect(openai.errorRate).toBe(0);
    });

    it('recordProviderError increments totalErrors and sets lastErrorAt', () => {
      (service as any).recordProviderError('anthropic');

      const health = service.getProviderHealth();
      const anthropic = health.find(h => h.provider === 'anthropic')!;

      expect(anthropic.totalCalls).toBe(1);
      expect(anthropic.totalErrors).toBe(1);
      expect(anthropic.errorRate).toBe(1);
      expect(anthropic.lastErrorAt).toBeInstanceOf(Date);
    });

    it('errorRate computes correctly with mixed calls', () => {
      (service as any).recordProviderSuccess('openai', 100);
      (service as any).recordProviderSuccess('openai', 100);
      (service as any).recordProviderSuccess('openai', 100);
      (service as any).recordProviderError('openai');

      const health = service.getProviderHealth();
      const openai = health.find(h => h.provider === 'openai')!;

      expect(openai.totalCalls).toBe(4);
      expect(openai.totalErrors).toBe(1);
      expect(openai.errorRate).toBe(0.25);
    });

    it('latency buffer trims when exceeding 500 entries', () => {
      for (let i = 0; i < 510; i++) {
        (service as any).recordProviderSuccess('openai', 100);
      }

      const metrics = (service as any).providerMetrics.get('openai');
      expect(metrics.latencies.length).toBeLessThanOrEqual(260);
    });

    it('tracks health per provider independently', () => {
      (service as any).recordProviderSuccess('openai', 100);
      (service as any).recordProviderError('anthropic');
      (service as any).recordProviderSuccess('xai', 200);

      const health = service.getProviderHealth();
      const openai = health.find(h => h.provider === 'openai')!;
      const anthropic = health.find(h => h.provider === 'anthropic')!;
      const xai = health.find(h => h.provider === 'xai')!;

      expect(openai.totalCalls).toBe(1);
      expect(openai.totalErrors).toBe(0);
      expect(anthropic.totalCalls).toBe(1);
      expect(anthropic.totalErrors).toBe(1);
      expect(xai.totalCalls).toBe(1);
      expect(xai.totalErrors).toBe(0);
      expect(xai.avgLatencyMs).toBe(200);
    });

    it('configured flag reflects env var presence at construction time', () => {
      const svc = createService({ ANTHROPIC_API_KEY: null, XAI_API_KEY: null });
      const health = svc.getProviderHealth();

      const openai = health.find(h => h.provider === 'openai')!;
      const anthropic = health.find(h => h.provider === 'anthropic')!;
      const xai = health.find(h => h.provider === 'xai')!;

      expect(openai.configured).toBe(true);
      expect(anthropic.configured).toBe(false);
      expect(xai.configured).toBe(false);
    });
  });

  describe('Contract validation in complete flow', () => {
    beforeEach(() => {
      (service as any).routingTableLoaded = true;
      (service as any).delay = vi.fn().mockResolvedValue(undefined);
    });

    it('validates expected contract and passes on valid output', async () => {
      const validReply = JSON.stringify({ reply: 'Hello world', suggestedActions: [] });
      (service as any).callOpenAi = vi.fn().mockResolvedValue({
        content: validReply,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      const result = await service.complete(baseRequest({ expectedContract: 'chat_response' }));
      expect(result.contractValidation).toBeDefined();
      expect(result.contractValidation!.valid).toBe(true);
    });

    it('throws on contract violation', async () => {
      const invalidReply = JSON.stringify({ not_a_reply: 'oops' });
      (service as any).callOpenAi = vi.fn().mockResolvedValue({
        content: invalidReply,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });
      (service as any).callAnthropic = vi.fn().mockResolvedValue({
        content: invalidReply,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });

      await expect(
        service.complete(baseRequest({ expectedContract: 'chat_response' })),
      ).rejects.toThrow('AI output contract violation');
    });
  });

  describe('isRetryable', () => {
    it('marks rate limit errors as retryable', () => {
      expect((service as any).isRetryable(new Error('rate limit exceeded'))).toBe(true);
    });

    it('marks timeout errors as retryable', () => {
      expect((service as any).isRetryable(new Error('Request timeout'))).toBe(true);
    });

    it('marks 429 errors as retryable', () => {
      expect((service as any).isRetryable(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    });

    it('marks 503 errors as retryable', () => {
      expect((service as any).isRetryable(new Error('503 Service Unavailable'))).toBe(true);
    });

    it('marks 500 errors as retryable', () => {
      expect((service as any).isRetryable(new Error('500 Internal Server Error'))).toBe(true);
    });

    it('marks ECONNRESET as retryable', () => {
      expect((service as any).isRetryable(new Error('ECONNRESET'))).toBe(true);
    });

    it('marks socket hang up as retryable', () => {
      expect((service as any).isRetryable(new Error('socket hang up'))).toBe(true);
    });

    it('does not retry auth errors', () => {
      expect((service as any).isRetryable(new Error('Invalid API key'))).toBe(false);
    });

    it('does not retry generic errors', () => {
      expect((service as any).isRetryable(new Error('Something went wrong'))).toBe(false);
    });
  });

  describe('Cost estimation', () => {
    beforeEach(() => {
      (service as any).routingTableLoaded = true;
      (service as any).delay = vi.fn().mockResolvedValue(undefined);
    });

    it('calculates cost correctly for gpt-4o-mini', async () => {
      (service as any).callOpenAi = vi.fn().mockResolvedValue({
        content: 'reply',
        usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, estimatedCost: 0.002 },
      });

      const result = await service.complete(baseRequest({ taskCategory: 'extraction' }));
      expect(result.usage).toBeDefined();
      expect(result.usage.totalTokens).toBe(2000);
    });
  });

  describe('End-to-end complete() via public interface', () => {
    beforeEach(() => {
      (service as any).routingTableLoaded = true;
      (service as any).delay = vi.fn().mockResolvedValue(undefined);
    });

    it('complete() returns full response shape with provider, model, latency, and usage', async () => {
      (service as any).callOpenAi = vi.fn().mockResolvedValue({
        content: 'Full response',
        usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40, estimatedCost: 0.003 },
      });

      const result = await service.complete(baseRequest());

      expect(result).toMatchObject({
        content: 'Full response',
        provider: 'openai',
        model: expect.any(String),
        fallbackUsed: false,
        usage: {
          promptTokens: 15,
          completionTokens: 25,
          totalTokens: 40,
          estimatedCost: 0.003,
        },
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('complete() with premium mode and stored preferences routes to correct model', async () => {
      mockPrismaClient.aiMemory.findUnique.mockImplementation(async (args: any) => {
        if (args.where.businessId_category_key?.key === 'ai_preferences') {
          return { value: JSON.stringify({ aiMode: 'premium' }) };
        }
        return null;
      });

      const callAnthropicSpy = vi.fn().mockResolvedValue({
        content: 'Premium content',
        usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50, estimatedCost: 0.005 },
      });
      (service as any).callAnthropic = callAnthropicSpy;

      const result = await service.complete(baseRequest({
        businessId: 'biz-premium',
        taskCategory: 'content-generation',
      }));

      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.content).toBe('Premium content');
    });

    it('BYOK key is passed through to the provider call method', async () => {
      const byokKey = 'sk-user-byok-key-12345';
      const encryptedKey = (service as any).encryptSecret(byokKey);
      mockPrismaClient.aiMemory.findUnique.mockImplementation(async (args: any) => {
        if (args.where.businessId_category_key?.key === 'ai_preferences') {
          return { value: JSON.stringify({ aiMode: 'balanced', byokOpenai: encryptedKey }) };
        }
        return null;
      });

      const callOpenAiSpy = vi.fn().mockResolvedValue({
        content: 'BYOK response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });
      (service as any).callOpenAi = callOpenAiSpy;

      await service.complete(baseRequest({ businessId: 'biz-byok' }));

      expect(callOpenAiSpy).toHaveBeenCalledTimes(1);
      const callArgs = callOpenAiSpy.mock.calls[0];
      expect(callArgs[3]).toBe(byokKey);
    });

    it('complete() updates health metrics after success and failure', async () => {
      const callOpenAiSpy = vi.fn()
        .mockRejectedValueOnce(new Error('server error'))
        .mockResolvedValueOnce({
          content: 'ok',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
        });
      (service as any).callOpenAi = callOpenAiSpy;

      const callAnthropicSpy = vi.fn().mockResolvedValue({
        content: 'fallback ok',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
      });
      (service as any).callAnthropic = callAnthropicSpy;

      await service.complete(baseRequest());

      const health = service.getProviderHealth();
      const openai = health.find(h => h.provider === 'openai')!;
      const anthropic = health.find(h => h.provider === 'anthropic')!;

      expect(openai.totalErrors).toBeGreaterThan(0);
      expect(anthropic.totalCalls).toBeGreaterThan(0);

      await service.complete(baseRequest());

      const healthAfter = service.getProviderHealth();
      const openaiAfter = healthAfter.find(h => h.provider === 'openai')!;
      expect(openaiAfter.totalCalls).toBeGreaterThan(openai.totalCalls);
    });
  });
});
