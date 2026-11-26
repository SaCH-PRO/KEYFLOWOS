/**
 * FU-FLOW-SAVE-EXECUTED-TOOL-TURN (P136; D-261, follow-up from RR-STREAM-ERROR-NO-EFFECTS):
 *
 * When tools already executed (e.g., `create_invoice`) and the follow-up model
 * stream (or non-streaming follow-up completion) fails part-way:
 *   1. The session MUST persist the executed tool turn (user turn + executed
 *      tool calls + tool results, marked `failed: true`, with empty assistant
 *      content — NEVER saving the partial follow-up assistant text).
 *   2. A subsequent retry turn that loads conversation history from the session
 *      MUST replay the executed tool calls and tool results (both successes and
 *      tool-level errors) so the model sees the write that already ran and does
 *      not repeat it.
 *   3. Initial stream/completion failures BEFORE any tool executes MUST still
 *      save nothing (preserving RR-STREAM-ERROR-NO-EFFECTS).
 *   4. Cross-tenant and cross-user session isolation MUST remain strict.
 *   5. A persistence failure on the error path MUST NOT mask the stream/provider
 *      error or leak raw DB error messages/secrets.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FlowOrchestratorService,
  type FlowMessage,
  type FlowStreamChunk,
  type FlowToolResult,
} from './flow-orchestrator.service';
import { RoleEngineService } from './role-engine.service';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService } from '../structure/job-role-policy.service';
import type { GatewayMessage } from './model-gateway.service';

type SessionRow = {
  id: string;
  businessId: string;
  userId: string | null;
  messages: FlowMessage[];
  updatedAt?: Date;
};

/**
 * In-memory FlowSession table that honours where-clauses and clones messages
 * through JSON round-trip to mirror PostgreSQL jsonb persistence.
 */
class InMemoryFlowSessionPrisma {
  rows: SessionRow[] = [];
  upsertError: Error | null = null;

  private match(where: Record<string, unknown>): SessionRow[] {
    return this.rows.filter((row) =>
      Object.entries(where).every(([key, value]) => {
        const actual = (row as Record<string, unknown>)[key];
        if (value && typeof value === 'object' && Array.isArray((value as { in?: unknown[] }).in)) {
          return (value as { in: unknown[] }).in.includes(actual);
        }
        return actual === value;
      }),
    );
  }

  client = {
    membership: {
      findUnique: vi.fn(async () => null),
    },
    flowSession: {
      findFirst: vi.fn((q: { where: Record<string, unknown> }) => {
        const hit = this.match(q.where)[0];
        return Promise.resolve(hit ? { ...hit, messages: JSON.parse(JSON.stringify(hit.messages)) } : null);
      }),
      findMany: vi.fn((q: { where: Record<string, unknown> }) =>
        Promise.resolve(
          this.match(q.where).map((r) => ({ ...r, messages: JSON.parse(JSON.stringify(r.messages)) })),
        ),
      ),
      upsert: vi.fn((q: { where: { id: string }; create: SessionRow; update: Partial<SessionRow> }) => {
        if (this.upsertError) {
          return Promise.reject(this.upsertError);
        }
        const existing = this.rows.find((r) => r.id === q.where.id);
        if (existing) {
          existing.messages = JSON.parse(JSON.stringify(q.update.messages ?? []));
          existing.updatedAt = q.update.updatedAt;
        } else {
          this.rows.push({
            id: q.create.id,
            businessId: q.create.businessId,
            userId: q.create.userId ?? null,
            messages: JSON.parse(JSON.stringify(q.create.messages ?? [])),
          });
        }
        return Promise.resolve({});
      }),
    },
  };
}

const BIZ_A = 'biz_p136_alpha';
const BIZ_B = 'biz_p136_beta';
const USER_A = 'user_p136_alpha';
const USER_A_OTHER = 'user_p136_alpha_other';
const USER_B = 'user_p136_beta';
const SESSION_ID = 'sess_p136_invoice';

