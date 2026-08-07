import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexTriggerService } from './key-cortex-trigger.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { KeyCortexPlannerService } from './key-cortex-planner.service';

function createMockPrisma(rules: any[] = []) {
  return {
    client: {
      keyCortexTriggerRule: {
        findMany: vi.fn().mockResolvedValue(rules),
        create: vi.fn(async ({ data }: any) => ({ id: 'rule_1', ...data, createdAt: new Date(), updatedAt: new Date() })),
        update: vi.fn(async ({ data }: any) => ({ id: 'rule_1', ...data, createdAt: new Date(), updatedAt: new Date() })),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

function createEventBus() {
  const handlers = new Set<(event: any) => void | Promise<void>>();
  return {
    subscribeAll: vi.fn((handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }),
    publish: vi.fn(async (event: any) => {
      for (const handler of handlers) {
        await handler(event);
      }
      return event;
    }),
    handlers,
  };
}

describe('KeyCortexTriggerService', () => {
  let service: KeyCortexTriggerService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventBus: ReturnType<typeof createEventBus>;
  let planner: Pick<KeyCortexPlannerService, 'createGoal' | 'createPlanFromGoal' | 'executePlan'>;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventBus = createEventBus();
    planner = {
      // createGoal returns a full AiGoal row; the businessId on it is what
      // scopes the plan lookup that follows.
      createGoal: vi.fn().mockResolvedValue({ id: 'goal_1', businessId: 'biz_1' }),
      createPlanFromGoal: vi.fn().mockResolvedValue({ id: 'plan_1' }),
      executePlan: vi.fn().mockResolvedValue({ status: 'completed' }),
    };
    service = new KeyCortexTriggerService(
      prisma as any,
      eventBus as unknown as KeyCortexEventBusService,
      planner as unknown as KeyCortexPlannerService,
    );
  });

  it('subscribes to all events on init', () => {
    service.onModuleInit();
    expect(eventBus.subscribeAll).toHaveBeenCalled();
  });

  it('creates a rule', async () => {
    const rule = await service.createRule({
      businessId: 'b1',
      eventType: 'invoice.overdue',
      enabled: true,
    });
    expect(rule.businessId).toBe('b1');
    expect(rule.eventType).toBe('invoice.overdue');
  });

  it('fires rule and creates goal when event matches', async () => {
    prisma.client.keyCortexTriggerRule.findMany.mockResolvedValue([
      {
        id: 'rule_1',
        businessId: 'b1',
        eventType: 'invoice.overdue',
        filterJson: null,
        goalTemplateId: 'template_1',
        cooldownMinutes: 0,
        maxDailyFirings: 5,
        enabled: true,
      },
    ]);

    await service.onModuleInit();
    await eventBus.publish({
      source: 'watcher',
      type: 'invoice.overdue',
      businessId: 'b1',
      payload: { invoiceId: 'i1' },
      metadata: {},
    });

    expect(planner.createGoal).toHaveBeenCalledWith('b1', expect.objectContaining({ title: expect.stringContaining('Triggered goal') }));
    expect(planner.createPlanFromGoal).toHaveBeenCalledWith('biz_1', 'goal_1', undefined);
    expect(planner.executePlan).toHaveBeenCalledWith('plan_1', { traceId: undefined });
  });

  it('respects cooldown', async () => {
    prisma.client.keyCortexTriggerRule.findMany.mockResolvedValue([
      {
        id: 'rule_1',
        businessId: 'b1',
        eventType: 'invoice.overdue',
        filterJson: null,
        goalTemplateId: null,
        cooldownMinutes: 60,
        maxDailyFirings: 5,
        enabled: true,
      },
    ]);

    await service.onModuleInit();
    await eventBus.publish({ source: 'watcher', type: 'invoice.overdue', businessId: 'b1', payload: {}, metadata: {} });
    await eventBus.publish({ source: 'watcher', type: 'invoice.overdue', businessId: 'b1', payload: {}, metadata: {} });

    expect(planner.createGoal).toHaveBeenCalledTimes(1);
  });

  it('respects daily firing limit', async () => {
    prisma.client.keyCortexTriggerRule.findMany.mockResolvedValue([
      {
        id: 'rule_1',
        businessId: 'b1',
        eventType: 'invoice.overdue',
        filterJson: null,
        goalTemplateId: null,
        cooldownMinutes: 0,
        maxDailyFirings: 2,
        enabled: true,
      },
    ]);

    await service.onModuleInit();
    await eventBus.publish({ source: 'watcher', type: 'invoice.overdue', businessId: 'b1', payload: {}, metadata: {} });
    await eventBus.publish({ source: 'watcher', type: 'invoice.overdue', businessId: 'b1', payload: {}, metadata: {} });
    await eventBus.publish({ source: 'watcher', type: 'invoice.overdue', businessId: 'b1', payload: {}, metadata: {} });

    expect(planner.createGoal).toHaveBeenCalledTimes(2);
  });

  it('evaluates filterJson operators', async () => {
    prisma.client.keyCortexTriggerRule.findMany.mockResolvedValue([
      {
        id: 'rule_1',
        businessId: 'b1',
        eventType: 'invoice.overdue',
        filterJson: { daysOverdue: { gt: 5 }, total: { gte: 100 } },
        goalTemplateId: null,
        cooldownMinutes: 0,
        maxDailyFirings: 5,
        enabled: true,
      },
    ]);

    await service.onModuleInit();
    await eventBus.publish({
      source: 'watcher',
      type: 'invoice.overdue',
      businessId: 'b1',
      payload: { daysOverdue: 10, total: 150 },
      metadata: {},
    });
    await eventBus.publish({
      source: 'watcher',
      type: 'invoice.overdue',
      businessId: 'b1',
      payload: { daysOverdue: 2, total: 150 },
      metadata: {},
    });

    expect(planner.createGoal).toHaveBeenCalledTimes(1);
  });
});
