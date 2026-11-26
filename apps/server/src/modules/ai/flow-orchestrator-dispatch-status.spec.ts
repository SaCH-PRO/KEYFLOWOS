/**
 * W10-DISPATCH-STATUS (review SEC-W9DC-1, owner ruling D-73; QW-07b in
 * test/key-plan-authority.integration.test.ts), its review CR-W10DS-1, and W11-DISPATCH-REFUSAL-FINAL
 * (owner ruling D-134; DS-05, DS-06): what reaches the plan queue's dispatcher (ActionDispatcherService)
 * when a KEY tool throws an HttpException.
 *
 * FlowOrchestratorService.executeToolDirectly rethrows the tool's HttpException, so the dispatcher answers
 * a refusal once and counts it toward no circuit (isToolRefusal: every 4xx but 408 and 429). Review
 * CR-W10DS-1 kept every 400 and 409 a plain Error (retried, counted), because a 409 was also the
 * optimistic-concurrency conflict that tells the caller to try again (ProjectsService.updateTask: 'The
 * task changed while it was being updated; try again', reached by projects_complete_task and
 * projects_update_task), and a 400 was also a provider that did not answer (GmailService.searchMessages:
 * 'Gmail search failed (503)', reached by reconcile_sweep_statements). So a member's genuine 400 (an
 * argument the tool does not take) and a 409 a retry answers the same way were retried, and five of them
 * held the tool for the whole business (the QW-07b class).
 *
 * W11-DISPATCH-REFUSAL-FINAL (D-134): a 400 and a plain 409 are final, as a 404 or 403 is (DS-05). The one
 * conflict worth retrying says so by its class: ProjectsService.updateTask throws RetryableConflictException
 * (a ConflictException, the same HTTP answer), which alone reaches the dispatcher as a plain Error with the
 * exception as its cause (DS-01). A provider outage is a 503 since W11-PROVIDER-OUTAGE-503, retried and
 * counted as itself (DS-02). A call the tool's own schema refuses (validateToolInput) is a 400 (DS-06).
 *
 * Pure: the real FlowOrchestratorService.executeToolDirectly, executeToolDirect, executeTool and
 * validateToolInput over stand-ins for the tool's own work (executeToolAction throws or answers as each
 * case says), the member scope check (none here), the execution log, governance's tier and the business
 * graph cache; the real ActionDispatcherService over that orchestrator, its retries immediate. DS-01b: the
 * real ProjectsService.updateTask over a prisma stand-in whose conditional write loses its race. DS-09: the
 * real ContractClauseService over a prisma stand-in and a stand-in for fetch (no network).
 */
import dns from 'node:dns';
import { describe, it, expect, vi, afterEach, onTestFinished } from 'vitest';
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
import { ProjectsService } from '../projects/projects.service';
import { ContractsService } from '../contracts/contracts.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { ContractClauseService, DocumentHostUnavailableError } from '../contracts/contract-clause.service';
import { providerUnavailable } from '../../core/connectors/provider-failure';

/** The class ProjectsService.updateTask throws for a stale write (W11-DISPATCH-REFUSAL-FINAL, D-134). */
const retryableConflict = async () => (await import('../../core/utils/retryable-conflict')).RetryableConflictException;

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
  // The cases loop to this private number: were it renamed or gone, their loops would run nothing and pass.
  expect(internals.CIRCUIT_THRESHOLD).toBeGreaterThan(0);
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

