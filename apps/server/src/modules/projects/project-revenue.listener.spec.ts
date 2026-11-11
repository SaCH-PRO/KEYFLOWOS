import { describe, it, expect, vi } from 'vitest';
import { ProjectRevenueListener } from './project-revenue.listener';

describe('ProjectRevenueListener', () => {
  function build(opts: { projects?: Array<{ id: string }>; metaData?: Record<string, unknown>; invoiceStatus?: string | string[] } = {}) {
    const findMany = vi.fn().mockResolvedValue(opts.projects ?? []);
    const update = vi.fn().mockImplementation(({ where, data }: any) =>
      Promise.resolve({ id: where.id, status: data.status }),
    );
    const findUnique = vi.fn().mockResolvedValue({ metaData: opts.metaData ?? {} });
    // W10-REOPEN-REVERSALS review repair CR-REOPEN-1 (D-102): the paid handler reads the invoice
    // status before its write and after it (PAID unless a case says otherwise; a list is read in turn).
    const statuses = Array.isArray(opts.invoiceStatus) ? [...opts.invoiceStatus] : null;
    const invoiceFindFirst = vi.fn().mockImplementation(() =>
      Promise.resolve({ status: statuses ? (statuses.length > 1 ? statuses.shift() : statuses[0]) : opts.invoiceStatus ?? 'PAID' }),
    );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const eventsFindMany = vi.fn().mockResolvedValue([]);
    const eventCreate = vi.fn().mockResolvedValue({});
    const prisma: any = {
      client: {
        project: { findMany, update, updateMany },
        business: { findUnique },
        invoice: { findFirst: invoiceFindFirst },
        businessEvent: { findMany: eventsFindMany, create: eventCreate },
      },
    };
    const events: any = { emit: vi.fn() };
    const listener = new ProjectRevenueListener(prisma, events);
    return { listener, findMany, update, updateMany, findUnique, invoiceFindFirst, eventsFindMany, eventCreate, events };
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

  it('W10-REOPEN-REVERSALS CR-REOPEN-1 (D-102): a stale invoice.paid for an invoice that is no longer PAID (reopened since) advances nothing', async () => {
    const { listener, findMany, update, invoiceFindFirst } = build({ projects: [{ id: 'p_1' }], invoiceStatus: 'SENT' });
    await listener.onInvoicePaid({ invoice: { id: 'inv_1' }, businessId: 'biz_1' });
    expect(invoiceFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'inv_1', businessId: 'biz_1' } }));
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('W10-REOPEN-REVERSALS CR-REOPEN-1 (D-102): the invoice reopened while the advance was written -> the check after the write steps the recorded advance back (compare-and-set on the status it set)', async () => {
    const { listener, update, updateMany, eventsFindMany, eventCreate } = build({ projects: [{ id: 'p_1' }], invoiceStatus: ['PAID', 'SENT'] });
    eventsFindMany.mockResolvedValue([
      { subjectId: 'p_1', eventType: 'project.status_advanced', before: { status: 'ACTIVE' }, after: { status: 'IN_PROGRESS' } },
    ]);
    await listener.onInvoicePaid({ invoice: { id: 'inv_1' }, businessId: 'biz_1' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'IN_PROGRESS' } }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p_1', businessId: 'biz_1', invoiceId: 'inv_1', status: 'IN_PROGRESS', deletedAt: null },
      data: { status: 'ACTIVE' },
    });
    expect(eventCreate.mock.calls.map(([a]: any[]) => a.data.eventType)).toEqual(['project.status_advanced', 'project.status_reverted']);
  });
});
