import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceOverdueWatcherService } from './invoice-overdue-watcher.service';

function createMockPrisma(overrides: any = {}) {
  return {
    client: {
      invoice: {
        findMany: vi.fn().mockResolvedValue(overrides.invoices ?? []),
      },
      business: {
        findMany: vi.fn().mockResolvedValue(overrides.businesses ?? []),
      },
    },
  };
}

function createEventBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

function createInvoice(overrides: any = {}) {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-001',
    dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    total: 150,
    currency: 'TTD',
    contact: { id: 'c1', name: 'Alice', email: 'alice@example.com' },
    ...overrides,
  };
}

describe('InvoiceOverdueWatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits proactive.invoice_overdue events for each overdue invoice', async () => {
    const invoices = [createInvoice(), createInvoice({ id: 'inv_2', total: 300 })];
    const mockPrisma = createMockPrisma({ invoices });
    const eventBus = createEventBus();
    const service = new InvoiceOverdueWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scan('biz_1');

    expect(count).toBe(2);
    expect(mockPrisma.client.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz_1',
          status: { in: ['SENT', 'OVERDUE', 'PENDING'] },
          dueDate: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'proactive_watcher',
        type: 'proactive.invoice_overdue',
        businessId: 'biz_1',
        payload: expect.objectContaining({ invoiceId: 'inv_1' }),
      }),
    );
  });

  it('marks deeply overdue invoices as critical', async () => {
    const invoices = [
      createInvoice({ dueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) }),
    ];
    const mockPrisma = createMockPrisma({ invoices });
    const eventBus = createEventBus();
    const service = new InvoiceOverdueWatcherService(mockPrisma as any, eventBus as any);

    await service.scan('biz_1');

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ importance: 'critical' }),
      }),
    );
  });

  it('returns 0 when no overdue invoices exist', async () => {
    const mockPrisma = createMockPrisma({ invoices: [] });
    const eventBus = createEventBus();
    const service = new InvoiceOverdueWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scan('biz_1');

    expect(count).toBe(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('scanAll iterates active businesses and sums emitted events', async () => {
    const businesses = [{ id: 'biz_1' }, { id: 'biz_2' }];
    const invoices = [createInvoice()];
    const mockPrisma = createMockPrisma({ businesses, invoices });
    const eventBus = createEventBus();
    const service = new InvoiceOverdueWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scanAll();

    expect(count).toBe(2);
    expect(mockPrisma.client.business.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ autopilotEnabled: true }) }),
    );
  });

  it('scanAll isolates failures per business', async () => {
    const businesses = [{ id: 'biz_1' }, { id: 'biz_2' }];
    const mockPrisma = createMockPrisma({ businesses });
    mockPrisma.client.invoice.findMany
      .mockResolvedValueOnce([createInvoice()])
      .mockRejectedValueOnce(new Error('DB error'));
    const eventBus = createEventBus();
    const service = new InvoiceOverdueWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scanAll();

    expect(count).toBe(1);
  });
});
