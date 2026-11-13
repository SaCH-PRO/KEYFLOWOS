import type { CanonicalModule } from '../../core/authority/module-vocabulary';

/**
 * SWEEP-P0-SCOPES review repair (finding SEC-2): the module whose records each webhook event
 * carries, by the event's family (the part before the first dot). A webhook delivers the event's
 * own record whole (an invoice with its lines for invoice.*, a booking for booking.*, a store order
 * for store_order.*, a post for post.*), so the member who subscribes a URL to an event must be able
 * to read that module themselves (D-114: an explicit map binds an ADMIN too).
 *
 * Round 1 class repair (CLASS A; RC-1): what goes out beside that record is projected at the
 * dispatcher's one door (webhook-payload.ts, projectWebhookPayload), using these same reads: every
 * person row (a contact, wherever it sits, the contact.* subject included) is the fixed person view
 * { id, firstName, lastName, email } that every family's subscriber may read; a row of a module the
 * subscriber was not checked for (a booking inside an invoice) is its id; no credential or private
 * CRM field or money signal (D-100) is delivered at any depth.
 *
 * The families the dispatcher delivers today (invoice, contact, booking, post, store_order) and the
 * ones the settings page offers that nothing delivers yet (quote, payment, lead, note, form,
 * campaign, subscriber, expense, project, task, playbook, store), each to the module that holds
 * those records. An event whose family is not here is not a webhook event (400), so a family
 * added to the dispatcher later is refused until it is mapped here.
 */
export const WEBHOOK_EVENT_FAMILY_MODULES: Readonly<Record<string, CanonicalModule>> = {
  invoice: 'revenue',
  quote: 'revenue',
  payment: 'revenue',
  contact: 'crm',
  lead: 'crm',
  note: 'crm',
  form: 'crm',
  subscriber: 'crm',
  booking: 'bookings',
  post: 'content',
  campaign: 'content',
  expense: 'expenses',
  project: 'projects',
  task: 'projects',
  playbook: 'automations',
  store: 'storefront',
  store_order: 'storefront',
};

/**
 * Second review repair (SV-1; owner ruling D-100): the further module reads a family's records
 * carry. A contact.* delivery was the stored Contact row, whose lifetimeValue, averageSpend,
 * paymentReliability, revenue risk flags and lead score are worked out from the contact's invoices:
 * the money signals GET contacts withholds from a member without revenue read (withoutStoredMoney).
 * Round 1 class repair: the delivery is now the fixed person view, which carries none of them; the
 * rule is kept as it was ruled (relaxing it is an owner question, recorded in the census).
 */
export const WEBHOOK_EVENT_FAMILY_EXTRA_READS: Readonly<Record<string, readonly CanonicalModule[]>> = {
  contact: ['revenue'],
};

/** Every module the event's records need read on (its own module first), or null for an event that is not a webhook event. */
export function webhookEventReads(event: string): CanonicalModule[] | null {
  const module = webhookEventModule(event);
  if (!module) return null;
  const family = event.slice(0, event.indexOf('.'));
  const extra = Object.prototype.hasOwnProperty.call(WEBHOOK_EVENT_FAMILY_EXTRA_READS, family) ? WEBHOOK_EVENT_FAMILY_EXTRA_READS[family] : [];
  return [module, ...extra.filter((m) => m !== module)];
}

/** The module the event's records belong to, or null for an event that is not a webhook event. */
export function webhookEventModule(event: string): CanonicalModule | null {
  const match = /^([a-z_]+)\.[a-z_]+$/.exec(event);
  if (!match) return null;
  return Object.prototype.hasOwnProperty.call(WEBHOOK_EVENT_FAMILY_MODULES, match[1]) ? WEBHOOK_EVENT_FAMILY_MODULES[match[1]] : null;
}

/**
 * SWEEP-P0-SCOPES review repair (finding SEC-3): what a settings read member is shown of a webhook's
 * receiver URL: its origin. For the common receivers (Slack incoming webhooks, Zapier and Make catch
 * hooks) the path is itself the credential, and they check no signature.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return '***';
  }
}
