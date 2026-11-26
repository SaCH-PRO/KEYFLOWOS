/**
 * RR-DISPATCH-ATOMIC-CLAIM (V1-72, P126) R1 Security Regression Spec:
 *
 *   - R1-SEC-01: Throws inside activeClaim.complete() (transient DB error OR non-JSON-serializable
 *                BigInt result with `{}` fallback), activeClaim.fail(), and activeClaim.release()
 *                are contained and logged — they NEVER reject dispatch() or abort post-success
 *                logging/events/undo/return.
 *   - R1-SEC-02: Whitespace-only idempotencyKey ('' / '   ') is normalized to absent: 0 calls to
 *                idempotency.check(), non-empty generated dispatchId, and undefined logged.
 *   - Conflict:  `'conflict'` from KeyIdempotencyService.check() returns `{ success: false }`
 *                without executing the tool and without incrementing the circuit breaker.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionDispatcherService, type DispatchContext } from './action-dispatcher.service';
import type { IdempotencyCheckResult, KeyIdempotencyService } from '../key-cortex/key-idempotency.service';

const BIZ_A = 'r1_biz_a';
const WRITE_TOOL = 'crm_create_contact';
const CLOSED = { open: false, failures: 0, lastFailure: null };

interface StubOverrides {
  handler?: (businessId: string, toolName: string) => unknown;
  governance?: { evaluate: (businessId: string, toolName: string) => Promise<unknown> };
  idempotency?: Partial<Pick<KeyIdempotencyService, 'check' | 'complete' | 'fail' | 'release'>>;
}

function makeDispatcher(overrides: StubOverrides = {}) {
  const executeToolDirectly = vi.fn(async (businessId: string, toolName: string) =>
    overrides.handler ? overrides.handler(businessId, toolName) : { id: 'r1_contact_1' },
  );
  const logToolExecution = vi.fn(async () => 'r1_log_id');
  const emit = vi.fn(() => true);
  const registerAction = vi.fn(async () => undefined);
  const governance = overrides.governance ?? {
    evaluate: vi.fn(async () => ({ allowed: true, tier: 1, reason: 'r1: allowed' })),
  };
  const idempotency = {
    check: vi.fn(async (): Promise<IdempotencyCheckResult> => ({ status: 'new', claimId: 'r1_claim_1' })),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    release: vi.fn(async () => true),
    ...overrides.idempotency,
  };

  const dispatcher = new ActionDispatcherService(
    {} as never,
    { emit } as never,
    { logToolExecution } as never,
    governance as never,
    { executeToolDirectly } as never,
    { registerAction } as never,
    undefined,
    idempotency as unknown as KeyIdempotencyService,
  );
  const warn = vi.fn();
  const internals = dispatcher as unknown as { logger: unknown; RETRY_DELAYS: number[] };
  internals.logger = { log: () => undefined, warn, error: () => undefined };
  internals.RETRY_DELAYS = [0, 0];

  return {
    dispatcher,
    executeToolDirectly,
    logToolExecution,
    emit,
    registerAction,
    idempotency,
    warn,
  };
}

const makeCtx = (extra: Partial<DispatchContext> = {}): DispatchContext => ({
  businessId: BIZ_A,
  toolName: WRITE_TOOL,
  args: { firstName: 'Ada' },
  source: 'plan_worker',
  retryCount: 2,
  ...extra,
});

describe('ActionDispatcherService atomic claim R1 regressions (P126, R1-SEC-01/R1-SEC-02)', () => {
  it('R1-SEC-01a: transient DB throw inside idempotency.complete() does NOT reject dispatch(), returns success: true, and still runs post-success hooks', async () => {
    const complete = vi.fn(async () => {
      throw new Error('postgres connection reset');
    });
    const { dispatcher, executeToolDirectly, logToolExecution, emit, registerAction, warn } = makeDispatcher({
      handler: () => ({ id: 'r1_contact_db_err' }),
      idempotency: { complete },
    });

    const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: 'r1_key_complete_db_err' }));

    expect(res).toMatchObject({
      success: true,
      result: { id: 'r1_contact_db_err' },
      dispatchId: 'r1_key_complete_db_err',
    });
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(logToolExecution).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('action.executed', expect.objectContaining({ businessId: BIZ_A }));
    expect(registerAction).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('R1-SEC-01b: non-JSON-serializable BigInt result falls back to idempotency.complete(claimReq, {}) so the claim settles without rejecting dispatch()', async () => {
    const bigResult = { id: 'r1_contact_big', count: BigInt(42) };
    const complete = vi.fn(async (_req: unknown, payload: unknown) => {
      // Simulate Prisma JSON serialization throwing on BigInt in the first attempt.
      JSON.stringify(payload);
      return true;
    });
    const { dispatcher, logToolExecution, emit, warn } = makeDispatcher({
      handler: () => bigResult,
      idempotency: { complete },
    });

    const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: 'r1_key_bigint' }));

    expect(res).toMatchObject({
      success: true,
      result: bigResult,
      dispatchId: 'r1_key_bigint',
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[1]).toEqual({ result: bigResult });
    expect(complete.mock.calls[1]?.[1]).toEqual({});
    expect(logToolExecution).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('action.executed', expect.objectContaining({ businessId: BIZ_A }));
    expect(warn).toHaveBeenCalled();
  });

  it('R1-SEC-01c: throw inside idempotency.fail() does NOT reject dispatch() and still returns the dispatch failure result + logs execution', async () => {
    const fail = vi.fn(async () => {
      throw new Error('postgres write timeout');
    });
    const { dispatcher, logToolExecution, emit, warn } = makeDispatcher({
      handler: () => {
        throw new Error('socket hang up');
      },
      idempotency: { fail },
    });

    const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: 'r1_key_fail_err' }));

    expect(res).toMatchObject({
      success: false,
      error: 'OUTCOME_UNKNOWN: socket hang up',
      dispatchId: 'r1_key_fail_err',
    });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(logToolExecution).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('action.blocked', expect.objectContaining({ businessId: BIZ_A }));
    expect(warn).toHaveBeenCalled();
  });

  it('R1-SEC-01d: throw inside idempotency.release() on governance refusal does NOT reject dispatch()', async () => {
    const release = vi.fn(async () => {
      throw new Error('postgres delete timeout');
    });
    const { dispatcher, executeToolDirectly, warn } = makeDispatcher({
      governance: {
        evaluate: vi.fn(async () => ({ allowed: false, tier: 3, reason: 'Blocked by policy' })),
      },
      idempotency: { release },
    });

    const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: 'r1_key_release_err' }));

    expect(res).toMatchObject({
      success: false,
      error: 'Blocked by policy',
      dispatchId: 'r1_key_release_err',
    });
    expect(executeToolDirectly).toHaveBeenCalledTimes(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('R1-SEC-02: empty and whitespace-only idempotencyKey values are normalized to absent (0 check calls, generated dispatchId, undefined in execution log)', async () => {
    for (const rawKey of ['', '   ', '\t\n ']) {
      const { dispatcher, executeToolDirectly, idempotency, logToolExecution } = makeDispatcher();

      const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: rawKey }));

      expect(res.success).toBe(true);
      expect(res.dispatchId).toMatch(/^disp_/);
      expect(executeToolDirectly).toHaveBeenCalledTimes(1);
      expect(idempotency.check).not.toHaveBeenCalled();
      expect(idempotency.complete).not.toHaveBeenCalled();
      expect(logToolExecution).toHaveBeenCalledWith(
        BIZ_A,
        WRITE_TOOL,
        expect.anything(),
        expect.anything(),
        true,
        expect.any(Number),
        expect.objectContaining({ idempotencyKey: undefined }),
      );
    }
  });

  it('R1-SEC-02b: leading/trailing whitespace on a valid idempotencyKey is trimmed consistently for claim, dispatchId, and executionLog', async () => {
    const { dispatcher, idempotency, logToolExecution } = makeDispatcher();

    const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: '  r1_trimmed_key  ', planStepId: 'step_42' }));

    expect(res.success).toBe(true);
    expect(res.dispatchId).toBe('r1_trimmed_key');
    expect(idempotency.check).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ_A,
        idempotencyKey: 'dispatch:r1_trimmed_key',
        audit: { toolName: WRITE_TOOL, correlationId: 'step_42' },
      }),
    );
    expect(logToolExecution).toHaveBeenCalledWith(
      BIZ_A,
      WRITE_TOOL,
      expect.anything(),
      expect.anything(),
      true,
      expect.any(Number),
      expect.objectContaining({ idempotencyKey: 'r1_trimmed_key' }),
    );
  });

  it('conflict: KeyIdempotencyService returning "conflict" refuses without executing the tool or incrementing the circuit breaker', async () => {
    const { dispatcher, executeToolDirectly, idempotency, logToolExecution } = makeDispatcher({
      idempotency: {
        check: vi.fn(async () => ({
          status: 'conflict' as const,
          error: 'Idempotency key was already used for a different request',
        })),
      },
    });

    // Exceed CIRCUIT_THRESHOLD (5) with conflicts to prove circuit never opens.
    for (let i = 0; i < 6; i++) {
      const res = await dispatcher.dispatch(makeCtx({ idempotencyKey: 'r1_conflict_key' }));
      expect(res).toMatchObject({
        success: false,
        error: 'Idempotency key was already used for a different request',
        dispatchId: 'r1_conflict_key',
      });
    }

    expect(executeToolDirectly).not.toHaveBeenCalled();
    expect(logToolExecution).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
    expect(idempotency.fail).not.toHaveBeenCalled();
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, BIZ_A)).toEqual(CLOSED);
  });
});
