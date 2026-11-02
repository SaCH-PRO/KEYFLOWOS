/**
 * V1-28-BK-SETTLEMENT (M42): Booking.paymentStatus follows the booking's
 * invoices. At the V1-16 head the column (UNPAID | DEPOSIT_PAID | PAID) had no
 * writer at all, so every booking read UNPAID whatever had been paid.
 *
 * BookingPaymentStatusListener takes invoice.paid and moves the booking the
 * invoice belongs to, by the DATABASE's word, not the event's:
 *
 *   LS-01  the booking's deposit invoice is PAID      -> DEPOSIT_PAID (only from UNPAID)
 *   LS-02  the booking's final invoice is PAID        -> PAID (from UNPAID or DEPOSIT_PAID)
 *   LS-03  a replay writes nothing (conditional update, count 0)
 *   LS-04  an older deposit event after PAID never downgrades; a forfeited deposit (D-26) stays forfeited
 *   LS-05  another tenant's event finds nothing: the invoice and the booking are read under the event's businessId
 *   LS-06  a payload whose invoice names another business than the event is ignored before any read
 *   LS-07  an invoice the database does not hold as PAID (a stale replay after a refund) moves nothing
 *   LS-08  an invoice no booking points at, and a malformed payload, move nothing
 *   LS-09  a database failure is logged, never thrown into the emitter
 *   LS-10  it is wired: @OnEvent('invoice.paid') on onInvoicePaid, and BookingsModule provides it
 *
 * The real-database half (real workflow payloads, real rows) is
 * test/booking-settlement.integration.test.ts S-05.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
import { BookingPaymentStatusListener } from './booking-payment-status.listener';
import { BookingsModule } from './bookings.module';

type Inv = { id: string; businessId: string; status: string; deletedAt: Date | null };
type Bk = { id: string; businessId: string; invoiceId: string | null; depositInvoiceId: string | null; paymentStatus: string; deletedAt: Date | null };

/** Just enough of Prisma for the listener: findFirst with the where shapes it uses, conditional updateMany. */
function fakePrisma(invoices: Inv[], bookings: Bk[]) {
  const writes: Array<{ id: string; to: string }> = [];
  const matchIn = (v: string, cond: any) => (cond?.in ? cond.in.includes(v) : cond === undefined || cond === v);
  const client = {
    invoice: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = invoices.find(
          (i) => i.id === where.id && i.businessId === where.businessId && (where.deletedAt === undefined || i.deletedAt === where.deletedAt),
        );
        return row ? { id: row.id, status: row.status } : null;
      }),
    },
    booking: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = bookings.find(
          (b) =>
            b.businessId === where.businessId &&
            b.deletedAt === null &&
            (where.OR as any[]).some((o) => (o.invoiceId && b.invoiceId === o.invoiceId) || (o.depositInvoiceId && b.depositInvoiceId === o.depositInvoiceId)),
        );
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = bookings.find((b) => b.id === where.id && b.businessId === where.businessId && matchIn(b.paymentStatus, where.paymentStatus));
        if (!row) return { count: 0 };
        row.paymentStatus = data.paymentStatus;
        writes.push({ id: row.id, to: data.paymentStatus });
        return { count: 1 };
      }),
    },
  };
  return { prisma: { client } as any, client, writes };
}

const A = 'biz_a';
const B = 'biz_b';

function fixture(overrides: { depositStatus?: string; finalStatus?: string; paymentStatus?: string } = {}) {
  const invoices: Inv[] = [
    { id: 'inv_dep', businessId: A, status: overrides.depositStatus ?? 'PAID', deletedAt: null },
    { id: 'inv_final', businessId: A, status: overrides.finalStatus ?? 'SENT', deletedAt: null },
    { id: 'inv_orphan', businessId: A, status: 'PAID', deletedAt: null },
    { id: 'inv_b', businessId: B, status: 'PAID', deletedAt: null },
  ];
  const bookings: Bk[] = [
    { id: 'bk_a', businessId: A, invoiceId: 'inv_final', depositInvoiceId: 'inv_dep', paymentStatus: overrides.paymentStatus ?? 'UNPAID', deletedAt: null },
    { id: 'bk_b', businessId: B, invoiceId: null, depositInvoiceId: 'inv_b', paymentStatus: 'UNPAID', deletedAt: null },
  ];
  const fake = fakePrisma(invoices, bookings);
  return { ...fake, invoices, bookings, listener: new BookingPaymentStatusListener(fake.prisma) };
}

const paid = (invoiceId: string, businessId = A, invoiceBusinessId: string = businessId) => ({
  businessId,
  invoice: { id: invoiceId, businessId: invoiceBusinessId, status: 'PAID' },
});

