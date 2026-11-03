import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  InvoiceWorkflowService,
  balanceOfStoredRows,
  computeBalance,
  deriveStatusAfterCredit,
  deriveStatusAfterPayment,
  isLegalCreditTransition,
  isLegalReconcileTransition,
  isLegalTransition,
  readStoredPayments,
  roundMoney,
  type InvoiceStatus,
} from './invoice-workflow.service';

describe('roundMoney', () => {
  it('rounds to 2 decimals (TTD/USD)', () => {
    expect(roundMoney(1.234)).toBe(1.23);
    expect(roundMoney(1.236)).toBe(1.24);
    expect(roundMoney(1.004)).toBe(1.0);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(99.999)).toBe(100);
  });
});

describe('computeBalance', () => {
  it('zero-amount invoice with no payments', () => {
    const b = computeBalance(0, []);
    expect(b).toMatchObject({ total: 0, paid: 0, remaining: 0, isFullyPaid: false });
  });

  it('single full payment', () => {
    const b = computeBalance(100, [{ amount: 100, status: 'SUCCESSFUL' }]);
    expect(b.isFullyPaid).toBe(true);
    expect(b.remaining).toBe(0);
    expect(b.net).toBe(100);
  });

  it('multiple partials sum and clamp at zero remaining once covered', () => {
    const b = computeBalance(100, [
      { amount: 30, status: 'SUCCESSFUL' },
      { amount: 70, status: 'SUCCESSFUL' },
    ]);
    expect(b.paid).toBe(100);
    expect(b.isFullyPaid).toBe(true);
    expect(b.remaining).toBe(0);
  });

  it('partial only — remaining > 0 and not fully paid', () => {
    const b = computeBalance(100, [{ amount: 40, status: 'SUCCESSFUL' }]);
    expect(b.isFullyPaid).toBe(false);
    expect(b.remaining).toBe(60);
    expect(b.net).toBe(40);
  });

  it('over-payment is flagged but remaining stays at zero', () => {
    const b = computeBalance(100, [{ amount: 150, status: 'SUCCESSFUL' }]);
    expect(b.isOverpaid).toBe(true);
    expect(b.isFullyPaid).toBe(true);
    expect(b.remaining).toBe(0);
  });

  it('refund subtracts from net (regardless of stored sign)', () => {
    const b = computeBalance(100, [
      { amount: 100, status: 'SUCCESSFUL' },
      { amount: -40, status: 'REFUNDED' },
    ]);
    expect(b.paid).toBe(100);
    expect(b.refunded).toBe(40);
    expect(b.net).toBe(60);
    expect(b.isFullyPaid).toBe(false);
    expect(b.remaining).toBe(40);
  });

  it('refund on positive-stored amount also handled', () => {
    const b = computeBalance(100, [
      { amount: 100, status: 'SUCCESSFUL' },
      { amount: 40, status: 'REFUNDED' },
    ]);
    expect(b.refunded).toBe(40);
    expect(b.net).toBe(60);
  });

  it('PENDING/FAILED rows are ignored', () => {
    const b = computeBalance(100, [
      { amount: 50, status: 'SUCCESSFUL' },
      { amount: 999, status: 'PENDING' },
      { amount: 999, status: 'FAILED' },
    ]);
    expect(b.paid).toBe(50);
    expect(b.remaining).toBe(50);
  });

  it('handles currency rounding without float drift (TTD)', () => {
    const b = computeBalance(0.1 + 0.2, [{ amount: 0.3, status: 'SUCCESSFUL' }], 'TTD');
    expect(b.isFullyPaid).toBe(true);
    expect(b.total).toBe(0.3);
    expect(b.remaining).toBe(0);
  });

  it('handles three-way partial sum to total (USD)', () => {
    const b = computeBalance(99.99, [
      { amount: 33.33, status: 'SUCCESSFUL' },
      { amount: 33.33, status: 'SUCCESSFUL' },
      { amount: 33.33, status: 'SUCCESSFUL' },
    ], 'USD');
    expect(b.isFullyPaid).toBe(true);
  });
});

/**
 * V1-22-DM-MONEY-CENTS (M23, CF-54; D-13): the PAID / overpaid decisions are
 * integer-cent comparisons. At the base they compared floats with a +/-0.005
 * tolerance after a float `Math.round(x * 100) / 100`, which reads a half cent
 * below the half (1.005 -> 1.00): a legacy total of 1.005 paid with 1.01 was
 * flagged overpaid. Each balance figure is the exact decimal sum of the rows
 * rounded once to cents; legacy sub-cent rows keep the status the old sum gave.
 */
