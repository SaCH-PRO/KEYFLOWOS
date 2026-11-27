/**
 * FU-OPENAI-FINISH-REASON (D-261, from RR-STREAM-ERROR-NO-EFFECTS):
 * Every OpenAI-SDK / OpenAI-compatible streaming adapter (openai, xai, kimi,
 * native, opensource, google) MUST require at least one chunk with a non-empty
 * `choices[0].finish_reason` before yielding `done`.
 *
 * A truncated upstream SSE/HTTP stream can close cleanly right after emitting
 * a complete tool call delta (valid JSON arguments) before any `finish_reason`
 * chunk arrives. Without this check, the adapter yields `{ type: 'done' }` and
 * FlowOrchestratorService executes the tool on an incomplete stream.
 *
 * All tests drive the real ModelGatewayService.streamComplete ->
 * callProviderStream -> stream<Provider> -> OpenAI SDK SSE parser over
 * scripted ReadableStream responses with global fetch stubbed (zero real
 * provider API traffic).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import OpenAI from 'openai';
import {
  ModelGatewayService,
  type AiProvider,
  type GatewayRequest,
  type StreamChunk,
} from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { RoleEngineService } from './role-engine.service';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService } from '../structure/job-role-policy.service';

type OpenAiCompatProvider = 'openai' | 'xai' | 'kimi' | 'native' | 'opensource' | 'google';

interface ProviderSpec {
  provider: OpenAiCompatProvider;
  model: string;
  expectedUrl: string;
  configureEnv: () => void;
}

const OPENAI_COMPAT_PROVIDERS: ProviderSpec[] = [
  {
    provider: 'openai',
    model: 'gpt-4o',
    expectedUrl: 'https://api.openai.com/v1/chat/completions',
    configureEnv: () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-openai-key';
      delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    },
  },
  {
    provider: 'xai',
    model: 'grok-2',
    expectedUrl: 'https://api.x.ai/v1/chat/completions',
    configureEnv: () => {
      process.env.XAI_API_KEY = 'test-xai-key';
    },
  },
  {
    provider: 'kimi',
    model: 'moonshot-v1-32k',
    expectedUrl: 'https://api.moonshot.cn/v1/chat/completions',
    configureEnv: () => {
      process.env.KIMI_API_KEY = 'test-kimi-key';
    },
  },
  {
    provider: 'native',
    model: 'native-test-model',
    expectedUrl: 'https://native-ai.example.invalid/v1/chat/completions',
    configureEnv: () => {
      process.env.KEYFLOW_NATIVE_AI_URL = 'https://native-ai.example.invalid/v1';
      process.env.NATIVE_AI_API_KEY = 'test-native-key';
    },
  },
  {
    provider: 'opensource',
    model: 'meta-llama/llama-3.3-70b-instruct',
    expectedUrl: 'https://openrouter.ai/api/v1/chat/completions',
    configureEnv: () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      delete process.env.OLLAMA_BASE_URL;
    },
  },
  {
    provider: 'google',
    model: 'gemini-2.0-flash',
    expectedUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    configureEnv: () => {
      process.env.GOOGLE_API_KEY = 'test-google-key';
      delete process.env.GEMINI_API_KEY;
    },
  },
];

/** Encode one OpenAI-compatible SSE data frame. */
const sseChunk = (payload: Record<string, unknown>): string => `data: ${JSON.stringify(payload)}\n\n`;
const SSE_DONE = 'data: [DONE]\n\n';

/** Recorded fixture frames: complete tool call with valid JSON arguments, NO finish_reason. */
const TOOL_CALL_NO_FINISH_FRAMES = [
  sseChunk({
    id: 'chatcmpl-fr-tool-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              index: 0,
              id: 'call_fr_1',
              type: 'function',
              function: { name: 'create_invoice', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }),
  sseChunk({
    id: 'chatcmpl-fr-tool-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '{"amount":10}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  }),
];

/** Recorded fixture frames: text delta only, NO finish_reason. */
const TEXT_NO_FINISH_FRAMES = [
  sseChunk({
    id: 'chatcmpl-fr-text-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: 'Partial reply without finish' },
        finish_reason: null,
      },
    ],
  }),
];

