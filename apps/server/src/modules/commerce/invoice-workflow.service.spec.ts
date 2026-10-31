import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  InvoiceWorkflowService,
  computeBalance,
  deriveStatusAfterPayment,
  isLegalTransition,
  roundMoney,
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

  it('without options (webhook callers): unchanged behaviour, its own $transaction and an immediate emit', async () => {
    const h = build(sent([{ amount: 100, status: 'SUCCESSFUL' }]));
    const result = await h.service.reconcileFromPayments('inv_1');
    expect(result).toMatchObject({ status: 'PAID', changed: true });
    expect(h.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.calls).toEqual([]);
    expect(h.events.emit).toHaveBeenCalledTimes(1);
    expect(h.events.emit.mock.calls[0][0]).toBe('invoice.paid');
  });
});
