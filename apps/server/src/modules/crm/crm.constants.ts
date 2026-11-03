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
