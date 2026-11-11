/**
 * W10-DISPATCH-STATUS (review SEC-W9DC-1, owner ruling D-73; QW-07b in
 * test/key-plan-authority.integration.test.ts) and its review CR-W10DS-1: what reaches the plan queue's
 * dispatcher (ActionDispatcherService) when a KEY tool throws an HttpException.
 *
 * FlowOrchestratorService.executeToolDirectly rethrows the tool's HttpException, so the dispatcher answers
 * a refusal once and counts it toward no circuit (isToolRefusal: every 4xx but 408 and 429). Review
 * CR-W10DS-1 (confirmed by running): that also made final two statuses this codebase uses for a failure
 * worth retrying. A 409 is the optimistic-concurrency conflict that tells the caller to try again
 * (ProjectsService.updateTask: 'The task changed while it was being updated; try again', reached by
 * projects_complete_task and projects_update_task), and a 400 is also a provider that did not answer
 * (GmailService.searchMessages: 'Gmail search failed (503)', reached by reconcile_sweep_statements). On the
 * packet base such a step was retried and completed, and five outages opened that business's circuit for
 * the tool; at the packet head it failed on the first attempt and was never counted. A 400 or 409 now
 * reaches the dispatcher as the plain Error it did on the base, the HttpException as its cause.
 *
 * Pure: the real FlowOrchestratorService.executeToolDirectly, executeToolDirect, executeTool and
 * validateToolInput over stand-ins for the tool's own work (executeToolAction throws or answers as each
 * case says), the member scope check (none here), the execution log, governance's tier and the business
 * graph cache; the real ActionDispatcherService over that orchestrator, its retries immediate.
 */
import { describe, it, expect } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { ActionDispatcherService } from './action-dispatcher.service';

const BIZ_A = 'w10ds_biz_a';
const BIZ_B = 'w10ds_biz_b';
const CLOSED = { open: false, failures: 0, lastFailure: null };
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

/**
 * The real orchestrator whose tool work throws what `fails(call)` returns (an error) or answers `ok`.
 * `call` counts the tool's attempts across every business, from 1.
 */
function makeFlow(fails: (call: number, businessId: string) => Error | null, ok: unknown = { id: 'w10ds_ok' }) {
  let calls = 0;
  const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService;
  Object.assign(flow, {
    logger: quiet,
    governance: { getToolTier: () => 1 },
    executionLog: { logToolExecution: async () => 'w10ds_log' },
    businessGraph: { invalidateCache: () => undefined },
    memberScopeRefusal: async () => null,
    attributeExecutionLog: async () => undefined,
    executeToolAction: async (businessId: string) => {
      calls += 1;
      const err = fails(calls, businessId);
      if (err) throw err;
      return ok;
    },
  });
  return { flow, calls: () => calls };
}

function makeDispatcher(flow: FlowOrchestratorService) {
  const dispatcher = new ActionDispatcherService(
    {} as never,
    { emit: () => true } as never,
    { logToolExecution: async () => undefined } as never,
    { evaluate: async () => ({ allowed: true, tier: 1, reason: 'w10ds: allowed' }) } as never,
    flow,
    { registerAction: async () => undefined } as never,
  );
  const internals = dispatcher as unknown as { logger: unknown; RETRY_DELAYS: number[]; CIRCUIT_THRESHOLD: number };
  internals.logger = quiet;
  // Production waits 1 s and 3 s between attempts; how many attempts there are is what these cases count.
  internals.RETRY_DELAYS = [0, 0];
  return { dispatcher, threshold: internals.CIRCUIT_THRESHOLD };
}

/** What executeToolDirectly throws for this tool call (the plan queue's surface, as the dispatcher calls it). */
async function thrownByExecuteToolDirectly(flow: FlowOrchestratorService, toolName: string, args: Record<string, unknown>) {
  try {
    await flow.executeToolDirectly(BIZ_A, toolName, args, { planId: 'w10ds_plan', planStepId: 'w10ds_step' }, { surface: 'PLAN_QUEUE', planId: 'w10ds_plan', planStepId: 'w10ds_step' });
  } catch (e) {
    return e;
  }
  throw new Error('executeToolDirectly did not throw');
}

const CONFLICT = 'The task changed while it was being updated; try again';
const GMAIL_OUTAGE = 'Gmail search failed (503)';
const SWEEP = { toolName: 'reconcile_sweep_statements', args: { source: 'gmail', accountId: 'w10ds_account' } };

