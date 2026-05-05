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

/**
 * Per-business configurable thresholds (in days) used by the
 * relationship-health auto-warning scheduler.
 */
export interface RelationshipHealthThresholds {
  /** ≤ this many days since last contact ⇒ HOT */
  hot: number;
  /** ≤ this many days ⇒ WARM */
  warm: number;
  /** ≤ this many days ⇒ COLD; beyond ⇒ DORMANT */
  cold: number;
  /** A CLIENT with at least this many days since last contact is flagged AT_RISK */
  atRiskClientDays: number;
}

export const DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS: RelationshipHealthThresholds = {
  hot: 14,
  warm: 45,
  cold: 90,
  atRiskClientDays: 60,
};

export function normalizeRelationshipHealthThresholds(
  input?: Partial<RelationshipHealthThresholds> | null,
): RelationshipHealthThresholds {
  const merged = { ...DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS, ...(input ?? {}) };
  const clean = (n: unknown, fallback: number) => {
    const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    return v;
  };
  let hot = clean(merged.hot, DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS.hot);
  let warm = clean(merged.warm, DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS.warm);
  let cold = clean(merged.cold, DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS.cold);
  const atRiskClientDays = clean(
    merged.atRiskClientDays,
    DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS.atRiskClientDays,
  );
  // ensure strict ordering hot < warm < cold
  if (warm <= hot) warm = hot + 1;
  if (cold <= warm) cold = warm + 1;
  return { hot, warm, cold, atRiskClientDays };
}

/**
 * Pure function used by both the scheduler and tests.
 * Given the days since last contact (or `null` if never contacted) and the
 * contact's CRM `status`, returns the auto-computed relationship health value.
 *
 * Returns `null` when there isn't enough information to decide (e.g. brand-new
 * contact created today with no recorded interactions).
 */
export function computeRelationshipHealth(
  daysSinceLastContact: number | null,
  status: string | null | undefined,
  thresholds: RelationshipHealthThresholds = DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS,
): ContactRelationshipHealth | null {
  if (daysSinceLastContact === null || daysSinceLastContact === undefined) return null;
  const days = Math.max(0, Math.floor(daysSinceLastContact));

  // Active clients (paying customers) are flagged AT_RISK before becoming
  // simply "DORMANT" so the dashboard can surface them as actionable items.
  const isActiveClient = status === 'CLIENT';
  if (isActiveClient && days >= thresholds.atRiskClientDays) {
    return 'AT_RISK';
  }

  if (days <= thresholds.hot) return 'HOT';
  if (days <= thresholds.warm) return 'WARM';
  if (days <= thresholds.cold) return 'COLD';
  return 'DORMANT';
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
