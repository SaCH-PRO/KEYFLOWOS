/**
 * Typed invoice status values.
 * Use these instead of magic strings to prevent runtime typos.
 */
export const InvoiceStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  VOID: "VOID",
} as const;

export type InvoiceStatusValue = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

/**
 * Typed quote status values.
 */
export const QuoteStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
} as const;

export type QuoteStatusValue = (typeof QuoteStatus)[keyof typeof QuoteStatus];

/**
 * Check if an invoice is in a "paid" state (fully or partially).
 */
export function isInvoicePaid(status: string): boolean {
  return status === InvoiceStatus.PAID || status === InvoiceStatus.PARTIALLY_PAID;
}

/**
 * Check if an invoice is considered "open" (sent or overdue).
 */
export function isInvoiceOpen(status: string): boolean {
  return status === InvoiceStatus.SENT || status === InvoiceStatus.OVERDUE;
}

/**
 * Check if a quote is still pending client response.
 */
export function isQuotePending(status: string): boolean {
  return status === QuoteStatus.SENT;
}

/**
 * FU-WEB-PAYLINK-STATUS-BUTTONS (D-256, D-248): invoice statuses for which the
 * server will issue or share a customer payment link
 * (`CommerceService.INTENT_PAYABLE_STATUSES`). Non-payable states (DRAFT,
 * PENDING, PAID, VOID, FAILED, FULLY_CREDITED) are refused by the server, so
 * the UI must hide "Copy payment link" and "Share via WhatsApp" for them.
 */
export const PAYLINK_SHAREABLE_STATUSES: ReadonlySet<string> = new Set([
  "SENT",
  "OVERDUE",
  "PARTIALLY_PAID",
  "PARTIALLY_CREDITED",
]);

export function canShareInvoicePayLink(status: string | null | undefined): boolean {
  return typeof status === "string" && PAYLINK_SHAREABLE_STATUSES.has(status);
}
