import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

interface ProjectionPoint {
  period: string;
  projected: number;
  lowerBound: number;
  upperBound: number;
}

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async generateRevenueProjection(businessId: string, months = 3) {
    // Get last 3 months of revenue as baseline
    const snapshots = await this.prisma.client.businessSnapshot.findMany({
      where: { businessId, snapshotType: 'monthly' },
      orderBy: { snapshotDate: 'desc' },
      take: 3,
      select: { totalRevenue: true, snapshotDate: true },
    });

    const baselineValues = snapshots
      .reverse()
      .map((s) => Number(s.totalRevenue ?? 0));

    const avgBaseline = baselineValues.length > 0
      ? baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length
      : 0;

    const growthRate = this.computeGrowthRate(baselineValues);
    const volatility = this.computeVolatility(baselineValues);

    const projectedValues: ProjectionPoint[] = [];
    const now = new Date();

    for (let i = 1; i <= months; i++) {
      const periodDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const period = periodDate.toISOString().slice(0, 7); // YYYY-MM
      const projected = avgBaseline * Math.pow(1 + growthRate, i);
      const margin = projected * (volatility + 0.1);

      projectedValues.push({
        period,
        projected: Math.round(projected * 100) / 100,
        lowerBound: Math.round(Math.max(0, projected - margin) * 100) / 100,
        upperBound: Math.round((projected + margin) * 100) / 100,
      });
    }

    const projection = await this.prisma.client.projection.create({
      data: {
        businessId,
        projectionType: 'revenue',
        period: 'monthly',
        startDate: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        endDate: new Date(now.getFullYear(), now.getMonth() + months, 1),
        baselineValue: avgBaseline,
        baselinePeriods: baselineValues as any,
        projectedValues: projectedValues as any,
        confidenceInterval: { growthRate, volatility } as any,
        growthAssumption: growthRate,
      },
    });

    return projection;
  }

  async generateContactGrowthProjection(businessId: string, months = 3) {
    const snapshots = await this.prisma.client.businessSnapshot.findMany({
      where: { businessId, snapshotType: 'monthly' },
      orderBy: { snapshotDate: 'desc' },
      take: 3,
      select: { totalContacts: true, newContacts: true, snapshotDate: true },
    });

    const baselineNew = snapshots
      .reverse()
      .map((s) => s.newContacts ?? 0);

    const avgNew = baselineNew.length > 0
      ? baselineNew.reduce((a, b) => a + b, 0) / baselineNew.length
      : 0;

    const growthRate = this.computeGrowthRate(baselineNew.map((v) => Number(v)));

    const projectedValues: ProjectionPoint[] = [];
    const now = new Date();
    let cumulative = Number(snapshots[0]?.totalContacts ?? 0);

    for (let i = 1; i <= months; i++) {
      const periodDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const period = periodDate.toISOString().slice(0, 7);
      const newContacts = Math.max(0, avgNew * Math.pow(1 + growthRate, i));
      cumulative += newContacts;
      const margin = newContacts * 0.3;

      projectedValues.push({
        period,
        projected: Math.round(cumulative),
        lowerBound: Math.round(Math.max(0, cumulative - margin)),
        upperBound: Math.round(cumulative + margin),
      });
    }

    const projection = await this.prisma.client.projection.create({
      data: {
        businessId,
        projectionType: 'contacts',
        period: 'monthly',
        startDate: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        endDate: new Date(now.getFullYear(), now.getMonth() + months, 1),
        baselineValue: avgNew,
        baselinePeriods: baselineNew as any,
        projectedValues: projectedValues as any,
        confidenceInterval: { growthRate } as any,
        growthAssumption: growthRate,
      },
    });

    return projection;
  }

  async getLatestProjections(businessId: string) {
    const [revenue, contacts, bookings, cashflow] = await Promise.all([
      this.prisma.client.projection.findFirst({
        where: { businessId, projectionType: 'revenue' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.projection.findFirst({
        where: { businessId, projectionType: 'contacts' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.projection.findFirst({
        where: { businessId, projectionType: 'bookings' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.projection.findFirst({
        where: { businessId, projectionType: 'cashflow' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { revenue, contacts, bookings, cashflow };
  }

  private computeGrowthRate(values: number[]): number {
    if (values.length < 2) return 0;
    const first = values[0];
    const last = values[values.length - 1];
    if (first === 0) return last > 0 ? 1 : 0;
    return (last - first) / first;
  }

  private computeVolatility(values: number[]): number {
    if (values.length < 2) return 0.1;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0.1;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return stdDev / mean;
  }
}
