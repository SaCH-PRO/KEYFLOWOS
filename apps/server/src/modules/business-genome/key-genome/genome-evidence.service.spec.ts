import { describe, expect, it, vi } from 'vitest';
import { GenomeEvidenceService } from './genome-evidence.service';
import type { AttachGenomeEvidenceInput } from './key-genome.types';

function makeService() {
  const rows: Array<{
    id: string;
    businessId: string;
    factId: string | null;
    sourceModule: string;
    sourceEntityType: string;
    sourceEntityId: string | null;
    summary: string;
    evidenceStrength: number;
    occurredAt: Date | null;
    createdAt: Date;
  }> = [];

  const prisma = {
    client: {
      genomeEvidence: {
        findFirst: vi.fn(async ({ where }: { where: Partial<AttachGenomeEvidenceInput & { factId?: string }> }) => {
          return (
            rows.find(
              (r) =>
                r.businessId === where.businessId &&
                r.factId === (where.factId ?? null) &&
                r.sourceModule === where.sourceModule &&
                r.sourceEntityType === where.sourceEntityType &&
                r.sourceEntityId === (where.sourceEntityId ?? null),
            ) ?? null
          );
        }),
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `ev_${rows.length + 1}`, ...data, createdAt: new Date() };
          rows.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error('Not found');
          Object.assign(row, data);
          return row;
        }),
        findMany: vi.fn(),
        aggregate: vi.fn(),
      },
    },
  } as any;

  const service = new GenomeEvidenceService(prisma);
  return { service, rows, prisma };
}

describe('GenomeEvidenceService', () => {
  it('creates evidence on first attach', async () => {
    const { service, rows } = makeService();

    const result = await service.attachEvidence({
      businessId: 'biz_1',
      factId: 'fact_1',
      sourceModule: 'blueprint',
      sourceEntityType: 'BusinessBlueprint',
      sourceEntityId: 'bp_1',
      summary: 'Backfilled from Blueprint',
      evidenceStrength: 0.7,
    });

    expect(rows.length).toBe(1);
    expect(result.summary).toBe('Backfilled from Blueprint');
    expect(result.evidenceStrength).toBe(0.7);
  });

  it('updates existing evidence instead of duplicating', async () => {
    const { service, rows } = makeService();

    await service.attachEvidence({
      businessId: 'biz_1',
      factId: 'fact_1',
      sourceModule: 'blueprint',
      sourceEntityType: 'BusinessBlueprint',
      sourceEntityId: 'bp_1',
      summary: 'Initial summary',
      evidenceStrength: 0.6,
    });

    const result = await service.attachEvidence({
      businessId: 'biz_1',
      factId: 'fact_1',
      sourceModule: 'blueprint',
      sourceEntityType: 'BusinessBlueprint',
      sourceEntityId: 'bp_1',
      summary: 'Updated summary',
      evidenceStrength: 0.8,
    });

    expect(rows.length).toBe(1);
    expect(result.summary).toBe('Updated summary');
    expect(result.evidenceStrength).toBe(0.8);
  });

  it('creates separate evidence when source differs', async () => {
    const { service, rows } = makeService();

    await service.attachEvidence({
      businessId: 'biz_1',
      factId: 'fact_1',
      sourceModule: 'blueprint',
      sourceEntityType: 'BusinessBlueprint',
      sourceEntityId: 'bp_1',
      summary: 'Blueprint evidence',
    });

    await service.attachEvidence({
      businessId: 'biz_1',
      factId: 'fact_1',
      sourceModule: 'temporal_flow',
      sourceEntityType: 'TemporalFlowEvent',
      sourceEntityId: 'evt_1',
      summary: 'Temporal evidence',
    });

    expect(rows.length).toBe(2);
  });
});
