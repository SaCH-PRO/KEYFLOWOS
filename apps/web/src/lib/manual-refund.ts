/**
 * SWP-INV-REFUND-UI (sweep BUG-049; refund ruling D-169: whole-payment refunds only in v1): which payments the web
 * refunds through POST /commerce/businesses/:businessId/payments/:paymentId/refund (lib/client.ts refundPayment), and
 * the amount such a refund takes, read as the server reads it. Pure functions over the server's Payment rows, used by
 * the invoice page (/app/commerce/invoices/[id]) and Money > Money in (/app/payments). Kept out of lib/client.ts,
 * which several suites replace whole with a mock. Pinned by src/lib/__tests__/manual-refund.test.ts.
 */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * SWP-INV-REFUND-UI review (security MINOR-1/2, repair round 1): a payment the hand-recording door wrote, and so one a
 * refund here is right for: SUCCESSFUL money in whose providerPaymentId is one of the slots CommerceService.recordPayment
 * builds itself (the Record Payment form, KEY, the evidence and claim confirms, mark-paid; never a client value):
 * manual_<invoiceId>_key_<32 hex> and manual_<invoiceId>_ref_<32 hex> (manualProviderPaymentId),
 * manual_<invoiceId>_markpaid_<32 hex> (markInvoicePaid) and manual_<epoch ms>_<base36> (no key, no reference), and
 * the mark-paid row markInvoicePaid wrote before R0-PL-04, manual_<invoiceId>_<13-digit epoch ms> (repair round 2:
 * a storefront row carries its order's id there, never the invoice's; a pay-link intent is PENDING). The
 * server reads the same prefix as hand-recorded (payments.service.ts MANUAL_PAYMENT_ID_PREFIX).
 *
 * Fail closed: the provider is not read at all. On a hand-recorded row it is the method text the member typed ("Cash",
 * "PayPal", even "Stripe"), and a gateway, an unknown or future provider, or a gateway name in another casing writes no
 * such slot, so none of them is offered (refunding one here would record a refund its gateway never made). Nor is a
 * storefront order's row (manual_<orderId>_<epoch ms>), a pay-link intent (manual_<invoiceId>_intent_..., PENDING), a
 * refund row (manual_refund_..., negative) or a pending scan.
 */
export function isManualPayment(p: { status: string; amount: number | string; providerPaymentId: string; invoiceId: string }): boolean {
  if (p.status !== "SUCCESSFUL" || !(Number(p.amount) > 0) || typeof p.providerPaymentId !== "string") return false;
  const slot = new RegExp(`^manual_${escapeRegExp(p.invoiceId)}_(key|ref|markpaid)_[0-9a-f]{32}$`);
  const legacyMarkPaid = new RegExp(`^manual_${escapeRegExp(p.invoiceId)}_\\d{13}$`);
  return slot.test(p.providerPaymentId) || legacyMarkPaid.test(p.providerPaymentId) || /^manual_\d+_[0-9a-z]{1,6}$/.test(p.providerPaymentId);
}

/**
 * SWP-INV-REFUND-UI repair round 1b: the server's bookkeeping refund door (markPaymentRefunded) is open to gateway
 * payments as well (commerce-refund.integration RF-10/RF-12): it records a refund made outside KeyFlow and calls no
 * provider. WiPay has no refund API, so for a WiPay payment it is the only way to record its refund. A WiPay payment
 * is one whose provider is exactly 'wipay': only the WiPay door writes that (D-55 stores a gateway name a member types
 * as 'manual'); 'WiPay' or any other spelling is not one, and is not offered (fail closed).
 */
export function isOutOfBandRefundable(p: { status: string; amount: number | string; provider: string }): boolean {
  return p.status === "SUCCESSFUL" && Number(p.amount) > 0 && p.provider === "wipay";
}

/**
 * The gateways with a refund API whose payments are refunded through it (Money > Money in's "Issue refund", the
 * payments-ops refund door), never recorded here: provider exactly 'stripe' or 'paypal'.
 */
export function isGatewayRefundable(p: { status: string; amount: number | string; provider: string }): boolean {
  return p.status === "SUCCESSFUL" && Number(p.amount) > 0 && (p.provider === "stripe" || p.provider === "paypal");
}

/** Where a gateway payment is refunded: Money > Money in, its Refunds tab. */
export const GATEWAY_REFUND_HREF = "/app/payments?tab=refunds";

// ---------------------------------------------------------------------------
// Exact-decimal money (mirror of apps/server/src/modules/commerce/money.ts toCents / sumMoney / subtractMoney)
// ---------------------------------------------------------------------------

interface ExactDecimal {
  m: bigint;
  e: number;
}

/** A finite number as an exact decimal (value = m x 10^e), from the shortest decimal that round-trips to it. */
function toExact(x: number): ExactDecimal {
  const [coefficient, exponent] = String(x).split("e");
  const negative = coefficient.startsWith("-");
  const digits = negative ? coefficient.slice(1) : coefficient;
  const dot = digits.indexOf(".");
  const whole = dot < 0 ? digits : digits.slice(0, dot) + digits.slice(dot + 1);
  const e = (exponent ? Number(exponent) : 0) - (dot < 0 ? 0 : digits.length - dot - 1);
  const m = BigInt(whole);
  return { m: negative ? -m : m, e };
}