describe('FlowOrchestratorService.executeToolDirectly hands the plan queue a refusal\'s status, and a conflict or provider outage as a failure (W10-DISPATCH-STATUS, D-73; review CR-W10DS-1)', () => {
  it('DS-01 W10-DISPATCH-STATUS review CR-W10DS-1 (D-73): a 409 conflict that tells the caller to try again (ProjectsService.updateTask\'s, reached by projects_complete_task and projects_update_task) reaches the dispatcher as a plain Error with the ConflictException as its cause, so the plan queue retries the step and it completes', async () => {
    for (const toolName of ['projects_complete_task', 'projects_update_task']) {
      const args = { taskId: 'w10ds_task' };
      const thrown = makeFlow(() => new ConflictException(CONFLICT));
      const err = await thrownByExecuteToolDirectly(thrown.flow, toolName, args);
      expect(err, toolName).toBeInstanceOf(Error);
      expect(err, toolName).not.toBeInstanceOf(HttpException);
      expect((err as Error).message, toolName).toBe(CONFLICT);
      expect((err as Error).cause, toolName).toBeInstanceOf(ConflictException);
      expect(((err as Error).cause as HttpException).getStatus(), toolName).toBe(HttpStatus.CONFLICT);

      // Fails once, answers on the retry: the step completes (on the packet head it failed after one attempt).
      const once = makeFlow((call) => (call === 1 ? new ConflictException(CONFLICT) : null), { task: { id: 'w10ds_task' } });
      const { dispatcher } = makeDispatcher(once.flow);
      const ran = await dispatcher.dispatch({ businessId: BIZ_A, toolName, args, retryCount: 2 });
      expect(ran, toolName).toMatchObject({ success: true, result: { task: { id: 'w10ds_task' } } });
      expect(once.calls(), toolName).toBe(2);
      expect(dispatcher.getCircuitStatus(toolName, BIZ_A), toolName).toEqual(CLOSED);
    }
  });

  it('DS-02 W10-DISPATCH-STATUS review CR-W10DS-1 (D-73): a provider that did not answer, reported as a 400 (GmailService.searchMessages\' \'Gmail search failed (503)\', reached by reconcile_sweep_statements), is retried, and five such sweeps open that business\'s circuit for the tool as they did before W10-DISPATCH-STATUS; another business still sweeps', async () => {
    const thrown = makeFlow(() => new BadRequestException(GMAIL_OUTAGE));
    const err = await thrownByExecuteToolDirectly(thrown.flow, SWEEP.toolName, SWEEP.args);
    expect(err).not.toBeInstanceOf(HttpException);
    expect((err as Error).message).toBe(GMAIL_OUTAGE);
    expect(((err as Error).cause as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);

    // A passing outage: the retry sweeps.
    const once = makeFlow((call) => (call === 1 ? new BadRequestException(GMAIL_OUTAGE) : null), { imported: 0, filesConsidered: 0 });
    const first = makeDispatcher(once.flow).dispatcher;
    expect(await first.dispatch({ businessId: BIZ_A, ...SWEEP, retryCount: 2 })).toMatchObject({ success: true });
    expect(once.calls()).toBe(2);

    // A lasting outage in BIZ_A: each sweep tries three times and counts once; the fifth opens BIZ_A's circuit.
    const down = makeFlow((_call, businessId) => (businessId === BIZ_A ? new BadRequestException(GMAIL_OUTAGE) : null), { imported: 0, filesConsidered: 0 });
    const { dispatcher, threshold } = makeDispatcher(down.flow);
    for (let i = 0; i < threshold; i++) {
      expect(await dispatcher.dispatch({ businessId: BIZ_A, ...SWEEP, retryCount: 2 })).toMatchObject({ success: false, error: GMAIL_OUTAGE });
    }
    expect(down.calls()).toBe(threshold * 3);
    expect(dispatcher.getCircuitStatus(SWEEP.toolName, BIZ_A)).toMatchObject({ open: true, failures: threshold });
    expect(await dispatcher.dispatch({ businessId: BIZ_A, ...SWEEP, retryCount: 2 })).toMatchObject({ success: false, error: `Circuit breaker open for tool "${SWEEP.toolName}"` });
    expect(down.calls()).toBe(threshold * 3);
    expect(await dispatcher.dispatch({ businessId: BIZ_B, ...SWEEP, retryCount: 2 })).toMatchObject({ success: true });
    expect(dispatcher.getCircuitStatus(SWEEP.toolName, BIZ_B)).toEqual(CLOSED);
  });

  it('DS-03 regression control (W10-DISPATCH-STATUS, SEC-W9DC-1, D-73): a refusal whose status says asking again gets the same answer (404, 403, 401, 410) reaches the dispatcher as the tool\'s own HttpException, answered once and counted toward no circuit; a 5xx or 429 HttpException reaches it as itself and stays a failure, retried and counted', async () => {
    const args = { contactId: 'w10ds_contact', callerId: 'w10ds_owner' };
    const refusals = [
      new NotFoundException('Contact not found'),
      new ForbiddenException('Only a member of this business can be the caller of a call log'),
      new UnauthorizedException('Authentication required'),
      new GoneException('The pay link has been withdrawn'),
    ];
    for (const refusal of refusals) {
      const status = refusal.getStatus();
      const thrown = makeFlow(() => refusal);
      expect(await thrownByExecuteToolDirectly(thrown.flow, 'call_create_task', args), String(status)).toBe(refusal);

      const refused = makeFlow(() => refusal);
      const { dispatcher } = makeDispatcher(refused.flow);
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: 'call_create_task', args, retryCount: 2 }), String(status)).toMatchObject({ success: false, error: refusal.message });
      expect(refused.calls(), String(status)).toBe(1);
      expect(dispatcher.getCircuitStatus('call_create_task', BIZ_A), String(status)).toEqual(CLOSED);
    }

    for (const failure of [new ServiceUnavailableException('The store is not answering'), new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)]) {
      const status = failure.getStatus();
      const thrown = makeFlow(() => failure);
      expect(await thrownByExecuteToolDirectly(thrown.flow, 'call_create_task', args), String(status)).toBe(failure);

      const failing = makeFlow(() => failure);
      const { dispatcher } = makeDispatcher(failing.flow);
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: 'call_create_task', args, retryCount: 2 }), String(status)).toMatchObject({ success: false, error: failure.message });
      expect(failing.calls(), String(status)).toBe(3);
      expect(dispatcher.getCircuitStatus('call_create_task', BIZ_A), String(status)).toMatchObject({ open: false, failures: 1 });
    }
  });

  it('DS-04 regression control (W10-DISPATCH-STATUS, D-73): the envelope executeTool answers its other callers (executeToolDirect, as a plan run over HTTP and the chat read it) keeps its keys and carries the tool\'s message for a 409 and a 400 as for a 404', async () => {
    const cases: Array<[string, Record<string, unknown>, Error]> = [
      ['projects_complete_task', { taskId: 'w10ds_task' }, new ConflictException(CONFLICT)],
      [SWEEP.toolName, SWEEP.args, new BadRequestException(GMAIL_OUTAGE)],
      ['call_create_task', { contactId: 'w10ds_contact', callerId: 'w10ds_owner' }, new NotFoundException('Contact not found')],
    ];
    for (const [toolName, args, err] of cases) {
      const { flow } = makeFlow(() => err);
      const envelope = await flow.executeToolDirect(BIZ_A, toolName, args, 'w10ds_plan', 'w10ds_step', { surface: 'PLAN_QUEUE', planId: 'w10ds_plan', planStepId: 'w10ds_step' });
      expect(Object.keys(envelope).sort(), toolName).toEqual(['changedEntities', 'error', 'family', 'followOnSuggestions', 'name', 'result', 'riskTier', 'success', 'toolCallId']);
      expect(envelope, toolName).toMatchObject({ success: false, result: null, error: err.message, name: toolName });
    }
  });

  it.todo('DS-05 W10-DISPATCH-STATUS review CR-W10DS-1 (D-73), left open: a member\'s 400 refusal (an argument the tool does not take) or a 409 that asking again cannot resolve, through executeToolDirectly, is answered once and counted toward no circuit as a 404 or 403 is (W9 isToolRefusal); needs the services that report a provider failure as 400 (gmail.service.ts, google-drive.service.ts, connect/*) to answer it as a 5xx, and an owner ruling on which 409s are final, both outside W10-DISPATCH-STATUS\'s write set');
});
