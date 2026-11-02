/**
 * V1-22-DM-MONEY-CENTS (M23, CF-54; owner ruling D-13) — integer-cents money
 * arithmetic on the existing Float columns.
 *
 * Invoice, Quote and Payment amounts are Float columns and the ledger is
 * numeric(18,4). Before this packet the document amounts were the raw float
 * result of quantity x unitPrice, + tax, - discount: items 0.1 and 0.2 at
 * 12.5% tax stored subtotal 0.30000000000000004 and total 0.3375, and the
 * invoice posted 0.3375 to the ledger. money.ts does every money step in
 * integer cents (exact decimal arithmetic, half away from zero) and hands back
 * the canonical double of the cent value, which is what the Float columns
 * store. No schema change: the Decimal migration (DM-005) is staged later.
 *
 * Pure. The real-database proof is test/commerce-money-rounding.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDocumentAmounts,
  fromCents,
  lineAmount,
  moneyEquals,
  overpaidMoney,
  percentOf,
  readTotalCents,
  remainingMoney,
  roundMoney,
  subtractMoney,
  sumMoney,
  toCents,
} from './money';

describe('toCents / fromCents', () => {
  it('converts the decimal the value stands for, not the float drift', () => {
    expect(toCents(0.1)).toBe(10);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004
    expect(toCents(33.33)).toBe(3333);
    expect(toCents(100)).toBe(10000);
    expect(toCents(0)).toBe(0);
  });

  it('rounds a half cent away from zero (1.005 -> 101, 2.675 -> 268, -1.005 -> -101)', () => {
    // Math.round(1.005 * 100) is 100 and (2.675).toFixed(2) is "2.67": both read the float below the half.
    expect(toCents(1.005)).toBe(101);
    expect(toCents(2.675)).toBe(268);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(0.125)).toBe(13);
  });

  it('never answers negative zero', () => {
    expect(Object.is(toCents(-0), 0)).toBe(true);
    expect(Object.is(toCents(-0.004), 0)).toBe(true);
  });

  it('handles exponent notation and large amounts', () => {
    expect(toCents(1e-7)).toBe(0);
    expect(toCents(5e-3)).toBe(1);
    expect(toCents(12_345_678_901.23)).toBe(1_234_567_890_123);
  });

  it('passes a non-finite value through as NaN, so the amount guards refuse it', () => {
    expect(toCents(Number.NaN)).toBeNaN();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNaN();
  });

  it('fromCents gives the canonical double of the cent value', () => {
    expect(fromCents(34)).toBe(0.34);
    expect(fromCents(-101)).toBe(-1.01);
    expect(fromCents(10000)).toBe(100);
    expect(Object.is(fromCents(-0), 0)).toBe(true);
  });
});

describe('roundMoney', () => {
  it('rounds to cents by decimal value (TTD and USD are 2dp)', () => {
    expect(roundMoney(1.234)).toBe(1.23);
    expect(roundMoney(1.236)).toBe(1.24);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675, 'USD')).toBe(2.68);
    expect(roundMoney(0.1 + 0.2, 'TTD')).toBe(0.3);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(99.999)).toBe(100);
  });
});

describe('sumMoney / subtractMoney / moneyEquals', () => {
  it('sums without drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([0.01, 33.33, 33.33, 33.33])).toBe(100); // float: 99.99999999999999
    expect(sumMoney(Array.from({ length: 1000 }, () => 0.1))).toBe(100); // float: 99.9999999999986
    expect(sumMoney([])).toBe(0);
  });

  it('sums sub-cent legacy values exactly, then rounds once (as the numeric(18,4) ledger holds them)', () => {
    expect(sumMoney([0.004, 0.004])).toBe(0.01);
    expect(sumMoney([0.3375, 0.3375])).toBe(0.68);
  });

  it('subtracts without drift', () => {
    expect(subtractMoney(100, 99.99)).toBe(0.01); // float: 0.010000000000005116
    expect(subtractMoney(100, sumMoney([0.01, 33.33, 33.33, 33.33]))).toBe(0);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2); // float: 0.19999999999999998
  });

  it('compares in cents', () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(moneyEquals(100, 100.01)).toBe(false);
    expect(moneyEquals(99.99, 100)).toBe(false);
  });
});

describe('V1-22 review CR-V22-1: readTotalCents / remainingMoney / overpaidMoney', () => {
  it('a whole-cent total (every V1-22 write) has one reading', () => {
    expect(readTotalCents(100)).toEqual({ cents: 10000, settleCents: 10000, maxCents: 10000 });
    expect(readTotalCents(0.34)).toEqual({ cents: 34, settleCents: 34, maxCents: 34 });
    expect(readTotalCents(1.15)).toEqual({ cents: 115, settleCents: 115, maxCents: 115 }); // 1.15 * 100 is 114.99999999999999
  });

  it('nothing settles a zero total', () => {
    expect(readTotalCents(0)).toEqual({ cents: 0, settleCents: Number.POSITIVE_INFINITY, maxCents: 0 });
    expect(remainingMoney(0, 0)).toBe(0);
  });

  it('a legacy sub-cent total is settled by the lower of its decimal and base readings, overpaid only above the higher', () => {
    // 8.36 + 12.5% stored 9.405: decimal 9.41, base Math.round(940.4999999999999) 9.40
    expect(readTotalCents(8.36 + (8.36 * 12.5) / 100)).toEqual({ cents: 941, settleCents: 940, maxCents: 941 });
    // 0.36 + 12.5% stored 0.40499999999999997: decimal 0.40, base Math.round(40.5) 0.41
    expect(readTotalCents(0.36 + (0.36 * 12.5) / 100)).toEqual({ cents: 40, settleCents: 40, maxCents: 41 });
    // 0.1 + 0.2 at 12.5% stored 0.3375: both readings 0.34, the band is not widened to 0.33
    expect(readTotalCents(0.30000000000000004 + 0.037500000000000006)).toEqual({ cents: 34, settleCents: 34, maxCents: 34 });
    expect(readTotalCents(1.005)).toEqual({ cents: 101, settleCents: 100, maxCents: 101 });
  });

  it('remainingMoney is 0 once paid settles the total, else total - paid in cents', () => {
    expect(remainingMoney(100, 99.99)).toBe(0.01);
    expect(remainingMoney(100, 100)).toBe(0);
    expect(remainingMoney(100, 120)).toBe(0);
    expect(remainingMoney(9.405, 9.4)).toBe(0); // HEAD be6195d6: 0.01 on a PAID invoice
    expect(remainingMoney(9.405, 9.39)).toBe(0.02);
    expect(remainingMoney(0.3375, 0.33)).toBe(0.01);
    expect(remainingMoney(100, sumMoney([0.01, 33.33, 33.33, 33.33]))).toBe(0);
  });

  it('overpaidMoney is 0 within the readings, else the amount above the higher one', () => {
    expect(overpaidMoney(100, 100)).toBe(0);
    expect(overpaidMoney(100, 100.01)).toBe(0.01);
    expect(overpaidMoney(0.40499999999999997, 0.41)).toBe(0); // HEAD be6195d6: 0.01
    expect(overpaidMoney(0.40499999999999997, 0.42)).toBe(0.01);
    expect(overpaidMoney(1.005, 1.01)).toBe(0);
    expect(overpaidMoney(9.405, 9.42)).toBe(0.01);
  });
});

describe('lineAmount / percentOf', () => {
  it('multiplies the decimals exactly before rounding the line to cents', () => {
    expect(lineAmount(1, 0.1)).toBe(0.1);
    expect(lineAmount(3, 0.1)).toBe(0.3); // float: 0.30000000000000004
    expect(lineAmount(7, 0.145)).toBe(1.02); // 1.015; Math.round(7 * 0.145 * 100) / 100 is 1.01
    expect(lineAmount(3, 1.115)).toBe(3.35); // 3.345; the float product is 3.3449999999999998
    expect(lineAmount(3, 33.335)).toBe(100.01);
    expect(lineAmount(2, 0)).toBe(0);
  });

  it('takes a percentage of an amount exactly, rounded to cents', () => {
    expect(percentOf(0.3, 12.5)).toBe(0.04); // 0.0375
    expect(percentOf(100, 12.5)).toBe(12.5);
    expect(percentOf(10.05, 10)).toBe(1.01); // 1.005; Math.round(10.05 * 10 / 100 * 100) / 100 is 1
    expect(percentOf(100, 0)).toBe(0);
  });
});

describe('computeDocumentAmounts', () => {
  it('RED-BEFORE: items 0.1 and 0.2 at 12.5% tax are subtotal 0.30, tax 0.04, total 0.34', () => {
    const a = computeDocumentAmounts({ lines: [lineAmount(1, 0.1), lineAmount(1, 0.2)], taxRate: 12.5 });
    expect(a).toEqual({ lineTotals: [0.1, 0.2], subtotal: 0.3, taxAmount: 0.04, discountAmount: 0, total: 0.34 });
  });

  it('tax and a PERCENT discount are both taken on the subtotal (the existing rule), each rounded to cents', () => {
    const a = computeDocumentAmounts({ lines: [100], taxRate: 12.5, discountType: 'PERCENT', discountValue: 10 });
    expect(a).toMatchObject({ subtotal: 100, taxAmount: 12.5, discountAmount: 10, total: 102.5 });
    const b = computeDocumentAmounts({ lines: [10.05], taxRate: 10, discountType: 'PERCENT', discountValue: 10 });
    expect(b).toMatchObject({ subtotal: 10.05, taxAmount: 1.01, discountAmount: 1.01, total: 10.05 });
  });

  it('a FIXED discount is a money amount in cents', () => {
    const a = computeDocumentAmounts({ lines: [0.1, 0.2], taxRate: 12.5, discountType: 'FIXED', discountValue: 0.05 });
    expect(a).toMatchObject({ subtotal: 0.3, taxAmount: 0.04, discountAmount: 0.05, total: 0.29 });
  });

  it('no tax rate and no discount value are zero', () => {
    const a = computeDocumentAmounts({ lines: [0.1, 0.2], taxRate: null, discountType: 'PERCENT', discountValue: null });
    expect(a).toMatchObject({ subtotal: 0.3, taxAmount: 0, discountAmount: 0, total: 0.3 });
    expect(computeDocumentAmounts({ lines: [] })).toMatchObject({ subtotal: 0, taxAmount: 0, discountAmount: 0, total: 0 });
  });

  it('stored legacy line totals are rounded to cents before they are summed', () => {
    const a = computeDocumentAmounts({ lines: [0.30000000000000004, 1.015] });
    expect(a).toMatchObject({ lineTotals: [0.3, 1.02], subtotal: 1.32, total: 1.32 });
  });

  it('a non-finite input yields a non-finite total, which the amount guard refuses', () => {
    expect(computeDocumentAmounts({ lines: [Number.NaN] }).total).toBeNaN();
  });
});

/**
 * Property test (seeded, so a failure reproduces). Prices are generated as
 * integer thousandths and tax rates as integer thousandths of a percent, so
 * the expected cents are computed independently with integer arithmetic.
 */
