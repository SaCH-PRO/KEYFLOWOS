/**
 * V1-31 KEY-FLOW-CONFIRM-BIND (M46, KEY-CONFIRM-BIND-001): a Flow confirmation executes only
 * the call the server bound to it, never a tool name and arguments the client sends back.
 *
 * KF-EXEC-ACTION-001 closed this for the one capability the action boundary has adopted
 * (helpdesk_create_ticket). For every other tool, POST /ai/businesses/:businessId/flow/confirm
 * still executed whatever { toolName, toolArgs } the body named: chat() re-evaluated only the
 * name and then ran executeTool with the client's arguments. A member could confirm an action
 * KEY never proposed, or the proposed action with other arguments.
 *
 * Pinned here, through the real FlowOrchestratorService.chat / streamChat (only what a turn needs
 * before governance is stubbed, and the tool executor is a recorder):
 *  - a quick-confirm turn binds the call on the server (an IdempotencyKey row holding the tool,
 *    its arguments, the requester and the crew it was proposed under) and hands the client only
 *    its id;
 *  - a confirmation executes the bound call by that id: the name and arguments beside it are
 *    never read, and a confirmation without a bound id executes nothing;
 *  - the id is single use (replays and concurrent confirmations execute once), belongs to the
 *    member it was issued to and to its business, expires, can be cancelled, and is governed
 *    again at confirmation time on the bound tool;
 *  - the action boundary keeps answering its own confirmations (KF-EXEC-ACTION-001).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';

const BIZ = 'biz_v131';
const OTHER_BIZ = 'biz_v131_other';
const OWNER = 'u_v131_owner';
const OTHER = 'u_v131_other';
const TOOL = 'commerce_create_invoice';
const ARGS = { contactId: 'con_1', items: [{ description: 'Consulting', quantity: 2, unitPrice: 150 }], currency: 'TTD' };
const FORGED_ARGS = { contactId: 'con_attacker', items: [{ description: 'Anything', quantity: 1, unitPrice: 99999 }] };

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };

type Decision = {
  allowed: boolean;
  requiresQuickConfirm?: boolean;
  requiresFormalApproval?: boolean;
  requiresAdminApproval?: boolean;
  tier?: number;
  reason?: string;
};

const QUICK_CONFIRM: Decision = { allowed: true, requiresQuickConfirm: true, tier: 2, reason: 'Tier 2 needs a quick confirmation' };
const AUTO: Decision = { allowed: true, tier: 1, reason: 'Auto-execute' };

/** idempotency_keys as Postgres keeps it: unique on (businessId, idempotencyKey), updateMany a compare-and-set. */
function memoryIdempotencyKeys() {
  const rows = new Map<string, Record<string, any>>();
  const keyOf = (businessId: string, key: string) => `${businessId}\u0000${key}`;
  const matches = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([field, value]) => row[field] === value);
  const model = {
    create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
      const k = keyOf(data.businessId, data.idempotencyKey);
      if (rows.has(k)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      const now = new Date();
      const row = { id: `ik_${rows.size + 1}`, requestHash: null, response: null, error: null, createdAt: now, updatedAt: now, ...structuredClone(data) };
      rows.set(k, row);
      return structuredClone(row);
    }),
    findUnique: vi.fn(async ({ where }: { where: { businessId_idempotencyKey: { businessId: string; idempotencyKey: string } } }) => {
      const w = where.businessId_idempotencyKey;
      const row = rows.get(keyOf(w.businessId, w.idempotencyKey));
      return row ? structuredClone(row) : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (!matches(row, where)) continue;
        Object.assign(row, structuredClone(data), { updatedAt: new Date() });
        count += 1;
      }
      return { count };
    }),
  };
  return { rows, model, all: () => [...rows.values()].map((r) => structuredClone(r)) };
}

interface HarnessOptions {
  /** What the model calls on an ordinary turn. */
  toolCall?: { name: string; args: Record<string, unknown> };
  /** The crew the turn resolves. Mutable between turns. */
  crew?: string[];
  decide?: (tool: string, crew: unknown) => Decision;
}

