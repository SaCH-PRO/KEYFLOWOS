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
 * Columns only a person ROW carries (a Contact's derived and CRM columns, a User's identity columns): a
 * row with any of them is delivered as the person view wherever it sits, whatever its key.
 *
 * Round 2 repair (WHP-3): a name is not a marker. firstName and lastName also name the recipient in the
 * event record's own JSON columns (a store order's shippingAddress and billingAddress, its metadata),
 * which the round 1 rule reduced to { firstName, lastName }: a fulfilment receiver lost the street,
 * city and phone the storefront-read routes show its subscriber. Those columns are the record's own and
 * are delivered as read; a person row is told by the columns no address or JSON blob carries.
 */
const PERSON_ROW_MARKERS = [
  'emailNormalized', 'phoneNormalized', 'visibility', 'notesInternal', 'lifetimeValue', 'averageSpend',
  'paymentReliability', 'riskFlags', 'leadScore', 'passwordHash', 'supabaseId', 'supabaseUserId',
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

/**
 * SWEEP-P0-FOLLOWUP (round 3 recheck WH3-2): the projector is generic over the shapes a payload can take.
 *   - A key that names a person (its last word: contact, customer, client, lead, owner, member, user, staff, attendee,
 *     guest, recipient, sender, author, assignee, person, buyer, payer, ...; customerContact, customer_snapshot,
 *     primaryAttendee) holds a person row whatever columns were selected: a contact read with a narrow select under a
 *     renamed key carried its phone, address, company and custom fields whole.
 *   - A key whose last word names a row of another module (invoice, payment, quote, receipt, booking, order,
 *     shipment, deal, project, task, expense, campaign, post: depositPayment, settlementInvoice) is that module's
 *     row, as RELATION_MODULES' exact keys are.
 *   - snake_case keys are read as their camelCase twins (lifetime_value, email_normalized, first_name).
 *   - The payload is read as it serialises (JSON) before it is projected: a class instance, a Buffer-like value or an
 *     object whose toJSON answers a row is that row, and the rules apply to it (they were returned whole, and
 *     NEVER_DELIVERED did not apply inside them).
 */
const PERSON_WORDS = new Set([
  'contact', 'customer', 'client', 'lead', 'owner', 'member', 'user', 'staff', 'attendee', 'guest', 'recipient', 'sender',
  'author', 'assignee', 'person', 'people', 'buyer', 'payer', 'referrer', 'requester', 'approver', 'subscriber', 'employee',
]);
const RELATION_WORDS: Readonly<Record<string, CanonicalModule>> = {
  invoice: 'revenue', payment: 'revenue', quote: 'revenue', receipt: 'revenue', refund: 'revenue', creditnote: 'revenue', paymentlink: 'revenue',
  booking: 'bookings', appointment: 'bookings',
  order: 'storefront', shipment: 'storefront',
  deal: 'crm', opportunity: 'crm',
  project: 'projects', task: 'projects', timeentry: 'projects',
  post: 'content', campaign: 'content',
  expense: 'expenses', bill: 'expenses',
};
/** A key's words, lower case: camelCase and snake_case split (customerContact -> customer, contact). */
const wordsOf = (key: string): string[] => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const singular = (word: string) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
/** The camelCase twin of a key (first_name -> firstName), so snake_case copies are read by the same rules. */
const camelOf = (key: string) => key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
/** Last words that say the key holds a copy of the row its other words name (customer_snapshot, contactRecord). */
const ROW_WORDS = new Set(['snapshot', 'row', 'record', 'data', 'info', 'details', 'detail', 'profile', 'copy', 'json']);
/**
 * A key that names a person: an exact person key, one whose last word names one (customerContact, primaryAttendee),
 * or one that names a person and says it holds its row (customer_snapshot). A key that only starts with a person word
 * (leadForm, contactPreferences) is not one.
 */
const isPersonKey = (key: string) => {
  if (WEBHOOK_PERSON_KEYS.has(key) || WEBHOOK_PERSON_KEYS.has(camelOf(key))) return true;
  const words = wordsOf(key).map(singular);
  const last = words[words.length - 1] ?? '';
  return PERSON_WORDS.has(last) || (ROW_WORDS.has(last) && words.slice(0, -1).some((w) => PERSON_WORDS.has(w)));
};
/** The module a key's row belongs to: an exact relation key, or the module its last word names (depositPayment). */
const relationModuleOf = (key: string): CanonicalModule | undefined => {
  if (Object.prototype.hasOwnProperty.call(RELATION_MODULES, key)) return RELATION_MODULES[key];
  const words = wordsOf(key);
  const last = words.length ? singular(words[words.length - 1]) : '';
  const lastTwo = words.length > 1 ? singular(`${words[words.length - 2]}${words[words.length - 1]}`) : '';
  return RELATION_WORDS[lastTwo] ?? RELATION_WORDS[last];
};

/** The payload as it is delivered: its JSON form (class instances and toJSON values read as what they serialise to). */
function asDelivered(data: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));
  } catch {
    return {};
  }
}

const MAX_DEPTH = 12;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isPersonRow = (row: Record<string, unknown>) =>
  Object.keys(row).some((key) => PERSON_ROW_MARKERS.includes(key) || PERSON_ROW_MARKERS.includes(camelOf(key)));

/** A person row as every subscriber may read it: the view's fields it has, as plain values. */
export function webhookPersonView(row: unknown): Record<string, unknown> | null {
  if (!isPlainObject(row)) return null;
  const out: Record<string, unknown> = {};
  for (const key of WEBHOOK_PERSON_VIEW) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  // SWEEP-P0-FOLLOWUP (WH3-2): a snake_case person row (first_name, last_name) is viewed by its camelCase fields.
  for (const [key, value] of Object.entries(row)) {
    const twin = camelOf(key);
    if (twin === key || !(WEBHOOK_PERSON_VIEW as readonly string[]).includes(twin) || twin in out) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[twin] = value;
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
    if (NEVER_DELIVERED.test(key) || NEVER_DELIVERED.test(camelOf(key))) continue;
    let shown: unknown;
    const related = relationModuleOf(key);
    if (isPersonKey(key) && child !== null && typeof child === 'object') {
      // a person row as the view; an id or name the row refers to a person by is delivered as it is
      const person = (v: unknown) => (isPlainObject(v) ? webhookPersonView(v) : v !== null && typeof v === 'object' ? undefined : v);
      shown = Array.isArray(child) ? child.map(person).filter((v) => v !== undefined) : person(child);
    } else if (related && !reads.has(related) && child && typeof child === 'object') {
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
  return (project(asDelivered(data), reads, 0) as Record<string, unknown> | undefined) ?? {};
}
