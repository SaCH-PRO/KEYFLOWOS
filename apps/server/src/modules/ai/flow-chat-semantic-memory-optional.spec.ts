/**
 * W7-AI-SERVICES-503 review repair (SEC503-1 / CR-503-1; the R0-07a rule, COST-LEDGER-001
 * section 7 item 7): KEY chat goes on without the semantic-memory section when embeddings
 * have no provider.
 *
 * W7-AI-SERVICES-503 made SemanticMemoryService.search rethrow the provider 503 (no platform
 * OpenAI key: provider_not_configured; or the gateway's provider_unavailable) so that
 * GET .../agent/memory/search fails visibly. FlowOrchestratorService.chat and streamChat
 * called search without a catch, so on a deployment whose chat provider is configured (an
 * Anthropic, Google or xAI env key, or the business's BYOK key through the gateway) but which
 * has no platform OpenAI key, every POST flow/chat turn with a user message in its history
 * answered 503 and was not saved, and every POST flow/chat/stream turn sent an SSE error chunk
 * saying no AI provider was configured. The memory section is optional enrichment: the turn
 * now goes on without it (FlowOrchestratorService.buildSemanticMemorySection), as
 * TemporalFlowService and UnifiedMemoryRetrievalService already do.
 *
 * Built from the real pieces: the real AiFlowController, the real FlowOrchestratorService
 * chat / streamChat, the real AiOversightService, the real SemanticMemoryService and the real
 * AiUsageService.trackEmbedding (its first line is the R0-07a key check). Only the gateway's
 * chat dispatch (trackAndComplete / trackAndStream) and the turn's context loaders are stand-ins.
 *
 * Controls: with memory hits the section is still in the prompt, and a missing CHAT provider
 * still fails the turn with its own 503 (only the memory lookup is caught).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { AiUsageService } from './ai-usage.service';
import { AiOversightService } from './ai-oversight.service';
import { RoleEngineService } from './role-engine.service';
import { AiFlowController } from './flow.controller';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService } from '../structure/job-role-policy.service';

const BIZ = 'biz_w7ai503';
const REPLY = 'Hello from the chat provider';
const MEMORY_HEADER = 'RELEVANT CONTEXT FROM MEMORY';
const HISTORY = [
  { role: 'user', content: 'what are our opening hours?', timestamp: new Date() },
  { role: 'assistant', content: '9 to 5 on weekdays.', timestamp: new Date() },
];

const ENV_KEYS = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'KEY_DISABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    // No platform OpenAI key for embeddings, and KEY is not disabled.
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** The gateway's provider_unavailable 503 (ModelGatewayService.noProviderAvailable). */
function gatewayUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'provider_unavailable',
    service: 'ai',
    message: 'No AI providers available: every configured AI provider is temporarily unavailable',
    error: 'Service Unavailable',
  });
}

/** The gateway's provider_not_configured 503: no CHAT provider at all. */
function gatewayNotConfigured(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'provider_not_configured',
    service: 'ai',
    message: 'No AI providers available: no AI provider is configured for this deployment or business',
    error: 'Service Unavailable',
  });
}

interface TurnOptions {
  /** Replaces the real AiUsageService.trackEmbedding (default: the real one, no key set). */
  trackEmbedding?: (...args: unknown[]) => Promise<number[][]>;
  /** Replaces SemanticMemoryService.search (default: the real one). */
  search?: SemanticMemoryService['search'];
  /** The gateway chat dispatch fails with this (default: it answers REPLY). */
  chatFailure?: Error;
}

function makeTurn(opts: TurnOptions = {}) {
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const settings = { autonomyLevel: 2, approvedTools: [], blockedTools: [], approvalTimeoutHours: 24 };
  const governance = new AiOversightService(
    { client: { autopilotSettings: { findUnique: async () => settings }, aiMemory: { findUnique: async () => null } } } as never,
    {} as never, {} as never, roleEngine, {} as never, policy,
  );
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };

  // The real AiUsageService.trackEmbedding: with no key it throws the R0-07a 503 before anything else.
  const embeddingUsage = Object.create(AiUsageService.prototype) as AiUsageService;
  if (opts.trackEmbedding) (embeddingUsage as unknown as { trackEmbedding: unknown }).trackEmbedding = opts.trackEmbedding;
  const semanticMemory = new SemanticMemoryService({ client: {} } as never, { emit() {} } as never, embeddingUsage);
  if (opts.search) semanticMemory.search = opts.search;

  const trackAndComplete = vi.fn(async () => {
    if (opts.chatFailure) throw opts.chatFailure;
    return { content: REPLY, toolCalls: [], usage };
  });
  const trackAndStream = vi.fn(async function* () {
    if (opts.chatFailure) throw opts.chatFailure;
    yield { type: 'content_delta', content: REPLY };
    yield { type: 'usage', usage };
  });
  const saveConversationHistory = vi.fn(async () => undefined);

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    governance,
    roleEngine,
    executionLog: { log: async () => undefined, logToolExecution: async () => undefined },
    moduleRef: { get: (t: unknown) => (t === JobRolePolicyService ? policy : t === KeyActionBoundaryService ? { adopts: () => false } : undefined) },
    businessGraph: { invalidateCache() {}, getSnapshot: async () => ({ business: { name: 'Biz' } }), buildContextString: () => '' },
    // The gateway chat dispatch (an env chat provider or the business's BYOK key).
    aiUsage: { checkRateLimit() {}, checkCredits: async () => ({ allowed: true }), trackAndComplete, trackAndStream },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory,
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    selectToolsForRequest: async () => [],
    saveConversationHistory,
    enforceDoNotSay: async () => undefined,
    finalizeStreamSession: async function* () {},
  }) as FlowOrchestratorService;

  const controller = new AiFlowController(orchestrator);
  /** The messages the gateway was handed, as one string. */
  const promptOf = (fn: typeof trackAndComplete | typeof trackAndStream) =>
    JSON.stringify((fn.mock.calls[0] as unknown[] | undefined)?.[3] ?? null);
  return { controller, semanticMemory, trackAndComplete, trackAndStream, saveConversationHistory, promptOf };
}