/** Recorded fixture frames: normal text stream with finish_reason: 'stop' + trailing usage-only chunk. */
const NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES = [
  sseChunk({
    id: 'chatcmpl-fr-stop-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: 'Hello ' },
        finish_reason: null,
      },
    ],
  }),
  sseChunk({
    id: 'chatcmpl-fr-stop-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { content: 'world!' },
        finish_reason: 'stop',
      },
    ],
  }),
  // OpenAI stream_options: { include_usage: true } sends a trailing chunk with choices: [] and usage.
  sseChunk({
    id: 'chatcmpl-fr-stop-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [],
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
  }),
  SSE_DONE,
];

/** Recorded fixture frames: normal tool_calls stream with finish_reason: 'tool_calls' + trailing usage-only chunk. */
const NORMAL_TOOL_CALLS_WITH_TRAILING_USAGE_FRAMES = [
  ...TOOL_CALL_NO_FINISH_FRAMES,
  sseChunk({
    id: 'chatcmpl-fr-tool-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      },
    ],
  }),
  sseChunk({
    id: 'chatcmpl-fr-tool-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'test-model',
    choices: [],
    usage: { prompt_tokens: 15, completion_tokens: 9, total_tokens: 24 },
  }),
  SSE_DONE,
];

function sseResponse(frames: string[], options?: { errorAfterFrames?: Error }): Response {
  const enc = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index < frames.length) {
          controller.enqueue(enc.encode(frames[index++]));
          return;
        }
        if (options?.errorAfterFrames) {
          controller.error(options.errorAfterFrames);
        } else {
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

let savedEnv: NodeJS.ProcessEnv;

function buildGateway(
  spec: ProviderSpec,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  fallbacks: Array<{ provider: AiProvider; model: string }> = [],
) {
  delete process.env.KEY_DISABLED;
  spec.configureEnv();

  // Intercept OpenAI SDK HTTP transport (openai@4 uses node-fetch internally,
  // not globalThis.fetch). This exercises the real OpenAI SDK SSE parser across
  // all six adapters with zero network traffic.
  const fetchStub = vi
    .spyOn(OpenAI.prototype as any, 'fetchWithTimeout')
    .mockImplementation(async (url: unknown, init: unknown) =>
      fetchImpl(String(url), init as RequestInit | undefined),
    );

  const cost = {
    recordCost: vi.fn().mockResolvedValue({}),
    getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }),
  } as unknown as LLMCostService;
  const prisma = {
    client: {
      aiMemory: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    },
  };
  const svc = new ModelGatewayService(prisma as any, cost, new LangfuseService());
  const s = svc as any;
  s.routingTableLoaded = true;
  s.getPreferences = vi.fn().mockResolvedValue({ aiMode: 'balanced' });
  s.resolveStrategy = vi.fn().mockReturnValue({
    primary: { provider: spec.provider, model: spec.model },
    fallbacks,
  });
  s.isProviderAvailable = vi.fn().mockReturnValue(true);
  const recordProviderSuccess = vi.spyOn(s, 'recordProviderSuccess');
  const recordProviderError = vi.spyOn(s, 'recordProviderError');
  const recordCostFromStream = vi.spyOn(s, 'recordCostFromStream');
  const loggedErrors = vi.spyOn(s.logger, 'error').mockImplementation(() => undefined);
  const loggedWarnings = vi.spyOn(s.logger, 'warn').mockImplementation(() => undefined);

  return {
    svc,
    fetchStub,
    recordProviderSuccess,
    recordProviderError,
    recordCostFromStream,
    loggedErrors,
    loggedWarnings,
  };
}

function makeRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    businessId: 'biz-fr-test-1',
    taskCategory: 'tool-calling',
    messages: [{ role: 'user', content: 'Create an invoice for $10' }],
    ...overrides,
  };
}

