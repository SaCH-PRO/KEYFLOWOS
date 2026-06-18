import { describe, expect, it, vi } from 'vitest';
import { GenomeEvolutionService } from './genome-evolution.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import type { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import type { DnaSectionKey } from '../blueprint/blueprint.types';

function makeService(store: any[] = []) {
  const proposalCreate = vi.fn(async ({ data }: any) => {
    const record = {
      id: `prop_${store.length + 1}`,
      ...data,
      evidence: data.evidence ?? [],
      confidence: data.confidence ?? 0.5,
      createdBy: data.createdBy ?? null,
      sourceEventIds: data.sourceEventIds ?? [],
      approvedBy: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.push(record);
    return record;
  });

  const proposalUpdate = vi.fn(async ({ where, data }: any) => {
    const existing = store.find((r) => r.id === where.id);
    if (!existing) throw new Error('not found');
    Object.assign(existing, data, { updatedAt: new Date() });
    return existing;
  });

  const proposalFindFirst = vi.fn(async ({ where }: any) => {
    return store.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null;
  });

  const proposalFindMany = vi.fn(async ({ where }: any) => {
    return store.filter((r) => {
      if (r.businessId !== where.businessId) return false;
      if (where.status && r.status !== where.status) return false;
      if (where.section && r.section !== where.section) return false;
      return true;
    });
  });

  const prisma = {
    client: {
      genomeEvolutionProposal: {
        create: proposalCreate,
        update: proposalUpdate,
        findFirst: proposalFindFirst,
        findMany: proposalFindMany,
      },
    },
  } as unknown as PrismaService;

  const blueprint = {
    updateDnaSection: vi.fn().mockResolvedValue({}),
    calculateGenomeIntegrity: vi.fn().mockResolvedValue({
      genomeIntegrity: 70,
      executiveReadinessScore: 65,
    }),
  } as unknown as BlueprintService;

  const temporal = {
    emit: vi.fn().mockResolvedValue({ id: 'evt_1' }),
    findGenomeSignals: vi.fn().mockResolvedValue([]),
  } as unknown as TemporalFlowService;

  const service = new GenomeEvolutionService(prisma, blueprint, temporal);
  return { service, prisma, blueprint, temporal, store };
}

describe('GenomeEvolutionService', () => {
  it('creates a pending proposal', async () => {
    const { service, store } = makeService();
    const result = await service.create('biz_1', {
      section: 'marketing',
      proposedPatch: { channels: ['WhatsApp'] },
      reason: 'WhatsApp leads are dominant',
      evidence: ['18 WhatsApp leads'],
      confidence: 0.8,
    });

    expect(result.section).toBe('marketing');
    expect(result.status).toBe('PENDING');
    expect(store).toHaveLength(1);
  });

  it('generates proposals from temporal flow signals', async () => {
    const { service, temporal } = makeService();
    temporal.findGenomeSignals = vi.fn().mockResolvedValue([
      { section: 'marketing', reason: 'WhatsApp leads', evidence: ['3 leads'], eventIds: ['evt_1', 'evt_2'] },
      { section: 'operations', reason: 'Bookings rising', evidence: ['5 bookings'], eventIds: ['evt_3'] },
    ]);

    const created = await service.generateFromTemporalFlow('biz_1', 'KEY');

    expect(created).toHaveLength(2);
    expect(created[0].section).toBe('marketing');
    expect(created[0].status).toBe('PENDING');
    expect(created[0].sourceEventIds).toEqual(['evt_1', 'evt_2']);
  });

  it('skips duplicate pending sections during generation', async () => {
    const { service, temporal, store } = makeService();
    store.push({
      id: 'prop_existing',
      businessId: 'biz_1',
      section: 'marketing',
      status: 'PENDING',
    });
    temporal.findGenomeSignals = vi.fn().mockResolvedValue([
      { section: 'marketing', reason: 'WhatsApp leads', evidence: ['3 leads'] },
    ]);

    const created = await service.generateFromTemporalFlow('biz_1');

    expect(created).toHaveLength(0);
  });

  it('approves a proposal and refreshes genome', async () => {
    const { service, blueprint, temporal } = makeService();
    await service.create('biz_1', {
      section: 'marketing',
      proposedPatch: { channels: ['WhatsApp'] },
      reason: 'WhatsApp leads',
    });

    const { proposal, genome } = await service.approve('biz_1', 'prop_1', 'user_1');

    expect(proposal.status).toBe('APPROVED');
    expect(proposal.approvedBy).toBe('user_1');
    expect(blueprint.updateDnaSection).toHaveBeenCalledWith('biz_1', 'marketing', { channels: ['WhatsApp'] });
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
    expect(genome.executiveReadinessScore).toBe(65);
    expect(temporal.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'genome_evolution.proposal_approved', module: 'business-genome' }),
    );
  });

  it('rejects a proposal and logs the decision', async () => {
    const { service, temporal } = makeService();
    await service.create('biz_1', {
      section: 'marketing',
      proposedPatch: { channels: ['WhatsApp'] },
      reason: 'WhatsApp leads',
    });

    const result = await service.reject('biz_1', 'prop_1');

    expect(result.status).toBe('REJECTED');
    expect(temporal.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'genome_evolution.proposal_rejected' }),
    );
  });

  it('edits a proposal and marks it edited', async () => {
    const { service, temporal } = makeService();
    await service.create('biz_1', {
      section: 'marketing',
      proposedPatch: { channels: ['WhatsApp'] },
      reason: 'WhatsApp leads',
    });

    const result = await service.edit('biz_1', 'prop_1', {
      reason: 'Updated reason',
      proposedPatch: { channels: ['WhatsApp', 'Instagram'] },
    });

    expect(result.status).toBe('EDITED');
    expect(result.proposedPatch).toEqual({ channels: ['WhatsApp', 'Instagram'] });
    expect(temporal.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'genome_evolution.proposal_edited' }),
    );
  });

  it('lists proposals with filters', async () => {
    const { service } = makeService();
    await service.create('biz_1', { section: 'marketing', proposedPatch: {}, reason: 'A' });
    await service.create('biz_1', { section: 'operations', proposedPatch: {}, reason: 'B' });

    const all = await service.list('biz_1');
    expect(all).toHaveLength(2);

    const marketing = await service.list('biz_1', { section: 'marketing' });
    expect(marketing).toHaveLength(1);
  });
});