describe('V1-22 computeBalance in integer cents', () => {
  const ok = (amount: number) => ({ amount, status: 'SUCCESSFUL' });

  it('three payments of 33.33 plus one of 0.01 on 100.00: PAID, remaining 0, not overpaid', () => {
    const b = computeBalance(100, [ok(33.33), ok(33.33), ok(33.33), ok(0.01)], 'TTD');
    expect(b).toEqual({ total: 100, paid: 100, refunded: 0, net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', b)).toBe('PAID');
  });

  it('the same rows in another order give the same balance (no float order dependence)', () => {
    const b = computeBalance(100, [ok(0.01), ok(33.33), ok(33.33), ok(33.33)], 'USD');
    expect(b).toMatchObject({ paid: 100, net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
  });

  it('three payments of 33.33 on 100.00 leave exactly 0.01, PARTIALLY_PAID', () => {
    const b = computeBalance(100, [ok(33.33), ok(33.33), ok(33.33)]);
    expect(b).toMatchObject({ paid: 99.99, net: 99.99, remaining: 0.01, isFullyPaid: false, isOverpaid: false });
    expect(deriveStatusAfterPayment('SENT', b)).toBe('PARTIALLY_PAID');
  });

  it('one cent short is not paid; one cent over is overpaid; exact is neither short nor over', () => {
    expect(computeBalance(100, [ok(99.99)])).toMatchObject({ isFullyPaid: false, isOverpaid: false, remaining: 0.01 });
    expect(computeBalance(100, [ok(100.01)])).toMatchObject({ isFullyPaid: true, isOverpaid: true, remaining: 0 });
    expect(computeBalance(100, [ok(100)])).toMatchObject({ isFullyPaid: true, isOverpaid: false, remaining: 0 });
  });

  it('RED-BEFORE: a legacy total of 1.005 is 1.01 in cents, so a payment of 1.01 settles it and is not an overpayment', () => {
    const b = computeBalance(1.005, [ok(1.01)]);
    expect(b).toMatchObject({ total: 1.01, net: 1.01, remaining: 0, isFullyPaid: true, isOverpaid: false });
  });

  it('a legacy total of 1.015 (7 x 0.145) reads 1.02 in cents, as a new write stores it; 1.01, what the base settled it with, still settles it (CR-V22-1)', () => {
    // The float 1.015 is 1.01499999999999990...: Math.round(1.015 * 100) / 100 read it as 1.01 and settled it with 1.01.
    const b = computeBalance(1.015, [ok(1.01)]);
    expect(b).toMatchObject({ total: 1.02, paid: 1.01, remaining: 0, isFullyPaid: true, isOverpaid: false });
    expect(deriveStatusAfterPayment('PAID', b)).toBe('PAID');
    // 1.00 settles neither reading.
    expect(computeBalance(1.015, [ok(1)])).toMatchObject({ total: 1.02, remaining: 0.02, isFullyPaid: false });
  });

  it('a legacy unrounded total (0.1 + 0.2 at 12.5% stored as 0.3375) paid with 0.34 stays PAID, not overpaid', () => {
    const b = computeBalance(0.30000000000000004 + 0.037500000000000006, [ok(0.34)]);
    expect(b).toMatchObject({ total: 0.34, net: 0.34, remaining: 0, isFullyPaid: true, isOverpaid: false });
  });

  it('a thousand payments of 0.10 settle 100.00 exactly', () => {
    const b = computeBalance(100, Array.from({ length: 1000 }, () => ok(0.1)));
    expect(b).toMatchObject({ paid: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
  });

  it('legacy sub-cent rows are summed exactly and rounded once (0.004 + 0.004 settles 0.01, as before)', () => {
    const b = computeBalance(0.01, [ok(0.004), ok(0.004)]);
    expect(b).toMatchObject({ paid: 0.01, isFullyPaid: true, isOverpaid: false });
  });

  it('refunds are summed in cents too, whatever their stored sign', () => {
    const b = computeBalance(100, [ok(33.33), ok(33.33), ok(33.34), { amount: -0.1, status: 'REFUNDED' }, { amount: 0.2, status: 'REFUNDED' }]);
    expect(b).toMatchObject({ paid: 100, refunded: 0.3, net: 99.7, remaining: 0.3, isFullyPaid: false });
  });

  it('every figure is a canonical cent value (what the Float columns store)', () => {
    const b = computeBalance(0.3375, [ok(0.1), ok(0.2)]);
    for (const v of [b.total, b.paid, b.refunded, b.net, b.remaining]) {
      expect(Math.round(v * 100) / 100).toBe(v);
    }
    expect(b.remaining).toBe(0.04);
  });

  it('RED-BEFORE: roundMoney (re-exported for its callers) rounds a half cent by decimal value, symmetrically', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(2.675, 'USD')).toBe(2.68);
  });
});

/**
 * V1-22 review (CR-V22-1): a stored PAID invoice stays PAID. A legacy total
 * that is not a whole cent has two cent readings (money.ts readTotalCents):
 * its decimal half away from zero, which is shown, and the base's
 * Math.round(total * 100), which every pre-V1-22 payment, mark-paid amount and
 * status was computed against. Either settles it; only above both overpays.
 */
describe('V1-22 review CR-V22-1: legacy sub-cent totals keep the statuses the base gave them', () => {
  const ok = (amount: number) => ({ amount, status: 'SUCCESSFUL' });
  /** The base computeBalance (f5c93ba0), verbatim, as the oracle for what a stored row's status was. */
  const baseRound = (x: number) => Math.round(x * 100) / 100;
  const baseBalance = (total: number, paidRows: number[]) => {
    const net = baseRound(paidRows.reduce((s, a) => s + a, 0));
    const t = baseRound(total);
    return {
      isFullyPaid: net + 0.005 >= t && t > 0,
      isOverpaid: net - 0.005 > t,
      remaining: Math.max(0, baseRound(t - net)),
    };
  };

  it('RED-BEFORE (HEAD be6195d6): 8.36 + 12.5% stored as 9.405, paid 9.40 by the base mark-paid: PAID, nothing remaining, a reconcile keeps PAID', () => {
    const total = 8.36 + (8.36 * 12.5) / 100;
    expect(total).toBe(9.405);
    const b = computeBalance(total, [ok(9.4)]);
    expect(b).toEqual({ total: 9.41, paid: 9.4, refunded: 0, net: 9.4, remaining: 0, isFullyPaid: true, isOverpaid: false });
    expect(deriveStatusAfterPayment('PAID', b)).toBe('PAID');
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', b)).toBe('PAID');
  });

  it('the same 9.405: 9.41 (the decimal reading, what mark-paid records now) settles it too and is not an overpayment; 9.42 is', () => {
    expect(computeBalance(9.405, [ok(9.41)])).toMatchObject({ remaining: 0, isFullyPaid: true, isOverpaid: false });
    expect(computeBalance(9.405, [ok(9.42)])).toMatchObject({ remaining: 0, isFullyPaid: true, isOverpaid: true });
  });

  it('the same 9.405 short of both readings stays PARTIALLY_PAID with total - net remaining', () => {
    const b = computeBalance(9.405, [ok(9.39)]);
    expect(b).toMatchObject({ total: 9.41, net: 9.39, remaining: 0.02, isFullyPaid: false, isOverpaid: false });
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', b)).toBe('PARTIALLY_PAID');
  });

  it('the pure rule the other way: a total of 0.40499999999999997 (decimal 0.40, base 0.41) paid 0.41 is PAID and not overpaid', () => {
    // Not a stored row: Prisma writes a model float with 15 significant digits and reads this back as 0.405
    // (both readings 0.41). computeBalance is pure, so the band holds whichever reading is the higher.
    const total = 0.36 + (0.36 * 12.5) / 100;
    expect(total).toBe(0.40499999999999997);
    const b = computeBalance(total, [ok(0.41)]);
    expect(b).toMatchObject({ total: 0.4, paid: 0.41, remaining: 0, isFullyPaid: true, isOverpaid: false });
  });

  it('the band is the two readings, never wider: a legacy 0.3375 reads 0.34 both ways, so 0.33 does not settle it (PARTIALLY_PAID stays)', () => {
    const total = 0.1 + 0.2 + ((0.1 + 0.2) * 12.5) / 100;
    const b = computeBalance(total, [ok(0.33)]);
    expect(b).toMatchObject({ total: 0.34, remaining: 0.01, isFullyPaid: false, isOverpaid: false });
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', b)).toBe('PARTIALLY_PAID');
    expect(computeBalance(total, [ok(0.35)])).toMatchObject({ isOverpaid: true });
  });

  it('a whole-cent total has one reading: 100.00 is not settled by 99.99 and is overpaid by 100.01', () => {
    expect(computeBalance(100, [ok(99.99)])).toMatchObject({ remaining: 0.01, isFullyPaid: false });
    expect(computeBalance(100, [ok(100.01)])).toMatchObject({ isOverpaid: true });
    expect(computeBalance(0, [])).toMatchObject({ isFullyPaid: false, remaining: 0 });
    expect(computeBalance(0, [ok(1)])).toMatchObject({ isFullyPaid: false, isOverpaid: true });
  });

  it('property: over every legacy taxed total 0.01..250.00 at 5 rates, a row the base settled is settled, not overpaid, nothing remaining', () => {
    const divergent: string[] = [];
    let readingsDiffer = 0;
    for (const rate of [12.5, 10, 7, 8.25, 15]) {
      for (let s = 1; s <= 25_000; s++) {
        const subtotal = s / 100;
        const total = subtotal + (subtotal * rate) / 100;
        const paidRows = [baseRound(total)]; // what the base mark-paid recorded
        const before = baseBalance(total, paidRows);
        const after = computeBalance(total, paidRows.map(ok));
        if (!before.isFullyPaid) continue;
        if (toCentsRound(total) !== Math.round(total * 100)) readingsDiffer += 1;
        if (after.isFullyPaid !== true || after.isOverpaid !== false || after.remaining !== 0) {
          divergent.push(`${subtotal}@${rate}: ${JSON.stringify(after)}`);
        }
      }
    }
    // The scan reaches the rows CR-V22-1 is about (the two readings differ on a few hundred of them).
    expect(readingsDiffer).toBeGreaterThan(100);
    expect(divergent.slice(0, 5)).toEqual([]);
  });

  it('property: over the same totals, a status the base did not settle at one cent below both readings is not settled now either', () => {
    const flipped: string[] = [];
    for (const rate of [12.5, 10, 7, 8.25, 15]) {
      for (let s = 1; s <= 25_000; s++) {
        const subtotal = s / 100;
        const total = subtotal + (subtotal * rate) / 100;
        const low = Math.min(toCentsRound(total), Math.round(total * 100)) - 1;
        if (low <= 0) continue;
        const paidRows = [low / 100];
        const before = baseBalance(total, paidRows);
        const after = computeBalance(total, paidRows.map(ok));
        if (before.isFullyPaid !== after.isFullyPaid) flipped.push(`${subtotal}@${rate}`);
      }
    }
    expect(flipped.slice(0, 5)).toEqual([]);
  });
});

/** The decimal reading of a number in cents, half away from zero (money.ts toCents), via roundMoney. */
function toCentsRound(x: number): number {
  return Math.round(roundMoney(x) * 100);
}

describe('deriveStatusAfterPayment', () => {
  it('keeps VOID locked', () => {
    expect(deriveStatusAfterPayment('VOID', computeBalance(100, [{ amount: 100, status: 'SUCCESSFUL' }]))).toBe('VOID');
  });
  it('SENT -> PAID on full payment', () => {
    expect(deriveStatusAfterPayment('SENT', computeBalance(100, [{ amount: 100, status: 'SUCCESSFUL' }]))).toBe('PAID');
  });
  it('SENT -> PARTIALLY_PAID on partial', () => {
    expect(deriveStatusAfterPayment('SENT', computeBalance(100, [{ amount: 30, status: 'SUCCESSFUL' }]))).toBe('PARTIALLY_PAID');
  });
  it('OVERDUE -> PAID on full payment', () => {
    expect(deriveStatusAfterPayment('OVERDUE', computeBalance(100, [{ amount: 100, status: 'SUCCESSFUL' }]))).toBe('PAID');
  });
  it('PARTIALLY_PAID stays PARTIALLY_PAID until net == total', () => {
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', computeBalance(100, [{ amount: 50, status: 'SUCCESSFUL' }]))).toBe('PARTIALLY_PAID');
  });
});

describe('isLegalTransition', () => {
  it('allows DRAFT -> SENT', () => expect(isLegalTransition('DRAFT', 'SENT')).toBe(true));
  it('allows SENT -> PARTIALLY_PAID', () => expect(isLegalTransition('SENT', 'PARTIALLY_PAID')).toBe(true));
  it('allows SENT -> PAID', () => expect(isLegalTransition('SENT', 'PAID')).toBe(true));
  it('allows SENT -> OVERDUE', () => expect(isLegalTransition('SENT', 'OVERDUE')).toBe(true));
  it('allows OVERDUE -> PAID', () => expect(isLegalTransition('OVERDUE', 'PAID')).toBe(true));
  it('allows PARTIALLY_PAID -> PAID', () => expect(isLegalTransition('PARTIALLY_PAID', 'PAID')).toBe(true));
  it('forbids PAID -> SENT', () => expect(isLegalTransition('PAID', 'SENT')).toBe(false));
  it('forbids PAID -> VOID', () => expect(isLegalTransition('PAID', 'VOID')).toBe(false));
  it('forbids VOID -> anything', () => {
    expect(isLegalTransition('VOID', 'SENT')).toBe(false);
    expect(isLegalTransition('VOID', 'PAID')).toBe(false);
  });
  it('forbids DRAFT -> PAID directly (must go through SENT)', () => {
    expect(isLegalTransition('DRAFT', 'PAID')).toBe(false);
  });
  it('forbids PARTIALLY_PAID -> VOID', () => {
    expect(isLegalTransition('PARTIALLY_PAID', 'VOID')).toBe(false);
  });
});

/**
 * R0-PL-03-PAYMENT-ATOMIC-RECONCILE: reconcileFromPayments accepts the same
 * `tx` / `eventBuffer` options as `transition`, so recordPayment and the
 * refund can reconcile inside their own $transaction and emit the invoice
 * events only after it commits. Fakes only: the real-database proof is
 * test/payments-manual.integration.test.ts.
 */
describe('InvoiceWorkflowService.reconcileFromPayments with tx / eventBuffer (R0-PL-03)', () => {
  type Inv = {
    id: string;
    status: string;
    total: number;
    currency: string;
    businessId: string;
    paidAt: Date | null;
    payments: Array<{ amount: number; status: string }>;
  };

  function fakeDb(invoice: Inv, label: string) {
    const calls: string[] = [];
    const db = {
      // V1-42c review (SEC-V42C-1): the invoice row lock the no-tx path takes.
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        calls.push(`${label}.$queryRaw ${strings.join('?').replace(/\s+/g, ' ').trim()}`);
        return [{ id: invoice.id }];
      }),
      invoice: {
        findUnique: vi.fn(async () => {
          calls.push(`${label}.invoice.findUnique`);
          return invoice;
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          calls.push(`${label}.invoice.update`);
          return { ...invoice, ...data, items: [], contact: null, booking: null };
        }),
      },
      invoiceItem: {
        findMany: vi.fn(async () => {
          calls.push(`${label}.invoiceItem.findMany`);
          return [{ productId: 'prod_1', quantity: 2 }];
        }),
      },
    };
    return { db, calls };
  }

  function build(invoice: Inv) {
    const client = fakeDb(invoice, 'client');
    const tx = fakeDb(invoice, 'tx');
    const $transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(client.db));
    const prisma = { client: { ...client.db, $transaction } };
    const events = { emit: vi.fn() };
    const revenuePosting = {};
    const expensePosting = { onProductSold: vi.fn(async () => null) };
    const service = new InvoiceWorkflowService(
      prisma as never,
      events as never,
      revenuePosting as never,
      expensePosting as never,
    );
    return { service, client, tx, $transaction, events, expensePosting };
  }

  const sent = (payments: Inv['payments']): Inv => ({
    id: 'inv_1',
    status: 'SENT',
    total: 100,
    currency: 'TTD',
    businessId: 'biz_1',
    paidAt: null,
    payments,
  });

  it('with tx + eventBuffer: reads and writes through tx only, opens no transaction of its own, buffers invoice.payment_recorded instead of emitting', async () => {
    const h = build(sent([{ amount: 40, status: 'SUCCESSFUL' }]));
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: buffer });

    expect(result).toMatchObject({ status: 'PARTIALLY_PAID', changed: true });
    expect(h.tx.calls).toEqual(['tx.invoice.findUnique', 'tx.invoice.update']);
    expect(h.client.calls).toEqual([]);
    expect(h.$transaction).not.toHaveBeenCalled();
    expect(h.events.emit).not.toHaveBeenCalled();
    expect(buffer.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
  });

  it('with tx + eventBuffer reaching PAID: COGS posts through the same tx, invoice.paid is buffered, nothing emitted', async () => {
    const h = build(sent([{ amount: 100, status: 'SUCCESSFUL' }]));
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: buffer });

    expect(result).toMatchObject({ status: 'PAID', changed: true });
    expect(h.tx.calls).toEqual(['tx.invoice.findUnique', 'tx.invoice.update', 'tx.invoiceItem.findMany']);
    expect(h.client.calls).toEqual([]);
    expect(h.expensePosting.onProductSold).toHaveBeenCalledTimes(1);
    expect((h.expensePosting.onProductSold.mock.calls[0] as unknown[])[1]).toBe(h.tx.db);
    expect(h.events.emit).not.toHaveBeenCalled();
    expect(buffer.map((e) => e.name)).toEqual(['invoice.paid']);
  });

  it('with tx: an illegal transition (DRAFT with a payment) throws 409 before any write, and buffers nothing', async () => {
    const h = build({ ...sent([{ amount: 40, status: 'SUCCESSFUL' }]), status: 'DRAFT' });
    const buffer: Array<{ name: string; payload: unknown }> = [];
    await expect(
      h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: buffer }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.db.invoice.update).not.toHaveBeenCalled();
    expect(buffer).toEqual([]);
  });

  it('with tx but no eventBuffer: writes through tx and emits directly (same rule as transition)', async () => {
    const h = build(sent([{ amount: 40, status: 'SUCCESSFUL' }]));
    await h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never });
    expect(h.client.calls).toEqual([]);
    expect(h.$transaction).not.toHaveBeenCalled();
    expect(h.events.emit).toHaveBeenCalledTimes(1);
    expect(h.events.emit.mock.calls[0][0]).toBe('invoice.payment_recorded');
  });

  it('no status change: writes nothing, buffers nothing', async () => {
    const h = build({ ...sent([{ amount: 40, status: 'SUCCESSFUL' }]), status: 'PARTIALLY_PAID' });
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: buffer });
    expect(result).toMatchObject({ status: 'PARTIALLY_PAID', changed: false });
    expect(h.tx.db.invoice.update).not.toHaveBeenCalled();
    expect(buffer).toEqual([]);
    expect(h.events.emit).not.toHaveBeenCalled();
  });

  // R0-PL-03 review (ST-PL03-3 / CR-1): the refund path asks the reconcile to
  // keep a status it cannot legally move (DRAFT, or a credit-note status the
  // transition map does not know) instead of refusing the refund.
  for (const status of ['DRAFT', 'PARTIALLY_CREDITED', 'FULLY_CREDITED', 'PARTIAL']) {
    it(`onIllegalTransition 'keep' on ${status} with a net balance: status kept, changed false, no write, nothing buffered or emitted`, async () => {
      const h = build({ ...sent([{ amount: 40, status: 'SUCCESSFUL' }]), status });
      const buffer: Array<{ name: string; payload: unknown }> = [];
      const result = await h.service.reconcileFromPayments('inv_1', {
        tx: h.tx.db as never,
        eventBuffer: buffer,
        onIllegalTransition: 'keep',
      });
      expect(result).toMatchObject({ status, changed: false, balance: { net: 40 } });
      expect(h.tx.db.invoice.update).not.toHaveBeenCalled();
      expect(h.client.calls).toEqual([]);
      expect(buffer).toEqual([]);
      expect(h.events.emit).not.toHaveBeenCalled();
    });
  }

  it("default (payments): an out-of-map status (PARTIALLY_CREDITED) with a payment still throws 409 and writes nothing", async () => {
    const h = build({ ...sent([{ amount: 40, status: 'SUCCESSFUL' }]), status: 'PARTIALLY_CREDITED' });
    await expect(
      h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.db.invoice.update).not.toHaveBeenCalled();
  });

  it("onIllegalTransition 'keep' does not suppress a legal transition (PAID -> PARTIALLY_PAID on a refund)", async () => {
    const h = build({ ...sent([{ amount: 40, status: 'SUCCESSFUL' }]), status: 'PAID' });
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', {
      tx: h.tx.db as never,
      eventBuffer: buffer,
      onIllegalTransition: 'keep',
    });
    expect(result).toMatchObject({ status: 'PARTIALLY_PAID', changed: true });
    expect(h.tx.db.invoice.update).toHaveBeenCalledTimes(1);
    expect(buffer.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
  });

  it('without options (webhook callers): its own $transaction and an immediate emit; it reads and writes under the invoice row lock (V1-42c SEC-V42C-1)', async () => {
    const h = build(sent([{ amount: 100, status: 'SUCCESSFUL' }]));
    const result = await h.service.reconcileFromPayments('inv_1');
    expect(result).toMatchObject({ status: 'PAID', changed: true });
    expect(h.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.calls).toEqual([]);
    expect(h.client.calls).toEqual([
      'client.$queryRaw SELECT id FROM invoices WHERE id = ? FOR NO KEY UPDATE',
      'client.invoice.findUnique',
      'client.invoice.update',
      'client.invoiceItem.findMany',
    ]);
    expect(h.events.emit).toHaveBeenCalledTimes(1);
    expect(h.events.emit.mock.calls[0][0]).toBe('invoice.paid');
  });

  // V1-42c review (SEC-V42C-1): the status write is compare-and-set on the
  // status read, as transition() is since V1-42.
  it('SEC-V42C-1: the status write is compare-and-set on the status it read (where { id, status })', async () => {
    const h = build(sent([{ amount: 40, status: 'SUCCESSFUL' }]));
    await h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: [] });
    expect((h.tx.db.invoice.update.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ id: 'inv_1', status: 'SENT' });
  });

  it('SEC-V42C-1: a status moved by another writer between the read and the write (P2025) -> changed: false, the status now held, no posting, nothing buffered or emitted', async () => {
    const h = build({ ...sent([{ amount: 100, status: 'SUCCESSFUL' }]), status: 'PARTIALLY_PAID' });
    h.tx.db.invoice.update.mockRejectedValueOnce(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));
    h.tx.db.invoice.findUnique
      .mockImplementationOnce(async () => ({ ...sent([{ amount: 100, status: 'SUCCESSFUL' }]), status: 'PARTIALLY_PAID' }))
      .mockImplementationOnce(async () => ({ ...sent([]), status: 'PAID' }));
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: buffer });
    expect(result).toMatchObject({ status: 'PAID', changed: false });
    expect(h.expensePosting.onProductSold).not.toHaveBeenCalled();
    expect(h.tx.calls).not.toContain('tx.invoiceItem.findMany');
    expect(buffer).toEqual([]);
    expect(h.events.emit).not.toHaveBeenCalled();
  });

  it('SEC-V42C-1: without options, a lost compare-and-set emits nothing after the commit', async () => {
    const h = build(sent([{ amount: 100, status: 'SUCCESSFUL' }]));
    h.client.db.invoice.update.mockRejectedValueOnce(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));
    const result = await h.service.reconcileFromPayments('inv_1');
    expect(result).toMatchObject({ changed: false });
    expect(h.events.emit).not.toHaveBeenCalled();
  });

  it('SEC-V42C-1: any other write error is not swallowed', async () => {
    const h = build(sent([{ amount: 100, status: 'SUCCESSFUL' }]));
    h.tx.db.invoice.update.mockRejectedValueOnce(Object.assign(new Error('deadlock'), { code: 'P2034' }));
    const buffer: Array<{ name: string; payload: unknown }> = [];
    await expect(h.service.reconcileFromPayments('inv_1', { tx: h.tx.db as never, eventBuffer: buffer })).rejects.toThrow('deadlock');
    expect(buffer).toEqual([]);
  });
});

