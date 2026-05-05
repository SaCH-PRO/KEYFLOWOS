export const CONTACT_RELATIONSHIP_EDGE_TYPES = [
  'referred',
  'referred_by',
  'colleague_of',
  'family_of',
  'introduced_by',
  'introduced',
  'reports_to',
  'manages',
  'partner_of',
] as const;

export type ContactRelationshipEdgeType = typeof CONTACT_RELATIONSHIP_EDGE_TYPES[number];

export const CONTACT_RELATIONSHIP_EDGE_LABELS: Record<ContactRelationshipEdgeType, string> = {
  referred: 'Referred',
  referred_by: 'Referred by',
  colleague_of: 'Colleague of',
  family_of: 'Family of',
  introduced_by: 'Introduced by',
  introduced: 'Introduced',
  reports_to: 'Reports to',
  manages: 'Manages',
  partner_of: 'Partner of',
};

// Inverse relationships used to materialize two-way edges. When edge A → B of
// type T is created, an inverse edge B → A of CONTACT_RELATIONSHIP_INVERSE[T]
// is also written. Symmetric relationships use the same type as their inverse.
export const CONTACT_RELATIONSHIP_INVERSE: Record<ContactRelationshipEdgeType, ContactRelationshipEdgeType> = {
  referred: 'referred_by',
  referred_by: 'referred',
  colleague_of: 'colleague_of',
  family_of: 'family_of',
  introduced_by: 'introduced',
  introduced: 'introduced_by',
  reports_to: 'manages',
  manages: 'reports_to',
  partner_of: 'partner_of',
};

export function getContactRelationshipEdgeLabel(type?: string | null): string {
  if (!type) return '';
  return CONTACT_RELATIONSHIP_EDGE_LABELS[type as ContactRelationshipEdgeType] ?? type;
}

export function isContactRelationshipEdgeType(type: string): type is ContactRelationshipEdgeType {
  return (CONTACT_RELATIONSHIP_EDGE_TYPES as readonly string[]).includes(type);
}