const savedKeyDisabled = process.env.KEY_DISABLED;
beforeEach(() => {
  delete process.env.KEY_DISABLED;
});
afterEach(() => {
  if (savedKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = savedKeyDisabled;
});

interface HarnessOptions {
  prisma?: InMemoryFlowSessionPrisma;
  trackAndStream?: (...args: any[]) => AsyncGenerator<Record<string, unknown>>;
  trackAndComplete?: (...args: any[]) => Promise<Record<string, unknown>>;
  executeTool?: (...args: any[]) => Promise<FlowToolResult>;
}

function makeHarness(opts: HarnessOptions = {}) {
  const prisma = opts.prisma ?? new InMemoryFlowSessionPrisma();
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const governance = {
    evaluate: vi.fn(async () => ({
      allowed: true,
      tier: 1,
      reason: 'allowed',
      requiresQuickConfirm: false,
      requiresFormalApproval: false,
      requiresAdminApproval: false,
    })),
  };
  const trackAndStream = vi.fn(
    opts.trackAndStream ??
      (async function* () {
        yield { type: 'content_delta', content: 'ok' };
      }),
  );
  const trackAndComplete = vi.fn(
    opts.trackAndComplete ??
      (async () => ({
        content: 'ok',
        toolCalls: [],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      })),
  );
  const executeTool = vi.fn(
    opts.executeTool ??
      (async (_biz: string, name: string, _args: Record<string, unknown>, toolCallId: string): Promise<FlowToolResult> => ({
        toolCallId,
        name,
        result: { id: 'inv_42', number: 'INV-042', total: 500 },
        changedEntities: ['invoice:inv_42'],
        followOnSuggestions: [],
        family: 'commerce',
        riskTier: 2,
        success: true,
      })),
  );
  const genomeExtractor = {
    extractFromTurn: vi.fn(async () => undefined),
  };

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    logger,
    governance,
    roleEngine,
    genomeExtractor,
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
      getSnapshot: async () => ({ business: { name: 'Alpha Co' } }),
      buildContextString: () => '',
    },
    aiUsage: {
      checkRateLimit() {},
      checkCredits: async () => ({ allowed: true }),
      trackAndStream,
      trackAndComplete,
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    selectToolsForRequest: async () => [],
    governToolCall: async (_b: string, tc: unknown, decision: unknown) => ({ tc, decision }),
    enforceDoNotSay: vi.fn(async () => undefined),
    executeTool,
  }) as FlowOrchestratorService;

  const finalizeSpy = vi.spyOn(orchestrator as any, 'finalizeStreamSession');
  const saveSpy = vi.spyOn(orchestrator, 'saveConversationHistory');

  return {
    orchestrator,
    prisma,
    logger,
    governance,
    trackAndStream,
    trackAndComplete,
    executeTool,
    genomeExtractor,
    finalizeSpy,
    saveSpy,
  };
}

