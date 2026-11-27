/**
 * R1 regression tests for FU-FLOW-SAVE-EXECUTED-TOOL-TURN ([R1-SEC-01] / [R1-COR-01]):
 *
 * Pins that:
 *   1. Disconnecting/breaking immediately on `tool_results` (before followUpStream
 *      starts) still persists the executed tool turn once, marked `failed: true`,
 *      with empty assistant content and without calling `finalizeStreamSession`.
 *   2. Disconnecting/breaking on `card` (onboarding card emitted right after
 *      `tool_results`) still persists the executed tool turn once, marked `failed: true`.
 *   3. Happy-path completion after tool execution calls `finalizeStreamSession` once
 *      and `saveConversationHistory` once WITHOUT `failed: true` (no double-save).
 *   4. A failed historical tool result with `result.error === undefined` replays
 *      `{ error: 'Unknown error' }` instead of `'{}'` in both `streamChat` and `chat`.
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

class InMemoryFlowSessionPrisma {
  rows: SessionRow[] = [];

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

const BIZ = 'biz_p136_r1';
const USER = 'user_p136_r1';
const SESSION = 'sess_p136_r1';

const savedKeyDisabled = process.env.KEY_DISABLED;
beforeEach(() => {
  delete process.env.KEY_DISABLED;
});
afterEach(() => {
  if (savedKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = savedKeyDisabled;
});

function makeHarness(opts: {
  trackAndStream?: (...args: any[]) => AsyncGenerator<Record<string, unknown>>;
  trackAndComplete?: (...args: any[]) => Promise<Record<string, unknown>>;
  executeTool?: (...args: any[]) => Promise<FlowToolResult>;
} = {}) {
  const prisma = new InMemoryFlowSessionPrisma();
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
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
        result: { id: 'inv_r1', number: 'INV-R1', total: 400 },
        changedEntities: ['invoice:inv_r1'],
        followOnSuggestions: [],
        family: 'commerce',
        riskTier: 2,
        success: true,
      })),
  );

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    governance: {
      evaluate: vi.fn(async () => ({
        allowed: true,
        tier: 1,
        reason: 'allowed',
        requiresQuickConfirm: false,
        requiresFormalApproval: false,
        requiresAdminApproval: false,
      })),
    },
    roleEngine,
    genomeExtractor: { extractFromTurn: vi.fn(async () => undefined) },
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
      getSnapshot: async () => ({ business: { name: 'R1 Co' } }),
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

  return { orchestrator, prisma, trackAndStream, trackAndComplete, executeTool, finalizeSpy, saveSpy };
}

describe('FU-FLOW-SAVE-EXECUTED-TOOL-TURN R1 ([R1-SEC-01] / [R1-COR-01])', () => {
  it('saves executed tool turn exactly once when consumer aborts immediately on chunk.type === "tool_results"', async () => {
    const h = makeHarness({
      trackAndStream: async function* () {
        yield {
          type: 'tool_call_delta',
          toolCall: {
            index: 0,
            id: 'call_abort_results',
            name: 'create_invoice',
            argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 400 }),
          },
        };
      },
    });

    const seenTypes: string[] = [];
    for await (const chunk of h.orchestrator.streamChat(
      BIZ,
      'Create invoice for Ana',
      [],
      undefined,
      undefined,
      undefined,
      SESSION,
      USER,
    )) {
      seenTypes.push(chunk.type);
      if (chunk.type === 'tool_results') {
        break;
      }
    }

    expect(seenTypes).toContain('tool_results');
    expect(h.executeTool).toHaveBeenCalledTimes(1);
    expect(h.trackAndStream).toHaveBeenCalledTimes(1);
    expect(h.finalizeSpy).not.toHaveBeenCalled();
    expect(h.saveSpy).toHaveBeenCalledTimes(1);

    const saved = await h.orchestrator.getConversationHistory(BIZ, SESSION, USER);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ role: 'user', content: 'Create invoice for Ana' });
    expect(saved[1]).toMatchObject({ role: 'assistant', content: '', failed: true });
    expect(saved[1].toolCalls).toEqual([
      expect.objectContaining({
        id: 'call_abort_results',
        name: 'create_invoice',
        arguments: { contactId: 'c_ana', amount: 400 },
      }),
    ]);
    expect(saved[1].toolResults).toEqual([
      expect.objectContaining({
        toolCallId: 'call_abort_results',
        name: 'create_invoice',
        success: true,
        result: { id: 'inv_r1', number: 'INV-R1', total: 400 },
      }),
    ]);
  });

  it('saves executed tool turn exactly once when consumer aborts on chunk.type === "card"', async () => {
    const h = makeHarness({
      trackAndStream: async function* () {
        yield {
          type: 'tool_call_delta',
          toolCall: {
            index: 0,
            id: 'call_inv_before_card',
            name: 'create_invoice',
            argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 400 }),
          },
        };
        yield {
          type: 'tool_call_delta',
          toolCall: {
            index: 1,
            id: 'call_card_emit',
            name: 'present_onboarding_card',
            argumentsDelta: JSON.stringify({ type: 'welcome' }),
          },
        };
      },
      executeTool: async (_biz: string, name: string, _args: Record<string, unknown>, toolCallId: string) => {
        if (name === 'present_onboarding_card') {
          return {
            toolCallId,
            name,
            result: { type: 'welcome', title: 'Welcome to KeyFlowOS' },
            changedEntities: [],
            followOnSuggestions: [],
            family: 'onboarding',
            riskTier: 0,
            success: true,
          };
        }
        return {
          toolCallId,
          name,
          result: { id: 'inv_r1', number: 'INV-R1', total: 400 },
          changedEntities: ['invoice:inv_r1'],
          followOnSuggestions: [],
          family: 'commerce',
          riskTier: 2,
          success: true,
        };
      },
    });

    const seenTypes: string[] = [];
    for await (const chunk of h.orchestrator.streamChat(
      BIZ,
      'Invoice Ana and show welcome card',
      [],
      undefined,
      undefined,
      undefined,
      SESSION,
      USER,
    )) {
      seenTypes.push(chunk.type);
      if (chunk.type === 'card') {
        break;
      }
    }

    expect(seenTypes).toEqual(expect.arrayContaining(['tool_results', 'card']));
    expect(h.executeTool).toHaveBeenCalledTimes(2);
    expect(h.trackAndStream).toHaveBeenCalledTimes(1);
    expect(h.finalizeSpy).not.toHaveBeenCalled();
    expect(h.saveSpy).toHaveBeenCalledTimes(1);

    const saved = await h.orchestrator.getConversationHistory(BIZ, SESSION, USER);
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ role: 'assistant', content: '', failed: true });
    expect(saved[1].toolCalls?.map((tc) => tc.id)).toEqual(['call_inv_before_card', 'call_card_emit']);
    expect(saved[1].toolResults?.map((r) => r.toolCallId)).toEqual(['call_inv_before_card', 'call_card_emit']);
  });

  it('happy-path control: normal follow-up completion calls finalizeStreamSession once and saveConversationHistory once without failed: true', async () => {
    let call = 0;
    const h = makeHarness({
      trackAndStream: async function* () {
        call += 1;
        if (call === 1) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: 0,
              id: 'call_happy_1',
              name: 'create_invoice',
              argumentsDelta: JSON.stringify({ contactId: 'c_ana', amount: 400 }),
            },
          };
          return;
        }
        yield { type: 'content_delta', content: 'Created invoice INV-R1 for $400.' };
      },
    });

    const chunks: FlowStreamChunk[] = [];
    for await (const chunk of h.orchestrator.streamChat(
      BIZ,
      'Create invoice for Ana',
      [],
      undefined,
      undefined,
      undefined,
      SESSION,
      USER,
    )) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(h.finalizeSpy).toHaveBeenCalledTimes(1);
    expect(h.saveSpy).toHaveBeenCalledTimes(1);

    const saved = await h.orchestrator.getConversationHistory(BIZ, SESSION, USER);
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({
      role: 'assistant',
      content: 'Created invoice INV-R1 for $400.',
    });
    expect(saved[1].failed).toBeUndefined();
  });

  it('replays { error: "Unknown error" } instead of "{}" when a failed historical tool result has error === undefined', async () => {
    const historyWithUndefinedError: FlowMessage[] = [
      { role: 'user', content: 'Add note for Ana' },
      {
        role: 'assistant',
        content: '',
        failed: true,
        toolCalls: [
          { id: 'call_undef_err', name: 'crm_add_note', arguments: { contactId: 'c_ana' }, riskLevel: 'low' },
        ],
        toolResults: [
          {
            toolCallId: 'call_undef_err',
            name: 'crm_add_note',
            result: null,
            changedEntities: [],
            followOnSuggestions: [],
            family: 'crm',
            riskTier: 1,
            success: false,
            error: undefined,
          },
        ],
      },
    ];

    // streamChat replay
    const hStream = makeHarness();
    for await (const _chunk of hStream.orchestrator.streamChat(
      BIZ,
      'Try again',
      historyWithUndefinedError,
      undefined,
      undefined,
      undefined,
      SESSION,
      USER,
    )) {
      void _chunk;
    }
    const streamReq = hStream.trackAndStream.mock.calls[0][3] as { messages: GatewayMessage[] };
    const streamToolMsg = streamReq.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call_undef_err');
    expect(streamToolMsg?.content).toBe(JSON.stringify({ error: 'Unknown error' }));

    // chat replay
    const hChat = makeHarness();
    await hChat.orchestrator.chat(
      BIZ,
      'Try again',
      historyWithUndefinedError,
      undefined,
      undefined,
      undefined,
      undefined,
      SESSION,
      USER,
    );
    const chatReq = hChat.trackAndComplete.mock.calls[0][3] as { messages: GatewayMessage[] };
    const chatToolMsg = chatReq.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call_undef_err');
    expect(chatToolMsg?.content).toBe(JSON.stringify({ error: 'Unknown error' }));
  });
});