/**
 * V1-29-DM-REFUND-CONVENTION (M28, D-14): a manual refund is a separate
 * negative REFUNDED row beside the SUCCESSFUL original (the provider
 * convention), so computeBalance counts it once. A fully refunded invoice
 * returns to SENT with paidAt cleared (no REFUNDED invoice state, no enum
 * migration); a partial refund of a PAID invoice reopens it to
 * PARTIALLY_PAID, also with paidAt cleared. Only the payment rows (the
 * reconcile) may move an invoice out of PAID: the generic transition map
 * still forbids PAID -> SENT for transition() callers. The real-database
 * proof is test/commerce-refund.integration.test.ts.
 */
describe('V1-29 refund convention (D-14)', () => {
  const ok = (amount: number) => ({ amount, status: 'SUCCESSFUL' });
  const refunded = (amount: number) => ({ amount: -Math.abs(amount), status: 'REFUNDED' });

  it('computeBalance counts a separate refund row once: 100 paid, -100 refunded -> paid 100, refunded 100, net 0, remaining 100', () => {
    expect(computeBalance(100, [ok(100), refunded(100)])).toMatchObject({
      paid: 100, refunded: 100, net: 0, remaining: 100, isFullyPaid: false, isOverpaid: false,
    });
  });

  it('RED-BEFORE: a fully refunded PAID invoice derives SENT (the base kept PAID: it reopened only on a positive net)', () => {
    expect(deriveStatusAfterPayment('PAID', computeBalance(100, [ok(100), refunded(100)]))).toBe('SENT');
  });

  it('RED-BEFORE: a fully refunded PARTIALLY_PAID invoice derives SENT', () => {
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', computeBalance(100, [ok(40), refunded(40)]))).toBe('SENT');
  });

  it('a partial refund of a PAID invoice derives PARTIALLY_PAID (60 + 40 paid, 40 refunded: remaining 40)', () => {
    const b = computeBalance(100, [ok(60), ok(40), refunded(40)]);
    expect(b).toMatchObject({ net: 60, remaining: 40 });
    expect(deriveStatusAfterPayment('PAID', b)).toBe('PARTIALLY_PAID');
  });

  it('an overpaid invoice refunded down to the total stays PAID', () => {
    expect(deriveStatusAfterPayment('PAID', computeBalance(100, [ok(150), refunded(50)]))).toBe('PAID');
  });

  it('net 0 with no refund leaves the status alone (nothing was refunded); SENT, OVERDUE and VOID are never moved by a full refund', () => {
    expect(deriveStatusAfterPayment('PARTIALLY_PAID', computeBalance(100, [{ amount: 40, status: 'PENDING' }]))).toBe('PARTIALLY_PAID');
    expect(deriveStatusAfterPayment('SENT', computeBalance(100, [ok(40), refunded(40)]))).toBe('SENT');
    expect(deriveStatusAfterPayment('OVERDUE', computeBalance(100, [ok(40), refunded(40)]))).toBe('OVERDUE');
    expect(deriveStatusAfterPayment('VOID', computeBalance(100, [ok(40), refunded(40)]))).toBe('VOID');
  });

  it('the generic transition map is unchanged: PAID -> SENT and PARTIALLY_PAID -> SENT stay illegal for transition() callers', () => {
    expect(isLegalTransition('PAID', 'SENT')).toBe(false);
    expect(isLegalTransition('PARTIALLY_PAID', 'SENT')).toBe(false);
  });

  type Inv = {
    id: string;
    status: string;
    total: number;
    currency: string;
    businessId: string;
    paidAt: Date | null;
    payments: Array<{ amount: number; status: string }>;
  };

  function build(invoice: Inv) {
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...invoice, ...data, items: [], contact: null, booking: null }));
    const tx = {
      invoice: { findUnique: vi.fn(async () => invoice), update },
      invoiceItem: { findMany: vi.fn(async () => []) },
    };
    const events = { emit: vi.fn() };
    const expensePosting = { onProductSold: vi.fn(async () => null) };
    const service = new InvoiceWorkflowService(
      { client: { $transaction: vi.fn() } } as never,
      events as never,
      {} as never,
      expensePosting as never,
    );
    return { service, tx, update, events, expensePosting };
  }

  const paidInvoice = (payments: Inv['payments'], status = 'PAID'): Inv => ({
    id: 'inv_1',
    status,
    total: 100,
    currency: 'TTD',
    businessId: 'biz_1',
    paidAt: new Date('2026-10-01T00:00:00Z'),
    payments,
  });

  it('RED-BEFORE: the refund reconcile moves a fully refunded PAID invoice to SENT, clears paidAt, posts no COGS and queues only invoice.reopened (no invoice.sent email, no paid event; V1-42c)', async () => {
    const h = build(paidInvoice([ok(100), refunded(100)]));
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx as never, eventBuffer: buffer, onIllegalTransition: 'keep' });
    expect(result).toMatchObject({ status: 'SENT', changed: true, balance: { net: 0, remaining: 100 } });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0].data).toEqual({ status: 'SENT', paidAt: null });
    expect(h.expensePosting.onProductSold).not.toHaveBeenCalled();
    // V1-42c-INVOICE-STATUS-EVENTS (VR-05): the reopen is a status event its
    // listeners read (the calendar projection), never invoice.sent or a paid
    // event. It was queued as nothing, which left the calendar's due item
    // COMPLETED; the real-database proof is test/invoice-status-events.
    expect(buffer.map((e) => e.name)).toEqual(['invoice.reopened']);
    expect(buffer[0].payload).toMatchObject({ status: 'SENT', previousStatus: 'PAID', businessId: 'biz_1', eventName: 'invoice.reopened' });
    expect(h.events.emit, 'buffered for the caller to emit after commit').not.toHaveBeenCalled();
  });

  it('the same reopen without onIllegalTransition (provider refund webhooks) also reaches SENT, not a 409', async () => {
    const h = build(paidInvoice([ok(40), refunded(40)], 'PARTIALLY_PAID'));
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx as never, eventBuffer: [] });
    expect(result).toMatchObject({ status: 'SENT', changed: true });
    expect(h.update.mock.calls[0][0].data).toEqual({ status: 'SENT', paidAt: null });
  });

  it('RED-BEFORE: a partial refund reopening PAID -> PARTIALLY_PAID clears paidAt and queues invoice.payment_recorded with the balance', async () => {
    const h = build(paidInvoice([ok(60), ok(40), refunded(40)]));
    const buffer: Array<{ name: string; payload: unknown }> = [];
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx as never, eventBuffer: buffer, onIllegalTransition: 'keep' });
    expect(result).toMatchObject({ status: 'PARTIALLY_PAID', changed: true, balance: { net: 60, remaining: 40 } });
    expect(h.update.mock.calls[0][0].data).toEqual({ status: 'PARTIALLY_PAID', paidAt: null });
    expect(buffer.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
  });

  it('a payment settling the invoice still stamps paidAt (PARTIALLY_PAID -> PAID)', async () => {
    const h = build({ ...paidInvoice([ok(60), ok(40)], 'PARTIALLY_PAID'), paidAt: null });
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx as never, eventBuffer: [] });
    expect(result).toMatchObject({ status: 'PAID', changed: true });
    expect(h.update.mock.calls[0][0].data.paidAt).toBeInstanceOf(Date);
  });

  it('transition() (UI / mark-paid / void callers) still refuses PAID -> SENT with 409', async () => {
    const h = build(paidInvoice([ok(100)]));
    const tx = { invoice: { findUnique: vi.fn(async () => ({ id: 'inv_1', status: 'PAID', businessId: 'biz_1' })), update: vi.fn() } };
    await expect(h.service.transition('inv_1', 'SENT', { tx: tx as never, eventBuffer: [] })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });
  // V1-29 review (CR-V29-4): a row the manual refund flipped to REFUNDED
  // before V1-29 (positive amount, no separate refund row) is read from the
  // table as its payment plus its refund, not subtracted twice.
  const flipped = (amount: number) => ({ amount, status: 'REFUNDED' });

  it('CR-V29-4: readStoredPayments reads a positive REFUNDED row as the SUCCESSFUL payment plus a negative refund of the same amount; every other row passes unchanged', () => {
    expect(readStoredPayments([flipped(60), ok(40), refunded(40), { amount: 5, status: 'PENDING' }])).toEqual([
      { amount: 60, status: 'SUCCESSFUL' },
      { amount: -60, status: 'REFUNDED' },
      { amount: 40, status: 'SUCCESSFUL' },
      { amount: -40, status: 'REFUNDED' },
      { amount: 5, status: 'PENDING' },
    ]);
  });

  it('CR-V29-4 (RED-BEFORE in the readers): a legacy flipped 60 on a 100 invoice reads net 0, remaining 100 from the table (computeBalance alone reads net -60, remaining 160)', () => {
    expect(computeBalance(100, [flipped(60)])).toMatchObject({ net: -60, remaining: 160 });
    expect(balanceOfStoredRows(100, [flipped(60)], 'TTD')).toMatchObject({ paid: 60, refunded: 60, net: 0, remaining: 100, isFullyPaid: false });
    // Legacy 60 refunded beside a SUCCESSFUL 40: 40 is still received.
    expect(balanceOfStoredRows(100, [flipped(60), ok(40)])).toMatchObject({ paid: 100, refunded: 60, net: 40, remaining: 60 });
  });

  it('CR-V29-4: rows written since V1-29 (negative refund rows) read exactly as computeBalance reads them', () => {
    const rows = [ok(60), ok(40), refunded(40), { amount: 999, status: 'FAILED' }];
    expect(balanceOfStoredRows(100, rows)).toEqual(computeBalance(100, rows));
  });

  it('CR-V29-4: the reconcile reads a legacy flipped row as payment plus refund: 60 flipped + 40 received on a PAID invoice -> PARTIALLY_PAID, remaining 60 (computeBalance alone: net -20 -> SENT)', async () => {
    expect(deriveStatusAfterPayment('PAID', computeBalance(100, [flipped(60), ok(40)]))).toBe('SENT');
    const h = build(paidInvoice([flipped(60), ok(40)]));
    const result = await h.service.reconcileFromPayments('inv_1', { tx: h.tx as never, eventBuffer: [], onIllegalTransition: 'keep' });
    expect(result).toMatchObject({ status: 'PARTIALLY_PAID', changed: true, balance: { paid: 100, refunded: 60, net: 40, remaining: 60 } });
    expect(h.update.mock.calls[0][0].data).toEqual({ status: 'PARTIALLY_PAID', paidAt: null });
  });
});

