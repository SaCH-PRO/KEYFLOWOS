/**
 * "Invoice everything unbilled on the Ramkissoon project."
 *
 * The join the capability map named and nobody had written: both legs existed
 * — `markAsBilled` sets `billed` and `invoiceId`, `TimeEntry` carries
 * `hourlyRate` and an `invoice` relation, and there is already an index on
 * `[businessId, billable, billed]` — while nothing in `commerce` or `projects`
 * read `timeEntry` at all.
 *
 * The three assertions that matter here are all refusals, because every failure
 * mode of this feature ends with hours that can never be recovered: once
 * `billed` is true, unbilled time is indistinguishable from time already paid
 * for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimeEntryService } from './time-entry.service';

const BIZ = 'biz_1';

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'te1',
    businessId: BIZ,
    durationMinutes: 60,
    hourlyRate: 100,
    billable: true,
    billed: false,
    description: 'Work',
    task: null,
    project: { name: 'Ramkissoon' },
    ...over,
  };
}

function makeService(entries: unknown[], markedCount = entries.length) {
  const prisma = {
    client: {
      timeEntry: {
        findMany: vi.fn(async () => entries),
        updateMany: vi.fn(async () => ({ count: markedCount })),
      },
      invoice: { findFirst: vi.fn(async () => ({ id: 'inv_1' })) },
    },
  };
  return new TimeEntryService(prisma as never);
}

const createInvoice = vi.fn(async () => ({ id: 'inv_1', invoiceNumber: 'INV-001', total: 100 }));

beforeEach(() => createInvoice.mockClear());

describe('invoicing unbilled time', () => {
  it('turns hours into invoice lines at the entry rate', async () => {
    const svc = makeService([
      entry({ id: 'a', durationMinutes: 90, hourlyRate: 100, task: { title: 'Design' } }),
      entry({ id: 'b', durationMinutes: 30, hourlyRate: 100, task: { title: 'Design' } }),
      entry({ id: 'c', durationMinutes: 60, hourlyRate: 200, task: { title: 'Review' } }),
    ]);

    const out = await svc.invoiceUnbilledTime(BIZ, { projectId: 'p1', createInvoice });

    const items = createInvoice.mock.calls[0][0].items;
    // Design: 90 + 30 minutes = 2h at 100. Review: 1h at 200.
    expect(items).toEqual([
      { description: 'Design', quantity: 2, unitPrice: 100 },
      { description: 'Review', quantity: 1, unitPrice: 200 },
    ]);
    expect(out.entriesBilled).toBe(3);
    expect(out.totalMinutes).toBe(180);
  });

  it('refuses to invoice nothing rather than issuing an empty invoice', async () => {
    const svc = makeService([]);
    await expect(
      svc.invoiceUnbilledTime(BIZ, { projectId: 'p1', createInvoice }),
    ).rejects.toThrow(/no unbilled billable time/i);
    // The sharp part: no invoice was created. A zero-total invoice reported as
    // success is the fabricated-success shape, and this one reaches a customer.
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it('refuses entries with no hourly rate instead of billing them at zero', async () => {
    const svc = makeService([entry({ id: 'a' }), entry({ id: 'b', hourlyRate: null })]);
    await expect(
      svc.invoiceUnbilledTime(BIZ, { projectId: 'p1', createInvoice }),
    ).rejects.toThrow(/no hourly rate/i);
    expect(createInvoice).not.toHaveBeenCalled();
    // Billing an hour at an implicit zero marks it billed, shortens the
    // invoice, and makes the time unrecoverable — all silently.
  });

  it('refuses when fewer entries were marked than were invoiced', async () => {
    // The silent-zero class. updateMany returns a count and this is the only
    // place that reads it. If the count is short, those hours are on an invoice
    // AND still look unbilled, so the next run bills them again.
    const svc = makeService([entry({ id: 'a' }), entry({ id: 'b', id: 'b' })], 1);
    await expect(
      svc.invoiceUnbilledTime(BIZ, { projectId: 'p1', createInvoice }),
    ).rejects.toThrow(/only 1 of 2 time entries were marked billed/i);
  });

  it('separates the same label billed at two different rates', async () => {
    const svc = makeService([
      entry({ id: 'a', hourlyRate: 100, task: { title: 'Support' } }),
      entry({ id: 'b', hourlyRate: 150, task: { title: 'Support' } }),
    ]);
    await svc.invoiceUnbilledTime(BIZ, { projectId: 'p1', createInvoice });
    const items = createInvoice.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    expect(items.map((i: { unitPrice: number }) => i.unitPrice).sort()).toEqual([100, 150]);
  });
});
