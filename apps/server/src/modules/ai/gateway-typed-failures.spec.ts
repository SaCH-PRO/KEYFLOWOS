/**
 * RR-GATEWAY-TYPED-FAILURES (D-261, D-262): the model gateway classifies a
 * provider failure before it counts it.
 *
 * Before this packet every caught provider error incremented the circuit of
 * the credential in use (recordProviderError), whatever its cause, and the
 * retry decision was a substring test on the message. With a threshold of 3
 * and two retries, ONE complete() whose provider answered three 429s opened
 * the platform key's circuit for five minutes, for every business on that
 * key; a caller's own abort or a 400 the caller caused counted the same way;
 * and '500' matched inside 'max_tokens 5000'.
 *
 * What this spec pins (classifyProviderFailure in provider-failure-class.ts):
 *   - rate_limited, bad_request and caller_aborted do not count toward the
 *     circuit; server, network, timeout, auth, quota_exhausted and unknown do;
 *   - rate_limited, server, network and timeout are retried; auth,
 *     quota_exhausted, bad_request and caller_aborted are not;
 *   - a rate-limited dispatch still moves to the next candidate;
 *   - the Anthropic fetch paths throw a typed ProviderHttpError {status,
 *     provider} with the message text unchanged;
 *   - getProviderHealth reports lastFailureClass per provider;
 *   - the per-credential (BYOK) circuit rule of R0-07 ST-1 is unchanged.
 *
 * Stubs follow model-gateway.service.spec.ts: the provider methods are
 * replaced on the instance, the delay is a no-op, and fetch is spied where the
 * real Anthropic path is exercised (the unit network guard refuses outbound
 * calls, FU-UNIT-MOCK-ISOLATION).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import OpenAI from 'openai';
import { ModelGatewayService, type GatewayRequest, type StreamChunk } from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

const mockPrismaClient = {
  aiMemory: { findUnique: vi.fn(), upsert: vi.fn() },
  llmProviderCost: { create: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
};
const mockPrisma = { client: mockPrismaClient };
const mockLLMCostService = {
  recordCost: vi.fn(),
  getCurrentMonthSpend: vi.fn(),
} as unknown as LLMCostService;

let savedEnv: NodeJS.ProcessEnv;

function createService(): ModelGatewayService {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-key';
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.XAI_API_KEY = 'test-xai-key';
  process.env.BYOK_ENCRYPTION_SECRET = 'test-encryption-secret-32chars!!';
  // The candidate set must not depend on the shell: no kimi, google, native, openrouter or ollama key,
  // so balanced/general dispatches openai then anthropic and nothing else (see the anthropic 429 case).
  for (const key of ['KIMI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'KEYFLOW_NATIVE_AI_URL', 'NATIVE_AI_BASE_URL', 'OPENROUTER_API_KEY', 'OLLAMA_BASE_URL']) {
    delete process.env[key];
  }
  const svc = new ModelGatewayService(mockPrisma as any, mockLLMCostService, new LangfuseService());
  (svc as any).routingTableLoaded = true;
  (svc as any).delay = vi.fn().mockResolvedValue(undefined);
  return svc;
}

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    businessId: 'biz-typed',
    taskCategory: 'general',
    messages: [{ role: 'user', content: 'Hello', tool_calls: undefined, tool_call_id: undefined }],
    ...overrides,
  };
}

const OK = {
  content: 'fallback ok',
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 },
};

/** OpenAI SDK errors as the SDK builds them: (status, the inner error object, message, headers). */
const rateLimit = () =>
  new OpenAI.RateLimitError(429, { message: 'Rate limit reached for gpt-4o', type: 'requests', code: 'rate_limit_exceeded' }, 'Rate limit reached for gpt-4o', undefined);
