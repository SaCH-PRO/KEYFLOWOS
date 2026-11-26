/**
 * RR-MODEL-LIFECYCLE-GUARD (P124) — R1 security & defense-in-depth regressions:
 *   - [R1-SEC-01]: Case/whitespace normalization in catalog lookup + trimmed modelOverride
 *   - [R1-SEC-02]: Fail-closed retired-model guard inside callProvider & callProviderStream
 *   - [R1-SEC-03]: Runtime immutability (Object.freeze) of MODEL_LIFECYCLE_CATALOG & entries
 *   - Retired non-primary fallback skipping & route() parity
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MODEL_LIFECYCLE_CATALOG,
  getModelLifecycleEntry,
  isModelRetired,
  type ModelLifecycleEntry,
} from './model-lifecycle-catalog';
import {
  ModelGatewayService,
  type AiProvider,
  type GatewayRequest,
  type StreamChunk,
} from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

function entry(
  provider: AiProvider,
  modelId: string,
  status: ModelLifecycleEntry['status'],
): ModelLifecycleEntry {
  return Object.freeze({
    provider,
    modelId,
    status,
    retiresOn: status === 'retired' ? '2026-01-01' : null,
    source: null,
    checkedAt: null,
    checkedBy: null,
  });
}

const mockPrismaClient = {
  aiMemory: { findUnique: vi.fn(), upsert: vi.fn() },
  llmProviderCost: { create: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
};
const mockPrisma = { client: mockPrismaClient };

let mockLLMCostService: LLMCostService;
let savedEnv: NodeJS.ProcessEnv;

function createService(catalog: readonly ModelLifecycleEntry[]): ModelGatewayService {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-key';
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.XAI_API_KEY = 'test-xai-key';
  process.env.KIMI_API_KEY = 'test-kimi-key';
  process.env.GOOGLE_API_KEY = 'test-google-key';
  process.env.BYOK_ENCRYPTION_SECRET = 'test-encryption-secret-32chars!!';
  delete process.env.KEY_DISABLED;

  return new ModelGatewayService(
    mockPrisma as any,
    mockLLMCostService,
    new LangfuseService(),
    catalog,
  );
}

const OK = {
  content: 'ok',
  usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, estimatedCost: 0.001 },
};

function stubProviders(svc: ModelGatewayService) {
  const spies = {
    callOpenAi: vi.fn(async () => ({ ...OK, content: 'openai' })),
    callAnthropic: vi.fn(async () => ({ ...OK, content: 'anthropic' })),
    callKimi: vi.fn(async () => ({ ...OK, content: 'kimi' })),
    streamOpenAi: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'openai-stream' };
      yield { type: 'usage', usage: OK.usage };
      yield { type: 'done' };
    }),
    streamAnthropic: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'anthropic-stream' };
      yield { type: 'usage', usage: OK.usage };
      yield { type: 'done' };
    }),
    streamKimi: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'kimi-stream' };
      yield { type: 'usage', usage: OK.usage };
      yield { type: 'done' };
    }),
  };
  const s = svc as any;
  for (const [k, v] of Object.entries(spies)) s[k] = v;
  s.routingTableLoaded = true;
  s.delay = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(s.logger, 'warn').mockImplementation(() => undefined);
  return spies;
}

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    businessId: 'biz-r1',
    taskCategory: 'general',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

describe('RR-MODEL-LIFECYCLE-GUARD R1 security & defense-in-depth regressions', () => {
  beforeEach(() => {
    savedEnv = { ...process.env };
    vi.restoreAllMocks();
    vi.resetAllMocks();
    mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);
    mockLLMCostService = {
      recordCost: vi.fn().mockResolvedValue({}),
      getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }),
    } as unknown as LLMCostService;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Live network call forbidden in unit tests');
    });
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it('[R1-SEC-01/03] normalizes whitespace & case, rejects prototype keys & non-strings, and freezes catalog + entries', () => {
    const catalog = [entry('openai', 'gpt-4o', 'retired')];

    expect(getModelLifecycleEntry('openai', ' gpt-4o ', catalog)?.status).toBe('retired');
    expect(getModelLifecycleEntry('OpenAI', 'GPT-4O', catalog)?.status).toBe('retired');
    expect(isModelRetired('  OpenAI  ', '  GPT-4O  ', catalog)).toBe(true);
    expect(isModelRetired('openai', ' gpt-4o ', catalog)).toBe(true);

    // Prototype / blank / non-string safety
    for (const key of ['__proto__', 'constructor', 'toString', '', '   ']) {
      expect(getModelLifecycleEntry(key, 'gpt-4o', catalog)).toBeUndefined();
      expect(getModelLifecycleEntry('openai', key, catalog)).toBeUndefined();
      expect(isModelRetired('openai', key, catalog)).toBe(false);
    }
    expect(getModelLifecycleEntry(null as unknown as string, 'gpt-4o', catalog)).toBeUndefined();
    expect(getModelLifecycleEntry('openai', undefined as unknown as string, catalog)).toBeUndefined();
    expect(isModelRetired('openai', 123 as unknown as string, catalog)).toBe(false);

    // Runtime immutability [R1-SEC-03]
    expect(Object.isFrozen(MODEL_LIFECYCLE_CATALOG)).toBe(true);
    for (const item of MODEL_LIFECYCLE_CATALOG) {
      expect(Object.isFrozen(item)).toBe(true);
    }
  });

  it('[R1-SEC-01] complete() and streamComplete() drop retired padded/mixed-case modelOverride and ignore whitespace-only modelOverride', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'retired'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { callOpenAi, callAnthropic, streamOpenAi, streamAnthropic } = stubProviders(svc);

    for (const bypassAttempt of [' gpt-4o ', 'GPT-4O']) {
      const res = await svc.complete(
        baseRequest({ providerOverride: 'openai', modelOverride: bypassAttempt }),
      );
      expect(res.provider).toBe('anthropic');
      expect(res.fallbackUsed).toBe(true);

      const chunks: StreamChunk[] = [];
      for await (const chunk of svc.streamComplete(
        baseRequest({ providerOverride: 'openai', modelOverride: bypassAttempt }),
      )) {
        chunks.push(chunk);
      }
      expect(
        chunks.some((c) => c.type === 'content_delta' && c.provider === 'anthropic' && c.fallbackUsed === true),
      ).toBe(true);
    }

    expect(callOpenAi).not.toHaveBeenCalled();
    expect(streamOpenAi).not.toHaveBeenCalled();
    expect(callAnthropic).toHaveBeenCalledTimes(2);
    expect(streamAnthropic).toHaveBeenCalledTimes(2);

    // Whitespace-only modelOverride is ignored and does not dispatch an empty model id
    const activeCatalog = [
      entry('openai', 'gpt-4o', 'active'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
    ];
    const activeSvc = createService(activeCatalog);
    const activeSpies = stubProviders(activeSvc);

    const trimmedRes = await activeSvc.complete(
      baseRequest({ providerOverride: 'anthropic', modelOverride: '   ' }),
    );
    expect(trimmedRes.provider).toBe('openai');
    expect(trimmedRes.model).toBe('gpt-4o');
    expect(trimmedRes.fallbackUsed).toBe(false);
    expect(activeSpies.callAnthropic).not.toHaveBeenCalled();
    expect(activeSpies.callOpenAi).toHaveBeenCalledTimes(1);
  });

  it('skips a retired non-primary fallback (index > 0) when primary fails, and route() drops retired candidates', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'active'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'retired'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { callOpenAi, callAnthropic, callKimi } = stubProviders(svc);
    callOpenAi.mockRejectedValue(new Error('Invalid API key'));

    const res = await svc.complete(baseRequest({ taskCategory: 'general' }));

    expect(callOpenAi).toHaveBeenCalledTimes(1);
    expect(callAnthropic).not.toHaveBeenCalled();
    expect(callKimi).toHaveBeenCalledTimes(1);
    expect(res.provider).toBe('kimi');
    expect(res.model).toBe('moonshot-v1-8k');
    expect(res.fallbackUsed).toBe(true);
    expect(res.fallbackProvider).toBe('kimi');

    // route() drops retired primary and marks fallbackUsed=true
    const routeCatalog = [
      entry('openai', 'gpt-4o', 'retired'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const routeSvc = createService(routeCatalog);
    stubProviders(routeSvc);
    const decision = await routeSvc.route(baseRequest({ taskCategory: 'general' }));
    expect(decision).toEqual({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      fallbackUsed: true,
    });

    // route() refuses with 503 provider_unavailable when every candidate is retired
    const allRetiredSvc = createService([
      entry('openai', 'gpt-4o', 'retired'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'retired'),
      entry('kimi', 'moonshot-v1-8k', 'retired'),
    ]);
    stubProviders(allRetiredSvc);
    const err = await allRetiredSvc.route(baseRequest({ taskCategory: 'general' })).catch((e) => e);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'ai' });
  });

  it('[R1-SEC-02] direct callProvider and callProviderStream fail closed on retired models', async () => {
    const catalog = [entry('openai', 'gpt-4o', 'retired')];
    const svc = createService(catalog);
    const { callOpenAi, streamOpenAi } = stubProviders(svc);

    const directErr = await (svc as any)
      .callProvider(baseRequest(), 'openai', ' GPT-4O ', { aiMode: 'balanced' })
      .catch((e: unknown) => e);
    expect(directErr.getStatus()).toBe(503);
    expect(directErr.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'ai' });
    expect(callOpenAi).not.toHaveBeenCalled();

    let streamErr: any;
    try {
      for await (const _chunk of (svc as any).callProviderStream(
        baseRequest(),
        'openai',
        ' gpt-4o ',
        { aiMode: 'balanced' },
      )) {
        // should never yield
      }
    } catch (e) {
      streamErr = e;
    }
    expect(streamErr.getStatus()).toBe(503);
    expect(streamErr.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'ai' });
    expect(streamOpenAi).not.toHaveBeenCalled();
  });
});
