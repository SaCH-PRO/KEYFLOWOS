/**
 * W9-DISPATCH-CIRCUIT (review SEC-W8CTNM-1, owner ruling D-73; QW-07 in
 * test/key-plan-authority.integration.test.ts): ActionDispatcherService's circuit breaker.
 *
 * The breaker was keyed by tool name alone, process-wide, and counted every failed dispatch, a
 * tool's own 4xx refusal included. Five refusals in one business (a contact the member may not
 * open: 404; an owner by Business.ownerId alone or a SUPER_ADMIN who is no member: 403) opened the
 * circuit for call_create_task in every other business for CIRCUIT_TIMEOUT_MS. Now:
 *   - a circuit is one business's circuit for one tool;
 *   - a 4xx refusal (an HttpException other than 408 Request Timeout and 429 Too Many Requests) is
 *     the tool working, not failing: answered once, neither retried nor counted;
 *   - a genuine failure (an Error, a 5xx, a timeout, a 408 or 429) is retried and counted as before,
 *     and the fifth opens that business's circuit for that tool until CIRCUIT_TIMEOUT_MS has passed.
 * These cases hand the dispatcher the HttpException itself. Review SEC-W9DC-1 (open): the production
 * caller, FlowOrchestratorService.executeToolDirectly, rethrows a refusal as a plain Error today, so
 * there the refusal is still counted, toward its own business's circuit only (QW-07b it.todo, QW-07c).
 *
 * Pure: the dispatcher over stand-ins for its collaborators (the flow orchestrator's
 * executeToolDirectly answers or throws as each case says; governance allows; the execution log,
 * events and undo record nothing). No database: no idempotency key is passed, so nothing is read.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActionDispatcherService, type DispatchContext } from './action-dispatcher.service';

const BIZ_A = 'w9dc_biz_a';
const BIZ_B = 'w9dc_biz_b';
const TOOL = 'call_create_task';
const OTHER_TOOL = 'helpdesk_create_ticket';
const CLOSED = { open: false, failures: 0, lastFailure: null };

type Answer = (ctx: { businessId: string; toolName: string }) => unknown;

/** A dispatcher whose orchestrator answers with `answer` (a value is the result; a thrown error fails the attempt). */
function makeDispatcher(answer: Answer) {
  const executeToolDirectly = vi.fn(async (businessId: string, toolName: string) => answer({ businessId, toolName }));
  const dispatcher = new ActionDispatcherService(
    {} as never,
    { emit: () => true } as never,
    { logToolExecution: async () => undefined } as never,
    { evaluate: async () => ({ allowed: true, tier: 1, reason: 'w9dc: allowed' }) } as never,
    { executeToolDirectly } as never,
    { registerAction: async () => undefined } as never,
  );
  const internals = dispatcher as unknown as { logger: unknown; RETRY_DELAYS: number[]; CIRCUIT_THRESHOLD: number; CIRCUIT_TIMEOUT_MS: number };
  internals.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  // Retries happen at once here; how many there are is what these cases count.
  internals.RETRY_DELAYS = [0, 0];
  return { dispatcher, executeToolDirectly, threshold: internals.CIRCUIT_THRESHOLD, timeoutMs: internals.CIRCUIT_TIMEOUT_MS };
}

const ctx = (businessId: string, toolName = TOOL, extra: Partial<DispatchContext> = {}): DispatchContext => ({
  businessId,
  toolName,
  args: { contactId: 'w9dc_contact' },
  source: 'plan_worker',
  retryCount: 2,
  ...extra,
});

