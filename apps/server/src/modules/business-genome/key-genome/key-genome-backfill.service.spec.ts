import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { KeyGenomeBackfillService } from './key-genome-backfill.service';
import { GenomeFactService } from './genome-fact.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import type { GenomeFactData, UpsertGenomeFactInput } from './key-genome.types';

function makeService(blueprint?: Record<string, unknown>) {
  const prisma = {
    client: {
      businessBlueprint: {
        findUnique: vi.fn().mockResolvedValue(
          blueprint
            ? {
                id: 'bp_1',
                businessId: 'biz_1',
                ...blueprint,
              }
            : null,
        ),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  } as any;

  let factCounter = 0;
  const upsertedFacts = new Map<string, GenomeFactData>();

  const factService = {
    upsertFact: vi.fn(async (input: UpsertGenomeFactInput) => {
      const key = `${input.businessId}:${input.section}:${input.domain}:${input.field}`;
      factCounter++;
      const fact: GenomeFactData = {
        id: `fact_${factCounter}`,
        businessId: input.businessId,
        section: input.section,
        domain: input.domain,
        field: input.field,
        value: input.value,
        sourceType: input.sourceType,
        sourceModule: input.sourceModule ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        score: {
          completeness: 0,
          quality: 0,
          confidence: 0,
          freshness: 0,
          operationalReadiness: 0,
          riskPenalty: 0,
          overall: 0,
        },
        verificationStatus: 'UNVERIFIED_IMPORTED',
        riskIfWrong: 'MEDIUM',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      upsertedFacts.set(key, fact);
      return fact;
    }),
    getFact: vi.fn(),
    listFacts: vi.fn(),
    countFacts: vi.fn(),
  } as unknown as GenomeFactService;

  const evidenceService = {
    attachEvidence: vi.fn().mockResolvedValue({ id: 'ev_1' }),
    evidenceForFact: vi.fn(),
    evidenceSummary: vi.fn(),
  } as unknown as GenomeEvidenceService;

  const service = new KeyGenomeBackfillService(prisma, factService, evidenceService);
  return { service, prisma, factService, evidenceService, upsertedFacts };
}

describe('KeyGenomeBackfillService', () => {
  it('throws when blueprint is missing', async () => {
    const { service } = makeService();
    await expect(service.backfill('biz_missing')).rejects.toThrow(NotFoundException);
  });

  it('backfills primitive blueprint fields into GenomeFacts', async () => {
    const { service, factService } = makeService({
      identity: { businessName: 'Acme Co', mission: 'Build tools' },
    });

    const result = await service.backfill('biz_1');

    expect(result.factsUpserted).toBeGreaterThan(0);
    expect(factService.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        section: 'VISION_IDENTITY',
        domain: 'identity.businessName',
        field: 'value',
        sourceType: 'BLUEPRINT_BACKFILL',
        sourceModule: 'blueprint',
      }),
    );
  });

  it('flattens nested blueprint objects', async () => {
    const { service, factService } = makeService({
      financials: {
        priceRange: { low: 100, high: 500 },
        avgMargin: 0.4,
      },
    });

    await service.backfill('biz_1');

    expect(factService.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'FINANCIAL',
        domain: 'financials.priceRange',
        field: 'low',
        value: expect.objectContaining({ raw: 100, type: 'NUMBER' }),
      }),
    );

    expect(factService.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'FINANCIAL',
        domain: 'financials.priceRange',
        field: 'high',
        value: expect.objectContaining({ raw: 500, type: 'NUMBER' }),
      }),
    );
  });

  it('attaches evidence for each fact', async () => {
    const { service, evidenceService } = makeService({
      identity: { businessName: 'Acme Co' },
    });

    const result = await service.backfill('biz_1');

    expect(evidenceService.attachEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        sourceModule: 'blueprint',
        sourceEntityType: 'BusinessBlueprint',
        sourceEntityId: 'bp_1',
        summary: 'Backfilled from existing Business Genome / Blueprint data',
        evidenceStrength: 0.7,
      }),
    );
    expect(result.evidenceAttached).toBe(result.factsUpserted);
  });

  it('updates blueprint lastGenomeSyncAt', async () => {
    const { service, prisma } = makeService({
      identity: { businessName: 'Acme Co' },
    });

    await service.backfill('biz_1');

    expect(prisma.client.businessBlueprint.update).toHaveBeenCalledWith({
      where: { businessId: 'biz_1' },
      data: { lastGenomeSyncAt: expect.any(Date) },
    });
  });

  it('is idempotent by using upsert semantics', async () => {
    const { service, factService, upsertedFacts } = makeService({
      identity: { businessName: 'Acme Co' },
    });

    await service.backfill('biz_1');
    const firstCount = vi.mocked(factService.upsertFact).mock.calls.length;
    const firstKeys = Array.from(upsertedFacts.keys());

    await service.backfill('biz_1');
    const secondCount = vi.mocked(factService.upsertFact).mock.calls.length;
    const secondKeys = Array.from(upsertedFacts.keys());

    expect(secondCount).toBe(firstCount * 2);
    expect(secondKeys).toEqual(expect.arrayContaining(firstKeys));
    expect(new Set(secondKeys).size).toBe(firstKeys.length);
  });
});
