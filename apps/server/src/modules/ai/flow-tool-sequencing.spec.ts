/**
 * RR-TOOL-WRITES-SEQUENTIAL (P127 / V1-72; D-261, D-262, D-17, D-73):
 * Flow chat runs the writes of one model turn one at a time in model order;
 * only consecutive READ calls (where isReadOnlyTool(name) === true) run in
 * parallel. Unknown tool names, MCP-bridged names and dotted cortex names are
 * treated as non-READ and execute sequentially alone. A failed write (whether
 * returning `{ success: false }` or rejecting) never cancels later calls in the
 * turn, and results always keep exact model order.
 *
 * Stubs follow flow-tool-args-malformed.spec.ts: FlowOrchestratorService is
 * instantiated from its prototype with mocked gateway, governance, executeTool
 * and session persistence. Zero live AI or DB calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlowOrchestratorService, type FlowToolResult } from './flow-orchestrator.service';
import { isReadOnlyTool } from './flow-tool-registry';
import { RoleEngineService } from './role-engine.service';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService } from '../structure/job-role-policy.service';

const BIZ = 'biz_rr_tool_seq';
const USER = 'u_rr_tool_seq';
const savedKeyDisabled = process.env.KEY_DISABLED;

beforeEach(() => {
  delete process.env.KEY_DISABLED;
});

afterEach(() => {
  if (savedKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = savedKeyDisabled;
});

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  settled: boolean;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const d: Deferred<T> = {
    promise: undefined as unknown as Promise<T>,
    resolve: () => {},
    reject: () => {},
    settled: false,
  };
  d.promise = new Promise<T>((res, rej) => {
    resolve = (v) => {
      d.settled = true;
      res(v);
    };
    reject = (e) => {
      d.settled = true;
      rej(e);
    };
  });
  d.resolve = resolve;
  d.reject = reject;
  return d;
}

async function flushTicks(count = 6): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
  await new Promise((r) => setTimeout(r, 10));
}

async function waitWithTimeout<T>(promise: Promise<T>, label: string, ms = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`Timed out waiting for ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeOkResult(toolCallId: string, name: string): FlowToolResult {
  return {
    toolCallId,
    name,
    result: { ok: true, id: toolCallId, tool: name },
    changedEntities: [],
    followOnSuggestions: [],
    family: isReadOnlyTool(name) ? 'read' : 'crud',
    riskTier: 1,
    success: true,
  };
}

function makeFailedResult(toolCallId: string, name: string, error: string): FlowToolResult {
  return {
    toolCallId,
    name,
    result: null,
    changedEntities: [],
    followOnSuggestions: [],
    family: isReadOnlyTool(name) ? 'read' : 'crud',
    riskTier: 1,
    success: false,
    error,
  };
}

type ToolCallSpec = { id: string; name: string; arguments: string };

function makeOrchestrator(
  toolCalls: ToolCallSpec[],
  executeImpl: (biz: string, name: string, args: Record<string, unknown>, toolCallId: string) => Promise<FlowToolResult>,
) {
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const governance = {
    evaluate: vi.fn(async () => ({
      allowed: true,
      tier: 1,
      reason: 'auto-cleared',
      requiresQuickConfirm: false,
      requiresFormalApproval: false,
      requiresAdminApproval: false,
    })),
    createApprovalItem: vi.fn(async () => undefined),
    getToolTier: vi.fn(() => 1),
  };
  const trackAndComplete = vi
    .fn()
    .mockResolvedValueOnce({
      content: 'Running those now.',
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    .mockResolvedValueOnce({
      content: 'All done.',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

  let streamCallCount = 0;
  const trackAndStream = vi.fn(() => {
    streamCallCount += 1;
    if (streamCallCount === 1) {
      return (async function* () {
        for (const [index, tc] of toolCalls.entries()) {
          yield {
            type: 'tool_call_delta',
            toolCall: { index, id: tc.id, name: tc.name, argumentsDelta: tc.arguments },
          };
        }
        yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 } };
      })();
    }
    return (async function* () {
      yield { type: 'content_delta', content: 'All done.' };
    })();
  });

  const finalizeStreamSession = vi.fn(async function* () {
    yield { type: 'done' };
  });
  const executeTool = vi.fn(executeImpl);
  const saveConversationHistory = vi.fn(async () => undefined);

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
      trackAndComplete,
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
    memberScopeRefusal: async () => null,
    saveConversationHistory,
    enforceDoNotSay: async () => undefined,
    finalizeStreamSession,
    executeTool,
  }) as FlowOrchestratorService;

  return { orchestrator, governance, trackAndComplete, trackAndStream, finalizeStreamSession, executeTool, saveConversationHistory };
}

async function runStream(o: FlowOrchestratorService) {
  const chunks: Array<Record<string, any>> = [];
  for await (const chunk of o.streamChat(BIZ, 'do the turn', [], undefined, undefined, undefined, undefined, USER)) {
    chunks.push(chunk as Record<string, any>);
  }
  return chunks;
}

/**
 * Per-call barrier tracker: records start/end/reject events, live concurrency,
 * overlap counts, and allows deterministic gating of each tool call by id.
 */
