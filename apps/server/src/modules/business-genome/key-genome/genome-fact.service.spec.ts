import { describe, expect, it, vi } from 'vitest';
import { GenomeFactService } from './genome-fact.service';
import type { UpsertGenomeFactInput } from './key-genome.types';

function makeService() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeFact: {
        upsert: vi.fn(async ({ where, update, create }: { where: any; update: any; create: any }) => {
          const existing = stored.find(
            (r) =>
              r.businessId === where.businessId_section_domain_field.businessId &&
              r.section === where.businessId_section_domain_field.section &&
              r.domain === where.businessId_section_domain_field.domain &&
              r.field === where.businessId_section_domain_field.field,
          );
          const now = new Date();
          if (existing) {
            Object.assign(existing, update, { updatedAt: now });
            return existing;
          }
          const row = { id: `fact_${nextId++}`, ...create, createdAt: now, updatedAt: now };
          stored.push(row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: any }) => {
          return (
            stored.find(
              (r) =>
                r.businessId === where.businessId_section_domain_field.businessId &&
                r.section === where.businessId_section_domain_field.section &&
                r.domain === where.businessId_section_domain_field.domain &&
                r.field === where.businessId_section_domain_field.field,
            ) ?? null
          );
        }),
        findMany: vi.fn(async ({ where, orderBy }: { where: any; orderBy?: any }) => {
          let results = stored.filter((r) => r.businessId === where.businessId);
          if (where.section) results = results.filter((r) => r.section === where.section);
          if (where.domain) results = results.filter((r) => r.domain === where.domain);
          if (where.verificationStatus) results = results.filter((r) => r.verificationStatus === where.verificationStatus);
          if (orderBy?.createdAt === 'desc') results = [...results].reverse();
          return results;
        }),
        count: vi.fn(async ({ where }: { where: any }) => {
          return stored.filter((r) => r.businessId === where.businessId).length;
        }),
      },
    },
  } as any;

  const service = new GenomeFactService(prisma);
  return { service, prisma, stored };
}

function makeInput(overrides: Partial<UpsertGenomeFactInput> = {}): UpsertGenomeFactInput {
  return {
    businessId: 'biz_1',
    section: 'identity',
    domain: 'core',
    field: 'mission',
    value: { raw: 'Build great things', type: 'STRING' },
    sourceType: 'GENESIS',
    ...overrides,
  };
}

describe('GenomeFactService', () => {
  it('creates a fact on first upsert', async () => {
    const { service } = makeService();
    const fact = await service.upsertFact(makeInput());

    expect(fact.id).toMatch(/^fact_/);
    expect(fact.section).toBe('identity');
    expect(fact.domain).toBe('core');
    expect(fact.field).toBe('mission');
    expect(fact.value.raw).toBe('Build great things');
    expect(fact.score.overall).toBeGreaterThanOrEqual(0);
  });

  it('updates an existing fact on second upsert', async () => {
    const { service } = makeService();
    await service.upsertFact(makeInput());
    const updated = await service.upsertFact(makeInput({ value: { raw: 'Updated mission', type: 'STRING' }, confidenceScore: 0.95 }));

    expect(updated.value.raw).toBe('Updated mission');
    expect(updated.score.confidence).toBe(0.95);
  });

  it('retrieves a fact by composite key', async () => {
    const { service } = makeService();
    await service.upsertFact(makeInput());
    const found = await service.getFact('biz_1', 'identity', 'core', 'mission');

    expect(found).not.toBeNull();
    expect(found?.value.raw).toBe('Build great things');
  });

  it('lists facts with filters', async () => {
    const { service } = makeService();
    await service.upsertFact(makeInput({ field: 'mission', section: 'identity' }));
    await service.upsertFact(makeInput({ field: 'vision', section: 'identity', domain: 'core' }));
    await service.upsertFact(makeInput({ field: 'teamSize', section: 'operations', domain: 'capacity' }));

    const identityFacts = await service.listFacts('biz_1', { section: 'identity' });
    expect(identityFacts).toHaveLength(2);

    const coreFacts = await service.listFacts('biz_1', { domain: 'core' });
    expect(coreFacts).toHaveLength(2);
  });

  it('counts facts for a business', async () => {
    const { service } = makeService();
    await service.upsertFact(makeInput({ field: 'a' }));
    await service.upsertFact(makeInput({ field: 'b', section: 'operations' }));

    expect(await service.countFacts('biz_1')).toBe(2);
    expect(await service.countFacts('biz_other')).toBe(0);
  });

  it('computes overall score from sub-scores and risk penalty', async () => {
    const { service } = makeService();
    const fact = await service.upsertFact(
      makeInput({
        value: { raw: 100, type: 'NUMBER' },
        verificationStatus: 'USER_VERIFIED',
      }),
    );

    expect(fact.score.completeness).toBe(0);
    expect(fact.score.quality).toBe(0);
    expect(fact.score.confidence).toBe(0);
    expect(fact.score.overall).toBeLessThanOrEqual(1);
    expect(fact.verificationStatus).toBe('USER_VERIFIED');
  });
});
