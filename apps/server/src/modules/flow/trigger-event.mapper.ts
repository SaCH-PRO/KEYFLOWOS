/**
 * Maps Flow Studio trigger node `data.triggerType` values to the canonical
 * event-bus names used by `AutomationExecutorService.executeFlows()`.
 *
 * Flow Studio templates historically store `triggerType` (snake_case), while
 * the cross-module automation executor fires dot-notation events. This mapper
 * bridges the two without requiring a template re-seed.
 */

const TRIGGER_TYPE_TO_EVENT: Record<string, string> = {
  missed_call: 'call.missed',
  new_message: 'inbound_message',
  invoice_overdue: 'invoice.overdue',
  quote_viewed: 'quote.sent',
  device_capture_created: 'asset.created',
  booking_completed: 'booking.confirmed',
};

export function mapTriggerTypeToEvent(triggerType: string | undefined): string {
  if (!triggerType) return '';
  return TRIGGER_TYPE_TO_EVENT[triggerType] ?? triggerType;
}
