/**
 * CATALOG-1 web, review round 1 (COR-CAT-5, COR-CAT-8): Your page reads every product and the business's stock.
 *
 * The products read was one page (the server's default 50), so a business with more products had the rest missing
 * from Your page's catalog and from Launch's count. Launch's count also needs the stock /book's server applies
 * (a tracked product with nothing available and 'hide' is not shown): Your page reads the business's own inventory
 * rows and sums them per product.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, refreshWorkspace: vi.fn(async () => BIZ), getStoredBusinessId: vi.fn(() => BIZ) };
});
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

import { useStoreData } from "../use-store-data";

const BIZ = "biz_store_all_1";
const PRODUCTS = Array.from({ length: 130 }, (_, i) => ({
  id: `p_${i}`, name: `Item ${i}`, price: 5, currency: "TTD", category: "PRODUCT", isActive: true,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://api.test.local");
    if (url.pathname.endsWith(`/commerce/businesses/${BIZ}/products`)) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Math.min(Number(url.searchParams.get("pageSize") ?? "50"), 100);
      const data = PRODUCTS.slice((page - 1) * pageSize, page * pageSize);
      return new Response(JSON.stringify({ data, total: PRODUCTS.length, page, pageSize, totalPages: Math.ceil(PRODUCTS.length / pageSize) }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.endsWith(`/bookings/businesses/${BIZ}/services`)) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "not stubbed" }), { status: 404, headers: { "content-type": "application/json" } });
  }));
  api.apiGet.mockImplementation(async (path: string) => {
    // Round 2 (SEC-CAT-7): the stock is read only for a member whose revenue level is known and not "none"; this
    // member is the owner.
    if (path.endsWith("/my-access")) return { data: { modules: { revenue: "admin", storefront: "admin" } }, error: null };
    if (path === `/marketplace/businesses/${BIZ}/inventory`) {
      return { data: [
        { productId: "p_1", warehouseId: "w1", quantity: 4, reserved: 1 },
        { productId: "p_1", warehouseId: "w2", quantity: 2, reserved: 0 },
        { productId: "p_2", warehouseId: "w1", quantity: 0, reserved: 0 },
      ], error: null };
    }
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Your page reads every product and the business's stock", () => {
  it("130 products: all 130 are read (page by page)", async () => {
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(result.current.commerceProducts).toHaveLength(130), { timeout: 4000 });
  });

  it("the stock is summed per product from the business's inventory rows (quantity and reserved)", async () => {
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(result.current.stockByProduct).toBeTruthy(), { timeout: 4000 });
    const stock = result.current.stockByProduct as Map<string, { quantity: number; reserved: number }>;
    expect(stock.get("p_1")).toEqual({ quantity: 6, reserved: 1 });
    expect(stock.get("p_2")).toEqual({ quantity: 0, reserved: 0 });
    expect(stock.has("p_3")).toBe(false);
  });
});
