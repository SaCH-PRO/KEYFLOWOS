import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommerceAdapterService } from './commerce-adapter.service';
import { CommerceService } from '../../commerce/commerce.service';
import { ConnectorCommand } from '../key-cortex-connector.types';
import { KEY_SYSTEM_ACTOR_ID } from '../../../core/auth/system-actor';

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
      getQuoteForBusiness: vi.fn(),
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
    // R0-PL-07: the same input as before, plus the system actor as the
    // recorder; review PL07-ST-3: and the command's user as the initiator.
    expect(commerce.recordPayment).toHaveBeenCalledWith(
      'inv1',
      'biz_123',
      { amount: 100, method: 'cash', reference: undefined },
      { actorId: KEY_SYSTEM_ACTOR_ID, initiatedBy: 'user_456' },
    );
  });

  it('R0-PL-07: process_payment records KEY_SYSTEM_ACTOR_ID as the actor, never the requesting human or a body field', async () => {
    (commerce.recordPayment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pay2' });
    const result = await service.execute(mkCmd('process_payment', {
      invoiceId: 'inv2', amount: 12.5, method: 'bank_transfer', reference: 'R-1', actorId: 'user_spoof', recordedBy: 'user_spoof',
    }));
    expect(result.success).toBe(true);
    expect(commerce.recordPayment).toHaveBeenCalledTimes(1);
    const [invoiceId, businessId, input, options] = (commerce.recordPayment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([invoiceId, businessId]).toEqual(['inv2', 'biz_123']);
    expect(input).toEqual({ amount: 12.5, method: 'bank_transfer', reference: 'R-1' });
    expect(options).toEqual({ actorId: 'key_ai', initiatedBy: 'user_456' });
    expect(options.actorId).toBe(KEY_SYSTEM_ACTOR_ID);
    expect(options.actorId).not.toBe('user_456'); // command.userId: the human KEY acts for
  });

  it('R0-PL-07 review (PL07-ST-3): process_payment keeps the human KEY acted for as initiatedBy, taken from the command envelope and never from tool parameters', async () => {
    (commerce.recordPayment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pay3' });
    const result = await service.execute(mkCmd('process_payment', {
      invoiceId: 'inv3', amount: 7, method: 'cash', initiatedBy: 'user_spoof',
    }));
    expect(result.success).toBe(true);
    const [, , input, options] = (commerce.recordPayment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input).toEqual({ amount: 7, method: 'cash', reference: undefined });
    expect(options.initiatedBy).toBe('user_456');
    expect(options.initiatedBy).not.toBe('user_spoof');
    expect(options.actorId).toBe(KEY_SYSTEM_ACTOR_ID);
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

  it('get_quote_status reads the quote bound to the command\'s business, never by bare id (ST-PC01-1)', async () => {
    (commerce.getQuoteForBusiness as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'q1', status: 'SENT' });
    const result = await service.execute(mkCmd('get_quote_status', { quoteId: 'q1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'q1', status: 'SENT' });
    expect(commerce.getQuoteForBusiness).toHaveBeenCalledWith('q1', 'biz_123');
    expect(commerce.getQuote).not.toHaveBeenCalled();
  });

  it('get_quote_status fails when the quote does not belong to the command\'s business (ST-PC01-1)', async () => {
    (commerce.getQuoteForBusiness as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (commerce.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'q_other', status: 'DRAFT', businessId: 'biz_other' });
    // The adapter propagates NotFound to its caller, as its other not-found paths do.
    await expect(service.execute(mkCmd('get_quote_status', { quoteId: 'q_other' }))).rejects.toThrow('Quote not found');
    expect(commerce.getQuoteForBusiness).toHaveBeenCalledWith('q_other', 'biz_123');
    expect(commerce.getQuote).not.toHaveBeenCalled();
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown commerce action');
  });
});
