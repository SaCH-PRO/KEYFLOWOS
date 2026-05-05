import { describe, it, expect, vi } from 'vitest';
import { ProjectRevenueListener } from './project-revenue.listener';

describe('ProjectRevenueListener', () => {
  function build(opts: { projects?: Array<{ id: string }>; metaData?: Record<string, unknown> } = {}) {
    const findMany = vi.fn().mockResolvedValue(opts.projects ?? []);
    const update = vi.fn().mockImplementation(({ where, data }: any) =>
      Promise.resolve({ id: where.id, status: data.status }),
    );
    const findUnique = vi.fn().mockResolvedValue({ metaData: opts.metaData ?? {} });
    const prisma: any = {
      client: {
        project: { findMany, update },
        business: { findUnique },
      },
    };
    const events: any = { emit: vi.fn() };
    const listener = new ProjectRevenueListener(prisma, events);
    return { listener, findMany, update, findUnique, events };
  }

  it('advances ACTIVE→IN_PROGRESS on invoice.paid by default', async () => {
    const { listener, update, events } = build({ projects: [{ id: 'p_1' }] });
    await listener.onInvoicePaid({ invoice: { id: 'inv_1' }, businessId: 'biz_1' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p_1', businessId: 'biz_1' },
        data: { status: 'IN_PROGRESS' },
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'project.status_advanced',
      expect.objectContaining({ fromStatus: 'ACTIVE', toStatus: 'IN_PROGRESS', reason: 'invoice.paid' }),
    );
  });

  it('respects per-business override (toStatusOnInvoicePaid="PROPOSED")', async () => {
    const { listener, update } = build({
      projects: [{ id: 'p_1' }],
      metaData: { projectStageProgression: { fromStatus: 'ACTIVE', toStatusOnInvoicePaid: 'PROPOSED' } },
    });
    await listener.onInvoicePaid({ invoice: { id: 'inv_1' }, businessId: 'biz_1' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PROPOSED' } }),
    );
  });

  it('skips when business disabled progression', async () => {
    const { listener, findMany, update } = build({
      projects: [{ id: 'p_1' }],
      metaData: { projectStageProgression: { enabled: false } },
    });
    await listener.onInvoicePaid({ invoice: { id: 'inv_1' }, businessId: 'biz_1' });
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('skips when invoice has no id', async () => {
    const { listener, findMany } = build();
    await listener.onInvoicePaid({ invoice: {}, businessId: 'biz_1' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