const quotaExhausted = () =>
  new OpenAI.RateLimitError(429, { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' }, 'You exceeded your current quota', undefined);
const serverError = () =>
  new OpenAI.InternalServerError(503, { message: 'The server is overloaded', type: 'server_error', code: null }, 'The server is overloaded', undefined);
const badRequest = () =>
  new OpenAI.BadRequestError(400, { message: "This model's maximum context length is 128000 tokens", type: 'invalid_request_error', code: 'context_length_exceeded' }, 'context length', undefined);
const callerAbort = () => new OpenAI.APIUserAbortError();

/** Stub every provider; openai rejects with `primaryError`, anthropic (the balanced/general fallback) answers OK. */
function stubProviders(svc: ModelGatewayService, primaryError: () => Error) {
  const callOpenAi = vi.fn().mockImplementation(async () => { throw primaryError(); });
  const callAnthropic = vi.fn().mockResolvedValue(OK);
  (svc as any).callOpenAi = callOpenAi;
  (svc as any).callAnthropic = callAnthropic;
  for (const other of ['callXai', 'callKimi', 'callGoogle', 'callNative', 'callOpensource']) {
    (svc as any)[other] = vi.fn().mockRejectedValue(new Error(`${other}: must not be reached`));
  }
  return { callOpenAi, callAnthropic };
}

const circuit = (svc: ModelGatewayService, provider: string) => (svc as any).circuitBreakers.get(provider);
const health = (svc: ModelGatewayService, provider: string) =>
  svc.getProviderHealth().find((h) => h.provider === provider)! as Record<string, unknown>;

describe('RR-GATEWAY-TYPED-FAILURES: provider failures are classified before they count', () => {
  let service: ModelGatewayService;

  beforeEach(() => {
    savedEnv = { ...process.env };
    vi.restoreAllMocks();
    vi.resetAllMocks();
    mockPrismaClient.aiMemory.findUnique.mockResolvedValue(null);
    mockPrismaClient.aiMemory.upsert.mockResolvedValue({});
    mockLLMCostService.recordCost = vi.fn().mockResolvedValue({});
    mockLLMCostService.getCurrentMonthSpend = vi.fn().mockResolvedValue({ total: 0, byProvider: {} });
    service = createService();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe('rate limits', () => {
    it('three 429s from OpenAI in one complete() are retried, fall back, and leave the platform circuit closed', async () => {
      const { callOpenAi, callAnthropic } = stubProviders(service, rateLimit);

      const result = await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(3); // retried twice (MAX_RETRIES), as before
      expect(callAnthropic).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ provider: 'anthropic', content: 'fallback ok', fallbackUsed: true, fallbackProvider: 'anthropic' });

      const openai = circuit(service, 'openai');
      expect(openai.openUntil).toBeNull();
      expect(openai.failures).toBe(0);
      expect(health(service, 'openai')).toMatchObject({ circuitOpen: false, available: true, lastFailureClass: 'rate_limited', totalErrors: 3 });
      expect(health(service, 'anthropic')).toMatchObject({ lastFailureClass: null });
    });

    it("three 'Anthropic API error (429)' answers leave the anthropic circuit closed", async () => {
      const callAnthropic = vi.fn().mockRejectedValue(new Error('Anthropic API error (429): {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}'));
      (service as any).callAnthropic = callAnthropic;
      (service as any).callOpenAi = vi.fn().mockResolvedValue(OK);
      (service as any).callKimi = vi.fn().mockRejectedValue(new Error('callKimi: must not be reached (not configured)'));

      const refusal: any = await service.complete(baseRequest({ providerOverride: 'anthropic', modelOverride: 'claude-3-5-sonnet-20241022' })).then(
        () => { throw new Error('expected the dispatch to be refused: every configured candidate was rate limited'); },
        (e: unknown) => e,
      );

      // The override makes anthropic primary and keeps balanced/general's fallbacks, whose first entry is
      // anthropic too (candidates are not deduplicated): two anthropic candidates, each retried twice, so
      // exactly six calls. On main the second candidate was skipped because the first three 429s had
      // already opened the circuit. The rejection is the provider's own last error, as for any configured
      // provider that fails (R0-07: not reported as not-configured), not the structured 503.
      expect(callAnthropic).toHaveBeenCalledTimes(6);
      expect(refusal).toBeInstanceOf(Error);
      expect(typeof refusal.getStatus).not.toBe('function');
      expect(refusal.message).toMatch(/^Anthropic API error \(429\)/);
      const anthropic = circuit(service, 'anthropic');
      expect(anthropic.openUntil).toBeNull();
      expect(anthropic.failures).toBe(0);
      expect(health(service, 'anthropic')).toMatchObject({ circuitOpen: false, lastFailureClass: 'rate_limited' });
    });

    it('a rate-limited stream moves to the next candidate and leaves the circuit closed', async () => {
      (service as any).streamOpenAi = vi.fn(async function* () { throw rateLimit(); yield undefined as never; });
      (service as any).streamAnthropic = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'streamed' } as StreamChunk;
        yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 } } as StreamChunk;
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of service.streamComplete(baseRequest())) chunks.push(chunk);

      expect(chunks.some((c) => c.type === 'text' && c.content === 'streamed')).toBe(true);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      const openai = circuit(service, 'openai');
      expect(openai.failures).toBe(0);
      expect(openai.openUntil).toBeNull();
      expect(health(service, 'openai')).toMatchObject({ lastFailureClass: 'rate_limited', totalErrors: 1 });
    });
  });

  describe('failures that still open the circuit (negative controls)', () => {
    it('three 503s open the platform circuit and report lastFailureClass server', async () => {
      const { callOpenAi } = stubProviders(service, serverError);

      const result = await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(3); // server errors are retried
      expect(result.provider).toBe('anthropic');
      const openai = circuit(service, 'openai');
      expect(openai.failures).toBe(3);
      expect(openai.openUntil).not.toBeNull();
      expect(health(service, 'openai')).toMatchObject({ circuitOpen: true, available: false, lastFailureClass: 'server' });
    });

    it('402 Payment Required counts as quota_exhausted and is not retried (OpenRouter and other OpenAI-compatible providers signal no credits that way)', async () => {
      const { callOpenAi } = stubProviders(service, () => new OpenAI.APIError(402, { message: 'Insufficient credits', type: 'payment_required', code: null }, 'Insufficient credits', undefined));

      const result = await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('anthropic');
      expect(circuit(service, 'openai').failures).toBe(1);
      expect(health(service, 'openai')).toMatchObject({ lastFailureClass: 'quota_exhausted' });
    });

    it('a 429 is quota_exhausted only on a documented code or type, never on the words of the message', async () => {
      const { classifyProviderFailure } = await import('./provider-failure-class');
      // Google's ordinary per-minute throttle says "quota"; it is a rate limit.
      expect(classifyProviderFailure(new OpenAI.RateLimitError(429, { message: 'Resource has been exhausted (e.g. check quota).', type: null, code: null }, 'Resource has been exhausted (e.g. check quota).', undefined))).toBe('rate_limited');
      expect(classifyProviderFailure(new OpenAI.RateLimitError(429, { message: 'You exceeded your current quota, please check your plan and billing details.', type: null, code: null }, 'quota', undefined))).toBe('rate_limited');
      // OpenAI: code insufficient_quota (type alone also carries it); Moonshot: type exceeded_current_quota_error.
      expect(classifyProviderFailure(new OpenAI.RateLimitError(429, { message: 'x', type: 'insufficient_quota', code: null }, 'x', undefined))).toBe('quota_exhausted');
      expect(classifyProviderFailure(new OpenAI.RateLimitError(429, { message: 'Your account is not enough balance', type: 'exceeded_current_quota_error', code: null }, 'x', undefined))).toBe('quota_exhausted');
      // A plain Error with no status: only the documented token in its text says quota.
      expect(classifyProviderFailure(new Error('429 insufficient_quota'))).toBe('quota_exhausted');
      expect(classifyProviderFailure(new Error('HTTP 402 Payment Required'))).toBe('quota_exhausted');
      expect(classifyProviderFailure(new Error('429 Resource has been exhausted (e.g. check quota).'))).toBe('rate_limited');
    });

    it('insufficient_quota (429 with code insufficient_quota) counts and is not retried: the credential cannot serve', async () => {
      const { callOpenAi } = stubProviders(service, quotaExhausted);

      const result = await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('anthropic');
      expect(circuit(service, 'openai').failures).toBe(1);
      expect(health(service, 'openai')).toMatchObject({ lastFailureClass: 'quota_exhausted' });
    });

    it('a 401 on a business key opens only that key\'s circuit (R0-07 ST-1 unchanged) and is classed auth', async () => {
      (service as any).getPreferences = vi.fn(async () => ({ aiMode: 'balanced', byokOpenai: 'tenant-typed-revoked-key' }));
      const callOpenAi = vi.fn(async (_m: unknown, _model: unknown, _req: unknown, byokKey?: string) => {
        if (byokKey === 'tenant-typed-revoked-key') throw new OpenAI.AuthenticationError(401, { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' }, 'Incorrect API key provided', undefined);
        return OK;
      });
      (service as any).callOpenAi = callOpenAi;
      (service as any).callAnthropic = vi.fn().mockResolvedValue(OK);

      const result = await service.complete(baseRequest());

      expect(result.provider).toBe('anthropic');
      expect(callOpenAi).toHaveBeenCalledTimes(1); // auth is not retried
      expect(circuit(service, 'openai').failures).toBe(0);
      const byok = [...(service as any).byokCircuitBreakers.values()] as Array<{ failures: number }>;
      expect(byok).toHaveLength(1);
      expect(byok[0].failures).toBe(1);
      // Provider health is read by every business of the platform: a business's own key failing says
      // nothing about the platform credential, so lastFailureClass stays as it was (null here).
      expect(health(service, 'openai')).toMatchObject({ circuitOpen: false, lastFailureClass: null });
    });
  });

  describe('failures the caller caused', () => {
    it('a 400 is not retried and does not count', async () => {
      const { callOpenAi } = stubProviders(service, badRequest);

      const result = await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('anthropic');
      expect(circuit(service, 'openai').failures).toBe(0);
      expect(health(service, 'openai')).toMatchObject({ circuitOpen: false, lastFailureClass: 'bad_request' });
    });

    it('a caller abort is not retried and does not count', async () => {
      const { callOpenAi } = stubProviders(service, callerAbort);

      const result = await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('anthropic');
      expect(circuit(service, 'openai').failures).toBe(0);
      expect(health(service, 'openai')).toMatchObject({ lastFailureClass: 'caller_aborted' });
    });

    it("a DOM-style AbortError (name 'AbortError') is read the same way", async () => {
      const { callOpenAi } = stubProviders(service, () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));

      await service.complete(baseRequest());

      expect(callOpenAi).toHaveBeenCalledTimes(1);
      expect(circuit(service, 'openai').failures).toBe(0);
      expect(health(service, 'openai')).toMatchObject({ lastFailureClass: 'caller_aborted' });
    });
  });

  describe('isRetryable reads the class, not substrings', () => {
    it("no longer matches '500' inside 'max_tokens 5000', and still retries real server, rate-limit, timeout and network errors", () => {
      const retryable = (e: Error) => (service as any).isRetryable(e) as boolean;
      expect(retryable(new Error('max_tokens 5000 exceeds the limit for this model'))).toBe(false);
      expect(retryable(new Error('500 Internal Server Error'))).toBe(true);
      expect(retryable(new Error('Anthropic API error (529): {"type":"overloaded_error"}'))).toBe(true);
      expect(retryable(new Error('rate limit exceeded'))).toBe(true);
      expect(retryable(new Error('HTTP 429 Too Many Requests'))).toBe(true);
      expect(retryable(new Error('Request timeout'))).toBe(true);
      expect(retryable(new Error('socket hang up'))).toBe(true);
      expect(retryable(new Error('Invalid API key'))).toBe(false);
      expect(retryable(new Error('Something went wrong'))).toBe(false);
      expect(retryable(badRequest())).toBe(false);
      expect(retryable(callerAbort())).toBe(false);
      expect(retryable(quotaExhausted())).toBe(false);
      expect(retryable(rateLimit())).toBe(true);
      expect(retryable(serverError())).toBe(true);
    });
  });

  describe('the Anthropic fetch paths throw a typed ProviderHttpError, message unchanged', () => {
    const anthropic429 = () =>
      new Response('{"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}', { status: 429, headers: { 'content-type': 'application/json' } });

    it('callAnthropic: status and provider are on the error; the message text is what log readers expect', async () => {
      const { ProviderHttpError } = await import('./provider-failure-class');
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => anthropic429());

      const err: any = await (service as any).callAnthropic(baseRequest().messages, 'claude-3-5-haiku-20241022', baseRequest()).then(
        () => { throw new Error('expected callAnthropic to reject'); },
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err).toMatchObject({ status: 429, provider: 'anthropic' });
      expect(err.message).toBe('Anthropic API error (429): {"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}');
    });

    it('streamAnthropic: the same typed error, same message shape', async () => {
      const { ProviderHttpError } = await import('./provider-failure-class');
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => anthropic429());

      const err: any = await (async () => {
        for await (const _chunk of (service as any).streamAnthropic(baseRequest().messages, 'claude-3-5-haiku-20241022', baseRequest())) { /* drain */ }
      })().then(
        () => { throw new Error('expected streamAnthropic to reject'); },
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err).toMatchObject({ status: 429, provider: 'anthropic' });
      expect(err.message).toBe('Anthropic streaming API error (429): {"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}');
    });
  });

  describe('classifyProviderFailure', () => {
    it('reads status and code first, the message only for a plain Error, and never a bare substring', async () => {
      const { classifyProviderFailure, failureCountsTowardCircuit, failureIsRetryable, ProviderHttpError } = await import('./provider-failure-class');
      const cases: Array<[unknown, string]> = [
        [rateLimit(), 'rate_limited'],
        [quotaExhausted(), 'quota_exhausted'],
        [serverError(), 'server'],
        [new OpenAI.InternalServerError(500, { message: 'boom' }, 'boom', undefined), 'server'],
        [badRequest(), 'bad_request'],
        [new OpenAI.NotFoundError(404, { message: 'no such model' }, 'no such model', undefined), 'bad_request'],
        [new OpenAI.AuthenticationError(401, { message: 'bad key' }, 'bad key', undefined), 'auth'],
        [new OpenAI.PermissionDeniedError(403, { message: 'forbidden' }, 'forbidden', undefined), 'auth'],
        [callerAbort(), 'caller_aborted'],
        [new OpenAI.APIConnectionTimeoutError(), 'timeout'],
        [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError', code: 23 }), 'timeout'],
        [new OpenAI.APIConnectionError({ message: 'Connection error.' }), 'network'],
        [new ProviderHttpError('anthropic', 429, 'Anthropic API error (429): x'), 'rate_limited'],
        [new ProviderHttpError('anthropic', 529, 'Anthropic API error (529): overloaded'), 'server'],
        [new ProviderHttpError('anthropic', 401, 'Anthropic API error (401): invalid x-api-key'), 'auth'],
        [new ProviderHttpError('anthropic', 400, 'Anthropic API error (400): bad'), 'bad_request'],
        [new ProviderHttpError('anthropic', 408, 'Anthropic API error (408): slow'), 'timeout'],
        [Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), 'network'],
        [Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 'network'],
        [Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 'timeout'],
        [new Error('Anthropic API error (429): rate limited'), 'rate_limited'],
        [new Error('OpenAI API error (401): Incorrect API key provided'), 'auth'],
        [new Error('Invalid API key'), 'auth'],
        [new Error('503 Service Unavailable'), 'server'],
        [new Error('Request timeout'), 'timeout'],
        [new Error('socket hang up'), 'network'],
        [new Error('max_tokens 5000 exceeds the limit'), 'unknown'],
        [new Error('Something went wrong'), 'unknown'],
        ['not even an error', 'unknown'],
      ];
      for (const [input, expected] of cases) {
        expect(classifyProviderFailure(input), `class of ${(input as any)?.message ?? String(input)}`).toBe(expected);
      }
      expect(['server', 'network', 'timeout', 'auth', 'quota_exhausted', 'unknown'].every((c) => failureCountsTowardCircuit(c as any))).toBe(true);
      expect(['rate_limited', 'bad_request', 'caller_aborted'].some((c) => failureCountsTowardCircuit(c as any))).toBe(false);
      expect(['rate_limited', 'server', 'network', 'timeout'].every((c) => failureIsRetryable(c as any))).toBe(true);
      expect(['auth', 'quota_exhausted', 'bad_request', 'caller_aborted', 'unknown'].some((c) => failureIsRetryable(c as any))).toBe(false);
    });
  });
});
