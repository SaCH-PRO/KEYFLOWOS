import { describe, expect, it } from 'vitest';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { EvidencePredictionService } from './evidence-prediction.service';

function createMockEvidenceService(): any {
  return {
    submit: async () => ({ id: 'ev_1', evidenceType: 'photo', url: 'https://example.com/img.jpg' }),
    listForBusiness: async () => ({ items: [], total: 0, offset: 0, limit: 50 }),
    getById: async () => ({ id: 'ev_1', evidenceType: 'photo' }),
    getForObject: async () => [],
    verify: async () => ({ id: 'ev_1', verifiedBy: 'admin' }),
    delete: async () => ({ success: true }),
    checkTaskEvidence: async () => ({ required: false, hasEvidence: false, evidenceCount: 0 }),
  };
}

function createMockPredictionService(): any {
  return {
    predict: async () => ({ required: false, confidence: 0.5, similarTasksCount: 3, evidenceRate: 0.2 }),
  };
}

describe('EvidenceController', () => {
  const evidence = createMockEvidenceService();
  const prediction = createMockPredictionService();
  const controller = new EvidenceController(evidence, prediction);

  it('submits evidence', async () => {
    const result = await controller.submit('biz_1', {
      evidenceType: 'photo',
      url: 'https://example.com/img.jpg',
      storageKey: 's3://bucket/img.jpg',
      linkedType: 'ContactTask',
      linkedId: 'task_1',
    } as any, { user: { id: 'user_1' } } as any);

    expect(result.id).toBe('ev_1');
  });

  it('lists evidence', async () => {
    const result = await controller.list('biz_1', { type: 'photo' } as any);
    expect(result.total).toBe(0);
  });

  it('verifies evidence', async () => {
    const result = await controller.verify('ev_1', { user: { id: 'admin' } } as any);
    expect(result.verifiedBy).toBe('admin');
  });

  it('predicts evidence requirement', async () => {
    const result = await controller.predictRequirement('biz_1', { taskType: 'ContactTask', title: 'Follow up call' });
    expect(result.confidence).toBe(0.5);
  });
});
