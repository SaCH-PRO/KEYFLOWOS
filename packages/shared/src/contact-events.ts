export const CONTACT_EVENT_CATEGORIES = [
  'communication',
  'crm_movement',
  'sales_revenue',
  'delivery_operations',
  'relationship_leverage',
  'ai_system',
] as const;

export type ContactEventCategory = (typeof CONTACT_EVENT_CATEGORIES)[number];

export const CONTACT_EVENT_TYPES_BY_CATEGORY = {
  communication: [
    'communication.call',
    'communication.email',
    'communication.whatsapp',
    'communication.sms',
    'communication.meeting',
    'email.sent',
    'whatsapp.sent',
    'sms.sent',
    'message.copied',
  ],
  crm_movement: [
    'contact.created',
    'contact.updated',
    'contact.deleted',
    'contact.merged',
    'contact.merge_reverted',
    'contact.imported',
    'contact.imported_from_media',
    'status.changed',
    'relationship_health.changed',
    'bulk.updated',
    'note.created',
    'note.updated',
    'note.deleted',
    'task.created',
    'task.updated',
    'task.completed',
    'task.reopened',
    'task.deleted',
    'action.completed',
    'next_action.completed',
    'next_action.snoozed',
  ],
  sales_revenue: [
    'quote.created',
    'quote.sent',
    'quote.accepted',
    'quote.rejected',
    'invoice.created',
    'invoice.sent',
    'invoice.overdue',
    'invoice.paid',
    'invoice.void',
    'invoice.payment_failed',
    'invoice.payment_recorded',
  ],
  delivery_operations: [
    'booking.created',
    'booking.confirmed',
    'booking.completed',
    'booking.cancelled',
    'booking.rescheduled',
    'booking.status.followup',
    'store_order.created',
    'store_order.paid',
    'store_order.shipped',
    'store_order.delivered',
    'store_order.cancelled',
    'store_order.refunded',
  ],
  relationship_leverage: [
    'campaign.sent',
    'campaign.opened',
    'form.submitted',
    'lead_form.submitted',
    'followup.scheduled',
    'sequence.enrolled',
    'sequence.unenrolled',
    'sequence.step.due',
    'sequence.step.advanced',
    'sequence.step.failed',
    'sequence.step.retry',
  ],
  ai_system: [
    'automation.action',
    'automation.run',
    'automation.executed',
    'autopilot.approved',
    'autopilot.denied',
    'autopilot.executed',
    'autopilot.payment_recovery',
    'autopilot.lead_reactivation',
  ],
} as const satisfies Record<ContactEventCategory, readonly string[]>;

export const CONTACT_EVENT_TYPES = [
  ...CONTACT_EVENT_TYPES_BY_CATEGORY.communication,
  ...CONTACT_EVENT_TYPES_BY_CATEGORY.crm_movement,
  ...CONTACT_EVENT_TYPES_BY_CATEGORY.sales_revenue,
  ...CONTACT_EVENT_TYPES_BY_CATEGORY.delivery_operations,
  ...CONTACT_EVENT_TYPES_BY_CATEGORY.relationship_leverage,
  ...CONTACT_EVENT_TYPES_BY_CATEGORY.ai_system,
] as const;

export type ContactEventType = (typeof CONTACT_EVENT_TYPES)[number];

const CANONICAL_SET = new Set<string>(CONTACT_EVENT_TYPES);

export const CONTACT_EVENT_LEGACY_ALIASES: Record<string, ContactEventType> = {
  TASK_COMPLETED: 'task.completed',
  ACTION_COMPLETED: 'action.completed',
  STATUS_CHANGED: 'status.changed',
  'note.added': 'note.created',
  sequence_enrolled: 'sequence.enrolled',
  sequence_unenrolled: 'sequence.unenrolled',
  sequence_step_due: 'sequence.step.due',
  sequence_step_advanced: 'sequence.step.advanced',
  sequence_step_failed: 'sequence.step.failed',
  sequence_step_retry: 'sequence.step.retry',
  'call.logged': 'communication.call',
  'email.logged': 'communication.email',
  'whatsapp.logged': 'communication.whatsapp',
  'sms.logged': 'communication.sms',
  'meeting.logged': 'communication.meeting',
  DUPLICATE_MERGED: 'contact.merged',
  DUPLICATE_MERGE_REVERTED: 'contact.merge_reverted',
  'duplicate.merged': 'contact.merged',
  'duplicate.merge_reverted': 'contact.merge_reverted',
};

export function isCanonicalContactEventType(value: string): value is ContactEventType {
  return CANONICAL_SET.has(value);
}

export type NormalizedContactEvent = {
  canonical: ContactEventType | null;
  original: string;
  isLegacy: boolean;
  wasAliased: boolean;
};

