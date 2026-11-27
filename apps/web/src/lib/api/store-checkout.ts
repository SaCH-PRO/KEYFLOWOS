/**
 * WEDGE-HIDE-STORE part 2 (P225, owner ruling D-263): is a business's public store checkout offered?
 *
 * D-263: the store checkout is not offered to a new business at launch; a business already selling keeps it. The
 * answer is the server's: `storeCheckout: boolean` on GET /site/storefront/public/:slug (server row P233), from the
 * same `store` legacy answer the signed-in app reads (lib/api/legacy-modules.ts).
 *
 * Fail closed: only the boolean `true` offers it. A missing field (a server before P233), false, any other value,
 * or no answer at all (the read failed, or has not come back yet) means not offered. The server refuses the order
 * itself; this is what the public page shows.
 */
export function storeCheckoutOffered(storefrontAnswer: unknown): boolean {
  return (
    typeof storefrontAnswer === "object"
    && storefrontAnswer !== null
    && (storefrontAnswer as { storeCheckout?: unknown }).storeCheckout === true
  );
}

/**
 * A storefront read that FAILED is not an answer. The gate stays closed (nothing is sold), but nothing is deleted
 * either, and the page offers to ask again: only a definite answer that is not `true` drops stored product lines.
 */
export const STORE_CHECK_FAILED = "Couldn't check online ordering.";
/** The same, on the order confirmation, where the way to ask again is back on the shop page. */
export const STORE_CHECK_FAILED_GO_BACK = "Couldn't check online ordering. Go back to the shop and try again.";

/** What the page says when a store order is asked for and the store checkout is not offered. */
export const STORE_CHECKOUT_NOT_OFFERED = "Online orders are not available from this business.";

/**
 * A cart without the lines the store checkout would sell: only its booking lines (`requiresBooking: true`) are kept.
 * A line that does not say it is a booking (an older stored cart) is a store line, and is left out.
 */
export function withoutStoreLines<T extends { requiresBooking?: boolean }>(cart: T[]): T[] {
  return cart.filter((line) => line.requiresBooking === true);
}
