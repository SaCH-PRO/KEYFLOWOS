/**
 * SWP-INV-MATH (BUG-018, BUG-019): the amounts of an invoice or quote, computed in the browser exactly as the server
 * saves them.
 *
 * This is the web mirror of apps/server/src/modules/commerce/money.ts (V1-22-DM-MONEY-CENTS, owner ruling D-13):
 * a number is read as the decimal it stands for (its shortest round-trip form), carried as an exact BigInt mantissa
 * and power of ten, and rounded to cents once, half away from zero. The order is the server's (taxorder ruling
 * D-164: unchanged until the accountant answers): tax is taxRate percent of the subtotal BEFORE the discount.
 * src/lib/finance/__tests__/document-amounts.test.ts pins every function here to the server original, on fixed cases
 * and on seeded random documents, so the two cannot drift.
 *
 * Every invoice and quote preview reads its numbers from here: the new and edit invoice pages, and the quote and
 * composer builder (billing-form-modal). Only 2-decimal currencies are in scope (D-13: TTD and USD).
 */

/** A finite number as an exact decimal: value = m x 10^e. */
interface ExactDecimal {
  m: bigint;
  e: number;
}

function toExact(x: number): ExactDecimal {
  const [coefficient, exponent] = String(x).split("e");
  const negative = coefficient!.startsWith("-");
  const digits = negative ? coefficient!.slice(1) : coefficient!;
  const dot = digits.indexOf(".");
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
  const q = m / d;
  const r = m % d;
  const abs = r < ZERO ? -r : r;
  if (abs * TWO >= d) return m < ZERO ? q - ONE : q + ONE;
  return q;
}

/** An integer count of cents as a Number, never negative zero. */
function centsNumber(c: bigint): number {
  return c === ZERO ? 0 : Number(c);
}

/** The amount in integer cents, half away from zero on its decimal value; NaN for a non-finite amount. */
function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN;
  const { m, e } = toExact(amount);
  return centsNumber(scaleRounded(m, e + 2));
}

/** The canonical double of an integer cent value. */
function fromCents(cents: number): number {
  return cents === 0 ? 0 : cents / 100;
}

function percentOfCents(cents: number, rate: number): number {
  if (!Number.isFinite(cents) || !Number.isFinite(rate)) return Number.NaN;
  const r = toExact(rate);
  return centsNumber(scaleRounded(BigInt(cents) * r.m, r.e - 2));
}

/** A document line: quantity x unitPrice as exact decimals, rounded to cents (3 x 1.115 = 3.35, 7 x 0.145 = 1.02). */
export function lineAmount(quantity: number, unitPrice: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return Number.NaN;
  const q = toExact(quantity);
  const p = toExact(unitPrice);
  return fromCents(centsNumber(scaleRounded(q.m * p.m, q.e + p.e + 2)));
}

export interface DocumentAmountsInput {
  /** Line amounts in currency units: lineAmount(quantity, unitPrice). */
  lines: number[];
  taxRate?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
}

export interface DocumentAmounts {
  lineTotals: number[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
}

/**
 * The server's rule, in integer cents: subtotal = the sum of the lines each rounded to cents; tax = taxRate percent
 * of the subtotal (before the discount); discount = discountValue percent of the subtotal (PERCENT) or discountValue
 * as money (FIXED), none when absent or 0; total = subtotal + tax - discount.
 */
export function computeDocumentAmounts(input: DocumentAmountsInput): DocumentAmounts {
  const lineCents = input.lines.map(toCents);
  const subtotalCents = lineCents.reduce((s, c) => s + c, 0);
  const taxCents = input.taxRate ? percentOfCents(subtotalCents, input.taxRate) : 0;
  let discountCents = 0;
  if (input.discountType === "PERCENT" && input.discountValue) {
    discountCents = percentOfCents(subtotalCents, input.discountValue);
  } else if (input.discountType === "FIXED" && input.discountValue) {
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

/** A form field as a number: blank or not a number reads 0, as the forms have always read it. */
export function formNumber(value: string | null | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

export interface DocumentForm {
  items: ReadonlyArray<{ quantity: string; unitPrice: string }>;
  taxRate: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
}

/** The amounts of a form as the user has typed it: what the server will save for the same fields. */
export function documentAmountsFromForm(form: DocumentForm): DocumentAmounts {
  const discount = formNumber(form.discountValue);
  return computeDocumentAmounts({
    lines: form.items.map((item) => lineAmount(formNumber(item.quantity), formNumber(item.unitPrice))),
    taxRate: formNumber(form.taxRate),
    discountType: discount ? form.discountType : null,
    discountValue: discount || null,
  });
}
