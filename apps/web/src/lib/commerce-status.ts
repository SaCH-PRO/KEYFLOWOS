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
