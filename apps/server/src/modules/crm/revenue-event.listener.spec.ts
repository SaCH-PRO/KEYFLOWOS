import { describe, it, expect, vi } from 'vitest';
import { RevenueEventListener } from './revenue-event.listener';

describe('RevenueEventListener (idempotency)', () => {
  function build(opts: {
    recentEvents?: Array<{ data?: any }>;
    invoiceContactId?: string | null;
  } = {}) {
    const logEvent = vi.fn().mockResolvedValue(undefined);
    const markStale = vi.fn().mockResolvedValue(undefined);
    const findManyContactEvent = vi.fn().mockResolvedValue(opts.recentEvents ?? []);
    const findFirstInvoice = vi.fn().mockResolvedValue(
      opts.invoiceContactId !== undefined ? { contactId: opts.invoiceContactId } : null,
    );
    const findFirstContact = vi.fn().mockResolvedValue(null);
    const prisma: any = {
      client: {
        contactEvent: { findMany: findManyContactEvent },
        invoice: { findFirst: findFirstInvoice },
        contact: { findFirst: findFirstContact },
      },
    };
    const timeline: any = { logEvent };
    const insights: any = { markStale };
    const listener = new RevenueEventListener(prisma, timeline, insights);
    return { listener, logEvent, markStale, findManyContactEvent, findFirstInvoice };
  }

  it('writes a timeline row for a fresh quote.viewed event', async () => {
    const { listener, logEvent, markStale } = build();
    await listener.onQuoteViewed({
      businessId: 'biz_1',
      quote: { id: 'q_1', contactId: 'c_1', quoteNumber: 'Q-1' },
      viewedAt: new Date().toISOString(),
      source: 'public-link',
    } as any);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][2]).toBe('quote.viewed');
    expect(logEvent.mock.calls[0][3].dedupeKey).toBe('rev:quote.viewed:q_1');
    expect(markStale).toHaveBeenCalledWith('biz_1', 'c_1');
  });

  it('skips a duplicate event with the same dedupeKey within the recent window', async () => {
    const { listener, logEvent } = build({
      recentEvents: [{ data: { dedupeKey: 'rev:quote.viewed:q_1' } }],
    });
    await listener.onQuoteViewed({
      businessId: 'biz_1',
      quote: { id: 'q_1', contactId: 'c_1' },
    } as any);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('writes when a recent event has a different dedupeKey', async () => {
    const { listener, logEvent } = build({
      recentEvents: [{ data: { dedupeKey: 'rev:quote.viewed:q_OTHER' } }],
    });
    await listener.onQuoteViewed({
      businessId: 'biz_1',
      quote: { id: 'q_1', contactId: 'c_1' },
    } as any);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('booking.invoice_created → writes invoice.from_booking exactly once', async () => {
    const { listener, logEvent } = build();
    await listener.onBookingInvoiceCreated({
      businessId: 'biz_1',
      booking: { id: 'bk_1', contactId: 'c_9' },
      invoice: { id: 'inv_77', invoiceNumber: 'INV-77', total: 250, currency: 'TTD' },
    } as any);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][2]).toBe('invoice.from_booking');
    expect(logEvent.mock.calls[0][3].bookingId).toBe('bk_1');
    expect(logEvent.mock.calls[0][3].invoiceId).toBe('inv_77');
  });

  it('booking.invoice_created → suppressed if a legacy invoice.from_booking row already exists for that invoice', async () => {
    const { listener, logEvent } = build({
      recentEvents: [{ data: { invoiceId: 'inv_77', source: 'legacy-direct-write' } }],
    });
    await listener.onBookingInvoiceCreated({
      businessId: 'biz_1',
      booking: { id: 'bk_1', contactId: 'c_9' },
      invoice: { id: 'inv_77', invoiceNumber: 'INV-77', total: 250, currency: 'TTD' },
    } as any);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('skips when a legacy row (no dedupeKey) matches by entityId', async () => {
    const { listener, logEvent } = build({
      recentEvents: [{ data: { quoteId: 'q_1', source: 'legacy-direct-write' } }],
    });
    await listener.onQuoteViewed({
      businessId: 'biz_1',
      quote: { id: 'q_1', contactId: 'c_1' },
    } as any);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('no-ops when contactId cannot be resolved', async () => {
    const { listener, logEvent } = build();
    await listener.onQuoteViewed({ businessId: 'biz_1', quote: { id: 'q_x' } } as any);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('payment.failed resolves contact via invoice lookup', async () => {
    const { listener, logEvent, findFirstInvoice } = build({ invoiceContactId: 'c_42' });
    await listener.onPaymentFailed({
      businessId: 'biz_1',
      invoiceId: 'inv_1',
      amount: 100,
      currency: 'TTD',
      provider: 'stripe',
      error: 'card_declined',
    } as any);
    expect(findFirstInvoice).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][1]).toBe('c_42');
    expect(logEvent.mock.calls[0][2]).toBe('payment.failed');
  });

  it('store_order.fulfillment_routed without contactId is skipped', async () => {
    const { listener, logEvent } = build();
    await listener.onFulfillmentRouted({
      businessId: 'biz_1',
      orderId: 'o_1',
      strategies: ['LOCAL_STOCK'],
      routeCount: 1,
      contactId: null,
    });
    expect(logEvent).not.toHaveBeenCalled();
  });
});
