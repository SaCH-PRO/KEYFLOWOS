import { Injectable, Logger, Inject, OnModuleInit, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiOversightService } from './ai-oversight.service';
import { PlannerService } from './planner.service';
import { PlanExecutorService } from './plan-executor.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { JourneyOrchestratorService } from './journey-orchestrator.service';
import { canonicalJson, defaultAgentTriggerFor } from './default-triggers.service';
import { TRIGGER_RULE_CREATOR_KEY, triggerRuleCreator } from '../key-cortex/key-cortex-trigger.service';

/**
 * W5-AGENT-TRIGGERS-AUTHORITY (owner rulings D-73 and D-93; review SEC-D93-3, case CV-08m): who created
 * an agent trigger, and who may write one.
 *
 * D-73: a trigger records its creator and the plans it fires run as that member. D-93: only a
 * system-created rule (a default DefaultTriggersService seeded) runs as the business owner, read when
 * it fires. POST and PUT agent/triggers (AuthGuard and BusinessGuard only) let any member switch on a
 * seeded default or write one word for word, so a STAFF member could make owner-run plans.
 *
 * AgentTrigger has no member column and this packet adds no migration, so the member who created the
 * rule is kept in the rule's own JSON config, its condition, under the reserved key
 * KEY-R3b-PLAN-AUTHORITY keeps in KeyCortexTriggerRule.filterJson (TRIGGER_RULE_CREATOR_KEY). Only the
 * server writes it: a key of that name in a condition a client sends is dropped, and evaluateCondition
 * skips it. POST records the member who creates the rule; PUT keeps the recorded creator, whoever
 * switches or edits the rule (review SEC-W5AT-1: an owner switching a STAFF member's rule off and on
 * must not make it run as the owner), and records a member only on a rule that recorded none before
 * (recordedCreatorAfterWrite). A seeded default records no member, even once the owner switches it on
 * or tunes it (review CR-W5AT-1, SEC-W5AT-3), so it runs as whoever owns the business when it fires.
 *
 * Who may write (updateAgentTrigger): the business owner any rule; anyone else neither a rule that runs
 * as the owner by D-93 (a seeded default, 403 AGENT_TRIGGER_OWNER_ONLY), nor a scheduled rule or a
 * schedule (403 AGENT_TRIGGER_SCHEDULE_OWNER_ONLY; review SEC-W5AT-2: a cron tick emits the rule's
 * event for the whole business, so a member's schedule would fire the owner-run defaults at will), nor
 * a rule another member created (403 AGENT_TRIGGER_CREATOR_ONLY: switching it would run its plans with
 * that member's authority at someone else's choice).
 */
export const AGENT_TRIGGER_OWNER_ONLY = 'AGENT_TRIGGER_OWNER_ONLY';
const AGENT_TRIGGER_OWNER_ONLY_MESSAGE =
  'Only the business owner can switch on, switch off or edit a default rule that runs as the owner';
export const AGENT_TRIGGER_SCHEDULE_OWNER_ONLY = 'AGENT_TRIGGER_SCHEDULE_OWNER_ONLY';
const AGENT_TRIGGER_SCHEDULE_OWNER_ONLY_MESSAGE =
  'Only the business owner can put a rule on a schedule or change a scheduled rule';
export const AGENT_TRIGGER_CREATOR_ONLY = 'AGENT_TRIGGER_CREATOR_ONLY';
const AGENT_TRIGGER_CREATOR_ONLY_MESSAGE =
  'Only the member who created this rule, or the business owner, can switch it on, switch it off or edit it';

/** The fields of an agent trigger a member may write (the rest, businessId and id among them, are the server's). */
export interface AgentTriggerWrite {
  name?: string;
  eventPattern?: string;
  condition?: Record<string, unknown> | null;
  objective?: string;
  enabled?: boolean;
  autoExecute?: boolean;
  maxRiskTier?: number;
  schedule?: string | null;
}

