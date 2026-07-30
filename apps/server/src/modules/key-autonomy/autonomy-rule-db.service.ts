import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface DbAutonomyRule {
  source: string;
  ruleKey: string;
  decision: 'allow' | 'block' | 'supervised';
  reason: string;
  priority: number;
}

/**
 * Reads explicit AutonomyRule rows for a business.
 */
@Injectable()
export class AutonomyRuleDbService {
  constructor(private readonly prisma: PrismaService) {}

  async findMatchingRules(
    businessId: string,
    actionKey: string,
  ): Promise<DbAutonomyRule[]> {
    try {
      const rows = await this.prisma.client.autonomyRule.findMany({
        where: {
          businessId,
          active: true,
          OR: [{ actionKey: null }, { actionKey: actionKey }, { actionKey: { startsWith: actionKey.split('.')[0] } }],
        },
        orderBy: { priority: 'desc' },
      });

      return rows.map((r) => ({
        source: r.source,
        ruleKey: r.ruleKey,
        decision: this.normalizeDecision(r.decision),
        reason: r.reason,
        priority: r.priority,
      }));
    } catch {
      return [];
    }
  }

  private normalizeDecision(decision: string): 'allow' | 'block' | 'supervised' {
    const d = decision.toLowerCase();
    if (d === 'allow' || d === 'allowed') return 'allow';
    if (d === 'block' || d === 'blocked' || d === 'deny') return 'block';
    return 'supervised';
  }
}
