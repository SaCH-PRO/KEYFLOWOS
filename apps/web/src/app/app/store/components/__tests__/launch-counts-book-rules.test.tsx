/**
 * CATALOG-1 web, review round 1, COR-CAT-8 (part): Launch's store-item count draws products the way /book does.
 *
 * /book shows a product that 'Add to store' listed only when GET /commerce/public/businesses/:id/products returns it
 * and the page draws its category:
 *   - the server leaves out a tracked product with nothing available whose out-of-stock behaviour is "hide" (the
 *     default); a product with no inventory mode is tracked when it has stock rows (resolveInventoryMode);
 *   - the page draws PRODUCT, PACKAGE and SERVICE products only.
 * The stock is the business's own inventory rows (GET /marketplace/businesses/:id/inventory), summed per product
 * (quantity minus reserved), as the server's aggregateStock sums them.
 *
 * Left as listed follow-ups (not here): /book's name de-duplication of a SERVICE-category product against a bookable
 * service, and the other counters (use-store-ai-hub, store/page.tsx, overview-mode).
 */
import { describe, it, expect } from "vitest";
import type { Product, Service } from "@/lib/client";
import { countStoreItems } from "../launch-mode";

const product = (id: string, extra: Record<string, unknown> = {}): Product =>
  ({ id, name: id, price: 10, currency: "TTD", category: "PRODUCT", isActive: true, ...extra } as Product);
const listing = (productId: string): Service => ({ id: `svc_${productId}`, name: productId, price: 10, sourceProductId: productId } as Service);
const stock = (entries: Record<string, { quantity: number; reserved?: number }>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, { quantity: v.quantity, reserved: v.reserved ?? 0 }]));

describe("COR-CAT-8 countStoreItems draws products as /book does", () => {
  it("a tracked product with nothing available and 'hide' (the default) is not counted", () => {
    const p = product("p_hidden", { inventoryMode: "tracked" });
    expect(countStoreItems([listing(p.id)], [p], stock({}))).toBe(0);
    expect(countStoreItems([listing(p.id)], [p], stock({ p_hidden: { quantity: 3, reserved: 3 } }))).toBe(0);
  });

  it("a product with no inventory mode but stock rows is tracked: at zero it is not counted", () => {
    const p = product("p_rows", { inventoryMode: null, outOfStockBehavior: null });
    expect(countStoreItems([listing(p.id)], [p], stock({ p_rows: { quantity: 0 } }))).toBe(0);
  });

  it("controls: in stock, 'show_oos', 'allow_backorder', untracked and no stock rows at all are counted", () => {
    const inStock = product("p_in", { inventoryMode: "tracked" });
    const oos = product("p_oos", { inventoryMode: "tracked", outOfStockBehavior: "show_oos" });
    const back = product("p_back", { inventoryMode: "tracked", outOfStockBehavior: "allow_backorder" });
    const untracked = product("p_untracked", { inventoryMode: "untracked" });
    const noRows = product("p_norows", { inventoryMode: null });
    const all = [inStock, oos, back, untracked, noRows];
    expect(countStoreItems(all.map((p) => listing(p.id)), all, stock({ p_in: { quantity: 2 } }))).toBe(5);
  });

  it("a category /book does not draw is not counted; PRODUCT, PACKAGE and SERVICE are", () => {
    const ps = [product("p_a"), product("p_b", { category: "PACKAGE" }), product("p_c", { category: "SERVICE" }), product("p_d", { category: "DIGITAL" })];
    expect(countStoreItems(ps.map((p) => listing(p.id)), ps, stock({}))).toBe(3);
  });

  it("stock not read (no map): a product's stock rule cannot be applied and it is counted as listed", () => {
    const p = product("p_hidden", { inventoryMode: "tracked" });
    expect(countStoreItems([listing(p.id)], [p])).toBe(1);
  });
});
