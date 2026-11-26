/**
 * R1 regression unit tests for `runToolCallsWithReadParallelism` (P127 / V1-72,
 * R1-COR-01 & R1-COR-02). Kept separate from the RED spec
 * `flow-tool-sequencing.spec.ts` so the RED file remains byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { runToolCallsWithReadParallelism, type FlowToolResult } from './flow-orchestrator.service';
import { isReadOnlyTool } from './flow-tool-registry';

function okResult(id: string, name: string): FlowToolResult {
  return {
    toolCallId: id,
    name,
    result: { ok: true, id },
    changedEntities: [],
    followOnSuggestions: [],
    family: isReadOnlyTool(name) ? 'read' : 'crud',
    riskTier: 1,
    success: true,
  };
}

function deferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushTicks(n = 6): Promise<void> {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

describe('runToolCallsWithReadParallelism R1 boundary & error-formatting regression', () => {
  it('returns [] for an empty calls array', async () => {
    let called = 0;
    const results = await runToolCallsWithReadParallelism([], async () => {
      called += 1;
      return okResult('never', 'fetch_business_summary');
    });
    expect(results).toEqual([]);
    expect(called).toBe(0);
  });

  it('R1-COR-01: safely formats non-Error rejections (null, undefined, string, plain object, null-proto, throwing toString) without aborting subsequent calls', async () => {
    const nullProto = Object.create(null);
    const badToString = {
      toString() {
        throw new Error('bad toString');
      },
    };

    const cases: Array<{ id: string; thrown: unknown; expectedError: string }> = [
      { id: 'c_null', thrown: null, expectedError: 'unknown error' },
      { id: 'c_undef', thrown: undefined, expectedError: 'unknown error' },
      { id: 'c_str', thrown: 'boom', expectedError: 'boom' },
      { id: 'c_plain', thrown: { message: 'plain' }, expectedError: 'plain' },
      { id: 'c_null_proto', thrown: nullProto, expectedError: 'unknown error' },
      { id: 'c_bad_tostr', thrown: badToString, expectedError: 'unknown error' },
    ];

    const calls = [
      ...cases.map((c) => ({ tc: { id: c.id, name: 'crm_create_contact' }, thrown: c.thrown as unknown, shouldThrow: true })),
      { tc: { id: 'c_tail_ok', name: 'crm_add_note' }, thrown: undefined, shouldThrow: false },
    ];

    const ran: string[] = [];
    const results = await runToolCallsWithReadParallelism(calls, async (item) => {
      ran.push(item.tc.id);
      if (item.shouldThrow) {
        return Promise.reject(item.thrown);
      }
      return okResult(item.tc.id, item.tc.name);
    });

    expect(ran).toEqual([...cases.map((c) => c.id), 'c_tail_ok']);
    expect(results).toHaveLength(calls.length);
    for (let i = 0; i < cases.length; i += 1) {
      expect(results[i]).toMatchObject({
        toolCallId: cases[i].id,
        name: 'crm_create_contact',
        success: false,
        error: cases[i].expectedError,
      });
    }
    expect(results.at(-1)).toMatchObject({
      toolCallId: 'c_tail_ok',
      name: 'crm_add_note',
      success: true,
    });
  });

  it('isolates a rejecting READ inside a parallel READ batch [R1(rejects), R2(ok), W1(ok)] while preserving model order and waiting for R2 before W1', async () => {
    const r1Gate = deferred<void>();
    const r2Gate = deferred<void>();
    const r1Started = deferred<void>();
    const r2Started = deferred<void>();
    const events: string[] = [];

    const calls = [
      { tc: { id: 'r1', name: 'fetch_business_summary' } },
      { tc: { id: 'r2', name: 'fetch_client_health' } },
      { tc: { id: 'w1', name: 'crm_create_contact' } },
    ];

    const promise = runToolCallsWithReadParallelism(calls, async ({ tc }) => {
      events.push(`start:${tc.id}`);
      if (tc.id === 'r1') {
        r1Started.resolve();
        await r1Gate.promise;
        events.push('reject:r1');
        throw Object.create(null);
      }
      if (tc.id === 'r2') {
        r2Started.resolve();
        await r2Gate.promise;
        events.push('end:r2');
        return okResult(tc.id, tc.name);
      }
      events.push('end:w1');
      return okResult(tc.id, tc.name);
    });

    await Promise.all([r1Started.promise, r2Started.promise]);
    // Reject r1 first while r2 is still pending; w1 MUST wait for r2 to finish.
    r1Gate.resolve();
    await flushTicks();
    expect(events).toEqual(['start:r1', 'start:r2', 'reject:r1']);

    r2Gate.resolve();
    const results = await promise;

    expect(events).toEqual(['start:r1', 'start:r2', 'reject:r1', 'end:r2', 'start:w1', 'end:w1']);
    expect(results.map((r) => r.toolCallId)).toEqual(['r1', 'r2', 'w1']);
    expect(results[0]).toMatchObject({ toolCallId: 'r1', success: false, error: 'unknown error' });
    expect(results[1]).toMatchObject({ toolCallId: 'r2', success: true });
    expect(results[2]).toMatchObject({ toolCallId: 'w1', success: true });
  });

  it('handles alternating [W, R, R, W]: W1 alone, R1&R2 parallel, W2 alone, exact order', async () => {
    const r1Started = deferred<void>();
    const r2Started = deferred<void>();
    const r1Gate = deferred<void>();
    const r2Gate = deferred<void>();
    const events: string[] = [];

    const calls = [
      { tc: { id: 'w1', name: 'crm_create_contact' } },
      { tc: { id: 'r1', name: 'fetch_business_summary' } },
      { tc: { id: 'r2', name: 'fetch_client_health' } },
      { tc: { id: 'w2', name: 'crm_add_note' } },
    ];

    const promise = runToolCallsWithReadParallelism(calls, async ({ tc }) => {
      events.push(`start:${tc.id}`);
      if (tc.id === 'r1') {
        r1Started.resolve();
        await r1Gate.promise;
      } else if (tc.id === 'r2') {
        r2Started.resolve();
        await r2Gate.promise;
      }
      events.push(`end:${tc.id}`);
      return okResult(tc.id, tc.name);
    });

    await Promise.all([r1Started.promise, r2Started.promise]);
    await flushTicks();
    expect(events).toEqual(['start:w1', 'end:w1', 'start:r1', 'start:r2']);

    r2Gate.resolve();
    await flushTicks();
    r1Gate.resolve();

    const results = await promise;
    expect(events).toEqual(['start:w1', 'end:w1', 'start:r1', 'start:r2', 'end:r2', 'end:r1', 'start:w2', 'end:w2']);
    expect(results.map((r) => r.toolCallId)).toEqual(['w1', 'r1', 'r2', 'w2']);
  });

  it('handles alternating [R, W, R, W]: strictly sequential with zero overlap and exact order', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const events: string[] = [];

    const calls = [
      { tc: { id: 'r1', name: 'fetch_business_summary' } },
      { tc: { id: 'w1', name: 'crm_create_contact' } },
      { tc: { id: 'r2', name: 'fetch_client_health' } },
      { tc: { id: 'w2', name: 'crm_add_note' } },
    ];

    const results = await runToolCallsWithReadParallelism(calls, async ({ tc }) => {
      inFlight += 1;
      if (inFlight > maxConcurrent) maxConcurrent = inFlight;
      events.push(`start:${tc.id}`);
      await flushTicks(2);
      events.push(`end:${tc.id}`);
      inFlight -= 1;
      return okResult(tc.id, tc.name);
    });

    expect(maxConcurrent).toBe(1);
    expect(events).toEqual(['start:r1', 'end:r1', 'start:w1', 'end:w1', 'start:r2', 'end:r2', 'start:w2', 'end:w2']);
    expect(results.map((r) => r.toolCallId)).toEqual(['r1', 'w1', 'r2', 'w2']);
  });
});
