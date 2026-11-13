import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import { webhookEventReads } from './webhook-events';

/**
 * SWEEP-P0-SCOPES round 1 class repair (CLASS A; finding RC-1): what an outbound webhook delivers,
 * worked out at the one door every delivery goes through (WebhookDispatcherService.dispatch), for
 * every family, recursively over the whole payload.
 *
 * The reviews found the class one family at a time. SV-1: booking.* delivered the booking's whole
 * Contact row; the repair projected booking.* only. RC-1: invoice.* still delivered it, because
 * InvoiceWorkflowService reads the invoice with include { contact: true, booking: true } and the
 * dispatcher passed payload.invoice through as read: a revenue-read subscriber with crm none
 * received a PRIVATE contact's visibility, owner, internal note and money signals (D-100), which the
 * invoice routes answer as { firstName, lastName, email }. A per-family fix leaves the next family
 * (and the next include) open, so the rule is the payload's, not the family's:
 *
 *   - a person row (a Contact, a member, a staff member: under a person key such as contact,
 *     customer, client, lead, owner, member, user, staff or author, or any row that carries a
 *     Contact's or a User's own columns) is delivered as the fixed person view below, the fields
 *     every subscriber of every family may read (the invoice routes withhold the phone, the CRM
 *     fields and the money signals from revenue readers);
 *   - a row of another module (a booking inside an invoice, an invoice or payments inside a
 *     booking) is delivered as its id only, unless the event's reads cover that module
 *     (webhook-events.ts: the subscriber was checked for them at create and re-enable);
 *   - a key that names a credential (password, secret, token, API key, credentials, an encrypted
 *     value) or a contact's private field is never delivered, at any depth.
 * Everything else, the event's own record with its own columns and lines, is delivered as read.
 */

/** The fields a person row is delivered with: its id and name, and its email (what every family's subscriber may read). */
export const WEBHOOK_PERSON_VIEW = ['id', 'firstName', 'lastName', 'name', 'email'] as const;

/** Keys whose value is a person row (or a list of them). */
export const WEBHOOK_PERSON_KEYS: ReadonlySet<string> = new Set([
  'contact', 'contacts', 'customer', 'customers', 'client', 'clients', 'lead', 'leads',
  'owner', 'owners', 'member', 'members', 'user', 'users', 'staff', 'staffMember', 'assignee', 'assignees', 'assignedTo',
  'author', 'createdBy', 'updatedBy', 'recordedBy', 'approver', 'requester', 'actor', 'sender', 'recipient', 'recipients',
  'attendee', 'attendees', 'guest', 'guests', 'referrer', 'referredBy', 'primaryContact', 'duplicate', 'mergedContact', 'mergedInto',
]);

/**
 * Columns only a person row carries (a Contact's identity and CRM columns, a User's credentials): a row
 * with any of them is delivered as the person view wherever it sits, whatever its key.
 */
const PERSON_ROW_MARKERS = [
  'firstName', 'lastName', 'emailNormalized', 'phoneNormalized', 'visibility', 'notesInternal', 'lifetimeValue',
  'averageSpend', 'paymentReliability', 'riskFlags', 'leadScore', 'passwordHash', 'supabaseId', 'supabaseUserId',
];

/** A credential, or a contact's private CRM field or money signal (D-100): never delivered, at any depth. */
const NEVER_DELIVERED =
  /^(.*(password|secret|token|api_?key|credential|encrypted).*|visibility|ownerId|notesInternal|lifetimeValue|averageSpend|paymentReliability|riskFlags|opportunities|leadScore|conversionProbability|sentimentScore|referralLikelihood|responsivenessScore|nextBestAction|followUpPriority|relationshipHealth|dataQualityScore)$/i;

/** Keys whose value is a row (or rows) of another module, and that module. */
const RELATION_MODULES: Readonly<Record<string, CanonicalModule>> = {
  invoice: 'revenue', invoices: 'revenue', depositInvoice: 'revenue', recurringInvoice: 'revenue',
  payment: 'revenue', payments: 'revenue', paymentLinks: 'revenue', creditNotes: 'revenue', receipts: 'revenue',
  quote: 'revenue', quotes: 'revenue',
  booking: 'bookings', bookings: 'bookings', depositForBooking: 'bookings',
  order: 'storefront', orders: 'storefront', shipments: 'storefront', fulfillmentRoutes: 'storefront',
  deal: 'crm', deals: 'crm', account: 'crm',
  project: 'projects', projects: 'projects', task: 'projects', tasks: 'projects', timeEntries: 'projects',
  post: 'content', campaign: 'content',
  expense: 'expenses', expenses: 'expenses',
};

const MAX_DEPTH = 12;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isPersonRow = (row: Record<string, unknown>) => PERSON_ROW_MARKERS.some((key) => Object.prototype.hasOwnProperty.call(row, key));

/** A person row as every subscriber may read it: the view's fields it has, as plain values. */
export function webhookPersonView(row: unknown): Record<string, unknown> | null {
  if (!isPlainObject(row)) return null;
  const out: Record<string, unknown> = {};
  for (const key of WEBHOOK_PERSON_VIEW) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}

/** A row of a module the subscriber was not checked for: its id only. */
const reference = (row: unknown): unknown => (isPlainObject(row) ? { id: row.id ?? null } : row === null ? null : undefined);

function project(value: unknown, reads: ReadonlySet<string>, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((v) => project(v, reads, depth + 1)).filter((v) => v !== undefined);
  // Dates, Decimals and other values that serialise themselves are delivered as they serialise.
  if (!isPlainObject(value)) return value;
  if (isPersonRow(value)) return webhookPersonView(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (NEVER_DELIVERED.test(key)) continue;
    let shown: unknown;
    if (WEBHOOK_PERSON_KEYS.has(key)) {
      // a person row as the view; an id or name the row refers to a person by is delivered as it is
      const person = (v: unknown) => (isPlainObject(v) ? webhookPersonView(v) : v !== null && typeof v === 'object' ? undefined : v);
      shown = Array.isArray(child) ? child.map(person).filter((v) => v !== undefined) : person(child);
    } else if (Object.prototype.hasOwnProperty.call(RELATION_MODULES, key) && !reads.has(RELATION_MODULES[key]) && child && typeof child === 'object') {
      shown = Array.isArray(child) ? child.map(reference).filter((v) => v !== undefined) : reference(child);
    } else {
      shown = project(child, reads, depth + 1);
    }
    if (shown !== undefined) out[key] = shown;
  }
  return out;
}

/**
 * The data a webhook delivers for `event`: the payload projected as above, with the modules the
 * event's subscriber was checked for (webhookEventReads) read whole.
 */
export function projectWebhookPayload(event: string, data: Record<string, unknown>): Record<string, unknown> {
  const reads = new Set<string>(webhookEventReads(event) ?? []);
  return (project(data, reads, 0) as Record<string, unknown> | undefined) ?? {};
}
