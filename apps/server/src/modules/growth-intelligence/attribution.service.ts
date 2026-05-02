import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear';
export type AttributionDimension = 'channel' | 'source' | 'campaign';

interface ComputeOptions {
  businessId: string;
  periodStart?: Date;
  periodEnd?: Date;
  models?: AttributionModel[];
  dimensions?: AttributionDimension[];
}

const DEFAULT_MODELS: AttributionModel[] = ['first_touch', 'last_touch', 'linear'];
const DEFAULT_DIMENSIONS: AttributionDimension[] = ['channel', 'source', 'campaign'];

function toNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val !== null && val !== undefined && typeof val === 'object' && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val ?? 0);
}

interface Bucket {
  attributedRevenue: number;
  conversions: Set<string>; // unique journeyIds with conversion
  touchpoints: number;
  contacts: Set<string>;
  label?: string;
}

@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async compute(opts: ComputeOptions) {
    const periodEnd = opts.periodEnd ?? new Date();
    const periodStart = opts.periodStart ?? new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    const models = opts.models ?? DEFAULT_MODELS;
    const dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;

    // Pull all converted journeys + their touchpoints in window
    const journeys = await this.db.customerJourney.findMany({
      where: {
        businessId: opts.businessId,
        convertedAt: { gte: periodStart, lte: periodEnd },
      },
      include: { touchpoints: { orderBy: { occurredAt: 'asc' } } },
    });

    const results: Array<{
      dimension: AttributionDimension;
      dimensionKey: string;
      dimensionLabel: string | null;
      model: AttributionModel;
      attributedRevenue: number;
      conversions: number;
      touchpoints: number;
      uniqueContacts: number;
    }> = [];

    for (const dimension of dimensions) {
      for (const model of models) {
        const buckets = new Map<string, Bucket>();

        for (const journey of journeys) {
          const conversionValue = toNumber(journey.totalRevenue);
          if (conversionValue <= 0) continue;
          const tps = journey.touchpoints;
          if (tps.length === 0) continue;

          for (const tp of tps) {
            const key = dimension === 'channel' ? tp.channel
              : dimension === 'source' ? tp.source
              : (tp.campaignId ?? tp.campaignName ?? 'no_campaign');
            const label = dimension === 'campaign' ? (tp.campaignName ?? null) : null;
            if (!key) continue;

            const weight = model === 'first_touch' ? tp.firstTouchWeight
              : model === 'last_touch' ? tp.lastTouchWeight
              : tp.linearWeight;

            if (weight <= 0) continue;

            const bucket = buckets.get(key) ?? {
              attributedRevenue: 0,
              conversions: new Set(),
              touchpoints: 0,
              contacts: new Set(),
              label: label ?? undefined,
            };
            bucket.attributedRevenue += conversionValue * weight;
            bucket.touchpoints += 1;
            bucket.conversions.add(journey.id);
            bucket.contacts.add(journey.contactId);
            if (label && !bucket.label) bucket.label = label;
            buckets.set(key, bucket);
          }
        }

        for (const [key, bucket] of buckets) {
          results.push({
            dimension,
            dimensionKey: key,
            dimensionLabel: bucket.label ?? null,
            model,
            attributedRevenue: Math.round(bucket.attributedRevenue * 100) / 100,
            conversions: bucket.conversions.size,
            touchpoints: bucket.touchpoints,
            uniqueContacts: bucket.contacts.size,
          });
        }
      }
    }

    // Persist as upserts
    for (const r of results) {
      await this.db.attributionResult.upsert({
        where: {
          businessId_dimension_dimensionKey_model_periodStart_periodEnd: {
            businessId: opts.businessId,
            dimension: r.dimension,
            dimensionKey: r.dimensionKey,
            model: r.model,
            periodStart,
            periodEnd,
          },
        },
        create: {
          businessId: opts.businessId,
          dimension: r.dimension,
          dimensionKey: r.dimensionKey,
          dimensionLabel: r.dimensionLabel,
          model: r.model,
          periodStart,
          periodEnd,
          attributedRevenue: r.attributedRevenue,
          conversions: r.conversions,
          touchpoints: r.touchpoints,
          uniqueContacts: r.uniqueContacts,
          computedAt: new Date(),
        },
        update: {
          dimensionLabel: r.dimensionLabel,
          attributedRevenue: r.attributedRevenue,
          conversions: r.conversions,
          touchpoints: r.touchpoints,
          uniqueContacts: r.uniqueContacts,
          computedAt: new Date(),
        },
      });
    }

    return {
      periodStart,
      periodEnd,
      computed: results.length,
      results,
    };
  }

  async getResults(opts: {
    businessId: string;
    model?: AttributionModel;
    dimension?: AttributionDimension;
    periodStart?: Date;
    periodEnd?: Date;
  }) {
    const records = await this.db.attributionResult.findMany({
      where: {
        businessId: opts.businessId,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.dimension ? { dimension: opts.dimension } : {}),
        ...(opts.periodStart ? { periodStart: { gte: opts.periodStart } } : {}),
        ...(opts.periodEnd ? { periodEnd: { lte: opts.periodEnd } } : {}),
      },
      orderBy: [{ periodEnd: 'desc' }, { attributedRevenue: 'desc' }],
      take: 200,
    });
    return records.map(r => ({
      id: r.id,
      dimension: r.dimension,
      dimensionKey: r.dimensionKey,
      dimensionLabel: r.dimensionLabel,
      model: r.model,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      attributedRevenue: toNumber(r.attributedRevenue),
      conversions: r.conversions,
      touchpoints: r.touchpoints,
      uniqueContacts: r.uniqueContacts,
      roas: r.roas,
    }));
  }

  /**
   * Returns the top attributed channels for each model — used by the dashboard "Attribution
   * Comparison" widget.
   */
  async getModelComparison(businessId: string, dimension: AttributionDimension = 'channel', limit = 8) {
    const latest = await this.db.attributionResult.findMany({
      where: { businessId, dimension },
      orderBy: { computedAt: 'desc' },
      take: 500,
    });
    if (latest.length === 0) return { dimension, periods: [], byModel: {} };

    const periodEnd = latest[0].periodEnd;
    const periodStart = latest[0].periodStart;
    const inWindow = latest.filter(r => r.periodEnd.getTime() === periodEnd.getTime());

    const byModel: Record<string, Array<{ key: string; label: string | null; revenue: number; conversions: number }>> = {};
    for (const r of inWindow) {
      byModel[r.model] = byModel[r.model] ?? [];
      byModel[r.model].push({
        key: r.dimensionKey,
        label: r.dimensionLabel,
        revenue: toNumber(r.attributedRevenue),
        conversions: r.conversions,
      });
    }
    for (const k of Object.keys(byModel)) {
      byModel[k] = byModel[k].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
    }
    return { dimension, periodStart, periodEnd, byModel };
  }
}
