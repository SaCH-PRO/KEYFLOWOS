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

const BIZ = 'biz_rr_stream_err';
const savedKeyDisabled = process.env.KEY_DISABLED;
beforeEach(() => {
  delete process.env.KEY_DISABLED;
});
afterEach(() => {
  if (savedKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = savedKeyDisabled;
});

function makeOrchestrator(script: () => AsyncGenerator<Record<string, unknown>>) {
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
