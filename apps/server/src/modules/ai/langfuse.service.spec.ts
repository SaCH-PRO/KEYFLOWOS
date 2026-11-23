import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LangfuseService } from './langfuse.service';
import { errorRegistry } from '../../core/observability/error-registry';

/**
 * The observability shim has exactly one hard contract: it must never affect
 * the request it observes. That splits into two guarantees worth pinning —
 * with no keys it does nothing and touches the network zero times, and with
 * keys a thrown fetch is swallowed rather than propagated back into the gateway.
 *
 * RR-LANGFUSE-INGESTION-CUTOVER adds the wire contract: one OTLP/HTTP JSON
 * trace export per completed call to /api/public/otel/v1/traces (the legacy
 * /api/public/ingestion batch is removed from Langfuse Cloud on 2026-11-16),
 * metadata only, no user id, and every export failure counted and recorded in
 * the error registry so it is visible on GET api/diagnostics/errors.
 *
 * Every case stubs fetch. The beforeEach installs a tripwire: a fetch that a
 * case did not stub records itself and the afterEach fails the case, so no
 * test can ever reach a real Langfuse.
 */
describe('LangfuseService', () => {
  const savedEnv = { ...process.env };
  let unstubbedFetchCalls = 0;

  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    unstubbedFetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      unstubbedFetchCalls += 1;
      throw new Error('fetch called by a case that did not stub it');
    });
  });

  afterEach(() => {
    expect(unstubbedFetchCalls, 'a case let fetch through unstubbed').toBe(0);
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  function withKeys(baseUrl = 'https://lf.example.com/') {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.LANGFUSE_BASE_URL = baseUrl;
  }

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

  const flush = () => new Promise((r) => setImmediate(r));

  type Attr = { key: string; value: Record<string, unknown> };
  function spanOf(body: any) {
    expect(body.resourceSpans).toHaveLength(1);
    expect(body.resourceSpans[0].scopeSpans).toHaveLength(1);
    const spans = body.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    return spans[0];
  }
  function attrs(span: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const a of span.attributes as Attr[]) {
      const v = a.value;
      out[a.key] =
        'stringValue' in v ? v.stringValue : 'intValue' in v ? Number(v.intValue) : 'doubleValue' in v ? v.doubleValue : 'boolValue' in v ? v.boolValue : v;
    }
    return out;
  }

  it('is disabled and never calls the network when keys are absent', () => {
    const svc = new LangfuseService();

    expect(svc.enabled).toBe(false);
    svc.traceLlmCall(sampleCall());

    expect(fetch).not.toHaveBeenCalled();
  });

  it('DoD RED: posts one OTLP/HTTP JSON trace export per call to /api/public/otel/v1/traces, one span with gen_ai.* and key.* attributes and no user id', async () => {
    withKeys();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    const svc = new LangfuseService();
    expect(svc.enabled).toBe(true);

    svc.traceLlmCall({ ...sampleCall(), sessionId: 'sess-9', contractType: 'json', fallbackUsed: true });
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    // Trailing slash on the base URL must be normalised away.
    expect(url).toBe('https://lf.example.com/api/public/otel/v1/traces');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`);
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.batch).toBeUndefined();
    const span = spanOf(body);
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.name).toBe('key.general');
    expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(320n * 1_000_000n);

    const a = attrs(span);
    expect(a['gen_ai.request.model']).toBe('gpt-4o-mini');
    expect(a['gen_ai.response.model']).toBe('gpt-4o-mini');
    expect(a['gen_ai.system']).toBe('openai');
    expect(a['gen_ai.usage.input_tokens']).toBe(100);
    expect(a['gen_ai.usage.output_tokens']).toBe(50);
    expect(a['gen_ai.usage.cost']).toBe(0.0012);
    expect(a['key.business_id']).toBe('biz-1');
    expect(a['key.task_category']).toBe('general');
    expect(a['key.fallback_used']).toBe(true);
    expect(a['key.source']).toBe('complete');
    expect(a['key.contract_type']).toBe('json');
    expect(a['langfuse.session.id']).toBe('sess-9');

    // Metadata only: the attribute set is closed, and nothing names a user.
    expect(Object.keys(a).sort()).toEqual(
      [
        'gen_ai.request.model',
        'gen_ai.response.model',
        'gen_ai.system',
        'gen_ai.usage.cost',
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.output_tokens',
        'gen_ai.usage.total_tokens',
        'key.business_id',
        'key.contract_type',
        'key.fallback_used',
        'key.latency_ms',
        'key.source',
        'key.task_category',
        'langfuse.session.id',
      ].sort(),
    );
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/user/i);
    expect(serialised).not.toMatch(/prompt|completion|messages|input"|output"/i);
  });

  it('omits the session attribute when the call has no session, and never sends a null attribute', async () => {
    withKeys();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    new LangfuseService().traceLlmCall({ ...sampleCall(), sessionId: null, contractType: null });
    await flush();
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    const a = attrs(spanOf(body));
    expect('langfuse.session.id' in a).toBe(false);
    expect('key.contract_type' in a).toBe(false);
    for (const [k, v] of Object.entries(a)) expect(v, k).not.toBeNull();
  });

  it('DoD RED 2: a rejected fetch is counted as an export failure and recorded as langfuse.export in the error registry', async () => {
    withKeys();
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    const before = errorRegistry.snapshot(200);

    const svc = new LangfuseService();
    expect(svc.exportFailures).toBe(0);
    expect(() => svc.traceLlmCall(sampleCall())).not.toThrow();
    await flush();

    expect(svc.exportFailures).toBe(1);
    const after = errorRegistry.snapshot(200);
    const entry = after.entries.find((e) => e.label === 'langfuse.export' && e.source === 'other' && e.message.includes('network down'));
    expect(entry, 'langfuse.export entry in the error registry').toBeDefined();
    expect(after.total).toBe(before.total + 1);
  });

  it('a non-2xx answer is an export failure too, naming the status; a 2xx is not', async () => {
    withKeys();
    vi.mocked(fetch).mockResolvedValue(new Response('{"message":"unauthorized"}', { status: 401 }));
    const svc = new LangfuseService();
    svc.traceLlmCall(sampleCall());
    await flush();
    expect(svc.exportFailures).toBe(1);
    const entry = errorRegistry.snapshot(200).entries.find((e) => e.label === 'langfuse.export' && /401/.test(e.message));
    expect(entry).toBeDefined();

    vi.mocked(fetch).mockResolvedValue(new Response('{"partialSuccess":{}}', { status: 200 }));
    svc.traceLlmCall(sampleCall());
    await flush();
    expect(svc.exportFailures).toBe(1);
  });

  it('a timed-out export is an export failure (the per-request abort fires), not a hang', async () => {
    withKeys();
    process.env.LANGFUSE_TIMEOUT_MS = '20';
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new Error('aborted')));
        }),
    );
    const svc = new LangfuseService();
    svc.traceLlmCall(sampleCall());
    await new Promise((r) => setTimeout(r, 80));
    expect(svc.exportFailures).toBe(1);
  });

  it('swallows a fetch rejection so a tracing outage never reaches the caller, and leaves no unhandled rejection', async () => {
    withKeys();
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const svc = new LangfuseService();
      expect(() => svc.traceLlmCall(sampleCall())).not.toThrow();
      await flush();
      await flush();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('the legacy ingestion batch endpoint is gone from the module', () => {
    // Negative control for the cutover: the removed path may not come back under another name.
    const source = readFileSync(fileURLToPath(new URL('./langfuse.service.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/api\/public\/ingestion/);
    expect(source).not.toMatch(/trace-create|generation-create/);
  });
});
