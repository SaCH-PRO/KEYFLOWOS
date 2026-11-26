/**
 * RR-MODEL-LIFECYCLE-GUARD (P124): Retired-model dispatch guard specs.
 *
 * Proves that ModelGatewayService NEVER dispatches to a model marked 'retired'
 * in the lifecycle catalog — regardless of candidate origin:
 *   - DEFAULT_ROUTING_TABLE
 *   - DB-loaded routing table (loadRoutingConfig)
 *   - preferredProvider / PROVIDER_DEFAULT_MODEL
 *   - per-request providerOverride + modelOverride
 * across both complete() and streamComplete(), while:
 *   - logging a structured warning with provider, modelId, reason 'retired' (no secrets)
 *   - counting fallback dispatch as fallbackUsed: true (on response & cost record)
 *   - returning 503 provider_unavailable when every candidate is retired
 *   - continuing to dispatch 'active', 'deprecated', and 'unverified' models normally
 *   - preserving KEY_DISABLED refusal (D-17)
 *
 * Pure unit specs: all provider calls and streams are stubbed; ZERO live network calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  ModelGatewayService,
  type AiProvider,
  type GatewayRequest,
  type StreamChunk,
} from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

interface TestLifecycleEntry {
  provider: AiProvider;
  modelId: string;
  status: 'active' | 'deprecated' | 'retired' | 'unverified';
  retiresOn: string | null;
  source: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
}

function entry(
  provider: AiProvider,
  modelId: string,
  status: TestLifecycleEntry['status'],
  retiresOn: string | null = null,
): TestLifecycleEntry {
  return {
    provider,
    modelId,
    status,
    retiresOn,
    source: null,
    checkedAt: null,
    checkedBy: null,
  };
}

const mockPrismaClient = {
  aiMemory: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  llmProviderCost: {
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
};

let mockLLMCostService: LLMCostService;
let savedEnv: NodeJS.ProcessEnv;

function setTestEnv(overrides: Record<string, string | null> = {}) {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-secret-key';
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-secret-key';
  process.env.XAI_API_KEY = 'test-xai-secret-key';
  process.env.KIMI_API_KEY = 'test-kimi-secret-key';
  process.env.GOOGLE_API_KEY = 'test-google-secret-key';
  process.env.BYOK_ENCRYPTION_SECRET = 'test-encryption-secret-32chars!!';
  delete process.env.KEY_DISABLED;

  for (const [key, val] of Object.entries(overrides)) {
    if (val === null) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

type GatewayCtorWithCatalog = new (
  prisma: any,
  llmCost: LLMCostService,
  langfuse: LangfuseService,
  lifecycleCatalog?: readonly TestLifecycleEntry[],
) => ModelGatewayService;

function createService(
  catalog?: readonly TestLifecycleEntry[],
  envOverrides: Record<string, string | null> = {},
): ModelGatewayService {
  setTestEnv(envOverrides);
  const Ctor = ModelGatewayService as unknown as GatewayCtorWithCatalog;
  return new Ctor(mockPrisma as any, mockLLMCostService, new LangfuseService(), catalog);
}

const OK_RESPONSE = {
  content: 'ok',
  usage: {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    estimatedCost: 0.001,
  },
};

function stubAllProviders(svc: ModelGatewayService) {
  const spies = {
    callOpenAi: vi.fn(async () => ({ ...OK_RESPONSE, content: 'openai-reply' })),
    callAnthropic: vi.fn(async () => ({ ...OK_RESPONSE, content: 'anthropic-reply' })),
    callXai: vi.fn(async () => ({ ...OK_RESPONSE, content: 'xai-reply' })),
    callKimi: vi.fn(async () => ({ ...OK_RESPONSE, content: 'kimi-reply' })),
    callGoogle: vi.fn(async () => ({ ...OK_RESPONSE, content: 'google-reply' })),
    callNative: vi.fn(async () => ({ ...OK_RESPONSE, content: 'native-reply' })),
    callOpensource: vi.fn(async () => ({ ...OK_RESPONSE, content: 'opensource-reply' })),
    streamOpenAi: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'openai-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
    streamAnthropic: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'anthropic-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
    streamXai: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'xai-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
    streamKimi: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'kimi-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
    streamGoogle: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'google-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
    streamNative: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'native-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
    streamOpensource: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'content_delta', content: 'opensource-stream' };
      yield { type: 'usage', usage: OK_RESPONSE.usage };
      yield { type: 'done' };
    }),
  };

  const s = svc as any;
  for (const [name, fn] of Object.entries(spies)) {
    s[name] = fn;
  }
  s.routingTableLoaded = true;
  s.delay = vi.fn().mockResolvedValue(undefined);
  const warnSpy = vi.spyOn(s.logger, 'warn').mockImplementation(() => undefined);
  return { ...spies, warnSpy };
}

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    businessId: 'biz-lifecycle-1',
    taskCategory: 'general',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

async function collectStream(
  svc: ModelGatewayService,
  req: GatewayRequest,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of svc.streamComplete(req)) {
    chunks.push(chunk);
  }
  return chunks;
}

async function captureRejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('Expected promise to reject');
}

describe('ModelGatewayService retired-model guard (RR-MODEL-LIFECYCLE-GUARD)', () => {
  beforeEach(() => {
    savedEnv = { ...process.env };
    vi.restoreAllMocks();
    vi.resetAllMocks();
    mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);
    mockPrismaClient.aiMemory.upsert.mockResolvedValue({});
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

  it('a retired primary is not dispatched: skips retired primary in DEFAULT_ROUTING_TABLE, dispatches next candidate with fallbackUsed=true, records cost, and logs structured warning without secrets', async () => {
    const catalog = [
      entry('openai', 'gpt-4o-mini', 'retired', '2026-01-15'),
      entry('anthropic', 'claude-3-5-haiku-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { callOpenAi, callAnthropic, warnSpy } = stubAllProviders(svc);

    // Attach a BYOK secret to verify the warning log never leaks credentials
    const byokSecret = 'sk-byok-super-secret-value-9999';
    (svc as any).getPreferences = vi.fn().mockResolvedValue({
      aiMode: 'balanced',
      byokOpenai: byokSecret,
    });

    const result = await svc.complete(baseRequest({ taskCategory: 'extraction' }));

    expect(callOpenAi).not.toHaveBeenCalled();
    expect(callAnthropic).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-5-haiku-20241022');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackProvider).toBe('anthropic');

    expect(mockLLMCostService.recordCost).toHaveBeenCalledTimes(1);
    const recorded = (mockLLMCostService.recordCost as Mock).mock.calls[0][0];
    expect(recorded).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      fallbackUsed: true,
    });

    const warnLines = warnSpy.mock.calls.map((c) => String(c[0]));
    const retiredLog = warnLines.find(
      (line) =>
        line.includes('openai') &&
        line.includes('gpt-4o-mini') &&
        line.includes('retired'),
    );
    expect(retiredLog, `expected structured retired-skip warning, got: ${JSON.stringify(warnLines)}`).toBeDefined();
    for (const line of warnLines) {
      expect(line).not.toContain(byokSecret);
      expect(line).not.toContain('test-openai-secret-key');
    }
  });

  it('skips retired candidate loaded from the database routing table (loadRoutingConfig)', async () => {
    const catalog = [
      entry('xai', 'grok-2', 'retired', '2026-02-01'),
      entry('openai', 'gpt-4o', 'active'),
    ];
    const svc = createService(catalog);
    const { callXai, callOpenAi, warnSpy } = stubAllProviders(svc);
    (svc as any).routingTableLoaded = false;

    const dbRouting = {
      balanced: {
        general: {
          primary: { provider: 'xai', model: 'grok-2' },
          fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
        },
      },
    };
    mockPrismaClient.aiMemory.findUnique.mockImplementation(async (args: any) => {
      if (args.where.businessId_category_key?.key === 'routing_table') {
        return { value: JSON.stringify(dbRouting) };
      }
      return null;
    });

    const result = await svc.complete(baseRequest({ taskCategory: 'general' }));

    expect(callXai).not.toHaveBeenCalled();
    expect(callOpenAi).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackProvider).toBe('openai');
    expect(
      warnSpy.mock.calls.some(
        (c) => String(c[0]).includes('xai') && String(c[0]).includes('grok-2') && String(c[0]).includes('retired'),
      ),
    ).toBe(true);
  });

  it('skips retired preferredProvider default from PROVIDER_DEFAULT_MODEL', async () => {
    const catalog = [
      entry('google', 'gemini-2.0-flash', 'retired', '2026-03-01'),
      entry('openai', 'gpt-4o', 'active'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { callGoogle, callOpenAi, warnSpy } = stubAllProviders(svc);

    (svc as any).getPreferences = vi.fn().mockResolvedValue({
      aiMode: 'balanced',
      preferredProvider: 'google',
    });

    const result = await svc.complete(baseRequest({ taskCategory: 'general' }));

    expect(callGoogle).not.toHaveBeenCalled();
    expect(callOpenAi).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackProvider).toBe('openai');
    expect(
      warnSpy.mock.calls.some(
        (c) =>
          String(c[0]).includes('google') &&
          String(c[0]).includes('gemini-2.0-flash') &&
          String(c[0]).includes('retired'),
      ),
    ).toBe(true);
  });

  it('drops retired per-request providerOverride + modelOverride and dispatches next non-retired candidate', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'retired', '2026-04-01'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { callOpenAi, callAnthropic, warnSpy } = stubAllProviders(svc);

    const result = await svc.complete(
      baseRequest({
        taskCategory: 'general',
        providerOverride: 'openai',
        modelOverride: 'gpt-4o',
      }),
    );

    expect(callOpenAi).not.toHaveBeenCalled();
    expect(callAnthropic).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackProvider).toBe('anthropic');
    expect(
      warnSpy.mock.calls.some(
        (c) => String(c[0]).includes('openai') && String(c[0]).includes('gpt-4o') && String(c[0]).includes('retired'),
      ),
    ).toBe(true);
  });

  it('complete() returns 503 provider_unavailable when every candidate in the strategy is retired', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'retired', '2026-01-01'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'retired', '2025-10-28'),
      entry('kimi', 'moonshot-v1-8k', 'retired', '2026-01-01'),
    ];
    const svc = createService(catalog);
    const { callOpenAi, callAnthropic, callKimi } = stubAllProviders(svc);

    const err = await captureRejection(svc.complete(baseRequest({ taskCategory: 'general' })));

    expect(typeof err.getStatus).toBe('function');
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({
      code: 'provider_unavailable',
      service: 'ai',
    });
    expect(err.message).toMatch(/No AI providers available/);
    expect(callOpenAi).not.toHaveBeenCalled();
    expect(callAnthropic).not.toHaveBeenCalled();
    expect(callKimi).not.toHaveBeenCalled();
    expect(mockLLMCostService.recordCost).not.toHaveBeenCalled();
  });

  it('streamComplete() drops retired primary, streams from next candidate with fallbackUsed=true, and records fallback cost', async () => {
    const catalog = [
      entry('openai', 'gpt-4o-mini', 'retired', '2026-01-15'),
      entry('anthropic', 'claude-3-5-haiku-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { streamOpenAi, streamAnthropic, warnSpy } = stubAllProviders(svc);

    const chunks = await collectStream(svc, baseRequest({ taskCategory: 'extraction' }));

    expect(streamOpenAi).not.toHaveBeenCalled();
    expect(streamAnthropic).toHaveBeenCalledTimes(1);
    const contentChunks = chunks.filter((c) => c.type === 'content_delta');
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0]).toMatchObject({
      content: 'anthropic-stream',
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      fallbackUsed: true,
      fallbackProvider: 'anthropic',
    });
    expect(mockLLMCostService.recordCost).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        fallbackUsed: true,
      }),
    );
    expect(
      warnSpy.mock.calls.some(
        (c) => String(c[0]).includes('openai') && String(c[0]).includes('gpt-4o-mini') && String(c[0]).includes('retired'),
      ),
    ).toBe(true);
  });

  it('streamComplete() drops retired providerOverride + modelOverride and never dispatches to it', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'retired', '2026-04-01'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
      entry('kimi', 'moonshot-v1-8k', 'active'),
    ];
    const svc = createService(catalog);
    const { streamOpenAi, streamAnthropic } = stubAllProviders(svc);

    const chunks = await collectStream(
      svc,
      baseRequest({
        taskCategory: 'general',
        providerOverride: 'openai',
        modelOverride: 'gpt-4o',
      }),
    );

    expect(streamOpenAi).not.toHaveBeenCalled();
    expect(streamAnthropic).toHaveBeenCalledTimes(1);
    expect(chunks.some((c) => c.type === 'content_delta' && c.provider === 'anthropic' && c.fallbackUsed === true)).toBe(true);
  });

  it('streamComplete() yields a single provider_unavailable error chunk when every candidate is retired', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'retired', '2026-01-01'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'retired', '2025-10-28'),
      entry('kimi', 'moonshot-v1-8k', 'retired', '2026-01-01'),
    ];
    const svc = createService(catalog);
    const { streamOpenAi, streamAnthropic, streamKimi } = stubAllProviders(svc);

    const chunks = await collectStream(svc, baseRequest({ taskCategory: 'general' }));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'error',
      code: 'provider_unavailable',
    });
    expect(chunks[0].error).toMatch(/No AI providers available/);
    expect(streamOpenAi).not.toHaveBeenCalled();
    expect(streamAnthropic).not.toHaveBeenCalled();
    expect(streamKimi).not.toHaveBeenCalled();
    expect(mockLLMCostService.recordCost).not.toHaveBeenCalled();
  });

  it('negative control: active, deprecated, and unverified models are still dispatched normally without fallback', async () => {
    const catalog = [
      entry('openai', 'gpt-4o-mini', 'deprecated', '2027-06-01'),
      entry('openai', 'gpt-4o', 'unverified'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'active'),
    ];
    const svc = createService(catalog);
    const { callOpenAi, callAnthropic, warnSpy } = stubAllProviders(svc);

    // deprecated primary (balanced/extraction -> openai/gpt-4o-mini)
    const deprecatedRes = await svc.complete(baseRequest({ taskCategory: 'extraction' }));
    expect(deprecatedRes.provider).toBe('openai');
    expect(deprecatedRes.model).toBe('gpt-4o-mini');
    expect(deprecatedRes.fallbackUsed).toBe(false);

    // unverified primary (balanced/general -> openai/gpt-4o)
    const unverifiedRes = await svc.complete(baseRequest({ taskCategory: 'general' }));
    expect(unverifiedRes.provider).toBe('openai');
    expect(unverifiedRes.model).toBe('gpt-4o');
    expect(unverifiedRes.fallbackUsed).toBe(false);

    // active primary (balanced/emotion-analysis -> anthropic/claude-3-5-sonnet-20241022)
    const activeRes = await svc.complete(baseRequest({ taskCategory: 'emotion-analysis' }));
    expect(activeRes.provider).toBe('anthropic');
    expect(activeRes.model).toBe('claude-3-5-sonnet-20241022');
    expect(activeRes.fallbackUsed).toBe(false);

    expect(callOpenAi).toHaveBeenCalledTimes(2);
    expect(callAnthropic).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('KEY_DISABLED still refuses before lifecycle checks in both complete() and streamComplete() (D-17)', async () => {
    const catalog = [
      entry('openai', 'gpt-4o', 'retired', '2026-01-01'),
      entry('anthropic', 'claude-3-5-sonnet-20241022', 'retired', '2025-10-28'),
      entry('kimi', 'moonshot-v1-8k', 'retired', '2026-01-01'),
    ];
    const svc = createService(catalog, { KEY_DISABLED: '1' });
    const { callOpenAi, streamOpenAi } = stubAllProviders(svc);

    const err = await captureRejection(svc.complete(baseRequest({ taskCategory: 'general' })));
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({
      code: 'provider_not_configured',
      reason: 'key_disabled',
      service: 'ai',
    });

    const chunks = await collectStream(svc, baseRequest({ taskCategory: 'general' }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'error',
      code: 'provider_not_configured',
      reason: 'key_disabled',
    });

    expect(callOpenAi).not.toHaveBeenCalled();
    expect(streamOpenAi).not.toHaveBeenCalled();
    expect(mockLLMCostService.recordCost).not.toHaveBeenCalled();
  });
});
