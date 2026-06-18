import { describe, expect, it, vi } from 'vitest';
import { GenomeEvolutionController } from './genome-evolution.controller';
import type { GenomeEvolutionService } from './genome-evolution.service';

function makeController() {
  const service = {
    list: vi.fn().mockResolvedValue([{ id: 'prop_1' }]),
    create: vi.fn().mockResolvedValue({ id: 'prop_2' }),
    generateFromTemporalFlow: vi.fn().mockResolvedValue([{ id: 'prop_3' }]),
    approve: vi.fn().mockResolvedValue({ proposal: { id: 'prop_1', status: 'APPROVED' }, genome: {} }),
    reject: vi.fn().mockResolvedValue({ id: 'prop_1', status: 'REJECTED' }),
    edit: vi.fn().mockResolvedValue({ id: 'prop_1', status: 'EDITED' }),
  } as unknown as GenomeEvolutionService;

  const controller = new GenomeEvolutionController(service);
  return { controller, service };
}

describe('GenomeEvolutionController', () => {
  it('GET /evolution-proposals lists proposals', async () => {
    const { controller, service } = makeController();
    const result = await controller.list('biz_1', 'PENDING', 'marketing');
    expect(service.list).toHaveBeenCalledWith('biz_1', { status: 'PENDING', section: 'marketing' });
    expect(result).toEqual([{ id: 'prop_1' }]);
  });

  it('POST /evolution-proposals creates a proposal', async () => {
    const { controller, service } = makeController();
    const body = { section: 'marketing', proposedPatch: { channels: ['WhatsApp'] }, reason: 'R' } as any;
    const result = await controller.create('biz_1', body, { user: { id: 'user_1' } } as any);
    expect(service.create).toHaveBeenCalledWith('biz_1', { ...body, createdBy: 'user_1' });
    expect(result.id).toBe('prop_2');
  });

  it('POST /evolution-proposals/generate-from-temporal-flow generates candidates', async () => {
    const { controller, service } = makeController();
    const result = await controller.generateFromTemporalFlow('biz_1', { user: { id: 'user_1' } } as any);
    expect(service.generateFromTemporalFlow).toHaveBeenCalledWith('biz_1', 'user_1');
    expect(result).toHaveLength(1);
  });

  it('POST /evolution-proposals/:id/approve approves', async () => {
    const { controller, service } = makeController();
    const result = await controller.approve('biz_1', 'prop_1', { user: { id: 'user_1' } } as any);
    expect(service.approve).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1');
    expect(result.proposal.status).toBe('APPROVED');
  });

  it('POST /evolution-proposals/:id/reject rejects', async () => {
    const { controller, service } = makeController();
    const result = await controller.reject('biz_1', 'prop_1', { user: { id: 'user_1' } } as any);
    expect(service.reject).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1');
    expect(result.status).toBe('REJECTED');
  });

  it('PATCH /evolution-proposals/:id edits', async () => {
    const { controller, service } = makeController();
    const body = { reason: 'Updated' } as any;
    const result = await controller.edit('biz_1', 'prop_1', body);
    expect(service.edit).toHaveBeenCalledWith('biz_1', 'prop_1', body);
    expect(result.status).toBe('EDITED');
  });
});
