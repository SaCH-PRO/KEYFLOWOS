import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiOversightService } from './ai-oversight.service';
import { PlannerService } from './planner.service';
import { PlanExecutorService } from './plan-executor.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { JourneyOrchestratorService } from './journey-orchestrator.service';

export interface TriggerMatch {
  triggerId: string;
  eventName: string;
  businessId: string;
  objective: string;
  autoExecute: boolean;
  maxRiskTier: number;
  condition?: Record<string, any>;
}

@Injectable()
export class AgentTriggerService implements OnModuleInit {
  private readonly logger = new Logger(AgentTriggerService.name);
  private eventHandlers = new Map<string, Set<string>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(JourneyOrchestratorService) private readonly journeyOrchestrator: JourneyOrchestratorService,
  ) {}

  onModuleInit() {
    // Listen to all events via onAny
    (this.events as any).onAny?.((eventName: string, payload: any) => {
      if (typeof eventName === 'string' && !eventName.startsWith('plan.')) {
        this.handleEvent(eventName, payload).catch((e: unknown) => {
          this.logger.error(`Trigger handler error for ${eventName}: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    });
    this.logger.log('Agent trigger service initialized — listening to all events');
  }

  async handleEvent(eventName: string, payload: any): Promise<void> {
    const businessId = payload?.businessId;
    if (!businessId) return;

    // Find matching triggers
    const triggers = await this.prisma.client.agentTrigger.findMany({
      where: {
        businessId,
        enabled: true,
        eventPattern: eventName,
      },
    });

    // Also trigger journeys for this event
    try {
      await this.journeyOrchestrator.handleEvent(eventName, payload);
    } catch (err) {
      this.logger.error(`Journey orchestration failed for ${eventName}: ${(err as Error).message}`);
    }

    if (triggers.length === 0) return;

    for (const trigger of triggers) {
      try {
        // Evaluate condition if present
        if (trigger.condition && !this.evaluateCondition(trigger.condition as Record<string, any>, payload)) {
          this.logger.debug(`Trigger ${trigger.id} condition not met for ${eventName}`);
          continue;
        }

        // Check daily auto-action limit
        const settings = await this.prisma.client.autopilotSettings.findUnique({
          where: { businessId },
        });
        if (settings) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todayActions = await this.prisma.client.aiExecutionLog.count({
            where: {
              businessId,
              actor: 'ai',
              createdAt: { gte: today },
            },
          });
          if (todayActions >= settings.maxDailyAutoActions) {
            this.logger.warn(`Daily auto-action limit reached for business ${businessId}`);
            continue;
          }
        }

        // Create plan
        const planResult = await this.planner.createPlan(
          businessId,
          {
            objective: trigger.objective,
            rawInput: `Auto-triggered by ${eventName}: ${trigger.name}`,
            urgency: 'normal',
            scope: [trigger.eventPattern],
            modules: [this.inferModule(eventName)],
            maxRiskTier: trigger.maxRiskTier,
            actionCandidates: [],
            missingInfo: [],
            clarificationNeeded: false,
          } as any,
          undefined,
        );
        const plan = planResult ?? null;

        if (!plan) {
          this.logger.warn(`Trigger ${trigger.id} failed to create plan`);
          continue;
        }

        // Auto-approve if enabled and within risk tier
        if (trigger.autoExecute && trigger.maxRiskTier <= 2) {
          const autoDecision = await this.governance.evaluateAutoApproval(
            businessId,
            `trigger_${trigger.eventPattern}`,
            { confidence: 0.85 },
          );
          if (autoDecision.autoApproved) {
            await this.prisma.client.aiPlan.update({
              where: { id: plan.id },
              data: { status: 'approved' },
            });
            this.logger.log(`Auto-approved plan ${plan.id} for trigger ${trigger.id}`);
            // Trigger immediate execution — no 30s polling delay
            this.events.emit('plan.approved', { planId: plan.id, businessId });
          }
        }

        await this.executionLog.log({
          businessId,
          action: 'trigger:matched',
          mode: 'autonomous',
          actor: 'ai',
          success: true,
          planId: plan.id,
          rationale: `Event "${eventName}" matched trigger "${trigger.name}"`,
        }).catch(() => {});

        this.logger.log(`Trigger ${trigger.id} created plan ${plan.id} for ${eventName}`);
      } catch (err) {
        this.logger.error(`Trigger ${trigger.id} failed: ${(err as Error).message}`);
      }
    }
  }

  async createTrigger(businessId: string, data: {
    name: string;
    eventPattern: string;
    condition?: Record<string, any>;
    objective: string;
    autoExecute?: boolean;
    maxRiskTier?: number;
  }) {
    return this.prisma.client.agentTrigger.create({
      data: {
        businessId,
        name: data.name,
        eventPattern: data.eventPattern,
        condition: (data.condition ?? undefined) as any,
        objective: data.objective,
        autoExecute: data.autoExecute ?? false,
        maxRiskTier: data.maxRiskTier ?? 2,
      },
    });
  }

  async listTriggers(businessId: string) {
    return this.prisma.client.agentTrigger.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateTrigger(businessId: string, triggerId: string, data: Partial<{
    name: string;
    eventPattern: string;
    condition: Record<string, any> | null;
    objective: string;
    enabled: boolean;
    autoExecute: boolean;
    maxRiskTier: number;
  }>) {
    return this.prisma.client.agentTrigger.update({
      where: { id: triggerId, businessId },
      data: data as any,
    });
  }

  async deleteTrigger(businessId: string, triggerId: string) {
    return this.prisma.client.agentTrigger.delete({
      where: { id: triggerId, businessId },
    });
  }

  private evaluateCondition(condition: Record<string, any>, payload: any): boolean {
    try {
      for (const [key, expected] of Object.entries(condition)) {
        const actual = this.getNestedValue(payload, key);
        if (expected !== null && expected !== undefined) {
          if (typeof expected === 'object' && expected.op) {
            // Advanced condition: { total: { op: 'gt', value: 5000 } }
            const op = expected.op as string;
            const value = expected.value;
            switch (op) {
              case 'gt': if (!(actual > value)) return false; break;
              case 'gte': if (!(actual >= value)) return false; break;
              case 'lt': if (!(actual < value)) return false; break;
              case 'lte': if (!(actual <= value)) return false; break;
              case 'eq': if (actual !== value) return false; break;
              case 'ne': if (actual === value) return false; break;
              case 'in': if (!Array.isArray(value) || !value.includes(actual)) return false; break;
              default: return false;
            }
          } else if (actual !== expected) {
            return false;
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, p) => o?.[p], obj);
  }

  private inferModule(eventName: string): string {
    if (eventName.startsWith('contact.')) return 'crm';
    if (eventName.startsWith('invoice.') || eventName.startsWith('quote.') || eventName.startsWith('payment.')) return 'commerce';
    if (eventName.startsWith('booking.')) return 'bookings';
    if (eventName.startsWith('store_order.')) return 'store';
    if (eventName.startsWith('campaign.')) return 'marketing';
    if (eventName.startsWith('inventory.')) return 'inventory';
    if (eventName.startsWith('message.')) return 'communications';
    return 'system';
  }
}
