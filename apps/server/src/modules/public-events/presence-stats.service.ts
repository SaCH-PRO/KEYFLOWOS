import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Canonical metric names rolled up by the presence pipeline. Other
 * dimensions (path/product/source) are folded in via PresenceDailyStat
 * rows with `dimension` set to the appropriate key.
 */
export const PRESENCE_METRICS = {
  visit: 'visit',
  view: 'view',
  productView: 'product_view',
  serviceView: 'service_view',
  bookingStart: 'booking_start',
  bookingComplete: 'booking_complete',
  checkoutStart: 'checkout_start',
  checkoutComplete: 'checkout_complete',
  formSubmit: 'form_submit',
  whatsappClick: 'whatsapp_click',
  shareClick: 'share_click',
} as const;

const EVENT_TO_METRIC: Record<string, string> = {
  page_view: PRESENCE_METRICS.visit,
  view: PRESENCE_METRICS.view,
  product_view: PRESENCE_METRICS.productView,
  service_view: PRESENCE_METRICS.serviceView,
  booking_start: PRESENCE_METRICS.bookingStart,
  booking_complete: PRESENCE_METRICS.bookingComplete,
  checkout_start: PRESENCE_METRICS.checkoutStart,
  checkout_complete: PRESENCE_METRICS.checkoutComplete,
  form_submit: PRESENCE_METRICS.formSubmit,
  whatsapp_click: PRESENCE_METRICS.whatsappClick,
  share_click: PRESENCE_METRICS.shareClick,
  share: PRESENCE_METRICS.shareClick,
};

export type DimensionExtractor = {
  dimension: string;
  dimKey: string | null;
};

