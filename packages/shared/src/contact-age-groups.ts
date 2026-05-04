export const CONTACT_AGE_GROUPS = [
  'UNDER_18',
  '18_24',
  '25_34',
  '35_44',
  '45_54',
  '55_64',
  '65_PLUS',
  'UNKNOWN',
] as const;

export type ContactAgeGroup = typeof CONTACT_AGE_GROUPS[number];

export const CONTACT_AGE_GROUP_LABELS: Record<ContactAgeGroup, string> = {
  UNDER_18: 'Under 18',
  '18_24': '18-24',
  '25_34': '25-34',
  '35_44': '35-44',
  '45_54': '45-54',
  '55_64': '55-64',
  '65_PLUS': '65+',
  UNKNOWN: 'Unknown / Prefer not to say',
};

export function getContactAgeGroupLabel(value?: string | null): string | null {
  if (!value) return null;
  return CONTACT_AGE_GROUP_LABELS[value as ContactAgeGroup] ?? value;
}
