import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventBusService, KeyCortexEvent } from './key-cortex-event-bus.service';
import { KeyCortexPlannerService } from './key-cortex-planner.service';
import type { KeyCortexTriggerRule } from '@prisma/client';

export interface CreateTriggerRuleInput {
  businessId: string;
  eventType: string;
  filterJson?: Record<string, unknown>;
  goalTemplateId?: string;
  cooldownMinutes?: number;
  maxDailyFirings?: number;
  enabled?: boolean;
}

export type UpdateTriggerRuleInput = Partial<Omit<CreateTriggerRuleInput, 'businessId'>>;

interface FiringState {
  lastFiredAt: Date;
  dailyCount: number;
  dateKey: string;
}

@Injectable()
export class KeyCortexTriggerService implements OnModuleInit {
  private readonly logger = new Logger(KeyCortexTriggerService.name);
  private readonly firingState = new Map<string, FiringState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: KeyCortexEventBusService,
    @Optional() private readonly planner?: KeyCortexPlannerService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribeAll((event) => this.handleEvent(event));
    this.logger.log('[trigger] Subscribed to all KEY Cortex events');
  }

  async listRules(businessId: string): Promise<KeyCortexTriggerRule[]> {
    return this.prisma.client.keyCortexTriggerRule.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRule(input: CreateTriggerRuleInput): Promise<KeyCortexTriggerRule> {
    return this.prisma.client.keyCortexTriggerRule.create({
      data: {
        businessId: input.businessId,
        eventType: input.eventType,
        filterJson: input.filterJson as any,
        goalTemplateId: input.goalTemplateId,
        cooldownMinutes: input.cooldownMinutes ?? 60,
        maxDailyFirings: input.maxDailyFirings ?? 5,
        enabled: input.enabled ?? true,
      },
    });
  }

  async updateRule(
    businessId: string,
    id: string,
    input: UpdateTriggerRuleInput,
  ): Promise<KeyCortexTriggerRule> {
    return this.prisma.client.keyCortexTriggerRule.update({
      where: { id, businessId },
      data: {
        eventType: input.eventType,
        filterJson: input.filterJson as any,
        goalTemplateId: input.goalTemplateId,
        cooldownMinutes: input.cooldownMinutes,
        maxDailyFirings: input.maxDailyFirings,
        enabled: input.enabled,
      },
    });
  }

  async deleteRule(businessId: string, id: string): Promise<void> {
    await this.prisma.client.keyCortexTriggerRule.delete({ where: { id, businessId } });
  }

  private async handleEvent(event: KeyCortexEvent): Promise<void> {
    const rules = await this.prisma.client.keyCortexTriggerRule.findMany({
      where: {
        businessId: event.businessId,
        eventType: event.type,
        enabled: true,
      },
    });

    for (const rule of rules) {
      try {
        if (!this.ruleMatches(event, rule)) continue;
        if (!this.withinCooldown(rule)) continue;
        if (!this.withinDailyLimit(rule)) continue;

        await this.fireRule(rule, event);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[trigger] Rule ${rule.id} failed for ${event.type}: ${msg}`);
      }
    }
  }

  private ruleMatches(event: KeyCortexEvent, rule: KeyCortexTriggerRule): boolean {
    if (!rule.filterJson) return true;
    const filter = rule.filterJson as Record<string, unknown>;
    return this.evaluateFilter(event.payload, filter);
  }

  private evaluateFilter(payload: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      const actual = payload[key];
      if (typeof expected === 'object' && expected !== null) {
        const op = expected as Record<string, unknown>;
        if ('eq' in op && actual !== op.eq) return false;
        if ('neq' in op && actual === op.neq) return false;
        if ('gt' in op && !(typeof actual === 'number' && actual > (op.gt as number))) return false;
        if ('gte' in op && !(typeof actual === 'number' && actual >= (op.gte as number))) return false;
        if ('lt' in op && !(typeof actual === 'number' && actual < (op.lt as number))) return false;
        if ('lte' in op && !(typeof actual === 'number' && actual <= (op.lte as number))) return false;
        if ('contains' in op && !(typeof actual === 'string' && actual.includes(op.contains as string))) return false;
      } else if (actual !== expected) {
        return false;
      }
    }
    return true;
  }

  private withinCooldown(rule: KeyCortexTriggerRule): boolean {
    const state = this.firingState.get(rule.id);
    if (!state) return true;
    const cooldownMs = (rule.cooldownMinutes ?? 60) * 60 * 1000;
    return Date.now() - state.lastFiredAt.getTime() >= cooldownMs;
  }

  private withinDailyLimit(rule: KeyCortexTriggerRule): boolean {
    const today = this.dateKey(new Date());
    const state = this.firingState.get(rule.id);
    if (!state || state.dateKey !== today) return true;
    return state.dailyCount < (rule.maxDailyFirings ?? 5);
  }

  private async fireRule(rule: KeyCortexTriggerRule, event: KeyCortexEvent): Promise<void> {
    this.recordFiring(rule.id);

    const title = `Triggered goal from ${rule.eventType}`;
    const description = `Auto-created goal from rule ${rule.id} after event ${event.id}`;

    if (!this.planner) {
      this.logger.warn(`[trigger] No planner available; skipping goal creation for rule ${rule.id}`);
      return;
    }

    const goal = await this.planner.createGoal(rule.businessId, {
      title,
      description,
      priority: 1,
    });

    this.logger.log(`[trigger] Created goal ${goal.id} from rule ${rule.id}`);

    if (rule.goalTemplateId) {
      const plan = await this.planner.createPlanFromGoal(goal.id, event.userId);
      if (plan?.id) {
        await this.planner.executePlan(plan.id, { traceId: event.metadata?.correlationId });
      }
    }
  }

  private recordFiring(ruleId: string): void {
    const today = this.dateKey(new Date());
    const state = this.firingState.get(ruleId);
    if (!state || state.dateKey !== today) {
      this.firingState.set(ruleId, { lastFiredAt: new Date(), dailyCount: 1, dateKey: today });
    } else {
      state.lastFiredAt = new Date();
      state.dailyCount += 1;
    }
  }

  private dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
