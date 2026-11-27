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

/** What the page says when a store order is asked for and the store checkout is not offered. */
export const STORE_CHECKOUT_NOT_OFFERED = "Online orders are not available from this business.";

/** The lines of a cart the store checkout would sell: every line that is not a booking. */
export function withoutStoreLines<T extends { requiresBooking?: boolean }>(cart: T[]): T[] {
  return cart.filter((line) => line.requiresBooking === true);
}