async function collect(svc: ModelGatewayService, req: GatewayRequest = makeRequest()): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of svc.streamComplete(req)) {
    chunks.push(chunk);
  }
  return chunks;
}

function makeOrchestratorOverGateway(gateway: ModelGatewayService) {
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const governance = {
    evaluate: vi.fn(async () => ({ allowed: false, reason: 'pinned: stopped at governance seam' })),
  };
  const trackAndStream = vi.fn((businessId: string, _userId: unknown, _feature: unknown, req: any) =>
    gateway.streamComplete({ ...req, businessId, taskCategory: 'tool-calling' }),
  );
  const finalizeStreamSession = vi.fn(async function* () {
    yield { type: 'done' };
  });
  const executeTool = vi.fn();

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    governance,
    roleEngine,
    executionLog: { log: async () => undefined, logToolExecution: async () => undefined },
    moduleRef: {
      get: (token: unknown) =>
        token === JobRolePolicyService
          ? policy
          : token === KeyActionBoundaryService
            ? { adopts: () => false }
            : undefined,
    },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async () => ({ business: { name: 'Biz' } }),
      buildContextString: () => '',
    },
    aiUsage: {
      checkRateLimit() {},
      checkCredits: async () => ({ allowed: true }),
      trackAndStream,
    },
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
  }) as FlowOrchestratorService;

  return { orchestrator, governance, trackAndStream, finalizeStreamSession, executeTool };
}

async function runOrchestrator(orchestrator: FlowOrchestratorService, businessId = 'biz-fr-orch-1') {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of orchestrator.streamChat(
    businessId,
    'invoice Ana $10',
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    'u_fr_1',
  )) {
    chunks.push(chunk as Record<string, unknown>);
  }
  return chunks;
}

