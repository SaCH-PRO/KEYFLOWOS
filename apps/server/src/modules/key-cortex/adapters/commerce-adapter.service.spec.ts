import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommerceAdapterService } from './commerce-adapter.service';
import { CommerceService } from '../../commerce/commerce.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'commerce',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('CommerceAdapterService', () => {
  let service: CommerceAdapterService;
  let commerce: CommerceService;

  beforeEach(() => {
    commerce = {
      createInvoice: vi.fn(),
      bulkUpdateInvoices: vi.fn(),
      getInvoiceWithBusiness: vi.fn(),
      listInvoices: vi.fn(),
      createProduct: vi.fn(),
      listProducts: vi.fn(),
      createQuote: vi.fn(),
      bulkUpdateQuotes: vi.fn(),
      getQuote: vi.fn(),
      recordPayment: vi.fn(),
      listAllPayments: vi.fn(),
    } as unknown as CommerceService;

    service = new CommerceAdapterService(commerce);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('create_invoice delegates and optionally sends', async () => {
    (commerce.createInvoice as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inv1' });
    (commerce.bulkUpdateInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 1 });
    const result = await service.execute(mkCmd('create_invoice', {
      contactId: 'c1',
      items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
      sendImmediately: true,
    }));
    expect(result.success).toBe(true);
    expect(commerce.createInvoice).toHaveBeenCalled();
    expect(commerce.bulkUpdateInvoices).toHaveBeenCalledWith('biz_123', ['inv1'], 'send');
  });

  it('send_invoice delegates to bulkUpdateInvoices', async () => {
    (commerce.bulkUpdateInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 1 });
    const result = await service.execute(mkCmd('send_invoice', { invoiceId: 'inv1' }));
    expect(result.success).toBe(true);
    expect(commerce.bulkUpdateInvoices).toHaveBeenCalledWith('biz_123', ['inv1'], 'send');
  });

  it('get_invoice returns invoice', async () => {
    (commerce.getInvoiceWithBusiness as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inv1' });
    const result = await service.execute(mkCmd('get_invoice', { invoiceId: 'inv1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'inv1' });
  });

  it('process_payment delegates to recordPayment', async () => {
    (commerce.recordPayment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pay1' });
    const result = await service.execute(mkCmd('process_payment', { invoiceId: 'inv1', amount: 100, method: 'cash' }));
    expect(result.success).toBe(true);
    expect(commerce.recordPayment).toHaveBeenCalledWith('inv1', 'biz_123', { amount: 100, method: 'cash', reference: undefined });
  });

  it('create_order creates an invoice as order record', async () => {
    (commerce.createInvoice as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ord1' });
    const result = await service.execute(mkCmd('create_order', { contactId: 'c1', items: [{ description: 'X', quantity: 1, unitPrice: 100 }] }));
    expect(result.success).toBe(true);
    expect(commerce.createInvoice).toHaveBeenCalled();
  });

  it('send_quote delegates to bulkUpdateQuotes', async () => {
    (commerce.bulkUpdateQuotes as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 1 });
    const result = await service.execute(mkCmd('send_quote', { quoteId: 'q1' }));
    expect(result.success).toBe(true);
    expect(commerce.bulkUpdateQuotes).toHaveBeenCalledWith('biz_123', ['q1'], 'send');
  });

  // ── Queries (Phase 1.2) ───────────────────────────────────────────────────

  it('get_revenue_summary uses explicit date range', async () => {
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-01-31T23:59:59.999Z';
    (commerce.listInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { status: 'PAID', total: 100, paidAt: '2026-01-15T00:00:00.000Z' },
        { status: 'SENT', total: 200, paidAt: null },
      ],
    });
    const result = await service.execute(mkCmd('get_revenue_summary', { from, to }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ total: 100, count: 1, period: 'custom' });
  });

  it('get_outstanding_invoices filters to unpaid statuses', async () => {
    (commerce.listInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { id: 'inv1', status: 'SENT', contactId: 'c1', dueDate: '2026-12-31' },
        { id: 'inv2', status: 'PAID', contactId: 'c1' },
        { id: 'inv3', status: 'OVERDUE', contactId: 'c2', dueDate: '2025-01-01' },
      ],
    });
    const result = await service.execute(mkCmd('get_outstanding_invoices', { contactId: 'c1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'inv1', status: 'SENT', contactId: 'c1', dueDate: '2026-12-31' }]);
  });

  it('get_product_catalog returns products', async () => {
    (commerce.listProducts as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [{ id: 'p1', name: 'Widget' }] });
    const result = await service.execute(mkCmd('get_product_catalog', { search: 'wid' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'p1', name: 'Widget' }]);
  });

  it('get_payment_history returns payments', async () => {
    (commerce.listAllPayments as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'pay1', invoiceId: 'inv1' },
      { id: 'pay2', invoiceId: 'inv2' },
    ]);
    const result = await service.execute(mkCmd('get_payment_history', { invoiceId: 'inv1', limit: 10 }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'pay1', invoiceId: 'inv1' }]);
  });

  it('get_quote_status returns quote', async () => {
    (commerce.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'q1', status: 'SENT' });
    const result = await service.execute(mkCmd('get_quote_status', { quoteId: 'q1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'q1', status: 'SENT' });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown commerce action');
  });
});
