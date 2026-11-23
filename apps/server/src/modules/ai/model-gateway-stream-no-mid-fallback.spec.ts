/**
 * RR-STREAM-ERROR-NO-EFFECTS (D-261): streamComplete falls back to the next
 * candidate only while nothing has been yielded from the failing one. Once a
 * chunk of a candidate has reached the consumer, a later failure of that
 * candidate ends the stream with one error chunk: no second provider's answer
 * is spliced onto the first one's partial output, and no tool_call_delta of a
 * second provider lands on the indexes the first one already used.
 *
 * Scripted provider streams only: callProviderStream is replaced, so no SDK
 * client is built and no provider is called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModelGatewayService, type AiProvider, type GatewayRequest, type StreamChunk } from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

const prisma = {
  client: {
    aiMemory: { findUnique: vi.fn(), upsert: vi.fn() },
    llmProviderCost: { create: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
  },
};

type Script = (provider: AiProvider) => AsyncGenerator<StreamChunk>;

let savedEnv: NodeJS.ProcessEnv;

function gatewayWith(script: Script) {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  delete process.env.KEY_DISABLED;
  const cost = {
    recordCost: vi.fn().mockResolvedValue({}),
    getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }),
  } as unknown as LLMCostService;
  const svc = new ModelGatewayService(prisma as any, cost, new LangfuseService());
  const s = svc as any;
  s.routingTableLoaded = true;
  s.getPreferences = vi.fn().mockResolvedValue({ aiMode: 'balanced' });
  s.resolveStrategy = vi.fn().mockReturnValue({
    primary: { provider: 'openai', model: 'primary-model' },
    fallbacks: [{ provider: 'anthropic', model: 'fallback-model' }],
  });
  s.isProviderAvailable = vi.fn().mockReturnValue(true);
  const callProviderStream = vi.fn((_req: GatewayRequest, provider: AiProvider) => script(provider));
  s.callProviderStream = callProviderStream;
  const recordProviderError = vi.spyOn(s, 'recordProviderError');
  const loggedErrors = vi.spyOn(s.logger, 'error').mockImplementation(() => undefined);
  return { svc, callProviderStream, recordProviderError, loggedErrors };
}

const request: GatewayRequest = {
  businessId: 'biz-stream-1',
  taskCategory: 'general',
  messages: [{ role: 'user', content: 'Hi' }],
};

async function collect(svc: ModelGatewayService): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of svc.streamComplete(request)) chunks.push(chunk);
  return chunks;
}

describe('streamComplete: no fallback after partial output (RR-STREAM-ERROR-NO-EFFECTS)', () => {
  beforeEach(() => {
    savedEnv = { ...process.env };
    prisma.client.aiMemory.findUnique.mockResolvedValue(null);
  });
  afterEach(() => {
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it('a candidate that throws after yielding a delta does not fall back', async () => {
    const { svc, callProviderStream, recordProviderError, loggedErrors } = gatewayWith(async function* (provider) {
      if (provider === 'openai') {
        yield { type: 'content_delta', content: 'Hel' };
        throw new Error('primary stream reset');
      }
      yield { type: 'content_delta', content: 'Hello' };
      yield { type: 'done' };
    });

    const chunks = await collect(svc);

    expect(chunks.map((c) => [c.type, c.content])).toEqual([
      ['content_delta', 'Hel'],
      ['error', undefined],
    ]);
    expect(chunks[1]).toMatchObject({ type: 'error', provider: 'openai' });
    // Review SEC-C: the member sees the provider and the error class, never the
    // provider's own message; that stays in the server log.
    expect(chunks[1].error).toBe('The openai stream failed part-way (Error)');
    expect(loggedErrors).toHaveBeenCalledWith(expect.stringContaining('primary stream reset'));
    expect(callProviderStream).toHaveBeenCalledTimes(1);
    // The provider error is still recorded on the failing candidate's circuit.
    expect(recordProviderError).toHaveBeenCalledTimes(1);
    expect(recordProviderError.mock.calls[0][0]).toBe('openai');
  });

  it('a candidate that throws after yielding a tool_call_delta does not hand the fallback the same tool index', async () => {
    const { svc, callProviderStream } = gatewayWith(async function* (provider) {
      if (provider === 'openai') {
        yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_a', name: 'create_invoice', argumentsDelta: '{"amou' } };
        throw new Error('primary stream reset');
      }
      yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_b', name: 'delete_contact', argumentsDelta: '{"id":"x"}' } };
      yield { type: 'done' };
    });

    const chunks = await collect(svc);

    expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'error']);
    expect(chunks.filter((c) => c.toolCall?.name === 'delete_contact')).toHaveLength(0);
    expect(callProviderStream).toHaveBeenCalledTimes(1);
  });

  it('control: a candidate that fails before yielding anything still falls back', async () => {
    const { svc, callProviderStream, recordProviderError } = gatewayWith(async function* (provider) {
      if (provider === 'openai') {
        throw new Error('primary refused');
      }
      yield { type: 'content_delta', content: 'Hello' };
      yield { type: 'done' };
    });

    const chunks = await collect(svc);

    expect(chunks.filter((c) => c.type === 'error')).toHaveLength(0);
    expect(chunks.filter((c) => c.type === 'content_delta').map((c) => c.content)).toEqual(['Hello']);
    expect(chunks[0]).toMatchObject({ provider: 'anthropic', fallbackUsed: true, fallbackProvider: 'anthropic' });
    expect(callProviderStream).toHaveBeenCalledTimes(2);
    expect(recordProviderError).toHaveBeenCalledTimes(1);
  });

  it('control: every candidate failing before output still ends in one error chunk', async () => {
    const { svc } = gatewayWith(async function* (provider) {
      throw new Error(`${provider} refused`);
    });

    const chunks = await collect(svc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error', error: 'anthropic refused' });
  });
});
