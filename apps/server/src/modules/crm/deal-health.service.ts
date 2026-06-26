import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ConversationAiService } from './conversation-ai.service';
import { DealVelocityService } from './deal-velocity.service';

const MS_PER_DAY = 86_400_000;

export interface HealthBreakdown {
  base: number;
  ageInStage: number;
  recency: number;
  sentiment: number;
  relationship: number;
  valueFit: number;
  total: number;
  daysInStage: number;
  daysSinceTouch: number | null;
  stageAvgDays: number;
  stageAvgValue: number;
}

export interface DealHealthResult {
  dealId: string;
  score: number;
  breakdown: HealthBreakdown;
}

@Injectable()
export class DealHealthService {
  private readonly logger = new Logger(DealHealthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DealVelocityService) private readonly velocity: DealVelocityService,
    @Inject(ConversationAiService) private readonly conversation: ConversationAiService,
  ) {}

  /** Recompute and persist health for a single deal. */
  async recomputeDeal(input: { businessId: string; dealId: string }): Promise<DealHealthResult | null> {
    const deal = await this.prisma.client.deal.findFirst({
      where: { id: input.dealId, businessId: input.businessId, deletedAt: null },
      include: { stage: true, contact: { select: { id: true, lastContactedAt: true, relationshipHealth: true } } },
    });
    if (!deal) return null;
    if (deal.status !== 'OPEN') return null;

    const stageAverages = await this.velocity.getStageAverages(input.businessId);
    const stageAvgValue = await this.getStageAvgValue(input.businessId, deal.stageId);
    const sentimentRollup = deal.contact
      ? await this.conversation.getContactRollup(input.businessId, deal.contact.id).catch(() => null)
      : null;

    const result = this.computeScore({
      deal,
      stageAvgDays: stageAverages.get(deal.stageId) ?? 0,
      stageAvgValue,
      sentiment: sentimentRollup?.dominantSentiment ?? null,
      contactHealth: deal.contact?.relationshipHealth ?? null,
      lastContactedAt: deal.contact?.lastContactedAt ?? null,
    });

    await this.prisma.client.deal.update({
      where: { id: deal.id },
      data: {
        healthScore: result.score,
        healthScoreAt: new Date(),
        healthBreakdown: result.breakdown as any,
      },
    });
    return { dealId: deal.id, score: result.score, breakdown: result.breakdown };
  }

  /** Recompute health for every open deal in a business. */
  async recomputeForBusiness(businessId: string): Promise<{ scanned: number; updated: number }> {
    const stageAverages = await this.velocity.getStageAverages(businessId);
    const stageAvgValueByStage = await this.getStageAvgValueMap(businessId);
    const deals = await this.prisma.client.deal.findMany({
      where: { businessId, deletedAt: null, status: 'OPEN' },
      include: {
        stage: true,
        contact: { select: { id: true, lastContactedAt: true, relationshipHealth: true } },
      },
    });

    let updated = 0;
    for (const deal of deals) {
      try {
        const sentimentRollup = deal.contact
          ? await this.conversation.getContactRollup(businessId, deal.contact.id).catch(() => null)
          : null;
        const result = this.computeScore({
          deal,
          stageAvgDays: stageAverages.get(deal.stageId) ?? 0,
          stageAvgValue: stageAvgValueByStage.get(deal.stageId) ?? 0,
          sentiment: sentimentRollup?.dominantSentiment ?? null,
          contactHealth: deal.contact?.relationshipHealth ?? null,
          lastContactedAt: deal.contact?.lastContactedAt ?? null,
        });
        await this.prisma.client.deal.update({
          where: { id: deal.id },
          data: {
            healthScore: result.score,
            healthScoreAt: new Date(),
            healthBreakdown: result.breakdown as any,
          },
        });
        updated += 1;
      } catch (err: any) {
        this.logger.warn(`Health recompute failed for deal=${deal.id}: ${(err as Error).message}`);
      }
    }
    return { scanned: deals.length, updated };
  }

  /**
   * Pure deterministic scorer.
   * Starts at 70 and adjusts ±10 across each factor; clamped to [0, 100].
   */
  computeScore(input: {
    deal: {
      value: number | null;
      createdAt: Date;
      lastStageChangedAt: Date | null;
      stageId: string;
    };
    stageAvgDays: number;
    stageAvgValue: number;
    sentiment: string | null;
    contactHealth: string | null;
    lastContactedAt: Date | null;
  }): { score: number; breakdown: HealthBreakdown } {
    const now = Date.now();
    const stageStart = (input.deal.lastStageChangedAt ?? input.deal.createdAt).getTime();
    const daysInStage = Math.max(0, Math.floor((now - stageStart) / MS_PER_DAY));
    const daysSinceTouch = input.lastContactedAt
      ? Math.max(0, Math.floor((now - new Date(input.lastContactedAt).getTime()) / MS_PER_DAY))
      : null;

    let ageInStage = 0;
    if (input.stageAvgDays > 0) {
      const ratio = daysInStage / input.stageAvgDays;
      if (ratio <= 0.5) ageInStage = 5;
      else if (ratio <= 1) ageInStage = 0;
      else if (ratio <= 1.5) ageInStage = -5;
      else if (ratio <= 2) ageInStage = -10;
      else ageInStage = -15;
    } else if (daysInStage > 30) {
      ageInStage = -5;
    }

    let recency: number;
    if (daysSinceTouch == null) {
      recency = -5;
    } else if (daysSinceTouch <= 3) recency = 10;
    else if (daysSinceTouch <= 7) recency = 5;
    else if (daysSinceTouch <= 14) recency = 0;
    else if (daysSinceTouch <= 30) recency = -5;
    else recency = -10;

    let sentiment: number;
    switch (input.sentiment) {
      case 'positive': sentiment = 8; break;
      case 'mixed':    sentiment = 0; break;
      case 'negative': sentiment = -10; break;
      default:         sentiment = 0;
    }

    let relationship: number;
    switch (input.contactHealth) {
      case 'HOT':     relationship = 8; break;
      case 'WARM':    relationship = 3; break;
      case 'COLD':    relationship = -5; break;
      case 'DORMANT': relationship = -8; break;
      case 'AT_RISK': relationship = -10; break;
      default:        relationship = 0;
    }

    let valueFit = 0;
    const v = input.deal.value ?? 0;
    if (input.stageAvgValue > 0 && v > 0) {
      const ratio = v / input.stageAvgValue;
      if (ratio >= 0.5 && ratio <= 2) valueFit = 5;
      else if (ratio >= 0.25 && ratio <= 4) valueFit = 0;
      else valueFit = -3;
    }

    const base = 70;
    const total = Math.max(0, Math.min(100, base + ageInStage + recency + sentiment + relationship + valueFit));

    return {
      score: total,
      breakdown: {
        base,
        ageInStage,
        recency,
        sentiment,
        relationship,
        valueFit,
        total,
        daysInStage,
        daysSinceTouch,
        stageAvgDays: Number(input.stageAvgDays.toFixed(1)),
        stageAvgValue: Number(input.stageAvgValue.toFixed(2)),
      },
    };
  }

  private async getStageAvgValue(businessId: string, stageId: string): Promise<number> {
    const agg = await this.prisma.client.deal.aggregate({
      where: { businessId, stageId, deletedAt: null, value: { gt: 0 } },
      _avg: { value: true },
    });
    return Number(agg._avg.value ?? 0);
  }

  private async getStageAvgValueMap(businessId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.client.deal.groupBy({
      by: ['stageId'],
      where: { businessId, deletedAt: null, value: { gt: 0 } },
      _avg: { value: true },
    });
    return new Map(rows.map((r: any) => [r.stageId as string, Number(r._avg.value ?? 0)]));
  }
}
