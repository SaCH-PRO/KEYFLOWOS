import { describe, expect, it, vi } from 'vitest';
import { GenomeExperimentService } from './genome-experiment.service';
import { OutcomeLearningService } from './outcome-learning.service';
import type { CreateGenomeExperimentInput } from './key-genome.types';

function makeService() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeExperiment: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `exp_${nextId++}`, ...data, createdAt: new Date() };
          stored.push(row);
          return row;
        }),
        findMany: vi.fn(async ({ where }: { where: any }) => {
          let results = stored.filter((r) => r.businessId === where.businessId);
          if (where.status) results = results.filter((r) => r.status === where.status);
          if (where.id) results = results.filter((r) => r.id === where.id);
          return [...results].sort((a, b) => b.createdAt - a.createdAt);
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return stored.find((r) => r.id === where.id) ?? null;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
          const row = stored.find((r) => r.id === where.id);
          if (!row) throw new Error('Record not found');
          Object.assign(row, data);
          return row;
        }),
      },
    },
  } as any;

  const outcomeLearning = {
    recordExperimentStarted: vi.fn().mockResolvedValue(undefined),
    recordExperimentCompleted: vi.fn().mockResolvedValue(undefined),
    recordExperimentFailed: vi.fn().mockResolvedValue(undefined),
    recordExperimentCancelled: vi.fn().mockResolvedValue(undefined),
  } as unknown as OutcomeLearningService;

  const service = new GenomeExperimentService(prisma, outcomeLearning);
  return { service, prisma, stored, outcomeLearning };
}

function makeInput(overrides: Partial<CreateGenomeExperimentInput> = {}): CreateGenomeExperimentInput {
  return {
    businessId: 'biz_1',
    hypothesis: 'Offering a free trial increases conversions',
    action: 'Enable free trial banner',
    successMetric: 'trial_signups',
    ...overrides,
  };
}

describe('GenomeExperimentService', () => {
  it('creates an experiment as PROPOSED', async () => {
    const { service } = makeService();
    const exp = await service.createExperiment(makeInput());

    expect(exp.id).toMatch(/^exp_/);
    expect(exp.status).toBe('PROPOSED');
    expect(exp.businessId).toBe('biz_1');
  });

  it('lists experiments with status filter', async () => {
    const { service } = makeService();
    const created = await service.createExperiment(makeInput());
    await service.startExperiment('biz_1', created.id);

    const proposed = await service.listExperiments('biz_1', { status: 'PROPOSED' });
    expect(proposed).toHaveLength(0);

    const running = await service.listExperiments('biz_1', { status: 'RUNNING' });
    expect(running).toHaveLength(1);
  });

  it('starts an experiment and records outcome learning', async () => {
    const { service, outcomeLearning } = makeService();
    const created = await service.createExperiment(makeInput());

    const started = await service.startExperiment('biz_1', created.id);
    expect(started.status).toBe('RUNNING');
    expect(started.startedAt).not.toBeNull();
    expect(outcomeLearning.recordExperimentStarted).toHaveBeenCalledWith('biz_1', expect.objectContaining({ id: created.id, status: 'RUNNING' }));
  });

  it('throws when accessing an experiment for the wrong business', async () => {
    const { service } = makeService();
    const created = await service.createExperiment(makeInput());

    await expect(service.getExperiment('biz_other', created.id)).rejects.toThrow('Genome experiment not found');
  });

  it('completes an experiment with outcome', async () => {
    const { service, outcomeLearning } = makeService();
    const created = await service.createExperiment(makeInput());
    await service.startExperiment('biz_1', created.id);

    const completed = await service.completeExperiment('biz_1', created.id, {
      success: true,
      notes: 'Great lift',
      measuredValue: 42,
    });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.endedAt).not.toBeNull();
    expect(completed.result).toMatchObject({ success: true, notes: 'Great lift', measuredValue: 42 });
    expect(outcomeLearning.recordExperimentCompleted).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ id: created.id, status: 'COMPLETED' }),
      expect.any(Object),
    );
  });

  it('fails an experiment with outcome', async () => {
    const { service, outcomeLearning } = makeService();
    const created = await service.createExperiment(makeInput());
    await service.startExperiment('biz_1', created.id);

    const failed = await service.failExperiment('biz_1', created.id, { success: false, notes: 'No lift' });
    expect(failed.status).toBe('FAILED');
    expect(failed.result).toMatchObject({ success: false, notes: 'No lift' });
    expect(outcomeLearning.recordExperimentFailed).toHaveBeenCalled();
  });

  it('cancels an experiment', async () => {
    const { service, outcomeLearning } = makeService();
    const created = await service.createExperiment(makeInput());

    const cancelled = await service.cancelExperiment('biz_1', created.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.endedAt).not.toBeNull();
    expect(outcomeLearning.recordExperimentCancelled).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ id: created.id, status: 'CANCELLED' }),
    );
  });
});