/** Counts every call the dispatcher makes to executeToolDirectly (a call validateToolInput refuses never reaches the tool's work). */
function countAttempts(flow: FlowOrchestratorService) {
  let attempts = 0;
  const real = FlowOrchestratorService.prototype.executeToolDirectly;
  (flow as unknown as { executeToolDirectly: unknown }).executeToolDirectly = (...a: Parameters<typeof real>) => {
    attempts += 1;
    return real.apply(flow, a);
  };
  return () => attempts;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('FlowOrchestratorService.executeToolDirectly hands the plan queue a refusal\'s status: a 400 or plain 409 is final, a retryable conflict and a provider outage are failures (W10-DISPATCH-STATUS, D-73; review CR-W10DS-1; W11-DISPATCH-REFUSAL-FINAL, D-134)', () => {
  it('DS-01 W11-DISPATCH-REFUSAL-FINAL (D-134; W10-DISPATCH-STATUS review CR-W10DS-1, D-73): the 409 the service marks retryable (ProjectsService.updateTask\'s RetryableConflictException, reached by projects_complete_task and projects_update_task) reaches the dispatcher as a plain Error with the exception, still a ConflictException, as its cause, so the plan queue retries the step and it completes', async () => {
    const RetryableConflictException = await retryableConflict();
    // The HTTP answer is ConflictException(message)'s, so every route that lets it through answers as before.
    const marked = new RetryableConflictException(CONFLICT);
    expect(marked).toBeInstanceOf(ConflictException);
    expect(marked.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(marked.getResponse()).toEqual(new ConflictException(CONFLICT).getResponse());
    expect(marked.message).toBe(CONFLICT);

    for (const toolName of ['projects_complete_task', 'projects_update_task']) {
      const args = { taskId: 'w10ds_task' };
      const thrown = makeFlow(() => new RetryableConflictException(CONFLICT));
      const err = await thrownByExecuteToolDirectly(thrown.flow, toolName, args);
      expect(err, toolName).toBeInstanceOf(Error);
      expect(err, toolName).not.toBeInstanceOf(HttpException);
      expect((err as Error).message, toolName).toBe(CONFLICT);
      expect((err as Error).cause, toolName).toBeInstanceOf(RetryableConflictException);
      expect((err as Error).cause, toolName).toBeInstanceOf(ConflictException);
      expect(((err as Error).cause as HttpException).getStatus(), toolName).toBe(HttpStatus.CONFLICT);

      // Fails once, answers on the retry: the step completes.
      const once = makeFlow((call) => (call === 1 ? new RetryableConflictException(CONFLICT) : null), { task: { id: 'w10ds_task' } });
      const { dispatcher } = makeDispatcher(once.flow);
      const ran = await dispatcher.dispatch({ businessId: BIZ_A, toolName, args, retryCount: 2 });
      expect(ran, toolName).toMatchObject({ success: true, result: { task: { id: 'w10ds_task' } } });
      expect(once.calls(), toolName).toBe(2);
      expect(dispatcher.getCircuitStatus(toolName, BIZ_A), toolName).toEqual(CLOSED);

      // A race that never clears is a failure: tried three times and counted once, toward this business only.
      const lasting = makeFlow((_call, businessId) => (businessId === BIZ_A ? new RetryableConflictException(CONFLICT) : null), { task: { id: 'w10ds_task' } });
      const held = makeDispatcher(lasting.flow).dispatcher;
      expect(await held.dispatch({ businessId: BIZ_A, toolName, args, retryCount: 2 }), toolName).toMatchObject({ success: false, error: CONFLICT });
      expect(lasting.calls(), toolName).toBe(3);
      expect(held.getCircuitStatus(toolName, BIZ_A), toolName).toMatchObject({ open: false, failures: 1 });
      expect(held.getCircuitStatus(toolName, BIZ_B), toolName).toEqual(CLOSED);
    }
  });

  it('DS-01b W11-DISPATCH-REFUSAL-FINAL (D-134): the real ProjectsService.updateTask, when its conditional write loses the race on both of its attempts, throws RetryableConflictException with the message it always had; a task that is not this business\'s stays a plain 404', async () => {
    const RetryableConflictException = await retryableConflict();
    const existing = { id: 'w10ds_task', businessId: BIZ_A, status: 'TODO', isCompleted: false, evidenceRequired: false, assigneeId: null };
    let conditionalWrites = 0;
    const tx = {
      projectTask: {
        updateMany: async () => {
          conditionalWrites += 1;
          return { count: 0 }; // another writer changed the status or completion first
        },
      },
    };
    const prisma = {
      client: {
        projectTask: { findFirst: async ({ where }: { where: { businessId: string } }) => (where.businessId === BIZ_A ? existing : null) },
        $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      },
    };
    const projects = new ProjectsService(prisma as never, { emit: () => true } as never, {} as never, {} as never, {} as never);

    const stale = await projects.updateTask(BIZ_A, 'w10ds_task', { isCompleted: true }).then(() => null, (e: unknown) => e);
    expect(stale).toBeInstanceOf(RetryableConflictException);
    expect(stale).toBeInstanceOf(ConflictException);
    expect((stale as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((stale as Error).message).toBe(CONFLICT);
    expect(conditionalWrites).toBe(2);

    // Another business's task: the tool's own 404, not a conflict, and nothing is attempted.
    const foreign = await projects.updateTask(BIZ_B, 'w10ds_task', { isCompleted: true }).then(() => null, (e: unknown) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(foreign).not.toBeInstanceOf(ConflictException);
    expect(conditionalWrites).toBe(2);
  });

  it('DS-02 W11-DISPATCH-REFUSAL-FINAL (after W11-PROVIDER-OUTAGE-503; W10-DISPATCH-STATUS review CR-W10DS-1, D-73; updated RR-DISPATCH-NO-BLIND-RETRY, D-263): a provider that did not answer is a 503 provider_unavailable (GmailService.searchMessages\' \'Gmail search failed (503)\', reached by reconcile_sweep_statements); it reaches the dispatcher as itself, is retried on READ tools, stops at 1 attempt with OUTCOME_UNKNOWN on WRITE tools, and five such sweeps open that business\'s circuit for the tool; another business still sweeps', async () => {
    const outage = () => providerUnavailable('gmail', 503, GMAIL_OUTAGE);
    expect(outage()).toBeInstanceOf(ServiceUnavailableException);
    expect(outage().getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'gmail', message: GMAIL_OUTAGE });

    const failure = outage();
    const thrown = makeFlow(() => failure);
    const err = await thrownByExecuteToolDirectly(thrown.flow, SWEEP.toolName, SWEEP.args);
    expect(err).toBe(failure);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((err as Error).message).toBe(GMAIL_OUTAGE);

    // A passing outage on a READ tool: the retry answers.
    const onceRead = makeFlow((call) => (call === 1 ? outage() : null), { revenue: 0 });
    const firstRead = makeDispatcher(onceRead.flow).dispatcher;
    expect(await firstRead.dispatch({ businessId: BIZ_A, toolName: 'fetch_business_summary', args: {}, retryCount: 2 })).toMatchObject({ success: true });
    expect(onceRead.calls()).toBe(2);

    // A lasting outage on WRITE tool reconcile_sweep_statements (RR-DISPATCH-NO-BLIND-RETRY): each sweep
    // stops after 1 attempt with OUTCOME_UNKNOWN and counts once; the fifth opens BIZ_A's circuit.
    const down = makeFlow((_call, businessId) => (businessId === BIZ_A ? outage() : null), { imported: 0, filesConsidered: 0 });
    const { dispatcher, threshold } = makeDispatcher(down.flow);
    for (let i = 0; i < threshold; i++) {
      expect(await dispatcher.dispatch({ businessId: BIZ_A, ...SWEEP, retryCount: 2 })).toMatchObject({ success: false, error: `OUTCOME_UNKNOWN: ${GMAIL_OUTAGE}` });
    }
    expect(down.calls()).toBe(threshold);
    expect(dispatcher.getCircuitStatus(SWEEP.toolName, BIZ_A)).toMatchObject({ open: true, failures: threshold });
    expect(await dispatcher.dispatch({ businessId: BIZ_A, ...SWEEP, retryCount: 2 })).toMatchObject({ success: false, error: `Circuit breaker open for tool "${SWEEP.toolName}"` });
    expect(down.calls()).toBe(threshold);
    expect(await dispatcher.dispatch({ businessId: BIZ_B, ...SWEEP, retryCount: 2 })).toMatchObject({ success: true });
    expect(dispatcher.getCircuitStatus(SWEEP.toolName, BIZ_B)).toEqual(CLOSED);
  });

  it('DS-03 regression control (W10-DISPATCH-STATUS, SEC-W9DC-1, D-73; updated RR-DISPATCH-NO-BLIND-RETRY, D-263): a refusal whose status says asking again gets the same answer (404, 403, 401, 410) reaches the dispatcher as the tool\'s own HttpException, answered once and counted toward no circuit; a 5xx or 429 HttpException reaches it as itself and stays a counted failure (retried on READ, 1 attempt OUTCOME_UNKNOWN on WRITE)', async () => {
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

      // WRITE tool (call_create_task): stops after 1 attempt with OUTCOME_UNKNOWN, still counted on circuit.
      const failingWrite = makeFlow(() => failure);
      const writeDispatcher = makeDispatcher(failingWrite.flow).dispatcher;
      expect(await writeDispatcher.dispatch({ businessId: BIZ_A, toolName: 'call_create_task', args, retryCount: 2 }), String(status)).toMatchObject({ success: false, error: `OUTCOME_UNKNOWN: ${failure.message}` });
      expect(failingWrite.calls(), String(status)).toBe(1);
      expect(writeDispatcher.getCircuitStatus('call_create_task', BIZ_A), String(status)).toMatchObject({ open: false, failures: 1 });

      // READ tool (fetch_business_summary): still retried 3x and counted on circuit.
      const failingRead = makeFlow(() => failure);
      const readDispatcher = makeDispatcher(failingRead.flow).dispatcher;
      expect(await readDispatcher.dispatch({ businessId: BIZ_A, toolName: 'fetch_business_summary', args: {}, retryCount: 2 }), String(status)).toMatchObject({ success: false, error: failure.message });
      expect(failingRead.calls(), String(status)).toBe(3);
      expect(readDispatcher.getCircuitStatus('fetch_business_summary', BIZ_A), String(status)).toMatchObject({ open: false, failures: 1 });
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

  it('DS-05 W11-DISPATCH-REFUSAL-FINAL (D-134; W10-DISPATCH-STATUS review CR-W10DS-1, was it.todo): a member\'s 400 refusal (an argument the tool does not take) and a plain 409 that asking again cannot resolve (a duplicate) reach the dispatcher as the tool\'s own HttpException, are answered once, and count toward no circuit as a 404 or 403 does; another business is unaffected', async () => {
    const cases: Array<[string, Record<string, unknown>, HttpException]> = [
      ['projects_update_task', { taskId: 'w10ds_task', priority: 'SOONISH' }, new BadRequestException('priority must be one of LOW, NORMAL, HIGH, URGENT')],
      ['crm_create_contact', { firstName: 'Mal', email: 'mal@example.com' }, new ConflictException('A contact with this email already exists in this business')],
      // A conflict about the same task that the service did not mark retryable is final too (D-134).
      ['projects_complete_task', { taskId: 'w10ds_task' }, new ConflictException('This plan has already been approved; a plan is approved once')],
    ];
    for (const [toolName, args, refusal] of cases) {
      const label = `${toolName} ${refusal.getStatus()}`;
      const thrown = makeFlow(() => refusal);
      expect(await thrownByExecuteToolDirectly(thrown.flow, toolName, args), label).toBe(refusal);

      // BIZ_A is refused threshold+1 times; BIZ_B's same call answers.
      const refused = makeFlow((_call, businessId) => (businessId === BIZ_A ? refusal : null));
      const { dispatcher, threshold } = makeDispatcher(refused.flow);
      for (let i = 1; i <= threshold + 1; i++) {
        const ran = await dispatcher.dispatch({ businessId: BIZ_A, toolName, args, retryCount: 2 });
        expect(ran, label).toMatchObject({ success: false, error: refusal.message });
        expect(ran.awaitingApproval, label).toBeUndefined();
        expect(refused.calls(), label).toBe(i); // answered once: not retried
        expect(dispatcher.getCircuitStatus(toolName, BIZ_A), label).toEqual(CLOSED);
      }
      expect(await dispatcher.dispatch({ businessId: BIZ_B, toolName, args, retryCount: 2 }), label).toMatchObject({ success: true, result: { id: 'w10ds_ok' } });
      expect(refused.calls(), label).toBe(threshold + 2);
      expect(dispatcher.getCircuitStatus(toolName, BIZ_B), label).toEqual(CLOSED);
      expect(dispatcher.getCircuitStatus(toolName), label).toEqual(CLOSED);
    }
  });

  it('DS-06 W11-DISPATCH-REFUSAL-FINAL (D-134): a call the tool\'s own schema refuses (validateToolInput: a missing required field, a wrong type, a value off its list) reaches the dispatcher as a BadRequestException with the message it always had, before the tool does any work; it is answered once and counted toward no circuit, and the envelope the chat and a plan run over HTTP read keeps its keys and that message', async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['projects_complete_task', {}, 'Missing required fields for projects_complete_task: taskId'],
      ['expenses_create', { amount: '', description: null }, 'Missing required fields for expenses_create: amount, description'],
      ['projects_complete_task', { taskId: 42 }, 'Field "taskId" for projects_complete_task must be a string'],
      ['expenses_create', { amount: 'a lot', description: 'w10ds lunch' }, 'Field "amount" for expenses_create must be a number'],
      ['projects_update_task', { taskId: 'w10ds_task', isCompleted: 'maybe' }, 'Field "isCompleted" for projects_update_task must be a boolean'],
      ['commerce_create_invoice', { items: 'one line' }, 'Field "items" for commerce_create_invoice must be an array'],
      ['draft_followup_message', { contactId: 'w10ds_contact', channel: 'fax' }, 'Field "channel" for draft_followup_message must be one of: email, whatsapp, sms'],
    ];
    for (const [toolName, args, message] of cases) {
      const thrown = makeFlow(() => null);
      const err = await thrownByExecuteToolDirectly(thrown.flow, toolName, { ...args });
      expect(err, message).toBeInstanceOf(BadRequestException);
      expect((err as HttpException).getStatus(), message).toBe(HttpStatus.BAD_REQUEST);
      expect((err as Error).message, message).toBe(message);
      expect(thrown.calls(), message).toBe(0);

      const refused = makeFlow(() => null);
      const attempts = countAttempts(refused.flow);
      const { dispatcher, threshold } = makeDispatcher(refused.flow);
      for (let i = 1; i <= threshold + 1; i++) {
        expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName, args: { ...args }, retryCount: 2 }), message).toMatchObject({ success: false, error: message });
        expect(attempts(), message).toBe(i); // answered once: not retried
        expect(dispatcher.getCircuitStatus(toolName, BIZ_A), message).toEqual(CLOSED);
      }
      expect(refused.calls(), message).toBe(0); // the tool's own work never ran

      const { flow } = makeFlow(() => null);
      const envelope = await flow.executeToolDirect(BIZ_A, toolName, { ...args }, 'w10ds_plan', 'w10ds_step', { surface: 'PLAN_QUEUE', planId: 'w10ds_plan', planStepId: 'w10ds_step' });
      expect(Object.keys(envelope).sort(), message).toEqual(['changedEntities', 'error', 'family', 'followOnSuggestions', 'name', 'result', 'riskTier', 'success', 'toolCallId']);
      expect(envelope, message).toMatchObject({ success: false, result: null, error: message, name: toolName });
    }

    // Control: a call the schema takes (a number and a boolean sent as text are read, as before) runs.
    const ok = makeFlow(() => null);
    const { dispatcher } = makeDispatcher(ok.flow);
    expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: 'expenses_create', args: { amount: '12.5', description: 'w10ds lunch' }, retryCount: 2 })).toMatchObject({ success: true });
    expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: 'projects_update_task', args: { taskId: 'w10ds_task', isCompleted: 'true' }, retryCount: 2 })).toMatchObject({ success: true });
    expect(ok.calls()).toBe(2);
  });

  it('DS-07 regression control (W11-DISPATCH-REFUSAL-FINAL; W9 isToolRefusal; updated RR-DISPATCH-NO-BLIND-RETRY, D-263): a 408 Request Timeout reaches the dispatcher as itself and stays a counted failure (retried 3x on READ, 1 attempt OUTCOME_UNKNOWN on WRITE); so does an error that is no HttpException', async () => {
    const args = { contactId: 'w10ds_contact', callerId: 'w10ds_owner' };
    for (const failure of [new HttpException('Request Timeout', HttpStatus.REQUEST_TIMEOUT), new Error('connect ECONNRESET')]) {
      const thrown = makeFlow(() => failure);
      const err = await thrownByExecuteToolDirectly(thrown.flow, 'call_create_task', args);
      if (failure instanceof HttpException) expect(err).toBe(failure);
      else {
        expect(err).not.toBeInstanceOf(HttpException);
        expect((err as Error).message).toBe(failure.message);
      }

      // WRITE tool (call_create_task): stops after 1 attempt with OUTCOME_UNKNOWN, still counted on circuit.
      const failingWrite = makeFlow(() => failure);
      const writeDispatcher = makeDispatcher(failingWrite.flow).dispatcher;
      expect(await writeDispatcher.dispatch({ businessId: BIZ_A, toolName: 'call_create_task', args, retryCount: 2 }), failure.message).toMatchObject({ success: false, error: `OUTCOME_UNKNOWN: ${failure.message}` });
      expect(failingWrite.calls(), failure.message).toBe(1);
      expect(writeDispatcher.getCircuitStatus('call_create_task', BIZ_A), failure.message).toMatchObject({ open: false, failures: 1 });

      // READ tool (fetch_business_summary): still retried 3x and counted on circuit.
      const failingRead = makeFlow(() => failure);
      const readDispatcher = makeDispatcher(failingRead.flow).dispatcher;
      expect(await readDispatcher.dispatch({ businessId: BIZ_A, toolName: 'fetch_business_summary', args: {}, retryCount: 2 }), failure.message).toMatchObject({ success: false, error: failure.message });
      expect(failingRead.calls(), failure.message).toBe(3);
      expect(readDispatcher.getCircuitStatus('fetch_business_summary', BIZ_A), failure.message).toMatchObject({ open: false, failures: 1 });
    }
  });

  it('DS-08 W11-DISPATCH-REFUSAL-FINAL review SEC-1 (D-134): contract_extract_clauses fetches a document from a host the call names, and ContractClauseService reports a host that did not answer (5xx, 408, 429) as a 400; through the tool that stays a failure the plan queue retries and counts (a 503 with the same message), while a host that answered and refused (404, 403) is the final 400 it is', async () => {
    const TOOL = 'contract_extract_clauses';
    const args = { contractId: 'w10ds_contract', url: 'https://files.example.test/contract.pdf' };
    /** The real executeToolAction case over a ContractClauseService that answers as the real one does for the host's status. */
    const makeClauseFlow = (hostStatus: (call: number, businessId: string) => number) => {
      let calls = 0;
      const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService;
      Object.assign(flow, {
        logger: quiet,
        governance: { getToolTier: () => 1 },
        executionLog: { logToolExecution: async () => 'w10ds_log' },
        businessGraph: { invalidateCache: () => undefined },
        memberScopeRefusal: async () => null,
        attributeExecutionLog: async () => undefined,
        moduleRef: {
          get: () => ({
            extractClauses: async (businessId: string, contractId: string, opts: { url?: string }) => {
              calls += 1;
              expect([contractId, opts.url]).toEqual([args.contractId, args.url]);
              const status = hostStatus(calls, businessId);
              // As the real service throws it (DS-09 runs the real one): an outage is marked by the 400's cause.
              const outage = status >= 500 || status === 408 || status === 429;
              if (status !== 200) throw new BadRequestException(`Could not fetch document URL (${status})`, outage ? { cause: new DocumentHostUnavailableError(status), description: 'Bad Request' } : undefined);
              return { clauses: [], source: 'url' };
            },
          }),
        },
      });
      return { flow, calls: () => calls };
    };

    for (const status of [500, 502, 503, 504, 408, 429]) {
      const message = `Could not fetch document URL (${status})`;
      const err = await thrownByExecuteToolDirectly(makeClauseFlow(() => status).flow, TOOL, args);
      expect(err, message).toBeInstanceOf(ServiceUnavailableException);
      expect((err as Error).message, message).toBe(message);
      expect(((err as Error).cause as HttpException | undefined)?.getStatus(), message).toBe(HttpStatus.BAD_REQUEST);

      // A passing outage: the retry reads the document.
      const once = makeClauseFlow((call) => (call === 1 ? status : 200));
      expect(await makeDispatcher(once.flow).dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), message).toMatchObject({ success: true, result: { source: 'url' } });
      expect(once.calls(), message).toBe(2);

      // A lasting one: tried three times, counted once, toward this business only.
      const down = makeClauseFlow((_call, businessId) => (businessId === BIZ_A ? status : 200));
      const { dispatcher } = makeDispatcher(down.flow);
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), message).toMatchObject({ success: false, error: message });
      expect(down.calls(), message).toBe(3);
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), message).toMatchObject({ open: false, failures: 1 });
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_B), message).toEqual(CLOSED);

      // The envelope the chat and a plan run over HTTP read carries the message it always had.
      const envelope = await makeClauseFlow(() => status).flow.executeToolDirect(BIZ_A, TOOL, args, 'w10ds_plan', 'w10ds_step', { surface: 'PLAN_QUEUE', planId: 'w10ds_plan', planStepId: 'w10ds_step' });
      expect(envelope, message).toMatchObject({ success: false, result: null, error: message, name: TOOL });
    }

    // The host answered and refused: asking again gets the same answer, so it is final and uncounted.
    for (const status of [404, 403, 401, 410, 400]) {
      const message = `Could not fetch document URL (${status})`;
      const err = await thrownByExecuteToolDirectly(makeClauseFlow(() => status).flow, TOOL, args);
      expect(err, message).toBeInstanceOf(BadRequestException);
      expect((err as Error).message, message).toBe(message);

      const refused = makeClauseFlow(() => status);
      const { dispatcher } = makeDispatcher(refused.flow);
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), message).toMatchObject({ success: false, error: message });
      expect(refused.calls(), message).toBe(1);
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), message).toEqual(CLOSED);
    }

    // Another 400 of the service's (no document to read) is not an outage: final.
    const noDoc = makeClauseFlow(() => 200);
    (noDoc.flow as unknown as { moduleRef: { get: () => unknown } }).moduleRef = { get: () => ({ extractClauses: async () => { throw new BadRequestException('No document is attached to this contract (503)'); } }) };
    const noDocErr = await thrownByExecuteToolDirectly(noDoc.flow, TOOL, args);
    expect(noDocErr).toBeInstanceOf(BadRequestException);
  });

  it('DS-09 W11-DISPATCH-REFUSAL-FINAL review COR-1 (D-134): through the real ContractClauseService, a document host that did not answer stays a failure the plan queue retries and counts on both of its fetches: the URL the call names, and the contract\'s own asset (whose failed fetch the service answers as a 400 \'No source document available\'); the service still throws the 400 it always did, and an asset whose host answered and refused, or a contract with no document, is the final 400', async () => {
    const TOOL = 'contract_extract_clauses';
    const NO_SOURCE = 'No source document available for this contract (upload one or link an asset/document)';
    const ASSET_URL = 'https://assets.example.test/w10ds_asset.pdf';
    const NAMED_URL = 'https://files.example.test/contract.pdf';
    // FU-CONTRACT-FETCH-OUTBOUND-GUARD (D-246): the service resolves a document's host before it fetches
    // (the outbound-address guard); the two stand-in hosts answer a public address, and no DNS query leaves.
    const lookup = vi.spyOn(dns.promises, 'lookup').mockImplementation((async (hostname: string) => {
      if (hostname === 'files.example.test' || hostname === 'assets.example.test') return [{ address: '203.0.113.10', family: 4 }];
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    }) as never);
    onTestFinished(() => lookup.mockRestore());
    /** The real tool case over the real ContractClauseService; `hostStatus` answers each fetch. */
    const makeRealClauseFlow = (hostStatus: (url: string, call: number, businessId: string) => number, contract: Record<string, unknown> = { sourceAssetId: 'w10ds_asset' }) => {
      let fetches = 0;
      let current = BIZ_A;
      vi.stubGlobal('fetch', async (url: string) => {
        fetches += 1;
        const status = hostStatus(String(url), fetches, current);
        return { ok: status >= 200 && status < 300, status, headers: { get: () => 'text/plain' }, arrayBuffer: async () => new TextEncoder().encode('w10ds contract text').buffer };
      });
      const prisma = {
        client: {
          contract: {
            findFirst: async ({ where }: { where: { businessId: string } }) => { current = where.businessId; return { id: 'w10ds_contract', title: 'w10ds contract', ...contract }; },
            update: async () => ({}),
          },
          asset: { findFirst: async () => ({ url: ASSET_URL, mimeType: 'text/plain', name: 'w10ds_asset' }) },
        },
      };
      const collaborators = {
        parse: async () => ({ markdown: 'w10ds contract text' }),
        trackAndComplete: async () => ({ content: '{"clauses":[{"label":"Parties","present":true}]}' }),
      };
      const service = new ContractClauseService(prisma as never, { get: () => collaborators } as never);
      const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService;
      Object.assign(flow, {
        logger: quiet,
        governance: { getToolTier: () => 1 },
        executionLog: { logToolExecution: async () => 'w10ds_log' },
        businessGraph: { invalidateCache: () => undefined },
        memberScopeRefusal: async () => null,
        attributeExecutionLog: async () => undefined,
        moduleRef: { get: () => service },
      });
      return { flow, service, fetches: () => fetches };
    };

    const sources: Array<[string, Record<string, unknown>, (status: number) => string]> = [
      ['named url', { contractId: 'w10ds_contract', url: NAMED_URL }, (status) => `Could not fetch document URL (${status})`],
      ['contract asset', { contractId: 'w10ds_contract' }, () => NO_SOURCE],
    ];
    for (const [source, args, messageFor] of sources) {
      for (const status of [500, 503, 408, 429]) {
        const label = `${source} ${status}`;
        const message = messageFor(status);

        // The service's own answer: still the 400 with the message and body it always had.
        const direct = await makeRealClauseFlow(() => status).service
          .extractClauses(BIZ_A, 'w10ds_contract', { url: args.url as string | undefined }).then(() => null, (e: unknown) => e);
        expect(direct, label).toBeInstanceOf(BadRequestException);
        expect((direct as HttpException).getResponse(), label).toEqual(new BadRequestException(message).getResponse());

        const err = await thrownByExecuteToolDirectly(makeRealClauseFlow(() => status).flow, TOOL, args);
        expect(err, label).toBeInstanceOf(ServiceUnavailableException);
        expect((err as Error).message, label).toBe(message);

        // A passing outage: the retry reads the document.
        const once = makeRealClauseFlow((_url, call) => (call === 1 ? status : 200));
        expect(await makeDispatcher(once.flow).dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: true, result: { total: 1 } });
        expect(once.fetches(), label).toBe(2);

        // A lasting one in BIZ_A: tried three times, counted once; BIZ_B reads its document.
        const down = makeRealClauseFlow((_url, _call, businessId) => (businessId === BIZ_A ? status : 200));
        const { dispatcher } = makeDispatcher(down.flow);
        expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: false, error: message });
        expect(down.fetches(), label).toBe(3);
        expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), label).toMatchObject({ open: false, failures: 1 });
        expect(await dispatcher.dispatch({ businessId: BIZ_B, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: true });
        expect(dispatcher.getCircuitStatus(TOOL, BIZ_B), label).toEqual(CLOSED);
      }

      // The host answered and refused: final, answered once, uncounted.
      for (const status of [404, 403]) {
        const label = `${source} ${status}`;
        expect(await thrownByExecuteToolDirectly(makeRealClauseFlow(() => status).flow, TOOL, args), label).toBeInstanceOf(BadRequestException);
        // (each makeRealClauseFlow replaces the fetch stand-in, so a flow is made right before it is used)
        const refused = makeRealClauseFlow(() => status);
        const { dispatcher } = makeDispatcher(refused.flow);
        expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: false, error: messageFor(status) });
        expect(refused.fetches(), label).toBe(1);
        expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), label).toEqual(CLOSED);
      }
    }

    // A contract with no document at all: nothing is fetched, and the 400 is final.
    const none = makeRealClauseFlow(() => 503, { sourceAssetId: null });
    const { dispatcher } = makeDispatcher(none.flow);
    expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args: { contractId: 'w10ds_contract' }, retryCount: 2 })).toMatchObject({ success: false, error: NO_SOURCE });
    expect(none.fetches()).toBe(0);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toEqual(CLOSED);
  });

  it('DS-10 W11-DISPATCH-REFUSAL-FINAL review SEC2-1 (D-134): contract_extract_terms reads the document with the model, and DocumentIntelligenceService answers a model that failed (an outage, a timeout, the AI rate limit, an unreadable answer) as an \'unknown\' document, which ContractsService refuses with a 400; through the real services that stays a failure the plan queue retries and counts, while a document the model read and found to be no contract is the final 400. What the two services answer their other callers is unchanged', async () => {
    const TOOL = 'contract_extract_terms';
    const REFUSAL = 'Document does not appear to be a contract or extraction failed';
    const args = { contractId: 'w10ds_contract', sourceAssetId: 'w10ds_asset' };
    const CONTRACT_JSON = JSON.stringify({ documentType: 'contract', confidence: 0.9, contractData: { title: 'w10ds contract' }, suggestedActions: [] });
    const INVOICE_JSON = JSON.stringify({ documentType: 'invoice', confidence: 0.9, invoiceData: { total: 10 }, suggestedActions: [] });
    /** The real tool case over the real ContractsService and DocumentIntelligenceService; `model` answers each model call or throws. */
    const makeTermsFlow = (model: (call: number, businessId: string) => string | Error) => {
      let calls = 0;
      const prisma = {
        client: {
          contract: { findFirst: async () => ({ id: 'w10ds_contract', title: 'w10ds contract' }) },
          asset: { findFirst: async () => ({ url: null, mimeType: 'text/plain', name: 'w10ds_asset.txt' }) },
        },
      };
      const aiUsage = {
        trackAndComplete: async (businessId: string) => {
          calls += 1;
          const answer = model(calls, businessId);
          if (answer instanceof Error) throw answer;
          return { content: answer };
        },
      };
      const docIntel = new DocumentIntelligenceService(
        prisma as never, { emit: () => true } as never, {} as never, { log: async () => undefined } as never, {} as never, aiUsage as never,
        { get: () => ({ parse: async () => null }) } as never,
      );
      (docIntel as unknown as { logger: unknown }).logger = quiet;
      const contracts = new ContractsService(prisma as never, docIntel, { emit: () => true } as never);
      // What is written once the model has read a contract is not this case's subject.
      (contracts as unknown as { applyExtractionResult: unknown }).applyExtractionResult = async () => undefined;
      const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService;
      Object.assign(flow, {
        logger: quiet,
        governance: { getToolTier: () => 1 },
        executionLog: { logToolExecution: async () => 'w10ds_log' },
        businessGraph: { invalidateCache: () => undefined },
        memberScopeRefusal: async () => null,
        attributeExecutionLog: async () => undefined,
        moduleRef: { get: () => contracts },
      });
      return { flow, contracts, docIntel, calls: () => calls };
    };

    const failures = [
      new Error('Anthropic API error (503)'),
      new HttpException('AI rate limit reached for this business', HttpStatus.TOO_MANY_REQUESTS),
      new Error('The operation was aborted due to timeout'),
    ];
    for (const failure of failures) {
      const label = failure.message;

      // What the services answer their other callers is what it was: the 'unknown' document, and the 400.
      const direct = makeTermsFlow(() => failure);
      const unknown = await direct.docIntel.extractFromDocument({ businessId: BIZ_A, source: 'asset', mimeType: 'text/plain', filename: 'w10ds_asset.txt' } as never);
      expect(unknown, label).toEqual({ documentType: 'unknown', confidence: 0, rawText: '', suggestedActions: [] });
      expect(JSON.parse(JSON.stringify(unknown)), label).toEqual({ documentType: 'unknown', confidence: 0, rawText: '', suggestedActions: [] });
      const refused = await direct.contracts.extractTermsFromDocument(BIZ_A, 'w10ds_contract', { sourceAssetId: 'w10ds_asset' } as never).then(() => null, (e: unknown) => e);
      expect(refused, label).toBeInstanceOf(BadRequestException);
      expect((refused as HttpException).getResponse(), label).toEqual(new BadRequestException(REFUSAL).getResponse());

      const err = await thrownByExecuteToolDirectly(makeTermsFlow(() => failure).flow, TOOL, args);
      expect(err, label).toBeInstanceOf(ServiceUnavailableException);
      expect((err as Error).message, label).toBe(REFUSAL);

      // A passing failure: the retry reads the contract.
      const once = makeTermsFlow((call) => (call === 1 ? failure : CONTRACT_JSON));
      expect(await makeDispatcher(once.flow).dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: true });
      expect(once.calls(), label).toBe(2);

      // A lasting one in BIZ_A: tried three times, counted once; BIZ_B's contract is read.
      const down = makeTermsFlow((_call, businessId) => (businessId === BIZ_A ? failure : CONTRACT_JSON));
      const { dispatcher } = makeDispatcher(down.flow);
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: false, error: REFUSAL });
      expect(down.calls(), label).toBe(3);
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), label).toMatchObject({ open: false, failures: 1 });
      expect(await dispatcher.dispatch({ businessId: BIZ_B, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: true });
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_B), label).toEqual(CLOSED);
    }

    // The model read the document and it is no contract: asking again gets the same answer. Final, uncounted.
    expect(await thrownByExecuteToolDirectly(makeTermsFlow(() => INVOICE_JSON).flow, TOOL, args)).toBeInstanceOf(BadRequestException);
    const notContract = makeTermsFlow(() => INVOICE_JSON);
    const { dispatcher, threshold } = makeDispatcher(notContract.flow);
    for (let i = 1; i <= threshold + 1; i++) {
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 })).toMatchObject({ success: false, error: REFUSAL });
      expect(notContract.calls()).toBe(i);
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_A)).toEqual(CLOSED);
    }
  });

  it('DS-11 W11-DISPATCH-REFUSAL-FINAL review COR3-1 (D-134): a refusal the model door gives before any read (the business has no AI credits left: 403) is not a failed read. contract_extract_terms answers it once and counts it toward no circuit, as contract_extract_clauses does; a 429, a 503 and an error that is no HttpException stay failed reads', async () => {
    const TOOL = 'contract_extract_terms';
    const REFUSAL = 'Document does not appear to be a contract or extraction failed';
    const args = { contractId: 'w10ds_contract', sourceAssetId: 'w10ds_asset' };
    /** The real tool case over the real ContractsService and DocumentIntelligenceService; the model door throws `thrown` on every call. */
    const makeRefusedTermsFlow = (thrown: Error) => {
      let calls = 0;
      const prisma = {
        client: {
          contract: { findFirst: async () => ({ id: 'w10ds_contract', title: 'w10ds contract' }) },
          asset: { findFirst: async () => ({ url: null, mimeType: 'text/plain', name: 'w10ds_asset.txt' }) },
        },
      };
      const aiUsage = { trackAndComplete: async () => { calls += 1; throw thrown; } };
      const docIntel = new DocumentIntelligenceService(
        prisma as never, { emit: () => true } as never, {} as never, { log: async () => undefined } as never, {} as never, aiUsage as never,
        { get: () => ({ parse: async () => null }) } as never,
      );
      (docIntel as unknown as { logger: unknown }).logger = quiet;
      const contracts = new ContractsService(prisma as never, docIntel, { emit: () => true } as never);
      const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService;
      Object.assign(flow, {
        logger: quiet,
        governance: { getToolTier: () => 1 },
        executionLog: { logToolExecution: async () => 'w10ds_log' },
        businessGraph: { invalidateCache: () => undefined },
        memberScopeRefusal: async () => null,
        attributeExecutionLog: async () => undefined,
        moduleRef: { get: () => contracts },
      });
      return { flow, calls: () => calls };
    };

    // Final: asking again gets the same answer.
    for (const refusal of [new ForbiddenException('AI credit limit reached for this billing period'), new BadRequestException('The document is too large to read')]) {
      const label = refusal.message;
      const err = await thrownByExecuteToolDirectly(makeRefusedTermsFlow(refusal).flow, TOOL, args);
      expect(err, label).toBeInstanceOf(BadRequestException);
      expect((err as Error).message, label).toBe(REFUSAL);

      const refused = makeRefusedTermsFlow(refusal);
      const { dispatcher, threshold } = makeDispatcher(refused.flow);
      for (let i = 1; i <= threshold + 1; i++) {
        expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: false, error: REFUSAL });
        expect(refused.calls(), label).toBe(i);
        expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), label).toEqual(CLOSED);
      }
    }

    // Failed reads: tried three times and counted.
    const failedReads = [
      new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
      new HttpException('Request Timeout', HttpStatus.REQUEST_TIMEOUT),
      new ServiceUnavailableException('KEY is switched off'),
      new Error('connect ECONNRESET'),
    ];
    for (const failure of failedReads) {
      const label = failure.message;
      expect(await thrownByExecuteToolDirectly(makeRefusedTermsFlow(failure).flow, TOOL, args), label).toBeInstanceOf(ServiceUnavailableException);
      const failing = makeRefusedTermsFlow(failure);
      const { dispatcher } = makeDispatcher(failing.flow);
      expect(await dispatcher.dispatch({ businessId: BIZ_A, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: false, error: REFUSAL });
      expect(failing.calls(), label).toBe(3);
      expect(dispatcher.getCircuitStatus(TOOL, BIZ_A), label).toMatchObject({ open: false, failures: 1 });
    }
  });
});
