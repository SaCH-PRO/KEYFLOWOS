/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263): the public answer that says whether a business's store checkout is offered.
 *
 * GET /site/storefront/public/:slug is to carry `storeCheckout: boolean` (server row P233). Until it does, and
 * whenever it is anything but `true`, the store checkout is not offered (fail closed).
 *
 *   WHS2-01  only the boolean `true` offers the store checkout
 *   WHS2-02  a missing field, false, a truthy non-boolean, or no answer at all does not
 *   WHS2-18  withoutStoreLines keeps only the booking lines of a cart
 */
import { describe, expect, it } from "vitest";
import { storeCheckoutOffered, withoutStoreLines } from "../store-checkout";

describe("WEDGE-HIDE-STORE part 2: storeCheckoutOffered", () => {
  it("WHS2-01 only the boolean true offers the store checkout", () => {
    expect(storeCheckoutOffered({ storeCheckout: true })).toBe(true);
    expect(storeCheckoutOffered({ storefront: {}, storeCheckout: true, products: [] })).toBe(true);
  });

  it("WHS2-02 a missing field, false, a truthy non-boolean or no answer does not", () => {
    for (const answer of [
      {},
      { storefront: {} },
      { storeCheckout: false },
      { storeCheckout: "true" },
      { storeCheckout: 1 },
      { storeCheckout: null },
      { storeCheckout: {} },
      null,
      undefined,
      "true",
      true,
      [],
    ]) {
      expect(storeCheckoutOffered(answer), JSON.stringify(answer)).toBe(false);
    }
  });

  it("WHS2-18 withoutStoreLines keeps only booking lines: a line with no requiresBooking (an older stored cart) is a store line", () => {
    const booking = { id: "svc", requiresBooking: true };
    expect(withoutStoreLines([{ id: "prod", requiresBooking: false }, booking, { id: "legacy" }, { id: "odd", requiresBooking: "true" as unknown as boolean }])).toEqual([booking]);
    expect(withoutStoreLines([])).toEqual([]);
  });
});
