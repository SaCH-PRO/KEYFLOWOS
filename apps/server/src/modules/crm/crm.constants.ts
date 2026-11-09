/**
 * The one Contact.status vocabulary: what the CRM create/update DTOs admit.
 * contact-status-vocabulary.spec.ts holds every writer to it (CF-49).
 */
export const CONTACT_STATUSES = ['LEAD', 'PROSPECT', 'CLIENT', 'LOST'] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

export function isContactStatus(value: unknown): value is ContactStatus {
  return typeof value === 'string' && (CONTACT_STATUSES as readonly string[]).includes(value);
}

/**
 * V1-38c (CF-49, V1-38b residuals): the one legacy spelling of a ContactStatus,
 * and the predicate the status readers (lead scoring, the people health score,
 * people-flow relationship health, the maturity assessment) count a customer
 * by. The Shopify adapter wrote CUSTOMER for a buyer before V1-38, and the
 * CSV/link import (crm-import.service.ts) copied a file's status column
 * verbatim until V1-38c, so rows may hold it. No writer produces it now (the
 * import stores CLIENT for it: canonicalContactStatus below), but a row that
 * holds it counts as CLIENT while any row does.
 */
export const CLIENT_STATUS: ContactStatus = 'CLIENT';
export const LEGACY_CLIENT_STATUS = 'CUSTOMER';

export function isClientStatus(status: string | null | undefined): boolean {
  return status === CLIENT_STATUS || status === LEGACY_CLIENT_STATUS;
}

/**
 * V1-38c: the ContactStatus a value written from outside the CRM DTOs reads
 * as (the CSV/link import's status, stage or pipeline_stage column). A
 * ContactStatus in any case or padding is that status, and the legacy CLIENT
 * spelling is CLIENT, the mapping isClientStatus reads rows by. Anything else
 * is null: DORMANT (dormancy is a relationshipHealth value, CF-49), INACTIVE
 * and any other word have no ContactStatus, and the caller treats the value as
 * it treats any cell it does not recognise.
 */
export function canonicalContactStatus(value: string | null | undefined): ContactStatus | null {
  if (typeof value !== 'string') return null;
  const spelled = value.trim().toUpperCase();
  if (isContactStatus(spelled)) return spelled;
  return spelled === LEGACY_CLIENT_STATUS ? CLIENT_STATUS : null;
}

/**
 * The status an external store adapter gives a contact it CREATES: a customer
 * with orders is a CLIENT, one without is a LEAD. An adapter never overwrites
 * the status of a contact that already exists; that status is the business's.
 */
export function contactStatusForExternalCustomer(ordersCount: number | null | undefined): ContactStatus {
  return (ordersCount ?? 0) > 0 ? 'CLIENT' : 'LEAD';
}

export {
  CONTACT_AGE_GROUPS,
  CONTACT_AGE_GROUP_LABELS,
  getContactAgeGroupLabel,
  type ContactAgeGroup,
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_RELATIONSHIP_TYPE_LABELS,
  getContactRelationshipTypeLabel,
  type ContactRelationshipType,
  CONTACT_RELATIONSHIP_HEALTH_VALUES,
  CONTACT_RELATIONSHIP_HEALTH_LABELS,
  getContactRelationshipHealthLabel,
  type ContactRelationshipHealth,
  CONTACT_PRIORITIES,
  CONTACT_PRIORITY_LABELS,
  getContactPriorityLabel,
  type ContactPriority,
  CONTACT_NEXT_ACTION_TYPES,
  CONTACT_NEXT_ACTION_TYPE_LABELS,
  getContactNextActionTypeLabel,
  type ContactNextActionType,
} from '@keyflow/shared';
export const BULK_LIMIT = 500;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export const TASK_STATUS = {
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = typeof TASK_STATUS[keyof typeof TASK_STATUS];

export const TASK_PRIORITY = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type TaskPriority = typeof TASK_PRIORITY[keyof typeof TASK_PRIORITY];
