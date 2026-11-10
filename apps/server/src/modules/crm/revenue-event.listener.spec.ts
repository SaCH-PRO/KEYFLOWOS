import { describe, it, expect, vi } from 'vitest';
import { RevenueEventListener } from './revenue-event.listener';

describe('RevenueEventListener (idempotency)', () => {
  function build(opts: {
    recentEvents?: Array<{ data?: any }>;
    invoiceContactId?: string | null;
    /** W9-CRM-RESIDUALS (L-12): whether the payload's contact is a contact of the payload's business (default: it is). */
    contactInBusiness?: boolean;
  } = {}) {
    const logEvent = vi.fn().mockResolvedValue(undefined);
    const markStale = vi.fn().mockResolvedValue(undefined);
    const findManyContactEvent = vi.fn().mockResolvedValue(opts.recentEvents ?? []);
    const findFirstInvoice = vi.fn().mockResolvedValue(
      opts.invoiceContactId !== undefined ? { contactId: opts.invoiceContactId } : null,
    );
    const findFirstContact = vi.fn().mockResolvedValue(null);
    const aggregateContact = vi.fn().mockResolvedValue({ _count: { _all: opts.contactInBusiness === false ? 0 : 1 } });
    const prisma: any = {
      client: {
        contactEvent: { findMany: findManyContactEvent },
        invoice: { findFirst: findFirstInvoice },
        contact: { findFirst: findFirstContact, aggregate: aggregateContact },
      },
    };
    const timeline: any = { logEvent };
    const insights: any = { markStale };
    const listener = new RevenueEventListener(prisma, timeline, insights);
    return { listener, logEvent, markStale, findManyContactEvent, findFirstInvoice, aggregateContact };
  }

  it('L-12 (W9-CRM-RESIDUALS, crm-lifecycle-paid-invoice L-12): a payload naming a contact outside its business writes no timeline entry and marks no insight stale; the lookup is bound to that business', async () => {
    const { listener, logEvent, markStale, aggregateContact } = build({ contactInBusiness: false });
    await listener.onQuoteViewed({ businessId: 'biz_1', quote: { id: 'q_1', contactId: 'c_other_tenant' } } as any);
    await listener.onInvoicePaid({ businessId: 'biz_1', invoice: { id: 'inv_9', contactId: 'c_other_tenant', paidAt: null } } as any);
    await listener.onPaymentReceived({ businessId: 'biz_1', contactId: 'c_other_tenant', amount: 5, currency: 'TTD', provider: 'stripe' } as any);
    expect(logEvent).not.toHaveBeenCalled();
    expect(markStale).not.toHaveBeenCalled();
    expect(aggregateContact).toHaveBeenCalledWith({ where: { id: 'c_other_tenant', businessId: 'biz_1' }, _count: { _all: true } });
  });

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

  describe('FOLLOW3-A9 review (SEC-A9-2 / CR-A9-1): invoice.paid / invoice.reopened dedupe per transition', () => {
    const T1 = '2026-11-03T10:00:00.000Z';
    const T2 = '2026-11-03T10:01:00.000Z';
    const T3 = '2026-11-03T10:02:00.000Z';
    const row = (type: string, at: string, data: Record<string, unknown>) => ({ type, createdAt: new Date(at), data });
    const paidPayload = (paidAt: string | null) => ({ businessId: 'biz_1', invoice: { id: 'inv_1', contactId: 'c_1', paidAt } }) as any;
    const reopenPayload = (updatedAt: string | null) =>
      ({ businessId: 'biz_1', status: 'SENT', previousStatus: 'PAID', invoice: { id: 'inv_1', contactId: 'c_1', updatedAt } }) as any;

    it('reads both transition types of the invoice in the window', async () => {
      const { listener, findManyContactEvent } = build();
      await listener.onInvoicePaid(paidPayload(T1));
      expect(findManyContactEvent.mock.calls[0][0].where.type).toEqual({ in: ['invoice.paid', 'invoice.reopened'] });
      await listener.onQuoteViewed({ businessId: 'biz_1', quote: { id: 'q_1', contactId: 'c_1' } } as any);
      expect(findManyContactEvent.mock.calls[1][0].where.type).toBe('quote.viewed');
    });

    it('a re-delivered invoice.paid (same paidAt, no reopen since) is a duplicate', async () => {
      const { listener, logEvent } = build({
        recentEvents: [row('invoice.paid', T1, { invoiceId: 'inv_1', paidAt: T1, dedupeKey: 'rev:invoice.paid:inv_1' })],
      });
      await listener.onInvoicePaid(paidPayload(T1));
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('the mark-paid direct write (no dedupeKey, same invoiceId and paidAt) still suppresses the bus entry', async () => {
      const { listener, logEvent } = build({ recentEvents: [row('invoice.paid', T1, { invoiceId: 'inv_1', paidAt: T1 })] });
      await listener.onInvoicePaid(paidPayload(T1));
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('invoice.paid after a newer invoice.reopened of the invoice is a new transition: written', async () => {
      const { listener, logEvent } = build({
        recentEvents: [
          row('invoice.reopened', T2, { invoiceId: 'inv_1', reopenedAt: T2, dedupeKey: 'rev:invoice.reopened:inv_1' }),
          row('invoice.paid', T1, { invoiceId: 'inv_1', paidAt: T1, dedupeKey: 'rev:invoice.paid:inv_1' }),
        ],
      });
      // No paidAt on the payload: the reopen alone tells the moves apart.
      await listener.onInvoicePaid(paidPayload(null));
      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(logEvent.mock.calls[0][2]).toBe('invoice.paid');
    });

    it('invoice.paid with another paidAt is a new transition even when the reopen entry is missing', async () => {
      const { listener, logEvent } = build({
        recentEvents: [row('invoice.paid', T1, { invoiceId: 'inv_1', paidAt: T1, dedupeKey: 'rev:invoice.paid:inv_1' })],
      });
      await listener.onInvoicePaid(paidPayload(T3));
      expect(logEvent).toHaveBeenCalledTimes(1);
    });

    it('a reopen of another invoice does not make a duplicate paid new', async () => {
      const { listener, logEvent } = build({
        recentEvents: [
          row('invoice.reopened', T2, { invoiceId: 'inv_OTHER', reopenedAt: T2, dedupeKey: 'rev:invoice.reopened:inv_OTHER' }),
          row('invoice.paid', T1, { invoiceId: 'inv_1', paidAt: T1, dedupeKey: 'rev:invoice.paid:inv_1' }),
        ],
      });
      await listener.onInvoicePaid(paidPayload(T1));
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('a second invoice.reopened after a newer invoice.paid is written, carrying its reopenedAt; a re-delivery of it is not', async () => {
      const history = [
        row('invoice.paid', T2, { invoiceId: 'inv_1', paidAt: T2, dedupeKey: 'rev:invoice.paid:inv_1' }),
        row('invoice.reopened', T1, { invoiceId: 'inv_1', reopenedAt: T1, dedupeKey: 'rev:invoice.reopened:inv_1' }),
      ];
      const fresh = build({ recentEvents: history });
      await fresh.listener.onInvoiceReopened(reopenPayload(T3));
      expect(fresh.logEvent).toHaveBeenCalledTimes(1);
      expect(fresh.logEvent.mock.calls[0][2]).toBe('invoice.reopened');
      expect(fresh.logEvent.mock.calls[0][3]).toMatchObject({ invoiceId: 'inv_1', reopenedAt: T3, previousStatus: 'PAID', status: 'SENT' });

      const again = build({
        recentEvents: [row('invoice.reopened', T3, { invoiceId: 'inv_1', reopenedAt: T3, dedupeKey: 'rev:invoice.reopened:inv_1' }), ...history],
      });
      await again.listener.onInvoiceReopened(reopenPayload(T3));
      expect(again.logEvent).not.toHaveBeenCalled();
    });
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
