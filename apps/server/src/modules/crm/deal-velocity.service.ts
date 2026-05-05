import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const MS_PER_DAY = 86_400_000;

export interface StageVelocity {
  stageId: string;
  stageName: string;
  stageSlug: string;
  category: string;
  position: number;
  sampleSize: number;
  avgDaysInStage: number;
  medianDaysInStage: number;
  p90DaysInStage: number;
  outlierThresholdDays: number;
  openDeals: number;
}

export interface VelocityReport {
  stages: StageVelocity[];
  outliers: Array<{
    dealId: string;
    title: string;
    stageId: string;
    stageName: string;
    daysInStage: number;
    avgDaysInStage: number;
    multiple: number;
    value: number | null;
    currency: string;
    contact: { id: string; displayName: string | null } | null;
  }>;
  generatedAt: string;
}

const STAGE_HISTORY_DAYS = 180;

@Injectable()
export class DealVelocityService {
  private readonly logger = new Logger(DealVelocityService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Average days a closed deal spent in each stage (proxy: createdAt → lastStageChangedAt for OPEN; → wonAt/lostAt for closed). */
  async getReport(businessId: string): Promise<VelocityReport> {
    const stages = await this.prisma.client.dealStage.findMany({
      where: { businessId, archivedAt: null },
      orderBy: [{ position: 'asc' }],
    });

    const since = new Date(Date.now() - STAGE_HISTORY_DAYS * MS_PER_DAY);
    const recentDeals = await this.prisma.client.deal.findMany({
      where: {
        businessId,
        deletedAt: null,
        OR: [{ wonAt: { gte: since } }, { lostAt: { gte: since } }, { lastStageChangedAt: { gte: since } }],
      },
      select: {
        id: true,
        stageId: true,
        status: true,
        createdAt: true,
        lastStageChangedAt: true,
        wonAt: true,
        lostAt: true,
      },
    });

    const byStage = new Map<string, number[]>();
    for (const d of recentDeals) {
      const start = (d.lastStageChangedAt ?? d.createdAt).getTime();
      const end = (d.wonAt ?? d.lostAt ?? new Date()).getTime();
      const days = Math.max(0, Math.floor((end - start) / MS_PER_DAY));
      const arr = byStage.get(d.stageId) ?? [];
      arr.push(days);
      byStage.set(d.stageId, arr);
    }

    const openCounts = await this.prisma.client.deal.groupBy({
      by: ['stageId'],
      where: { businessId, deletedAt: null, status: 'OPEN' },
      _count: { _all: true },
    });
    const openByStage = new Map(openCounts.map((r: any) => [r.stageId as string, r._count._all as number]));

    const stageVelocity: StageVelocity[] = stages.map((s: any) => {
      const samples = (byStage.get(s.id) ?? []).slice().sort((a, b) => a - b);
      const sum = samples.reduce((acc, n) => acc + n, 0);
      const avg = samples.length ? sum / samples.length : 0;
      const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
      const p90 = samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.9))] : 0;
      return {
        stageId: s.id,
        stageName: s.name,
        stageSlug: s.slug,
        category: s.category,
        position: s.position,
        sampleSize: samples.length,
        avgDaysInStage: Number(avg.toFixed(1)),
        medianDaysInStage: median,
        p90DaysInStage: p90,
        outlierThresholdDays: Math.max(7, Math.round(avg * 1.5)),
        openDeals: Number(openByStage.get(s.id) ?? 0),
      };
    });

    const stageVelocityById = new Map(stageVelocity.map((s) => [s.stageId, s]));
    const openOpenDeals = await this.prisma.client.deal.findMany({
      where: { businessId, deletedAt: null, status: 'OPEN' },
      select: {
        id: true,
        title: true,
        stageId: true,
        value: true,
        currency: true,
        createdAt: true,
        lastStageChangedAt: true,
        contact: { select: { id: true, displayName: true, firstName: true, lastName: true } },
        stage: { select: { name: true } },
      },
    });

    const outliers: VelocityReport['outliers'] = [];
    const now = Date.now();
    for (const d of openOpenDeals) {
      const sv = stageVelocityById.get(d.stageId);
      if (!sv || sv.avgDaysInStage <= 0) continue;
      const start = (d.lastStageChangedAt ?? d.createdAt).getTime();
      const days = Math.floor((now - start) / MS_PER_DAY);
      if (days >= sv.outlierThresholdDays) {
        outliers.push({
          dealId: d.id,
          title: d.title,
          stageId: d.stageId,
          stageName: sv.stageName,
          daysInStage: days,
          avgDaysInStage: sv.avgDaysInStage,
          multiple: Number((days / Math.max(1, sv.avgDaysInStage)).toFixed(2)),
          value: d.value,
          currency: d.currency,
          contact: d.contact
            ? { id: d.contact.id, displayName: d.contact.displayName ?? (`${d.contact.firstName ?? ''} ${d.contact.lastName ?? ''}`.trim() || null) }
            : null,
        });
      }
    }
    outliers.sort((a, b) => b.multiple - a.multiple);

    return { stages: stageVelocity, outliers: outliers.slice(0, 50), generatedAt: new Date().toISOString() };
  }

  /** Returns avg days in each stage as a Map for use by other services (health, bottleneck). */
  async getStageAverages(businessId: string): Promise<Map<string, number>> {
    const report = await this.getReport(businessId);
    return new Map(report.stages.map((s) => [s.stageId, s.avgDaysInStage]));
  }
}
