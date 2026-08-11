export const CONTACT_STATUSES = ['LEAD', 'PROSPECT', 'CLIENT', 'LOST'] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

// Pricing tiers (distributor/wholesale vs retail). RETAIL is the default; a
// contact on a non-retail tier is quoted/invoiced at that tier's product price.
export const PRICING_TIERS = ['RETAIL', 'WHOLESALE'] as const;
export type PricingTier = typeof PRICING_TIERS[number];
export const PRICING_TIER_LABELS: Record<string, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale / Distributor',
};
export function getPricingTierLabel(tier?: string | null): string {
  if (!tier) return PRICING_TIER_LABELS.RETAIL;
  return PRICING_TIER_LABELS[tier] ?? tier;
}
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
