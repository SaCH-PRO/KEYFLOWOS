import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ValueFeedbackEvent {
  businessId: string;
  valueKey: string;
  positive: boolean; // true if action aligned with value, false if rejected
  source: string;
  example: string;
  weightDelta?: number;
}

/**
 * Translates user approvals/rejections into weighted value constraints.
 *
 * Foundation implementation: simple weighted scoring per value key with
 * drift detection when recent feedback contradicts historical weights.
 */
@Injectable()
export class ValueLearningService {
  private readonly logger = new Logger(ValueLearningService.name);

  constructor(private readonly prisma: PrismaService) {}

  async observeFeedback(event: ValueFeedbackEvent): Promise<void> {
    const existing = await this.prisma.client.valueConstraint.findUnique({
      where: {
        businessId_valueKey_source: {
          businessId: event.businessId,
          valueKey: event.valueKey,
          source: event.source,
        },
      },
    });

    const delta = event.positive ? (event.weightDelta ?? 0.05) : -(event.weightDelta ?? 0.1);

    if (existing) {
      const examples = Array.isArray(existing.examples) ? (existing.examples as string[]) : [];
      examples.unshift(event.example);
      const trimmed = examples.slice(0, 10);

      await this.prisma.client.valueConstraint.update({
        where: { id: existing.id },
        data: {
          weight: Math.max(0, Math.min(1, existing.weight + delta)),
          evidenceCount: existing.evidenceCount + 1,
          examples: trimmed as any,
        },
      });
    } else {
      await this.prisma.client.valueConstraint.create({
        data: {
          businessId: event.businessId,
          valueKey: event.valueKey,
          weight: Math.max(0, Math.min(1, 0.5 + delta)),
          evidenceCount: 1,
          source: event.source,
          examples: [event.example] as any,
        },
      });
    }

    this.logger.debug(
      `[observeFeedback] ${event.valueKey} ${event.positive ? '+' : '-'} for ${event.businessId}`,
    );
  }

  async getValueConstraints(
    businessId: string,
    minWeight = 0.0,
  ): Promise<Array<{ valueKey: string; weight: number; evidenceCount: number; source: string }>> {
    const rows = await this.prisma.client.valueConstraint.findMany({
      where: { businessId, weight: { gte: minWeight } },
      orderBy: { weight: 'desc' },
    });

    return rows.map((r) => ({
      valueKey: r.valueKey,
      weight: r.weight,
      evidenceCount: r.evidenceCount,
      source: r.source,
    }));
  }

  async detectDrift(businessId: string): Promise<{ driftScore: number; conflicting: string[] }> {
    const recent = await this.prisma.client.valueConstraint.findMany({
      where: { businessId },
    });

    const conflicting = recent
      .filter((r) => r.weight < 0.3 && r.evidenceCount >= 3)
      .map((r) => r.valueKey);

    return {
      driftScore: Math.min(1, conflicting.length * 0.2),
      conflicting,
    };
  }
}
