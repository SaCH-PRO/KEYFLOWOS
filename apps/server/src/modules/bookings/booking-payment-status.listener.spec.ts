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
 * Trial-N integration review (deposit), red at 42190801:
 *   LS-14  N4: a refund on a deposit that was never settled does not make it hold money
 *   LS-16  N1-CR: a paid deposit part-credited (D-28 PARTIALLY_CREDITED) is not owed: the paid final is PAID
 *   LS-17  N1-SEC: the settlement invoices are read with their own-tenant payment rows only (M31)
 *   LS-18  N2-CR/N3-SEC: invoice.reopened / invoice.payment_recorded (a D-14 refund moving an invoice)
 *          re-derive the booking from its invoices, backwards too; DEPOSIT_FORFEITED is never overwritten
 *
 * Trial-N repair round 2 (deposit recheck), red at f5bbd543:
 *   LS-19  RC-DEP-1: a deposit holds money only once paid in full, read from its rows in the order they were
 *          written since it last stood at nothing received (D-14 reopens a fully refunded one to SENT): refund
 *          and repayment churn never makes a part payment held
 *   LS-20  RC-DEP-3: both handlers lock the booking row before they read it, and read its invoices and write
 *          its status in that same transaction, so the compare-and-set covers what the status was derived from
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
  // Trial-N round 2 (RC-DEP-3): each call, and whether it ran inside $transaction.
  const log: string[] = [];
  let inTx = 0;
  const note = (op: string) => log.push(inTx > 0 ? `${op} (tx)` : op);
  const matchIn = (v: string, cond: any) => (cond?.in ? cond.in.includes(v) : cond === undefined || cond === v);
  const client: any = {
    // Interactive transaction over the same fake rows (the listener's booking row lock, RC-DEP-3).
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      inTx += 1;
      try {
        return await fn(client);
      } finally {
        inTx -= 1;
      }
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      note(`$queryRaw ${strings.join('?').replace(/\s+/g, ' ').trim()}`);
      return [];
    }),
    invoice: {
      findFirst: vi.fn(async ({ where }: any) => {
        note('invoice.findFirst');
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
        note('booking.findFirst');
        const row = bookings.find(
          (b) =>
            b.businessId === where.businessId &&
            b.deletedAt === null &&
            (where.OR as any[]).some((o) => (o.invoiceId && b.invoiceId === o.invoiceId) || (o.depositInvoiceId && b.depositInvoiceId === o.depositInvoiceId)),
        );
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        note('booking.updateMany');
        const row = bookings.find((b) => b.id === where.id && b.businessId === where.businessId && matchIn(b.paymentStatus, where.paymentStatus));
        if (!row) return { count: 0 };
        row.paymentStatus = data.paymentStatus;
        writes.push({ id: row.id, to: data.paymentStatus });
        return { count: 1 };
      }),
    },
  };
  return { prisma: { client } as any, client, writes, log };
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
      // 25 received, then 10 credited (D-28 PARTIALLY_CREDITED): the net received covers what it still bills, so it holds that (15).
      ['PARTIALLY_CREDITED by 10 (Decimal)', inv('PARTIALLY_CREDITED', [{ amount: 25, status: 'SUCCESSFUL' }], [{ amount: '10.0000' }]), { billedCents: 1500, heldCents: 1500, coversCents: 1500 }],
      // Credited by 10 with only 5 received: still owed, nothing refunded, so nothing held.
      ['PARTIALLY_CREDITED by 10, 5 received', inv('PARTIALLY_CREDITED', [{ amount: 5, status: 'SUCCESSFUL' }], [{ amount: '10.0000' }]), { billedCents: 1500, heldCents: 0, coversCents: 1500 }],
      // D-14 (V1-29): a partial refund moves the deposit to PARTIALLY_PAID; it still holds its net and is owed its remainder.
      ['PARTIALLY_PAID after a D-14 refund of 10', inv('PARTIALLY_PAID', [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -10, status: 'REFUNDED' }]), { billedCents: 2500, heldCents: 1500, coversCents: 2500 }],
      // D-14: a full refund reopens it to SENT: nothing held, still owed on its own invoice.
      ['SENT after a D-14 full refund', inv('SENT', [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -25, status: 'REFUNDED' }]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      // A legacy PAID deposit with no payment rows: the status is the only evidence.
      ['PAID with no payment rows (legacy)', inv('PAID'), { billedCents: 2500, heldCents: 2500, coversCents: 2500 }],
      // Review F2/REG-1: a legacy PAID deposit whose only rows are FAILED or PENDING, or short of the total, nothing refunded:
      // still all of it held, or the final, which netted it as paid, would bill the deposit's share again.
      ['PAID with a FAILED row only (legacy)', inv('PAID', [{ amount: 25, status: 'FAILED' }]), { billedCents: 2500, heldCents: 2500, coversCents: 2500 }],
      ['PAID with a PENDING row only (legacy)', inv('PAID', [{ amount: 25, status: 'PENDING' }]), { billedCents: 2500, heldCents: 2500, coversCents: 2500 }],
      ['PAID with rows short of the total (legacy)', inv('PAID', [{ amount: 10, status: 'SUCCESSFUL' }]), { billedCents: 2500, heldCents: 2500, coversCents: 2500 }],
      // A refund on a legacy short PAID deposit: what it holds is read from the rows.
      ['PAID, short rows then a refund of 5', inv('PAID', [{ amount: 10, status: 'SUCCESSFUL' }, { amount: -5, status: 'REFUNDED' }]), { billedCents: 2500, heldCents: 500, coversCents: 500 }],
      // Review F3/REG-2: a part payment on a deposit still owed, nothing refunded, holds nothing (the booking stays UNPAID).
      ['PARTIALLY_PAID 10 of 25, no refund', inv('PARTIALLY_PAID', [{ amount: 10, status: 'SUCCESSFUL' }]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      // Trial-N N4: a refund never raises what a deposit holds. 10 received on an owed 25, 5 of it refunded: it was never
      // settled (nothing received ever covered what it bills), so it holds nothing, as before the refund.
      ['PARTIALLY_PAID 10 of 25, then a refund of 5 (never settled)', inv('PARTIALLY_PAID', [{ amount: 10, status: 'SUCCESSFUL' }, { amount: -5, status: 'REFUNDED' }]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      ['SENT with a PENDING row', inv('SENT', [{ amount: 25, status: 'PENDING' }]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      ['FULLY_CREDITED (status alone)', inv('FULLY_CREDITED', [{ amount: 25, status: 'SUCCESSFUL' }]), { billedCents: 0, heldCents: 0, coversCents: 0 }],
      ['PAID 33.00 of 99.99 (cents)', inv('PAID', [{ amount: 33, status: 'SUCCESSFUL' }], [], 33), { billedCents: 3300, heldCents: 3300, coversCents: 3300 }],
    ];
    for (const [label, deposit, expected] of cases) {
      expect.soft(depositPosition(deposit), label).toEqual(expected);
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

  it('LS-16 (trial-N N1-CR): a deposit paid in full and then part-credited (D-28 PARTIALLY_CREDITED) is not owed: the paid final makes the booking PAID', () => {
    const credited = (payments: Pay[]) =>
      ({ id: 'd', invoiceNumber: 'N', status: 'PARTIALLY_CREDITED', total: 25, currency: 'TTD', payments, creditNotes: [{ amount: '10.0000' }] }) as any;
    // 25 received, 10 credited: it holds the 15 it still bills, nothing is left to collect on it.
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: credited([{ amount: 25, status: 'SUCCESSFUL' }]) })).toBe('PAID');
    expect(derivePaymentStatus({ final: { status: 'SENT' }, deposit: credited([{ amount: 25, status: 'SUCCESSFUL' }]) })).toBe('DEPOSIT_PAID');
    // CONTROL: credited by 10 with only 5 received: still owed its 10, so the paid final is not PAID.
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: credited([{ amount: 5, status: 'SUCCESSFUL' }]) })).toBe('UNPAID');
    // CONTROL: reopened by a D-14 refund of 10 (PARTIALLY_PAID, holds 15 of 25): owed its 10 again.
    const reopened = { id: 'd', invoiceNumber: 'N', status: 'PARTIALLY_PAID', total: 25, currency: 'TTD', creditNotes: [],
      payments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -10, status: 'REFUNDED' }] } as any;
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: reopened })).toBe('DEPOSIT_PAID');
  });

  it('LS-17 (trial-N N1-SEC): the settlement invoices are read with their own-tenant payment rows only (Payment has no FK to Business, M31)', async () => {
    const f = fixture({ finalStatus: 'PAID' });
    await f.listener.onInvoicePaid(paid('inv_final') as any);
    const reads = f.client.invoice.findFirst.mock.calls.map(([args]: any[]) => args).filter((args: any) => args.select?.payments);
    expect(reads.length, 'both settlement invoices read').toBe(2);
    for (const args of reads) {
      expect(args.where.businessId).toBe(A);
      expect(args.select.payments.where, `invoice ${args.where.id}`).toEqual({ businessId: A });
    }
  });

  describe('LS-18 (trial-N N2-CR/N3-SEC): a refund that moves an invoice (D-14) re-derives the booking from its invoices', () => {
    const moved = (invoiceId: string, businessId = A, invoiceBusinessId: string = businessId) => ({
      businessId,
      invoice: { id: invoiceId, businessId: invoiceBusinessId },
    });
    // At the trial-I head there is no refund handler: nothing re-derives the booking.
    const NOT_HANDLED = { changed: false };
    const refundHandler = (listener: any) => (listener.onInvoiceRefundMoved?.bind(listener) ?? (async () => NOT_HANDLED)) as (p: any) => Promise<any>;

    it('a full refund reopens the deposit to SENT: DEPOSIT_PAID -> UNPAID', async () => {
      const f = fixture({ depositStatus: 'SENT', paymentStatus: 'DEPOSIT_PAID', depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -25, status: 'REFUNDED' }] });
      const out = await refundHandler(f.listener)(moved('inv_dep'));
      expect(f.bookings[0].paymentStatus).toBe('UNPAID');
      expect(out).toMatchObject({ bookingId: 'bk_a', paymentStatus: 'UNPAID', changed: true });
    });

    it('the final refunded while the deposit is held: PAID -> DEPOSIT_PAID; a part refund of the deposit after PAID: PAID -> DEPOSIT_PAID', async () => {
      const f = fixture({ depositStatus: 'PAID', finalStatus: 'SENT', paymentStatus: 'PAID', depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }] });
      await refundHandler(f.listener)(moved('inv_final'));
      expect(f.bookings[0].paymentStatus).toBe('DEPOSIT_PAID');
      const g = fixture({ depositStatus: 'PARTIALLY_PAID', finalStatus: 'PAID', paymentStatus: 'PAID', depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -10, status: 'REFUNDED' }] });
      await refundHandler(g.listener)(moved('inv_dep'));
      expect(g.bookings[0].paymentStatus).toBe('DEPOSIT_PAID');
    });

    it('CONTROLS: a forfeited deposit (D-26) stays forfeited; nothing changed writes nothing; another tenant moves nothing; a failure is never thrown', async () => {
      const forfeited = fixture({ depositStatus: 'SENT', paymentStatus: 'DEPOSIT_FORFEITED', depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -25, status: 'REFUNDED' }] });
      await refundHandler(forfeited.listener)(moved('inv_dep'));
      expect(forfeited.bookings[0].paymentStatus).toBe('DEPOSIT_FORFEITED');
      const same = fixture({ depositStatus: 'PARTIALLY_PAID', paymentStatus: 'DEPOSIT_PAID', depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -10, status: 'REFUNDED' }] });
      expect(await refundHandler(same.listener)(moved('inv_dep'))).toMatchObject({ changed: false });
      const tenant = fixture({ depositStatus: 'SENT', paymentStatus: 'DEPOSIT_PAID' });
      expect(await refundHandler(tenant.listener)(moved('inv_dep', B))).toMatchObject({ changed: false });
      expect(await refundHandler(tenant.listener)(moved('inv_dep', A, B))).toMatchObject({ changed: false });
      expect(tenant.bookings[0].paymentStatus).toBe('DEPOSIT_PAID');
      expect([...forfeited.writes, ...same.writes, ...tenant.writes]).toEqual([]);
      const broken = fixture({ depositStatus: 'SENT', paymentStatus: 'DEPOSIT_PAID' });
      broken.client.booking.findFirst.mockRejectedValueOnce(new Error('db down'));
      await expect(refundHandler(broken.listener)(moved('inv_dep'))).resolves.toMatchObject({ changed: false });
    });

    it("it is wired: @OnEvent('invoice.reopened') and @OnEvent('invoice.payment_recorded') on the refund handler", () => {
      const handler = (BookingPaymentStatusListener.prototype as any).onInvoiceRefundMoved;
      expect(handler, 'BookingPaymentStatusListener.onInvoiceRefundMoved').toBeTypeOf('function');
      const events = (Reflect.getMetadata(EVENT_LISTENER_METADATA, handler) ?? []).map((m: any) => m.event);
      expect(events.sort()).toEqual(['invoice.payment_recorded', 'invoice.reopened']);
    });
  });

  it('LS-19 (trial-N round 2, RC-DEP-1): a deposit holds money only once paid in full since it last stood at nothing received; refund and repayment churn never makes a part payment held', () => {
    const inv = (status: string, payments: Pay[]) => ({ id: 'd', invoiceNumber: 'N', status, total: 25, currency: 'TTD', payments, creditNotes: [] }) as any;
    const S = (amount: number): Pay => ({ amount, status: 'SUCCESSFUL' });
    const R = (amount: number): Pay => ({ amount: -amount, status: 'REFUNDED' });
    const cases: Array<[string, any, { billedCents: number; heldCents: number; coversCents: number }]> = [
      // Probe R1: 20 of 25 received, refunded (SENT), 10 received (PARTIALLY_PAID). Gross 30 >= 25, yet never paid in full.
      ['20 received, refunded, 10 received (never paid in full)', inv('PARTIALLY_PAID', [S(20), R(20), S(10)]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      // Paid in full, refunded in full (D-14: SENT, paidAt cleared, owed afresh), then 10 received: a part payment on an owed deposit.
      ['paid in full, refunded in full, then 10 received', inv('PARTIALLY_PAID', [S(25), R(25), S(10)]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      ['10 received, refunded, 10 received', inv('PARTIALLY_PAID', [S(10), R(10), S(10)]), { billedCents: 2500, heldCents: 0, coversCents: 2500 }],
      // CONTROLS: paid in full and never reopened to nothing: it holds its net, whatever came after.
      ['paid in full in two, 10 refunded (S-07e)', inv('PARTIALLY_PAID', [S(15), S(10), R(10)]), { billedCents: 2500, heldCents: 1500, coversCents: 2500 }],
      ['paid in full in two, 24 refunded, 9 received', inv('PARTIALLY_PAID', [S(24), S(1), R(24), S(9)]), { billedCents: 2500, heldCents: 1000, coversCents: 2500 }],
      ['churn, then paid in full again (PAID), 5 refunded', inv('PARTIALLY_PAID', [S(20), R(20), S(25), R(5)]), { billedCents: 2500, heldCents: 2000, coversCents: 2500 }],
      ['churn, then paid in full again (PAID)', inv('PAID', [S(10), R(10), S(25)]), { billedCents: 2500, heldCents: 2500, coversCents: 2500 }],
    ];
    for (const [label, deposit, expected] of cases) {
      expect.soft(depositPosition(deposit), label).toEqual(expected);
    }
    // ...so the booking is not DEPOSIT_PAID on a deposit never paid in full, and a final paid beside it is not PAID.
    expect(derivePaymentStatus({ final: { status: 'SENT' }, deposit: inv('PARTIALLY_PAID', [S(20), R(20), S(10)]) })).toBe('UNPAID');
    expect(derivePaymentStatus({ final: { status: 'PAID' }, deposit: inv('PARTIALLY_PAID', [S(25), R(25), S(10)]) })).toBe('UNPAID');
    expect(derivePaymentStatus({ final: { status: 'SENT' }, deposit: inv('PARTIALLY_PAID', [S(15), S(10), R(10)]) })).toBe('DEPOSIT_PAID');
  });

  it('LS-19b (RC-DEP-1): the settlement select reads the payment rows in the order they were written', async () => {
    const f = fixture({ finalStatus: 'PAID' });
    await f.listener.onInvoicePaid(paid('inv_final') as any);
    const reads = f.client.invoice.findFirst.mock.calls.map(([args]: any[]) => args).filter((args: any) => args.select?.payments);
    expect(reads.length).toBe(2);
    for (const args of reads) {
      expect(args.select.payments.orderBy, `invoice ${args.where.id}`).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    }
  });

  describe('LS-20 (trial-N round 2, RC-DEP-3): the compare-and-set covers what the status was derived from', () => {
    const lockOf = (log: string[]) => log.findIndex((l) => /^\$queryRaw SELECT id FROM bookings .*FOR NO KEY UPDATE \(tx\)$/.test(l));

    it('invoice.paid: the booking row is locked before it is read; its invoices are read and its status written in the same transaction', async () => {
      const f = fixture();
      const out = await f.listener.onInvoicePaid(paid('inv_dep') as any);
      expect(out).toMatchObject({ bookingId: 'bk_a', paymentStatus: 'DEPOSIT_PAID', changed: true });
      expect(f.client.$transaction).toHaveBeenCalledTimes(1);
      const lock = lockOf(f.log);
      expect(lock, f.log.join(' | ')).toBeGreaterThanOrEqual(0);
      const after = f.log.slice(lock + 1);
      expect(after, 'after the lock: the booking, its two invoices, the write, all in the transaction').toEqual([
        'booking.findFirst (tx)',
        'invoice.findFirst (tx)',
        'invoice.findFirst (tx)',
        'booking.updateMany (tx)',
      ]);
      expect(f.log.slice(0, lock).some((l) => l.startsWith('booking.')), 'nothing of the booking is read before the lock').toBe(false);
      // The lock names the booking by the event's business and invoice.
      const [strings, ...values] = f.client.$queryRaw.mock.calls[0];
      expect(strings.join('?')).toMatch(/business_id = \?.*deleted_at IS NULL.*invoice_id = \?.*deposit_invoice_id = \?/s);
      expect(values).toEqual([A, 'inv_dep', 'inv_dep']);
    });

    it('a refund that moves an invoice: the same lock, reads and write in one transaction', async () => {
      const f = fixture({ depositStatus: 'SENT', paymentStatus: 'DEPOSIT_PAID', depositPayments: [{ amount: 25, status: 'SUCCESSFUL' }, { amount: -25, status: 'REFUNDED' }] });
      const out = await f.listener.onInvoiceRefundMoved({ businessId: A, invoice: { id: 'inv_dep', businessId: A } } as any);
      expect(out).toMatchObject({ bookingId: 'bk_a', paymentStatus: 'UNPAID', changed: true });
      expect(f.client.$transaction).toHaveBeenCalledTimes(1);
      const lock = lockOf(f.log);
      expect(lock, f.log.join(' | ')).toBeGreaterThanOrEqual(0);
      expect(f.log.slice(lock + 1)).toEqual(['booking.findFirst (tx)', 'invoice.findFirst (tx)', 'invoice.findFirst (tx)', 'booking.updateMany (tx)']);
      expect(f.log.slice(0, lock).some((l) => l.startsWith('booking.'))).toBe(false);
    });

    it('CONTROLS: a payload of another tenant, or naming another business, takes no lock; a failure inside the transaction is logged, never thrown', async () => {
      const f = fixture();
      await f.listener.onInvoicePaid(paid('inv_dep', B) as any);
      await f.listener.onInvoicePaid(paid('inv_dep', A, B) as any);
      await f.listener.onInvoiceRefundMoved({ businessId: B, invoice: { id: 'inv_dep', businessId: B } } as any);
      expect(f.client.$queryRaw).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
      const g = fixture();
      g.client.booking.findFirst.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(g.listener.onInvoicePaid(paid('inv_dep') as any)).resolves.toMatchObject({ changed: false });
      expect(g.writes).toEqual([]);
    });
  });
});
