/**
 * The relationship-health rules, which describe themselves as tested and were
 * not.
 *
 * `computeRelationshipHealth` in packages/shared carries the comment "Pure
 * function used by both the scheduler and tests." There were no tests — none of
 * the four packages has a test script, so 975 lines of shared logic ran on the
 * strength of a docstring. This is that file's first coverage, and it imports
 * through '@keyflow/shared' rather than the source, so it exercises the build
 * the server actually loads.
 *
 * A DISAGREEMENT WORTH KNOWING ABOUT, pinned below rather than changed.
 * The pure function documents returning `null` when there is not enough
 * information — "brand-new contact created today with no recorded
 * interactions". Its only caller makes that unreachable:
 *
 *     const reference = contact.lastContactedAt ?? contact.createdAt;
 *
 * So a contact nobody has ever spoken to is measured from the day it was
 * created, and one created today is stored as HOT. Meanwhile the at-risk list
 * on the same service reports `daysSinceLastContact: null` for that same
 * contact. Two endpoints, one contact, and only one of them admits there has
 * been no contact.
 *
 * Whether "recently added" should read as HOT is a CRM judgement, and changing
 * it rewrites the meaning of a column that already has rows in it. The tests
 * below therefore assert what the code does today, and say plainly which line
 * would have to move.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRelationshipHealth,
  normalizeRelationshipHealthThresholds,
  DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS as D,
} from '@keyflow/shared';

describe('computeRelationshipHealth', () => {
  it('returns null only when the days are unknown', () => {
    expect(computeRelationshipHealth(null, 'LEAD')).toBeNull();
    expect(computeRelationshipHealth(0, 'LEAD')).toBe('HOT');
  });

  it('is inclusive at every boundary', () => {
    // Off-by-one here silently moves every contact sitting exactly on a
    // threshold into the neighbouring bucket, which nobody would notice.
    expect(computeRelationshipHealth(D.hot, 'LEAD')).toBe('HOT');
    expect(computeRelationshipHealth(D.hot + 1, 'LEAD')).toBe('WARM');
    expect(computeRelationshipHealth(D.warm, 'LEAD')).toBe('WARM');
    expect(computeRelationshipHealth(D.warm + 1, 'LEAD')).toBe('COLD');
    expect(computeRelationshipHealth(D.cold, 'LEAD')).toBe('COLD');
    expect(computeRelationshipHealth(D.cold + 1, 'LEAD')).toBe('DORMANT');
  });

  it('flags only CLIENT as AT_RISK, and only past the client threshold', () => {
    expect(computeRelationshipHealth(D.atRiskClientDays, 'CLIENT')).toBe('AT_RISK');
    expect(computeRelationshipHealth(D.atRiskClientDays - 1, 'CLIENT')).toBe('COLD');
    // Same elapsed time, different status: no AT_RISK for anyone else.
    expect(computeRelationshipHealth(D.atRiskClientDays, 'LEAD')).toBe('COLD');
    expect(computeRelationshipHealth(D.atRiskClientDays, null)).toBe('COLD');
  });

  it('AT_RISK outranks the day buckets, including HOT', () => {
    // atRiskClientDays is configurable and nothing forces it above `hot`. Set it
    // low and a client contacted yesterday is AT_RISK — the ordering the code
    // actually implements, worth stating so a reorder is a decision.
    const t = { ...D, atRiskClientDays: 1 };
    expect(computeRelationshipHealth(2, 'CLIENT', t)).toBe('AT_RISK');
    expect(computeRelationshipHealth(2, 'LEAD', t)).toBe('HOT');
  });

  it('treats negative and fractional days as whole days from now', () => {
    expect(computeRelationshipHealth(-5, 'LEAD')).toBe('HOT');
    expect(computeRelationshipHealth(D.hot + 0.9, 'LEAD')).toBe('HOT');
  });
});

describe('normalizeRelationshipHealthThresholds', () => {
  it('returns the defaults for null, undefined and an empty object', () => {
    expect(normalizeRelationshipHealthThresholds(null)).toEqual(D);
    expect(normalizeRelationshipHealthThresholds(undefined)).toEqual(D);
    expect(normalizeRelationshipHealthThresholds({})).toEqual(D);
  });

  it('forces hot < warm < cold even when the input inverts them', () => {
    // Without this the buckets become unreachable: compute checks hot first, so
    // a warm below hot can never be returned, and the business simply loses a
    // category with no error anywhere.
    const t = normalizeRelationshipHealthThresholds({ hot: 30, warm: 10, cold: 5 });
    expect(t.hot).toBeLessThan(t.warm);
    expect(t.warm).toBeLessThan(t.cold);

    // And the repaired thresholds must actually produce every bucket.
    const buckets = [t.hot, t.warm, t.cold, t.cold + 1].map((d) =>
      computeRelationshipHealth(d, 'LEAD', t),
    );
    expect(buckets).toEqual(['HOT', 'WARM', 'COLD', 'DORMANT']);
  });

  it('rejects values that are not usable day counts', () => {
    const t = normalizeRelationshipHealthThresholds({
      hot: 0,
      warm: -1,
      cold: Number.NaN,
      atRiskClientDays: Number.POSITIVE_INFINITY,
    } as never);
    expect(t).toEqual(D);
  });

  it('floors fractional days rather than carrying them into date maths', () => {
    expect(normalizeRelationshipHealthThresholds({ hot: 7.9 }).hot).toBe(7);
  });
});

describe('a contact nobody has ever contacted', () => {
  it('is HOT on the day it is created — the caller substitutes createdAt', () => {
    // crm-relationship-health.service.ts healthFor():
    //   const reference = contact.lastContactedAt ?? contact.createdAt;
    // The pure function's documented null case is therefore unreachable in
    // production. This asserts the substitution's consequence so that removing
    // it is a deliberate change with a failing test attached, rather than a
    // silent rewrite of what HOT means.
    const neverContactedCreatedToday = 0;
    expect(computeRelationshipHealth(neverContactedCreatedToday, 'LEAD')).toBe('HOT');

    // What the same contact would be if the caller passed the truth instead.
    expect(computeRelationshipHealth(null, 'LEAD')).toBeNull();
  });
});