/**
 * V1-44-DM-CREDIT-NOTE (CF-42, owner ruling D-28): FULLY_CREDITED and
 * PARTIALLY_CREDITED are real invoice states, driven by credit notes that post
 * to the ledger, and the workflow owns them. CreditNoteService applies or voids
 * the note and its posting; reconcileFromCredits, on the caller's transaction,
 * derives the invoice status from the APPLIED notes and the payment rows and
 * makes the move through the credit table, compare-and-set like transition().
 * The generic map keeps every credited move out of reach of transition()
 * callers and of the payment reconcile. Fakes only: the real-database proof is
 * test/credit-note-reversal.integration.test.ts.
 */
describe('V1-44 credited states (D-28): deriveStatusAfterCredit and the credit table', () => {
  const none = computeBalance(100, []);
  const paid40 = computeBalance(100, [{ amount: 40, status: 'SUCCESSFUL' }]);
  const paid100 = computeBalance(100, [{ amount: 100, status: 'SUCCESSFUL' }]);
  const ISSUED: InvoiceStatus[] = ['SENT', 'PENDING', 'OVERDUE', 'FAILED', 'PARTIALLY_PAID', 'PAID'];
  const CREDITED: InvoiceStatus[] = ['PARTIALLY_CREDITED', 'FULLY_CREDITED'];

  it('CS-01 applied credits short of the total -> PARTIALLY_CREDITED; reaching it -> FULLY_CREDITED, whatever was paid', () => {
    expect(deriveStatusAfterCredit('SENT', 100, 40, none)).toBe('PARTIALLY_CREDITED');
    expect(deriveStatusAfterCredit('SENT', 100, 100, none)).toBe('FULLY_CREDITED');
    expect(deriveStatusAfterCredit('OVERDUE', 100, 100, none)).toBe('FULLY_CREDITED');
    // A deposit paid in full and then part-credited (what V1-28 depositPosition reads).
    expect(deriveStatusAfterCredit('PAID', 100, 10, paid100)).toBe('PARTIALLY_CREDITED');
    expect(deriveStatusAfterCredit('PARTIALLY_PAID', 100, 60, paid40)).toBe('PARTIALLY_CREDITED');
    expect(deriveStatusAfterCredit('PARTIALLY_CREDITED', 100, 100, none)).toBe('FULLY_CREDITED');
    // One of two notes voided: still part-credited.
    expect(deriveStatusAfterCredit('FULLY_CREDITED', 100, 40, none)).toBe('PARTIALLY_CREDITED');
  });

  it('CS-01b compared in cents (D-13): 99.99 credited of 100.00 is partial; 0.1 + 0.2 credited of 0.30 is full', () => {
    expect(deriveStatusAfterCredit('SENT', 100, 99.99, none)).toBe('PARTIALLY_CREDITED');
    expect(deriveStatusAfterCredit('SENT', 0.3, 0.1 + 0.2, computeBalance(0.3, []))).toBe('FULLY_CREDITED');
  });

  it('CS-02 the last credit voided: the status the payment rows give it (nothing paid SENT, part paid PARTIALLY_PAID, settled PAID)', () => {
    for (const from of CREDITED) {
      expect(deriveStatusAfterCredit(from, 100, 0, none), from).toBe('SENT');
      expect(deriveStatusAfterCredit(from, 100, 0, paid40), from).toBe('PARTIALLY_PAID');
      expect(deriveStatusAfterCredit(from, 100, 0, paid100), from).toBe('PAID');
    }
  });

  it('CS-03 nothing credited and not a credited status: unchanged (nothing to move)', () => {
    for (const from of ['DRAFT', 'VOID', ...ISSUED] as InvoiceStatus[]) {
      expect(deriveStatusAfterCredit(from, 100, 0, none), from).toBe(from);
    }
  });

  it('CS-04 the credit table: an issued invoice may be credited; a credited one moves between the credited states and back to SENT / PARTIALLY_PAID / PAID', () => {
    for (const from of ISSUED) for (const to of CREDITED) expect(isLegalCreditTransition(from, to), `${from} -> ${to}`).toBe(true);
    for (const to of ['PARTIALLY_CREDITED', 'FULLY_CREDITED', 'SENT', 'PARTIALLY_PAID', 'PAID'] as InvoiceStatus[]) {
      expect(isLegalCreditTransition('PARTIALLY_CREDITED', to), `PARTIALLY_CREDITED -> ${to}`).toBe(true);
    }
    for (const to of ['PARTIALLY_CREDITED', 'SENT', 'PARTIALLY_PAID', 'PAID'] as InvoiceStatus[]) {
      expect(isLegalCreditTransition('FULLY_CREDITED', to), `FULLY_CREDITED -> ${to}`).toBe(true);
    }
  });

  it('CS-05 the credit table refuses: crediting a DRAFT or VOID invoice; a credited invoice to VOID, DRAFT, OVERDUE, PENDING or FAILED; a credit move between two uncredited states', () => {
    for (const from of ['DRAFT', 'VOID'] as InvoiceStatus[]) for (const to of CREDITED) expect(isLegalCreditTransition(from, to), `${from} -> ${to}`).toBe(false);
    for (const from of CREDITED) {
      for (const to of ['VOID', 'DRAFT', 'OVERDUE', 'PENDING', 'FAILED'] as InvoiceStatus[]) expect(isLegalCreditTransition(from, to), `${from} -> ${to}`).toBe(false);
    }
    expect(isLegalCreditTransition('SENT', 'PAID')).toBe(false);
    expect(isLegalCreditTransition('PAID', 'SENT')).toBe(false);
  });

  it('CS-06 the generic map: no transition() caller and no payment reconcile enters or leaves a credited state (credit notes alone drive them)', () => {
    for (const from of [...ISSUED, 'DRAFT'] as InvoiceStatus[]) {
      for (const to of CREDITED) {
        expect(isLegalTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(isLegalReconcileTransition(from, to), `reconcile ${from} -> ${to}`).toBe(false);
      }
    }
    for (const from of CREDITED) {
      for (const to of ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'DRAFT', 'FAILED', 'PENDING'] as InvoiceStatus[]) {
        expect(isLegalTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(isLegalReconcileTransition(from, to), `reconcile ${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe('V1-44 InvoiceWorkflowService.reconcileFromCredits (fakes)', () => {
  type Inv = { status: string; total: number; paidAt: Date | null };

  function build(invoice: Inv, applied: number | null, payments: Array<{ amount: number; status: string }> = []) {
    const row = { id: 'inv_1', businessId: 'biz_1', currency: 'TTD', ...invoice };
    const tx = {
      invoice: {
        findUnique: vi.fn(async () => row),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data })),
      },
      payment: { findMany: vi.fn(async () => payments) },
      creditNote: { aggregate: vi.fn(async () => ({ _sum: { amount: applied } })) },
    };
    const $transaction = vi.fn();
    const prisma = { client: { $transaction } };
    const events = { emit: vi.fn() };
    const revenuePosting = { onInvoiceFinalized: vi.fn(), onInvoiceVoided: vi.fn() };
    const expensePosting = { onProductSold: vi.fn(async () => null) };
    const service = new InvoiceWorkflowService(prisma as never, events as never, revenuePosting as never, expensePosting as never);
    const quiet = () => {
      expect($transaction, 'runs on the caller transaction only').not.toHaveBeenCalled();
      expect(events.emit, 'a credit move emits no invoice event').not.toHaveBeenCalled();
      expect(revenuePosting.onInvoiceFinalized).not.toHaveBeenCalled();
      expect(revenuePosting.onInvoiceVoided).not.toHaveBeenCalled();
      expect(expensePosting.onProductSold, 'no COGS').not.toHaveBeenCalled();
    };
    return { service, tx, quiet };
  }

  it('CR-01 SENT with 40 of 100 applied: one compare-and-set write to PARTIALLY_CREDITED through tx; reads the APPLIED notes and the business payment rows', async () => {
    const h = build({ status: 'SENT', total: 100, paidAt: null }, 40);
    const result = await h.service.reconcileFromCredits('inv_1', { tx: h.tx as never });
    expect(result).toEqual({ status: 'PARTIALLY_CREDITED', changed: true });
    expect(h.tx.invoice.update).toHaveBeenCalledTimes(1);
    expect(h.tx.invoice.update.mock.calls[0][0]).toMatchObject({ where: { id: 'inv_1', status: 'SENT' }, data: { status: 'PARTIALLY_CREDITED' } });
    expect(h.tx.creditNote.aggregate.mock.calls[0][0]).toMatchObject({ where: { invoiceId: 'inv_1', businessId: 'biz_1', status: 'APPLIED' } });
    expect(h.tx.payment.findMany.mock.calls[0][0]).toMatchObject({ where: { invoiceId: 'inv_1', businessId: 'biz_1' } });
    h.quiet();
  });

  it('CR-02 FULLY_CREDITED, the last note voided, paid in full: back to PAID; paidAt kept; no COGS, no invoice.paid', async () => {
    const paidAt = new Date('2026-10-01T12:00:00Z');
    const h = build({ status: 'FULLY_CREDITED', total: 100, paidAt }, null, [{ amount: 100, status: 'SUCCESSFUL' }]);
    const result = await h.service.reconcileFromCredits('inv_1', { tx: h.tx as never });
    expect(result).toEqual({ status: 'PAID', changed: true });
    expect(h.tx.invoice.update.mock.calls[0][0]).toMatchObject({ where: { id: 'inv_1', status: 'FULLY_CREDITED' } });
    expect(h.tx.invoice.update.mock.calls[0][0].data).toEqual({ status: 'PAID' });
    h.quiet();
  });

  it('CR-03 PARTIALLY_CREDITED, the last note voided, nothing paid: SENT', async () => {
    const h = build({ status: 'PARTIALLY_CREDITED', total: 100, paidAt: null }, 0);
    expect(await h.service.reconcileFromCredits('inv_1', { tx: h.tx as never })).toEqual({ status: 'SENT', changed: true });
    expect(h.tx.invoice.update.mock.calls[0][0].data).toEqual({ status: 'SENT' });
    h.quiet();
  });

  it('CR-04 still part-credited (a second partial note, or one of two voided): no write, changed false', async () => {
    const h = build({ status: 'PARTIALLY_CREDITED', total: 100, paidAt: null }, 70);
    expect(await h.service.reconcileFromCredits('inv_1', { tx: h.tx as never })).toEqual({ status: 'PARTIALLY_CREDITED', changed: false });
    expect(h.tx.invoice.update).not.toHaveBeenCalled();
    h.quiet();
  });

  for (const status of ['DRAFT', 'VOID']) {
    it(`CR-05 a credit on a ${status} invoice: 409 from the credit table, nothing written`, async () => {
      const h = build({ status, total: 100, paidAt: null }, 10);
      await expect(h.service.reconcileFromCredits('inv_1', { tx: h.tx as never })).rejects.toBeInstanceOf(ConflictException);
      expect(h.tx.invoice.update).not.toHaveBeenCalled();
      h.quiet();
    });
  }

  it('CR-06 a status moved by another writer between the read and the write (P2025): 409, the caller rolls back', async () => {
    const h = build({ status: 'SENT', total: 100, paidAt: null }, 40);
    h.tx.invoice.update.mockRejectedValueOnce(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));
    await expect(h.service.reconcileFromCredits('inv_1', { tx: h.tx as never })).rejects.toBeInstanceOf(ConflictException);
    h.quiet();
  });
});
