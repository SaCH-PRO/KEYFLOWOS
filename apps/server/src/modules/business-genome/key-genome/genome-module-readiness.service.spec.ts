import { describe, expect, it, vi } from 'vitest';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import type { GenomeFactData } from './key-genome.types';

function makeFact(overrides: Partial<GenomeFactData> = {}): GenomeFactData {
  const now = new Date().toISOString();
  return {
    id: `fact_${Math.random().toString(36).slice(2)}`,
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
      completeness: 1,
      quality: 0.7,
      confidence: 0.5,
      freshness: 1,
      operationalReadiness: 0.5,
      riskPenalty: 0.03,
      overall: 0.8,
    },
    ...overrides,
  };
}

function makeService() {
  const upserted: any[] = [];
  const prisma = {
    client: {
      genomeModuleReadiness: {
        upsert: vi.fn(({ create }: { create: any }) => {
          upserted.push(create);
          return Promise.resolve({ id: 'mr_1', ...create, lastComputedAt: new Date(create.lastComputedAt) });
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      genomeFact: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  } as any;

  const service = new GenomeModuleReadinessService(prisma);
  return { service, prisma, upserted };
}

describe('GenomeModuleReadinessService', () => {
  it('computes full readiness when all required facts are present', async () => {
    const { service, upserted } = makeService();

    const facts: GenomeFactData[] = [
      makeFact({ section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'delivery_process' }),
      makeFact({ section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'capacity' }),
      makeFact({ section: 'OFFER_PRODUCT', domain: 'offer', field: 'core_offer' }),
      makeFact({ section: 'OFFER_PRODUCT', domain: 'offer', field: 'delivery_model' }),
    ];

    const results = await service.computeReadiness('biz_1', facts);
    const bookings = results.find((r) => r.module === 'bookings');

    expect(bookings).toBeDefined();
    expect(bookings!.readinessScore).toBe(100);
    expect(bookings!.automationAllowed).toBe(true);
    expect(bookings!.missingFacts).toHaveLength(0);
    expect(bookings!.riskLevel).toBe('LOW');
    expect(upserted.some((u) => u.module === 'bookings')).toBe(true);
  });

  it('blocks automation when a BLOCKING required fact is missing', async () => {
    const { service } = makeService();

    // Only the DEGRADED required fact is present; BLOCKING delivery_process is missing.
    const facts: GenomeFactData[] = [
      makeFact({ section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'capacity' }),
    ];

    const results = await service.computeReadiness('biz_1', facts);
    const bookings = results.find((r) => r.module === 'bookings');

    expect(bookings!.automationAllowed).toBe(false);
    expect(bookings!.riskLevel).toBe('HIGH');
    expect(bookings!.missingFacts.length).toBeGreaterThan(0);
    expect(bookings!.blockedReasons.length).toBeGreaterThan(0);
    expect(bookings!.recommendedSetupActions.length).toBeGreaterThan(0);
  });

  it('matches facts that use the generic "value" field with the domain leaf', async () => {
    const { service } = makeService();

    const facts: GenomeFactData[] = [
      makeFact({ section: 'OPERATIONS_DELIVERY', domain: 'operations.delivery_process', field: 'value' }),
      makeFact({ section: 'OPERATIONS_DELIVERY', domain: 'operations.capacity', field: 'value' }),
      makeFact({ section: 'OFFER_PRODUCT', domain: 'offer.core_offer', field: 'value' }),
      makeFact({ section: 'OFFER_PRODUCT', domain: 'offer.delivery_model', field: 'value' }),
    ];

    const results = await service.computeReadiness('biz_1', facts);
    const bookings = results.find((r) => r.module === 'bookings');

    expect(bookings!.readinessScore).toBe(100);
    expect(bookings!.missingFacts).toHaveLength(0);
  });

  it('computes readiness below 100 when only some required facts are present', async () => {
    const { service } = makeService();

    const facts: GenomeFactData[] = [
      makeFact({ section: 'CUSTOMER_MARKET', domain: 'customer', field: 'ideal_customer' }),
      makeFact({ section: 'CUSTOMER_MARKET', domain: 'market', field: 'target_market' }),
    ];

    const results = await service.computeReadiness('biz_1', facts);
    const crm = results.find((r) => r.module === 'crm');

    expect(crm).toBeDefined();
    expect(crm!.readinessScore).toBe(50);
  });

  it('loads facts from the database when none are provided', async () => {
    const { service, prisma } = makeService();
    const facts = [makeFact({ id: 'f1' })];
    prisma.client.genomeFact.findMany.mockResolvedValue(
      facts.map((f) => ({
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
      })),
    );

    await service.computeReadiness('biz_1');

    expect(prisma.client.genomeFact.findMany).toHaveBeenCalledWith({ where: { businessId: 'biz_1' } });
  });

  it('returns persisted readiness for a specific module', async () => {
    const { service, prisma } = makeService();
    prisma.client.genomeModuleReadiness.findUnique.mockResolvedValue({
      id: 'mr_1',
      businessId: 'biz_1',
      module: 'finance',
      readinessScore: 75,
      requiredFacts: [],
      missingFacts: [],
      optionalFacts: [],
      blockedReasons: [],
      recommendedSetupActions: ['Add tax profile'],
      automationAllowed: true,
      riskLevel: 'MEDIUM',
      lastComputedAt: new Date(),
    });

    const result = await service.getReadiness('biz_1', 'finance');

    expect(result).not.toBeNull();
    expect((result as any).readinessScore).toBe(75);
    expect((result as any).module).toBe('finance');
  });
});
