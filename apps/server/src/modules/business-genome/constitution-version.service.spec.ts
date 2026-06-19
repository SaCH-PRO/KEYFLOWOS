import { describe, expect, it, vi } from 'vitest';
import { ConstitutionVersionService } from './constitution-version.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import type { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import type { GenomeIntegrityResult } from '../blueprint/blueprint.types';

function makeService(store: any[] = []) {
  const constitutionCreate = vi.fn(async ({ data }: any) => {
    const record = {
      id: `const_${store.length + 1}`,
      ...data,
      summary: data.summary ?? null,
      changeNotes: data.changeNotes ?? null,
      sourceGenomeIntegrity: data.sourceGenomeIntegrity ?? null,
      sourceExecutiveReadiness: data.sourceExecutiveReadiness ?? null,
      sourceGenomeStage: data.sourceGenomeStage ?? null,
      sourceDnaScores: data.sourceDnaScores ?? null,
      sourceDnaConfidence: data.sourceDnaConfidence ?? null,
      generatedBy: data.generatedBy ?? null,
      generatedAt: new Date(),
      createdAt: new Date(),
    };
    store.push(record);
    return record;
  });

  const constitutionUpdate = vi.fn(async ({ where, data }: any) => {
    const existing = store.find((r) => r.id === where.id);
    if (!existing) throw new Error('not found');
    Object.assign(existing, data);
    return existing;
  });

  const constitutionUpdateMany = vi.fn(async ({ where, data }: any) => {
    let count = 0;
    for (const r of store) {
      if (r.businessId === where.businessId && (!where.status || r.status === where.status)) {
        Object.assign(r, data);
        count++;
      }
    }
    return { count };
  });

  const constitutionFindFirst = vi.fn(async ({ where, orderBy, select }: any) => {
    let results = store.filter((r) => r.businessId === where.businessId);
    if (where.status) results = results.filter((r) => r.status === where.status);
    if (orderBy?.version === 'desc') results.sort((a, b) => b.version - a.version);
    const found = results[0];
    if (select) {
      const projected: any = {};
      for (const key of Object.keys(select)) projected[key] = found?.[key];
      return projected ?? null;
    }
    return found ?? null;
  });

  const constitutionFindUnique = vi.fn(async ({ where }: any) => {
    if (where.businessId_version) {
      return (
        store.find(
          (r) =>
            r.businessId === where.businessId_version.businessId &&
            r.version === where.businessId_version.version,
        ) ?? null
      );
    }
    return store.find((r) => r.id === where.id) ?? null;
  });

  const constitutionFindMany = vi.fn(async ({ where }: any) => {
    return store.filter((r) => r.businessId === where.businessId).sort((a, b) => b.version - a.version);
  });

  const prisma = {
    client: {
      businessConstitutionVersion: {
        create: constitutionCreate,
        update: constitutionUpdate,
        updateMany: constitutionUpdateMany,
        findFirst: constitutionFindFirst,
        findUnique: constitutionFindUnique,
        findMany: constitutionFindMany,
      },
    },
  } as unknown as PrismaService;

  const genomeResult: GenomeIntegrityResult = {
    genomeIntegrity: 70,
    executiveReadinessScore: 65,
    genomeStage: 'OPERATING_BUSINESS',
    genomeDnaScores: { founder: 80, business: 60, market: 90 } as Record<string, number>,
    genomeDnaConfidence: { founder: 0.8, business: 0.6, market: 0.9 } as Record<string, number>,
    threePillarMinimumMet: true,
    dnaSections: [],
    readinessBreakdown: {},
  };

  const blueprint = {
    generateConstitution: vi.fn().mockResolvedValue({
      businessId: 'biz_1',
      generatedAt: new Date().toISOString(),
      sections: { executiveSummary: { title: 'Executive Summary', content: '...' } },
    }),
    calculateGenomeIntegrity: vi.fn().mockResolvedValue(genomeResult),
  } as unknown as BlueprintService;

  const temporal = {
    emit: vi.fn().mockResolvedValue({ id: 'evt_1' }),
  } as unknown as TemporalFlowService;

  const service = new ConstitutionVersionService(prisma, blueprint, temporal);
  return { service, prisma, blueprint, temporal, store, genomeResult };
}

