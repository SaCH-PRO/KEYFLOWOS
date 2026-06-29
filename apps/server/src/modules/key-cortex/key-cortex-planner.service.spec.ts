import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexPlannerService } from './key-cortex-planner.service';
import { PlannerService } from '../ai/planner.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const mkPrisma = () => {
  const store: {
    goals: any[];
    plans: any[];
    steps: any[];
    results: any[];
    sagas: any[];
  } = { goals: [], plans: [], steps: [], results: [], sagas: [] };

  return {
    client: {
      aiGoal: {
        create: vi.fn(async (args: any) => {
          const row = { id: `goal_${store.goals.length + 1}`, ...args.data };
          store.goals.push(row);
          return row;
        }),
        findMany: vi.fn(async (args: any) =>
          store.goals.filter((g) => g.businessId === args.where.businessId && (args.where.status ? g.status === args.where.status : true)),
        ),
        findFirst: vi.fn(async (args: any) =>
          store.goals.find((g) => g.id === args.where.id && g.businessId === args.where.businessId),
        ),
        findUnique: vi.fn(async (args: any) => store.goals.find((g) => g.id === args.where.id)),
      },
      aiPlan: {
        create: vi.fn(),
        findUnique: vi.fn(async (args: any) => {
          const plan = store.plans.find((p) => p.id === args.where.id);
          if (!plan) return null;
          return { ...plan, steps: store.steps.filter((s) => s.planId === plan.id) };
        }),
        update: vi.fn(async (args: any) => {
          const plan = store.plans.find((p) => p.id === args.where.id);
          if (plan) Object.assign(plan, args.data);
          return plan;
        }),
      },
      aiPlanStep: {
        create: vi.fn(),
        update: vi.fn(async (args: any) => {
          const step = store.steps.find((s) => s.id === args.where.id);
          if (step) Object.assign(step, args.data);
          return step;
        }),
      },
      aiPlanResult: {
        upsert: vi.fn(async (args: any) => {
          const existing = store.results.find((r) => r.planId === args.where.planId);
          const row = { id: existing?.id ?? `res_${store.results.length + 1}`, ...args.create, ...args.update };
          if (existing) Object.assign(existing, row);
          else store.results.push(row);
          return row;
        }),
      },
      sagaExecution: {
        create: vi.fn(async (args: any) => {
          const row = { id: `saga_${store.sagas.length + 1}`, ...args.data };
          store.sagas.push(row);
          return row;
        }),
        update: vi.fn(),
      },
      sagaStep: {
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    },
    store,
  } as unknown as PrismaService;
};

describe('KeyCortexPlannerService', () => {
  let service: KeyCortexPlannerService;
  let prisma: PrismaService;
  let planner: PlannerService;
  let executor: KeyCortexExecutorService;
  let saga: KeyCortexSagaService;

  beforeEach(() => {
    prisma = mkPrisma();
    planner = {
      createPlan: vi.fn(),
    } as unknown as PlannerService;
    executor = {
      execute: vi.fn(),
    } as unknown as KeyCortexExecutorService;
    saga = {
      start: vi.fn(),
      addStep: vi.fn(),
      completeStep: vi.fn(),
      failStep: vi.fn(),
      compensate: vi.fn(),
      completeSaga: vi.fn(),
      failSaga: vi.fn(),
    } as unknown as KeyCortexSagaService;

    service = new KeyCortexPlannerService(prisma, planner, executor, saga);
  });

  it('creates a goal', async () => {
    const result = await service.createGoal('biz_1', { title: 'Follow up invoices', priority: 1 });
    expect(result.title).toBe('Follow up invoices');
    expect(result.priority).toBe(1);
  });

  it('lists goals by business', async () => {
    await service.createGoal('biz_1', { title: 'A' });
    await service.createGoal('biz_2', { title: 'B' });
    const goals = await service.listGoals('biz_1');
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toBe('A');
  });

  it('creates a plan from a goal and links goalId', async () => {
    const goal = await service.createGoal('biz_1', { title: 'Collect overdue invoices' });
    (planner.createPlan as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan_1',
      objective: goal.title,
      steps: [],
    });
    (prisma.client.aiPlan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'plan_1', goalId: goal.id, steps: [] });

    const plan = await service.createPlanFromGoal(goal.id);
    expect(planner.createPlan).toHaveBeenCalledWith('biz_1', expect.objectContaining({ objective: expect.stringContaining('Collect overdue invoices') }), undefined);
    expect(prisma.client.aiPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ goalId: goal.id }) }));
    expect(plan).toEqual({ id: 'plan_1', goalId: goal.id, steps: [] });
  });

  it('executes a plan and records result on completion', async () => {
    const steps = [
      { id: 's1', order: 1, module: 'crm', action: 'list_contacts', inputPayload: {}, toolName: 'crm.list_contacts', dependsOn: [] },
      { id: 's2', order: 2, module: 'commerce', action: 'list_invoices', inputPayload: {}, toolName: 'commerce.list_invoices', dependsOn: [] },
    ];
    (prisma.client.aiPlan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan_1',
      businessId: 'biz_1',
      userId: 'user_1',
      status: 'pending',
      steps,
    });
    (saga.start as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'saga_1' });
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { success: true, data: [{ id: 'c1' }] },
      durationMs: 10,
    });

    const result = await service.executePlan('plan_1');
    expect(result.status).toBe('completed');
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(prisma.client.aiPlanResult.upsert).toHaveBeenCalled();
  });

  it('stops plan and compensates on step failure', async () => {
    const steps = [
      { id: 's1', order: 1, module: 'crm', action: 'list_contacts', inputPayload: {}, toolName: 'crm.list_contacts', dependsOn: [] },
      { id: 's2', order: 2, module: 'commerce', action: 'list_invoices', inputPayload: {}, toolName: 'commerce.list_invoices', dependsOn: [] },
    ];
    (prisma.client.aiPlan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan_1',
      businessId: 'biz_1',
      userId: 'user_1',
      status: 'pending',
      steps,
    });
    (saga.start as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'saga_1' });
    (executor.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ result: { success: true, data: [] }, durationMs: 10 })
      .mockResolvedValueOnce({ result: { success: false, error: 'boom' }, durationMs: 10 });

    const result = await service.executePlan('plan_1');
    expect(result.status).toBe('failed');
    expect(saga.compensate).toHaveBeenCalledWith('saga_1');
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });
});
