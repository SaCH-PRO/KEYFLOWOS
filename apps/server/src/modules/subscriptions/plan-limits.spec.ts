/**
 * A free plan must not be more generous than a paid one.
 *
 * PLANS.FREE.limits.aiCreditsPerMonth was 10000 while its own feature list
 * advertised "10 AI credits/month" and the paid FLOW tier at $15/mo granted 100.
 * Free accounts therefore had a hundred times the allowance of a paying
 * customer, and a thousand times what they had been told — and because
 * getActiveSubscription falls back to PLANS.FREE for any business with no
 * subscription row or an expired trial, that was the default for every unpaid
 * account in the system.
 *
 * Nothing caught it because nothing compared the tiers to each other, or the
 * limits to the feature strings that describe them. These tests do both.
 */
import { describe, it, expect } from 'vitest';
import { PLANS } from './plans';

type PlanKey = keyof typeof PLANS;

/** Paid tiers in ascending price order. */
function paidTiersByPrice(): PlanKey[] {
  return (Object.keys(PLANS) as PlanKey[])
    .filter((k) => (PLANS[k] as any).priceUSD > 0)
    .sort((a, b) => (PLANS[a] as any).priceUSD - (PLANS[b] as any).priceUSD);
}

/** -1 is the codebase's "unlimited" sentinel. */
function asNumber(limit: unknown): number {
  const n = Number(limit);
  return n === -1 ? Number.POSITIVE_INFINITY : n;
}

describe('paying for the product gets you more of it', () => {
  const metered = [
    'aiCreditsPerMonth',
    'contacts',
    'invoicesPerMonth',
    'bookingsPerMonth',
    'staffMembers',
    'products',
    'automations',
  ] as const;

  for (const limit of metered) {
    it(`FREE does not exceed the cheapest paid tier on ${limit}`, () => {
      const cheapestPaid = paidTiersByPrice()[0];
      const free = asNumber((PLANS.FREE.limits as any)[limit]);
      const paid = asNumber((PLANS[cheapestPaid].limits as any)[limit]);

      expect(
        free,
        `FREE.${limit} = ${free} exceeds ${String(cheapestPaid)}.${limit} = ${paid}`,
      ).toBeLessThanOrEqual(paid);
    });
  }
});

describe('the limits match what the plan says it gives you', () => {
  it('FREE advertises the AI credit allowance it actually grants', () => {
    // The feature strings are the customer-facing promise. A limit that
    // disagrees with them is either overcharging or, as here, giving away the
    // most expensive resource in the product.
    const advertised = PLANS.FREE.features.find((f) => /AI credit/i.test(f));
    expect(advertised, 'FREE no longer advertises an AI credit allowance').toBeDefined();

    const stated = Number(/(\d+)/.exec(advertised!)?.[1]);
    expect(stated).toBe(PLANS.FREE.limits.aiCreditsPerMonth);
  });

  it('grants a free account no more than a token allowance', () => {
    // A blunt upper bound, independent of the comparison above, so that
    // raising every tier at once cannot quietly reintroduce this.
    expect(PLANS.FREE.limits.aiCreditsPerMonth).toBeLessThanOrEqual(50);
  });
});

describe('the ceiling is real', () => {
  it('every plan declares an AI credit limit', () => {
    // An undefined limit reads as falsy and could be treated as unlimited by a
    // careless check.
    for (const key of Object.keys(PLANS) as PlanKey[]) {
      expect(
        (PLANS[key].limits as any).aiCreditsPerMonth,
        `${String(key)} has no aiCreditsPerMonth`,
      ).toBeTypeOf('number');
    }
  });
});
