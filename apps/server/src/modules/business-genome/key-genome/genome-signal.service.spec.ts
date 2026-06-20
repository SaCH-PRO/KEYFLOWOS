import { describe, expect, it, vi } from 'vitest';
import { GenomeSignalService } from './genome-signal.service';
import type { CreateGenomeSignalInput, GenomeSignalData } from './key-genome.types';

function makeInput(overrides: Partial<CreateGenomeSignalInput> = {}): CreateGenomeSignalInput {
  return {
    businessId: 'biz_1',
    sourceModule: 'key_inbox',
    sourceEntityType: 'KeyInboxThread',
    sourceEntityId: 'thread_1',
    signalType: 'CUSTOMER_PATTERN',
    section: 'CUSTOMER_MARKET',
    domain: 'customer',
    field: 'pain_points',
    proposedValue: ['weekend delivery'],
    reason: 'Customers keep asking about weekend delivery.',
    evidence: [
      {
        sourceModule: 'key_inbox',
        sourceEntityType: 'KeyInboxThread',
        sourceEntityId: 'thread_1',
        summary: 'Three customers asked about weekend delivery.',
        evidenceStrength: 0.75,
      },
    ],
    confidence: 0.8,
    ...overrides,
  };
}

function makeSignalRow(overrides: Partial<any> = {}) {
  const now = new Date();
  return {
    id: 'sig_1',
    businessId: 'biz_1',
    sourceModule: 'key_inbox',
    sourceEntityType: 'KeyInboxThread',
    sourceEntityId: 'thread_1',
    signalType: 'CUSTOMER_PATTERN',
    section: 'CUSTOMER_MARKET',
    domain: 'customer',
    field: 'pain_points',
    proposedValue: ['weekend delivery'],
    reason: 'Customers keep asking about weekend delivery.',
    evidence: [
      {
        sourceModule: 'key_inbox',
        sourceEntityType: 'KeyInboxThread',
        sourceEntityId: 'thread_1',
        summary: 'Three customers asked about weekend delivery.',
        evidenceStrength: 0.75,
      },
    ],
    confidence: 0.8,
    status: 'NEW',
    createdAt: now,
    reviewedAt: null,
    ...overrides,
  };
}

function makeService() {
  const storedSignals: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeSignal: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: any }) => {
          const match = storedSignals.find(
            (s) =>
              s.businessId === where.businessId &&
              s.sourceModule === where.sourceModule &&
              s.sourceEntityType === (where.sourceEntityType?.equals ?? where.sourceEntityType) &&
              s.sourceEntityId === (where.sourceEntityId?.equals ?? where.sourceEntityId) &&
              s.signalType === where.signalType &&
              s.section === where.section &&
              s.domain === where.domain &&
              s.field === (where.field?.equals ?? where.field) &&
              (where.status?.in ?? []).includes(s.status),
          );
          return Promise.resolve(match ?? null);
        }),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          return Promise.resolve(storedSignals.find((s) => s.id === where.id) ?? null);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where: any; take?: number }) => {
          let results = storedSignals.filter((s) => s.businessId === where.businessId);
          if (where.status) results = results.filter((s) => s.status === where.status);
          if (where.sourceModule) results = results.filter((s) => s.sourceModule === where.sourceModule);
          if (where.section) results = results.filter((s) => s.section === where.section);
          if (where.signalType) results = results.filter((s) => s.signalType === where.signalType);
          if (where.confidence?.gte !== undefined)
            results = results.filter((s) => s.confidence >= where.confidence.gte);
          results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return Promise.resolve(take ? results.slice(0, take) : results);
        }),
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const row = { id: `sig_${nextId++}`, ...data, createdAt: new Date(), reviewedAt: null };
          storedSignals.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
          const idx = storedSignals.findIndex((s) => s.id === where.id);
          if (idx === -1) throw new Error('Not found');
          storedSignals[idx] = { ...storedSignals[idx], ...data };
          return Promise.resolve(storedSignals[idx]);
        }),
      },
    },
  } as any;

  const factService = {
    upsertFact: vi.fn().mockResolvedValue({
      id: 'fact_1',
      businessId: 'biz_1',
      section: 'CUSTOMER_MARKET',
      domain: 'customer',
      field: 'pain_points',
      value: { raw: ['weekend delivery'], type: 'LIST' },
    }),
  } as any;

  const evidenceService = {
    attachEvidence: vi.fn().mockResolvedValue({ id: 'ev_1' }),
  } as any;

  const scoring = {
    computeFactScores: vi.fn().mockResolvedValue([]),
  } as any;

  const readiness = {
    computeReadiness: vi.fn().mockResolvedValue([]),
  } as any;

  const events = {
    emit: vi.fn(),
  } as any;

  const service = new GenomeSignalService(prisma, factService, evidenceService, scoring, readiness, events);
  return { service, prisma, factService, evidenceService, scoring, readiness, events, storedSignals };
}

