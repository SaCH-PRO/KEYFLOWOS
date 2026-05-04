export const CONTACT_RELATIONSHIP_TYPES = [
  'LEAD',
  'PROSPECT',
  'CLIENT',
  'PAST_CLIENT',
  'SUPPLIER',
  'PARTNER',
  'INVESTOR',
  'CONTRACTOR',
  'EMPLOYEE',
  'REFERRAL_SOURCE',
  'ADVISOR',
  'MENTOR',
  'COMPETITOR',
  'MEDIA',
  'COMMUNITY',
  'OTHER',
] as const;

export type ContactRelationshipType = typeof CONTACT_RELATIONSHIP_TYPES[number];

export const CONTACT_RELATIONSHIP_TYPE_LABELS: Record<ContactRelationshipType, string> = {
  LEAD: 'Lead',
  PROSPECT: 'Prospect',
  CLIENT: 'Client',
  PAST_CLIENT: 'Past Client',
  SUPPLIER: 'Supplier',
  PARTNER: 'Partner',
  INVESTOR: 'Investor',
  CONTRACTOR: 'Contractor',
  EMPLOYEE: 'Employee',
  REFERRAL_SOURCE: 'Referral Source',
  ADVISOR: 'Advisor',
  MENTOR: 'Mentor',
  COMPETITOR: 'Competitor',
  MEDIA: 'Media',
  COMMUNITY: 'Community',
  OTHER: 'Other',
};

export function getContactRelationshipTypeLabel(value?: string | null): string | null {
  if (!value) return null;
  return CONTACT_RELATIONSHIP_TYPE_LABELS[value as ContactRelationshipType] ?? value;
}

export const CONTACT_RELATIONSHIP_HEALTH_VALUES = [
  'HOT',
  'WARM',
  'COLD',
  'DORMANT',
  'AT_RISK',
] as const;

export type ContactRelationshipHealth = typeof CONTACT_RELATIONSHIP_HEALTH_VALUES[number];

export const CONTACT_RELATIONSHIP_HEALTH_LABELS: Record<ContactRelationshipHealth, string> = {
  HOT: 'Hot',
  WARM: 'Warm',
  COLD: 'Cold',
  DORMANT: 'Dormant',
  AT_RISK: 'At Risk',
};

export function getContactRelationshipHealthLabel(value?: string | null): string | null {
  if (!value) return null;
  return CONTACT_RELATIONSHIP_HEALTH_LABELS[value as ContactRelationshipHealth] ?? value;
}

export const CONTACT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type ContactPriority = typeof CONTACT_PRIORITIES[number];

export const CONTACT_PRIORITY_LABELS: Record<ContactPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export function getContactPriorityLabel(value?: string | null): string | null {
  if (!value) return null;
  return CONTACT_PRIORITY_LABELS[value as ContactPriority] ?? value;
}

export const CONTACT_NEXT_ACTION_TYPES = [
  'CALL',
  'EMAIL',
  'WHATSAPP',
  'SMS',
  'MEETING',
  'FOLLOW_UP',
  'QUOTE',
  'INVOICE',
  'CHECK_IN',
  'OTHER',
] as const;

export type ContactNextActionType = typeof CONTACT_NEXT_ACTION_TYPES[number];

export const CONTACT_NEXT_ACTION_TYPE_LABELS: Record<ContactNextActionType, string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  MEETING: 'Meeting',
  FOLLOW_UP: 'Follow-up',
  QUOTE: 'Send Quote',
  INVOICE: 'Send Invoice',
  CHECK_IN: 'Check-in',
  OTHER: 'Other',
};

export function getContactNextActionTypeLabel(value?: string | null): string | null {
  if (!value) return null;
  return CONTACT_NEXT_ACTION_TYPE_LABELS[value as ContactNextActionType] ?? value;
}
