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
 * V1-38c (CF-49, V1-38b residuals): the legacy spellings of a ContactStatus,
 * and the predicate the status readers (lead scoring, the people health score,
 * people-flow relationship health, the maturity assessment) count a customer
 * by. The Shopify adapter wrote CUSTOMER for a buyer before V1-38, and the
 * CSV/link import (crm-import.service.ts) copied a file's status column
 * verbatim until V1-38c, so rows may hold it.
 *
 * D-92 (owner ruling, W4-D92-DORMANT-AS-CLIENT): an imported (or legacy)
 * DORMANT status is stored as CLIENT, so every stored status is one of
 * CONTACT_STATUSES, and "dormant" is always worked out from inactivity (the
 * Dormant segment shows clients with no recent activity). Before D-92 the
 * CSV/link import stored a DORMANT cell as DORMANT (V1-38c review CR-V38c-1)
 * and a playbook's update_status action stored 'ACTIVE' or whatever status it
 * named (automation-executor.service.ts, review ST-38c-1). Both now store a
 * status only through canonicalContactStatus below, which reads CUSTOMER and
 * DORMANT as CLIENT. Rows are not migrated: a row that still holds either
 * spelling counts as CLIENT, and the spellings may go only once no row holds
 * them.
 *
 * CrmService.createContact, updateContact and bulkUpdateContacts store a
 * status as they are given it, so each caller outside the CRM DTOs (which
 * admit only CONTACT_STATUSES) holds the invariant itself:
 *   - through canonicalContactStatus: the CSV/link import, a playbook's
 *     update_status, KEY Cortex's CRM adapter (create_contact, update_contact,
 *     update_status; key-cortex/adapters/crm-adapter.service.ts) and KEY's
 *     update_status_with_confirmation (ai/flow-orchestrator.service.ts). The
 *     last two stored the status verbatim until D-92 review CR-D92-1, so a row
 *     may hold a lowercase spelling ('dormant', 'customer', 'lead'); the
 *     readers do not count one (isClientStatus is exact), and such rows are
 *     not migrated.
 *   - through the tool schema: KEY's crm_create_contact and crm_update_contact
 *     (status enum CONTACT_STATUSES, checked before the call) and KEY's
 *     bulk_status_change (isContactStatus).
 *   - residual, outside W4-D92-DORMANT-AS-CLIENT: the Google and Outlook
 *     contact-sync rules and the connector form mapping store an operator's
 *     configured defaultStatus as given (connect/*.service.ts).
 */
export const CLIENT_STATUS: ContactStatus = 'CLIENT';
export const LEGACY_CLIENT_STATUS = 'CUSTOMER';
export const LEGACY_DORMANT_STATUS = 'DORMANT';

export function isClientStatus(status: string | null | undefined): boolean {
  return status === CLIENT_STATUS || status === LEGACY_CLIENT_STATUS || status === LEGACY_DORMANT_STATUS;
}

/**
 * V1-38c, D-92: the ContactStatus a value written from outside the CRM DTOs
 * reads as, and the one helper such a writer stores a status through (the
 * CSV/link import, a playbook's update_status). A ContactStatus in any case or
 * padding is that status, and the legacy CLIENT spellings (CUSTOMER and, D-92,
 * DORMANT) are CLIENT, the mapping isClientStatus reads rows by. Anything else
 * is null: INACTIVE, ACTIVE and any other word have no ContactStatus, and the
 * caller treats the value as it treats any cell it does not recognise.
 */
export function canonicalContactStatus(value: string | null | undefined): ContactStatus | null {
  if (typeof value !== 'string') return null;
  const spelled = value.trim().toUpperCase();
  if (isContactStatus(spelled)) return spelled;
  return isClientStatus(spelled) ? CLIENT_STATUS : null;
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
