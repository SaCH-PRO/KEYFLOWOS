import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { KeyCortexPlannerService, SYSTEM_PLAN_ACTOR } from './key-cortex-planner.service';
import { PlannerService } from '../ai/planner.service';
import { AiUsageService } from '../ai/ai-usage.service';
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
  let aiUsage: AiUsageService;

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
    aiUsage = {
      callAi: vi.fn(),
    } as unknown as AiUsageService;

    service = new KeyCortexPlannerService(prisma, planner, executor, saga, aiUsage);
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

  it('generates a plan with deterministic fallback decomposition', async () => {
    const plan = await service.generatePlan('biz_1', { objective: 'send invoice to customer' });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.simulationResult?.successProbability).toBeGreaterThan(0);
    expect(plan.steps.some((s) => s.action.includes('invoice'))).toBe(true);
  });

  it('simulates a plan with score range based on risk', () => {
    const simulation = service.simulatePlan(
      [
        { order: 1, action: 'low_risk', riskTier: 1 },
        { order: 2, action: 'high_risk', riskTier: 3, dependsOn: [1] },
      ],
      { objective: 'test' },
    );
    expect(simulation.successProbability).toBeGreaterThanOrEqual(0);
    expect(simulation.successProbability).toBeLessThanOrEqual(1);
    expect(simulation.risks.length).toBe(1);
  });

  it('replanIfNeeded appends recovery steps for failed steps', async () => {
    (prisma.client.aiPlan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan_1',
      objective: 'test',
      steps: [
        { id: 's1', order: 1, status: 'failed', action: 'create_invoice', module: 'commerce', riskTier: 2, errorMessage: 'contact missing' },
        { id: 's2', order: 2, status: 'completed', action: 'list_contacts', module: 'crm', riskTier: 1 },
      ],
    });

    const result = await service.replanIfNeeded('plan_1');
    expect(result).not.toBeNull();
    expect(result!.steps.length).toBe(1);
    expect(result!.steps[0].action).toBe('recover_create_invoice');
    expect(prisma.client.aiPlanStep.create).toHaveBeenCalled();
    expect(prisma.client.aiPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'draft' } }));
  });

  it('replanIfNeeded returns null when no failed steps', async () => {
    (prisma.client.aiPlan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan_1',
      objective: 'test',
      steps: [{ id: 's1', order: 1, status: 'completed', action: 'x', module: 'crm', riskTier: 1 }],
    });

    const result = await service.replanIfNeeded('plan_1');
    expect(result).toBeNull();
  });

  it('creates a plan from a goal and links goalId', async () => {
    const goal = await service.createGoal('biz_1', { title: 'Collect overdue invoices' });
    (planner.createPlan as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan_1',
      objective: goal.title,
      steps: [],
    });
    (prisma.client.aiPlan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'plan_1', goalId: goal.id, steps: [] });

    const plan = await service.createPlanFromGoal('biz_1', goal.id);
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

/**
 * R0-09e-KEY-PLAN-ACTOR (R0-09c review ST-5 / CR-2). executePlan built every
 * step's command as `plan.userId ?? 'key_cortex'` and took no executing member,
 * so whoever named the OWNER as a plan's userId ran its steps as the OWNER, and
 * any member ran any plan. Pinned here: with a member (the HTTP route) the plan
 * is read in the member's tenant only, the member must be its creator, the
 * business OWNER (OWNER membership or Business.ownerId) or SUPER_ADMIN, and
 * every step runs as that executing member; with no member (a system trigger) a
 * member's plan runs as that member and only a plan no member created runs as
 * SYSTEM_PLAN_ACTOR ('key_cortex'). The executePlan cases above run with no
 * member (the system path) and are unchanged.
 */
