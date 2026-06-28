import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type AutonomyExecutionMode = 'auto' | 'approved' | 'manual';

export interface AutonomySafetyCheck {
  businessId: string;
  toolName: string;
  riskTier?: number;
  mode?: AutonomyExecutionMode;
  estimatedCostTtd?: number;
  actionType?: string;
}

export interface AutonomySafetyResult {
  allowed: boolean;
  reason?: string;
  profile?: {
    id: string;
    businessId: string;
    globalKillSwitch: boolean;
    maxDailyAutoActions: number;
    maxDailySpendTtd: number;
    notifyOnBlock: boolean;
  };
}

/**
 * Global autonomy safety service.
 *
 * Enforces the canonical BusinessAutonomyProfile for every business:
 *  - global kill switch (hard stop on all autonomous execution)
 *  - daily auto-action count cap
 *  - daily spend cap
 *
 * The KeyCortexToolRegistryService calls this as the first gate before
 * invoking any tool handler. Counting happens after successful execution.
 */
@Injectable()
export class KeyAutonomySafetyService {
  private readonly logger = new Logger(KeyAutonomySafetyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check whether an execution is permitted by the active safety profile.
   * Does not mutate counters — call recordExecution after a successful run.
   */
  async check(input: AutonomySafetyCheck): Promise<AutonomySafetyResult> {
    const profile = await this.ensureProfile(input.businessId);

    if (profile.globalKillSwitch) {
      return {
        allowed: false,
        reason: 'Global autonomy kill switch is active for this business',
        profile,
      };
    }

    // Daily action limits apply only to autonomous executions.
    if (input.mode === 'auto') {
      const today = this.today();
      const actionType = input.actionType ?? 'auto';
      const countRow = await this.prisma.client.autonomyDailyActionCount.findUnique({
        where: {
          businessId_date_actionType: {
            businessId: input.businessId,
            date: today,
            actionType,
          },
        },
      });
      const currentCount = countRow?.count ?? 0;
      if (currentCount >= profile.maxDailyAutoActions) {
        return {
          allowed: false,
          reason: `Daily autonomous action limit reached (${profile.maxDailyAutoActions})`,
          profile,
        };
      }
    }

    // Spend limit check (only when a limit is configured and a cost is supplied).
    if (input.mode === 'auto' && profile.maxDailySpendTtd > 0) {
      const estimatedCostTtd = input.estimatedCostTtd ?? 0;
      if (estimatedCostTtd > 0) {
        const today = this.today();
        const spendRow = await this.prisma.client.autonomyDailySpend.findUnique({
          where: {
            businessId_date_currency: {
              businessId: input.businessId,
              date: today,
              currency: 'TTD',
            },
          },
        });
        const currentSpend = spendRow?.amountTtd ?? 0;
        if (currentSpend + estimatedCostTtd > profile.maxDailySpendTtd) {
          return {
            allowed: false,
            reason: `Daily autonomous spend limit would be exceeded (${currentSpend} + ${estimatedCostTtd} > ${profile.maxDailySpendTtd} TTD)`,
            profile,
          };
        }
      }
    }

    return { allowed: true, profile };
  }

  /**
   * Increment the daily action counter and, if a cost is supplied, the daily
   * spend accumulator. Should be called only after a successful execution.
   */
  async recordExecution(
    input: AutonomySafetyCheck & { actualCostTtd?: number },
  ): Promise<void> {
    const today = this.today();
    const actionType = input.actionType ?? input.mode ?? 'auto';

    await this.prisma.client.autonomyDailyActionCount.upsert({
      where: {
        businessId_date_actionType: {
          businessId: input.businessId,
          date: today,
          actionType,
        },
      },
      create: {
        businessId: input.businessId,
        date: today,
        actionType,
        count: 1,
      },
      update: { count: { increment: 1 } },
    });

    const cost = input.actualCostTtd ?? input.estimatedCostTtd ?? 0;
    if (cost > 0) {
      await this.prisma.client.autonomyDailySpend.upsert({
        where: {
          businessId_date_currency: {
            businessId: input.businessId,
            date: today,
            currency: 'TTD',
          },
        },
        create: {
          businessId: input.businessId,
          date: today,
          currency: 'TTD',
          amountTtd: cost,
        },
        update: { amountTtd: { increment: cost } },
      });
    }
  }

  /**
   * Return (and lazily create) the canonical BusinessAutonomyProfile for a
   * business. Seeds defaults from AutopilotSettings when available.
   */
  async ensureProfile(businessId: string): Promise<AutonomySafetyResult['profile'] & { id: string }> {
    const existing = await this.prisma.client.businessAutonomyProfile.findUnique({
      where: { businessId },
    });
    if (existing) return existing;

    const autopilot = await this.prisma.client.autopilotSettings.findUnique({
      where: { businessId },
      select: { maxDailyAutoActions: true },
    });

    return this.prisma.client.businessAutonomyProfile.create({
      data: {
        businessId,
        maxDailyAutoActions: autopilot?.maxDailyAutoActions ?? 10,
      },
    });
  }

  private today(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }
}