describe('FU-OPENAI-FINISH-REASON: OpenAI-compatible stream adapters require finish_reason', () => {
  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe.each(OPENAI_COMPAT_PROVIDERS)('$provider adapter ($model)', (spec) => {
    it('complete tool call closing cleanly without finish_reason (EOF) ends in error, never done or usage', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(TOOL_CALL_NO_FINISH_FRAMES);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(chunks.some((c) => c.type === 'usage')).toBe(false);
      const errChunk = chunks.at(-1)!;
      expect(errChunk.provider).toBe(spec.provider);
      expect(errChunk.error).toContain(spec.provider);
      expect(errChunk.error).toMatch(/finish_reason/);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
      expect(t.recordProviderError.mock.calls[0][0]).toBe(spec.provider);
      expect(t.recordCostFromStream).not.toHaveBeenCalled();
      expect(t.fetchStub).toHaveBeenCalledTimes(1);
    });

    it('complete tool call followed by SSE [DONE] without finish_reason still ends in error, never done', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse([...TOOL_CALL_NO_FINISH_FRAMES, SSE_DONE]);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(chunks.at(-1)!.error).toMatch(/finish_reason/);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('text-only stream closing cleanly without finish_reason ends in error, never done', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(TEXT_NO_FINISH_FRAMES);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['content_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(chunks.some((c) => c.type === 'usage')).toBe(false);
      expect(chunks.at(-1)!.error).toContain(spec.provider);
      expect(chunks.at(-1)!.error).toMatch(/finish_reason/);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('empty stream (0 chunks) closing cleanly ends in error, never done', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse([]);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(chunks.some((c) => c.type === 'usage')).toBe(false);
      expect(chunks[0].error).toMatch(/finish_reason/);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('empty or whitespace finish_reason is rejected as missing', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse([
          sseChunk({
            id: 'chatcmpl-fr-blank',
            object: 'chat.completion.chunk',
            created: 1700000000,
            model: spec.model,
            choices: [{ index: 0, delta: { content: 'Partial' }, finish_reason: '   ' }],
          }),
          SSE_DONE,
        ]);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['content_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('control: normal stream with finish_reason="stop" and trailing usage-only chunk (choices: []) succeeds and yields done', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['content_delta', 'content_delta', 'usage', 'done']);
      expect(chunks.filter((c) => c.type === 'content_delta').map((c) => c.content).join('')).toBe('Hello world!');
      expect(chunks.find((c) => c.type === 'usage')!.usage).toMatchObject({
        promptTokens: 12,
        completionTokens: 7,
        totalTokens: 19,
      });
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      expect(t.recordProviderSuccess).toHaveBeenCalledTimes(1);
      expect(t.recordProviderError).not.toHaveBeenCalled();
    });

    it('control: normal stream with finish_reason="tool_calls" and trailing usage-only chunk yields tool call, usage, and done', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(NORMAL_TOOL_CALLS_WITH_TRAILING_USAGE_FRAMES);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual([
        'tool_call_delta',
        'tool_call_delta',
        'usage',
        'done',
      ]);
      const toolDeltas = chunks.filter((c) => c.type === 'tool_call_delta');
      expect(toolDeltas[0].toolCall).toMatchObject({ index: 0, id: 'call_fr_1', name: 'create_invoice' });
      expect(toolDeltas[1].toolCall).toMatchObject({ index: 0, argumentsDelta: '{"amount":10}' });
      expect(chunks.find((c) => c.type === 'usage')!.usage).toMatchObject({
        promptTokens: 15,
        completionTokens: 9,
        totalTokens: 24,
      });
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      expect(t.recordProviderSuccess).toHaveBeenCalledTimes(1);
      expect(t.recordProviderError).not.toHaveBeenCalled();
    });

    it('mid-stream transport error yields error and never done', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(TEXT_NO_FINISH_FRAMES, { errorAfterFrames: new Error('mid-stream socket reset') });
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['content_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(chunks.at(-1)!.provider).toBe(spec.provider);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('orchestrator seam: complete tool call closing cleanly without finish_reason executes NO tool, skips governance and finalization', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(TOOL_CALL_NO_FINISH_FRAMES);
      });
      const orch = makeOrchestratorOverGateway(t.svc);

      const chunks = await runOrchestrator(orch.orchestrator, `biz-orch-trunc-${spec.provider}`);

      expect(chunks.some((c) => c.type === 'tool_calls')).toBe(false);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(orch.governance.evaluate).not.toHaveBeenCalled();
      expect(orch.executeTool).not.toHaveBeenCalled();
      expect(orch.finalizeStreamSession).not.toHaveBeenCalled();
      expect(chunks.at(-1)).toMatchObject({
        type: 'error',
        error: expect.stringMatching(new RegExp(spec.provider)),
      });
    });

    it('orchestrator seam control: complete tool call WITH finish_reason="tool_calls" reaches governance', async () => {
      const t = buildGateway(spec, async (url) => {
        expect(url).toBe(spec.expectedUrl);
        return sseResponse(NORMAL_TOOL_CALLS_WITH_TRAILING_USAGE_FRAMES);
      });
      const orch = makeOrchestratorOverGateway(t.svc);

      const chunks = await runOrchestrator(orch.orchestrator, `biz-orch-ok-${spec.provider}`);

      expect(chunks.some((c) => c.type === 'tool_calls')).toBe(true);
      expect(orch.governance.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases and fallback semantics', () => {
    it('normal stream with finish_reason="stop" and NO usage chunk still succeeds and yields done', async () => {
      const nativeSpec = OPENAI_COMPAT_PROVIDERS.find((p) => p.provider === 'native')!;
      const t = buildGateway(nativeSpec, async () =>
        sseResponse([
          sseChunk({
            id: 'chatcmpl-no-usage',
            object: 'chat.completion.chunk',
            created: 1700000000,
            model: nativeSpec.model,
            choices: [{ index: 0, delta: { content: 'Self-hosted answer' }, finish_reason: 'stop' }],
          }),
          SSE_DONE,
        ]),
      );

      const chunks = await collect(t.svc);

      expect(chunks.some((c) => c.type === 'done')).toBe(true);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      expect(chunks.filter((c) => c.type === 'content_delta').map((c) => c.content)).toEqual(['Self-hosted answer']);
      expect(t.recordProviderSuccess).toHaveBeenCalledTimes(1);
      expect(t.recordProviderError).not.toHaveBeenCalled();
    });

    it('stream with a usage chunk but NO finish_reason still fails without emitting usage or done', async () => {
      const openaiSpec = OPENAI_COMPAT_PROVIDERS.find((p) => p.provider === 'openai')!;
      const t = buildGateway(openaiSpec, async () =>
        sseResponse([
          ...TOOL_CALL_NO_FINISH_FRAMES,
          sseChunk({
            id: 'chatcmpl-usage-no-finish',
            object: 'chat.completion.chunk',
            created: 1700000000,
            model: openaiSpec.model,
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
          }),
          SSE_DONE,
        ]),
      );

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunks.some((c) => c.type === 'usage')).toBe(false);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('opensource via OLLAMA_BASE_URL also rejects a tool call stream closing without finish_reason', async () => {
      const ollamaSpec: ProviderSpec = {
        provider: 'opensource',
        model: 'llama3.2',
        expectedUrl: 'http://127.0.0.1:11434/v1/chat/completions',
        configureEnv: () => {
          delete process.env.OPENROUTER_API_KEY;
          process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
        },
      };
      const t = buildGateway(ollamaSpec, async (url) => {
        expect(url).toBe(ollamaSpec.expectedUrl);
        return sseResponse(TOOL_CALL_NO_FINISH_FRAMES);
      });

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(t.recordProviderSuccess).not.toHaveBeenCalled();
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
    });

    it('truncated stream AFTER yielding a delta does NOT fall back to the next candidate', async () => {
      const openaiSpec = OPENAI_COMPAT_PROVIDERS.find((p) => p.provider === 'openai')!;
      process.env.XAI_API_KEY = 'test-xai-key';
      const t = buildGateway(
        openaiSpec,
        async (url) => {
          if (url === 'https://api.openai.com/v1/chat/completions') {
            return sseResponse(TOOL_CALL_NO_FINISH_FRAMES);
          }
          return sseResponse(NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES);
        },
        [{ provider: 'xai', model: 'grok-2' }],
      );

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(t.fetchStub).toHaveBeenCalledTimes(1);
    });

    it('empty 0-chunk stream (nothing yielded yet) can fall back cleanly to a healthy next candidate', async () => {
      const openaiSpec = OPENAI_COMPAT_PROVIDERS.find((p) => p.provider === 'openai')!;
      process.env.XAI_API_KEY = 'test-xai-key';
      const t = buildGateway(
        openaiSpec,
        async (url) => {
          if (url === 'https://api.openai.com/v1/chat/completions') {
            return sseResponse([]);
          }
          expect(url).toBe('https://api.x.ai/v1/chat/completions');
          return sseResponse(NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES);
        },
        [{ provider: 'xai', model: 'grok-2' }],
      );

      const chunks = await collect(t.svc);

      expect(chunks.map((c) => c.type)).toEqual(['content_delta', 'content_delta', 'usage', 'done']);
      expect(chunks[0]).toMatchObject({ provider: 'xai', fallbackUsed: true, fallbackProvider: 'xai' });
      expect(t.fetchStub).toHaveBeenCalledTimes(2);
      expect(t.recordProviderError).toHaveBeenCalledTimes(1);
      expect(t.recordProviderSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-tenant concurrent stream isolation', () => {
    it('finish_reason observed on business A never leaks to a concurrent truncated stream for business B (and vice versa)', async () => {
      const openaiSpec = OPENAI_COMPAT_PROVIDERS.find((p) => p.provider === 'openai')!;
      const enc = new TextEncoder();

      let releaseTenantBClose!: () => void;
      const tenantBCloseGate = new Promise<void>((resolve) => {
        releaseTenantBClose = resolve;
      });
      let notifyTenantADone!: () => void;
      const tenantADoneGate = new Promise<void>((resolve) => {
        notifyTenantADone = resolve;
      });

      const t = buildGateway(openaiSpec, async (_url, init) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ content?: string }>;
        };
        const userText = parsed.messages?.find((m) => m.content)?.content ?? '';

        if (userText.includes('TENANT_A')) {
          return new Response(
            new ReadableStream({
              async start(controller) {
                for (const frame of NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES) {
                  controller.enqueue(enc.encode(frame));
                }
                controller.close();
                notifyTenantADone();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(
          new ReadableStream({
            async start(controller) {
              for (const frame of TOOL_CALL_NO_FINISH_FRAMES) {
                controller.enqueue(enc.encode(frame));
              }
              // Wait until Tenant A has completed with finish_reason="stop", then close cleanly without finish_reason.
              await tenantADoneGate;
              await tenantBCloseGate;
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      });

      const reqA = makeRequest({
        businessId: 'biz-tenant-a',
        messages: [{ role: 'user', content: 'TENANT_A normal request' }],
      });
      const reqB = makeRequest({
        businessId: 'biz-tenant-b',
        messages: [{ role: 'user', content: 'TENANT_B truncated tool request' }],
      });

      const promiseA = collect(t.svc, reqA).then((res) => {
        releaseTenantBClose();
        return res;
      });
      const promiseB = collect(t.svc, reqB);

      const [chunksA, chunksB] = await Promise.all([promiseA, promiseB]);

      expect(chunksA.map((c) => c.type)).toEqual(['content_delta', 'content_delta', 'usage', 'done']);
      expect(chunksA.some((c) => c.type === 'error')).toBe(false);

      expect(chunksB.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunksB.some((c) => c.type === 'done')).toBe(false);
      expect(chunksB.at(-1)!.error).toMatch(/finish_reason/);
    });

    it('a concurrent truncated stream failing for business B never poisons a completing stream for business A', async () => {
      const googleSpec = OPENAI_COMPAT_PROVIDERS.find((p) => p.provider === 'google')!;
      const enc = new TextEncoder();

      let releaseTenantAFinish!: () => void;
      const tenantAFinishGate = new Promise<void>((resolve) => {
        releaseTenantAFinish = resolve;
      });

      const t = buildGateway(googleSpec, async (_url, init) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ content?: string }>;
        };
        const userText = parsed.messages?.find((m) => m.content)?.content ?? '';

        if (userText.includes('TENANT_B')) {
          return sseResponse(TOOL_CALL_NO_FINISH_FRAMES);
        }

        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(enc.encode(NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES[0]));
              await tenantAFinishGate;
              for (const frame of NORMAL_STOP_WITH_TRAILING_USAGE_FRAMES.slice(1)) {
                controller.enqueue(enc.encode(frame));
              }
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      });

      const reqA = makeRequest({
        businessId: 'biz-tenant-a-2',
        messages: [{ role: 'user', content: 'TENANT_A slow normal request' }],
      });
      const reqB = makeRequest({
        businessId: 'biz-tenant-b-2',
        messages: [{ role: 'user', content: 'TENANT_B fast truncated request' }],
      });

      const promiseA = collect(t.svc, reqA);
      const promiseB = collect(t.svc, reqB).then((res) => {
        releaseTenantAFinish();
        return res;
      });

      const [chunksA, chunksB] = await Promise.all([promiseA, promiseB]);

      expect(chunksB.map((c) => c.type)).toEqual(['tool_call_delta', 'tool_call_delta', 'error']);
      expect(chunksB.some((c) => c.type === 'done')).toBe(false);

      expect(chunksA.map((c) => c.type)).toEqual(['content_delta', 'content_delta', 'usage', 'done']);
      expect(chunksA.some((c) => c.type === 'error')).toBe(false);
    });
  });
});