function makeHarness(opts: HarnessOptions = {}) {
  const store = memoryIdempotencyKeys();
  const state = {
    crew: opts.crew ?? ['finance'],
    decide: opts.decide ?? ((): Decision => QUICK_CONFIRM),
    toolCall: opts.toolCall ?? { name: TOOL, args: ARGS },
  };
  const evaluations: Array<{ businessId: string; tool: string; crew: unknown; envelope: unknown }> = [];
  const governance = {
    evaluate: vi.fn(async (businessId: string, tool: string, _mode: unknown, crew: unknown, envelope: unknown) => {
      evaluations.push({ businessId, tool, crew, envelope });
      return {
        requiresQuickConfirm: false,
        requiresFormalApproval: false,
        requiresAdminApproval: false,
        tier: 2,
        reason: 'ok',
        ...state.decide(tool, crew),
      };
    }),
    createApprovalItem: vi.fn(async () => ({ id: 'appr_1' })),
    getToolTier: () => 2,
  };
  const boundary = {
    adopts: (name: string | null | undefined) => name === 'helpdesk_create_ticket',
    prepare: vi.fn(),
    confirmAndExecute: vi.fn(async () => ({ ticket: { id: 'tkt_1', title: 'Boundary ticket' } })),
    voidAction: vi.fn(async () => undefined),
  };
  const executed: Array<{ businessId: string; name: string; args: unknown; toolCallId: string | undefined }> = [];
  const executeTool = vi.fn(async (businessId: string, name: string, args: Record<string, unknown>, toolCallId?: string) => {
    executed.push({ businessId, name, args: structuredClone(args), toolCallId });
    return {
      toolCallId: toolCallId ?? `manual_${name}`,
      name,
      result: { id: 'inv_1', invoiceNumber: 'INV-1' },
      changedEntities: [],
      followOnSuggestions: [],
      family: 'commerce',
      riskTier: 2,
      success: true,
    };
  });
  const modelToolCalls = () =>
    state.toolCall ? [{ id: 'tc_1', type: 'function', function: { name: state.toolCall.name, arguments: JSON.stringify(state.toolCall.args) } }] : [];
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma: { client: { idempotencyKey: store.model } },
    governance,
    executionLog: { log: vi.fn(async () => undefined), logToolExecution: vi.fn(async () => undefined) },
    moduleRef: { get: (token: unknown) => (token === KeyActionBoundaryService ? boundary : undefined) },
    businessGraph: { invalidateCache() {}, getSnapshot: async () => ({ business: { name: 'Biz' } }), buildContextString: () => '' },
    roleEngine: { getSystemPromptForCrew: () => 'You are KEY. {{CURRENT_DATE}}' },
    aiUsage: {
      checkRateLimit() {},
      checkCredits: async () => ({ allowed: true }),
      trackAndComplete: async () => ({ content: '', toolCalls: modelToolCalls(), usage }),
      trackAndStream: async function* () {
        for (const tc of modelToolCalls()) {
          yield { type: 'tool_call_delta', toolCall: { index: 0, id: tc.id, name: tc.function.name, argumentsDelta: tc.function.arguments } };
        }
        yield { type: 'usage', usage };
      },
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    selectToolsForRequest: async () => [],
    resolveTurnAuthority: async () => ({ primary: state.crew[0] ?? 'general', crew: [...state.crew], scores: {} }),
    saveConversationHistory: vi.fn(async () => undefined),
    enforceDoNotSay: async () => undefined,
    finalizeStreamSession: async function* () {},
    executeTool,
  }) as FlowOrchestratorService;

  /** An ordinary turn in which the model calls state.toolCall. */
  const ask = (userId: string | null = OWNER, businessId = BIZ) =>
    orchestrator.chat(businessId, 'invoice the client for two hours', [], undefined, undefined, undefined, undefined, 's_1', userId ?? undefined);
  /** POST flow/confirm, as AiFlowController.confirmAction calls chat(). */
  const confirm = (pending: Record<string, unknown>, userId: string | null = OWNER, businessId = BIZ) =>
    orchestrator.chat(
      businessId,
      pending.confirmed === false ? 'No, cancel.' : 'Yes, proceed.',
      [],
      { toolCallId: 'tc_1', confirmed: true, ...pending } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      userId ?? undefined,
    );
  /** The id the server hands the client with a quick-confirm turn. */
  const issue = async (userId: string | null = OWNER, businessId = BIZ) => {
    const turn = await ask(userId, businessId);
    expect(turn.requiresConfirmation).toBe(true);
    expect(turn.pendingConfirmations).toHaveLength(1);
    const id = turn.pendingConfirmations![0].confirmationId;
    expect(id, 'the server issues an id with every quick confirmation').toEqual(expect.any(String));
    return id as string;
  };
  return { orchestrator, state, store, governance, boundary, evaluations, executed, executeTool, ask, confirm, issue };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('V1-31 KEY-CONFIRM-BIND — a confirmation that carries only a client tool name and arguments executes nothing', () => {
  it.each([TOOL, 'crm_create_contact', 'payments_refund_charge', 'commerce_send_invoice'])(
    'the repro: %s, allowed by governance, is not executed from the client body',
    async (tool) => {
      const h = makeHarness({ decide: () => AUTO });
      const response = await h.confirm({ toolName: tool, toolArgs: FORGED_ARGS });

      expect(h.executeTool).not.toHaveBeenCalled();
      expect(response.reply).toMatch(/was not executed/);
      expect(response.toolResults).toBeUndefined();
      expect(h.store.all()).toEqual([]);
    },
  );

  it('even with the quick-confirm decision the turn would have issued, the client body executes nothing', async () => {
    const h = makeHarness({ decide: () => QUICK_CONFIRM });
    const response = await h.confirm({ toolName: TOOL, toolArgs: ARGS });
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(response.reply).toMatch(/was not executed/);
  });

  it('a refused tool still answers with the governance refusal, and executes nothing', async () => {
    const h = makeHarness({ decide: () => ({ allowed: false, reason: 'Tool "crm_delete_contact" is not available to the general role' }) });
    const response = await h.confirm({ toolName: 'crm_delete_contact', toolArgs: { contactId: 'c_1' } });
    expect(response.reply).toBe('This action is blocked: Tool "crm_delete_contact" is not available to the general role');
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('a confirmation with no id and no tool name is not a turn of its own: nothing is executed and the model is not asked', async () => {
    const h = makeHarness({ decide: () => AUTO });
    const response = await h.confirm({});
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(response.reply).toMatch(/was not executed/);
    expect(response.toolCalls).toBeUndefined();
  });

  it('"No, cancel." without an id still answers as a cancellation', async () => {
    const h = makeHarness();
    const response = await h.confirm({ confirmed: false, toolName: TOOL, toolArgs: ARGS });
    expect(response.reply).toMatch(/cancelled/);
    expect(h.executeTool).not.toHaveBeenCalled();
  });
});

describe('V1-31 — a quick-confirm turn binds the call on the server and hands the client its id', () => {
  it('chat(): the pending confirmation carries a server-issued id; the server row holds the call, the requester and the crew', async () => {
    const h = makeHarness({ crew: ['finance'] });
    const turn = await h.ask();

    expect(h.executeTool).not.toHaveBeenCalled();
    const [pending] = turn.pendingConfirmations!;
    expect(pending).toMatchObject({ toolCallId: 'tc_1', name: TOOL, arguments: ARGS });
    expect(pending.confirmationId).toEqual(expect.stringMatching(/^flowc_[0-9a-f-]{36}$/));

    const rows = h.store.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: BIZ,
      idempotencyKey: `flow-confirm:${pending.confirmationId}`,
      status: 'pending',
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      response: {
        kind: 'flow_confirmation',
        toolName: TOOL,
        argsJson: JSON.stringify(ARGS),
        toolCallId: 'tc_1',
        requestedBy: OWNER,
        crew: ['finance'],
        surface: 'CHAT',
      },
    });
  });

  it('streamChat(): the confirmation_required chunk carries a server-issued id bound the same way', async () => {
    const h = makeHarness({ crew: ['finance'] });
    const chunks: any[] = [];
    for await (const chunk of h.orchestrator.streamChat(BIZ, 'invoice the client for two hours', [], undefined, undefined, undefined, 's_1', OWNER)) {
      chunks.push(chunk);
    }
    const required = chunks.find((c) => c.type === 'confirmation_required');
    expect(required).toBeDefined();
    const id = required.pendingConfirmations[0].confirmationId;
    expect(id).toEqual(expect.stringMatching(/^flowc_/));
    expect(h.store.all()).toMatchObject([
      { businessId: BIZ, idempotencyKey: `flow-confirm:${id}`, status: 'pending', response: { toolName: TOOL, argsJson: JSON.stringify(ARGS), requestedBy: OWNER, surface: 'CHAT_STREAM' } },
    ]);
    expect(h.executeTool).not.toHaveBeenCalled();

    // The stream's id confirms through the REST route like any other.
    const response = await h.confirm({ confirmationId: id });
    expect(response.reply).toMatch(/^Done!/);
    expect(h.executed).toEqual([{ businessId: BIZ, name: TOOL, args: ARGS, toolCallId: 'tc_1' }]);
  });

  it('a turn with no authenticated requester binds nothing, so nothing it shows can be confirmed', async () => {
    const h = makeHarness();
    const turn = await h.ask(null);
    expect(turn.pendingConfirmations![0].confirmationId).toBeUndefined();
    expect(h.store.all()).toEqual([]);
  });

  it('a store that cannot record the binding fails closed: no id is issued and the client body still executes nothing', async () => {
    const h = makeHarness();
    h.store.model.create.mockRejectedValueOnce(new Error('connection refused'));
    const turn = await h.ask();
    expect(turn.pendingConfirmations![0].confirmationId).toBeUndefined();
    const response = await h.confirm({ toolName: TOOL, toolArgs: ARGS });
    expect(response.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
  });
});

describe('V1-31 — confirming by id executes the bound call and nothing else', () => {
  it('whatever tool name and arguments the client sends beside the id, the stored call is the one executed', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();

    const response = await h.confirm({ confirmationId, toolName: 'payments_refund_charge', toolArgs: FORGED_ARGS });

    expect(response.reply).toMatch(/^Done!/);
    expect(h.executed).toEqual([{ businessId: BIZ, name: TOOL, args: ARGS, toolCallId: 'tc_1' }]);
    expect(response.toolResults).toMatchObject([{ name: TOOL, toolCallId: 'tc_1', success: true }]);
    expect(h.store.all()[0]).toMatchObject({ status: 'completed' });
  });

  it('the id alone is enough: no name or arguments need to come back', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();
    const response = await h.confirm({ confirmationId });
    expect(response.reply).toMatch(/^Done!/);
    expect(h.executed).toEqual([{ businessId: BIZ, name: TOOL, args: ARGS, toolCallId: 'tc_1' }]);
  });

  it('a replayed confirmation executes nothing more, whether sequential or concurrent', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => h.confirm({ confirmationId })));
    expect(h.executed).toHaveLength(1);
    expect(concurrent.filter((r) => /^Done!/.test(r.reply))).toHaveLength(1);

    const later = await h.confirm({ confirmationId });
    expect(h.executed).toHaveLength(1);
    expect(later.reply).toMatch(/already/);
  });

  it("someone else's confirmation id executes nothing and stays usable by its owner", async () => {
    const h = makeHarness();
    const confirmationId = await h.issue(OWNER);

    const stolen = await h.confirm({ confirmationId }, OTHER);
    expect(stolen.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.store.all()[0]).toMatchObject({ status: 'pending' });

    const own = await h.confirm({ confirmationId }, OWNER);
    expect(own.reply).toMatch(/^Done!/);
    expect(h.executed).toHaveLength(1);
  });

  it('a confirmation with no authenticated user executes nothing', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();
    const response = await h.confirm({ confirmationId }, null);
    expect(response.reply).toMatch(/authenticated user is required/);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.store.all()[0]).toMatchObject({ status: 'pending' });
  });

  it("another business's path cannot use the id", async () => {
    const h = makeHarness();
    const confirmationId = await h.issue(OWNER, BIZ);
    const response = await h.confirm({ confirmationId }, OWNER, OTHER_BIZ);
    expect(response.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.store.all()[0]).toMatchObject({ businessId: BIZ, status: 'pending' });
  });

  it('an id the server never issued executes nothing', async () => {
    const h = makeHarness();
    const response = await h.confirm({ confirmationId: 'flowc_00000000-0000-4000-8000-000000000000', toolName: TOOL, toolArgs: ARGS });
    expect(response.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('"No, cancel." ends the confirmation: a later confirmation executes nothing', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();

    const cancelled = await h.confirm({ confirmationId, confirmed: false });
    expect(cancelled.reply).toMatch(/cancelled/);
    expect(h.store.all()[0]).toMatchObject({ status: 'cancelled' });

    const late = await h.confirm({ confirmationId });
    expect(late.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it("someone else cannot cancel a member's confirmation", async () => {
    const h = makeHarness();
    const confirmationId = await h.issue(OWNER);
    await h.confirm({ confirmationId, confirmed: false }, OTHER);
    expect(h.store.all()[0]).toMatchObject({ status: 'pending' });
  });

  it('an expired confirmation executes nothing', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

    const response = await h.confirm({ confirmationId });
    expect(response.reply).toMatch(/expired/);
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('a stored call that no longer matches the hash recorded with it executes nothing', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();
    const [row] = h.store.rows.values();
    row.response.argsJson = JSON.stringify(FORGED_ARGS);

    const response = await h.confirm({ confirmationId });
    expect(response.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
  });
});

describe('V1-31 — governance is evaluated again at confirmation time, on the bound call', () => {
  it('on the stored tool and the crew it was proposed under, not on the client body or the "Yes, proceed." turn', async () => {
    const h = makeHarness({ crew: ['finance'] });
    const confirmationId = await h.issue();
    h.state.crew = ['general'];
    h.evaluations.length = 0;

    await h.confirm({ confirmationId, toolName: 'payments_refund_charge', toolArgs: FORGED_ARGS });

    expect(h.evaluations).toEqual([{ businessId: BIZ, tool: TOOL, crew: ['finance'], envelope: undefined }]);
    expect(h.executed).toHaveLength(1);
  });

  it('a call governance now refuses is not executed, and its confirmation is spent', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();
    h.state.decide = () => ({ allowed: false, reason: 'Autonomy is paused' });

    const response = await h.confirm({ confirmationId });
    expect(response.reply).toBe('This action is blocked: Autonomy is paused');
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.store.all()[0].status).not.toBe('pending');
  });

  it('a call that now needs formal approval is queued with the stored arguments, not executed', async () => {
    const h = makeHarness();
    const confirmationId = await h.issue();
    h.state.decide = () => ({ allowed: true, requiresFormalApproval: true, tier: 3, reason: 'Tier 3' });

    const response = await h.confirm({ confirmationId, toolArgs: FORGED_ARGS });
    expect(response.reply).toMatch(/approval/);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.governance.createApprovalItem).toHaveBeenCalledTimes(1);
    expect(h.governance.createApprovalItem).toHaveBeenCalledWith(BIZ, expect.objectContaining({ toolName: TOOL, inputPayload: ARGS }));
  });
});

describe('V1-31 — the action boundary keeps its own confirmations (KF-EXEC-ACTION-001)', () => {
  it('a boundary id is answered by the boundary, for the authenticated member, and never by the Flow executor', async () => {
    const h = makeHarness();
    const response = await h.confirm({ confirmationId: 'cmaction0000000000000001', toolName: TOOL, toolArgs: FORGED_ARGS });
    expect(h.boundary.confirmAndExecute).toHaveBeenCalledWith(BIZ, 'cmaction0000000000000001', OWNER);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(response.reply).toMatch(/^Done!/);
  });

  it('an adopted tool resubmitted by name executes nothing', async () => {
    const h = makeHarness({ decide: () => AUTO });
    const response = await h.confirm({ toolName: 'helpdesk_create_ticket', toolArgs: { title: 'x' } });
    expect(response.reply).toMatch(/was not executed/);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.boundary.confirmAndExecute).not.toHaveBeenCalled();
  });
});
