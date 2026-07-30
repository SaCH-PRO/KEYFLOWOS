import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface AcceptanceScenario {
  name: string;
  days: number;
  routineTasks: string[];
  expectedEscalations: number;
}

export interface AcceptanceResult {
  scenario: string;
  score: number; // 0-1
  passed: boolean;
  gaps: string[];
}

/**
 * Skeleton for the digital-employee acceptance test.
 *
 * Defines a one-week synthetic routine and scoring rubric. The full
 * simulation requires a test harness that replays realistic business
 * events; this service exposes the contract and baseline scoring.
 */
@Injectable()
export class DigitalEmployeeAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  getScenario(): AcceptanceScenario {
    return {
      name: 'one_week_routine_operations',
      days: 7,
      routineTasks: [
        'process_inbox',
        'send_follow_up_emails',
        'update_crm_status',
        'draft_invoices',
        'schedule_meetings',
        'generate_morning_brief',
      ],
      expectedEscalations: 5,
    };
  }

  async evaluate(businessId: string): Promise<AcceptanceResult> {
    const scenario = this.getScenario();

    const verdicts = await this.prisma.client.autonomyVerdict.findMany({
      where: {
        businessId,
        createdAt: { gte: new Date(Date.now() - scenario.days * 24 * 60 * 60 * 1000) },
      },
    });

    const total = verdicts.length || 1;
    const approved = verdicts.filter((v) => v.allowed && !v.requiresApproval).length;
    const escalations = verdicts.filter((v) => v.requiresApproval || !v.allowed).length;

    const autonomyRate = approved / total;
    const escalationRate = escalations / total;
    const score = Math.max(0, autonomyRate - escalationRate);

    const gaps: string[] = [];
    if (escalations > scenario.expectedEscalations) {
      gaps.push(`Escalations (${escalations}) exceed threshold (${scenario.expectedEscalations})`);
    }
    if (autonomyRate < 0.6) {
      gaps.push('Autonomous execution rate below 60%');
    }

    return {
      scenario: scenario.name,
      score,
      passed: score >= 0.7 && gaps.length === 0,
      gaps,
    };
  }
}