function createBarrierHarness(ids: string[]) {
  const started = new Map<string, Deferred<void>>();
  const gates = new Map<string, Deferred<void>>();
  for (const id of ids) {
    started.set(id, deferred<void>());
    gates.set(id, deferred<void>());
  }
  const events: string[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  let overlapCount = 0;

  const releaseAll = () => {
    for (const g of gates.values()) {
      if (!g.settled) g.resolve();
    }
  };

  const wrap = (
    onComplete?: (id: string, name: string) => FlowToolResult | Promise<FlowToolResult>,
  ) => async (_biz: string, name: string, _args: Record<string, unknown>, toolCallId: string): Promise<FlowToolResult> => {
    if (inFlight > 0) overlapCount += 1;
    inFlight += 1;
    if (inFlight > maxConcurrent) maxConcurrent = inFlight;
    events.push(`start:${toolCallId}`);
    started.get(toolCallId)?.resolve();

    try {
      await gates.get(toolCallId)?.promise;
      const result = onComplete ? await onComplete(toolCallId, name) : makeOkResult(toolCallId, name);
      events.push(`end:${toolCallId}`);
      return result;
    } catch (err) {
      events.push(`reject:${toolCallId}`);
      throw err;
    } finally {
      inFlight -= 1;
    }
  };

  return {
    started,
    gates,
    events,
    get maxConcurrent() {
      return maxConcurrent;
    },
    get overlapCount() {
      return overlapCount;
    },
    releaseAll,
    wrap,
  };
}

describe('Flow chat tool call sequencing (RR-TOOL-WRITES-SEQUENTIAL / P127)', () => {
  it('registry classification sanity: test READ tools are READ, test WRITE & unknown tools are non-READ', () => {
    expect(isReadOnlyTool('fetch_business_summary')).toBe(true);
    expect(isReadOnlyTool('fetch_client_health')).toBe(true);
    expect(isReadOnlyTool('fetch_schedule_health')).toBe(true);
    expect(isReadOnlyTool('fetch_revenue_risk')).toBe(true);

    expect(isReadOnlyTool('crm_create_contact')).toBe(false);
    expect(isReadOnlyTool('crm_add_note')).toBe(false);
    expect(isReadOnlyTool('crm_update_contact')).toBe(false);
    expect(isReadOnlyTool('totally_unknown_tool')).toBe(false);
    expect(isReadOnlyTool('mcp__srv__lookup')).toBe(false);
    expect(isReadOnlyTool('cortex.list_tasks')).toBe(false);
  });

  describe('two writes in one turn execute sequentially (never concurrently)', () => {
    const TWO_WRITES: ToolCallSpec[] = [
      { id: 'w1', name: 'crm_create_contact', arguments: '{"firstName":"Ada"}' },
      { id: 'w2', name: 'crm_add_note', arguments: '{"contactId":"c_1","body":"VIP"}' },
    ];

    it('DoD RED (chat): write2 does not start until write1 finishes, overlap === 0, model order preserved', async () => {
      const h = createBarrierHarness(['w1', 'w2']);
      const t = makeOrchestrator(TWO_WRITES, h.wrap());

      let startedWhileW1Pending: string[] = [];
      let response: Awaited<ReturnType<FlowOrchestratorService['chat']>>;
      try {
        const turnPromise = t.orchestrator.chat(BIZ, 'create Ada and add a note', [], undefined, undefined, undefined, undefined, undefined, USER);
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        startedWhileW1Pending = [...h.events];

        h.gates.get('w1')!.resolve();
        h.gates.get('w2')!.resolve();
        response = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(startedWhileW1Pending).toEqual(['start:w1']);
      expect(h.overlapCount).toBe(0);
      expect(h.maxConcurrent).toBe(1);
      expect(h.events).toEqual(['start:w1', 'end:w1', 'start:w2', 'end:w2']);
      expect(response.toolResults?.map((r) => r.toolCallId)).toEqual(['w1', 'w2']);
      expect(response.reply).toBe('All done.');

      const followUp = t.trackAndComplete.mock.calls[1][3].messages as Array<Record<string, any>>;
      expect(followUp.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['w1', 'w2']);
    });

    it('DoD RED (streamChat): write2 does not start until write1 finishes, overlap === 0, stream events ordered', async () => {
      const h = createBarrierHarness(['w1', 'w2']);
      const t = makeOrchestrator(TWO_WRITES, h.wrap());

      let startedWhileW1Pending: string[] = [];
      let chunks: Array<Record<string, any>>;
      try {
        const turnPromise = runStream(t.orchestrator);
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        startedWhileW1Pending = [...h.events];

        h.gates.get('w1')!.resolve();
        h.gates.get('w2')!.resolve();
        chunks = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(startedWhileW1Pending).toEqual(['start:w1']);
      expect(h.overlapCount).toBe(0);
      expect(h.maxConcurrent).toBe(1);
      expect(h.events).toEqual(['start:w1', 'end:w1', 'start:w2', 'end:w2']);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);

      const types = chunks.map((c) => c.type);
      const toolCallsIdx = types.indexOf('tool_calls');
      const toolResultsIdx = types.indexOf('tool_results');
      const doneIdx = types.lastIndexOf('done');
      expect(toolCallsIdx).toBeGreaterThanOrEqual(0);
      expect(toolResultsIdx).toBeGreaterThan(toolCallsIdx);
      expect(doneIdx).toBeGreaterThan(toolResultsIdx);

      const resultsChunk = chunks[toolResultsIdx];
      expect(resultsChunk.toolResults.map((r: FlowToolResult) => r.toolCallId)).toEqual(['w1', 'w2']);
    });
  });

  describe('consecutive READ calls run in parallel (negative control)', () => {
    const TWO_READS: ToolCallSpec[] = [
      { id: 'r1', name: 'fetch_business_summary', arguments: '{}' },
      { id: 'r2', name: 'fetch_client_health', arguments: '{}' },
    ];

    it('chat: two READs both start before either resolves, and results keep model order even when r2 finishes first', async () => {
      const h = createBarrierHarness(['r1', 'r2']);
      const t = makeOrchestrator(TWO_READS, h.wrap());

      let response: Awaited<ReturnType<FlowOrchestratorService['chat']>>;
      try {
        const turnPromise = t.orchestrator.chat(BIZ, 'summarize business and clients', [], undefined, undefined, undefined, undefined, undefined, USER);
        await waitWithTimeout(
          Promise.all([h.started.get('r1')!.promise, h.started.get('r2')!.promise]),
          'both READs starting concurrently',
        );
        // Resolve r2 before r1 to prove output ordering does not depend on completion order
        h.gates.get('r2')!.resolve();
        await flushTicks();
        h.gates.get('r1')!.resolve();
        response = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.maxConcurrent).toBe(2);
      expect(h.events.slice(0, 2)).toEqual(['start:r1', 'start:r2']);
      expect(h.events.indexOf('end:r2')).toBeLessThan(h.events.indexOf('end:r1'));
      expect(response.toolResults?.map((r) => r.toolCallId)).toEqual(['r1', 'r2']);
    });

    it('streamChat: two READs both start before either resolves, and tool_results keeps model order', async () => {
      const h = createBarrierHarness(['r1', 'r2']);
      const t = makeOrchestrator(TWO_READS, h.wrap());

      let chunks: Array<Record<string, any>>;
      try {
        const turnPromise = runStream(t.orchestrator);
        await waitWithTimeout(
          Promise.all([h.started.get('r1')!.promise, h.started.get('r2')!.promise]),
          'both READs starting concurrently in streamChat',
        );
        h.gates.get('r2')!.resolve();
        await flushTicks();
        h.gates.get('r1')!.resolve();
        chunks = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.maxConcurrent).toBe(2);
      expect(h.events.slice(0, 2)).toEqual(['start:r1', 'start:r2']);
      const resultsChunk = chunks.find((c) => c.type === 'tool_results');
      expect(resultsChunk?.toolResults.map((r: FlowToolResult) => r.toolCallId)).toEqual(['r1', 'r2']);
    });
  });

  describe('mixed turn [read1, read2, write1, write2, read3, read4]', () => {
    const MIXED_TURN: ToolCallSpec[] = [
      { id: 'r1', name: 'fetch_business_summary', arguments: '{}' },
      { id: 'r2', name: 'fetch_client_health', arguments: '{}' },
      { id: 'w1', name: 'crm_create_contact', arguments: '{"firstName":"Ada"}' },
      { id: 'w2', name: 'crm_add_note', arguments: '{"contactId":"c_1","body":"Note"}' },
      { id: 'r3', name: 'fetch_schedule_health', arguments: '{}' },
      { id: 'r4', name: 'fetch_revenue_risk', arguments: '{}' },
    ];

    async function driveMixedTurn(runTurn: (o: FlowOrchestratorService) => Promise<FlowToolResult[]>) {
      const h = createBarrierHarness(['r1', 'r2', 'w1', 'w2', 'r3', 'r4']);
      const t = makeOrchestrator(MIXED_TURN, h.wrap());

      let eventsAfterReadBatch1Start: string[] = [];
      let eventsWhileW1Pending: string[] = [];
      let eventsWhileW2Pending: string[] = [];
      let results: FlowToolResult[];

      try {
        const turnPromise = runTurn(t.orchestrator);

        // Phase 1: r1 & r2 must both start concurrently while w1, w2, r3, r4 stay idle
        await waitWithTimeout(
          Promise.all([h.started.get('r1')!.promise, h.started.get('r2')!.promise]),
          'read batch 1 concurrent start',
        );
        await flushTicks();
        eventsAfterReadBatch1Start = [...h.events];

        // Finish read batch 1 out of order (r2 before r1)
        h.gates.get('r2')!.resolve();
        await flushTicks();
        h.gates.get('r1')!.resolve();

        // Phase 2: w1 starts ONLY after r1 & r2 finish; w2, r3, r4 must not start
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        eventsWhileW1Pending = [...h.events];
        h.gates.get('w1')!.resolve();

        // Phase 3: w2 starts ONLY after w1 finishes; r3, r4 must not start
        await waitWithTimeout(h.started.get('w2')!.promise, 'w2 start');
        await flushTicks();
        eventsWhileW2Pending = [...h.events];
        h.gates.get('w2')!.resolve();

        // Phase 4: r3 & r4 start concurrently ONLY after w2 finishes
        await waitWithTimeout(
          Promise.all([h.started.get('r3')!.promise, h.started.get('r4')!.promise]),
          'read batch 2 concurrent start',
        );
        h.gates.get('r4')!.resolve();
        await flushTicks();
        h.gates.get('r3')!.resolve();

        results = await turnPromise;
      } finally {
        h.releaseAll();
      }

      // Phase 1: only r1 and r2 started
      expect(eventsAfterReadBatch1Start).toEqual(['start:r1', 'start:r2']);

      // Phase 2: w1 ran strictly after r1 and r2 ended, alone
      expect(eventsWhileW1Pending).toEqual(['start:r1', 'start:r2', 'end:r2', 'end:r1', 'start:w1']);

      // Phase 3: w2 ran strictly after w1 ended, alone
      expect(eventsWhileW2Pending).toEqual(['start:r1', 'start:r2', 'end:r2', 'end:r1', 'start:w1', 'end:w1', 'start:w2']);

      // Phase 4: r3 & r4 ran concurrently strictly after w2 ended
      expect(h.events).toEqual([
        'start:r1', 'start:r2', 'end:r2', 'end:r1',
        'start:w1', 'end:w1',
        'start:w2', 'end:w2',
        'start:r3', 'start:r4', 'end:r4', 'end:r3',
      ]);

      // Results stay in exact model order
      expect(results.map((r) => r.toolCallId)).toEqual(['r1', 'r2', 'w1', 'w2', 'r3', 'r4']);
      expect(results.every((r) => r.success)).toBe(true);
    }

    it('DoD RED (chat): batches consecutive READs and isolates each WRITE in exact model order', async () => {
      await driveMixedTurn(async (o) => {
        const res = await o.chat(BIZ, 'full mixed turn', [], undefined, undefined, undefined, undefined, undefined, USER);
        return res.toolResults ?? [];
      });
    });

    it('DoD RED (streamChat): batches consecutive READs and isolates each WRITE in exact model order', async () => {
      await driveMixedTurn(async (o) => {
        const chunks = await runStream(o);
        expect(chunks.some((c) => c.type === 'error')).toBe(false);
        expect(chunks.at(-1)).toEqual({ type: 'done' });
        return chunks.find((c) => c.type === 'tool_results')?.toolResults ?? [];
      });
    });
  });

  describe('unknown, MCP-bridged, and dotted cortex tool names are treated as non-READ', () => {
    it('DoD RED (chat): totally_unknown_tool runs alone and never overlaps adjacent READ calls', async () => {
      const calls: ToolCallSpec[] = [
        { id: 'r1', name: 'fetch_business_summary', arguments: '{}' },
        { id: 'unk', name: 'totally_unknown_tool', arguments: '{"x":1}' },
        { id: 'r2', name: 'fetch_client_health', arguments: '{}' },
      ];
      const h = createBarrierHarness(['r1', 'unk', 'r2']);
      const t = makeOrchestrator(calls, h.wrap());

      let eventsWhileUnkPending: string[] = [];
      let response: Awaited<ReturnType<FlowOrchestratorService['chat']>>;
      try {
        const turnPromise = t.orchestrator.chat(BIZ, 'run unknown between reads', [], undefined, undefined, undefined, undefined, undefined, USER);
        await waitWithTimeout(h.started.get('r1')!.promise, 'r1 start');
        h.gates.get('r1')!.resolve();

        await waitWithTimeout(h.started.get('unk')!.promise, 'unk start');
        await flushTicks();
        eventsWhileUnkPending = [...h.events];
        h.gates.get('unk')!.resolve();

        await waitWithTimeout(h.started.get('r2')!.promise, 'r2 start');
        h.gates.get('r2')!.resolve();
        response = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(eventsWhileUnkPending).toEqual(['start:r1', 'end:r1', 'start:unk']);
      expect(h.overlapCount).toBe(0);
      expect(h.maxConcurrent).toBe(1);
      expect(h.events).toEqual(['start:r1', 'end:r1', 'start:unk', 'end:unk', 'start:r2', 'end:r2']);
      expect(response.toolResults?.map((r) => r.toolCallId)).toEqual(['r1', 'unk', 'r2']);
    });

    it('DoD RED (streamChat): unknown, mcp__* and dotted cortex.* tools each run sequentially alone', async () => {
      const calls: ToolCallSpec[] = [
        { id: 'r1', name: 'fetch_business_summary', arguments: '{}' },
        { id: 'unk', name: 'totally_unknown_tool', arguments: '{}' },
        { id: 'mcp1', name: 'mcp__srv__lookup', arguments: '{}' },
        { id: 'ctx1', name: 'cortex.list_tasks', arguments: '{}' },
        { id: 'r2', name: 'fetch_client_health', arguments: '{}' },
      ];
      const h = createBarrierHarness(['r1', 'unk', 'mcp1', 'ctx1', 'r2']);
      const t = makeOrchestrator(calls, h.wrap());

      let chunks: Array<Record<string, any>>;
      try {
        const turnPromise = runStream(t.orchestrator);
        for (const id of ['r1', 'unk', 'mcp1', 'ctx1', 'r2']) {
          await waitWithTimeout(h.started.get(id)!.promise, `${id} start`);
          await flushTicks();
          h.gates.get(id)!.resolve();
        }
        chunks = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.overlapCount).toBe(0);
      expect(h.maxConcurrent).toBe(1);
      expect(h.events).toEqual([
        'start:r1', 'end:r1',
        'start:unk', 'end:unk',
        'start:mcp1', 'end:mcp1',
        'start:ctx1', 'end:ctx1',
        'start:r2', 'end:r2',
      ]);
      const resultsChunk = chunks.find((c) => c.type === 'tool_results');
      expect(resultsChunk?.toolResults.map((r: FlowToolResult) => r.toolCallId)).toEqual(['r1', 'unk', 'mcp1', 'ctx1', 'r2']);
    });
  });

  describe('failure isolation: a failed write does not cancel later calls', () => {
    const TWO_WRITES: ToolCallSpec[] = [
      { id: 'w1', name: 'crm_create_contact', arguments: '{"firstName":"Ada"}' },
      { id: 'w2', name: 'crm_add_note', arguments: '{"contactId":"c_1","body":"Follow up"}' },
    ];

    it('DoD RED (chat): write1 returning { success: false } still runs write2 sequentially and preserves both results in order', async () => {
      const h = createBarrierHarness(['w1', 'w2']);
      const t = makeOrchestrator(
        TWO_WRITES,
        h.wrap((id, name) => (id === 'w1' ? makeFailedResult(id, name, 'contact duplicate') : makeOkResult(id, name))),
      );

      let response: Awaited<ReturnType<FlowOrchestratorService['chat']>>;
      try {
        const turnPromise = t.orchestrator.chat(BIZ, 'write then write', [], undefined, undefined, undefined, undefined, undefined, USER);
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        h.gates.get('w1')!.resolve();
        await waitWithTimeout(h.started.get('w2')!.promise, 'w2 start');
        h.gates.get('w2')!.resolve();
        response = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.overlapCount).toBe(0);
      expect(h.events).toEqual(['start:w1', 'end:w1', 'start:w2', 'end:w2']);
      expect(response.toolResults).toHaveLength(2);
      expect(response.toolResults?.[0]).toMatchObject({ toolCallId: 'w1', name: 'crm_create_contact', success: false, error: 'contact duplicate' });
      expect(response.toolResults?.[1]).toMatchObject({ toolCallId: 'w2', name: 'crm_add_note', success: true });

      const followUp = t.trackAndComplete.mock.calls[1][3].messages as Array<Record<string, any>>;
      const toolMsgs = followUp.filter((m) => m.role === 'tool');
      expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['w1', 'w2']);
      expect(JSON.parse(toolMsgs[0].content)).toEqual({ error: 'contact duplicate' });
    });

    it('DoD RED (streamChat): write1 returning { success: false } still runs write2 sequentially and emits both results in order', async () => {
      const h = createBarrierHarness(['w1', 'w2']);
      const t = makeOrchestrator(
        TWO_WRITES,
        h.wrap((id, name) => (id === 'w1' ? makeFailedResult(id, name, 'contact duplicate') : makeOkResult(id, name))),
      );

      let chunks: Array<Record<string, any>>;
      try {
        const turnPromise = runStream(t.orchestrator);
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        h.gates.get('w1')!.resolve();
        await waitWithTimeout(h.started.get('w2')!.promise, 'w2 start');
        h.gates.get('w2')!.resolve();
        chunks = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.overlapCount).toBe(0);
      expect(h.events).toEqual(['start:w1', 'end:w1', 'start:w2', 'end:w2']);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      const results = chunks.find((c) => c.type === 'tool_results')?.toolResults as FlowToolResult[];
      expect(results[0]).toMatchObject({ toolCallId: 'w1', name: 'crm_create_contact', success: false, error: 'contact duplicate' });
      expect(results[1]).toMatchObject({ toolCallId: 'w2', name: 'crm_add_note', success: true });
    });

    it('DoD RED (chat): write1 rejecting/throwing still runs write2 sequentially and returns a failed FlowToolResult for write1', async () => {
      const h = createBarrierHarness(['w1', 'w2']);
      const t = makeOrchestrator(
        TWO_WRITES,
        h.wrap((id, name) => {
          if (id === 'w1') throw new Error('unexpected write timeout');
          return makeOkResult(id, name);
        }),
      );

      let response: Awaited<ReturnType<FlowOrchestratorService['chat']>>;
      try {
        const turnPromise = t.orchestrator.chat(BIZ, 'throwing write then write', [], undefined, undefined, undefined, undefined, undefined, USER);
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        h.gates.get('w1')!.resolve();
        h.gates.get('w2')!.resolve();
        response = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.overlapCount).toBe(0);
      expect(h.events).toEqual(['start:w1', 'reject:w1', 'start:w2', 'end:w2']);
      expect(response.toolResults).toHaveLength(2);
      expect(response.toolResults?.[0]).toMatchObject({
        toolCallId: 'w1',
        name: 'crm_create_contact',
        success: false,
        error: 'unexpected write timeout',
      });
      expect(response.toolResults?.[1]).toMatchObject({
        toolCallId: 'w2',
        name: 'crm_add_note',
        success: true,
      });
    });

    it('DoD RED (streamChat): write1 rejecting/throwing still runs write2 sequentially with no error stream chunk', async () => {
      const h = createBarrierHarness(['w1', 'w2']);
      const t = makeOrchestrator(
        TWO_WRITES,
        h.wrap((id, name) => {
          if (id === 'w1') throw new Error('unexpected write timeout');
          return makeOkResult(id, name);
        }),
      );

      let chunks: Array<Record<string, any>>;
      try {
        const turnPromise = runStream(t.orchestrator);
        await waitWithTimeout(h.started.get('w1')!.promise, 'w1 start');
        await flushTicks();
        h.gates.get('w1')!.resolve();
        h.gates.get('w2')!.resolve();
        chunks = await turnPromise;
      } finally {
        h.releaseAll();
      }

      expect(h.overlapCount).toBe(0);
      expect(h.events).toEqual(['start:w1', 'reject:w1', 'start:w2', 'end:w2']);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      const results = chunks.find((c) => c.type === 'tool_results')?.toolResults as FlowToolResult[];
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        toolCallId: 'w1',
        name: 'crm_create_contact',
        success: false,
        error: 'unexpected write timeout',
      });
      expect(results[1]).toMatchObject({
        toolCallId: 'w2',
        name: 'crm_add_note',
        success: true,
      });
    });
  });
});
