/**
 * RR-STREAM-ERROR-NO-EFFECTS acceptance review SEC-A (D-261): an Anthropic
 * stream that reports an error mid-way (an SSE `error` event, such as
 * overloaded_error) or closes before `message_stop` is a failed stream. It
 * ends in one error chunk, never in usage + done, and the provider is not
 * recorded as a success. The error chunk names the provider and the error
 * type only: no provider message text, no URL (review SEC-C).
 *
 * The real streamComplete -> callProviderStream -> streamAnthropic path runs
 * over a scripted SSE body: global fetch is stubbed, no provider is called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModelGatewayService, type GatewayRequest, type StreamChunk } from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

/** One Anthropic SSE event. */
const sse = (type: string, data: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const TOOL_BLOCK = [
  sse('message_start', { message: { usage: { input_tokens: 5 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_rr_1', name: 'expenses_list', input: {} } }),
  sse('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
  sse('content_block_stop', { index: 0 }),
];
const OVERLOADED = sse('error', { error: { type: 'overloaded_error', message: 'Overloaded: see https://status.example.invalid/body-text' } });
const END = [
  sse('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }),
  sse('message_stop'),
];

let savedEnv: NodeJS.ProcessEnv;

function gatewayOver(events: string[]) {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  delete process.env.KEY_DISABLED;
  const fetchStub = vi.fn(async (url: string) => {
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const e of events) controller.enqueue(enc.encode(e));
          controller.close();
        },
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchStub);
  const cost = {
    recordCost: vi.fn().mockResolvedValue({}),
    getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }),
  } as unknown as LLMCostService;
  const prisma = { client: { aiMemory: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() } } };
  const svc = new ModelGatewayService(prisma as any, cost, new LangfuseService());
  const s = svc as any;
  s.routingTableLoaded = true;
  s.getPreferences = vi.fn().mockResolvedValue({ aiMode: 'balanced' });
  s.resolveStrategy = vi.fn().mockReturnValue({ primary: { provider: 'anthropic', model: 'claude-test' }, fallbacks: [] });
  s.isProviderAvailable = vi.fn().mockReturnValue(true);
  const recordProviderSuccess = vi.spyOn(s, 'recordProviderSuccess');
  const recordProviderError = vi.spyOn(s, 'recordProviderError');
  const loggedErrors = vi.spyOn(s.logger, 'error').mockImplementation(() => undefined);
  const loggedWarnings = vi.spyOn(s.logger, 'warn').mockImplementation(() => undefined);
  return { svc, fetchStub, recordProviderSuccess, recordProviderError, loggedErrors, loggedWarnings };
}

const request: GatewayRequest = {
  businessId: 'biz-rr-anthropic-1',
  taskCategory: 'general',
  messages: [{ role: 'user', content: 'Hi' }],
};

async function collect(svc: ModelGatewayService) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of svc.streamComplete(request)) chunks.push(chunk);
  return chunks;
}

describe('streamAnthropic: a stream that errors or is cut off is a failed stream (SEC-A, SEC-C)', () => {
  beforeEach(() => {
    savedEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = savedEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a tool_use block then an SSE error event ends in one sanitised error chunk, not usage + done', async () => {
    const t = gatewayOver([...TOOL_BLOCK, OVERLOADED]);

    const chunks = await collect(t.svc);

    expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
    const error = chunks.at(-1)!;
    expect(error.error).toMatch(/anthropic/);
    expect(error.error).toMatch(/overloaded_error/);
    expect(error.error).not.toMatch(/Overloaded:|https?:|body-text/);
    expect(t.recordProviderSuccess).not.toHaveBeenCalled();
    expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    expect(t.fetchStub).toHaveBeenCalledTimes(1);
  });

  it('a tool_use block then a clean close without message_stop ends in one error chunk, not usage + done', async () => {
    const t = gatewayOver([...TOOL_BLOCK]);

    const chunks = await collect(t.svc);

    expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
    expect(chunks.at(-1)!.error).toMatch(/anthropic/);
    expect(t.recordProviderSuccess).not.toHaveBeenCalled();
    expect(t.recordProviderError).toHaveBeenCalledTimes(1);
  });

  it('control: a complete stream ending in message_stop yields its tool deltas, usage and done, and records success', async () => {
    const t = gatewayOver([...TOOL_BLOCK, ...END]);

    const chunks = await collect(t.svc);

    expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'usage', 'done']);
    expect(chunks.find((c) => c.type === 'usage')!.usage).toMatchObject({ promptTokens: 5, completionTokens: 3 });
    expect(t.recordProviderSuccess).toHaveBeenCalledTimes(1);
    expect(t.recordProviderError).not.toHaveBeenCalled();
  });

  it('delta review: an error event whose error field is falsy still fails the stream, even when message_stop follows', async () => {
    const t = gatewayOver([...TOOL_BLOCK, sse('error', { error: '' }), ...END]);

    const chunks = await collect(t.svc);

    expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
    expect(chunks.at(-1)!.error).toBe('The anthropic stream failed part-way (ProviderStreamError: unknown_error)');
    expect(t.recordProviderSuccess).not.toHaveBeenCalled();
  });

  it('delta review: a final message_stop frame with no trailing newline is still read, so a complete stream is not failed', async () => {
    const t = gatewayOver([...TOOL_BLOCK, END[0], 'event: message_stop\ndata: {"type":"message_stop"}']);

    const chunks = await collect(t.svc);

    expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'usage', 'done']);
    expect(t.recordProviderSuccess).toHaveBeenCalledTimes(1);
  });

  it('delta review: the provider message is logged on one line, bounded, never verbatim', async () => {
    const hostile = `line one\nFAKE LOG LINE ${'x'.repeat(2000)}`;
    const t = gatewayOver([...TOOL_BLOCK, sse('error', { error: { type: 'overloaded_error', message: hostile } })]);

    await collect(t.svc);

    const lines = [...t.loggedWarnings.mock.calls, ...t.loggedErrors.mock.calls].map(([m]) => String(m));
    expect(lines.some((l) => l.includes('overloaded_error'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toMatch(/[\r\n]/);
      expect(l.length).toBeLessThan(600);
    }
  });
});