async function collectStream(gen: AsyncGenerator<FlowStreamChunk>): Promise<FlowStreamChunk[]> {
  const chunks: FlowStreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('FU-FLOW-SAVE-EXECUTED-TOOL-TURN: streamChat follow-up failure saves executed tool turn', () => {
  it('saves executed write tool call + result marked failed when follow-up emits error chunk after partial text, and NEVER saves partial follow-up text', async () => {
    let streamCall = 0;
    const partialText = 'I have created invoice INV-042 for Ana and am now emailing...';
    const followUpError = 'The anthropic stream failed part-way (ProviderStreamError: overloaded_error)';

    const h = makeHarness({
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_inv_1',
              name: 'create_invoice',
              argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 500 }),
            },
          };
          yield { type: 'usage', usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35, estimatedCost: 0 } };
          return;
        }
        yield { type: 'content_delta', content: partialText };
        yield { type: 'error', error: followUpError };
      },
    });

    const chunks = await collectStream(
      h.orchestrator.streamChat(
        BIZ_A,
        'Create an invoice for Ana for $500',
        [],
        undefined,
        undefined,
        undefined,
        SESSION_ID,
        USER_A,
      ),
    );

    expect(h.executeTool).toHaveBeenCalledTimes(1);
    expect(h.trackAndStream).toHaveBeenCalledTimes(2);
    // Preserves RR-STREAM-ERROR-NO-EFFECTS: NOT finalized as completed answer, no done chunk.
    expect(h.finalizeSpy).not.toHaveBeenCalled();
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: 'error', error: followUpError });

    // Session MUST have saved the user turn + executed tool turn (marked failed, no partial text).
    const savedHistory = await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A);
    expect(savedHistory).toHaveLength(2);
    expect(savedHistory[0]).toMatchObject({
      role: 'user',
      content: 'Create an invoice for Ana for $500',
    });
    expect(savedHistory[1]).toMatchObject({
      role: 'assistant',
      content: '',
      failed: true,
    });
    expect(savedHistory[1].toolCalls).toEqual([
      expect.objectContaining({
        id: 'call_inv_1',
        name: 'create_invoice',
        arguments: { contactId: 'c_ana', amount: 500 },
      }),
    ]);
    expect(savedHistory[1].toolResults).toEqual([
      expect.objectContaining({
        toolCallId: 'call_inv_1',
        name: 'create_invoice',
        success: true,
        result: { id: 'inv_42', number: 'INV-042', total: 500 },
      }),
    ]);

    // Partial follow-up text must NEVER appear anywhere in persisted session data.
    expect(JSON.stringify(savedHistory)).not.toContain(partialText);
    expect(JSON.stringify(h.prisma.rows)).not.toContain(partialText);
    // Genome extraction must not run on an empty/failed assistant turn.
    expect(h.genomeExtractor.extractFromTurn).not.toHaveBeenCalled();
  });

  it('saves executed write tool turn when follow-up stream throws an exception mid-stream after partial text', async () => {
    let streamCall = 0;
    const partialText = 'Partial summary before socket reset';

    const h = makeHarness({
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_inv_throw',
              name: 'create_invoice',
              argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 250 }),
            },
          };
          return;
        }
        yield { type: 'content_delta', content: partialText };
        throw new Error('ProviderStreamError: upstream socket aborted');
      },
    });

    const chunks = await collectStream(
      h.orchestrator.streamChat(
        BIZ_A,
        'Bill Ana $250',
        [],
        undefined,
        undefined,
        undefined,
        SESSION_ID,
        USER_A,
      ),
    );

    expect(h.executeTool).toHaveBeenCalledTimes(1);
    expect(h.finalizeSpy).not.toHaveBeenCalled();
    expect(chunks.some((c) => c.type === 'done')).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'ProviderStreamError: upstream socket aborted' });

    const savedHistory = await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A);
    expect(savedHistory).toHaveLength(2);
    expect(savedHistory[1]).toMatchObject({
      role: 'assistant',
      content: '',
      failed: true,
    });
    expect(savedHistory[1].toolCalls?.[0]).toMatchObject({ id: 'call_inv_throw', name: 'create_invoice' });
    expect(savedHistory[1].toolResults?.[0]).toMatchObject({
      toolCallId: 'call_inv_throw',
      success: true,
      result: { id: 'inv_42', number: 'INV-042', total: 500 },
    });
    expect(JSON.stringify(savedHistory)).not.toContain(partialText);
  });

  it('saves executed write tool turn when consumer aborts/breaks out mid-follow-up stream', async () => {
    let streamCall = 0;
    const partialText = 'Client disconnected while streaming this';

    const h = makeHarness({
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_inv_abort',
              name: 'create_invoice',
              argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 120 }),
            },
          };
          return;
        }
        yield { type: 'content_delta', content: partialText };
        yield { type: 'content_delta', content: ' more text' };
      },
    });

    for await (const chunk of h.orchestrator.streamChat(
      BIZ_A,
      'Invoice Ana $120',
      [],
      undefined,
      undefined,
      undefined,
      SESSION_ID,
      USER_A,
    )) {
      if (chunk.type === 'content_delta') {
        break;
      }
    }

    expect(h.executeTool).toHaveBeenCalledTimes(1);
    expect(h.finalizeSpy).not.toHaveBeenCalled();

    const savedHistory = await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A);
    expect(savedHistory).toHaveLength(2);
    expect(savedHistory[1]).toMatchObject({
      role: 'assistant',
      content: '',
      failed: true,
    });
    expect(savedHistory[1].toolCalls?.[0]).toMatchObject({ id: 'call_inv_abort', name: 'create_invoice' });
    expect(JSON.stringify(savedHistory)).not.toContain(partialText);
  });

  it('subsequent retry turn loads saved history and replays the executed write tool call + result to the model', async () => {
    let streamCall = 0;
    const partialText = 'Half-written follow-up that must never be replayed';

    const h = makeHarness({
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_inv_retry',
              name: 'create_invoice',
              argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 500 }),
            },
          };
          return;
        }
        if (streamCall === 2) {
          yield { type: 'content_delta', content: partialText };
          yield { type: 'error', error: 'follow-up stream failed' };
          return;
        }
        // Turn 2 (retry) sees prior tool turn and answers without repeating the write.
        yield { type: 'content_delta', content: 'Invoice INV-042 was already created for Ana ($500).' };
      },
    });

    // Turn 1: write executes, follow-up fails.
    const turn1Chunks = await collectStream(
      h.orchestrator.streamChat(
        BIZ_A,
        'Create an invoice for Ana for $500',
        [],
        undefined,
        undefined,
        undefined,
        SESSION_ID,
        USER_A,
      ),
    );
    expect(turn1Chunks.at(-1)).toEqual({ type: 'error', error: 'follow-up stream failed' });

    // Load persisted session history for retry.
    const loadedHistory = await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A);
    expect(loadedHistory).toHaveLength(2);

    // Turn 2: retry with loaded history.
    const turn2Chunks = await collectStream(
      h.orchestrator.streamChat(
        BIZ_A,
        'Did that invoice get created? Create it if not.',
        loadedHistory,
        undefined,
        undefined,
        undefined,
        SESSION_ID,
        USER_A,
      ),
    );
    expect(turn2Chunks.some((c) => c.type === 'done')).toBe(true);

    // Inspect the exact GatewayMessage[] handed to the model on Turn 2.
    const turn2Req = h.trackAndStream.mock.calls[2][3] as { messages: GatewayMessage[] };
    const assistantToolMsg = turn2Req.messages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    const toolResultMsg = turn2Req.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_inv_retry',
    );

    expect(assistantToolMsg).toBeDefined();
    expect(assistantToolMsg?.content).toBeNull();
    expect(assistantToolMsg?.tool_calls).toEqual([
      {
        id: 'call_inv_retry',
        type: 'function',
        function: {
          name: 'create_invoice',
          arguments: JSON.stringify({ contactId: 'c_ana', amount: 500 }),
        },
      },
    ]);
    expect(toolResultMsg).toBeDefined();
    expect(JSON.parse(String(toolResultMsg?.content))).toEqual({
      id: 'inv_42',
      number: 'INV-042',
      total: 500,
    });
    expect(JSON.stringify(turn2Req.messages)).not.toContain(partialText);
  });

  it('saves mixed READ + WRITE + failed-tool + malformed-arg results in exact model order and replays error outcomes faithfully', async () => {
    let streamCall = 0;
    const partialText = 'Partial multi-tool summary';

    const h = makeHarness({
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: { index: 0, id: 'call_r1', name: 'crm_list_contacts', argumentsDelta: '{"search":"Ana"}' },
          };
          yield {
            type: 'tool_call_delta',
            toolCall: { index: 1, id: 'call_w1', name: 'create_invoice', argumentsDelta: '{"contactId":"c_ana","amount":300}' },
          };
          yield {
            type: 'tool_call_delta',
            toolCall: { index: 2, id: 'call_w2_err', name: 'crm_add_note', argumentsDelta: '{"contactId":"c_ana","note":"billed"}' },
          };
          yield {
            type: 'tool_call_delta',
            toolCall: { index: 3, id: 'call_bad_json', name: 'crm_create_contact', argumentsDelta: '{broken SECRET_INJECTION' },
          };
          return;
        }
        if (streamCall === 2) {
          yield { type: 'content_delta', content: partialText };
          yield { type: 'error', error: 'follow-up failed after mixed tools' };
          return;
        }
        yield { type: 'content_delta', content: 'Retried cleanly.' };
      },
      executeTool: async (_biz: string, name: string, _args: Record<string, unknown>, toolCallId: string) => {
        if (name === 'crm_list_contacts') {
          return {
            toolCallId,
            name,
            result: { contacts: [{ id: 'c_ana', name: 'Ana' }] },
            changedEntities: [],
            followOnSuggestions: [],
            family: 'crm',
            riskTier: 0,
            success: true,
          };
        }
        if (name === 'create_invoice') {
          return {
            toolCallId,
            name,
            result: { id: 'inv_99', number: 'INV-099', total: 300 },
            changedEntities: ['invoice:inv_99'],
            followOnSuggestions: [],
            family: 'commerce',
            riskTier: 2,
            success: true,
          };
        }
        return {
          toolCallId,
          name,
          result: null,
          changedEntities: [],
          followOnSuggestions: [],
          family: 'crm',
          riskTier: 1,
          success: false,
          error: 'note rejected by validation',
        };
      },
    });

    await collectStream(
      h.orchestrator.streamChat(BIZ_A, 'Find Ana, invoice $300, add note', [], undefined, undefined, undefined, SESSION_ID, USER_A),
    );

    const saved = await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A);
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ role: 'assistant', content: '', failed: true });
    expect(saved[1].toolCalls?.map((tc) => tc.id)).toEqual(['call_r1', 'call_w1', 'call_w2_err', 'call_bad_json']);
    expect(saved[1].toolResults?.map((r) => ({ id: r.toolCallId, success: r.success }))).toEqual([
      { id: 'call_r1', success: true },
      { id: 'call_w1', success: true },
      { id: 'call_w2_err', success: false },
      { id: 'call_bad_json', success: false },
    ]);
    // Neither partial follow-up text nor raw malformed argument payload is persisted.
    expect(JSON.stringify(saved)).not.toContain(partialText);
    expect(JSON.stringify(saved)).not.toContain('SECRET_INJECTION');

    // Replay on Turn 2: every tool call & result (including tool-level error) reaches the model in order.
    await collectStream(
      h.orchestrator.streamChat(BIZ_A, 'Try again', saved, undefined, undefined, undefined, SESSION_ID, USER_A),
    );
    const turn2Req = h.trackAndStream.mock.calls[2][3] as { messages: GatewayMessage[] };
    const replayedToolMsgs = turn2Req.messages.filter((m) => m.role === 'tool');
    expect(replayedToolMsgs.map((m) => m.tool_call_id)).toEqual(['call_r1', 'call_w1', 'call_w2_err', 'call_bad_json']);
    expect(JSON.parse(String(replayedToolMsgs[0].content))).toEqual({ contacts: [{ id: 'c_ana', name: 'Ana' }] });
    expect(JSON.parse(String(replayedToolMsgs[1].content))).toEqual({ id: 'inv_99', number: 'INV-099', total: 300 });
    expect(JSON.parse(String(replayedToolMsgs[2].content))).toEqual({ error: 'note rejected by validation' });
    expect(JSON.parse(String(replayedToolMsgs[3].content))).toEqual({
      error: 'not run: the arguments for crm_create_contact were not valid JSON',
    });
  });

  it('initial stream failure before any tool executes STILL saves nothing (preserves RR-STREAM-ERROR-NO-EFFECTS)', async () => {
    const h = makeHarness({
      trackAndStream: async function* () {
        yield { type: 'content_delta', content: 'Starting to create invoice...' };
        yield {
          type: 'tool_call_delta',
          toolCall: { index: 0, id: 'call_unrun', name: 'create_invoice', argumentsDelta: '{"amount":500}' },
        };
        yield { type: 'error', error: 'initial stream reset' };
      },
    });

    const chunks = await collectStream(
      h.orchestrator.streamChat(BIZ_A, 'Invoice Ana $500', [], undefined, undefined, undefined, SESSION_ID, USER_A),
    );

    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.saveSpy).not.toHaveBeenCalled();
    expect(h.prisma.client.flowSession.upsert).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'initial stream reset' });
    expect(await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A)).toEqual([]);
  });

  it('initial stream throwing before any tool executes STILL saves nothing', async () => {
    const h = makeHarness({
      trackAndStream: async function* () {
        yield { type: 'content_delta', content: 'Partial pre-tool text' };
        throw new Error('initial stream boom');
      },
    });

    const chunks = await collectStream(
      h.orchestrator.streamChat(BIZ_A, 'Invoice Ana $500', [], undefined, undefined, undefined, SESSION_ID, USER_A),
    );

    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.saveSpy).not.toHaveBeenCalled();
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'initial stream boom' });
    expect(await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A)).toEqual([]);
  });

  it('cross-tenant & cross-user isolation: saving failed tool turn stays strictly scoped to (businessId, userId, sessionId)', async () => {
    const sharedPrisma = new InMemoryFlowSessionPrisma();
    const sharedSessionId = 'onboarding';

    // Seed Tenant B's existing session with the exact same client sessionId.
    const setupHarness = makeHarness({ prisma: sharedPrisma });
    const tenantBMessages: FlowMessage[] = [
      { role: 'user', content: 'Tenant B confidential request' },
      { role: 'assistant', content: 'Tenant B confidential reply' },
    ];
    await setupHarness.orchestrator.saveConversationHistory(BIZ_B, sharedSessionId, tenantBMessages, USER_B);

    // Tenant A runs streamChat on the same client sessionId; write executes then follow-up fails.
    let streamCall = 0;
    const hA = makeHarness({
      prisma: sharedPrisma,
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_tenant_a',
              name: 'create_invoice',
              argumentsDelta: '{"contactId":"c_alpha","amount":777}',
            },
          };
          return;
        }
        yield { type: 'content_delta', content: 'Alpha partial text' };
        yield { type: 'error', error: 'follow-up failed for alpha' };
      },
    });

    await collectStream(
      hA.orchestrator.streamChat(BIZ_A, 'Alpha invoice', [], undefined, undefined, undefined, sharedSessionId, USER_A),
    );

    // Tenant A sees its own failed tool turn.
    const historyA = await hA.orchestrator.getConversationHistory(BIZ_A, sharedSessionId, USER_A);
    expect(historyA).toHaveLength(2);
    expect(historyA[1]).toMatchObject({ role: 'assistant', content: '', failed: true });
    expect(historyA[1].toolCalls?.[0]).toMatchObject({ id: 'call_tenant_a', name: 'create_invoice' });

    // Tenant B's session is completely untouched.
    const historyB = await hA.orchestrator.getConversationHistory(BIZ_B, sharedSessionId, USER_B);
    expect(historyB).toEqual(tenantBMessages);
    expect(JSON.stringify(historyB)).not.toContain('call_tenant_a');
    expect(JSON.stringify(historyB)).not.toContain('inv_42');

    // Another user in Tenant A cannot see USER_A's failed tool turn.
    const historyAOther = await hA.orchestrator.getConversationHistory(BIZ_A, sharedSessionId, USER_A_OTHER);
    expect(historyAOther).toEqual([]);
  });

  it('persistence failure on the error path does not mask the stream error event or leak secrets', async () => {
    let streamCall = 0;
    const streamError = 'The anthropic stream failed part-way (ProviderStreamError: overloaded_error)';
    const secret = 'TOP_SECRET_PG_PASS_998877';

    const prisma = new InMemoryFlowSessionPrisma();
    prisma.upsertError = new Error(`postgres://admin:${secret}@db.internal:5432/keyflow connection refused`);

    const h = makeHarness({
      prisma,
      trackAndStream: async function* () {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_db_fail',
              name: 'create_invoice',
              argumentsDelta: '{"amount":100}',
            },
          };
          return;
        }
        yield { type: 'content_delta', content: 'Partial text' };
        yield { type: 'error', error: streamError };
      },
    });

    const chunks = await collectStream(
      h.orchestrator.streamChat(BIZ_A, 'Invoice Ana $100', [], undefined, undefined, undefined, SESSION_ID, USER_A),
    );

    // Persistence was attempted and failed, yet the original stream error event
    // is preserved and NOT masked by the DB error.
    expect(h.prisma.client.flowSession.upsert).toHaveBeenCalledTimes(1);
    expect(chunks.at(-1)).toEqual({ type: 'error', error: streamError });
    expect(JSON.stringify(chunks)).not.toContain(secret);

    // Logs must never leak the secret from the DB error message.
    const allLogs = [
      ...h.logger.log.mock.calls,
      ...h.logger.warn.mock.calls,
      ...h.logger.error.mock.calls,
      ...h.logger.debug.mock.calls,
    ];
    expect(JSON.stringify(allLogs)).not.toContain(secret);
  });
});