/** Throws `err` for `failing` (business and tool), answers success for everything else. */
const failFor = (failing: { businessId: string; toolName?: string }, err: () => unknown): Answer => ({ businessId, toolName }) => {
  if (businessId === failing.businessId && toolName === (failing.toolName ?? TOOL)) throw err();
  return { id: `w9dc_ok_${businessId}_${toolName}` };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionDispatcherService circuit breaker (W9-DISPATCH-CIRCUIT; review SEC-W8CTNM-1, D-73)', () => {
  it('DC-01 W9-DISPATCH-CIRCUIT (SEC-W8CTNM-1, D-73): a 4xx refusal by the tool (404, 403, 400) is answered once, not retried, and counts toward no circuit: seven refusals in a business leave the tool running there', async () => {
    const refusals = [
      () => new NotFoundException('Contact not found'),
      () => new ForbiddenException('Only a member of this business can be the caller of a call log'),
      () => new BadRequestException('callerId must belong to a member of this business'),
    ];
    let n = 0;
    let refuse = true;
    const { dispatcher, executeToolDirectly, threshold } = makeDispatcher(() => {
      if (refuse) throw refusals[n++ % refusals.length]();
      return { id: 'w9dc_ok' };
    });

    const results = [];
    for (let i = 0; i < threshold + 2; i++) results.push(await dispatcher.dispatch(ctx(BIZ_A)));

    expect(results.map((r) => r.success)).toEqual(Array(threshold + 2).fill(false));
    expect(results.map((r) => r.error)).toEqual([
      'Contact not found',
      'Only a member of this business can be the caller of a call log',
      'callerId must belong to a member of this business',
      'Contact not found',
      'Only a member of this business can be the caller of a call log',
      'callerId must belong to a member of this business',
      'Contact not found',
    ]);
    expect(results.some((r) => r.awaitingApproval)).toBe(false);
    // One attempt each: asking again gets the same answer.
    expect(executeToolDirectly).toHaveBeenCalledTimes(threshold + 2);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toEqual(CLOSED);
    expect(dispatcher.getCircuitStatus(TOOL)).toEqual(CLOSED);

    // The tool still runs in that business.
    refuse = false;
    const ran = await dispatcher.dispatch(ctx(BIZ_A));
    expect(ran).toMatchObject({ success: true, result: { id: 'w9dc_ok' } });
  });

  it('DC-02 W9-DISPATCH-CIRCUIT (SEC-W8CTNM-1, D-73): circuits are per business and tool: five genuine failures open the circuit for that business and tool only; another business runs the tool, and the same business runs another tool', async () => {
    const { dispatcher, executeToolDirectly, threshold } = makeDispatcher(
      failFor({ businessId: BIZ_A }, () => new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    );

    for (let i = 0; i < threshold; i++) {
      expect(await dispatcher.dispatch(ctx(BIZ_A, TOOL, { retryCount: 0 }))).toMatchObject({ success: false, error: 'connect ECONNREFUSED 127.0.0.1:5432' });
    }
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toMatchObject({ open: true, failures: threshold });

    // BIZ_A's circuit for TOOL is open: nothing runs there.
    const calls = executeToolDirectly.mock.calls.length;
    expect(await dispatcher.dispatch(ctx(BIZ_A))).toMatchObject({ success: false, error: `Circuit breaker open for tool "${TOOL}"` });
    expect(executeToolDirectly).toHaveBeenCalledTimes(calls);

    // Another business runs the same tool; its circuit was never touched.
    expect(await dispatcher.dispatch(ctx(BIZ_B))).toMatchObject({ success: true, result: { id: `w9dc_ok_${BIZ_B}_${TOOL}` } });
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_B)).toEqual(CLOSED);

    // The same business runs another tool.
    expect(await dispatcher.dispatch(ctx(BIZ_A, OTHER_TOOL))).toMatchObject({ success: true });
    expect(dispatcher.getCircuitStatus(OTHER_TOOL, BIZ_A)).toEqual(CLOSED);

    // Without a business, a tool's status reads every business's circuit for it.
    expect(dispatcher.getCircuitStatus(TOOL)).toMatchObject({ open: true, failures: threshold });
  });

  it('DC-03 regression control (W9-DISPATCH-CIRCUIT): a genuine failure keeps the breaker: an Error, a 5xx and a timeout are each retried and counted, the fifth opens the circuit, nothing runs while it is open, and it closes after CIRCUIT_TIMEOUT_MS', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T09:00:00Z'));
    const failures = [
      () => new Error('Tool call_create_task failed'),
      () => new InternalServerErrorException('database unavailable'),
      () => new ServiceUnavailableException('provider unavailable'),
      () => Object.assign(new Error('operation timed out'), { code: 'ETIMEDOUT' }),
      () => new HttpException('Gateway Timeout', HttpStatus.GATEWAY_TIMEOUT),
    ];
    let n = 0;
    let fail = true;
    const { dispatcher, executeToolDirectly, threshold, timeoutMs } = makeDispatcher(() => {
      if (fail) throw failures[Math.floor(n++ / 3) % failures.length]();
      return { id: 'w9dc_ok' };
    });

    for (let i = 0; i < threshold; i++) {
      expect(await dispatcher.dispatch(ctx(BIZ_A)), `dispatch ${i + 1}`).toMatchObject({ success: false });
      // Retried: three attempts (retryCount 2) for each genuine failure.
      expect(executeToolDirectly).toHaveBeenCalledTimes(3 * (i + 1));
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toMatchObject({ failures: i + 1, open: i + 1 >= threshold });
    }

    fail = false;
    expect(await dispatcher.dispatch(ctx(BIZ_A))).toMatchObject({ success: false, error: `Circuit breaker open for tool "${TOOL}"` });
    expect(executeToolDirectly).toHaveBeenCalledTimes(3 * threshold);

    vi.setSystemTime(Date.now() + timeoutMs + 1);
    expect(await dispatcher.dispatch(ctx(BIZ_A))).toMatchObject({ success: true, result: { id: 'w9dc_ok' } });
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toMatchObject({ open: false, failures: 0 });
  });

  it('DC-04 regression control (W9-DISPATCH-CIRCUIT): a 408 or 429 asks the caller to try again later, so it is retried and counted as a failure, not taken as a refusal', async () => {
    const { dispatcher, executeToolDirectly } = makeDispatcher(() => {
      throw executeToolDirectly.mock.calls.length <= 3
        ? new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
        : new HttpException('Request Timeout', HttpStatus.REQUEST_TIMEOUT);
    });

    expect(await dispatcher.dispatch(ctx(BIZ_A))).toMatchObject({ success: false, error: 'Too Many Requests' });
    expect(executeToolDirectly).toHaveBeenCalledTimes(3);
    expect(await dispatcher.dispatch(ctx(BIZ_A))).toMatchObject({ success: false, error: 'Request Timeout' });
    expect(executeToolDirectly).toHaveBeenCalledTimes(6);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toMatchObject({ open: false, failures: 2 });
  });

  it('DC-05 regression control: the action boundary\'s answer (retryable false) is neither retried nor counted, and a waiting action is reported as waiting (KF-EXEC-ACTION-001)', async () => {
    const { dispatcher, executeToolDirectly, threshold } = makeDispatcher(() => {
      throw Object.assign(new Error('sent for approval'), { retryable: false, actionId: 'w9dc_action', disposition: 'AWAITING_APPROVAL' });
    });

    for (let i = 0; i < threshold + 1; i++) {
      expect(await dispatcher.dispatch(ctx(BIZ_A))).toMatchObject({ success: false, awaitingApproval: { actionId: 'w9dc_action' } });
    }
    expect(executeToolDirectly).toHaveBeenCalledTimes(threshold + 1);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toEqual(CLOSED);
  });

  it('DC-06 W9-DISPATCH-CIRCUIT: resetCircuit(tool, business) closes that business\'s circuit only; resetCircuit(tool) closes the tool\'s circuit in every business', async () => {
    const { dispatcher, threshold } = makeDispatcher(() => {
      throw new Error('Tool call_create_task failed');
    });
    for (const businessId of [BIZ_A, BIZ_B]) {
      for (let i = 0; i < threshold; i++) await dispatcher.dispatch(ctx(businessId, TOOL, { retryCount: 0 }));
      expect(dispatcher.getCircuitStatus(TOOL, businessId)).toMatchObject({ open: true, failures: threshold });
    }
    expect(dispatcher.getCircuitStatus(TOOL)).toMatchObject({ open: true, failures: 2 * threshold });

    dispatcher.resetCircuit(TOOL, BIZ_A);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toEqual(CLOSED);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_B)).toMatchObject({ open: true, failures: threshold });

    dispatcher.resetCircuit(TOOL);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_B)).toEqual(CLOSED);
    expect(dispatcher.getCircuitStatus(TOOL)).toEqual(CLOSED);
  });
});
