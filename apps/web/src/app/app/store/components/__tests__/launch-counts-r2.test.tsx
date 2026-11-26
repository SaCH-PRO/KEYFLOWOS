/**
 * CATALOG-1 web, review round 2 (count parity with /book):
 *   (a) the server hides an out-of-stock tracked product for any behaviour other than "show_oos" or
 *       "allow_backorder" (CatalogService.projectAvailability's default branch), not only for "hide";
 *   (b) /book drops an item whose storefront override says visibilityRule "hidden" (book/[slug]/page.tsx
 *       filteredCatalogItems), a bookable service or a listed product alike.
 */
import { describe, it, expect } from "vitest";
import type { Product, Service, StorefrontConfig } from "@/lib/client";
import { countStoreItems } from "../launch-mode";

const product = (id: string, extra: Record<string, unknown> = {}): Product =>
  ({ id, name: id, price: 10, currency: "TTD", category: "PRODUCT", isActive: true, ...extra } as Product);
const listing = (productId: string): Service => ({ id: `svc_${productId}`, name: productId, price: 10, sourceProductId: productId } as Service);
const bookable = (id: string): Service => ({ id, name: id, price: 10, sourceProductId: null } as Service);
const noStock = new Map<string, { quantity: number; reserved: number }>();

describe("(a) an out-of-stock behaviour the server does not know hides the product", () => {
  it.each(["pause", "", "HIDE"])("tracked, nothing available, behaviour %j: not counted", (behavior) => {
    const p = product("p_x", { inventoryMode: "tracked", outOfStockBehavior: behavior });
    expect(countStoreItems([listing(p.id)], [p], noStock)).toBe(0);
  });
  it.each(["show_oos", "allow_backorder"])("control: %j keeps it counted", (behavior) => {
    const p = product("p_x", { inventoryMode: "tracked", outOfStockBehavior: behavior });
    expect(countStoreItems([listing(p.id)], [p], noStock)).toBe(1);
  });
});

describe("(b) an item the storefront hides is not counted", () => {
  const config = (ids: string[]): StorefrontConfig =>
    ({ catalog: { itemOverrides: Object.fromEntries(ids.map((id) => [id, { visibilityRule: "hidden" }])) } } as unknown as StorefrontConfig);

  it("a hidden listed product and a hidden bookable service are not counted; the others are", () => {
    const shown = product("p_shown");
    const hidden = product("p_hidden");
    const services = [listing(shown.id), listing(hidden.id), bookable("svc_cut"), bookable("svc_hidden")];
    expect(countStoreItems(services, [shown, hidden], noStock, config(["p_hidden", "svc_hidden"]))).toBe(2);
  });

  it("control: an override that is not 'hidden' changes nothing", () => {
    const p = product("p_a");
    const cfg = { catalog: { itemOverrides: { p_a: { visibilityRule: "visible", label: "A" } } } } as unknown as StorefrontConfig;
    expect(countStoreItems([listing(p.id), bookable("svc_b")], [p], noStock, cfg)).toBe(2);
  });
});
