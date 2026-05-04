export const CONTACT_STATUSES = ['LEAD', 'PROSPECT', 'CLIENT', 'LOST'] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];
export const BULK_LIMIT = 500;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

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
