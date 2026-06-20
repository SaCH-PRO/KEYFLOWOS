import { describe, expect, it, vi } from 'vitest';
import { GenomeScoringService } from './genome-scoring.service';
import type { GenomeFactData } from './key-genome.types';

function makeFact(overrides: Partial<GenomeFactData> = {}): GenomeFactData {
  const now = new Date().toISOString();
  return {
    id: 'fact_1',
    businessId: 'biz_1',
    section: 'VISION_IDENTITY',
    domain: 'identity',
    field: 'businessName',
    value: { raw: 'Acme Co', type: 'STRING' },
    sourceModule: 'blueprint',
    sourceType: 'BLUEPRINT_BACKFILL',
    sourceEntityType: 'BusinessBlueprint',
    sourceEntityId: 'bp_1',
    verificationStatus: 'UNVERIFIED_IMPORTED',
    riskIfWrong: 'MEDIUM',
    lastVerifiedAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    score: {
      completeness: 0,
      quality: 0,
      confidence: 0,
      freshness: 0,
      operationalReadiness: 0,
      riskPenalty: 0,
      overall: 0,
    },
    ...overrides,
  };
}

function makeService(rows: GenomeFactData[] = []) {
  const storedRows = rows.map((f) => ({
    ...f,
    value: f.value.raw,
    valueType: f.value.type,
    sourceModule: f.sourceModule ?? null,
    sourceEntityType: f.sourceEntityType ?? null,
    sourceEntityId: f.sourceEntityId ?? null,
    lastVerifiedAt: f.lastVerifiedAt ? new Date(f.lastVerifiedAt) : null,
    expiresAt: f.expiresAt ? new Date(f.expiresAt) : null,
    createdAt: new Date(f.createdAt),
    updatedAt: new Date(f.updatedAt),
  }));

  const prisma = {
    client: {
      genomeFact: {
        findMany: vi.fn().mockResolvedValue(storedRows),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
          const row = storedRows.find((r) => r.id === where.id);
          if (!row) throw new Error('Not found');
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        }),
      },
    },
  } as any;

  const evidenceService = {
    evidenceSummary: vi.fn().mockResolvedValue({ count: 0, averageStrength: 0, latestEvidenceAt: null }),
  } as any;

  const service = new GenomeScoringService(prisma, evidenceService);
  return { service, prisma, evidenceService, storedRows };
}

describe('GenomeScoringService', () => {
  it('scores a complete, verified fact near 1.0', () => {
    const { service } = makeService();
    const fact = makeFact({ verificationStatus: 'USER_VERIFIED', riskIfWrong: 'LOW' });
    const score = service.scoreFact(fact, 1.0);

    expect(score.completeness).toBe(1);
    expect(score.quality).toBe(1);
    expect(score.confidence).toBeCloseTo(1.0);
    expect(score.operationalReadiness).toBe(1);
    expect(score.riskPenalty).toBe(0);
    expect(score.overall).toBeGreaterThan(0.95);
  });

  it('applies a risk penalty', () => {
    const { service } = makeService();
    const fact = makeFact({ verificationStatus: 'USER_VERIFIED', riskIfWrong: 'CRITICAL' });
    const score = service.scoreFact(fact, 1.0);

    expect(score.riskPenalty).toBe(0.15);
    expect(score.overall).toBeLessThan(0.9);
  });

  it('marks an empty value as incomplete', () => {
    const { service } = makeService();
    const fact = makeFact({ value: { raw: '', type: 'STRING' } });
    const score = service.scoreFact(fact, 0.8);

    expect(score.completeness).toBe(0);
    expect(score.overall).toBeLessThan(0.8);
  });

  it('gives disputed facts zero confidence and readiness', () => {
    const { service } = makeService();
    const fact = makeFact({ verificationStatus: 'DISPUTED' });
    const score = service.scoreFact(fact, 0.8);

    expect(score.confidence).toBe(0);
    expect(score.operationalReadiness).toBe(0);
  });

  it('sets freshness to 0 when the fact is expired', () => {
    const { service } = makeService();
    const past = new Date(Date.now() - 86400000).toISOString();
    const fact = makeFact({ expiresAt: past });
    const score = service.scoreFact(fact, 0.8);

    expect(score.freshness).toBe(0);
  });

  it('decays freshness for old facts', () => {
    const { service } = makeService();
    const old = new Date(Date.now() - 30 * 86400000).toISOString();
    const fact = makeFact({ updatedAt: old });
    const score = service.scoreFact(fact, 0.8);

    expect(score.freshness).toBeCloseTo(0.5, 1);
  });

  it('updates score columns in the database', async () => {
    const { service, prisma } = makeService([makeFact()]);

    await service.computeFactScores('biz_1');

    expect(prisma.client.genomeFact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fact_1' },
        data: expect.objectContaining({
          completenessScore: 1,
          qualityScore: expect.any(Number),
          confidenceScore: expect.any(Number),
          freshnessScore: expect.any(Number),
          operationalReadinessScore: expect.any(Number),
        }),
      }),
    );
  });

  it('aggregates section scores and computes weighted business score', () => {
    const { service } = makeService();
    const facts: GenomeFactData[] = [
      { ...makeFact({ id: 'f1', section: 'VISION_IDENTITY' }), score: service.scoreFact(makeFact({ id: 'f1' }), 1) },
      { ...makeFact({ id: 'f2', section: 'VISION_IDENTITY' }), score: service.scoreFact(makeFact({ id: 'f2' }), 1) },
      {
        ...makeFact({ id: 'f3', section: 'FINANCIAL', domain: 'finance', field: 'currency' }),
        score: service.scoreFact(makeFact({ id: 'f3', section: 'FINANCIAL', domain: 'finance', field: 'currency' }), 0.5),
      },
    ];

    const businessScore = service.computeBusinessScore('biz_1', facts);

    expect(businessScore.sections).toHaveLength(2);
    expect(businessScore.overall).toBeGreaterThan(0);
    expect(businessScore.overall).toBeLessThanOrEqual(1);
    expect(businessScore.computedAt).toBeDefined();
  });

  it('returns zero business score when no facts exist', () => {
    const { service } = makeService();
    const businessScore = service.computeBusinessScore('biz_1', []);

    expect(businessScore.overall).toBe(0);
    expect(businessScore.sections).toHaveLength(0);
  });
});
