import type { CanonicalModule } from '../../core/authority/module-vocabulary';

/**
 * SWEEP-P0-SCOPES review repair (finding SEC-2): the module whose records each webhook event
 * carries, by the event's family (the part before the first dot). A webhook delivers full rows:
 * invoices (total, customer email) for invoice.*, contact rows (email, phone) for contact.*,
 * bookings with their contact for booking.*, store orders for store_order.* (WebhookDispatcherService).
 * So the member who subscribes a URL to an event must be able to read that module themselves
 * (D-114: an explicit map binds an ADMIN too; D-100: no money signals without revenue read).
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
