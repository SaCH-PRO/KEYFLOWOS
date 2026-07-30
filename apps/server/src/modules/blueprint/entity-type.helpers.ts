import { BlueprintRecommendedEntityType } from './blueprint.types';

/**
 * Canonical synonyms for legal entity types. Keeps AI-extracted values and
 * user-facing labels mapped to the strict BlueprintRecommendedEntityType enum.
 */
export const RECOMMENDED_ENTITY_TYPE_SYNONYMS: Record<string, BlueprintRecommendedEntityType> = {
  LLC: 'LIMITED_COMPANY',
  LTD: 'LIMITED_COMPANY',
  LIMITED: 'LIMITED_COMPANY',
  LIMITED_LIABILITY: 'LIMITED_COMPANY',
  LIMITED_LIABILITY_COMPANY: 'LIMITED_COMPANY',
  PRIVATE_LIMITED: 'LIMITED_COMPANY',
  PRIVATE_LIMITED_COMPANY: 'LIMITED_COMPANY',
  PLC: 'LIMITED_COMPANY',
  PUBLIC_LIMITED: 'LIMITED_COMPANY',
  PUBLIC_LIMITED_COMPANY: 'LIMITED_COMPANY',
  SOLE_PROPRIETORSHIP: 'SOLE_TRADER',
  SOLE_PROPRIETOR: 'SOLE_TRADER',
  SOLE_TRADER_BUSINESS: 'SOLE_TRADER',
  SELF_EMPLOYED: 'SOLE_TRADER',
  INDIVIDUAL: 'SOLE_TRADER',
  PARTNERSHIP_FIRM: 'PARTNERSHIP',
  GENERAL_PARTNERSHIP: 'PARTNERSHIP',
  LIMITED_PARTNERSHIP: 'PARTNERSHIP',
  LIMITED_LIABILITY_PARTNERSHIP: 'LIMITED_COMPANY',
  NON_PROFIT: 'NONPROFIT',
  NON_PROFIT_ORGANIZATION: 'NONPROFIT',
  NONPROFIT_ORGANIZATION: 'NONPROFIT',
  NGO: 'NONPROFIT',
  CHARITY: 'NONPROFIT',
  CHARITABLE_ORGANIZATION: 'NONPROFIT',
};

/**
 * Normalize any free-text entity type into a canonical BlueprintRecommendedEntityType.
 * Returns 'UNKNOWN' when the value cannot be mapped.
 */
export function normalizeRecommendedEntityType(
  value: unknown,
): BlueprintRecommendedEntityType {
  const allowed: BlueprintRecommendedEntityType[] = [
    'SOLE_TRADER',
    'PARTNERSHIP',
    'LIMITED_COMPANY',
    'NONPROFIT',
    'UNKNOWN',
  ];

  if (typeof value !== 'string') return 'UNKNOWN';

  const normalized = value.trim().toUpperCase().replace(/\s+/g, '_');

  if (allowed.includes(normalized as BlueprintRecommendedEntityType)) {
    return normalized as BlueprintRecommendedEntityType;
  }

  return RECOMMENDED_ENTITY_TYPE_SYNONYMS[normalized] ?? 'UNKNOWN';
}
