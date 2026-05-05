import { describe, it, expect, vi } from 'vitest';
import { NotificationsRevenueListener } from './notifications-revenue.listener';

describe('NotificationsRevenueListener', () => {
  function build(opts: { existing?: { data?: any } | null } = {}) {
    const create = vi.fn().mockResolvedValue({ id: 'notif_1' });
    const findFirst = vi.fn().mockResolvedValue(opts.existing ?? null);
    const notifications: any = { create };
    const prisma: any = { client: { notification: { findFirst } } };
    const listener = new NotificationsRevenueListener(notifications, prisma);
    return { listener, create, findFirst };
  }

  it('writes a notification on invoice.overdue', async () => {
    const { listener, create } = build();
    await listener.onInvoiceOverdue({
      businessId: 'biz_1',
      invoice: { id: 'inv_1', invoiceNumber: 'INV-100', contactId: 'c_1' },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      businessId: 'biz_1',
      type: 'invoice.overdue',
      data: expect.objectContaining({ dedupeKey: 'notif:invoice.overdue:inv_1' }),
    });
  });

  it('skips duplicate within 24h window', async () => {
    const { listener, create } = build({
      existing: { data: { dedupeKey: 'notif:invoice.overdue:inv_1' } },
    });
    await listener.onInvoiceOverdue({
      businessId: 'biz_1',
      invoice: { id: 'inv_1', invoiceNumber: 'INV-100' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('writes payment.received notification', async () => {
    const { listener, create } = build();
    await listener.onPaymentReceived({
      businessId: 'biz_1',
      invoiceId: 'inv_1',
      contactId: 'c_1',
      amount: 250,
      currency: 'TTD',
      provider: 'stripe',
      externalId: 'pi_x',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].type).toBe('payment.received');
    expect(create.mock.calls[0][0].data.dedupeKey).toBe('notif:payment.received:pi_x');
  });

  it('writes quote.sent notification', async () => {
    const { listener, create } = build();
    await listener.onQuoteSent({
      businessId: 'biz_1',
      quote: { id: 'q_1', quoteNumber: 'Q-1', contactId: 'c_1' },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].type).toBe('quote.sent');
    expect(create.mock.calls[0][0].data.dedupeKey).toBe('notif:quote.sent:q_1');
  });
});
