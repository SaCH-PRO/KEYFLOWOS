import { describe, expect, it } from 'vitest';
import {
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
