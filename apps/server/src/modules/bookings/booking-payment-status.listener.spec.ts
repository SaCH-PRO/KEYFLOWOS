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
 * V1-28 review repairs:
 *   LS-11  CR-V28-1: the final invoice paid while the deposit is still owed (DRAFT, SENT, OVERDUE,
 *          PARTIALLY_PAID) writes no PAID; once the deposit is paid too, the booking is PAID
 *   LS-12  a VOID deposit, a FULLY_CREDITED deposit, or none: the paid final alone is PAID
 *   LS-13  SEC-V28-3: a deposit still PAID but refunded holds nothing: its event writes no DEPOSIT_PAID
 *   LS-14  depositPosition: billed / held / covers in cents, both refund conventions, applied credits
 *   LS-15  derivePaymentStatus: the rule the listener and the reinstatement both write
 *
 * The real-database half (real workflow payloads, real rows) is
 * test/booking-settlement.integration.test.ts S-05.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
import { BookingPaymentStatusListener, depositPosition, derivePaymentStatus } from './booking-payment-status.listener';
import { BookingsModule } from './bookings.module';

type Pay = { amount: number; status: string };
type Inv = {
  id: string;
  businessId: string;
  status: string;
  deletedAt: Date | null;
  total?: number;
  payments?: Pay[];
  creditNotes?: Array<{ amount: unknown }>;
};
type Bk = { id: string; businessId: string; invoiceId: string | null; depositInvoiceId: string | null; paymentStatus: string; deletedAt: Date | null };