/** The member who created an agent trigger (W5-AGENT-TRIGGERS-AUTHORITY, D-73), or null for a rule no member created on record. */
export function agentTriggerWriter(trigger: { condition?: unknown }): string | null {
  return triggerRuleCreator({ filterJson: trigger.condition });
}

/** A trigger's condition without the recorded creator: the event filter it is. */
function conditionWithoutWriter(condition: unknown): Record<string, unknown> | null {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null;
  const own = Object.entries(condition as Record<string, unknown>).filter(([key]) => key !== TRIGGER_RULE_CREATOR_KEY);
  return own.length > 0 ? Object.fromEntries(own) : null;
}

/** The event filter a client sends, without the reserved key. A condition that is not an object is refused (400). */
function clientTriggerFilter(condition: unknown): Record<string, unknown> | null {
  if (condition != null && (typeof condition !== 'object' || Array.isArray(condition))) {
    throw new BadRequestException('condition must be an object');
  }
  return conditionWithoutWriter(condition);
}

/**
 * W5-AGENT-TRIGGERS-AUTHORITY (D-73): the condition as stored, the client's filter without the
 * reserved key plus the member who created the rule. A condition that is not an object is refused (400).
 */
export function storedTriggerCondition(condition: unknown, writerId: string): Prisma.InputJsonObject {
  return { ...(clientTriggerFilter(condition) ?? {}), [TRIGGER_RULE_CREATOR_KEY]: writerId } as Prisma.InputJsonObject;
}

/** The stored condition for an event filter and the member recorded as the rule's creator (none: the filter alone, or no condition). */
function conditionToStore(filter: Record<string, unknown> | null, creator: string | null): Prisma.InputJsonObject | typeof Prisma.DbNull {
  if (creator) return { ...(filter ?? {}), [TRIGGER_RULE_CREATOR_KEY]: creator } as Prisma.InputJsonObject;
  return filter ? (filter as Prisma.InputJsonObject) : Prisma.DbNull;
}

/**
 * The business owner: the OWNER membership or the distinguished owner (Business.ownerId), the two arms
 * BusinessGuard admits an owner by (as GmailService.connectStanding restates them; D-94, D-11).
 */
async function isBusinessOwner(prisma: PrismaService, businessId: string, userId: string): Promise<boolean> {
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true },
  });
  if (membership?.role === 'OWNER') return true;
  // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row.
  const owned = await prisma.client.business.findFirst({ where: { id: businessId, ownerId: userId, members: { some: { userId: userId } } }, select: { id: true } });
  return Boolean(owned);
}

type TriggerContent = { name: string; eventPattern: string; objective: string; condition?: unknown; maxRiskTier?: number | null };

/** Whether a trigger's content (name, event, objective, filter, tier; the recorded creator aside) is a seeded default's. */
function seededDefaultContent(trigger: TriggerContent): boolean {
  return Boolean(defaultAgentTriggerFor({ ...trigger, condition: conditionWithoutWriter(trigger.condition) }));
}

/**
 * W5-AGENT-TRIGGERS-AUTHORITY (D-93, D-73; CV-08m; review CR-W5AT-1, SEC-W5AT-3): whether a stored
 * trigger is an owner-run default rule: a seeded default by its content that records no member. Its
 * plans run as whoever owns the business when it fires (AgentTriggerService.handleEvent reads
 * Business.ownerId then), so it stays one across an ownership transfer or a user-id re-key; only the
 * business owner writes it (updateAgentTrigger), and the owner's write records no member in it. A rule
 * that records a member (a member's word-for-word copy, createAgentTrigger) is that member's.
 */
export function ownerRunDefaultTrigger(trigger: TriggerContent): boolean {
  return agentTriggerWriter(trigger) === null && seededDefaultContent(trigger);
}

