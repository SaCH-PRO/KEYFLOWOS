import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MarginAnalysisService } from './margin-analysis.service';

export interface PricingSignal {
  productId: string;
  productName: string;
  signal: 'underpriced' | 'high_margin_promote' | 'underperforming_high_margin';
  grossMarginPct: number;
  unitsSold90d: number;
  revenue90d: number;
  reason: string;
  suggestion: string;
}

export interface PricingSignalsReport {
  businessId: string;
  generatedAt: string;
  thresholds: {
    highMarginPct: number;
    lowVolumeUnits: number;
    highVolumeUnits: number;
  };
  signals: PricingSignal[];
}

const HIGH_MARGIN_PCT = 35;
const LOW_VOLUME_UNITS = 3;
const HIGH_VOLUME_UNITS = 10;

@Injectable()
export class PricingSignalsService {
  private readonly logger = new Logger(PricingSignalsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MarginAnalysisService) private readonly margin: MarginAnalysisService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async detect(businessId: string): Promise<PricingSignalsReport> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000);

    const [products, soldRows] = await Promise.all([
      this.db.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true, price: true, costProfile: { select: { grossMargin: true } } },
        take: 200,
      }),
      this.db.invoiceItem.findMany({
        where: {
          productId: { not: null },
          invoice: {
            businessId, deletedAt: null,
            status: { in: ['PAID', 'SENT', 'PARTIALLY_PAID'] },
            issueDate: { gte: ninetyDaysAgo },
          },
        },
        select: { productId: true, quantity: true, total: true },
      }),
    ]);

    const usage = new Map<string, { units: number; revenue: number }>();
    for (const row of soldRows) {
      if (!row.productId) continue;
      const cur = usage.get(row.productId) ?? { units: 0, revenue: 0 };
      cur.units += Number(row.quantity ?? 0);
      cur.revenue += Number(row.total ?? 0);
      usage.set(row.productId, cur);
    }

    const signals: PricingSignal[] = [];
    for (const p of products) {
      const stat = usage.get(p.id) ?? { units: 0, revenue: 0 };
      const grossMarginPct = p.costProfile?.grossMargin ?? null;

      // Heuristic 1: high margin + low volume = "consider price test / promotion"
      if (
        grossMarginPct != null &&
        grossMarginPct >= HIGH_MARGIN_PCT &&
        stat.units > 0 &&
        stat.units < LOW_VOLUME_UNITS
      ) {
        signals.push({
          productId: p.id,
          productName: p.name,
          signal: 'underperforming_high_margin',
          grossMarginPct,
          unitsSold90d: stat.units,
          revenue90d: Math.round(stat.revenue * 100) / 100,
          reason:
            `${grossMarginPct}% margin but only ${stat.units} sold in 90 days. ` +
            `High value, low traction — likely a discoverability problem.`,
          suggestion: 'Consider a price test or feature this in your next campaign.',
        });
        continue;
      }

      // Heuristic 2: high margin + strong volume = "promote this"
      if (
        grossMarginPct != null &&
        grossMarginPct >= HIGH_MARGIN_PCT &&
        stat.units >= HIGH_VOLUME_UNITS
      ) {
        signals.push({
          productId: p.id,
          productName: p.name,
          signal: 'high_margin_promote',
          grossMarginPct,
          unitsSold90d: stat.units,
          revenue90d: Math.round(stat.revenue * 100) / 100,
          reason: `${grossMarginPct}% margin AND ${stat.units} units in 90 days. This is a winner.`,
          suggestion: 'Promote this in your next email/social campaign or bundle it.',
        });
        continue;
      }

      // Heuristic 3: very low margin + selling well = "underpriced"
      // (price < recommended retail with target 30% margin)
      if (
        grossMarginPct != null &&
        grossMarginPct < 15 &&
        grossMarginPct >= 0 &&
        stat.units >= HIGH_VOLUME_UNITS
      ) {
        signals.push({
          productId: p.id,
          productName: p.name,
          signal: 'underpriced',
          grossMarginPct,
          unitsSold90d: stat.units,
          revenue90d: Math.round(stat.revenue * 100) / 100,
          reason:
            `Only ${grossMarginPct}% margin but ${stat.units} sold — demand is there. ` +
            `You're leaving money on the table.`,
          suggestion: 'Test a small price increase (5–10%) to lift margin without killing demand.',
        });
      }
    }

    // High-margin signals first, then underpriced, then underperforming.
    signals.sort((a, b) => {
      const order = { high_margin_promote: 0, underpriced: 1, underperforming_high_margin: 2 };
      return order[a.signal] - order[b.signal] || b.revenue90d - a.revenue90d;
    });

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      thresholds: {
        highMarginPct: HIGH_MARGIN_PCT,
        lowVolumeUnits: LOW_VOLUME_UNITS,
        highVolumeUnits: HIGH_VOLUME_UNITS,
      },
      signals: signals.slice(0, 12),
    };
  }
}
