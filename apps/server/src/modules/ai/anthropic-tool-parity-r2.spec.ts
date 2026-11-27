/**
 * RR-ANTHROPIC-TOOL-PARITY (P157) R2 security hardening specs:
 *   - SEC-P157-1: empty/missing tool_call_id never emits invalid tool_result(tool_use_id: ''),
 *     and empty/duplicate tool_use IDs are deduplicated deterministically.
 *   - SEC-P157-2: merged user turns always place tool_result blocks ahead of text/other blocks.
 *   - SEC-P157-3: malformed tool_calls (missing function, non-string arguments) never crash.
 *   - SEC-P157-4: prototype-pollution keys (__proto__, constructor, prototype) are stripped
 *     recursively from parsed tool_use.input.
 *   - SEC-P157-5: oversized unparseable tool arguments are capped and framed cleanly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ModelGatewayService,
  type GatewayRequest,
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
}

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
  const rawPayloads: string[] = [];

  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    rawPayloads.push(rawBody);
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

  const langfuse = {
    traceGeneration: vi.fn(),
  } as unknown as LangfuseService;

  const gateway = new ModelGatewayService(cost, langfuse);
  return { gateway, capturedBodies, rawPayloads };
}

async function dispatch(
  gateway: ModelGatewayService,
  path: DispatchPath,
  req: Omit<GatewayRequest, 'businessId' | 'provider'>,
): Promise<void> {
  const fullReq: GatewayRequest = {
    businessId: 'biz_p157_r2',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    ...req,
  };
  if (path === 'callAnthropic') {
    await gateway.complete(fullReq);
  } else {
    const chunks: StreamChunk[] = [];
    for await (const chunk of gateway.streamComplete(fullReq)) {
      chunks.push(chunk);
    }
  }
}

describe.each<DispatchPath>(['callAnthropic', 'streamAnthropic'])(
  'P157 R2 security hardening (%s)',
  (path) => {
    beforeEach(() => {
      savedEnv = { ...process.env };
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      process.env = savedEnv;
    });

    it('[SEC-P157-1a] missing or blank tool_call_id never emits tool_result with empty tool_use_id', async () => {
      const { gateway, capturedBodies } = createGateway(path);
      await dispatch(gateway, path, {
        messages: [
          { role: 'user', content: 'Find John' },
          { role: 'tool', tool_call_id: '', content: '{"ok":true}' },
          { role: 'tool', tool_call_id: '   ', content: 'orphan result' },
          { role: 'tool', content: 'missing id result' } as never,
        ],
      });

      const body = capturedBodies[0];
      const allBlocks = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const toolResults = allBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toEqual([]);
      expect(JSON.stringify(body.messages)).toContain('orphan result');
    });

    it('[SEC-P157-1b] missing and duplicate tool_use IDs are synthesized/deduplicated to unique non-empty IDs', async () => {
      const { gateway, capturedBodies } = createGateway(path);
      await dispatch(gateway, path, {
        messages: [
          { role: 'user', content: 'Run searches' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_dup', type: 'function', function: { name: 'crm_search', arguments: '{"q":"a"}' } },
              { id: 'call_dup', type: 'function', function: { name: 'crm_search', arguments: '{"q":"b"}' } },
              { id: '', type: 'function', function: { name: 'crm_search', arguments: '{"q":"c"}' } },
            ],
          },
        ],
      });

      const assistantMsg = capturedBodies[0].messages.find((m) => m.role === 'assistant');
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      const toolUses = (assistantMsg!.content as Array<Record<string, unknown>>).filter(
        (b) => b.type === 'tool_use',
      );
      expect(toolUses).toHaveLength(3);
      const ids = toolUses.map((b) => b.id as string);
      expect(ids.every((id) => typeof id === 'string' && id.trim().length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(3);
      expect(ids[0]).toBe('call_dup');
    });

    it('[SEC-P157-2] merged user turns place all tool_result blocks before text blocks', async () => {
      const { gateway, capturedBodies } = createGateway(path);
      await dispatch(gateway, path, {
        messages: [
          { role: 'user', content: 'Context before tool' },
          { role: 'tool', tool_call_id: 'call_1', content: '{"a":1}' },
          { role: 'user', content: 'Note between tools' },
          { role: 'tool', tool_call_id: 'call_2', content: '{"b":2}' },
        ],
      });

      const userMsg = capturedBodies[0].messages[0];
      expect(userMsg.role).toBe('user');
      expect(Array.isArray(userMsg.content)).toBe(true);
      const blocks = userMsg.content as Array<Record<string, unknown>>;
      expect(blocks.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'text', 'text']);
      expect(blocks[0].tool_use_id).toBe('call_1');
      expect(blocks[1].tool_use_id).toBe('call_2');
    });

    it('[SEC-P157-3] malformed tool_calls (missing function or non-string arguments) do not throw', async () => {
      const { gateway, capturedBodies } = createGateway(path);
      await dispatch(gateway, path, {
        messages: [
          { role: 'user', content: 'Test malformed' },
          {
            role: 'assistant',
            content: 'Working...',
            tool_calls: [
              { id: 'call_obj', type: 'function', function: { name: 'crm_search', arguments: { q: 'alice' } as never } },
              { id: 'call_num', type: 'function', function: { name: 'crm_search', arguments: 42 as never } },
              { id: 'call_bad', type: 'function', function: undefined as never },
            ],
          },
        ],
      });

      const assistantMsg = capturedBodies[0].messages.find((m) => m.role === 'assistant');
      const blocks = assistantMsg!.content as Array<Record<string, unknown>>;
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      expect(toolUses).toHaveLength(2);
      expect(toolUses[0]).toMatchObject({ id: 'call_obj', name: 'crm_search', input: { q: 'alice' } });
      expect(toolUses[1]).toMatchObject({ id: 'call_num', name: 'crm_search', input: {} });
    });

    it('[SEC-P157-4] strips __proto__, constructor, and prototype keys recursively from tool_use.input', async () => {
      const { gateway, rawPayloads } = createGateway(path);
      await dispatch(gateway, path, {
        messages: [
          { role: 'user', content: 'Test proto' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_proto',
                type: 'function',
                function: {
                  name: 'crm_search',
                  arguments:
                    '{"q":"safe","__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{"admin":true}},"ok":1}}',
                },
              },
            ],
          },
        ],
      });

      const raw = rawPayloads[0];
      expect(raw).not.toContain('"__proto__"');
      expect(raw).not.toContain('"constructor"');
      expect(raw).not.toContain('"prototype"');
      expect(raw).toContain('"q":"safe"');
      expect(raw).toContain('"ok":1');
    });

    it('[SEC-P157-5] caps oversized unparseable tool arguments and frames them safely', async () => {
      const { gateway, capturedBodies } = createGateway(path);
      const huge = '{broken:' + 'A'.repeat(20_000);
      await dispatch(gateway, path, {
        messages: [
          { role: 'user', content: 'Test huge' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_huge',
                type: 'function',
                function: { name: 'crm_search', arguments: huge },
              },
            ],
          },
        ],
      });

      const assistantMsg = capturedBodies[0].messages.find((m) => m.role === 'assistant');
      const blocks = assistantMsg!.content as Array<Record<string, unknown>>;
      const textBlock = blocks.find((b) => b.type === 'text') as { text: string } | undefined;
      expect(textBlock).toBeDefined();
      expect(textBlock!.text.length).toBeLessThanOrEqual(8_300);
      expect(textBlock!.text).toContain('[Unparseable tool arguments]');
      expect(textBlock!.text).toContain('...[truncated]');
    });
  },
);