async function postChat(turn: ReturnType<typeof makeTurn>) {
  return turn.controller.flowChat(BIZ, { message: 'and on Sunday?', history: HISTORY } as never, { id: 'u_1' } as never);
}

async function postStream(turn: ReturnType<typeof makeTurn>): Promise<string> {
  const chunks: string[] = [];
  const res = { destroyed: false, setHeader() {}, flushHeaders() {}, write: (c: string) => chunks.push(c), end() {} };
  await turn.controller.flowChatStream(BIZ, { id: 'u_1' } as never, { message: 'what are our opening hours?', history: [] } as never, res as never);
  return chunks.join('');
}

function bodyOf(err: unknown): Record<string, unknown> {
  return (err as HttpException).getResponse() as Record<string, unknown>;
}

describe('W7-AI-SERVICES-503 review repair SEC503-1 / CR-503-1 (R0-07a rule): KEY chat goes on without the memory section when embeddings have no provider', () => {
  it('precondition: with no platform OpenAI key the real SemanticMemoryService.search answers the provider 503 (W7-AI-SERVICES-503)', async () => {
    const turn = makeTurn();
    const err = await turn.semanticMemory.search({ businessId: BIZ, query: 'opening hours' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(503);
    expect(bodyOf(err)).toMatchObject({ code: 'provider_not_configured', service: 'ai' });
  });

  const refusals: Array<[string, TurnOptions]> = [
    ['provider_not_configured (no platform OpenAI key)', {}],
    ['provider_unavailable (the gateway code)', { trackEmbedding: async () => { throw gatewayUnavailable(); } }],
  ];

  it.each(refusals)(
    'POST flow/chat with a user message in its history answers from the chat provider without the memory section and saves the turn once - embeddings %s',
    async (_label, opts) => {
      const turn = makeTurn(opts);
      const result = await postChat(turn);
      expect(result.reply).toBe(REPLY);
      expect(turn.trackAndComplete).toHaveBeenCalledTimes(1);
      expect(turn.promptOf(turn.trackAndComplete)).not.toContain(MEMORY_HEADER);
      expect(turn.saveConversationHistory).toHaveBeenCalledTimes(1);
    },
  );

  it.each(refusals)(
    'POST flow/chat/stream answers from the chat provider with no error chunk and without the memory section - embeddings %s',
    async (_label, opts) => {
      const turn = makeTurn(opts);
      const sse = await postStream(turn);
      expect(sse).not.toContain('"type":"error"');
      expect(sse).toContain(REPLY);
      expect(sse).toContain('data: [DONE]');
      expect(turn.trackAndStream).toHaveBeenCalledTimes(1);
      expect(turn.promptOf(turn.trackAndStream)).not.toContain(MEMORY_HEADER);
    },
  );

  it('control: with memory hits the section is still in the prompt of POST flow/chat and POST flow/chat/stream', async () => {
    const hit = { id: 'm_1', content: 'Closed on Sundays', sourceType: 'memory', sourceId: 's_1', similarity: 0.9, metadata: {} };
    const search = vi.fn(async () => [hit]) as unknown as SemanticMemoryService['search'];

    const chatTurn = makeTurn({ search });
    expect((await postChat(chatTurn)).reply).toBe(REPLY);
    expect(chatTurn.promptOf(chatTurn.trackAndComplete)).toContain(`${MEMORY_HEADER}:\\n- Closed on Sundays (similarity: 90%)`);

    const streamTurn = makeTurn({ search });
    expect(await postStream(streamTurn)).not.toContain('"type":"error"');
    expect(streamTurn.promptOf(streamTurn.trackAndStream)).toContain(`${MEMORY_HEADER}:\\n- Closed on Sundays (similarity: 90%)`);
  });

  it('control: a missing CHAT provider still fails POST flow/chat with its own 503 and saves nothing (only the memory lookup is caught)', async () => {
    const turn = makeTurn({ chatFailure: gatewayNotConfigured() });
    const err = await postChat(turn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(503);
    expect(bodyOf(err)).toMatchObject({ code: 'provider_not_configured', service: 'ai' });
    expect(String(bodyOf(err).message)).toContain('no AI provider is configured for this deployment or business');
    expect(turn.saveConversationHistory).not.toHaveBeenCalled();
  });
});