export function normalizeContactEventType(input: string): NormalizedContactEvent {
  const original = input;
  if (CANONICAL_SET.has(input)) {
    return { canonical: input as ContactEventType, original, isLegacy: false, wasAliased: false };
  }
  const aliased = CONTACT_EVENT_LEGACY_ALIASES[input];
  if (aliased) {
    return { canonical: aliased, original, isLegacy: false, wasAliased: true };
  }
  return { canonical: null, original, isLegacy: true, wasAliased: false };
}

/**
 * Named-constant accessor so emitters import canonical strings instead of
 * sprinkling literals across the codebase. Keys mirror the canonical value
 * (uppercase, dots → underscores) for ergonomic IDE autocomplete.
 */
export const CONTACT_EVENT = Object.freeze(
  CONTACT_EVENT_TYPES.reduce(
    (acc, value) => {
      const key = value.toUpperCase().replace(/\./g, '_');
      acc[key] = value;
      return acc;
    },
    {} as Record<string, ContactEventType>,
  ),
) as Readonly<Record<string, ContactEventType>>;

export const CONTACT_EVENT_LABELS: Record<ContactEventType, string> = {
  'communication.call': 'Call logged',
  'communication.email': 'Email logged',
  'communication.whatsapp': 'WhatsApp logged',
  'communication.sms': 'SMS logged',
  'communication.meeting': 'Meeting logged',
  'email.sent': 'Email sent',
  'whatsapp.sent': 'WhatsApp sent',
  'sms.sent': 'SMS sent',
  'message.copied': 'Message copied',
  'contact.created': 'Contact created',
  'contact.updated': 'Contact updated',
  'contact.deleted': 'Contact deleted',
  'contact.merged': 'Contacts merged',
  'contact.merge_reverted': 'Merge reverted',
  'contact.imported': 'Contact imported',
  'contact.imported_from_media': 'Imported from media',
  'status.changed': 'Status changed',
  'bulk.updated': 'Bulk updated',
  'note.created': 'Note added',
  'note.updated': 'Note updated',
  'note.deleted': 'Note deleted',
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.completed': 'Task completed',
  'task.reopened': 'Task reopened',
  'task.deleted': 'Task deleted',
  'action.completed': 'Action completed',
  'next_action.completed': 'Next action completed',
  'next_action.snoozed': 'Next action snoozed',
  'quote.created': 'Quote created',
  'quote.sent': 'Quote sent',
  'quote.accepted': 'Quote accepted',
  'quote.rejected': 'Quote rejected',
  'invoice.created': 'Invoice created',
  'invoice.sent': 'Invoice sent',
  'invoice.overdue': 'Invoice overdue',
  'invoice.paid': 'Invoice paid',
  'invoice.void': 'Invoice voided',
  'invoice.payment_failed': 'Payment failed',
  'invoice.payment_recorded': 'Payment recorded',
  'booking.created': 'Booking created',
  'booking.confirmed': 'Booking confirmed',
  'booking.completed': 'Booking completed',
  'booking.cancelled': 'Booking cancelled',
  'booking.rescheduled': 'Booking rescheduled',
  'booking.status.followup': 'Booking follow-up',
  'store_order.created': 'Order placed',
  'store_order.paid': 'Order paid',
  'store_order.shipped': 'Order shipped',
  'store_order.delivered': 'Order delivered',
  'store_order.cancelled': 'Order cancelled',
  'store_order.refunded': 'Order refunded',
  'campaign.sent': 'Campaign sent',
  'campaign.opened': 'Campaign opened',
  'form.submitted': 'Form submitted',
  'lead_form.submitted': 'Lead form submitted',
  'followup.scheduled': 'Follow-up scheduled',
  'sequence.enrolled': 'Sequence enrolled',
  'sequence.unenrolled': 'Sequence unenrolled',
  'sequence.step.due': 'Sequence step due',
  'sequence.step.advanced': 'Sequence step advanced',
  'sequence.step.failed': 'Sequence step failed',
  'sequence.step.retry': 'Sequence step retry',
  'automation.action': 'Automation action',
  'automation.run': 'Automation run',
  'automation.executed': 'Automation executed',
  'autopilot.approved': 'Autopilot approved',
  'autopilot.denied': 'Autopilot denied',
  'autopilot.executed': 'Autopilot executed',
  'autopilot.payment_recovery': 'Payment recovery',
  'autopilot.lead_reactivation': 'Lead reactivation',
  'relationship_health.changed': 'Relationship health changed',
};

export function getContactEventLabel(type: string): string {
  const normalized = normalizeContactEventType(type);
  if (normalized.canonical) return CONTACT_EVENT_LABELS[normalized.canonical];
  return type;
}

export function getContactEventCategory(type: string): ContactEventCategory | null {
  for (const category of CONTACT_EVENT_CATEGORIES) {
    if ((CONTACT_EVENT_TYPES_BY_CATEGORY[category] as readonly string[]).includes(type)) {
      return category;
    }
  }
  return null;
}
