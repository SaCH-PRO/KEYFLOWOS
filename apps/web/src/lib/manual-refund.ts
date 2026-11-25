/**
 * SWP-INV-REFUND-UI (sweep BUG-049; refund ruling D-169: whole-payment refunds only in v1): which payments the web
 * refunds through POST /commerce/businesses/:businessId/payments/:paymentId/refund (lib/client.ts refundPayment), and
 * the amount such a refund takes, read as the server reads it. Pure functions over the server's Payment rows, used by
 * the invoice page (/app/commerce/invoices/[id]) and Money > Money in (/app/payments). Kept out of lib/client.ts,
 * which several suites replace whole with a mock.
 */

/** The providers whose payments are refunded through their gateway (the server's GATEWAY_PROVIDER_IDS, D-55). */
export const GATEWAY_PAYMENT_PROVIDERS: ReadonlySet<string> = new Set(["stripe", "paypal", "wipay"]);

/**
 * SWP-INV-REFUND-UI: a payment recorded by hand (cash, bank transfer, a mark-paid row): SUCCESSFUL money in, not a
 * gateway payment (refunding one here would record a refund the gateway never made), not a refund row and not a
 * pending scan. Only such a payment is refunded through refundPayment.
 */
export function isManualPayment(p: { provider: string; status: string; amount: number | string }): boolean {
  return p.status === "SUCCESSFUL" && Number(p.amount) > 0 && !GATEWAY_PAYMENT_PROVIDERS.has(p.provider);
}

/**
 * SWP-INV-REFUND-UI (D-169): the amount a refund of `payment` takes, read as the server reads it (refundableOf, in
 * commerce.service.ts) over the invoice's rows (`rows`, the payment included): what is left of it after the refund
 * rows linked to it (reference = its providerPaymentId, or, from its provider, its own reference) and after the
 * same-provider refund rows that link to no payment, never more than the invoice has received net (`netReceived`, the
 * server's paidAmount). 0 when nothing is left. Whole cents. The server reads this again under its lock: the refund it
 * answers is the amount that was refunded.
 */
export function manualRefundableAmount(
  payment: { amount: number | string; provider: string; providerPaymentId: string; reference?: string | null },
  rows: ReadonlyArray<{ amount: number | string; status: string; provider: string; providerPaymentId: string; reference?: string | null }>,
  netReceived: number,
): number {
  const cents = (n: number | string) => Math.round(Number(n) * 100);
  type Row = (typeof rows)[number];
  const isRefundRow = (r: Row) => r.status === "REFUNDED" && cents(r.amount) < 0;
  const linksTo = (refund: Row, original: { provider: string; providerPaymentId: string; reference?: string | null }) =>
    !!refund.reference &&
    (refund.reference === original.providerPaymentId || (refund.provider === original.provider && refund.reference === original.reference));
  const refunds = rows.filter(isRefundRow);
  const originals = rows.filter((r) => !isRefundRow(r));
  const linked = refunds.filter((r) => linksTo(r, payment)).reduce((sum, r) => sum + Math.abs(cents(r.amount)), 0);
  const unmatched = refunds
    .filter((r) => r.provider === payment.provider && !originals.some((o) => linksTo(r, o)))
    .reduce((sum, r) => sum + Math.abs(cents(r.amount)), 0);
  const left = Math.min(cents(payment.amount) - linked - unmatched, Number.isFinite(netReceived) ? cents(netReceived) : Infinity);
  return left > 0 ? left / 100 : 0;
}
