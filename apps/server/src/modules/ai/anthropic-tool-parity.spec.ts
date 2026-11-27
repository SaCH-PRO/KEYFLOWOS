/**
 * RR-ANTHROPIC-TOOL-PARITY (P157):
 *
 * The Anthropic path (both non-streaming `callAnthropic` and streaming
 * `streamAnthropic`) must preserve tool-calling semantics:
 *   1. Assistant messages with `tool_calls` map to native Anthropic `tool_use`
 *      content blocks (with optional preceding `text` block), never dropped.
 *   2. Unparseable or non-object `tool_calls[].function.arguments` never crash;
 *      they emit `input: {}` and preserve the raw arguments in a `text` block.
 *      Normal `'{}'` / empty arguments emit `input: {}` with no bogus text block.
 *   3. `tool` messages map to native `tool_result` content blocks (no
 *      `[Tool result for ...]` text flattening), and consecutive `tool`
 *      messages merge into a single `user` message of `tool_result` blocks.
 *   4. `toolChoice: 'none'` omits both `tools` and `tool_choice` from the
 *      Anthropic request body; `'auto'`, `undefined`, `'required'`, and named
 *      tool choices still send `tools` and the expected `tool_choice`.
 *   5. Consecutive plain-string messages continue to merge as a string.
 *
 * Runs the real `complete` -> `callAnthropic` and `streamComplete` ->
 * `streamAnthropic` paths over a stubbed `globalThis.fetch` (no network calls).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ModelGatewayService,
  type GatewayRequest,
  type GatewayToolDefinition,
  type StreamChunk,
} from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

type DispatchPath = 'callAnthropic' | 'streamAnthropic';

interface CapturedAnthropicBody {
  model: string;
  system?: string;
  messages: Array<{
    role: string;
    content: string | Array<Record<string, unknown>>;
  }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: Record<string, unknown>;
  stream?: boolean;
}

const SAMPLE_TOOL: GatewayToolDefinition = {
  type: 'function',
  function: {
    name: 'crm_search',
    description: 'Search contacts in the CRM',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string' },
      },
      required: ['q'],
    },
  },
};

const sse = (type: string, data: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const MINIMAL_SSE_EVENTS = [
  sse('message_start', { message: { usage: { input_tokens: 10 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Done.' } }),
  sse('content_block_stop', { index: 0 }),
  sse('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }),
  sse('message_stop'),
];

let savedEnv: NodeJS.ProcessEnv;

function createGateway(path: DispatchPath) {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  delete process.env.KEY_DISABLED;

  const capturedBodies: CapturedAnthropicBody[] = [];

  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    capturedBodies.push(JSON.parse(rawBody) as CapturedAnthropicBody);

    if (path === 'streamAnthropic') {
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const event of MINIMAL_SSE_EVENTS) {
              controller.enqueue(enc.encode(event));
            }
            controller.close();
          },
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  vi.stubGlobal('fetch', fetchStub);

  const cost = {
    recordCost: vi.fn().mockResolvedValue({}),
    getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }),
  } as unknown as LLMCostService;

  const prisma = {
    client: {
      aiMemory: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    },
  };

  const svc = new ModelGatewayService(prisma as never, cost, new LangfuseService());
  const internal = svc as unknown as {
    routingTableLoaded: boolean;
    getPreferences: ReturnType<typeof vi.fn>;
    resolveStrategy: ReturnType<typeof vi.fn>;
    isProviderAvailable: ReturnType<typeof vi.fn>;
    delay: ReturnType<typeof vi.fn>;
  };
  internal.routingTableLoaded = true;
  internal.getPreferences = vi.fn().mockResolvedValue({ aiMode: 'balanced' });
  internal.resolveStrategy = vi.fn().mockReturnValue({
    primary: { provider: 'anthropic', model: 'claude-test' },
    fallbacks: [],
  });
  internal.isProviderAvailable = vi.fn().mockReturnValue(true);
  internal.delay = vi.fn().mockResolvedValue(undefined);

  return { svc, fetchStub, capturedBodies };
}

async function dispatchAndCapture(
  path: DispatchPath,
  requestOverrides: Partial<GatewayRequest>,
): Promise<CapturedAnthropicBody> {
  const { svc, fetchStub, capturedBodies } = createGateway(path);
  const request: GatewayRequest = {
    businessId: 'biz-anthropic-tool-parity',
    taskCategory: 'tool-calling',
    messages: [{ role: 'user', content: 'Hello' }],
    ...requestOverrides,
  };

  if (path === 'callAnthropic') {
    await svc.complete(request);
  } else {
    const chunks: StreamChunk[] = [];
    for await (const chunk of svc.streamComplete(request)) {
      chunks.push(chunk);
    }
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  }

  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(capturedBodies).toHaveLength(1);
  return capturedBodies[0];
}

describe.each<DispatchPath>(['callAnthropic', 'streamAnthropic'])(
  'Anthropic tool parity (%s)',
  (path) => {
    beforeEach(() => {
      savedEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = savedEnv;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('maps assistant tool_calls to tool_use blocks and tool messages to tool_result blocks without text flattening', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'Find contact x' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'crm_search', arguments: '{"q":"x"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: '[]' },
        ],
      });

      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Find contact x' });
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'crm_search', input: { q: 'x' } },
        ],
      });
      expect(body.messages[2]).toEqual({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '[]' },
        ],
      });
      expect(JSON.stringify(body)).not.toContain('[Tool result for');
    });

    it('merges consecutive tool messages into a single user message with ordered tool_result blocks', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'Check CRM and invoices' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'crm_search', arguments: '{"q":"x"}' },
              },
              {
                id: 'c2',
                type: 'function',
                function: { name: 'invoice_list', arguments: '{"status":"open"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: '[{"id":"contact-1"}]' },
          { role: 'tool', tool_call_id: 'c2', content: '[{"id":"inv-1"}]' },
        ],
      });

      expect(body.messages).toHaveLength(3);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'crm_search', input: { q: 'x' } },
          { type: 'tool_use', id: 'c2', name: 'invoice_list', input: { status: 'open' } },
        ],
      });
      expect(body.messages[2]).toEqual({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '[{"id":"contact-1"}]' },
          { type: 'tool_result', tool_use_id: 'c2', content: '[{"id":"inv-1"}]' },
        ],
      });
    });

    it('merges a tool_result block array with an adjacent user text message into one user message', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'Run search' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'crm_search', arguments: '{"q":"y"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: '[]' },
          { role: 'user', content: 'Please summarize the result.' },
        ],
      });

      expect(body.messages).toHaveLength(3);
      expect(body.messages[2]).toEqual({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '[]' },
          { type: 'text', text: 'Please summarize the result.' },
        ],
      });
    });

    it('preserves both text content and tool_use blocks when an assistant message has both', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'Search for Alice' },
          {
            role: 'assistant',
            content: 'Let me check your contacts.',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'crm_search', arguments: '{"q":"Alice"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: '[{"name":"Alice"}]' },
        ],
      });

      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check your contacts.' },
          { type: 'tool_use', id: 'c1', name: 'crm_search', input: { q: 'Alice' } },
        ],
      });
    });

    it('handles unparseable and non-object tool arguments without crashing by sending input {} and preserving raw text', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'Run tools' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_bad_json',
                type: 'function',
                function: { name: 'crm_search', arguments: '{not-valid-json' },
              },
              {
                id: 'c_array',
                type: 'function',
                function: { name: 'crm_search', arguments: '[1,2]' },
              },
              {
                id: 'c_number',
                type: 'function',
                function: { name: 'crm_search', arguments: '42' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c_bad_json', content: '{}' },
          { role: 'tool', tool_call_id: 'c_array', content: '{}' },
          { role: 'tool', tool_call_id: 'c_number', content: '{}' },
        ],
      });

      const assistantContent = body.messages[1].content;
      expect(Array.isArray(assistantContent)).toBe(true);
      const blocks = assistantContent as Array<Record<string, unknown>>;

      expect(blocks).toContainEqual({
        type: 'tool_use',
        id: 'c_bad_json',
        name: 'crm_search',
        input: {},
      });
      expect(blocks).toContainEqual({
        type: 'tool_use',
        id: 'c_array',
        name: 'crm_search',
        input: {},
      });
      expect(blocks).toContainEqual({
        type: 'tool_use',
        id: 'c_number',
        name: 'crm_search',
        input: {},
      });

      const textBlocks = blocks
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''));
      expect(textBlocks.some((t) => t.includes('{not-valid-json'))).toBe(true);
      expect(textBlocks.some((t) => t.includes('[1,2]'))).toBe(true);
      expect(textBlocks.some((t) => t.includes('42'))).toBe(true);
    });

    it('sends input {} with no bogus text block for empty or "{}" tool arguments', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'List everything' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_empty_obj',
                type: 'function',
                function: { name: 'crm_search', arguments: '{}' },
              },
              {
                id: 'c_empty_str',
                type: 'function',
                function: { name: 'crm_search', arguments: '' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c_empty_obj', content: '[]' },
          { role: 'tool', tool_call_id: 'c_empty_str', content: '[]' },
        ],
      });

      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c_empty_obj', name: 'crm_search', input: {} },
          { type: 'tool_use', id: 'c_empty_str', name: 'crm_search', input: {} },
        ],
      });
    });

    it('omits tools and tool_choice from the Anthropic body when toolChoice is "none"', async () => {
      const body = await dispatchAndCapture(path, {
        tools: [SAMPLE_TOOL],
        toolChoice: 'none',
      });

      expect('tools' in body).toBe(false);
      expect(body.tools).toBeUndefined();
      expect('tool_choice' in body).toBe(false);
      expect(body.tool_choice).toBeUndefined();
    });

    it('negative controls: sends tools and expected tool_choice for auto, undefined, required, and named tool', async () => {
      const autoBody = await dispatchAndCapture(path, {
        tools: [SAMPLE_TOOL],
        toolChoice: 'auto',
      });
      expect(autoBody.tools).toHaveLength(1);
      expect(autoBody.tools?.[0].name).toBe('crm_search');
      expect(autoBody.tool_choice).toEqual({ type: 'auto' });

      const defaultBody = await dispatchAndCapture(path, {
        tools: [SAMPLE_TOOL],
      });
      expect(defaultBody.tools).toHaveLength(1);
      expect(defaultBody.tool_choice).toBeUndefined();

      const requiredBody = await dispatchAndCapture(path, {
        tools: [SAMPLE_TOOL],
        toolChoice: 'required',
      });
      expect(requiredBody.tools).toHaveLength(1);
      expect(requiredBody.tool_choice).toEqual({ type: 'any' });

      const namedBody = await dispatchAndCapture(path, {
        tools: [SAMPLE_TOOL],
        toolChoice: { type: 'function', function: { name: 'crm_search' } },
      });
      expect(namedBody.tools).toHaveLength(1);
      expect(namedBody.tool_choice).toEqual({ type: 'tool', name: 'crm_search' });
    });

    it('preserves plain-string merging for consecutive string user messages', async () => {
      const body = await dispatchAndCapture(path, {
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'user', content: 'Second message' },
        ],
      });

      expect(body.messages).toEqual([
        { role: 'user', content: 'First message\n\nSecond message' },
      ]);
    });
  },
);
