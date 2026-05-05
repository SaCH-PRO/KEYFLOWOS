import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const MS_PER_DAY = 86_400_000;

const DEFAULT_STAGE_WIN_RATE: Record<string, number> = {
  lead: 0.1,
  qualified: 0.25,
  proposal: 0.45,
  negotiation: 0.65,
};

export interface StageForecast {
  stageId: string;
  stageName: string;
  stageSlug: string;
  position: number;
  openDeals: number;
  totalValue: number;
  winRate: number;
  weightedValue: number;
  source: 'historical' | 'default';
}

export interface ForecastReport {
  windowDays: number;
  windowEnd: string;
  currency: string;
  totalOpenValue: number;
  totalWeightedValue: number;
  totalWonValue: number;
  totalLostValue: number;
  expectedCloseValue: number;
  expectedCloseWeightedValue: number;
  byStage: StageForecast[];
  generatedAt: string;
}

const HISTORY_DAYS = 180;

@Injectable()
export class DealForecastService {
  private readonly logger = new Logger(DealForecastService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getForecast(input: { businessId: string; windowDays?: number; currency?: string }): Promise<ForecastReport> {
    const windowDays = Math.max(1, Math.min(input.windowDays ?? 30, 365));
    const windowEnd = new Date(Date.now() + windowDays * MS_PER_DAY);

    const stages = await this.prisma.client.dealStage.findMany({
      where: { businessId: input.businessId, archivedAt: null },
      orderBy: [{ position: 'asc' }],
    });

    const winRates = await this.computeStageWinRates(input.businessId, stages);

    const openDeals = await this.prisma.client.deal.findMany({
      where: { businessId: input.businessId, deletedAt: null, status: 'OPEN' },
      select: { id: true, stageId: true, value: true, probability: true, expectedCloseAt: true, currency: true },
    });

    const byStageMap = new Map<string, { count: number; total: number }>();
    let totalOpen = 0;
    let totalWeighted = 0;
    let expectedClose = 0;
    let expectedWeighted = 0;

    for (const d of openDeals) {
      const v = d.value ?? 0;
      const wr = winRates.get(d.stageId);
      const winRate = d.probability != null ? d.probability / 100 : (wr?.rate ?? 0.2);
      const weighted = v * winRate;
      totalOpen += v;
      totalWeighted += weighted;
      if (d.expectedCloseAt && d.expectedCloseAt <= windowEnd) {
        expectedClose += v;
        expectedWeighted += weighted;
      }
      const agg = byStageMap.get(d.stageId) ?? { count: 0, total: 0 };
      agg.count += 1;
      agg.total += v;
      byStageMap.set(d.stageId, agg);
    }

    const since = new Date(Date.now() - windowDays * MS_PER_DAY);
    const closed = await this.prisma.client.deal.findMany({
      where: {
        businessId: input.businessId,
        deletedAt: null,
        OR: [{ wonAt: { gte: since } }, { lostAt: { gte: since } }],
      },
      select: { value: true, status: true },
    });
    let totalWon = 0;
    let totalLost = 0;
    for (const d of closed) {
      if (d.status === 'WON') totalWon += d.value ?? 0;
      else if (d.status === 'LOST') totalLost += d.value ?? 0;
    }

    const byStage: StageForecast[] = stages
      .filter((s: any) => s.category === 'OPEN')
      .map((s: any) => {
        const agg = byStageMap.get(s.id) ?? { count: 0, total: 0 };
        const wr = winRates.get(s.id);
        const rate = wr?.rate ?? DEFAULT_STAGE_WIN_RATE[s.slug] ?? 0.2;
        return {
          stageId: s.id,
          stageName: s.name,
          stageSlug: s.slug,
          position: s.position,
          openDeals: agg.count,
          totalValue: Number(agg.total.toFixed(2)),
          winRate: Number(rate.toFixed(3)),
          weightedValue: Number((agg.total * rate).toFixed(2)),
          source: wr?.source ?? 'default',
        };
      });

    return {
      windowDays,
      windowEnd: windowEnd.toISOString(),
      currency: input.currency ?? 'TTD',
      totalOpenValue: Number(totalOpen.toFixed(2)),
      totalWeightedValue: Number(totalWeighted.toFixed(2)),
      totalWonValue: Number(totalWon.toFixed(2)),
      totalLostValue: Number(totalLost.toFixed(2)),
      expectedCloseValue: Number(expectedClose.toFixed(2)),
      expectedCloseWeightedValue: Number(expectedWeighted.toFixed(2)),
      byStage,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Compute per-stage historical win rate over the last HISTORY_DAYS. */
  async computeStageWinRates(
    businessId: string,
    stages: Array<{ id: string; slug: string; category: string }>,
  ): Promise<Map<string, { rate: number; source: 'historical' | 'default' }>> {
    const since = new Date(Date.now() - HISTORY_DAYS * MS_PER_DAY);
    const closed = await this.prisma.client.deal.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { in: ['WON', 'LOST'] },
        OR: [{ wonAt: { gte: since } }, { lostAt: { gte: since } }],
      },
      select: { stageId: true, status: true },
    });

    const closedByStage = new Map<string, { won: number; total: number }>();
    for (const d of closed) {
      const agg = closedByStage.get(d.stageId) ?? { won: 0, total: 0 };
      agg.total += 1;
      if (d.status === 'WON') agg.won += 1;
      closedByStage.set(d.stageId, agg);
    }

    const totalWon = closed.filter((d) => d.status === 'WON').length;
    const totalClosed = closed.length;
    const overallWinRate = totalClosed > 0 ? totalWon / totalClosed : 0;

    const out = new Map<string, { rate: number; source: 'historical' | 'default' }>();
    for (const s of stages) {
      if (s.category !== 'OPEN') {
        out.set(s.id, { rate: s.category === 'WON' ? 1 : 0, source: 'default' });
        continue;
      }
      const agg = closedByStage.get(s.id);
      if (agg && agg.total >= 3) {
        out.set(s.id, { rate: agg.won / agg.total, source: 'historical' });
      } else {
        const fallback = DEFAULT_STAGE_WIN_RATE[s.slug] ?? Math.max(0.05, overallWinRate);
        out.set(s.id, { rate: fallback, source: 'default' });
      }
    }
    return out;
  }
}
