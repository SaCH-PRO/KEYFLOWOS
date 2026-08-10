import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LangfuseService } from './langfuse.service';

/**
 * The observability shim has exactly one hard contract: it must never affect
 * the request it observes. That splits into two guarantees worth pinning —
 * with no keys it does nothing and touches the network zero times, and with
 * keys a thrown fetch is swallowed rather than propagated back into the gateway.
 */
describe('LangfuseService', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  function sampleCall() {
    return {
      businessId: 'biz-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      taskCategory: 'general',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      totalCost: 0.0012,
      latencyMs: 320,
      fallbackUsed: false,
      source: 'complete' as const,
    };
  }

  it('is disabled and never calls the network when keys are absent', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const svc = new LangfuseService();

    expect(svc.enabled).toBe(false);
    svc.traceLlmCall(sampleCall());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is enabled and posts a trace + generation batch when both keys are present', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.LANGFUSE_BASE_URL = 'https://lf.example.com/';

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 207 }));

    const svc = new LangfuseService();
    expect(svc.enabled).toBe(true);

    svc.traceLlmCall(sampleCall());
    // traceLlmCall is fire-and-forget; let the microtask flush.
    await new Promise((r) => setImmediate(r));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    // Trailing slash on the base URL must be normalised away.
    expect(url).toBe('https://lf.example.com/api/public/ingestion');
    expect((init as RequestInit).method).toBe('POST');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.batch).toHaveLength(2);
    expect(body.batch.map((e: { type: string }) => e.type)).toEqual([
      'trace-create',
      'generation-create',
    ]);
    // The generation must reference the trace, and carry token + cost usage.
    const [trace, generation] = body.batch;
    expect(generation.body.traceId).toBe(trace.body.id);
    expect(generation.body.usage.totalCost).toBe(0.0012);
    expect(generation.body.usage.total).toBe(150);
  });

  it('swallows a fetch rejection so a tracing outage never reaches the caller', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const svc = new LangfuseService();
    expect(() => svc.traceLlmCall(sampleCall())).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
