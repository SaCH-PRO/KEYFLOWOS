/**
 * Raw codes in plain words (FAILURE-KIT, re-cut v1 plan step 3; product principle "One name per thing, in plain
 * words").
 *
 * Screens print stored codes as they are: "PARTIALLY_PAID" on the customer invoice page, the quote drawer and the
 * ledger (BUG-091, BUG-132, BUG-134), "Note.Created" / "Contact.Created" on the contact timeline (BUG-129),
 * "gluten_free" for a select-type custom field (BUG-127). This is the one map the screen packets adopt, so the same
 * status reads the same everywhere. The words follow what the screens already say where they say one (the invoice
 * list and detail say "Part-paid"; quotes say "Rejected"); a customer is a "Customer" (the hub is Customers).
 *
 * A select field's own option label, where the field defines one, is still the better word (SWP-CONTACT-DETAIL);
 * humanizeCode is the fallback for a value with no label.
 */

/** Statuses by their upper-snake code. Every label is plain words: no underscores, never the code itself. */
export const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  // Invoices and quotes (packages/db schema InvoiceStatus, QuoteStatus).
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  PAID: "Paid",
  PARTIALLY_PAID: "Part-paid",
  PARTIAL: "Part-paid",
  OVERDUE: "Overdue",
  VOID: "Void",
  FAILED: "Failed",
  PENDING: "Pending",
  FULLY_CREDITED: "Credited",
  PARTIALLY_CREDITED: "Part-credited",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  INVOICED: "Invoiced",
  CONVERTED: "Converted",
  // Payments, refunds and orders.
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part-refunded",
  PROCESSING: "Processing",
  FULFILLED: "Fulfilled",
  UNFULFILLED: "Not fulfilled",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  // Bookings (BookingStatus).
  CONFIRMED: "Confirmed",
  UNCONFIRMED: "Unconfirmed",
  CANCELLED: "Cancelled",
  CANCELED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  // Subscriptions (SubscriptionStatus).
  ACTIVE: "Active",
  TRIALING: "On trial",
  PAST_DUE: "Past due",
  // Tasks and deals (ProjectTaskStatus, DealStatus).
  TODO: "To do",
  IN_PROGRESS: "In progress",
  REVIEW: "In review",
  DONE: "Done",
  BLOCKED: "Blocked",
  OPEN: "Open",
  WON: "Won",
  LOST: "Lost",
});

/** What an event's subject is called on screen, where the code names it differently. */
const EVENT_SUBJECTS: Readonly<Record<string, string>> = Object.freeze({
  contact: "Customer",
  contacts: "Customer",
});

/** How an event's action is said, where the plain word differs from the code. */
const EVENT_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  created: "added",
  added: "added",
});

function blank(code: string | null | undefined): code is null | undefined {
  return code === null || code === undefined || code.trim() === "";
}

/** The upper-snake key a code is looked up by: "partially_paid", "Partially-Paid", "PartiallyPaid" -> "PARTIALLY_PAID". */
function statusKey(code: string): string {
  return code
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

/**
 * A code with no entry, still readable: "gluten_free" -> "Gluten free", "SOME_NEW_STATE" -> "Some new state",
 * "PartiallyFailed" -> "Partially failed", "follow-up" -> "Follow-up". Words that are already plain ("Gluten free",
 * "Part-paid") are left as they are.
 */
export function humanizeCode(code: string | null | undefined): string {
  if (blank(code)) return "";
  const text = code.trim();
  // A number is not a code ("1.5" stays "1.5").
  if (/^[\d.,\s-]+$/.test(text)) return text;
  // A code: snake or dotted, all capitals, camelCase, or all lower case. A label with its own capitals is plain.
  const isCode = /[_.]/.test(text) || /^[A-Z0-9]+$/.test(text) || /[a-z][A-Z]/.test(text) || !/[A-Z]/.test(text);
  if (!isCode) return text;
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A status code in plain words: "PARTIALLY_PAID" -> "Part-paid", "NO_SHOW" -> "No-show"; an unknown code humanized. */
export function statusLabel(code: string | null | undefined): string {
  if (blank(code)) return "";
  return STATUS_LABELS[statusKey(code)] ?? humanizeCode(code);
}

/**
 * An event type in plain words, "Subject action": "Note.Created" -> "Note added", "Contact.Created" -> "Customer
 * added", "message.copied" -> "Message copied", "booking.no_show" -> "Booking no-show". A longer dotted code is read
 * by its last two parts ("crm.contact.created" -> "Customer added").
 */
export function eventLabel(type: string | null | undefined): string {
  if (blank(type)) return "";
  const parts = type.trim().split(".").filter(Boolean);
  if (parts.length < 2) return humanizeCode(type);
  const [subjectCode, actionCode] = parts.slice(-2);
  const subject = EVENT_SUBJECTS[subjectCode.toLowerCase()] ?? humanizeCode(subjectCode);
  const actionKey = actionCode.toLowerCase();
  const action = EVENT_ACTIONS[actionKey] ?? (STATUS_LABELS[statusKey(actionCode)] ?? humanizeCode(actionCode)).toLowerCase();
  return `${subject} ${action}`;
}

/** Any raw code in plain words: a dotted event type by eventLabel, anything else by statusLabel. Empty for none. */
export function plainLabel(code: string | null | undefined): string {
  if (blank(code)) return "";
  const text = code.trim();
  return /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)+$/.test(text) ? eventLabel(text) : statusLabel(text);
}
