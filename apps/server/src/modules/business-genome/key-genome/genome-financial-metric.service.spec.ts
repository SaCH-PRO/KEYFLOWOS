import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GenomeFinancialMetricService } from './genome-financial-metric.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeFinancialMetric: {
        upsert: vi.fn().mockImplementation(({ where, create, update }: { where: any; create: any; update: any }) => {
          const businessId = where.businessId_metricType_period.businessId;
          const metricType = where.businessId_metricType_period.metricType;
          const period = where.businessId_metricType_period.period;
          const idx = stored.findIndex(
            (r) => r.businessId === businessId && r.metricType === metricType && r.period === period,
          );
          const now = new Date();
          if (idx === -1) {
            const row = {
              id: `finm_${nextId++}`,
              ...create,
              businessId,
              metricType,
              period,
              createdAt: create.createdAt ?? now,
              updatedAt: create.updatedAt ?? now,
            };
            stored.push(row);
            return Promise.resolve(row);
          }
          stored[idx] = { ...stored[idx], ...update, updatedAt: now };
          return Promise.resolve(stored[idx]);
        }),
        findMany: vi.fn().mockImplementation(({ where, orderBy, take }: { where?: any; orderBy?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.metricType) {
            results = results.filter((r) => r.metricType === where.metricType);
          }
          if (where?.period !== undefined) {
            results = results.filter((r) => r.period === where.period);
          }
          if (where?.currency) {
            results = results.filter((r) => r.currency === where.currency);
          }
          if (where?.confidence?.gte !== undefined) {
            results = results.filter((r) => r.confidence >= where.confidence.gte);
          }
          results.sort((a, b) => {
            const aDate = a.occurredAt ?? a.createdAt;
            const bDate = b.occurredAt ?? b.createdAt;
            return bDate.getTime() - aDate.getTime();
          });
          if (take) {
            results = results.slice(0, take);
          }
          return Promise.resolve(results);
        }),
        findFirst: vi.fn().mockImplementation(({ where, orderBy }: { where: any; orderBy?: any }) => {
          let results = [...stored];
          if (where.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where.metricType) {
            results = results.filter((r) => r.metricType === where.metricType);
          }
          results.sort((a, b) => {
            const aDate = a.occurredAt ?? a.createdAt;
            const bDate = b.occurredAt ?? b.createdAt;
            return bDate.getTime() - aDate.getTime();
          });
          return Promise.resolve(results[0] ?? null);
        }),
        findUnique: vi.fn().mockImplementation(({ where }: { where: any }) => {
          return Promise.resolve(stored.find((r) => r.id === where.id) ?? null);
        }),
        delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          const idx = stored.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          stored.splice(idx, 1);
          return Promise.resolve({});
        }),
      },
    },
  } as any;

  return { prisma, stored };
}

function makeService() {
  const { prisma, stored } = makePrisma();
  const service = new GenomeFinancialMetricService(prisma);
  return { service, prisma, stored };
}

describe('GenomeFinancialMetricService', () => {
  it('creates a metric', async () => {
    const { service } = makeService();
    const metric = await service.upsertMetric({
      businessId: 'biz_1',
      metricType: 'REVENUE',
      value: 10000,
      currency: 'TTD',
      confidence: 0.9,
    });

    expect(metric.businessId).toBe('biz_1');
    expect(metric.metricType).toBe('REVENUE');
    expect(metric.value).toBe(10000);
    expect(metric.currency).toBe('TTD');
    expect(metric.confidence).toBe(0.9);
  });

  it('updates an existing metric by businessId + metricType + period', async () => {
    const { service } = makeService();
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'CASH_ON_HAND', value: 5000 });
    const updated = await service.upsertMetric({
      businessId: 'biz_1',
      metricType: 'CASH_ON_HAND',
      value: 7500,
      confidence: 0.95,
    });

    expect(updated.value).toBe(7500);
    expect(updated.confidence).toBe(0.95);
  });

  it('lists metrics by type', async () => {
    const { service } = makeService();
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1000 });
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'NET_PROFIT', value: -200 });

    const revenue = await service.listMetrics('biz_1', { metricType: 'REVENUE' });
    expect(revenue).toHaveLength(1);
    expect(revenue[0].metricType).toBe('REVENUE');
  });

  it('lists metrics by period', async () => {
    const { service } = makeService();
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1000, period: '2026-06' });
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1200, period: '2026-07' });

    const june = await service.listMetrics('biz_1', { period: '2026-06' });
    expect(june).toHaveLength(1);
    expect(june[0].period).toBe('2026-06');
  });

  it('gets latest metric by type', async () => {
    const { service } = makeService();
    await service.upsertMetric({
      businessId: 'biz_1',
      metricType: 'CASH_ON_HAND',
      value: 1000,
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    await service.upsertMetric({
      businessId: 'biz_1',
      metricType: 'CASH_ON_HAND',
      value: 2000,
      occurredAt: '2026-02-01T00:00:00.000Z',
    });

    const latest = await service.getLatestMetric('biz_1', 'CASH_ON_HAND');
    expect(latest?.value).toBe(2000);
  });

  it('returns latest metrics by type map', async () => {
    const { service } = makeService();
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1000 });
    await service.upsertMetric({ businessId: 'biz_1', metricType: 'NET_PROFIT', value: -100 });

    const map = await service.getLatestMetricsByType('biz_1');
    expect(map.REVENUE.value).toBe(1000);
    expect(map.NET_PROFIT.value).toBe(-100);
  });

  it('clamps confidence to 0–1', async () => {
    const { service } = makeService();
    const low = await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1, confidence: -0.5 });
    const high = await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1, confidence: 1.5 });

    expect(low.confidence).toBe(0);
    expect(high.confidence).toBe(1);
  });

  it('supports negative net profit', async () => {
    const { service } = makeService();
    const metric = await service.upsertMetric({ businessId: 'biz_1', metricType: 'NET_PROFIT', value: -500 });
    expect(metric.value).toBe(-500);
  });

  it('deletes a metric with ownership check', async () => {
    const { service, stored } = makeService();
    const metric = await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1000 });

    await service.deleteMetric('biz_1', metric.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a metric from another business', async () => {
    const { service } = makeService();
    const metric = await service.upsertMetric({ businessId: 'biz_1', metricType: 'REVENUE', value: 1000 });

    await expect(service.deleteMetric('biz_2', metric.id)).rejects.toThrow(NotFoundException);
  });
});
