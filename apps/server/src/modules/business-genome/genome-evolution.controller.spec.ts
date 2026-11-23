import { describe, expect, it, vi } from 'vitest';
import { GenomeEvolutionController } from './genome-evolution.controller';
import type { GenomeEvolutionService } from './genome-evolution.service';

function makeController() {
  const service = {
    list: vi.fn().mockResolvedValue([{ id: 'prop_1' }]),
    // FU-GENOME-EVOLUTION-SURFACES: the reader-facing reads (pass-through here; the projection is pinned by
    // genome-evolution-surfaces.integration.test.ts) and the proposal an action is about (non-financial).
    listForReader: vi.fn().mockResolvedValue([{ id: 'prop_1' }]),
    visibleTo: vi.fn(async (_b: string, rows: unknown[]) => rows),
    get: vi.fn().mockResolvedValue({ id: 'prop_1', section: 'marketing', reason: 'R', proposedPatch: { channels: ['WhatsApp'] }, evidence: [] }),
    create: vi.fn().mockResolvedValue({ id: 'prop_2' }),
    generateFromTemporalFlow: vi.fn().mockResolvedValue([{ id: 'prop_3' }]),
    approve: vi.fn().mockResolvedValue({ proposal: { id: 'prop_1', status: 'APPROVED' }, genome: {} }),
    reject: vi.fn().mockResolvedValue({ id: 'prop_1', status: 'REJECTED' }),
    edit: vi.fn().mockResolvedValue({ id: 'prop_1', status: 'EDITED' }),
  } as unknown as GenomeEvolutionService;

  // An owner's membership: revenue read and write, so actions and their answers are as before.
  const prisma = { client: { membership: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', permissionScopes: null }) } } } as any;
  const controller = new GenomeEvolutionController(service, prisma);
  return { controller, service };
}

describe('GenomeEvolutionController', () => {
  it('GET /evolution-proposals lists proposals', async () => {
    const { controller, service } = makeController();
    const result = await controller.list('biz_1', 'PENDING', 'marketing', { user: { id: 'user_1' } });
    expect(service.listForReader).toHaveBeenCalledWith('biz_1', { status: 'PENDING', section: 'marketing' }, { id: 'user_1', role: undefined });
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
    // An owner writes revenue: every candidate may be made (no moneySections restriction).
    expect(service.generateFromTemporalFlow).toHaveBeenCalledWith('biz_1', 'user_1', {});
    expect(result).toHaveLength(1);
  });

  it('POST /evolution-proposals/:id/approve approves', async () => {
    const { controller, service } = makeController();
    const result = await controller.approve('biz_1', 'prop_1', { user: { id: 'user_1' } } as any);
    expect(service.approve).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1', expect.any(Function));
    expect(result.proposal.status).toBe('APPROVED');
    expect((result as any).genome).toEqual({});
  });

  it('POST /evolution-proposals/:id/reject rejects', async () => {
    const { controller, service } = makeController();
    const result = await controller.reject('biz_1', 'prop_1', { user: { id: 'user_1' } } as any);
    expect(service.reject).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1', expect.any(Function));
    expect(result.status).toBe('REJECTED');
  });

  it('PATCH /evolution-proposals/:id edits', async () => {
    const { controller, service } = makeController();
    const body = { reason: 'Updated' } as any;
    const result = await controller.edit('biz_1', 'prop_1', body);
    expect(service.edit).toHaveBeenCalledWith('biz_1', 'prop_1', body, expect.any(Function));
    expect(result.status).toBe('EDITED');
  });
});