function dayBucket(d: Date): Date {
  const day = new Date(d);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

@Injectable()
export class PresenceStatsService {
  private readonly logger = new Logger(PresenceStatsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  metricForType(type: string): string | null {
    return EVENT_TO_METRIC[type] ?? null;
  }

  /**
   * Apply incremental roll-ups for a single just-ingested event. Hot path
   * keeps Command Center KPIs fresh without waiting for the nightly job.
   * Idempotency is "good enough" — the nightly aggregator re-derives from
   * raw events and overwrites incremental drift.
   */
  async incrementForEvent(event: {
    businessId: string;
    visitorId: string;
    type: string;
    path?: string | null;
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    referrer?: string | null;
    payload?: Prisma.JsonValue | null;
    ts?: Date;
  }) {
    const metric = this.metricForType(event.type);
    if (!metric) return;

    const day = dayBucket(event.ts ?? new Date());
    const dims: DimensionExtractor[] = [{ dimension: 'all', dimKey: 'all' }];

    if (event.path) dims.push({ dimension: 'page', dimKey: event.path.slice(0, 200) });
    if (event.source) dims.push({ dimension: 'source', dimKey: event.source.slice(0, 100) });
    if (event.medium) dims.push({ dimension: 'medium', dimKey: event.medium.slice(0, 100) });
    if (event.campaign) dims.push({ dimension: 'campaign', dimKey: event.campaign.slice(0, 100) });
    if (event.referrer) dims.push({ dimension: 'referrer', dimKey: event.referrer.slice(0, 200) });

    const payload = (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload))
      ? (event.payload as Record<string, unknown>)
      : {};
    const productId = typeof payload.productId === 'string' ? payload.productId
      : typeof payload.itemId === 'string' && (metric === PRESENCE_METRICS.productView || metric === PRESENCE_METRICS.view) ? payload.itemId
      : null;
    const serviceId = typeof payload.serviceId === 'string' ? payload.serviceId : null;
    if (productId) dims.push({ dimension: 'product', dimKey: productId.slice(0, 100) });
    if (serviceId) dims.push({ dimension: 'service', dimKey: serviceId.slice(0, 100) });

    const isFirstSeenToday = await this.isVisitorFirstSeenForMetric({
      businessId: event.businessId,
      visitorId: event.visitorId,
      metric,
      day,
    });

    for (const d of dims) {
      if (!d.dimKey) continue;
      try {
        await this.prisma.client.presenceDailyStat.upsert({
          where: {
            businessId_day_metric_dimension_dimKey: {
              businessId: event.businessId,
              day,
              metric,
              dimension: d.dimension,
              dimKey: d.dimKey,
            },
          },
          create: {
            businessId: event.businessId,
            day,
            metric,
            dimension: d.dimension,
            dimKey: d.dimKey,
            count: 1,
            uniques: isFirstSeenToday ? 1 : 0,
          },
          update: {
            count: { increment: 1 },
            ...(isFirstSeenToday ? { uniques: { increment: 1 } } : {}),
          },
        });
      } catch (err) {
        this.logger.debug?.(`[presence] upsert skipped ${(err as Error).message}`);
      }
    }
  }

  /**
   * Whether this visitor already produced an event of this metric earlier
   * today. Used to populate the `uniques` column.
   */
  private async isVisitorFirstSeenForMetric(input: {
    businessId: string;
    visitorId: string;
    metric: string;
    day: Date;
  }): Promise<boolean> {
    const start = new Date(input.day);
    const end = new Date(input.day);
    end.setUTCDate(end.getUTCDate() + 1);
    const types = Object.entries(EVENT_TO_METRIC)
      .filter(([, v]) => v === input.metric)
      .map(([k]) => k);
    const prior = await this.prisma.client.publicEvent.count({
      where: {
        businessId: input.businessId,
        visitorId: input.visitorId,
        type: { in: types },
        ts: { gte: start, lt: end },
      },
    });
    // count==1 means *this* event is the only one; treat as the first.
    return prior <= 1;
  }

  /**
   * Re-derive PresenceDailyStat rows for the given UTC day from raw
   * PublicEvent rows. Overwrites any incremental drift. Safe to re-run.
   */
  async aggregateDay(businessId: string, day: Date) {
    const start = dayBucket(day);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const rows = await this.prisma.client.publicEvent.findMany({
      where: { businessId, ts: { gte: start, lt: end } },
      select: {
        type: true, visitorId: true, path: true, source: true,
        medium: true, campaign: true, referrer: true, payload: true,
      },
    });

    type Bucket = { count: number; visitors: Set<string> };
    const buckets = new Map<string, Bucket>();
    const key = (m: string, dim: string, k: string) => `${m}\u0001${dim}\u0001${k}`;

    for (const ev of rows) {
      const metric = this.metricForType(ev.type);
      if (!metric) continue;
      const payload = (ev.payload && typeof ev.payload === 'object' && !Array.isArray(ev.payload))
        ? (ev.payload as Record<string, unknown>)
        : {};
      const dims: Array<[string, string | null]> = [
        ['all', 'all'],
        ['page', ev.path ?? null],
        ['source', ev.source ?? null],
        ['medium', ev.medium ?? null],
        ['campaign', ev.campaign ?? null],
        ['referrer', ev.referrer ?? null],
        ['product', typeof payload.productId === 'string' ? payload.productId : (typeof payload.itemId === 'string' ? payload.itemId : null)],
        ['service', typeof payload.serviceId === 'string' ? payload.serviceId : null],
      ];
      for (const [dim, k] of dims) {
        if (!k) continue;
        const bk = key(metric, dim, k.slice(0, 200));
        let bucket = buckets.get(bk);
        if (!bucket) {
          bucket = { count: 0, visitors: new Set() };
          buckets.set(bk, bucket);
        }
        bucket.count++;
        bucket.visitors.add(ev.visitorId);
      }
    }

    // Replace-in-transaction: delete then recreate the day's rows so
    // dimensions/keys that disappeared between runs do not linger.
    let written = 0;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.presenceDailyStat.deleteMany({
        where: { businessId, day: start },
      });
      for (const [k, bucket] of buckets) {
        const [metric, dim, dimKey] = k.split('\u0001');
        await tx.presenceDailyStat.create({
          data: {
            businessId, day: start, metric, dimension: dim, dimKey,
            count: bucket.count, uniques: bucket.visitors.size,
          },
        });
        written++;
      }
    });

    return { businessId, day: start.toISOString(), aggregated: written, eventsScanned: rows.length };
  }

  /**
   * Aggregate the prior UTC day across every business that produced
   * events. Idempotent.
   */
  async aggregateYesterdayAllBusinesses(): Promise<{ businesses: number; rows: number }> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const day = dayBucket(yesterday);
    const end = new Date(day);
    end.setUTCDate(end.getUTCDate() + 1);

    const rows = await this.prisma.client.publicEvent.findMany({
      where: { ts: { gte: day, lt: end } },
      select: { businessId: true },
      distinct: ['businessId'],
    });
    let total = 0;
    for (const { businessId } of rows) {
      const result = await this.aggregateDay(businessId, day);
      total += result.aggregated;
    }
    return { businesses: rows.length, rows: total };
  }

  /**
   * Delete raw PublicEvent rows older than the retention window (default
   * 90 days). Daily aggregates are kept indefinitely.
   */
  async cleanupRawEvents(retentionDays = 90): Promise<{ deleted: number }> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
    const result = await this.prisma.client.publicEvent.deleteMany({
      where: { ts: { lt: cutoff } },
    });
    return { deleted: result.count };
  }

  /**
   * Command Center KPI rollup for the last `days` UTC days.
   */
  async overview(businessId: string, days = 30) {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    const [aggRows, recentRaw] = await Promise.all([
      this.prisma.client.presenceDailyStat.findMany({
        where: { businessId, day: { gte: start, lt: end }, dimension: 'all' },
        select: { day: true, metric: true, count: true, uniques: true },
      }),
      this.prisma.client.publicEvent.groupBy({
        by: ['type'],
        where: { businessId, ts: { gte: start } },
        _count: true,
      }),
    ]);

    const totals: Record<string, { count: number; uniques: number }> = {};
    const series: Record<string, Array<{ day: string; count: number; uniques: number }>> = {};
    for (const r of aggRows) {
      const t = totals[r.metric] ?? { count: 0, uniques: 0 };
      t.count += r.count;
      t.uniques += r.uniques;
      totals[r.metric] = t;
      const s = series[r.metric] ?? [];
      s.push({ day: r.day.toISOString().slice(0, 10), count: r.count, uniques: r.uniques });
      series[r.metric] = s;
    }
    for (const k of Object.keys(series)) series[k].sort((a, b) => a.day.localeCompare(b.day));

    // Surface raw events as a fallback when nightly agg has not yet run.
    const rawTotals: Record<string, number> = {};
    for (const r of recentRaw) {
      const m = this.metricForType(r.type);
      if (!m) continue;
      // Prisma's `groupBy({ _count: true })` returns a number on most
      // versions but `{ _all: number }` on others — handle both shapes
      // so KPI fallbacks stay correct across upgrades.
      const c = r._count as number | { _all?: number } | undefined;
      const n = typeof c === 'number' ? c : (c?._all ?? 0);
      rawTotals[m] = (rawTotals[m] ?? 0) + n;
    }

    return {
      period: { days, since: start.toISOString(), until: end.toISOString() },
      totals,
      rawTotals,
      series,
    };
  }

  /**
   * `/reports/presence/sources` — top first-touch & UTM sources.
   */
  async reportSources(businessId: string, days = 30) {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
    const rows = await this.prisma.client.presenceDailyStat.findMany({
      where: {
        businessId, day: { gte: start, lt: end },
        dimension: { in: ['source', 'medium', 'campaign', 'referrer'] },
        metric: PRESENCE_METRICS.visit,
      },
      select: { dimension: true, dimKey: true, count: true, uniques: true },
    });
    const out: Record<string, Array<{ key: string; count: number; uniques: number }>> = {};
    const acc: Record<string, Map<string, { count: number; uniques: number }>> = {};
    for (const r of rows) {
      acc[r.dimension] ??= new Map();
      const m = acc[r.dimension];
      const cur = m.get(r.dimKey) ?? { count: 0, uniques: 0 };
      cur.count += r.count;
      cur.uniques += r.uniques;
      m.set(r.dimKey, cur);
    }
    for (const dim of Object.keys(acc)) {
      out[dim] = Array.from(acc[dim].entries())
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 25);
    }
    return { period: { days }, sources: out };
  }

  /**
   * `/reports/presence/pages` — most-visited pages and items.
   */
  async reportPages(businessId: string, days = 30) {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
    const rows = await this.prisma.client.presenceDailyStat.findMany({
      where: {
        businessId, day: { gte: start, lt: end },
        dimension: { in: ['page', 'product', 'service'] },
      },
      select: { dimension: true, dimKey: true, metric: true, count: true, uniques: true },
    });
    const groups: Record<string, Map<string, { count: number; uniques: number; metrics: Record<string, number> }>> = {};
    for (const r of rows) {
      groups[r.dimension] ??= new Map();
      const cur = groups[r.dimension].get(r.dimKey) ?? { count: 0, uniques: 0, metrics: {} };
      cur.count += r.count;
      cur.uniques += r.uniques;
      cur.metrics[r.metric] = (cur.metrics[r.metric] ?? 0) + r.count;
      groups[r.dimension].set(r.dimKey, cur);
    }
    const out: Record<string, Array<{ key: string; count: number; uniques: number; metrics: Record<string, number> }>> = {};
    for (const dim of Object.keys(groups)) {
      out[dim] = Array.from(groups[dim].entries())
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);
    }
    return { period: { days }, pages: out };
  }

  /**
   * `/reports/presence/funnel` — visit → view → checkout/booking start →
   * complete with daily series and conversion rates.
   */
  async reportFunnel(businessId: string, days = 30) {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
    const rows = await this.prisma.client.presenceDailyStat.findMany({
      where: { businessId, day: { gte: start, lt: end }, dimension: 'all' },
      select: { day: true, metric: true, count: true, uniques: true },
    });
    const totals: Record<string, number> = {};
    const dailyByMetric: Record<string, Map<string, number>> = {};
    for (const r of rows) {
      totals[r.metric] = (totals[r.metric] ?? 0) + r.count;
      dailyByMetric[r.metric] ??= new Map();
      const k = r.day.toISOString().slice(0, 10);
      dailyByMetric[r.metric].set(k, (dailyByMetric[r.metric].get(k) ?? 0) + r.count);
    }
    const order = [
      PRESENCE_METRICS.visit,
      PRESENCE_METRICS.view,
      PRESENCE_METRICS.checkoutStart,
      PRESENCE_METRICS.checkoutComplete,
      PRESENCE_METRICS.bookingStart,
      PRESENCE_METRICS.bookingComplete,
      PRESENCE_METRICS.formSubmit,
    ];
    let prev = 0;
    const stages = order.map((metric, i) => {
      const count = totals[metric] ?? 0;
      const conversion = i === 0 ? 100 : (prev > 0 ? Math.round((count / prev) * 1000) / 10 : 0);
      prev = count;
      return { metric, count, conversionFromPrev: conversion };
    });
    return { period: { days }, totals, stages };
  }
}
