/**
 * The generation history behind the recurring panel's history drawer.
 *
 * The drawer called `GET .../recurring-invoices/:id/history` from the day it
 * was written and the server never served it, so it opened empty rather than
 * erroring — the failure mode that looks like "this schedule has never run".
 *
 * The tests worth having here are about the OWNERSHIP CHECK, not the listing.
 * The obvious implementation reads invoices `where { businessId,
 * recurringInvoiceId }` and skips checking the schedule itself. That is not
 * merely a missing check: for another tenant's schedule id it returns `[]`,
 * which the drawer renders as "no invoices generated yet". A caller cannot tell
 * a schedule that has never run from one they may not see, and neither can the
 * person reading a bug report about it.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';

const INVOICE = {
  id: 'inv_1',
  invoiceNumber: 'INV-0001',
  status: 'PAID',
  total: 250,
  currency: 'TTD',
  issueDate: new Date('2026-08-01'),
  dueDate: new Date('2026-08-15'),
  paidAt: new Date('2026-08-03'),
  createdAt: new Date('2026-08-01'),
};

/** `schedules` are the rows visible to the querying business. */
function build(schedules: Array<{ id: string; businessId: string }>, invoices = [INVOICE]) {
  const findFirst = vi.fn(async ({ where }: any) =>
    schedules.find((s) => s.id === where.id && s.businessId === where.businessId) ?? null,
  );
  const findMany = vi.fn(async () => invoices);
  const prisma = {
    client: {
      recurringInvoice: { findFirst },
      invoice: { findMany },
    },
  };
  const svc = new RecurringInvoiceService(prisma as never, { emit: vi.fn() } as never);
  return { svc, findFirst, findMany };
}

describe('recurring invoice generation history', () => {
  it('returns the invoices a schedule has produced', async () => {
    const { svc } = build([{ id: 'rec_1', businessId: 'biz_1' }]);

    const rows = await svc.listGenerationHistory('biz_1', 'rec_1');

    expect(rows).toHaveLength(1);
    // The drawer reads these fields by name; a rename here breaks it silently.
    expect(rows[0]).toMatchObject({
      invoiceNumber: 'INV-0001',
      status: 'PAID',
      total: 250,
      currency: 'TTD',
    });
  });

  it('refuses another business’s schedule instead of returning an empty list', async () => {
    const { svc, findMany } = build([{ id: 'rec_1', businessId: 'biz_OTHER' }]);

    await expect(svc.listGenerationHistory('biz_1', 'rec_1')).rejects.toBeInstanceOf(NotFoundException);
    // And it must not have gone looking for the invoices at all.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes the invoice query by business as well as by schedule', async () => {
    const { svc, findMany } = build([{ id: 'rec_1', businessId: 'biz_1' }]);

    await svc.listGenerationHistory('biz_1', 'rec_1');

    // Belt and braces: the ownership check above is the real control, but the
    // query must not widen to every business's invoices for this schedule id.
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      businessId: 'biz_1',
      recurringInvoiceId: 'rec_1',
    });
  });

  it('reports a schedule that has genuinely never run as empty', async () => {
    const { svc } = build([{ id: 'rec_1', businessId: 'biz_1' }], []);

    // The case the missing ownership check would have been indistinguishable
    // from. It must still be reachable, and it must still be [].
    await expect(svc.listGenerationHistory('biz_1', 'rec_1')).resolves.toEqual([]);
  });

  it('excludes a soft-deleted schedule', async () => {
    const { svc, findFirst } = build([{ id: 'rec_1', businessId: 'biz_1' }]);

    await svc.listGenerationHistory('biz_1', 'rec_1');

    expect(findFirst.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
  });
});
