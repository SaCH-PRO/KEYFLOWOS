/**
 * V1-22-DM-MONEY-CENTS (M23, CF-54; owner ruling D-13) — integer-cents money
 * arithmetic on the existing Float columns.
 *
 * Invoice, Quote, InvoiceItem, QuoteItem and Payment amounts are Float
 * columns; the ledger they post to is numeric(18,4). Every money value that is
 * written to one of those columns, or that decides a balance (paid, remaining,
 * PAID, overpaid), goes through here:
 *
 *  - A number is read as the decimal it stands for: its shortest round-trip
 *    form (`String(x)`), so 0.1 is one tenth and 1.005 is one and five
 *    thousandths, not the binary fraction below it. The decimal is carried as
 *    an exact integer mantissa and a power of ten (BigInt), so products,
 *    percentages and sums are exact.
 *  - Rounding to cents happens once per stored value, half away from zero
 *    (1.005 -> 1.01, -1.005 -> -1.01, 0.0375 -> 0.04).
 *  - Arithmetic between stored values is integer cents; the result is handed
 *    back as the canonical double of the cent value (cents / 100), which is
 *    what the Float column stores and what a reload returns.
 *
 * Only 2-decimal currencies are in scope (D-13: TTD and USD); the currency
 * argument is accepted so a 0- or 3-decimal currency changes one place.
 * No schema change: the Decimal migration (DM-005) is staged after this.
 */

/** A finite number as an exact decimal: value = m x 10^e. */
interface ExactDecimal {
  m: bigint;
  e: number;
}

function toExact(x: number): ExactDecimal {
  // String(x) is the shortest decimal that round-trips to x: "0.1",
  // "0.30000000000000004", "1e-7", "1.5e+21".
  const [coefficient, exponent] = String(x).split('e');
  const negative = coefficient.startsWith('-');
  const digits = negative ? coefficient.slice(1) : coefficient;
  const dot = digits.indexOf('.');
  const whole = dot < 0 ? digits : digits.slice(0, dot) + digits.slice(dot + 1);
  const e = (exponent ? Number(exponent) : 0) - (dot < 0 ? 0 : digits.length - dot - 1);
  const m = BigInt(whole);
  return { m: negative ? -m : m, e };
}

const TEN = BigInt(10);
const TWO = BigInt(2);
const ZERO = BigInt(0);
const ONE = BigInt(1);

/** m x 10^shift as an integer, rounded half away from zero. */
function scaleRounded(m: bigint, shift: number): bigint {
  if (shift >= 0) return m * TEN ** BigInt(shift);
  const d = TEN ** BigInt(-shift);
  const q = m / d; // truncates toward zero
  const r = m % d; // carries the sign of m
  const abs = r < ZERO ? -r : r;
  if (abs * TWO >= d) return m < ZERO ? q - ONE : q + ONE;
  return q;
}

/** An integer count of cents as a Number, never negative zero. */
function centsNumber(c: bigint): number {
  return c === ZERO ? 0 : Number(c);
}

/**
 * The amount in integer cents (half away from zero on its decimal value).
 * A non-finite amount answers NaN, so the amount guards downstream
 * (Number.isFinite) refuse it as they did before.
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN;
  const { m, e } = toExact(amount);
  return centsNumber(scaleRounded(m, e + 2));
}

/** The canonical double of an integer cent value (what the Float columns store). */
export function fromCents(cents: number): number {
  return cents === 0 ? 0 : cents / 100;
}

/**
 * Round to the currency's minor unit (cents for TTD and USD), half away from
 * zero on the decimal value: roundMoney(1.005) === 1.01, roundMoney(0.1 + 0.2) === 0.3.
 */
export function roundMoney(amount: number, currency?: string | null): number {
  void currency; // every currency in scope (D-13: TTD, USD) has 2 decimals
  return fromCents(toCents(amount));
}

/**
 * The sum of money values, rounded once to cents. The values are added as
 * exact decimals first, so cent values sum exactly (0.01 + 33.33 x 3 === 100)
 * and a legacy sub-cent row counts as the numeric(18,4) ledger holds it
 * (0.004 + 0.004 === 0.01), whatever the order.
 */
export function sumMoney(amounts: Iterable<number>): number {
  const parts: ExactDecimal[] = [];
  for (const a of amounts) {
    if (!Number.isFinite(a)) return Number.NaN;
    parts.push(toExact(a));
  }
  if (parts.length === 0) return 0;
  const e = Math.min(...parts.map((p) => p.e));
  let total = ZERO;
  for (const p of parts) total += p.m * TEN ** BigInt(p.e - e);
  return fromCents(centsNumber(scaleRounded(total, e + 2)));
}

/** a - b in cents: subtractMoney(100, 99.99) === 0.01. */
export function subtractMoney(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

/** True when a and b are the same number of cents. */
export function moneyEquals(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/**
 * A document line: quantity x unitPrice multiplied as exact decimals, then
 * rounded to cents. 7 x 0.145 === 1.02 (the float product reads 1.01), and
 * 3 x 1.115 === 3.35 (the float product is 3.3449999999999998).
 */
export function lineAmount(quantity: number, unitPrice: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return Number.NaN;
  const q = toExact(quantity);
  const p = toExact(unitPrice);
  return fromCents(centsNumber(scaleRounded(q.m * p.m, q.e + p.e + 2)));
}

/** `rate` percent of an amount, exact, rounded to cents: percentOf(0.3, 12.5) === 0.04. */
export function percentOf(amount: number, rate: number): number {
  return fromCents(percentOfCents(toCents(amount), rate));
}

function percentOfCents(cents: number, rate: number): number {
  if (!Number.isFinite(cents) || !Number.isFinite(rate)) return Number.NaN;
  const r = toExact(rate);
  return centsNumber(scaleRounded(BigInt(cents) * r.m, r.e - 2));
}

export interface DocumentAmountsInput {
  /** Line amounts in currency units: lineAmount(quantity, unitPrice), or a stored line total. */
  lines: number[];
  taxRate?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
}

export interface DocumentAmounts {
  /** Each line rounded to cents, in input order (what InvoiceItem/QuoteItem.total stores). */
  lineTotals: number[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
}

/**
 * The amounts of an invoice or quote, in integer cents. The rules are the ones
 * CommerceService already applied, now in cents:
 *  - subtotal = the sum of the lines, each rounded to cents;
 *  - tax = taxRate percent of the subtotal (tax is taken before the discount);
 *  - discount = discountValue percent of the subtotal (PERCENT) or
 *    discountValue as money (FIXED); none when the value is absent or 0;
 *  - total = subtotal + tax - discount, exactly, in cents.
 * A non-finite input makes the result non-finite, which the amount guard
 * (assertInvoiceAmounts) refuses as before.
 */
export function computeDocumentAmounts(input: DocumentAmountsInput): DocumentAmounts {
  const lineCents = input.lines.map(toCents);
  const subtotalCents = lineCents.reduce((s, c) => s + c, 0);
  const taxCents = input.taxRate ? percentOfCents(subtotalCents, input.taxRate) : 0;
  let discountCents = 0;
  if (input.discountType === 'PERCENT' && input.discountValue) {
    discountCents = percentOfCents(subtotalCents, input.discountValue);
  } else if (input.discountType === 'FIXED' && input.discountValue) {
    discountCents = toCents(input.discountValue);
  }
  return {
    lineTotals: lineCents.map(fromCents),
    subtotal: fromCents(subtotalCents),
    taxAmount: fromCents(taxCents),
    discountAmount: fromCents(discountCents),
    total: fromCents(subtotalCents + taxCents - discountCents),
  };
}