/**
 * W5-AGENT-TRIGGERS-AUTHORITY (D-73, D-93; review SEC-W5AT-1, CR-W5AT-1): the member a rule records as
 * its creator after a write (`next` is its content after it).
 *   - A rule a member created stays theirs, whoever switches or edits it (D-73: the creator).
 *   - An owner-run default (only the owner writes it) that is still a seeded default records no one: it
 *     stays the system's (D-93). One the owner's edit takes off the seeded content is the owner's.
 *   - A rule no member created on record (written before this packet): a write that changes its name,
 *     event, filter or objective, or makes it a seeded default word for word, is the writer's (as POST
 *     records them); a switch alone (enabled, autoExecute, tier, schedule) records no one, so it keeps
 *     running with no member (D-73), as it did.
 */
function recordedCreatorAfterWrite(row: TriggerContent, next: TriggerContent, writerId: string): string | null {
  const creator = agentTriggerWriter(row);
  if (creator) return creator;
  const defaultNow = seededDefaultContent(next);
  if (seededDefaultContent(row)) return defaultNow ? null : writerId;
  const authored =
    next.name !== row.name ||
    next.eventPattern !== row.eventPattern ||
    next.objective !== row.objective ||
    canonicalJson(conditionWithoutWriter(next.condition)) !== canonicalJson(conditionWithoutWriter(row.condition));
  return defaultNow || authored ? writerId : null;
}

/** W5-AGENT-TRIGGERS-AUTHORITY (D-73): POST agent/triggers. The rule records the member who created it; its plans run as them. */
export async function createAgentTrigger(
  prisma: PrismaService,
  businessId: string,
  writerId: string,
  data: { name: string; eventPattern: string; condition?: Record<string, unknown> | null; objective: string; autoExecute?: boolean; maxRiskTier?: number },
) {
  return prisma.client.agentTrigger.create({
    data: {
      businessId,
      name: data.name,
      eventPattern: data.eventPattern,
      condition: storedTriggerCondition(data.condition, writerId),
      objective: data.objective,
      autoExecute: data.autoExecute ?? false,
      maxRiskTier: data.maxRiskTier ?? 2,
    },
  });
}

/**
 * W5-AGENT-TRIGGERS-AUTHORITY (D-93, D-73; CV-08m; review SEC-W5AT-1, SEC-W5AT-2, SEC-W5AT-3,
 * CR-W5AT-1): PUT agent/triggers/:triggerId. The business owner may write any rule. Anyone else is
 * refused (403) an owner-run default rule (AGENT_TRIGGER_OWNER_ONLY), a scheduled rule or a schedule
 * (AGENT_TRIGGER_SCHEDULE_OWNER_ONLY), and a rule another member created (AGENT_TRIGGER_CREATOR_ONLY).
 * The rule keeps the creator it records (recordedCreatorAfterWrite). Only the member-writable fields are
 * written: the business and id a body names are not.
 */
