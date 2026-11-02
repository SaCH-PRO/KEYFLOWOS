/**
 * V1-36-DM-BALANCE-READ-CONTRACT (CF-17) — the invoice balance read contract:
 * what an invoice has been paid and what is left on it, for every surface
 * that shows it.
 *
 * The canonical reading is the server's computeBalance / balanceOfStoredRows
 * (apps/server/src/modules/commerce/invoice-workflow.service.ts): integer
 * cents (V1-22, D-13), SUCCESSFUL rows in, REFUNDED rows out, every refund a
 * separate negative REFUNDED row beside its SUCCESSFUL original (V1-29,
 * D-14). This module is its mirror for code that cannot import the server:
 * the web invoice list, stat cards and payment form, which before V1-36 each
 * summed the SUCCESSFUL rows alone and read a refunded invoice as still paid
 * (SUCCESSFUL 100 with 40 refunded: paid 100, remaining 0, "100% paid", and
 * recording the 40 still owed asked to confirm an over-payment).
 *
 * apps/server/src/modules/commerce/balance-arithmetic.spec.ts pins every
 * function here to its server original on fixed and seeded random cases;
 * change the two together.
 */

/** A Payment row as the balance reads it. `amount` may arrive as text (a Decimal read as a string). */
export interface InvoiceBalancePayment {
  amount: number | string | null | undefined;
  status: string; // 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REFUNDED'
}

/** The balance of one invoice, in currency units (each a whole number of cents). */
export interface InvoiceBalance {
  total: number;
  /** Money received: the SUCCESSFUL rows. */
  paid: number;
  /** Money refunded: the REFUNDED rows, whatever their sign. */
  refunded: number;
  /** paid - refunded: what the invoice has actually been paid. Show this as "paid". */
  net: number;
  /** What is still owed: 0 once the invoice is settled, otherwise total - net. */
  remaining: number;
  isFullyPaid: boolean;
  isOverpaid: boolean;
}

// ---------------------------------------------------------------------------
// Integer cents (mirror of apps/server/src/modules/commerce/money.ts)
// ---------------------------------------------------------------------------

/** A finite number as an exact decimal: value = m x 10^e. */
interface ExactDecimal {
  m: bigint;
  e: number;
}

function toExact(x: number): ExactDecimal {
  // String(x) is the shortest decimal that round-trips to x.
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
  const q = m / d;
  const r = m % d;
  const abs = r < ZERO ? -r : r;
  if (abs * TWO >= d) return m < ZERO ? q - ONE : q + ONE;
  return q;
}

function centsNumber(c: bigint): number {
  return c === ZERO ? 0 : Number(c);
}

function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN;
  const { m, e } = toExact(amount);
  return centsNumber(scaleRounded(m, e + 2));
}

function fromCents(cents: number): number {
  return cents === 0 ? 0 : cents / 100;
}

/** The sum of money values as exact decimals, rounded once to cents. */
function sumMoney(amounts: Iterable<number>): number {
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

/**
 * A stored total in cents (V1-22 review CR-V22-1): its decimal rounded half
 * away from zero (`cents`, shown); a legacy total that is not a whole cent is
 * also settled by the reading the base settled it with (`settleCents`) and
 * overpaid only above both (`maxCents`).
 */
function readTotalCents(total: number): { cents: number; settleCents: number; maxCents: number } {
  const cents = toCents(total);
  const legacy = Number.isFinite(cents) && fromCents(cents) !== total ? Math.round(total * 100) : cents;
  const positive = [cents, legacy].filter((c) => c > 0);
  return {
    cents,
    settleCents: positive.length > 0 ? Math.min(...positive) : Number.POSITIVE_INFINITY,
    maxCents: Math.max(cents, legacy),
  };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Mirror of computeBalance: the balance of `total` given payment rows.
 * SUCCESSFUL rows count as paid, REFUNDED rows as refunded whatever their sign,
 * PENDING and FAILED rows not at all. PAID and overpaid are exact cent
 * comparisons; `remaining` is never negative.
 */
export function computeInvoiceBalance(
  total: number,
  payments: ReadonlyArray<InvoiceBalancePayment>,
  currency?: string | null,
): InvoiceBalance {
  void currency; // every currency in scope (D-13: TTD, USD) has 2 decimals
  const paid = sumMoney(payments.filter((p) => p.status === 'SUCCESSFUL').map((p) => Number(p.amount) || 0));
  const refunded = sumMoney(
    payments.filter((p) => p.status === 'REFUNDED').map((p) => Math.abs(Number(p.amount) || 0)),
  );
  const t = readTotalCents(total);
  const netCents = toCents(paid) - toCents(refunded);
  const isFullyPaid = netCents >= t.settleCents;
  return {
    total: fromCents(t.cents),
    paid,
    refunded,
    net: fromCents(netCents),
    remaining: isFullyPaid ? 0 : fromCents(Math.max(0, t.cents - netCents)),
    isFullyPaid,
    isOverpaid: netCents > t.maxCents,
  };
}

/**
 * Mirror of readStoredPayments: stored Payment rows as the balance reads them.
 * A positive REFUNDED row is one the manual refund flipped before V1-29; it
 * stands for the payment received plus its refund (net 0). Every other row
 * passes unchanged.
 */
export function readStoredPaymentRows(
  rows: ReadonlyArray<InvoiceBalancePayment>,
): Array<{ amount: number; status: string }> {
  return rows.flatMap((p) => {
    const amount = Number(p.amount) || 0;
    if (p.status === 'REFUNDED' && amount > 0) {
      return [
        { amount, status: 'SUCCESSFUL' },
        { amount: -amount, status: 'REFUNDED' },
      ];
    }
    return [{ amount, status: p.status }];
  });
}

/**
 * Mirror of balanceOfStoredRows: the balance of an invoice from its stored
 * Payment rows (`invoice.payments` as the invoice routes serve them). This is
 * the reading every surface shows: `net` as paid, `remaining` as owed.
 */
export function invoiceBalanceOfStoredRows(
  total: number,
  rows: ReadonlyArray<InvoiceBalancePayment>,
  currency?: string | null,
): InvoiceBalance {
  return computeInvoiceBalance(total, readStoredPaymentRows(rows), currency);
}

/**
 * The share of the total actually paid (net of refunds), as a whole percent
 * for progress bars: 0 on a zero total, 100 once the invoice is settled (a
 * legacy sub-cent total settled at its lower reading included), above 100
 * only when overpaid.
 */
export function invoicePaidPercent(balance: InvoiceBalance): number {
  if (!(balance.total > 0)) return 0;
  const percent = Math.max(0, Math.round((balance.net / balance.total) * 100));
  return balance.isFullyPaid ? Math.max(100, percent) : Math.min(99, percent);
}