describe('BookingPaymentStatusListener (V1-28, M42)', () => {
  it('LS-01: the deposit invoice paid -> DEPOSIT_PAID, written only from UNPAID', async () => {
    const f = fixture();
    const out = await f.listener.onInvoicePaid(paid('inv_dep') as any);
    expect(f.bookings[0].paymentStatus).toBe('DEPOSIT_PAID');
    expect(out).toMatchObject({ bookingId: 'bk_a', paymentStatus: 'DEPOSIT_PAID', changed: true });
    expect(f.client.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'bk_a', businessId: A, paymentStatus: { in: ['UNPAID'] } },
      data: { paymentStatus: 'DEPOSIT_PAID' },
    });
  });

  it('LS-02: the final invoice paid -> PAID, from UNPAID and from DEPOSIT_PAID', async () => {
    for (const from of ['UNPAID', 'DEPOSIT_PAID']) {
      const f = fixture({ finalStatus: 'PAID', paymentStatus: from });
      const out = await f.listener.onInvoicePaid(paid('inv_final') as any);
      expect(f.bookings[0].paymentStatus, `from ${from}`).toBe('PAID');
      expect(out).toMatchObject({ paymentStatus: 'PAID', changed: true });
    }
  });

  it('LS-03: a replay writes nothing', async () => {
    const f = fixture();
    await f.listener.onInvoicePaid(paid('inv_dep') as any);
    const again = await f.listener.onInvoicePaid(paid('inv_dep') as any);
    expect(f.writes).toEqual([{ id: 'bk_a', to: 'DEPOSIT_PAID' }]);
    expect(again).toMatchObject({ paymentStatus: 'DEPOSIT_PAID', changed: false });
  });

  it('LS-04: an older deposit event after PAID never downgrades; a forfeited deposit stays forfeited', async () => {
    const f = fixture({ paymentStatus: 'PAID' });
    await f.listener.onInvoicePaid(paid('inv_dep') as any);
    expect(f.bookings[0].paymentStatus).toBe('PAID');
    const g = fixture({ paymentStatus: 'DEPOSIT_FORFEITED' });
    await g.listener.onInvoicePaid(paid('inv_dep') as any);
    expect(g.bookings[0].paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect([...f.writes, ...g.writes]).toEqual([]);
  });

  it("LS-05: another tenant's event finds nothing: A's invoice under B, B's invoice under A", async () => {
    const f = fixture();
    const underB = await f.listener.onInvoicePaid(paid('inv_dep', B) as any);
    const underA = await f.listener.onInvoicePaid(paid('inv_b', A) as any);
    expect(underB).toMatchObject({ changed: false });
    expect(underA).toMatchObject({ changed: false });
    expect(f.bookings.map((b) => b.paymentStatus)).toEqual(['UNPAID', 'UNPAID']);
    expect(f.client.booking.updateMany).not.toHaveBeenCalled();
  });

  it('LS-06: an invoice that names another business than the event is ignored before any read', async () => {
    const f = fixture();
    const out = await f.listener.onInvoicePaid(paid('inv_dep', A, B) as any);
    expect(out).toMatchObject({ changed: false });
    expect(f.client.invoice.findFirst).not.toHaveBeenCalled();
    expect(f.client.booking.updateMany).not.toHaveBeenCalled();
  });

  it('LS-07: an invoice the database does not hold as PAID moves nothing (the event is not the authority)', async () => {
    const f = fixture({ depositStatus: 'SENT' });
    const out = await f.listener.onInvoicePaid(paid('inv_dep') as any);
    expect(out).toMatchObject({ changed: false });
    expect(f.bookings[0].paymentStatus).toBe('UNPAID');
    expect(f.client.booking.updateMany).not.toHaveBeenCalled();
  });

  it('LS-08: an invoice no booking points at, and a malformed payload, move nothing', async () => {
    const f = fixture();
    expect(await f.listener.onInvoicePaid(paid('inv_orphan') as any)).toMatchObject({ changed: false });
    expect(await f.listener.onInvoicePaid({ businessId: A } as any)).toMatchObject({ changed: false });
    expect(await f.listener.onInvoicePaid(undefined as any)).toMatchObject({ changed: false });
    expect(f.client.booking.updateMany).not.toHaveBeenCalled();
  });

  it('LS-09: a database failure is logged, never thrown into the emitter', async () => {
    const f = fixture();
    f.client.invoice.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(f.listener.onInvoicePaid(paid('inv_dep') as any)).resolves.toMatchObject({ changed: false });
  });

  it("LS-10: it is wired: @OnEvent('invoice.paid') on onInvoicePaid, and BookingsModule provides it", () => {
    const meta = Reflect.getMetadata(EVENT_LISTENER_METADATA, BookingPaymentStatusListener.prototype.onInvoicePaid);
    expect(meta).toEqual([expect.objectContaining({ event: 'invoice.paid' })]);
    const providers: unknown[] = Reflect.getMetadata('providers', BookingsModule) ?? [];
    expect(providers).toContain(BookingPaymentStatusListener);
  });
});
