import { describe, expect, it, vi } from 'vitest';
import { GenomeMemoryService } from './genome-memory.service';
import type { CreateGenomeMemoryEventInput } from './key-genome.types';

function makeService() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeMemoryEvent: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `mem_${nextId++}`, ...data, createdAt: new Date() };
          stored.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: { where: any }) => {
          return (
            stored.find(
              (r) =>
                r.businessId === where.businessId &&
                r.sourceType === where.sourceType &&
                r.sourceEntityId === where.sourceEntityId &&
                r.eventType === where.eventType,
            ) ?? null
          );
        }),
        findMany: vi.fn(async ({ where, take }: { where: any; take?: number }) => {
          let results = stored.filter((r) => r.businessId === where.businessId);
          if (where.sourceType) results = results.filter((r) => r.sourceType === where.sourceType);
          if (where.eventType) results = results.filter((r) => r.eventType === where.eventType);
          if (where.domain) results = results.filter((r) => r.domain === where.domain);
          if (where.outcome) results = results.filter((r) => r.outcome === where.outcome);
          if (where.impactScore?.gte !== undefined)
            results = results.filter((r) => r.impactScore >= where.impactScore.gte);
          return results.slice(0, take);
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return stored.find((r) => r.id === where.id) ?? null;
        }),
        count: vi.fn(async ({ where }: { where: any }) => {
          let results = stored.filter((r) => r.businessId === where.businessId);
          if (where.outcome) results = results.filter((r) => r.outcome === where.outcome);
          if (where.createdAt?.gte) {
            const since = new Date(where.createdAt.gte).getTime();
            results = results.filter((r) => new Date(r.createdAt).getTime() >= since);
          }
          return results.length;
        }),
      },
    },
  } as any;

  const service = new GenomeMemoryService(prisma);
  return { service, prisma, stored };
}

function makeInput(overrides: Partial<CreateGenomeMemoryEventInput> = {}): CreateGenomeMemoryEventInput {
  return {
    businessId: 'biz_1',
    sourceType: 'GENOME_RECOMMENDATION',
    sourceEntityId: 'rec_1',
    eventType: 'RECOMMENDATION_ACCEPTED',
    domain: 'VISION_IDENTITY',
    title: 'Recommendation accepted',
    summary: 'Founder accepted a recommendation.',
    ...overrides,
  };
}

describe('GenomeMemoryService', () => {
  it('creates a memory event', async () => {
    const { service } = makeService();
    const event = await service.createMemoryEvent(makeInput());

    expect(event.id).toMatch(/^mem_/);
    expect(event.businessId).toBe('biz_1');
    expect(event.eventType).toBe('RECOMMENDATION_ACCEPTED');
    expect(event.impactScore).toBe(0.5);
  });

  it('lists memory events by eventType', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_ACCEPTED' }));
    await service.createMemoryEvent(makeInput({ eventType: 'EXPERIMENT_COMPLETED', sourceType: 'GENOME_EXPERIMENT', sourceEntityId: 'exp_1' }));

    const results = await service.listMemoryEvents('biz_1', { eventType: 'EXPERIMENT_COMPLETED' });
    expect(results).toHaveLength(1);
    expect(results[0].eventType).toBe('EXPERIMENT_COMPLETED');
  });

  it('lists memory events by sourceType', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({ sourceType: 'GENOME_SIGNAL', sourceEntityId: 'sig_1', eventType: 'SIGNAL_MERGED' }));

    const results = await service.listMemoryEvents('biz_1', { sourceType: 'GENOME_SIGNAL' });
    expect(results).toHaveLength(1);
  });

  it('lists memory events by domain', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({ domain: 'MARKETING' }));

    const results = await service.listMemoryEvents('biz_1', { domain: 'MARKETING' });
    expect(results).toHaveLength(1);
  });

  it('gets memory event only for correct business', async () => {
    const { service } = makeService();
    const event = await service.createMemoryEvent(makeInput());

    const found = await service.getMemoryEvent('biz_1', event.id);
    expect(found.id).toBe(event.id);

    await expect(service.getMemoryEvent('biz_other', event.id)).rejects.toThrow('not found');
  });

  it('summarizes success/failure/mixed/unknown counts', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_OUTCOME_TRACKED', outcome: 'SUCCESS', sourceEntityId: 'rec_1' }));
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_OUTCOME_TRACKED', outcome: 'FAILURE', sourceEntityId: 'rec_2' }));
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_OUTCOME_TRACKED', outcome: 'MIXED', sourceEntityId: 'rec_3' }));

    const summary = await service.summarizeMemory('biz_1');
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(1);
    expect(summary.mixedCount).toBe(1);
    expect(summary.unknownCount).toBe(0);
  });

  it('computes average impact score', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({ impactScore: 0.2, sourceEntityId: 'rec_1' }));
    await service.createMemoryEvent(makeInput({ impactScore: 0.8, sourceEntityId: 'rec_2' }));

    const summary = await service.summarizeMemory('biz_1');
    expect(summary.averageImpactScore).toBe(0.5);
  });

  it('aggregates top lessons', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({
      sourceEntityId: 'rec_1',
      lessons: [{ lesson: 'Focus on clarity' }],
      impactScore: 0.8,
    }));
    await service.createMemoryEvent(makeInput({
      sourceEntityId: 'rec_2',
      lessons: [{ lesson: 'Focus on clarity' }],
      impactScore: 0.6,
    }));

    const summary = await service.summarizeMemory('biz_1');
    expect(summary.topLessons).toHaveLength(1);
    expect(summary.topLessons[0].lesson).toBe('Focus on clarity');
    expect(summary.topLessons[0].count).toBe(2);
    expect(summary.topLessons[0].averageImpactScore).toBe(0.7);
  });

  it('finds similar memory by domain and eventType', async () => {
    const { service } = makeService();
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_ACCEPTED', domain: 'FINANCIAL', sourceEntityId: 'rec_f' }));

    const results = await service.findSimilarMemory('biz_1', { domain: 'FINANCIAL', eventType: 'RECOMMENDATION_ACCEPTED' });
    expect(results).toHaveLength(1);
  });

  it('dedupes lifecycle memory events', async () => {
    const { service, stored } = makeService();
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_ACCEPTED', sourceEntityId: 'rec_1' }));
    await service.createMemoryEvent(makeInput({ eventType: 'RECOMMENDATION_ACCEPTED', sourceEntityId: 'rec_1' }));

    expect(stored).toHaveLength(1);
  });

  it('allows multiple manual lessons', async () => {
    const { service, stored } = makeService();
    await service.createMemoryEvent(makeInput({ eventType: 'MANUAL_LESSON', sourceEntityId: null }));
    await service.createMemoryEvent(makeInput({ eventType: 'MANUAL_LESSON', sourceEntityId: null }));

    expect(stored).toHaveLength(2);
  });
});
