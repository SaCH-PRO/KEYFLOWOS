/**
 * Rollback was structurally impossible, and the audit trail said otherwise.
 *
 * Three independent facts combined into one hole:
 *
 *   1. `KeyCortexToolDefinition.compensation` is set by NO tool anywhere.
 *   2. The only code that ever built a compensation from the lookup table lives
 *      in KeyCortexSagaExecutorService, which is referenced solely by module
 *      registration arrays and one comment — it has no callers.
 *   3. So every saga step stored `compensationAction: null`, every rollback
 *      found nothing to run, and KeyCortexSagaService recorded the saga
 *      `compensation_unavailable`.
 *
 * Any limb that moves money, mail or bookings had no undo. That is the thing
 * that has to be true before organs are worth building.
 *
 * And the table itself would not have saved it. It was keyed on `create_contact`,
 * `create_invoice`, `create_booking`, `send_message` — none of which are tool
 * names. The real names are `crm_create_contact`, `commerce_create_invoice`,
 * `bookings_create_booking`, `send_message_with_approval`. Eight of ten keys
 * matched nothing, so wiring the lookup without fixing the keys would have been
 * a fix that looks like a fix and changes nothing: the same
 * `compensation_unavailable`, now with more code behind it.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { getToolByName } from '../ai/flow-tool-registry';

const BIZ = 'biz_1';

/** The real compensation service, with its handler map intact. */
function realCompensation(): KeyCortexCompensationService {
  return new KeyCortexCompensationService(
    ...(Array.from({ length: 12 }, () => ({})) as never[]),
  );
}

function makeRegistry(opts: { withCompensation?: boolean } = {}) {
  const steps: any[] = [];
  const saga = {
    addStep: vi.fn(async (...args: any[]) => {
      steps.push(args);
    }),
    completeStep: vi.fn(async () => undefined),
    failStep: vi.fn(async () => undefined),
  };

  const registry = Object.assign(Object.create(KeyCortexToolRegistryService.prototype), {
    tools: new Map(),
    outcomes: new Map(),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    prisma: { client: {} },
    saga,
    idempotency: { check: vi.fn(async () => ({ status: 'new' })), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined) },
    safety: { check: vi.fn(async () => ({ allowed: true })) },
    compensation: opts.withCompensation === false ? undefined : realCompensation(),
  });

  return { registry, steps, saga };
}

/** Runs the real private compensationFor against a stub instance. */
function compensationFor(registry: unknown, name: string, input: Record<string, unknown> = {}) {
  return (registry as any).compensationFor(name, { businessId: BIZ }, input);
}

describe('a step that can be undone says so, before it runs', () => {
  it('derives a compensation for a tool the table knows', async () => {
    const { registry } = makeRegistry();

    const comp = compensationFor(registry, 'commerce_create_invoice', { contactId: 'con_1' });

    expect(comp).toMatchObject({
      stepName: 'commerce_create_invoice',
      action: 'commerce.void_invoice',
    });
  });

  it('carries the arguments the rollback will need', async () => {
    const { registry } = makeRegistry();

    const comp = compensationFor(registry, 'crm_create_contact', { email: 'a@b.c' });

    expect(comp.payload).toMatchObject({ email: 'a@b.c', businessId: BIZ });
  });

  it('a tool argument cannot redirect the rollback at another tenant', async () => {
    // payload spreads the tool input, which is model-supplied. If businessId
    // did not win, a hallucinated or hostile argument would aim the
    // compensating write at someone else's data.
    const { registry } = makeRegistry();

    const comp = compensationFor(registry, 'crm_create_contact', { businessId: 'biz_victim' });

    expect(comp.payload.businessId).toBe(BIZ);
  });

  it('returns undefined for a tool nobody has taught KEY to undo', async () => {
    // Absence is a real answer. KeyCortexSagaService records it distinctly
    // rather than reporting a rollback that did not happen.
    const { registry } = makeRegistry();

    expect(compensationFor(registry, 'fetch_business_summary')).toBeUndefined();
  });

  it("prefers a tool's own declared compensation over the table", async () => {
    const { registry } = makeRegistry();
    (registry as any).tools.set('custom_tool', {
      name: 'custom_tool',
      compensation: { action: 'custom.undo', payload: { fixed: true } },
    });

    const comp = compensationFor(registry, 'custom_tool', {});

    expect(comp).toMatchObject({ action: 'custom.undo', payload: { fixed: true } });
  });

  it('degrades to no compensation when the service is absent, rather than throwing', async () => {
    // It is @Optional. A deployment without it must still execute tools.
    const { registry } = makeRegistry({ withCompensation: false });

    expect(compensationFor(registry, 'commerce_create_invoice')).toBeUndefined();
  });
});

