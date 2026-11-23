/**
 * RR-STREAM-ERROR-NO-EFFECTS (D-261): pins that FlowOrchestratorService.streamChat
 * executes no tool from a model stream that ended in an error chunk. The tool
 * calls collected before the error are not announced (no tool_calls chunk),
 * not put to governance, not executed, and the turn is not finalized as a
 * completed answer: the stream ends with the error chunk.
 *
 * This is a control on code that already stops on an error chunk
 * (flow-orchestrator.service.ts streamChat); it guards against a regression.
 * Scripted streams only: trackAndStream is a stand-in, no provider is called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { RoleEngineService } from './role-engine.service';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService } from '../structure/job-role-policy.service';
import { ModelGatewayService } from './model-gateway.service';
import { LangfuseService } from './langfuse.service';

const BIZ = 'biz_rr_stream_err';
const savedKeyDisabled = process.env.KEY_DISABLED;
beforeEach(() => {
  delete process.env.KEY_DISABLED;
});
afterEach(() => {
  if (savedKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = savedKeyDisabled;
});

function makeOrchestrator(script: (...args: any[]) => AsyncGenerator<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const governance = { evaluate: vi.fn(async () => ({ allowed: false, reason: 'pinned: not reached on error' })) };
  const trackAndStream = vi.fn(script);
  const finalizeStreamSession = vi.fn(async function* () {
    yield { type: 'done' };
  });
  const executeTool = vi.fn();
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    governance,
    roleEngine,
    executionLog: { log: async () => undefined, logToolExecution: async () => undefined },
    moduleRef: { get: (t: unknown) => (t === JobRolePolicyService ? policy : t === KeyActionBoundaryService ? { adopts: () => false } : undefined) },
    businessGraph: { invalidateCache() {}, getSnapshot: async () => ({ business: { name: 'Biz' } }), buildContextString: () => '' },
    aiUsage: { checkRateLimit() {}, checkCredits: async () => ({ allowed: true }), trackAndStream },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    selectToolsForRequest: async () => [],
    saveConversationHistory: vi.fn(async () => undefined),
    enforceDoNotSay: async () => undefined,
    finalizeStreamSession,
    executeTool,
    ...overrides,
  }) as FlowOrchestratorService;
  return { orchestrator, governance, trackAndStream, finalizeStreamSession, executeTool };
}

async function run(o: FlowOrchestratorService) {
  const chunks: any[] = [];
  for await (const chunk of o.streamChat(BIZ, 'invoice Ana', [], undefined, undefined, undefined, undefined, 'u_rr_1')) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('streamChat executes no tool after an error chunk (RR-STREAM-ERROR-NO-EFFECTS)', () => {
  it('a tool_call_delta then an error chunk: no tool_calls chunk, no governance, no execution, no finalized turn', async () => {
    const t = makeOrchestrator(async function* () {
      yield { type: 'content_delta', content: 'Creating the invoice', provider: 'openai', model: 'gpt-4o' };
      yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_rr_1', name: 'create_invoice', argumentsDelta: '{"amount":10}' } };
      yield { type: 'error', error: 'primary stream reset' };
    });

    const chunks = await run(t.orchestrator);

    expect(t.trackAndStream).toHaveBeenCalledTimes(1);
    expect(chunks.some((c) => c.type === 'tool_calls')).toBe(false);
    expect(t.governance.evaluate).not.toHaveBeenCalled();
    expect(t.executeTool).not.toHaveBeenCalled();
    expect(t.finalizeStreamSession).not.toHaveBeenCalled();
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'primary stream reset' });
  });

  it('control: the same tool call in a stream that completes is put to governance', async () => {
    const t = makeOrchestrator(async function* () {
      yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_rr_2', name: 'create_invoice', argumentsDelta: '{"amount":10}' } };
      yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 } };
    });

    const chunks = await run(t.orchestrator);

    expect(chunks.some((c) => c.type === 'tool_calls')).toBe(true);
    expect(t.governance.evaluate).toHaveBeenCalledTimes(1);
  });
});

/** One Anthropic SSE event. */
const sse = (type: string, data: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const ANTHROPIC_TOOL_BLOCK = [
  sse('message_start', { message: { usage: { input_tokens: 5 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_rr_f1', name: 'create_invoice', input: {} } }),
  sse('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"amount":10}' } }),
  sse('content_block_stop', { index: 0 }),
];
const ANTHROPIC_OVERLOADED = sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } });

/** The real gateway, routed to Anthropic only, over a scripted SSE body (fetch stubbed). */
function realGatewayOverAnthropic(events: string[]): ModelGatewayService {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(enc.encode(e));
        controller.close();
      },
    }), { status: 200 });
  }));
  const svc = new ModelGatewayService(
    { client: { aiMemory: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() } } } as any,
    { recordCost: vi.fn().mockResolvedValue({}), getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }) } as any,
    new LangfuseService(),
  );
  const s = svc as any;
  s.routingTableLoaded = true;
  s.getPreferences = vi.fn().mockResolvedValue({ aiMode: 'balanced' });
  s.resolveStrategy = vi.fn().mockReturnValue({ primary: { provider: 'anthropic', model: 'claude-test' }, fallbacks: [] });
  s.isProviderAvailable = vi.fn().mockReturnValue(true);
  vi.spyOn(s.logger, 'error').mockImplementation(() => undefined);
  return svc;
}

describe('streamChat over the real gateway and an Anthropic stream that fails (review SEC-A)', () => {
  const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
    vi.unstubAllGlobals();
  });

  it.each([
    ['a tool_use block then an SSE error event', [...ANTHROPIC_TOOL_BLOCK, ANTHROPIC_OVERLOADED]],
    ['a tool_use block then a clean close without message_stop', [...ANTHROPIC_TOOL_BLOCK]],
  ])('%s: the complete tool call is not put to governance or executed, and nothing is finalized', async (_title, events) => {
    const real = realGatewayOverAnthropic(events);
    const t = makeOrchestrator((businessId: string, _userId: unknown, _feature: unknown, req: any) =>
      real.streamComplete({ ...req, businessId, taskCategory: 'general' }),
    );

    const chunks = await run(t.orchestrator);

    expect(chunks.some((c) => c.type === 'tool_calls')).toBe(false);
    expect(t.governance.evaluate).not.toHaveBeenCalled();
    expect(t.executeTool).not.toHaveBeenCalled();
    expect(t.finalizeStreamSession).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: expect.stringMatching(/anthropic/) });
  });
});

describe('streamChat: the tool follow-up stream that ends in an error is not saved as the answer (review SEC-B)', () => {
  it('the tools ran, the follow-up streams part of an answer then an error chunk: the error is shown and the turn is not finalized', async () => {
    let call = 0;
    const t = makeOrchestrator(
      async function* () {
        call += 1;
        if (call === 1) {
          yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_rr_f2', name: 'expenses_list', argumentsDelta: '{}' } };
          yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 } };
          return;
        }
        yield { type: 'content_delta', content: 'Your expenses this mon' };
        yield { type: 'error', error: 'The openai stream failed part-way (Error)' };
      },
      {
        governance: { evaluate: vi.fn(async () => ({ allowed: true, tier: 0, reason: 'ok', requiresQuickConfirm: false, requiresFormalApproval: false })) },
        governToolCall: async (_b: string, tc: unknown, decision: unknown) => ({ tc, decision }),
      },
    );
    t.executeTool.mockResolvedValue({ toolCallId: 'call_rr_f2', name: 'expenses_list', success: true, result: { total: 1 } });

    const chunks = await run(t.orchestrator);

    expect(t.executeTool).toHaveBeenCalledTimes(1);
    expect(t.trackAndStream).toHaveBeenCalledTimes(2);
    expect(t.finalizeStreamSession).not.toHaveBeenCalled();
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'The openai stream failed part-way (Error)' });
  });
});