describe('GenomeSignalService', () => {
  it('creates a NEW signal', async () => {
    const { service, storedSignals } = makeService();
    const signal = await service.createSignal(makeInput());

    expect(signal.status).toBe('NEW');
    expect(signal.reason).toBe('Customers keep asking about weekend delivery.');
    expect(storedSignals).toHaveLength(1);
  });

  it('deduplicates active signals from the same source/entity/field', async () => {
    const { service, storedSignals } = makeService();
    await service.createSignal(makeInput());
    const duplicate = await service.createSignal(makeInput({ confidence: 0.6 }));

    expect(storedSignals).toHaveLength(1);
    expect(duplicate.confidence).toBe(0.8);
  });

  it('updates confidence/reason/evidence when a stronger duplicate arrives', async () => {
    const { service, storedSignals } = makeService();
    await service.createSignal(makeInput());
    const updated = await service.createSignal(
      makeInput({ confidence: 0.95, reason: 'Stronger evidence now available.', evidence: [] }),
    );

    expect(storedSignals).toHaveLength(1);
    expect(updated.confidence).toBe(0.95);
    expect(updated.reason).toBe('Stronger evidence now available.');
  });

  it('lists signals by status and source module', async () => {
    const { service } = makeService();
    await service.createSignal(makeInput({ sourceModule: 'key_inbox' }));
    await service.createSignal(makeInput({ sourceModule: 'temporal_flow', signalType: 'OPERATIONS_PATTERN' }));

    const inbox = await service.listSignals('biz_1', { sourceModule: 'key_inbox' });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].sourceModule).toBe('key_inbox');
  });

  it('filters signals by minimum confidence', async () => {
    const { service } = makeService();
    await service.createSignal(makeInput({ confidence: 0.9 }));
    await service.createSignal(makeInput({ confidence: 0.4, sourceEntityId: 'thread_2' }));

    const strong = await service.listSignals('biz_1', { minConfidence: 0.7 });
    expect(strong).toHaveLength(1);
    expect(strong[0].confidence).toBe(0.9);
  });

  it('accepts a signal', async () => {
    const { service } = makeService();
    const created = await service.createSignal(makeInput());
    const accepted = await service.acceptSignal('biz_1', created.id);

    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.reviewedAt).not.toBeNull();
  });

  it('rejects a signal', async () => {
    const { service } = makeService();
    const created = await service.createSignal(makeInput());
    const rejected = await service.rejectSignal('biz_1', created.id, 'not actionable');

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.reason).toContain('not actionable');
  });

  it('prevents merging unless the signal is accepted', async () => {
    const { service } = makeService();
    const created = await service.createSignal(makeInput());

    await expect(service.mergeSignal('biz_1', created.id)).rejects.toThrow('Only ACCEPTED signals can be merged');
  });

  it('merges an accepted signal into a GenomeFact and attaches evidence', async () => {
    const { service, factService, evidenceService, scoring, readiness, events } = makeService();
    const created = await service.createSignal(makeInput());
    const accepted = await service.acceptSignal('biz_1', created.id);
    const result = await service.mergeSignal('biz_1', accepted.id);

    expect(result.signal.status).toBe('MERGED');
    expect(factService.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        section: 'CUSTOMER_MARKET',
        domain: 'customer',
        field: 'pain_points',
        sourceType: 'GENOME_SIGNAL',
      }),
    );
    expect(evidenceService.attachEvidence).toHaveBeenCalled();
    expect(scoring.computeFactScores).toHaveBeenCalledWith('biz_1');
    expect(readiness.computeReadiness).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'key.genome.signal_merged',
      expect.objectContaining({ businessId: 'biz_1', signalId: accepted.id }),
    );
  });

  it('converts signal evidence JSON into GenomeEvidence rows on merge', async () => {
    const { service, evidenceService } = makeService();
    const created = await service.createSignal(makeInput({ evidence: [{ sourceModule: 'key_inbox', sourceEntityType: 'KeyInboxThread', summary: 'Direct evidence', evidenceStrength: 0.9 }] }));
    const accepted = await service.acceptSignal('biz_1', created.id);
    await service.mergeSignal('biz_1', accepted.id);

    expect(evidenceService.attachEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        factId: 'fact_1',
        summary: 'Direct evidence',
        evidenceStrength: 0.9,
      }),
    );
  });

  it('uses "value" as the default field when merging a signal without one', async () => {
    const { service, factService } = makeService();
    const created = await service.createSignal(makeInput({ field: undefined }));
    const accepted = await service.acceptSignal('biz_1', created.id);
    await service.mergeSignal('biz_1', accepted.id);

    expect(factService.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'value' }),
    );
  });

  it('throws when getting a signal from another business', async () => {
    const { service } = makeService();
    const created = await service.createSignal(makeInput());
    await expect(service.getSignal('biz_2', created.id)).rejects.toThrow('Genome signal not found');
  });
});