export async function updateAgentTrigger(
  prisma: PrismaService,
  businessId: string,
  triggerId: string,
  writerId: string,
  data: AgentTriggerWrite,
) {
  const row = await prisma.client.agentTrigger.findFirst({ where: { id: triggerId, businessId } });
  if (!row) throw new NotFoundException('Agent trigger not found');
  const body: AgentTriggerWrite = data && typeof data === 'object' ? data : {};
  const filter = 'condition' in body ? clientTriggerFilter(body.condition) : conditionWithoutWriter(row.condition);

  if (!(await isBusinessOwner(prisma, businessId, writerId))) {
    if (ownerRunDefaultTrigger(row)) {
      throw new ForbiddenException({ code: AGENT_TRIGGER_OWNER_ONLY, message: AGENT_TRIGGER_OWNER_ONLY_MESSAGE });
    }
    // SEC-W5AT-2: QueueService.processCronTrigger emits a scheduled rule's current event for the whole
    // business on every tick, so a schedule, and every field of a scheduled rule, is the owner's to set.
    if (row.schedule || (body.schedule !== undefined && body.schedule !== null)) {
      throw new ForbiddenException({ code: AGENT_TRIGGER_SCHEDULE_OWNER_ONLY, message: AGENT_TRIGGER_SCHEDULE_OWNER_ONLY_MESSAGE });
    }
    const creator = agentTriggerWriter(row);
    if (creator !== null && creator !== writerId) {
      throw new ForbiddenException({ code: AGENT_TRIGGER_CREATOR_ONLY, message: AGENT_TRIGGER_CREATOR_ONLY_MESSAGE });
    }
  }

  const next: TriggerContent = {
    name: body.name ?? row.name,
    eventPattern: body.eventPattern ?? row.eventPattern,
    objective: body.objective ?? row.objective,
    condition: filter,
    maxRiskTier: body.maxRiskTier ?? row.maxRiskTier,
  };
  const update: Prisma.AgentTriggerUpdateInput = {
    condition: conditionToStore(filter, recordedCreatorAfterWrite(row, next, writerId)),
  };
  if (body.name !== undefined) update.name = body.name;
  if (body.eventPattern !== undefined) update.eventPattern = body.eventPattern;
  if (body.objective !== undefined) update.objective = body.objective;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.autoExecute !== undefined) update.autoExecute = body.autoExecute;
  if (body.maxRiskTier !== undefined) update.maxRiskTier = body.maxRiskTier;
  if (body.schedule !== undefined) update.schedule = body.schedule;
  return prisma.client.agentTrigger.update({ where: { id: triggerId, businessId }, data: update });
}

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
    } catch (err: any) {
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

        // W4-D93-NO-MEMBER-CONTACTS (owner ruling D-93; D-73): a default rule DefaultTriggersService
        // seeded is the system's, so its plan records the business owner as its member (read now, so an
        // ownership transfer is followed) and runs as the owner.
        // W5-AGENT-TRIGGERS-AUTHORITY (D-73, D-93; CV-08m): a rule a member created records that member
        // (agentTriggerWriter), and its plan runs as them, an exact copy of a default included, whoever
        // switched it on (review SEC-W5AT-1); a rule a member created before that records no one, so its
        // plan has no member (D-73). A seeded default records no member even once the owner switched it
        // on (review CR-W5AT-1, SEC-W5AT-3), so the owner is read here, when it fires.
        const writer = agentTriggerWriter(trigger);
        const member = writer
          ?? (ownerRunDefaultTrigger(trigger)
            ? (await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { ownerId: true } }))?.ownerId ?? undefined
            : undefined);

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
          member,
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
      } catch (err: any) {
        this.logger.error(`Trigger ${trigger.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** W5-AGENT-TRIGGERS-AUTHORITY (D-73): records `writerId`, the member who creates the rule (createAgentTrigger). */
  async createTrigger(businessId: string, data: {
    name: string;
    eventPattern: string;
    condition?: Record<string, any>;
    objective: string;
    autoExecute?: boolean;
    maxRiskTier?: number;
  }, writerId: string) {
    return createAgentTrigger(this.prisma, businessId, writerId, data);
  }

  async listTriggers(businessId: string) {
    return this.prisma.client.agentTrigger.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** W5-AGENT-TRIGGERS-AUTHORITY (D-93, D-73): the owner rule and the recorded writer of updateAgentTrigger. */
  async updateTrigger(businessId: string, triggerId: string, data: AgentTriggerWrite, writerId: string) {
    return updateAgentTrigger(this.prisma, businessId, triggerId, writerId, data);
  }

  async deleteTrigger(businessId: string, triggerId: string) {
    return this.prisma.client.agentTrigger.delete({
      where: { id: triggerId, businessId },
    });
  }

  private evaluateCondition(condition: Record<string, any>, payload: any): boolean {
    try {
      for (const [key, expected] of Object.entries(condition)) {
        // W5-AGENT-TRIGGERS-AUTHORITY (D-73): the recorded writer is no event filter.
        if (key === TRIGGER_RULE_CREATOR_KEY) continue;
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
