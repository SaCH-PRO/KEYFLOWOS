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
 * instead: the seeded name, event and objective, at no higher risk tier than seeded. A rule whose
 * objective a member changed is theirs and fires plans with no member (D-73); a member who copies a
 * default rule word for word gets only what that default does.
 */
export function defaultAgentTriggerFor(trigger: {
  name: string;
  eventPattern: string;
  objective: string;
  maxRiskTier?: number | null;
}): (typeof DEFAULT_AGENT_TRIGGERS)[number] | null {
  return (
    DEFAULT_AGENT_TRIGGERS.find(
      (rule) =>
        rule.name === trigger.name &&
        rule.eventPattern === trigger.eventPattern &&
        rule.objective === trigger.objective &&
        (trigger.maxRiskTier == null || trigger.maxRiskTier <= rule.maxRiskTier),
    ) ?? null
  );
}

/**
 * W4-D93-NO-MEMBER-CONTACTS (D-93): whether a plan is one a default rule fired, by what
 * AgentTriggerService writes for it (the rule's objective, and `Auto-triggered by <event>: <name>`
 * as its raw input). Used for a plan stored with no member before D-93, which runs as the owner.
 */
export function isDefaultAgentTriggerPlan(plan: { objective: string; rawInput: string | null }): boolean {
  return DEFAULT_AGENT_TRIGGERS.some(
    (rule) => plan.objective === rule.objective && plan.rawInput === `Auto-triggered by ${rule.eventPattern}: ${rule.name}`,
  );
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
