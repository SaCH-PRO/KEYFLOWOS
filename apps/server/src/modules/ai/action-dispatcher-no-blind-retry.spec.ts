/**
 * RR-DISPATCH-NO-BLIND-RETRY (D-261, D-262, D-263): ActionDispatcherService
 * never blindly retries a non-READ (WRITE or unknown) tool after an ambiguous
 * error (dropped connection, timeout, 5xx).
 *
 *   - READ tools (isReadOnlyTool(toolName) === true) keep MAX_RETRIES = 2
 *     (3 total attempts) on ambiguous errors / 5xx.
 *   - Non-READ tools (WRITE or unknown / MCP / dotted -> fail closed) retry
 *     ONLY when the error proves the effect did not happen:
 *       * a RetryableConflictException cause (D-134, DS-01), OR
 *       * an error explicitly marked `effectNotApplied: true` (on err or cause).
 *   - Any other non-refusal error on a non-READ tool stops after 1 attempt,
 *     returns success: false with error prefixed 'OUTCOME_UNKNOWN: ', logs it
 *     with the idempotency key, and counts it on the circuit breaker.
 *   - Refusals (isToolRefusal 4xx) and boundary answers (retryable: false) stay
 *     final without 'OUTCOME_UNKNOWN: ' and without counting on the circuit.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActionDispatcherService, type DispatchContext } from './action-dispatcher.service';
import { isReadOnlyTool } from './flow-tool-registry';
import { RetryableConflictException } from '../../core/utils/retryable-conflict';

const BIZ_A = 'nbr_biz_a';
const BIZ_B = 'nbr_biz_b';
const WRITE_TOOL = 'crm_create_contact';
const TASK_WRITE_TOOL = 'projects_complete_task';
const READ_TOOL = 'fetch_business_summary';
const CLOSED = { open: false, failures: 0, lastFailure: null };

function makeDispatcher(
  handler: (businessId: string, toolName: string, callIndex: number) => unknown,
) {
  let calls = 0;
  const executeToolDirectly = vi.fn(async (businessId: string, toolName: string) => {
    calls += 1;
    return handler(businessId, toolName, calls);
  });
  const logToolExecution = vi.fn(async () => 'nbr_log_id');
  const dispatcher = new ActionDispatcherService(
    { client: { aiExecutionLog: { findFirst: async () => null } } } as never,
    { emit: () => true } as never,
    { logToolExecution } as never,
    { evaluate: async () => ({ allowed: true, tier: 1, reason: 'nbr: allowed' }) } as never,
    { executeToolDirectly } as never,
    { registerAction: async () => undefined } as never,
  );
  const internals = dispatcher as unknown as {
    logger: unknown;
    RETRY_DELAYS: number[];
    CIRCUIT_THRESHOLD: number;
  };
  internals.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  internals.RETRY_DELAYS = [0, 0];
  return {
    dispatcher,
    executeToolDirectly,
    logToolExecution,
    threshold: internals.CIRCUIT_THRESHOLD,
  };
}

const makeCtx = (
  businessId: string,
  toolName: string,
  extra: Partial<DispatchContext> = {},
): DispatchContext => ({
  businessId,
  toolName,
  args: { firstName: 'Ada' },
  source: 'plan_worker',
  retryCount: 2,
  ...extra,
});

describe('ActionDispatcherService no blind retry on non-READ tools (RR-DISPATCH-NO-BLIND-RETRY, D-263)', () => {
  it('NBR-01 RED: a WRITE tool throwing Error("socket hang up") is called ONCE (not 3x), returns OUTCOME_UNKNOWN prefix, logs once with idempotencyKey, and counts on the circuit', async () => {
    expect(isReadOnlyTool(WRITE_TOOL)).toBe(false);

    const { dispatcher, executeToolDirectly, logToolExecution } = makeDispatcher(() => {
      throw new Error('socket hang up');
    });

    const res = await dispatcher.dispatch(
      makeCtx(BIZ_A, WRITE_TOOL, { idempotencyKey: 'nbr_idem_1', retryCount: 2 }),
    );

    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.error).toBe('OUTCOME_UNKNOWN: socket hang up');
    expect(res.error?.startsWith('OUTCOME_UNKNOWN: ')).toBe(true);
    expect(logToolExecution).toHaveBeenCalledTimes(1);
    expect(logToolExecution).toHaveBeenCalledWith(
      BIZ_A,
      WRITE_TOOL,
      { firstName: 'Ada' },
      'OUTCOME_UNKNOWN: socket hang up',
      false,
      expect.any(Number),
      expect.objectContaining({ idempotencyKey: 'nbr_idem_1' }),
    );
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_A)).toMatchObject({ open: false, failures: 1 });
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_B)).toEqual(CLOSED);
  });

  it('NBR-02 negative control: a READ tool throwing Error("socket hang up") keeps retrying (3x on persistent error, recovers on attempt 2) without OUTCOME_UNKNOWN prefix', async () => {
    expect(isReadOnlyTool(READ_TOOL)).toBe(true);

    const persistent = makeDispatcher(() => {
      throw new Error('socket hang up');
    });
    const failed = await persistent.dispatcher.dispatch(makeCtx(BIZ_A, READ_TOOL, { retryCount: 2 }));
    expect(persistent.executeToolDirectly).toHaveBeenCalledTimes(3);
    expect(failed.success).toBe(false);
    expect(failed.error).toBe('socket hang up');
    expect(failed.error?.startsWith('OUTCOME_UNKNOWN: ')).toBe(false);
    expect(persistent.dispatcher.getCircuitStatus(READ_TOOL, BIZ_A)).toMatchObject({ open: false, failures: 1 });

    const transient = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) throw new Error('socket hang up');
      return { revenue: 100 };
    });
    const ok = await transient.dispatcher.dispatch(makeCtx(BIZ_A, READ_TOOL, { retryCount: 2 }));
    expect(transient.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(ok).toMatchObject({ success: true, result: { revenue: 100 } });
    expect(transient.dispatcher.getCircuitStatus(READ_TOOL, BIZ_A)).toEqual(CLOSED);
  });

  it('NBR-03 negative control (DS-01 / D-134): a RetryableConflictException cause on a WRITE tool is still retried and completes when the race clears, and stays unprefixed if retries exhaust', async () => {
    expect(isReadOnlyTool(TASK_WRITE_TOOL)).toBe(false);
    const conflictMsg = 'The task changed while it was being updated; try again';

    const clears = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) {
        throw new Error(conflictMsg, { cause: new RetryableConflictException(conflictMsg) });
      }
      return { task: { id: 'nbr_task_1' } };
    });
    const ok = await clears.dispatcher.dispatch(makeCtx(BIZ_A, TASK_WRITE_TOOL, { retryCount: 2 }));
    expect(clears.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(ok).toMatchObject({ success: true, result: { task: { id: 'nbr_task_1' } } });
    expect(clears.dispatcher.getCircuitStatus(TASK_WRITE_TOOL, BIZ_A)).toEqual(CLOSED);

    const persists = makeDispatcher(() => {
      throw new Error(conflictMsg, { cause: new RetryableConflictException(conflictMsg) });
    });
    const failed = await persists.dispatcher.dispatch(makeCtx(BIZ_A, TASK_WRITE_TOOL, { retryCount: 2 }));
    expect(persists.executeToolDirectly).toHaveBeenCalledTimes(3);
    expect(failed.success).toBe(false);
    expect(failed.error).toBe(conflictMsg);
    expect(failed.error?.startsWith('OUTCOME_UNKNOWN: ')).toBe(false);
    expect(persists.dispatcher.getCircuitStatus(TASK_WRITE_TOOL, BIZ_A)).toMatchObject({ open: false, failures: 1 });
  });

  it('NBR-04 negative control: a WRITE tool error marked effectNotApplied: true (direct or on cause) is retried; non-boolean or false effectNotApplied is NOT retried', async () => {
    // Direct effectNotApplied: true -> retries and completes
    const direct = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) {
        throw Object.assign(new Error('pre-write check timed out'), { effectNotApplied: true });
      }
      return { id: 'nbr_contact_1' };
    });
    const resDirect = await direct.dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
    expect(direct.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(resDirect).toMatchObject({ success: true, result: { id: 'nbr_contact_1' } });

    // Cause effectNotApplied: true -> retries and completes (and stays unprefixed if all fail)
    const nested = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) {
        const root = Object.assign(new Error('upstream rejected before commit'), { effectNotApplied: true });
        throw new Error('wrapped failure', { cause: root });
      }
      return { id: 'nbr_contact_2' };
    });
    const resNested = await nested.dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
    expect(nested.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(resNested).toMatchObject({ success: true, result: { id: 'nbr_contact_2' } });

    const nestedPersists = makeDispatcher(() => {
      const root = Object.assign(new Error('upstream rejected before commit'), { effectNotApplied: true });
      throw new Error('wrapped failure', { cause: root });
    });
    const resNestedFail = await nestedPersists.dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
    expect(nestedPersists.executeToolDirectly).toHaveBeenCalledTimes(3);
    expect(resNestedFail).toMatchObject({ success: false, error: 'wrapped failure' });

    // Negative controls: effectNotApplied: false or non-boolean 'true' MUST NOT retry
    for (const badFlag of [false, 'true', 1, null, undefined]) {
      const bad = makeDispatcher(() => {
        throw Object.assign(new Error('ambiguous write error'), { effectNotApplied: badFlag });
      });
      const resBad = await bad.dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
      expect(bad.executeToolDirectly, `effectNotApplied=${String(badFlag)}`).toHaveBeenCalledTimes(1);
      expect(resBad.success, `effectNotApplied=${String(badFlag)}`).toBe(false);
      expect(resBad.error, `effectNotApplied=${String(badFlag)}`).toBe('OUTCOME_UNKNOWN: ambiguous write error');
    }
  });

  it('NBR-05: 5xx ServiceUnavailableException on a WRITE tool is called ONCE (OUTCOME_UNKNOWN), while on a READ tool it is retried', async () => {
    const write503 = makeDispatcher(() => {
      throw new ServiceUnavailableException('upstream 503');
    });
    const writeRes = await write503.dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
    expect(write503.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(writeRes.success).toBe(false);
    expect(writeRes.error).toBe('OUTCOME_UNKNOWN: upstream 503');
    expect(write503.dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_A)).toMatchObject({ open: false, failures: 1 });

    const read503 = makeDispatcher(() => {
      throw new ServiceUnavailableException('upstream 503');
    });
    const readRes = await read503.dispatcher.dispatch(makeCtx(BIZ_A, READ_TOOL, { retryCount: 2 }));
    expect(read503.executeToolDirectly).toHaveBeenCalledTimes(3);
    expect(readRes.success).toBe(false);
    expect(readRes.error).toBe('upstream 503');
    expect(readRes.error?.startsWith('OUTCOME_UNKNOWN: ')).toBe(false);

    const read503Recovers = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) throw new ServiceUnavailableException('upstream 503');
      return { ok: true };
    });
    const readOk = await read503Recovers.dispatcher.dispatch(makeCtx(BIZ_A, READ_TOOL, { retryCount: 2 }));
    expect(read503Recovers.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(readOk).toMatchObject({ success: true, result: { ok: true } });
  });

  it('NBR-06 fail closed: unknown, MCP-bridged, and dotted tool names are treated as non-READ (called ONCE, OUTCOME_UNKNOWN)', async () => {
    for (const toolName of ['no_such_tool', 'mcp__stripe__create_charge', 'cortex.create_task']) {
      expect(isReadOnlyTool(toolName), toolName).toBe(false);
      const { dispatcher, executeToolDirectly } = makeDispatcher(() => {
        throw new Error('socket hang up');
      });
      const res = await dispatcher.dispatch(makeCtx(BIZ_A, toolName, { retryCount: 2 }));
      expect(executeToolDirectly, toolName).toHaveBeenCalledTimes(1);
      expect(res.success, toolName).toBe(false);
      expect(res.error, toolName).toBe('OUTCOME_UNKNOWN: socket hang up');
    }
  });

  it('NBR-07: 4xx refusals (400/403/404/409) and action-boundary answers (retryable: false) stay final WITHOUT OUTCOME_UNKNOWN prefix and WITHOUT tripping the circuit', async () => {
    const refusals: Array<{ label: string; err: () => unknown; expectedMsg: string }> = [
      { label: '400', err: () => new BadRequestException('Invalid field'), expectedMsg: 'Invalid field' },
      { label: '403', err: () => new ForbiddenException('Not a member'), expectedMsg: 'Not a member' },
      { label: '404', err: () => new NotFoundException('Contact not found'), expectedMsg: 'Contact not found' },
      { label: '409', err: () => new ConflictException('Duplicate contact'), expectedMsg: 'Duplicate contact' },
      {
        label: 'boundary',
        err: () =>
          Object.assign(new Error('Action sent for approval'), {
            retryable: false,
            actionId: 'nbr_act_1',
            disposition: 'AWAITING_APPROVAL',
          }),
        expectedMsg: 'Action sent for approval',
      },
    ];

    for (const { label, err, expectedMsg } of refusals) {
      const { dispatcher, executeToolDirectly } = makeDispatcher(() => {
        throw err();
      });
      const res = await dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
      expect(executeToolDirectly, label).toHaveBeenCalledTimes(1);
      expect(res.success, label).toBe(false);
      expect(res.error, label).toBe(expectedMsg);
      expect(res.error?.startsWith('OUTCOME_UNKNOWN: '), label).toBe(false);
      expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_A), label).toEqual(CLOSED);
    }
  });

  it('NBR-08: OUTCOME_UNKNOWN failures still open that business circuit at threshold (1 attempt each, never touching another business)', async () => {
    const { dispatcher, executeToolDirectly, threshold } = makeDispatcher((businessId) => {
      if (businessId === BIZ_A) throw new Error('socket hang up');
      return { id: 'nbr_biz_b_ok' };
    });

    for (let i = 0; i < threshold; i++) {
      const res = await dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
      expect(res.success).toBe(false);
      expect(res.error).toBe('OUTCOME_UNKNOWN: socket hang up');
    }

    // 1 attempt per dispatch (threshold total, NOT 3 * threshold)
    expect(executeToolDirectly).toHaveBeenCalledTimes(threshold);
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_A)).toMatchObject({ open: true, failures: threshold });
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_B)).toEqual(CLOSED);

    // Circuit open for BIZ_A -> executes nothing
    const blocked = await dispatcher.dispatch(makeCtx(BIZ_A, WRITE_TOOL, { retryCount: 2 }));
    expect(blocked).toMatchObject({ success: false, error: `Circuit breaker open for tool "${WRITE_TOOL}"` });
    expect(executeToolDirectly).toHaveBeenCalledTimes(threshold);

    // BIZ_B still executes normally
    const bizBOk = await dispatcher.dispatch(makeCtx(BIZ_B, WRITE_TOOL, { retryCount: 2 }));
    expect(bizBOk).toMatchObject({ success: true, result: { id: 'nbr_biz_b_ok' } });
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_B)).toEqual(CLOSED);
  });
});