describe('ConstitutionVersionService', () => {
  it('latest returns null when no version exists', async () => {
    const { service } = makeService();
    const result = await service.latest('biz_1');
    expect(result).toBeNull();
  });

  it('generate creates v1', async () => {
    const { service, store } = makeService();
    const result = await service.generate('biz_1', { changeNotes: 'First version' }, 'user_1');

    expect(result.version).toBe(1);
    expect(result.status).toBe('ACTIVE');
    expect(result.changeNotes).toBe('First version');
    expect(store).toHaveLength(1);
  });

  it('second generate creates v2 and archives v1', async () => {
    const { service, store } = makeService();
    await service.generate('biz_1');
    const v2 = await service.generate('biz_1');

    expect(v2.version).toBe(2);
    expect(store.find((r) => r.version === 1).status).toBe('ARCHIVED');
    expect(store.find((r) => r.version === 2).status).toBe('ACTIVE');
  });

  it('generated version stores source Genome Integrity', async () => {
    const { service } = makeService();
    const result = await service.generate('biz_1');

    expect(result.sourceGenomeIntegrity).toBe(70);
  });

  it('generated version stores source Executive Readiness', async () => {
    const { service } = makeService();
    const result = await service.generate('biz_1');

    expect(result.sourceExecutiveReadiness).toBe(65);
  });

  it('generated version stores source Genome Stage', async () => {
    const { service } = makeService();
    const result = await service.generate('biz_1');

    expect(result.sourceGenomeStage).toBe('OPERATING_BUSINESS');
  });

  it('generated version stores source DNA scores', async () => {
    const { service } = makeService();
    const result = await service.generate('biz_1');

    expect(result.sourceDnaScores).toEqual({ founder: 80, business: 60, market: 90 });
  });

  it('staleness returns true when no version exists', async () => {
    const { service } = makeService();
    const result = await service.staleness('biz_1');

    expect(result.stale).toBe(true);
    expect(result.reason).toContain('No Constitution version');
  });

  it('staleness returns false when current Genome matches source snapshot', async () => {
    const { service } = makeService();
    await service.generate('biz_1');
    const result = await service.staleness('biz_1');

    expect(result.stale).toBe(false);
  });

  it('staleness returns true when Genome Integrity changes', async () => {
    const { service, blueprint } = makeService();
    await service.generate('biz_1');
    blueprint.calculateGenomeIntegrity = vi.fn().mockResolvedValue({
      genomeIntegrity: 80,
      executiveReadinessScore: 65,
      genomeStage: 'OPERATING_BUSINESS',
      genomeDnaScores: {},
      genomeDnaConfidence: {},
      threePillarMinimumMet: true,
      dnaSections: [],
      readinessBreakdown: {},
    });

    const result = await service.staleness('biz_1');

    expect(result.stale).toBe(true);
    expect(result.currentGenomeIntegrity).toBe(80);
    expect(result.constitutionGenomeIntegrity).toBe(70);
  });

  it('archive marks version archived', async () => {
    const { service } = makeService();
    await service.generate('biz_1');
    const archived = await service.archive('biz_1', 1);

    expect(archived.status).toBe('ARCHIVED');
  });

  it('generation emits Temporal Flow event', async () => {
    const { service, temporal } = makeService();
    await service.generate('biz_1');

    expect(temporal.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'constitution.version_generated' }),
    );
  });

  it('lists versions in descending order', async () => {
    const { service } = makeService();
    await service.generate('biz_1');
    await service.generate('biz_1');
    const list = await service.list('biz_1');

    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(2);
    expect(list[1].version).toBe(1);
  });
});
