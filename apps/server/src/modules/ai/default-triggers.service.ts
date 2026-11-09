import { Injectable, Logger, Inject } from '@nestjs/common';
import { DEFAULT_AGENT_TRIGGERS } from './default-triggers.constants';
import { PrismaService } from '../../core/prisma/prisma.service';

export { DEFAULT_AGENT_TRIGGERS } from './default-triggers.constants';

/**
 * W4-D93-NO-MEMBER-CONTACTS (owner ruling D-93; D-73): the default rule an agent trigger is, or null.
 * A rule seedForBusiness wrote is system-created, so the plans it fires run with the business owner
 * as their member (AgentTriggerService.handleEvent records the owner on the plan). AgentTrigger has no
 * member column, and its condition JSON is stored as POST/PUT agent/triggers receive it, so a member
 * recorded in the row could be forged by any member; the rule is known as the system's by its source
 * instead: the seeded name, event, objective and condition, at no higher risk tier than seeded. A rule
 * a member changed in any of them is theirs and fires plans with no member (D-73); a member who copies
 * a default rule word for word gets only what that default does. Review SEC-D93-3: the condition is
 * part of the rule (a copy of 'New Lead' with no condition fires on every contact created), and a
 * plan stored with no member is never taken as a default rule's at run time (systemPlanMember), so a
 * copy this answers null for fires plans that run as no member.
 *
 * W5-AGENT-TRIGGERS-AUTHORITY (D-73, D-93; review SEC-D93-3, case CV-08m): the shape alone no longer
 * decides. POST and PUT agent/triggers now record the member who wrote the rule in its stored
 * condition (agent-trigger.service.ts, agentTriggerWriter; a client's own key of that name is
 * dropped), and the seeded rules never carry one, so a rule a member wrote (an exact copy of a
 * default included) is never recognised here: it runs as that member. Switching a seeded rule on,
 * off or editing it is the business owner's alone (ownerRunDefaultTrigger, which asks this on the
 * rule's content with the recorded writer aside).
 */
export function defaultAgentTriggerFor(trigger: {
  name: string;
  eventPattern: string;
  objective: string;
  condition?: unknown;
  maxRiskTier?: number | null;
}): (typeof DEFAULT_AGENT_TRIGGERS)[number] | null {
  const condition = canonicalJson(trigger.condition ?? null);
  return (
    DEFAULT_AGENT_TRIGGERS.find(
      (rule) =>
        rule.name === trigger.name &&
        rule.eventPattern === trigger.eventPattern &&
        rule.objective === trigger.objective &&
        canonicalJson(('condition' in rule ? rule.condition : null) ?? null) === condition &&
        (trigger.maxRiskTier == null || trigger.maxRiskTier <= rule.maxRiskTier),
    ) ?? null
  );
}

/** `value` as JSON with every object's keys in order, so a stored JSON column compares by content. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}


@Injectable()
export class DefaultTriggersService {
  private readonly logger = new Logger(DefaultTriggersService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Create this business's default autopilot rules.
   *
   * Seeded DISABLED by default. AgentTriggerService listens to every emitted
   * event and matches rows from this table, so seeding them enabled would mean
   * KEY begins creating and auto-approving plans against real data the moment a
   * business is created, with nobody having chosen that. The rules exist so
   * they can be reviewed and switched on individually.
   *
   * Seeding also writes the AutopilotSettings row, which matters independently:
   * it is the ONLY writer of that table, and two live readers depend on it —
   * MorningBriefingService (briefingEnabled/briefingModules) and
   * AgentTriggerService (maxDailyAutoActions). Without it the daily
   * auto-action cap is never enforced.
   *
   * Idempotent: returns 0 if this business already has triggers.
   */
  async seedForBusiness(
    businessId: string,
    options: { enabled?: boolean } = {},
  ): Promise<number> {
    const existing = await this.prisma.client.agentTrigger.count({
      where: { businessId },
    });

    if (existing > 0) {
      this.logger.log(`Business ${businessId} already has ${existing} triggers — skipping seed`);
      return 0;
    }

    let created = 0;
    for (const trigger of DEFAULT_AGENT_TRIGGERS) {
      try {
        await this.prisma.client.agentTrigger.create({
          data: {
            businessId,
            name: trigger.name,
            eventPattern: trigger.eventPattern,
            condition: trigger.condition ? trigger.condition as any : undefined,
            objective: trigger.objective,
            autoExecute: trigger.autoExecute,
            maxRiskTier: trigger.maxRiskTier,
            // Opt-in, not opt-out. See the note on seedForBusiness.
            enabled: options.enabled ?? false,
          },
        });
        created++;
      } catch (err: any) {
        this.logger.error(`Failed to seed trigger "${trigger.name}": ${(err as Error).message}`);
      }
    }

    // Also seed autopilot settings with sensible defaults
    await this.prisma.client.autopilotSettings.upsert({
      where: { businessId },
      create: {
        businessId,
        autonomyLevel: 2,
        approvedTools: [
          'crm_create_contact',
          'crm_add_task',
          'crm_add_note',
          'commerce_create_invoice',
          'fetch_business_summary',
          'fetch_client_health',
          'content_create_request',
          'content_assign_request',
          'call_create_task',
          'call_log_outcome',
          'evidence_submit',
          'approval_create_request',
          'drive_create_folder',
        ],
        blockedTools: [],
        maxDailyAutoActions: 50,
        approvalTimeoutHours: 24,
        notifyOnAutoAction: true,
        learningEnabled: true,
      },
      update: {},
    }).catch(() => {});

    this.logger.log(`Seeded ${created} default triggers + autopilot settings for business ${businessId}`);
    return created;
  }
}