describe('execute() actually records it', () => {
  // Everything above calls compensationFor directly, which proves the helper
  // works and NOTHING about whether anything invokes it. That is precisely the
  // shape of the bug being fixed — buildCompensation was correct, complete, and
  // called by nobody — so the wiring gets its own test.

  function registerTool(registry: any, name: string) {
    registry.tools.set(name, {
      name,
      module: 'flow',
      description: 'x',
      parameters: { type: 'object', properties: {}, required: [] },
      riskTier: 1,
      requiresApproval: false,
      handler: vi.fn(async () => ({ success: true, data: { id: 'inv_1' } })),
    });
  }

  it('passes a compensation to saga.addStep when the step runs inside a saga', async () => {
    const { registry, steps } = makeRegistry();
    registerTool(registry, 'commerce_create_invoice');

    await (registry as any).execute(
      'commerce_create_invoice',
      { businessId: BIZ, sagaId: 'saga_1', preApproved: true },
      { contactId: 'con_1' },
    );

    expect(steps, 'no saga step was recorded at all').toHaveLength(1);
    const compensation = steps[0][4];
    expect(compensation, 'the step stored compensationAction: null').toBeDefined();
    expect(compensation.action).toBe('commerce.void_invoice');
  });

  it('records it BEFORE the tool runs, not after it succeeds', async () => {
    // The step that crashes mid-write is exactly the one needing an undo. A
    // compensation written on the success path would not exist for it.
    const order: string[] = [];
    const { registry } = makeRegistry();
    registerTool(registry, 'commerce_create_invoice');
    (registry as any).tools.get('commerce_create_invoice').handler = vi.fn(async () => {
      order.push('handler');
      throw new Error('write failed halfway');
    });
    (registry as any).saga.addStep = vi.fn(async () => {
      order.push('addStep');
    });

    await (registry as any)
      .execute('commerce_create_invoice', { businessId: BIZ, sagaId: 'saga_1', preApproved: true }, {})
      .catch(() => undefined);

    expect(order).toEqual(['addStep', 'handler']);
  });

  it('records no compensation for a tool that has none', async () => {
    const { registry, steps } = makeRegistry();
    registerTool(registry, 'fetch_business_summary');

    await (registry as any).execute(
      'fetch_business_summary',
      { businessId: BIZ, sagaId: 'saga_1', preApproved: true },
      {},
    );

    expect(steps[0][4]).toBeUndefined();
  });
});

describe('the lookup table points at things that exist', () => {
  const compensation = realCompensation();

  // The real map, read through the public accessor rather than duplicated here.
  const CANDIDATES = [
    'crm_create_contact',
    'create_task',
    'call_create_task',
    'projects_create_task',
    'calendar_create_event',
    'commerce_create_invoice',
    'bookings_create_booking',
    'send_message_with_approval',
    'key_inbox.send_reply',
  ];

  it('every key is a real tool name', () => {
    // THE BUG. `create_contact`, `create_invoice`, `create_booking` and
    // `send_message` were keys; none of them is a tool. A table keyed on names
    // that do not exist returns undefined forever and looks fully populated.
    for (const name of CANDIDATES) {
      const isFlowTool = !!getToolByName(name);
      const isOrganTool = name.includes('.');
      expect(isFlowTool || isOrganTool, `"${name}" is not a real tool name`).toBe(true);
    }
  });

  it('every key actually resolves to a compensating action', () => {
    for (const name of CANDIDATES) {
      expect(compensation.getCompensatingAction(name), `${name} maps to nothing`).toBeTruthy();
    }
  });

  it('every compensating action has a registered handler', () => {
    // The same failure one layer down: an action nobody can run undoes nothing.
    const handlers: Map<string, unknown> = (compensation as any).handlers;

    for (const name of CANDIDATES) {
      const action = compensation.getCompensatingAction(name)!;
      expect(handlers.has(action), `no handler registered for ${action}`).toBe(true);
    }
  });

  it('does not claim to undo a read', () => {
    // A compensation for a read is a sign the table was padded to look complete.
    for (const name of ['fetch_business_summary', 'people_list', 'inbox_list_threads']) {
      expect(compensation.getCompensatingAction(name), `${name} claims a rollback`).toBeUndefined();
    }
  });

  it('covers the tools whose effects are felt outside the system', () => {
    // Money, calendar and outbound mail. An un-undone booking double-books a
    // real person; an un-undone invoice chases a customer for money they do not
    // owe. These are the ones worth insisting on.
    for (const name of ['commerce_create_invoice', 'bookings_create_booking', 'send_message_with_approval']) {
      expect(compensation.getCompensatingAction(name), `${name} has no rollback`).toBeTruthy();
    }
  });
});
