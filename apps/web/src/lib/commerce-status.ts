import { invoiceBalanceOfStoredRows } from "@keyflow/shared";

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
 * Safely coerce an invoice amount to a finite number (defaults to 0 on null/undefined/NaN).
 */
export function safeInvoiceAmount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Remaining balance owed on an invoice in major currency units, net of stored
 * payments and refunds via @keyflow/shared's invoiceBalanceOfStoredRows.
 * Returns 0 for any status outside OWED_STATUSES and guards NaN/undefined totals.
 */
export function invoiceRemainingOwed(inv: {
  status?: string | null;
  total?: number | string | null;
  currency?: string | null;
  payments?: ReadonlyArray<{ amount?: number | string | null; status?: string | null }> | null;
}): number {
  if (!inv.status || !OWED_STATUSES.has(inv.status)) return 0;
  const total = safeInvoiceAmount(inv.total);
  const { remaining } = invoiceBalanceOfStoredRows(
    total,
    (inv.payments ?? []) as Parameters<typeof invoiceBalanceOfStoredRows>[1],
    inv.currency ?? undefined,
  );
  return Math.max(0, Math.min(total, remaining));
}

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

/**
 * SWP-INV-DETAIL (BUG-086, review S-1 / MINOR-1): the invoices Mark paid is offered on, wherever an invoice is
 * opened or listed as a document (its detail page and the Invoices list's row menu): where a payment can be
 * recorded. Mark paid records the balance as a payment (R0-PL-04), which the server refuses (409) on a DRAFT.
 */
export const MARK_PAID_STATUSES: ReadonlySet<string> = new Set([
  InvoiceStatus.SENT,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PARTIALLY_PAID,
]);

export function canMarkInvoicePaid(status: string | null | undefined): boolean {
  return typeof status === "string" && MARK_PAID_STATUSES.has(status);
}

/**
 * SWP-INV-DETAIL (BUG-086): the statuses the commerce Payments tab never offers Mark Paid on (row or bulk): the
 * server refuses DRAFT, VOID and FULLY_CREDITED (409), and a PAID invoice has nothing to mark. The tab is wider
 * than MARK_PAID_STATUSES on purpose: its merged pins settle PARTIALLY_CREDITED and FAILED rows by Mark paid
 * (payments/__tests__/collections-health.test.tsx CH-11, CH-11b) and a past-due PENDING one from the Recovery Queue
 * (CH-32, owner ruling D-256).
 */
export const PAYMENTS_TAB_MARK_PAID_REFUSED: ReadonlySet<string> = new Set(["DRAFT", "VOID", "FULLY_CREDITED", "PAID"]);

export function canMarkPaidOnPaymentsTab(status: string | null | undefined): boolean {
  return typeof status === "string" && !PAYMENTS_TAB_MARK_PAID_REFUSED.has(status);
}
