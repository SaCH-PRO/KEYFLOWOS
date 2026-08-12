/**
 * The lookup tables in packages/shared, checked as properties rather than by eye.
 *
 * These are the shape of thing that is obviously correct when written and
 * silently wrong six months later, because adding a value and forgetting its
 * label produces no error anywhere: `LABELS[value] ?? value` falls back to the
 * raw enum, so the UI renders "PAST_CLIENT" instead of "Past Client" and the
 * only symptom is a slightly ugly screen nobody files a bug for.
 *
 * The inverse table is the one with teeth. contact-network materialises two-way
 * edges — writing A→B of type T also writes B→A of INVERSE[T] — so if INVERSE
 * is not a true involution the graph acquires edges that disagree with
 * themselves, and "who referred this client" starts answering backwards. A tenth
 * edge type added without its inverse would be a TypeScript error today, which
 * is good; a tenth edge type added with the WRONG inverse would not be, which is
 * what the involution check is for.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTACT_AGE_GROUPS,
  CONTACT_AGE_GROUP_LABELS,
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_RELATIONSHIP_TYPE_LABELS,
  CONTACT_RELATIONSHIP_HEALTH_VALUES,
  CONTACT_RELATIONSHIP_HEALTH_LABELS,
  CONTACT_PRIORITIES,
  CONTACT_PRIORITY_LABELS,
  CONTACT_NEXT_ACTION_TYPES,
  CONTACT_NEXT_ACTION_TYPE_LABELS,
  CONTACT_RELATIONSHIP_EDGE_TYPES,
  CONTACT_RELATIONSHIP_EDGE_LABELS,
  CONTACT_RELATIONSHIP_INVERSE,
  getContactAgeGroupLabel,
  getContactRelationshipEdgeLabel,
  isContactRelationshipEdgeType,
} from '@keyflow/shared';

const TABLES: Array<[string, readonly string[], Record<string, string>]> = [
  ['age group', CONTACT_AGE_GROUPS, CONTACT_AGE_GROUP_LABELS],
  ['relationship type', CONTACT_RELATIONSHIP_TYPES, CONTACT_RELATIONSHIP_TYPE_LABELS],
  ['relationship health', CONTACT_RELATIONSHIP_HEALTH_VALUES, CONTACT_RELATIONSHIP_HEALTH_LABELS],
  ['priority', CONTACT_PRIORITIES, CONTACT_PRIORITY_LABELS],
  ['next action', CONTACT_NEXT_ACTION_TYPES, CONTACT_NEXT_ACTION_TYPE_LABELS],
  ['relationship edge', CONTACT_RELATIONSHIP_EDGE_TYPES, CONTACT_RELATIONSHIP_EDGE_LABELS],
];

describe('the contact taxonomies', () => {
  it('has tables to check — this is not vacuous', () => {
    expect(TABLES.length).toBe(6);
    for (const [name, values] of TABLES) {
      expect(values.length, `${name} is empty`).toBeGreaterThan(3);
    }
  });

  it.each(TABLES)('every %s value has a label, and every label a value', (name, values, labels) => {
    const missing = values.filter((v) => !(v in labels));
    expect(missing, `${name}: values with no label — the UI shows the raw enum`).toEqual([]);

    const orphaned = Object.keys(labels).filter((k) => !values.includes(k));
    expect(orphaned, `${name}: labels for values that no longer exist`).toEqual([]);
  });

  /**
   * Values whose correct human label genuinely IS the identifier. Acronyms only
   * — the first run of this spec flagged SMS, which is not a defect, and a check
   * that cries wolf gets deleted rather than fixed.
   */
  const LABEL_MAY_EQUAL_VALUE = new Set(['SMS']);

  it.each(TABLES)('no %s label is blank or left as the raw value', (name, values, labels) => {
    for (const v of values) {
      expect(labels[v]?.trim(), `${name}: ${v} has an empty label`).toBeTruthy();
      if (LABEL_MAY_EQUAL_VALUE.has(v)) continue;
      // Catches the real case — PAST_CLIENT labelled 'PAST_CLIENT' — which
      // reaches the UI as a screaming-snake-case string in a dropdown.
      expect(labels[v], `${name}: ${v} is labelled with its own enum name`).not.toBe(v);
    }
  });

  it('the edge inverse table is total and an involution', () => {
    for (const type of CONTACT_RELATIONSHIP_EDGE_TYPES) {
      const inverse = CONTACT_RELATIONSHIP_INVERSE[type];
      expect(inverse, `${type} has no inverse`).toBeTruthy();
      expect(
        CONTACT_RELATIONSHIP_EDGE_TYPES.includes(inverse),
        `${type} inverts to ${inverse}, which is not an edge type`,
      ).toBe(true);
      // The property that matters: applying it twice returns the original.
      expect(
        CONTACT_RELATIONSHIP_INVERSE[inverse],
        `${type} -> ${inverse} -> ${CONTACT_RELATIONSHIP_INVERSE[inverse]}, so the ` +
          'two-way edge disagrees with itself',
      ).toBe(type);
    }
  });

  it('symmetric edges are their own inverse, and asymmetric ones are not', () => {
    // Stated explicitly because getting this backwards still satisfies the
    // involution check: a table where everything maps to itself is a perfectly
    // good involution and completely wrong.
    const selfInverse = CONTACT_RELATIONSHIP_EDGE_TYPES.filter(
      (t) => CONTACT_RELATIONSHIP_INVERSE[t] === t,
    );
    expect(selfInverse.sort()).toEqual(['colleague_of', 'family_of', 'partner_of']);

    expect(CONTACT_RELATIONSHIP_INVERSE.referred).toBe('referred_by');
    expect(CONTACT_RELATIONSHIP_INVERSE.reports_to).toBe('manages');
    expect(CONTACT_RELATIONSHIP_INVERSE.introduced_by).toBe('introduced');
  });

  it('the label getters fall back rather than throwing on unknown input', () => {
    // These take `string`, not the union, because they are fed database columns.
    expect(getContactAgeGroupLabel('25_34')).toBe('25-34');
    expect(getContactAgeGroupLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(getContactAgeGroupLabel(null)).toBeNull();
    expect(getContactAgeGroupLabel('')).toBeNull();

    expect(getContactRelationshipEdgeLabel('manages')).toBe('Manages');
    expect(getContactRelationshipEdgeLabel(null)).toBe('');
  });

  it('the edge type guard accepts every declared type and nothing else', () => {
    for (const t of CONTACT_RELATIONSHIP_EDGE_TYPES) {
      expect(isContactRelationshipEdgeType(t)).toBe(true);
    }
    expect(isContactRelationshipEdgeType('reports_to ')).toBe(false);
    expect(isContactRelationshipEdgeType('REPORTS_TO')).toBe(false);
    expect(isContactRelationshipEdgeType('')).toBe(false);
  });
});
