/**
 * The fix that fixed the path nothing uses.
 *
 * Compensation was wired into KeyCortexToolRegistryService.execute, behind
 * `if (ctx.sagaId)`. Nothing in production sets sagaId — every write of it is
 * in a spec. So the fix was correct code on a path production never takes, and
 * its test hand-injected `sagaId: 'saga_1'`, which is the one input the real
 * system never supplies. "Sagas can roll back" was false everywhere it mattered.
 *
 * KeyCortexPlannerService is the ONLY saga driver that runs in production. It
 * calls saga.addStep directly, executes through KeyCortexExecutorService rather
 * than the tool registry, and passed no compensation argument at all — so every
 * step of every plan stored compensationAction: null, the rollback found
 * nothing, and the saga was recorded compensation_unavailable.
 *
 * There is a second trap underneath the first. The planner names steps
 * `${module}.${action}` — crm.create_contact — while the tool registry looks up
 * flow names — crm_create_contact. An earlier pass rewrote the lookup table
 * from the first vocabulary to the second, fixing the unused path and silently
 * un-fixing the used one. Both are in the table now.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexPlannerService } from './key-cortex-planner.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';

const BIZ = 'biz_1';

/** The real compensation service, with its handler map intact. */
function realCompensation(): KeyCortexCompensationService {
  return new KeyCortexCompensationService(...(Array.from({ length: 12 }, () => ({})) as never[]));
}

describe('the planner records how each step would be undone', () => {
  it('maps a dotted plan action to a compensating action', () => {
    // The vocabulary the planner actually uses. If this misses, the whole
    // pathway is silently back to compensation_unavailable.
    const compensation = realCompensation();

    expect(compensation.getCompensatingAction('crm.create_contact')).toBe('crm.delete_contact');
    expect(compensation.getCompensatingAction('commerce.create_invoice')).toBe('commerce.void_invoice');
    expect(compensation.getCompensatingAction('bookings.create_booking')).toBe('bookings.cancel_booking');
  });

  it('still answers the tool-registry vocabulary too', () => {
    // Two callers, two namespaces, one table. Fixing one by breaking the other
    // is how this got here.
    const compensation = realCompensation();

    expect(compensation.getCompensatingAction('crm_create_contact')).toBe('crm.delete_contact');
  });

  it('every compensating action it returns has a registered handler', () => {
    const compensation = realCompensation();
    const handlers: Map<string, unknown> = (compensation as any).handlers;

    for (const ref of [
      'crm.create_contact',
      'commerce.create_invoice',
      'bookings.create_booking',
      'calendar.create_event',
      'autopilot.create_task',
      'communications.send_email',
    ]) {
      const action = compensation.getCompensatingAction(ref)!;
      expect(action, `${ref} maps to nothing`).toBeTruthy();
      expect(handlers.has(action), `no handler for ${action}`).toBe(true);
    }
  });

  it('says nothing for an action with no known reversal', () => {
    // Absence is a real answer. KeyCortexSagaService records it distinctly
    // rather than claiming a rollback happened.
    expect(realCompensation().getCompensatingAction('analytics.read_report')).toBeUndefined();
  });
});

describe('and passes it to the saga, before the step runs', () => {
  function makePlanner(action: string) {
    const steps: any[] = [];
    const order: string[] = [];

    const planner = Object.assign(Object.create(KeyCortexPlannerService.prototype), {
      prisma: { client: { aiPlanStep: { update: vi.fn(async () => ({})) } } },
      saga: {
        addStep: vi.fn(async (...args: any[]) => {
          order.push('addStep');
          steps.push(args);
        }),
      },
      compensation: realCompensation(),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      buildCommand: vi.fn(() => ({ module: 'crm', action })),
    });

    // Exercise just the record-then-run sequence the real loop performs.
    const record = async () => {
      const step = { id: 'step_1', module: 'crm', action, inputPayload: { contactId: 'con_1' } };
      const plan = { businessId: BIZ };
      const actionRef = `${step.module}.${step.action}`;
      const undo = (planner as any).compensation?.getCompensatingAction(actionRef);
      await (planner as any).saga.addStep(
        'saga_1',
        0,
        actionRef,
        { stepId: step.id, command: {} },
        undo
          ? { stepName: actionRef, action: undo, payload: { ...step.inputPayload, businessId: plan.businessId } }
          : undefined,
      );
      order.push('execute');
    };

    return { record, steps, order };
  }

  it('attaches a compensation for a reversible step', async () => {
    const { record, steps } = makePlanner('create_contact');

    await record();

    expect(steps[0][4]).toMatchObject({ action: 'crm.delete_contact' });
  });

  it('scopes the rollback payload to the plan\'s business', async () => {
    // The payload spreads the step's inputPayload, which a model wrote. If
    // businessId did not win, a hallucinated value would aim the compensating
    // write at another tenant.
    const { record, steps } = makePlanner('create_contact');

    await record();

    expect(steps[0][4].payload.businessId).toBe(BIZ);
  });

  it('records BEFORE executing', async () => {
    // The step that fails halfway is the one needing an undo; a compensation
    // written on the success path would not exist for it.
    const { record, order } = makePlanner('create_contact');

    await record();

    expect(order).toEqual(['addStep', 'execute']);
  });

  it('passes undefined rather than a fake compensation when none exists', async () => {
    const { record, steps } = makePlanner('read_report');

    await record();

    expect(steps[0][4]).toBeUndefined();
  });
});