/** m x 10^shift rounded to an integer, half away from zero. */
function scaleRounded(m: bigint, shift: number): bigint {
  if (shift >= 0) return m * 10n ** BigInt(shift);
  const d = 10n ** BigInt(-shift);
  const negative = m < 0n;
  const a = negative ? -m : m;
  let q = a / d;
  if ((a % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/** Whole cents of `amount`, half away from zero on its decimal value (the server's toCents). */
function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN;
  const { m, e } = toExact(amount);
  return Number(scaleRounded(m, e + 2));
}

/**
 * An amount as the server stores and refunds it: whole cents, half away from zero on its exact decimal value (a
 * legacy 1.005 is 1.01; float arithmetic reads it as 1.00). For the dialog's figures and its "whole" test.
 */
export function moneyOf(amount: number | string): number {
  return toCents(Number(amount)) / 100;
}

/** The sum of money values in whole cents, added as exact decimals and rounded once (the server's sumMoney). */
function sumCents(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const parts = amounts.map(toExact);
  const e = Math.min(...parts.map((p) => p.e));
  let total = 0n;
  for (const p of parts) total += p.m * 10n ** BigInt(p.e - e);
  return Number(scaleRounded(total, e + 2));
}

/**
 * SWP-INV-REFUND-UI (D-169): the amount a refund of `payment` takes, read as the server's refundableOf (in
 * commerce.service.ts) reads it over the invoice's rows (`rows`, the payment included): a refund row is a REFUNDED row
 * with amount < 0; what is left of the payment after the refund rows linked to it (reference = its providerPaymentId,
 * or, from its provider, its own reference) and after the same-provider refund rows that link to no payment, each sum
 * taken exactly and rounded once to cents (review MINOR-4); never more than the invoice has received net
 * (`netReceived`, the server's paidAmount; Infinity for no cap). 0 when nothing is left. The server reads this again
 * under its lock: the refund it answers is the amount that was refunded.
 */
export function manualRefundableAmount(
  payment: { amount: number | string; provider: string; providerPaymentId: string; reference?: string | null },
  rows: ReadonlyArray<{ amount: number | string; status: string; provider: string; providerPaymentId: string; reference?: string | null }>,
  netReceived: number,
): number {
  type Row = (typeof rows)[number];
  const isRefundRow = (r: Row) => r.status === "REFUNDED" && Number(r.amount) < 0;
  const linksTo = (refund: Row, original: { provider: string; providerPaymentId: string; reference?: string | null }) =>
    !!refund.reference &&
    (refund.reference === original.providerPaymentId || (refund.provider === original.provider && refund.reference === original.reference));
  const refunds = rows.filter(isRefundRow);
  const originals = rows.filter((r) => !isRefundRow(r));
  const linked = sumCents(refunds.filter((r) => linksTo(r, payment)).map((r) => Math.abs(Number(r.amount))));
  const leftLinked = toCents(Number(payment.amount)) - linked;
  if (!(leftLinked > 0)) return 0;
  const unmatched = sumCents(
    refunds.filter((r) => r.provider === payment.provider && !originals.some((o) => linksTo(r, o))).map((r) => Math.abs(Number(r.amount))),
  );
  const leftUnmatched = leftLinked - unmatched;
  if (!(leftUnmatched > 0)) return 0;
  const cap = Number.isFinite(netReceived) ? toCents(netReceived) : Infinity;
  if (!(cap > 0)) return 0;
  return Math.min(leftUnmatched, cap) / 100;
}

/**
 * SWP-INV-REFUND-UI review (security MINOR-4, repair round 1): the refund dialog's question, saying what was paid and
 * what will be refunded (all that is left of the payment, D-169): "Refund the TTD 100.00 paid by Cash on 20/11/2026?"
 * or, for a payment partly refunded already, "Refund TTD 60.00 of the TTD 100.00 paid by Cash on 20/11/2026 (all that
 * is left of it)?". Amounts come formatted by the caller's money helper.
 */
export function manualRefundQuestion(input: { refund: string; paid: string; whole: boolean; method?: string | null; on: string }): string {
  const paidBy = `paid${input.method ? ` by ${input.method}` : ""} on ${input.on}`;
  const what = input.whole ? `Refund the ${input.refund} ${paidBy}?` : `Refund ${input.refund} of the ${input.paid} ${paidBy} (all that is left of it)?`;
  return `${what} The invoice is owed that much again. KeyFlow records the refund: give the money back to the customer yourself.`;
}

/** What the refund dialog says while it reads the payment's latest figures. */
/**
 * The question for a WiPay payment's refund (repair round 1b): the member refunded the customer in WiPay, outside
 * KeyFlow, and this records it in the books.
 */
export function outOfBandRefundQuestion(input: { refund: string; paid: string; whole: boolean; on: string }): string {
  const what = input.whole
    ? `Record that you refunded the ${input.refund} paid through WiPay on ${input.on} outside KeyFlow?`
    : `Record that you refunded ${input.refund} of the ${input.paid} paid through WiPay on ${input.on} (all that is left of it) outside KeyFlow?`;
  return `${what} WiPay refunds are not made through KeyFlow: refund the customer in WiPay first. This only records the refund in the books, and the invoice is owed that much again.`;
}

export const MANUAL_REFUND_CHECKING = "Reading this payment's latest figures…";
