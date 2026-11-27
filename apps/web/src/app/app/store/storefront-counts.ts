/**
 * P231 TRUST-BADGES-TRUE-ONLY round 6 (D-303): what the storefront shows, so every copy generator (the AI Content
 * panel, the store AI hub and the AI Hero Copy panel) counts the store the same way.
 *
 * - A product is on the storefront when it is live on the store (a live store-graph mapping) and active.
 * - A service is bookable on the storefront when it is not a product's store listing: a service row with a
 *   sourceProductId marks a product added to the store (SWP-STORE-LISTING-SERVER) and is not listed as a service.
 */
export function liveProducts<P extends { id: string; isActive?: boolean }>(products: P[], liveProductIds: ReadonlySet<string> | undefined): P[] {
  if (!liveProductIds) return [];
  return products.filter((p) => liveProductIds.has(p.id) && p.isActive !== false);
}

export function bookableServices<S extends { sourceProductId?: unknown }>(services: S[]): S[] {
  return services.filter((s) => !s.sourceProductId);
}
