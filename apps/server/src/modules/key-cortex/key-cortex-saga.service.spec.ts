import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexSagaService } from './key-cortex-saga.service';

function createMockClient() {
  const sagas: any[] = [];
  const steps: any[] = [];

  return {
    sagas,
    steps,
    sagaExecution: {
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: 'saga_1', createdAt: new Date() };
        sagas.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = sagas.find((s) => s.id === where.id);
        if (!row) throw new Error('Not found');
        Object.assign(row, data);
        return row;
      }),
    },
    sagaStep: {
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: `step_${steps.length + 1}`, createdAt: new Date() };
        steps.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = steps.filter((s) => {
          if (where.id) return s.id === where.id;
          return s.sagaId === where.sagaId && s.stepIndex === where.stepIndex;
        });
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      }),
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        const filtered = steps.filter((s) => s.sagaId === where.sagaId);
        if (orderBy?.stepIndex === 'desc') return filtered.sort((a, b) => b.stepIndex - a.stepIndex);
        return filtered;
      }),
    },
  };
}

describe('KeyCortexSagaService', () => {
  let service: KeyCortexSagaService;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    service = new KeyCortexSagaService({ client } as any);
  });

  it('starts a saga in running state', async () => {
    const saga = await service.start({
      businessId: 'biz_1',
      sagaType: 'invoice.create',
      correlationId: 'corr_1',
    });

    expect(saga.status).toBe('running');
    expect(saga.sagaType).toBe('invoice.create');
    expect(client.sagas).toHaveLength(1);
  });

  it('adds steps and records completion', async () => {
    const saga = await service.start({ businessId: 'biz_1', sagaType: 'invoice.create' });
    await service.addStep(saga.id, 1, 'create_draft', { amount: 100 });
    await service.completeStep(saga.id, 1, { invoiceId: 'inv_1' });

    const step = client.steps[0];
    expect(step.status).toBe('completed');
    expect(step.output).toEqual({ invoiceId: 'inv_1' });
  });

  it('fails a saga and records step error', async () => {
    const saga = await service.start({ businessId: 'biz_1', sagaType: 'invoice.create' });
    await service.addStep(saga.id, 1, 'charge_card', { amount: 100 });
    await service.failStep(saga.id, 1, 'Card declined');
    await service.failSaga(saga.id);

    const step = client.steps[0];
    expect(step.status).toBe('failed');
    expect(step.error).toBe('Card declined');
    expect(client.sagas[0].status).toBe('failed');
  });

  it('compensates completed steps in reverse order', async () => {
    const saga = await service.start({ businessId: 'biz_1', sagaType: 'invoice.create' });
    await service.addStep(saga.id, 1, 'create_draft', { amount: 100 }, {
      stepName: 'create_draft',
      action: 'delete_draft',
      payload: { invoiceId: 'inv_1' },
    });
    await service.completeStep(saga.id, 1, { invoiceId: 'inv_1' });

    await service.addStep(saga.id, 2, 'charge_card', { amount: 100 }, {
      stepName: 'charge_card',
      action: 'refund',
      payload: { transactionId: 'tx_1' },
    });
    await service.completeStep(saga.id, 2, { transactionId: 'tx_1' });

    const results = await service.compensate(saga.id);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(client.sagas[0].status).toBe('compensated');
    expect(client.steps.every((s) => s.status === 'compensated')).toBe(true);
  });
});

describe('a saga does not claim it rolled back when it did not', () => {
  it('records compensation_unavailable when no step declared a compensation', async () => {
    // Every real saga hits this. The planner registers steps without a
    // compensation argument, no tool declares one, and the only path that
    // builds them has zero callers — so the loop skips every step and used to
    // write status:'compensated' anyway. A durable audit claim that a recovery
    // happened.
    const updated: any[] = [];
    const prisma = {
      client: {
        sagaStep: {
          findMany: vi.fn(async () => [
            { id: 's1', stepIndex: 0, stepName: 'create', compensationAction: null },
            { id: 's2', stepIndex: 1, stepName: 'send', compensationAction: null },
          ]),
          updateMany: vi.fn(async () => ({})),
        },
        sagaExecution: {
          update: vi.fn(async ({ data }: any) => {
            updated.push(data);
            return {};
          }),
        },
      },
    } as never;

    const svc = new KeyCortexSagaService(prisma, undefined as never);
    const results = await svc.compensate('saga_1');

    expect(results).toEqual([]);
    expect(updated[0].status).toBe('compensation_unavailable');
    expect(updated[0].status).not.toBe('compensated');
  });

  it('still says compensated when something genuinely was', async () => {
    const updated: any[] = [];
    const prisma = {
      client: {
        sagaStep: {
          findMany: vi.fn(async () => [
            {
              id: 's1', stepIndex: 0, stepName: 'create',
              compensationAction: { action: 'crm.create_contact', payload: { businessId: 'b1' } },
            },
          ]),
          updateMany: vi.fn(async () => ({})),
        },
        sagaExecution: { update: vi.fn(async ({ data }: any) => { updated.push(data); return {}; }) },
      },
    } as never;
    const compensation = { compensate: vi.fn(async () => ({ compensated: true })) } as never;

    const svc = new KeyCortexSagaService(prisma, compensation);
    await svc.compensate('saga_1');

    expect(updated[0].status).toBe('compensated');
  });
});