describe('computeDocumentAmounts property: subtotal + tax - discount == total exactly in cents', () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Integer division rounded half away from zero (both operands non-negative here). */
  const divRound = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
  const canonical = (v: number) => fromCents(toCents(v)) === v;

  it('holds for 2000 random item lists, taxes and discounts', () => {
    const rand = mulberry32(0x5eed_0022);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let run = 0; run < 2000; run++) {
      const n = int(1, 8);
      const items = Array.from({ length: n }, () => {
        const quantity = int(1, 20);
        // 0, 1, 2 or 3 decimals, up to 9,999.999
        const decimals = int(0, 3);
        const step = 10 ** (3 - decimals);
        const priceMilli = int(0, Math.floor(9_999_999 / step)) * step;
        return { quantity, priceMilli, unitPrice: priceMilli / 1000 };
      });
      const rateMilli = [0, 12_500, 7_000, 15_000, 8_250, int(0, 100_000)][int(0, 5)];
      const taxRate = rateMilli / 1000;

      const expectedLines = items.map((i) => divRound(i.quantity * i.priceMilli, 10));
      const expectedSubtotal = expectedLines.reduce((s, c) => s + c, 0);
      const expectedTax = divRound(expectedSubtotal * rateMilli, 100_000);

      const kind = int(0, 2);
      let discountType: 'PERCENT' | 'FIXED' | undefined;
      let discountValue: number | undefined;
      let expectedDiscount = 0;
      if (kind === 1) {
        const pctHundredths = int(0, 10_000);
        discountType = 'PERCENT';
        discountValue = pctHundredths / 100;
        expectedDiscount = divRound(expectedSubtotal * pctHundredths, 10_000);
      } else if (kind === 2) {
        const fixedCents = int(0, expectedSubtotal);
        discountType = 'FIXED';
        discountValue = fixedCents / 100;
        expectedDiscount = fixedCents;
      }

      const a = computeDocumentAmounts({
        lines: items.map((i) => lineAmount(i.quantity, i.unitPrice)),
        taxRate,
        discountType,
        discountValue,
      });
      const ctx = JSON.stringify({ run, items, taxRate, discountType, discountValue, a });

      expect(a.lineTotals.map(toCents), ctx).toEqual(expectedLines);
      expect(toCents(a.subtotal), ctx).toBe(expectedSubtotal);
      expect(toCents(a.taxAmount), ctx).toBe(expectedTax);
      expect(toCents(a.discountAmount), ctx).toBe(expectedDiscount);
      expect(toCents(a.subtotal) + toCents(a.taxAmount) - toCents(a.discountAmount), ctx).toBe(toCents(a.total));
      for (const v of [a.subtotal, a.taxAmount, a.discountAmount, a.total, ...a.lineTotals]) {
        expect(canonical(v), `${v} is a canonical cent value; ${ctx}`).toBe(true);
      }
      expect(a.total, ctx).toBeGreaterThanOrEqual(0);
    }
  });
});
