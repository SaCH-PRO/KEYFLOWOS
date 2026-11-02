import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { KeyCortexGoalsController } from './key-cortex-goals.controller';
import { KeyCortexPlannerService } from './key-cortex-planner.service';
import { KeyCortexTriggerService } from './key-cortex-trigger.service';
import { PrismaService } from '../../core/prisma/prisma.service';

describe('KeyCortexGoalsController', () => {
  let controller: KeyCortexGoalsController;
  let planner: Partial<KeyCortexPlannerService>;
  let triggerService: Partial<KeyCortexTriggerService>;
  let prisma: Partial<PrismaService>;

  const mockGoal = {
    id: 'goal_1',
    businessId: 'biz_1',
    title: 'Increase revenue',
    description: 'Test goal',
    status: 'ACTIVE',
    priority: 1,
  };

  const mockPlan = {
    id: 'plan_1',
    businessId: 'biz_1',
    objective: 'Increase revenue',
    status: 'pending',
    steps: [{ id: 'step_1', action: 'create_invoice', module: 'commerce', status: 'pending' }],
  };

  beforeEach(() => {
    planner = {
      createGoal: vi.fn().mockResolvedValue(mockGoal),
      listGoals: vi.fn().mockResolvedValue([mockGoal]),
      getGoal: vi.fn().mockResolvedValue({ ...mockGoal, plans: [mockPlan] }),
      createPlanFromGoal: vi.fn().mockResolvedValue(mockPlan),
      deleteGoal: vi.fn().mockResolvedValue({ success: true, deletedId: 'goal_1' }),
      createPlanFromCommand: vi.fn().mockResolvedValue(mockPlan),
      getPlan: vi.fn().mockResolvedValue(mockPlan),
      executePlan: vi.fn().mockResolvedValue({ planId: 'plan_1', status: 'completed', executed: 1, sagaId: 'saga_1' }),
    };

    triggerService = {
      listRules: vi.fn().mockResolvedValue([]),
      createRule: vi.fn().mockResolvedValue({ id: 'rule_1' }),
      updateRule: vi.fn().mockResolvedValue({ id: 'rule_1', enabled: false }),
    };

    prisma = {
      client: {
        aiGoal: {
          findFirst: vi.fn().mockResolvedValue(mockGoal),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      } as any,
    };

    controller = new KeyCortexGoalsController(
      planner as KeyCortexPlannerService,
      triggerService as KeyCortexTriggerService,
      prisma as PrismaService,
    );
  });

  describe('goals', () => {
    it('creates a goal', async () => {
      const dto = { businessId: 'biz_1', title: 'Increase revenue', description: 'Test' };
      // The second argument is the tenant @GuardedBusinessId() resolves (the body's, here).
      const result = await controller.createGoal(dto, 'biz_1');
      expect(planner.createGoal).toHaveBeenCalledWith('biz_1', expect.objectContaining({ title: 'Increase revenue' }));
      expect(result).toEqual(mockGoal);
    });

    it('rejects goal creation without businessId or title', async () => {
      await expect(controller.createGoal({ businessId: '', title: '' } as any)).rejects.toThrow(BadRequestException);
    });

    it('lists goals', async () => {
      const result = await controller.listGoals('biz_1');
      expect(planner.listGoals).toHaveBeenCalledWith('biz_1', undefined);
      expect(result).toEqual([mockGoal]);
    });

    it('requires businessId to list goals', async () => {
      await expect(controller.listGoals('')).rejects.toThrow(BadRequestException);
    });

    it('gets a goal with plans', async () => {
      const result = await controller.getGoal('goal_1', 'biz_1');
      expect(planner.getGoal).toHaveBeenCalledWith('biz_1', 'goal_1');
      expect(result).toEqual(expect.objectContaining({ id: 'goal_1', plans: [mockPlan] }));
    });

    it('deletes a goal through the planner, scoped to the business', async () => {
      // The findFirst + delete used to live in this controller. It moved to
      // KeyCortexPlannerService so the HTTP route and the goals_delete tool run
      // the same scoped code — the controller's job is now to insist on a
      // businessId and hand off.
      const result = await controller.deleteGoal('goal_1', 'biz_1');
      expect(planner.deleteGoal).toHaveBeenCalledWith('biz_1', 'goal_1');
      expect(result).toEqual({ success: true, deletedId: 'goal_1' });
    });

    it('refuses to delete without a businessId', async () => {
      await expect(controller.deleteGoal('goal_1', undefined as unknown as string)).rejects.toThrow(
        /businessId is required/,
      );
      expect(planner.deleteGoal).not.toHaveBeenCalled();
    });
  });

  describe('plans', () => {
    // R0-09e: the plan's actor is the authenticated principal (the fourth
    // argument, @CurrentUser()); these three used to expect `undefined` or no
    // actor at all, which is the defect R0-09e closes.
    const member = { id: 'user_1', email: 'user_1@test.local', role: 'USER' };

    it('creates a plan from a goal', async () => {
      const result = await controller.createPlanFromGoal('goal_1', { businessId: 'biz_1' }, 'biz_1', member);
      expect(planner.createPlanFromGoal).toHaveBeenCalledWith('biz_1', 'goal_1', 'user_1');
      expect(result).toEqual(mockPlan);
    });

    it('refuses to build a plan from a goal id with no business attached', async () => {
      // The hole this closes: the route took the goal id straight from the URL
      // and the service resolved it with findUnique on the bare id, so a user of
      // one business could build a plan from another business's goal and read
      // its title and description back in the response.
      await expect(controller.createPlanFromGoal('goal_1', {})).rejects.toThrow(/businessId is required/);
      expect(planner.createPlanFromGoal).not.toHaveBeenCalled();
    });

    it('creates a plan from a command', async () => {
      const dto = { businessId: 'biz_1', objective: 'Invoice all clients', modules: ['commerce'] };
      const result = await controller.createPlanFromCommand(dto as any, 'biz_1', member);
      expect(planner.createPlanFromCommand).toHaveBeenCalledWith('biz_1', expect.objectContaining(dto), 'user_1');
      expect(result).toEqual(mockPlan);
    });

    it('executes a plan', async () => {
      const result = await controller.executePlan('plan_1', { traceId: 'trace_1' }, 'biz_1', member);
      expect(planner.executePlan).toHaveBeenCalledWith('plan_1', { traceId: 'trace_1' }, { userId: 'user_1', role: 'USER', businessId: 'biz_1' });
      expect(result.status).toBe('completed');
    });
  });

  /**
   * R0-09e-KEY-PLAN-ACTOR (R0-09c review ST-5 / CR-2). POST plans and POST
   * goals/:goalId/plans handed the planner the body `userId`, and POST
   * plans/:planId/execute took no actor, so a STAFF member wrote and ran a plan
   * as the OWNER. The actor is the principal AuthGuard admitted
   * (@CurrentUser()); a body userId is ignored, as KeyCortexController does
   * (R0-09c); with no authenticated user the handler answers 401. The
   * real-database half is test/key-cortex-actor-binding.integration.test.ts.
   */
  describe('R0-09e-KEY-PLAN-ACTOR — plan creation and execution act for the authenticated principal (review ST-5 / CR-2)', () => {
    const ME = { id: 'user_staff', email: 'staff@test.local', role: 'USER' };
    const OWNER = 'user_owner';

    it('RED-BEFORE: POST plans and POST goals/:goalId/plans ignore a body userId naming someone else: the planner is handed req.user', async () => {
      await controller.createPlanFromGoal('goal_1', { businessId: 'biz_1', userId: OWNER }, 'biz_1', ME);
      expect(planner.createPlanFromGoal).toHaveBeenCalledWith('biz_1', 'goal_1', ME.id);
      await controller.createPlanFromCommand({ businessId: 'biz_1', objective: 'Rename the business', userId: OWNER } as any, 'biz_1', ME);
      expect((planner.createPlanFromCommand as any).mock.calls[0][2]).toBe(ME.id);
    });

    it('RED-BEFORE: POST plans/:planId/execute hands the planner the executing member (req.user, its role and the guarded tenant)', async () => {
      const admin = { id: 'user_super', role: 'SUPER_ADMIN' };
      await controller.executePlan('plan_1', { skipApproval: false }, 'biz_1', admin);
      expect(planner.executePlan).toHaveBeenCalledWith('plan_1', { traceId: undefined, skipApproval: false }, { userId: 'user_super', role: 'SUPER_ADMIN', businessId: 'biz_1' });
    });

    it('RED-BEFORE: with no authenticated user the three plan routes answer 401 and the planner is not called', async () => {
      await expect(controller.createPlanFromGoal('goal_1', { userId: OWNER }, 'biz_1', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.createPlanFromCommand({ objective: 'x', userId: OWNER } as any, 'biz_1', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.executePlan('plan_1', {}, 'biz_1', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.executePlan('plan_1', {}, 'biz_1', { id: '' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(planner.createPlanFromGoal).not.toHaveBeenCalled();
      expect(planner.createPlanFromCommand).not.toHaveBeenCalled();
      expect(planner.executePlan).not.toHaveBeenCalled();
    });

    it('RED-BEFORE: POST plans/:planId/execute with no guarded tenant is refused 400 before the planner runs', async () => {
      await expect(controller.executePlan('plan_1', {}, undefined as unknown as string, ME)).rejects.toThrow(/businessId is required/);
      expect(planner.executePlan).not.toHaveBeenCalled();
    });

    it("RED-BEFORE: source — no handler reads a request userId, and none falls back to 'key_cortex' or 'system'", async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const code = readFileSync(join(__dirname, 'key-cortex-goals.controller.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code.match(/\b(dto|_dto|options|body|query)\.userId\b/g) ?? []).toEqual([]);
      expect(code.match(/@(Body|Query)\(\s*['"]userId['"]\s*\)/g) ?? []).toEqual([]);
      expect(code.match(/['"](key_cortex|system|key_user)['"]/g) ?? []).toEqual([]);
    });

    it('RED-BEFORE: tsc emits for the three plan handlers exactly the parameter types the real-database suite writes (the body, the guarded tenant, the principal)', async () => {
      const ts = await import('typescript');
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const out = ts.transpileModule(readFileSync(join(__dirname, 'key-cortex-goals.controller.ts'), 'utf8'), {
        compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const paramTypes = (method: string) => {
        const end = out.indexOf(`], KeyCortexGoalsController.prototype, "${method}"`);
        if (end < 0) return undefined;
        return out.slice(out.lastIndexOf('__decorate([', end), end).match(/__metadata\("design:paramtypes", \[([^\]]*)\]/)?.[1].split(/,\s*/);
      };
      // test/key-cortex-actor-binding.integration.test.ts writes these (vitest emits none).
      expect({
        createPlanFromGoal: paramTypes('createPlanFromGoal'),
        createPlanFromCommand: paramTypes('createPlanFromCommand'),
        executePlan: paramTypes('executePlan'),
      }).toEqual({
        createPlanFromGoal: ['String', 'CreatePlanFromGoalDto', 'String', 'Object'],
        createPlanFromCommand: ['CreatePlanFromCommandDto', 'String', 'Object'],
        executePlan: ['String', 'Object', 'String', 'Object'],
      });
    });
  });

  describe('trigger rules', () => {
    it('lists trigger rules', async () => {
      const result = await controller.listTriggerRules('biz_1');
      expect(triggerService.listRules).toHaveBeenCalledWith('biz_1');
      expect(result).toEqual([]);
    });

    it('creates a trigger rule', async () => {
      const dto = { businessId: 'biz_1', eventType: 'invoice_overdue' };
      const result = await controller.createTriggerRule(dto as any);
      expect(triggerService.createRule).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'rule_1' });
    });

    it('updates a trigger rule', async () => {
      const dto = { businessId: 'biz_1', enabled: false };
      const result = await controller.updateTriggerRule('rule_1', dto as any, 'biz_1');
      expect(triggerService.updateRule).toHaveBeenCalledWith('biz_1', 'rule_1', dto);
      expect(result).toEqual(expect.objectContaining({ enabled: false }));
    });
  });
});
