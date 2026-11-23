/**
 * RR-STRUCTURED-PARSE-INVALID-STATE (D-261, D-262): gateway contract violations
 * are typed and costed, never a silent provider failure or a silent pass on
 * empty output.
 *
 * Before this packet, in complete() a contract violation threw a plain Error
 * inside the candidate loop's try, so the loop treated it like a provider
 * failure: it moved on, and the paid call's cost was never recorded; if every
 * candidate failed the caller got the last plain Error and could not tell a
 * violation from an outage. The check was skipped for empty content, so an
 * empty answer to a request with an expected contract returned as success.
 * coerceToContract replaced an invalid payload with the caller's fallback and
 * told nobody.
 *
 * What this spec pins:
 *   - GatewayResponse.outputState: 'valid' | 'valid_after_fallback' | 'unchecked';
 *   - a violation records the paid call (metadata.outputState 'invalid', the
 *     contract type and the error list) before the next candidate runs, and
 *     counts toward no circuit (the classifier knows 'contract_violation');
 *   - empty output with an expected contract is a violation ('Response is empty');
 *   - when no candidate produced valid output and at least one produced invalid
 *     output, complete() rejects with AiContractViolationError (502,
 *     code 'contract_violation', every attempt listed), not the last provider error;
 *   - coerceToContractState returns the state and the errors; coerceToContract
 *     keeps its value-only shape.
 *
 * Stubs follow gateway-typed-failures.spec.ts: provider methods are replaced
 * on the instance, the delay is a no-op, nothing leaves the process.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ModelGatewayService, type GatewayRequest } from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';
import { AiContractViolationError, coerceToContract, coerceToContractState } from './ai-output-contracts';
import { classifyProviderFailure, failureCountsTowardCircuit, failureIsRetryable } from './provider-failure-class';

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
    businessId: 'biz-contract',
    taskCategory: 'general',
    messages: [{ role: 'user', content: 'Draft a reply', tool_calls: undefined, tool_call_id: undefined }],
    ...overrides,
  };
}

const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.001 };
const TOO_SHORT = JSON.stringify({ body: 'hi' });
const VALID_DRAFT = JSON.stringify({ body: 'Thank you for your message, we will reply shortly.' });

/** openai answers first, anthropic second (balanced/general); the other providers must not be reached. */
function stubProviders(svc: ModelGatewayService, openai: () => Promise<unknown>, anthropic: () => Promise<unknown>) {
  const callOpenAi = vi.fn().mockImplementation(openai);
  const callAnthropic = vi.fn().mockImplementation(anthropic);
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
const recorded = () => (mockLLMCostService.recordCost as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

describe('RR-STRUCTURED-PARSE-INVALID-STATE: contract violations are typed and costed', () => {
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

  it('DoD (a): a violation records the paid call as invalid, the valid fallback is valid_after_fallback, and no circuit moves', async () => {
    const { callOpenAi, callAnthropic } = stubProviders(
      service,
      async () => ({ content: TOO_SHORT, usage }),
      async () => ({ content: VALID_DRAFT, usage }),
    );

    const result = await service.complete(baseRequest({ expectedContract: 'reply_draft' }));

    expect(callOpenAi).toHaveBeenCalledTimes(1); // a violation is not retried in place
    expect(callAnthropic).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ provider: 'anthropic', fallbackUsed: true, outputState: 'valid_after_fallback' });
    expect(result.contractValidation).toMatchObject({ valid: true, contractType: 'reply_draft' });

    await new Promise((r) => setImmediate(r));
    const rows = recorded();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      provider: 'openai',
      totalCost: 0.001,
      metadata: { contractType: 'reply_draft', outputState: 'invalid' },
    });
    expect(rows[0].metadata.contractErrors).toEqual(['Reply body must be a string of at least 10 characters']);
    expect(rows[1]).toMatchObject({ provider: 'anthropic', metadata: { contractType: 'reply_draft', outputState: 'valid_after_fallback' } });

    const openai = circuit(service, 'openai');
    expect(openai.failures).toBe(0);
    expect(openai.openUntil).toBeNull();
    expect(health(service, 'openai')).toMatchObject({ circuitOpen: false, available: true, lastFailureClass: 'contract_violation' });
  });

  it('DoD (b): when every candidate violates the contract, complete() rejects with AiContractViolationError listing each attempt', async () => {
    stubProviders(
      service,
      async () => ({ content: TOO_SHORT, usage }),
      async () => ({ content: JSON.stringify({ not_a_reply: true }), usage }),
    );

    const rejection = await service.complete(baseRequest({ expectedContract: 'reply_draft' })).catch((e) => e);

    expect(rejection).toBeInstanceOf(AiContractViolationError);
    expect(rejection).toBeInstanceOf(HttpException);
    expect(rejection.getStatus()).toBe(502);
    expect(rejection.message).toMatch(/^AI output contract violation \[reply_draft\]/);
    const body = rejection.getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'contract_violation', contractType: 'reply_draft', error: 'Bad Gateway' });
    expect(body.attempts).toEqual([
      { provider: 'openai', model: expect.any(String), errors: ['Reply body must be a string of at least 10 characters'] },
      { provider: 'anthropic', model: expect.any(String), errors: expect.arrayContaining([expect.stringMatching(/body/)]) },
    ]);

    await new Promise((r) => setImmediate(r));
    expect(recorded()).toHaveLength(2); // both paid calls are costed
    expect(recorded().every((r) => r.metadata.outputState === 'invalid')).toBe(true);
    expect(circuit(service, 'openai').failures).toBe(0);
    expect(circuit(service, 'anthropic').failures).toBe(0);
  });

  it('DoD (c): empty content with an expected contract is a violation ("Response is empty"), not a silent success', async () => {
    stubProviders(
      service,
      async () => ({ content: '', usage }),
      async () => ({ content: VALID_DRAFT, usage }),
    );

    const result = await service.complete(baseRequest({ expectedContract: 'reply_draft' }));
    expect(result).toMatchObject({ provider: 'anthropic', outputState: 'valid_after_fallback' });

    await new Promise((r) => setImmediate(r));
    expect(recorded()[0]).toMatchObject({ provider: 'openai', metadata: { outputState: 'invalid', contractErrors: ['Response is empty'] } });

    stubProviders(
      service,
      async () => ({ content: null, usage }),
      async () => ({ content: '', usage }),
    );
    const rejection = await service.complete(baseRequest({ expectedContract: 'reply_draft' })).catch((e) => e);
    expect(rejection).toBeInstanceOf(AiContractViolationError);
    expect((rejection.getResponse() as any).attempts.map((a: any) => a.errors)).toEqual([['Response is empty'], ['Response is empty']]);
  });

  it('negative control: a request without an expected contract is "unchecked" and no validation runs', async () => {
    stubProviders(
      service,
      async () => ({ content: '', usage }),
      async () => {
        throw new Error('must not be reached');
      },
    );
    const result = await service.complete(baseRequest());
    expect(result).toMatchObject({ provider: 'openai', outputState: 'unchecked', fallbackUsed: false });
    expect(result.contractValidation).toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].metadata).toMatchObject({ outputState: 'unchecked' });
  });

  it('a valid answer from the primary is "valid"; a valid answer after a provider failure (not a violation) is "valid" too', async () => {
    stubProviders(
      service,
      async () => ({ content: VALID_DRAFT, usage }),
      async () => {
        throw new Error('must not be reached');
      },
    );
    expect(await service.complete(baseRequest({ expectedContract: 'reply_draft' }))).toMatchObject({ provider: 'openai', outputState: 'valid' });

    stubProviders(
      service,
      async () => {
        throw new Error('HTTP 503 Service Unavailable');
      },
      async () => ({ content: VALID_DRAFT, usage }),
    );
    const afterOutage = await service.complete(baseRequest({ expectedContract: 'reply_draft' }));
    expect(afterOutage).toMatchObject({ provider: 'anthropic', fallbackUsed: true, outputState: 'valid' });
  });

  it('a violation followed by a provider outage still rejects as a contract violation; the detail names the failure class, never the provider text', async () => {
    // Review round 1: the 502 body is client-facing; a provider message can carry hosts, bodies or key fragments.
    stubProviders(
      service,
      async () => ({ content: TOO_SHORT, usage }),
      async () => {
        throw new Error('Anthropic API error (401): {"type":"error"} connect ECONNREFUSED 10.1.2.3:8080 sk-ant-secret');
      },
    );
    const rejection = await service.complete(baseRequest({ expectedContract: 'reply_draft' })).catch((e) => e);
    expect(rejection).toBeInstanceOf(AiContractViolationError);
    expect((rejection.getResponse() as any).attempts).toHaveLength(1);
    const body = JSON.stringify(rejection.getResponse());
    expect(rejection.message).toMatch(/another candidate failed with a provider error \(auth\)/);
    expect(body).not.toMatch(/10\.1\.2\.3|sk-ant|ECONNREFUSED|Anthropic API error/);
  });

  it('review round 1: a provider outage BEFORE the violation is worded the same way (no "later")', async () => {
    stubProviders(
      service,
      async () => {
        throw new Error('HTTP 503 Service Unavailable');
      },
      async () => ({ content: TOO_SHORT, usage }),
    );
    const rejection = await service.complete(baseRequest({ expectedContract: 'reply_draft' })).catch((e) => e);
    expect(rejection).toBeInstanceOf(AiContractViolationError);
    expect((rejection.getResponse() as any).attempts.map((a: any) => a.provider)).toEqual(['anthropic']);
    expect(rejection.message).toMatch(/another candidate failed with a provider error \(server\)/);
    expect(rejection.message).not.toMatch(/later/);
  });

  it('review round 1: a violation is one answered call in provider health, not a second call: totalCalls 1, totalErrors 1', async () => {
    stubProviders(
      service,
      async () => ({ content: TOO_SHORT, usage }),
      async () => ({ content: VALID_DRAFT, usage }),
    );
    await service.complete(baseRequest({ expectedContract: 'reply_draft' }));
    expect(health(service, 'openai')).toMatchObject({ totalCalls: 1, totalErrors: 1, lastFailureClass: 'contract_violation', circuitOpen: false });
    expect(health(service, 'anthropic')).toMatchObject({ totalCalls: 1, totalErrors: 0 });
    expect(health(service, 'openai').lastErrorAt).toBeTruthy();
  });

  it('the tool-call shape is validated too: malformed tool arguments are a violation, valid arguments pass', async () => {
    const toolCall = (args: string) => ({
      content: null,
      toolCalls: [{ id: 'c1', type: 'function' as const, function: { name: 'draft', arguments: args } }],
      usage,
    });
    stubProviders(
      service,
      async () => toolCall('{"body":"no"}'),
      async () => toolCall(VALID_DRAFT),
    );
    const result = await service.complete(baseRequest({ expectedContract: 'reply_draft' }));
    expect(result).toMatchObject({ provider: 'anthropic', outputState: 'valid_after_fallback' });
  });

  it("the classifier knows 'contract_violation': it never counts toward a circuit and is never retried", () => {
    const err = new AiContractViolationError('reply_draft', [{ provider: 'openai', model: 'gpt-4o', errors: ['x'] }]);
    expect(classifyProviderFailure(err)).toBe('contract_violation');
    expect(failureCountsTowardCircuit('contract_violation')).toBe(false);
    expect(failureIsRetryable('contract_violation')).toBe(false);
  });

  it('coerceToContractState reports coerced for an invalid payload and valid otherwise; coerceToContract keeps its shape', () => {
    const fallback = { body: 'fallback body that is long enough' };
    const invalid = coerceToContractState({ body: 'no' }, 'reply_draft', fallback);
    expect(invalid).toEqual({ value: fallback, state: 'coerced', errors: ['Reply body must be a string of at least 10 characters'] });
    const valid = coerceToContractState({ body: 'a perfectly fine reply body' }, 'reply_draft', fallback);
    expect(valid).toEqual({ value: { body: 'a perfectly fine reply body' }, state: 'valid', errors: [] });
    expect(coerceToContract({ body: 'no' }, 'reply_draft', fallback)).toBe(fallback);
    expect(coerceToContract({ body: 'a perfectly fine reply body' }, 'reply_draft', fallback)).toEqual({ body: 'a perfectly fine reply body' });
  });
});
