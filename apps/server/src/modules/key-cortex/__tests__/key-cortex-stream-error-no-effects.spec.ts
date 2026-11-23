/**
 * RR-STREAM-ERROR-NO-EFFECTS (D-261): a cortex streamQuery whose model stream
 * ends in an error chunk has no effects. The tool calls assembled from that
 * stream are not handed to the tool loop (memberToolLoop / handleToolCalls),
 * the commands parsed from its partial text are not detected or executed, and
 * the partial answer is not saved or reported as a completed turn: the stream
 * ends with the error chunk, never with 'done'.
 *
 * Scripted gateway streams only: no provider is called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';
import { KeyCortexMemoryRetrievalService } from '../key-cortex-memory-retrieval.service';
import { ModelGatewayService } from '../../ai/model-gateway.service';
import { LangfuseService } from '../../ai/langfuse.service';

/** One Anthropic SSE event. */
const sse = (type: string, data: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const ANTHROPIC_TOOL_BLOCK = [
  sse('message_start', { message: { usage: { input_tokens: 5 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_rr_c1', name: 'expenses_list', input: {} } }),
  sse('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
  sse('content_block_stop', { index: 0 }),
];
const ANTHROPIC_OVERLOADED = sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } });

/**
 * The real ModelGatewayService, routed to Anthropic only, over a scripted SSE
 * body (global fetch stubbed: no provider is called).
 */
function realGatewayOverAnthropic(events: string[]): ModelGatewayService {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  delete process.env.KEY_DISABLED;
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

const prisma = {
  client: {
    cortexSession: { create: vi.fn(), update: vi.fn() },
    cortexMessage: { createMany: vi.fn() },
    // user-1 is the OWNER of biz-1, so the tool authority lets every call through.
    user: { findUnique: vi.fn(async () => ({ role: 'USER' })) },
    membership: { findUnique: vi.fn(async () => ({ role: 'OWNER', permissionScopes: null })) },
    business: { findFirst: vi.fn(async () => ({ id: 'biz-1' })) },
    cognitionMemory: { findMany: vi.fn(async () => [] as Array<{ id: string }>) },
  },
};

const gateway = { complete: vi.fn(), streamComplete: vi.fn() };
const toolLoop = { handleToolCalls: vi.fn() };
const actionDetection = { detectActions: vi.fn() };
const actions = { buildToolDefinitions: vi.fn().mockResolvedValue([]), executeActions: vi.fn().mockResolvedValue([]) };
const session = {
  id: 'session_rr_stream_1',
  businessId: 'biz-1',
  userId: 'user-1',
  status: 'active',
  persona: 'jarvis',
  messages: [],
};
const sessions = {
  getOrCreateSession: vi.fn(),
  generateId: vi.fn().mockReturnValue('msg_rr_stream_1'),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateSessionCognitionMetadata: vi.fn().mockResolvedValue(undefined),
  updateRunningSummary: vi.fn().mockResolvedValue(undefined),
};
const executorService = {
  executeBatch: vi.fn(),
  executeWithApproval: vi.fn(),
  logExecution: vi.fn().mockResolvedValue(undefined),
};
const eventService = { logEvent: vi.fn().mockResolvedValue(undefined) };
const autonomyOrchestrator = { evaluateAction: vi.fn().mockResolvedValue({ allowed: true, requiresApproval: false, tier: 'AUTOPILOT' }) };

const route = {
  taskCategory: 'general',
  layers: ['ethics'],
  promptVariant: 'concise',
  includeGenomeContext: false,
  includeMemoryContext: false,
  includeActions: true,
  complexity: 'simple',
  domain: 'general',
  urgency: 'low',
  emotionalWeight: 'low',
  timeHorizon: 'tactical',
  dataRequirement: 'none',
};

function pipeline() {
  const memoryRetrieval = new KeyCortexMemoryRetrievalService({
    retrieveContext: vi.fn().mockResolvedValue([]),
    retrieveEpisodicContext: vi.fn().mockResolvedValue([]),
  } as any);
  const p = new KeyCortexQueryPipelineService(
    gateway as any,
    prisma as any,
    { get: vi.fn(), setex: vi.fn() } as any,
    {
      getPersonalityConfig: vi.fn().mockReturnValue({ persona: 'jarvis', temperature: 0.7 }),
      buildSystemPrompt: vi.fn().mockReturnValue('You are KEY.'),
      buildValueBlock: vi.fn().mockResolvedValue(''),
      classifyPersona: vi.fn().mockResolvedValue(undefined),
      selectTone: vi.fn().mockResolvedValue({ tone: '', temperatureAdjustment: 0 }),
    } as any,
    {
      buildContextSnapshot: vi.fn().mockResolvedValue({ businessId: 'biz-1', genomeStage: 'startup', executiveReadiness: 50 }),
      formatContextForPrompt: vi.fn().mockReturnValue(''),
    } as any,
    actions as any,
    sessions as any,
    { buildMemoryContext: vi.fn().mockResolvedValue({}), buildMessages: vi.fn().mockReturnValue([]) } as any,
    toolLoop as any,
    actionDetection as any,
    { generateSuggestions: vi.fn().mockResolvedValue([]) } as any,
    { getGenomeEnrichedContext: vi.fn().mockResolvedValue(null) } as any,
    { buildV3SystemPrompt: vi.fn(), buildV2SystemPrompt: vi.fn().mockReturnValue('V2 prompt') } as any,
    {
      classifyTaskCategory: vi.fn().mockReturnValue('general'),
      buildStructuredOutputInstructions: vi.fn().mockReturnValue(''),
      parseStructuredResponse: vi.fn().mockReturnValue({ role: 'assistant', recommendation: '', confidence: 80 }),
    } as any,
    { detectMood: vi.fn().mockReturnValue('casual') } as any,
    memoryRetrieval,
    { route: vi.fn(async () => route) } as any,
    undefined, // connectorService
    undefined, // commandService
    executorService as any,
    undefined, // contextV2Service
    undefined, // genomeBridge
    eventService as any,
    undefined, // proactive
    undefined, // trustExplanation
    undefined, // learningService
    autonomyOrchestrator as any,
    { buildGatewayDefinitions: vi.fn(() => []) } as any,
  );
  for (const level of ['error', 'warn', 'log', 'debug']) {
    vi.spyOn((p as any).logger, level).mockImplementation(() => undefined);
  }
  return p;
}

const query = { text: 'invoice Ana for the March job', businessId: 'biz-1', userId: 'user-1', enableActions: true } as any;

async function run(flags = { integrationV2Enabled: true, genomeV3Enabled: false }) {
  const chunks: any[] = [];
  for await (const chunk of pipeline().streamQuery(query, flags)) chunks.push(chunk);
  return chunks;
}

const savedAssistantMessages = () =>
  sessions.saveMessage.mock.calls.map(([, message]: any[]) => message).filter((m: any) => m.role === 'assistant');

describe('streamQuery: a stream that ended in an error has no effects (RR-STREAM-ERROR-NO-EFFECTS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.getOrCreateSession.mockResolvedValue(session);
    sessions.generateId.mockReturnValue('msg_rr_stream_1');
    toolLoop.handleToolCalls.mockResolvedValue({ content: 'tool loop answer', actions: [] });
    actionDetection.detectActions.mockReturnValue([
      { actionType: 'CREATE_INVOICE', status: 'pending_approval', description: 'invoice Ana', requiresApproval: false },
    ]);
  });

  it('a tool_call_delta followed by an error chunk: the collected tool call is not handed to the tool loop', async () => {
    gateway.streamComplete.mockImplementation(async function* () {
      yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_rr_1', name: 'expenses_list', argumentsDelta: '{}' }, provider: 'openai', model: 'gpt-4o' };
      yield { type: 'error', error: 'primary stream reset', provider: 'openai', model: 'gpt-4o' };
    });

    const chunks = await run();

    expect(toolLoop.handleToolCalls).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: 'primary stream reset' });
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
  });

  it('partial text followed by an error chunk: no parsed command is detected or executed, and the partial answer is not saved as a completed turn', async () => {
    gateway.streamComplete.mockImplementation(async function* () {
      yield { type: 'content_delta', content: 'I will create the invoice for Ana', provider: 'openai', model: 'gpt-4o' };
      yield { type: 'error', error: 'primary stream reset', provider: 'openai', model: 'gpt-4o' };
    });

    const chunks = await run();

    expect(chunks.filter((c) => c.type === 'text_delta').map((c) => c.content)).toEqual(['I will create the invoice for Ana']);
    expect(actionDetection.detectActions).not.toHaveBeenCalled();
    expect(autonomyOrchestrator.evaluateAction).not.toHaveBeenCalled();
    expect(executorService.executeBatch).not.toHaveBeenCalled();
    expect(executorService.executeWithApproval).not.toHaveBeenCalled();
    expect(actions.executeActions).not.toHaveBeenCalled();
    expect(chunks.some((c) => c.type === 'action_delta')).toBe(false);
    expect(savedAssistantMessages()).toEqual([]);
    expect(eventService.logEvent.mock.calls.map(([e]: any[]) => e.step)).not.toContain('STREAM_QUERY_COMPLETE');
    expect(eventService.logEvent.mock.calls.map(([e]: any[]) => e)).toContainEqual(
      expect.objectContaining({ step: 'STREAM_QUERY_ERROR', data: expect.objectContaining({ error: 'primary stream reset', partialAnswer: true }) }),
    );
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: 'primary stream reset' });
    expect(chunks.filter((c) => c.type === 'error')).toHaveLength(1);
  });

  it('the legacy route (integration v2 off) executes no parsed action either', async () => {
    gateway.streamComplete.mockImplementation(async function* () {
      yield { type: 'content_delta', content: 'Creating the invoice', provider: 'openai', model: 'gpt-4o' };
      yield { type: 'error', error: 'primary stream reset' };
    });

    const chunks = await run({ integrationV2Enabled: false, genomeV3Enabled: false });

    expect(actions.executeActions).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toMatchObject({ type: 'error' });
  });

  it('review SEC-1: an error chunk with an empty message (a provider threw new Error()) still stops the stream before the tool loop', async () => {
    gateway.streamComplete.mockImplementation(async function* () {
      yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_rr_3', name: 'expenses_list', argumentsDelta: '{}' }, provider: 'openai', model: 'gpt-4o' };
      yield { type: 'error', error: '', provider: 'openai', model: 'gpt-4o' };
    });

    const chunks = await run();

    expect(toolLoop.handleToolCalls).not.toHaveBeenCalled();
    expect(actionDetection.detectActions).not.toHaveBeenCalled();
    expect(savedAssistantMessages()).toEqual([]);
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: expect.stringMatching(/\S/) });
  });

  describe('through the real gateway over an Anthropic stream (review SEC-A)', () => {
    let savedEnv: NodeJS.ProcessEnv;
    beforeEach(() => {
      savedEnv = { ...process.env };
    });
    afterEach(() => {
      process.env = savedEnv;
      vi.unstubAllGlobals();
    });

    it.each([
      ['a tool_use block then an SSE error event', [...ANTHROPIC_TOOL_BLOCK, ANTHROPIC_OVERLOADED]],
      ['a tool_use block then a clean close without message_stop', [...ANTHROPIC_TOOL_BLOCK]],
    ])('%s: the complete tool call is not run and nothing is saved', async (_title, events) => {
      const real = realGatewayOverAnthropic(events);
      gateway.streamComplete.mockImplementation((req: any) => real.streamComplete(req));

      const chunks = await run();

      expect(toolLoop.handleToolCalls).not.toHaveBeenCalled();
      expect(actionDetection.detectActions).not.toHaveBeenCalled();
      expect(savedAssistantMessages()).toEqual([]);
      expect(chunks.some((c) => c.type === 'done')).toBe(false);
      expect(chunks.at(-1)).toMatchObject({ type: 'error', error: expect.stringMatching(/anthropic/) });
    });
  });

  it('control: a stream that completes still runs its tool call through the tool loop and ends with done', async () => {
    actionDetection.detectActions.mockReturnValue([]);
    gateway.streamComplete.mockImplementation(async function* () {
      yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_rr_2', name: 'expenses_list', argumentsDelta: '{}' }, provider: 'openai', model: 'gpt-4o' };
      yield { type: 'done', provider: 'openai', model: 'gpt-4o' };
    });

    const chunks = await run();

    expect(toolLoop.handleToolCalls).toHaveBeenCalledTimes(1);
    expect(chunks.at(-1)).toEqual({ type: 'done' });
    expect(savedAssistantMessages()).toHaveLength(1);
  });
});
