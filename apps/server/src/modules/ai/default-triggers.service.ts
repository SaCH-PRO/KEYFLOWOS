import { Injectable, Logger, Inject } from '@nestjs/common';
import { DEFAULT_AGENT_TRIGGERS } from './default-triggers.constants';
import { PrismaService } from '../../core/prisma/prisma.service';

export { DEFAULT_AGENT_TRIGGERS } from './default-triggers.constants';


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
