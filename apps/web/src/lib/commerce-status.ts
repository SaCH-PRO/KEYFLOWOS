/**
 * Typed invoice status values.
 * Use these instead of magic strings to prevent runtime typos.
 */
export const InvoiceStatus = {
  DRAFT: "DRAFT",
  PENDING: "PENDING",
  SENT: "SENT",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  VOID: "VOID",
} as const;

export type InvoiceStatusValue = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

/**
 * The web's single canonical set of invoice statuses whose remaining balance
 * counts as owed (owner ruling D-256). Mirrors the server's
 * OPEN_RECEIVABLE_STATUSES (commerce-stats.service.ts) less PARTIALLY_CREDITED,
 * which invoice list rows cannot net because they carry no credit-note rows.
 */
export const OWED_STATUSES: ReadonlySet<string> = new Set([
  InvoiceStatus.PENDING,
  InvoiceStatus.SENT,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PARTIALLY_PAID,
]);

/**
 * Invoice statuses eligible for a payment reminder (D-256 / D-260).
 * DRAFT and PENDING were never issued (the public link in a reminder email
 * would be dead); PAID, VOID, FULLY_CREDITED, PARTIALLY_CREDITED, and FAILED
 * are never reminded.
 */
export const REMINDABLE_STATUSES: ReadonlySet<string> = new Set([
  InvoiceStatus.SENT,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PARTIALLY_PAID,
]);

/**
 * Check if an invoice may receive a payment reminder.
 */
export function canRemindInvoice(status: string | null | undefined): boolean {
  return !!status && REMINDABLE_STATUSES.has(status);
}

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
 * Check if an invoice is considered "open" / owed (PENDING, SENT, OVERDUE, or PARTIALLY_PAID).
 */
export function isInvoiceOpen(status: string): boolean {
  return OWED_STATUSES.has(status);
}

/**
 * Check if a quote is still pending client response.
 */
export function isQuotePending(status: string): boolean {
  return status === QuoteStatus.SENT;
}
