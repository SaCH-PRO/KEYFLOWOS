import { BadRequestException, NotFoundException } from '@nestjs/common';
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
      const result = await controller.createGoal(dto);
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

    it('deletes a goal', async () => {
      const result = await controller.deleteGoal('goal_1', 'biz_1');
      expect((prisma.client as any).aiGoal.findFirst).toHaveBeenCalledWith({
        where: { id: 'goal_1', businessId: 'biz_1' },
      });
      expect((prisma.client as any).aiGoal.delete).toHaveBeenCalledWith({ where: { id: 'goal_1' } });
      expect(result).toEqual({ success: true });
    });

    it('throws when deleting a missing goal', async () => {
      (prisma.client as any).aiGoal.findFirst = vi.fn().mockResolvedValueOnce(null);
      await expect(controller.deleteGoal('missing', 'biz_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('plans', () => {
    it('creates a plan from a goal', async () => {
      const result = await controller.createPlanFromGoal('goal_1', {});
      expect(planner.createPlanFromGoal).toHaveBeenCalledWith('goal_1', undefined);
      expect(result).toEqual(mockPlan);
    });

    it('creates a plan from a command', async () => {
      const dto = { businessId: 'biz_1', objective: 'Invoice all clients', modules: ['commerce'] };
      const result = await controller.createPlanFromCommand(dto as any);
      expect(planner.createPlanFromCommand).toHaveBeenCalledWith('biz_1', expect.objectContaining(dto), undefined);
      expect(result).toEqual(mockPlan);
    });

    it('executes a plan', async () => {
      const result = await controller.executePlan('plan_1', { traceId: 'trace_1' });
      expect(planner.executePlan).toHaveBeenCalledWith('plan_1', { traceId: 'trace_1' });
      expect(result.status).toBe('completed');
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
      const result = await controller.updateTriggerRule('rule_1', dto as any);
      expect(triggerService.updateRule).toHaveBeenCalledWith('biz_1', 'rule_1', dto);
      expect(result).toEqual(expect.objectContaining({ enabled: false }));
    });
  });
});