describe('FU-FLOW-SAVE-EXECUTED-TOOL-TURN: non-streaming chat() follow-up failure saves executed tool turn', () => {
  it('saves executed tool turn marked failed when follow-up trackAndComplete rejects, rethrows original error, and replays on retry', async () => {
    let completeCall = 0;
    const h = makeHarness({
      trackAndComplete: async () => {
        completeCall += 1;
        if (completeCall === 1) {
          return {
            content: 'Creating invoice now...',
            toolCalls: [
              {
                id: 'call_chat_inv_1',
                type: 'function',
                function: {
                  name: 'create_invoice',
                  arguments: JSON.stringify({ contactId: 'c_ana', amount: 650 }),
                },
              },
            ],
            usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
          };
        }
        if (completeCall === 2) {
          throw new Error('Provider 503 service unavailable during follow-up');
        }
        return {
          content: 'Invoice INV-042 was already created.',
          toolCalls: [],
          usage: { promptTokens: 25, completionTokens: 10, totalTokens: 35 },
        };
      },
    });

    await expect(
      h.orchestrator.chat(
        BIZ_A,
        'Create invoice for Ana for $650',
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        SESSION_ID,
        USER_A,
      ),
    ).rejects.toThrow('Provider 503 service unavailable during follow-up');

    expect(h.executeTool).toHaveBeenCalledTimes(1);

    // Executed tool turn is persisted and marked failed with empty assistant content.
    const savedHistory = await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A);
    expect(savedHistory).toHaveLength(2);
    expect(savedHistory[0]).toMatchObject({ role: 'user', content: 'Create invoice for Ana for $650' });
    expect(savedHistory[1]).toMatchObject({
      role: 'assistant',
      content: '',
      failed: true,
    });
    expect(savedHistory[1].toolCalls).toEqual([
      expect.objectContaining({
        id: 'call_chat_inv_1',
        name: 'create_invoice',
        arguments: { contactId: 'c_ana', amount: 650 },
      }),
    ]);
    expect(savedHistory[1].toolResults).toEqual([
      expect.objectContaining({
        toolCallId: 'call_chat_inv_1',
        name: 'create_invoice',
        success: true,
        result: { id: 'inv_42', number: 'INV-042', total: 500 },
      }),
    ]);

    // Retry turn replays the executed tool call + result to the model.
    const retryRes = await h.orchestrator.chat(
      BIZ_A,
      'Create invoice for Ana for $650',
      savedHistory,
      undefined,
      undefined,
      undefined,
      undefined,
      SESSION_ID,
      USER_A,
    );
    expect(retryRes.reply).toBe('Invoice INV-042 was already created.');

    const retryReq = h.trackAndComplete.mock.calls[2][3] as { messages: GatewayMessage[] };
    expect(retryReq.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_chat_inv_1')).toBe(true);
  });

  it('control: initial chat() trackAndComplete failure before any tool runs saves nothing', async () => {
    const h = makeHarness({
      trackAndComplete: async () => {
        throw new Error('Initial provider 503');
      },
    });

    await expect(
      h.orchestrator.chat(BIZ_A, 'Create invoice', [], undefined, undefined, undefined, undefined, SESSION_ID, USER_A),
    ).rejects.toThrow('Initial provider 503');

    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.saveSpy).not.toHaveBeenCalled();
    expect(await h.orchestrator.getConversationHistory(BIZ_A, SESSION_ID, USER_A)).toEqual([]);
  });

  it('chat() follow-up persistence failure does not mask the provider error or leak secrets', async () => {
    let completeCall = 0;
    const secret = 'CHAT_DB_SECRET_554433';
    const prisma = new InMemoryFlowSessionPrisma();
    prisma.upsertError = new Error(`DB error token=${secret}`);

    const h = makeHarness({
      prisma,
      trackAndComplete: async () => {
        completeCall += 1;
        if (completeCall === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call_chat_db_fail',
                type: 'function',
                function: { name: 'create_invoice', arguments: '{"amount":100}' },
              },
            ],
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          };
        }
        throw new Error('Follow-up gateway timeout');
      },
    });

    await expect(
      h.orchestrator.chat(BIZ_A, 'Create invoice', [], undefined, undefined, undefined, undefined, SESSION_ID, USER_A),
    ).rejects.toThrow('Follow-up gateway timeout');

    expect(h.prisma.client.flowSession.upsert).toHaveBeenCalledTimes(1);

    const allLogs = [
      ...h.logger.log.mock.calls,
      ...h.logger.warn.mock.calls,
      ...h.logger.error.mock.calls,
      ...h.logger.debug.mock.calls,
    ];
    expect(JSON.stringify(allLogs)).not.toContain(secret);
  });
});
