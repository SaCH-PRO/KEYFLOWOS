/**
 * CATALOG-1 web, review round 2, SEC-CAT-7 (D-100): Your page's stock read
 * (GET /marketplace/businesses/:id/inventory) answers whole Product rows, prices and compare-at prices included.
 * A member whose revenue level is "none" may not read prices, so Your page does not ask for it for them; Launch's
 * count then takes its documented path without stock. The member's level is the one the app reads everywhere
 * (useMemberModuleLevels, GET /identity/businesses/:id/my-access); until it is known nothing is asked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({ data: null, error: null })) }));
const access = vi.hoisted(() => ({ modules: null as Record<string, string> | null }));
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

const BIZ = "biz_store_scope_1";
const INVENTORY = `/marketplace/businesses/${BIZ}/inventory`;
const inventoryReads = () => api.apiGet.mock.calls.filter((c) => c[0] === INVENTORY).length;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://api.test.local");
    if (url.pathname.endsWith(`/commerce/businesses/${BIZ}/products`)) {
      return new Response(JSON.stringify({ data: [], total: 0, page: 1, pageSize: 100, totalPages: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith(`/bookings/businesses/${BIZ}/services`)) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ message: "not stubbed" }), { status: 404, headers: { "content-type": "application/json" } });
  }));
  api.apiGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/my-access")) return access.modules ? { data: { modules: access.modules }, error: null } : { data: null, error: "unavailable", status: 503 };
    if (path === INVENTORY) return { data: [{ productId: "p_1", quantity: 2, reserved: 0, product: { price: 99, compareAtPrice: 120 } }], error: null };
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

describe("SEC-CAT-7 the stock read follows the member's revenue level", () => {
  it("revenue 'none' (a storefront-only member): no inventory read, and no stock", async () => {
    access.modules = { storefront: "write", revenue: "none" };
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(api.apiGet.mock.calls.some((c) => String(c[0]).endsWith("/my-access"))).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(inventoryReads()).toBe(0);
    expect(result.current.stockByProduct).toBeNull();
  });

  it("level not known (the access read failed): no inventory read", async () => {
    access.modules = null;
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(inventoryReads()).toBe(0);
  });

  it("control: an owner (revenue admin) reads the stock", async () => {
    access.modules = { storefront: "admin", revenue: "admin" };
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(inventoryReads()).toBe(1));
    await waitFor(() => expect(result.current.stockByProduct?.get("p_1")).toEqual({ quantity: 2, reserved: 0 }));
  });
});