/** Just enough of Prisma for the listener: findFirst with the where shapes it uses, conditional updateMany. */
function fakePrisma(invoices: Inv[], bookings: Bk[]) {
  const writes: Array<{ id: string; to: string }> = [];
  const matchIn = (v: string, cond: any) => (cond?.in ? cond.in.includes(v) : cond === undefined || cond === v);
  const client = {
    invoice: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = invoices.find(
          (i) =>
            i.id === where.id &&
            i.businessId === where.businessId &&
            (where.deletedAt === undefined || i.deletedAt === where.deletedAt) &&
            (where.status?.not === undefined || i.status !== where.status.not),
        );
        return row
          ? {
              id: row.id,
              invoiceNumber: `N-${row.id}`,
              status: row.status,
              total: row.total ?? 25,
              currency: 'TTD',
              payments: row.payments ?? [],
              creditNotes: row.creditNotes ?? [],
            }
          : null;
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

function fixture(
  overrides: { depositStatus?: string; finalStatus?: string; paymentStatus?: string; depositPayments?: Pay[]; noDeposit?: boolean } = {},
) {
  const invoices: Inv[] = [
    { id: 'inv_dep', businessId: A, status: overrides.depositStatus ?? 'PAID', deletedAt: null, payments: overrides.depositPayments },
    { id: 'inv_final', businessId: A, status: overrides.finalStatus ?? 'SENT', deletedAt: null, total: 75 },
    { id: 'inv_orphan', businessId: A, status: 'PAID', deletedAt: null },
    { id: 'inv_b', businessId: B, status: 'PAID', deletedAt: null },
  ];
  const bookings: Bk[] = [
    {
      id: 'bk_a',
      businessId: A,
      invoiceId: 'inv_final',
      depositInvoiceId: overrides.noDeposit ? null : 'inv_dep',
      paymentStatus: overrides.paymentStatus ?? 'UNPAID',
      deletedAt: null,
    },
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
  it('LS-11 (CR-V28-1): the final paid while the deposit is still owed writes no PAID; the deposit paid too makes it PAID', async () => {
    for (const owed of ['DRAFT', 'SENT', 'OVERDUE', 'PARTIALLY_PAID']) {
      const f = fixture({ depositStatus: owed, finalStatus: 'PAID' });
      const out = await f.listener.onInvoicePaid(paid('inv_final') as any);
      expect(f.bookings[0].paymentStatus, `deposit ${owed}`).toBe('UNPAID');
      expect(out, `deposit ${owed}`).toMatchObject({ bookingId: 'bk_a', changed: false });
      expect(f.writes, `deposit ${owed}`).toEqual([]);

      f.invoices[0].status = 'PAID';
      await f.listener.onInvoicePaid(paid('inv_dep') as any);
      expect(f.bookings[0].paymentStatus, `deposit ${owed}, then paid`).toBe('PAID');
      expect(f.writes).toEqual([{ id: 'bk_a', to: 'PAID' }]);
    }
  });

  it('LS-12: a VOID deposit, a FULLY_CREDITED deposit, or no deposit: the paid final is PAID', async () => {
    for (const o of [{ depositStatus: 'VOID' }, { depositStatus: 'FULLY_CREDITED' }, { noDeposit: true }]) {
      const f = fixture({ ...o, finalStatus: 'PAID' });
      await f.listener.onInvoicePaid(paid('inv_final') as any);
      expect(f.bookings[0].paymentStatus, JSON.stringify(o)).toBe('PAID');
    }
  });

  it('LS-13 (SEC-V28-3): a deposit still PAID but refunded holds nothing, so its event writes no DEPOSIT_PAID', async () => {
    for (const payments of [[{ amount: 25, status: 'REFUNDED' }], [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -25, status: 'REFUNDED' }]]) {
      const f = fixture({ depositPayments: payments });
      const out = await f.listener.onInvoicePaid(paid('inv_dep') as any);
      expect(out).toMatchObject({ changed: false });
      expect(f.bookings[0].paymentStatus).toBe('UNPAID');
    }
    const partly = fixture({ depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -10, status: 'REFUNDED' }] });
    await partly.listener.onInvoicePaid(paid('inv_dep') as any);
    expect(partly.bookings[0].paymentStatus, 'part of it still held').toBe('DEPOSIT_PAID');
  });

  it('LS-14: depositPosition in cents: billed, held (less refunds, both conventions), covers (held when PAID, billed otherwise)', () => {
    const inv = (status: string, payments: Pay[] = [], creditNotes: Array<{ amount: unknown }> = [], total = 25) =>
      ({ id: 'd', invoiceNumber: 'N', status, total, currency: 'TTD', payments, creditNotes }) as any;
    const cases: Array<[string, any, { billedCents: number; heldCents: number; coversCents: number }]> = [
      ['unpaid (SENT)', inv('SENT'), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      ['PAID', inv('PAID', [{ amount: 25, status: 'SUCCESSFUL' }]), { billedCents: 2500, heldCents: 2500, coversCents: 2500 }],
      ['PAID, payment flipped to REFUNDED', inv('PAID', [{ amount: 25, status: 'REFUNDED' }]), { billedCents: 2500, heldCents: 0, coversCents: 0 }],
      ['PAID, negative refund row of 10', inv('PAID', [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -10, status: 'REFUNDED' }]), { billedCents: 2500, heldCents: 1500, coversCents: 1500 }],
      ['PARTIALLY_CREDITED by 10 (Decimal)', inv('PARTIALLY_CREDITED', [{ amount: 25, status: 'SUCCESSFUL' }], [{ amount: '10.0000' }]), { billedCents: 1500, heldCents: 0, coversCents: 1500 }],
      ['FULLY_CREDITED (status alone)', inv('FULLY_CREDITED', [{ amount: 25, status: 'SUCCESSFUL' }]), { billedCents: 0, heldCents: 0, coversCents: 0 }],
      ['PAID 33.00 of 99.99 (cents)', inv('PAID', [{ amount: 33, status: 'SUCCESSFUL' }], [], 33), { billedCents: 3300, heldCents: 3300, coversCents: 3300 }],
    ];
    for (const [label, deposit, expected] of cases) {
      expect(depositPosition(deposit), label).toEqual(expected);
    }
  });

  it('LS-15: derivePaymentStatus: PAID needs the final paid and no deposit owed; DEPOSIT_PAID needs money held', () => {
    const dep = (status: string, payments: Pay[] = []) => ({ id: 'd', invoiceNumber: 'N', status, total: 25, currency: 'TTD', payments, creditNotes: [] }) as any;
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: null })).toBe('PAID');
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: dep('PAID') })).toBe('PAID');
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: dep('PAID', [{ amount: 25, status: 'REFUNDED' }]) })).toBe('PAID');
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: dep('SENT') })).toBe('UNPAID');
    expect(derivePaymentStatus({ final: { status: 'SENT' }, deposit: dep('PAID') })).toBe('DEPOSIT_PAID');
    expect(derivePaymentStatus({ final: null, deposit: dep('PAID', [{ amount: 25, status: 'REFUNDED' }]) })).toBe('UNPAID');
    expect(derivePaymentStatus({ final: null, deposit: null })).toBe('UNPAID');
  });
});