describe('KeyCortexPlannerService.executePlan — the executing member (R0-09e, review ST-5 / CR-2)', () => {
  const STAFF = 'user_staff';
  const OWNER = 'user_owner';
  const planSteps = () => [
    { id: 's1', order: 1, module: 'settings', action: 'update_business_profile', inputPayload: { name: 'x' }, toolName: 'settings.update_business_profile', dependsOn: [] },
    { id: 's2', order: 2, module: 'crm', action: 'list_contacts', inputPayload: {}, toolName: 'crm.list_contacts', dependsOn: [] },
  ];
  let prisma: any;
  let executor: any;
  let service: KeyCortexPlannerService;

  function build(plan: Record<string, unknown>, memberships: Record<string, string> = {}, ownerId = OWNER) {
    prisma = {
      client: {
        aiPlan: {
          findFirst: vi.fn(async ({ where }: any) => (where.id === plan.id && where.businessId === plan.businessId ? { ...plan, steps: planSteps() } : null)),
          findUnique: vi.fn(async ({ where }: any) => (where.id === plan.id ? { ...plan, steps: planSteps() } : null)),
          update: vi.fn(async () => ({})),
        },
        aiPlanStep: { update: vi.fn(async () => ({})) },
        aiPlanResult: { upsert: vi.fn(async () => ({})) },
        membership: {
          findUnique: vi.fn(async ({ where }: any) => {
            const role = memberships[where.userId_businessId.userId];
            return role && where.userId_businessId.businessId === 'biz_1' ? { role } : null;
          }),
        },
        business: {
          findFirst: vi.fn(async ({ where }: any) => (where.id === 'biz_1' && where.ownerId === ownerId ? { id: 'biz_1' } : null)),
        },
      },
    };
    executor = { execute: vi.fn(async () => ({ result: { success: true, data: {} }, durationMs: 1 })) };
    const sagaStub = {
      start: vi.fn(async () => ({ id: 'saga_1' })),
      addStep: vi.fn(), completeStep: vi.fn(), failStep: vi.fn(), compensate: vi.fn(), completeSaga: vi.fn(), failSaga: vi.fn(),
    };
    service = new KeyCortexPlannerService(prisma, { createPlan: vi.fn() } as any, executor, sagaStub as any);
  }
  const actorsRun = () => executor.execute.mock.calls.map((c: any[]) => c[0].userId);

  it("RED-BEFORE: every step runs as the EXECUTING member, never as the plan's creator: the OWNER running a STAFF member's plan runs it as the OWNER", async () => {
    build({ id: 'plan_1', businessId: 'biz_1', userId: STAFF }, { [OWNER]: 'OWNER', [STAFF]: 'STAFF' });
    const result = await service.executePlan('plan_1', {}, { userId: OWNER, role: 'USER', businessId: 'biz_1' });
    expect(result.status).toBe('completed');
    expect(actorsRun()).toEqual([OWNER, OWNER]);
  });

  it('the creator runs its own plan as itself', async () => {
    build({ id: 'plan_1', businessId: 'biz_1', userId: STAFF }, { [STAFF]: 'STAFF' });
    await service.executePlan('plan_1', {}, { userId: STAFF, role: 'USER', businessId: 'biz_1' });
    expect(actorsRun()).toEqual([STAFF, STAFF]);
  });

  it("RED-BEFORE: a member who is neither the creator, the OWNER (membership or Business.ownerId) nor SUPER_ADMIN is refused 403 before the plan starts, on another member's plan and on a plan no member created", async () => {
    for (const userId of [OWNER, null]) {
      build({ id: 'plan_1', businessId: 'biz_1', userId }, { [STAFF]: 'STAFF', user_admin: 'ADMIN' }, 'someone_else');
      for (const member of [STAFF, 'user_admin']) {
        await expect(service.executePlan('plan_1', {}, { userId: member, role: 'USER', businessId: 'biz_1' })).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(prisma.client.aiPlan.update).not.toHaveBeenCalled();
      expect(executor.execute).not.toHaveBeenCalled();
    }
  });

  it('RED-BEFORE: the OWNER membership, the Business.ownerId owner and SUPER_ADMIN may run a plan no member created, each as itself', async () => {
    for (const [userId, role, memberships, ownerId] of [
      ['user_owner_member', 'USER', { user_owner_member: 'OWNER' }, 'someone_else'],
      ['user_owner_id', 'USER', {}, 'user_owner_id'],
      ['user_super', 'SUPER_ADMIN', {}, 'someone_else'],
    ] as const) {
      build({ id: 'plan_1', businessId: 'biz_1', userId: null }, memberships as Record<string, string>, ownerId);
      const result = await service.executePlan('plan_1', {}, { userId, role, businessId: 'biz_1' });
      expect(result.status, userId).toBe('completed');
      expect(actorsRun(), userId).toEqual([userId, userId]);
    }
  });

  it("RED-BEFORE: a member's execution reads the plan in the member's checked tenant only: another tenant's plan is not found and nothing runs", async () => {
    build({ id: 'plan_1', businessId: 'biz_1', userId: STAFF });
    await expect(service.executePlan('plan_1', {}, { userId: STAFF, role: 'USER', businessId: 'biz_2' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.aiPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'plan_1', businessId: 'biz_2' } }));
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("with no member (a system trigger), a member's plan runs as that member and a plan no member created runs as the system actor 'key_cortex'", async () => {
    build({ id: 'plan_1', businessId: 'biz_1', userId: STAFF });
    await service.executePlan('plan_1');
    expect(actorsRun()).toEqual([STAFF, STAFF]);

    build({ id: 'plan_1', businessId: 'biz_1', userId: null });
    await service.executePlan('plan_1');
    expect(actorsRun()).toEqual(['key_cortex', 'key_cortex']);
  });

  it('SYSTEM_PLAN_ACTOR names that system actor', () => {
    expect(SYSTEM_PLAN_ACTOR).toBe('key_cortex');
  });
});
