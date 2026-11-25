/**
 * CATALOG-1 web, review round 3, SEC-CAT-7 after a business switch (D-100).
 *
 * The reviewer's probe at 67035693: a member has business A { storefront: write, revenue: none } and business B
 * { revenue: admin }. Your page loads on A; another tab (or selectBusiness) selects B. useMemberModuleLevels follows
 * the selection and answers B's level (admin), while useStoreData kept businessId A, so the stock effect sent
 * GET /marketplace/businesses/biz_A/inventory with B's level: A's whole Product rows, prices included, reached a
 * member with revenue none on A.
 *
 * Your page follows the selection (kf:business-changed and the storage event): it drops A's data and reloads B, and
 * the stock read is made only for the business whose level was read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({ data: null, error: null })) }));
const ws = vi.hoisted(() => ({ businessId: "biz_A" }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, refreshWorkspace: vi.fn(async () => ws.businessId), getStoredBusinessId: vi.fn(() => ws.businessId) };
});
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

import { useStoreData } from "../use-store-data";

const A = "biz_A";
const B = "biz_B";
const inventoryReads = (biz: string) => api.apiGet.mock.calls.filter((c) => c[0] === `/marketplace/businesses/${biz}/inventory`).length;
let releaseBAccess: () => void = () => {};

beforeEach(() => {
  ws.businessId = A;
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://api.test.local");
    const biz = [A, B].find((b) => url.pathname.endsWith(`/commerce/businesses/${b}/products`));
    if (biz) {
      const data = [{ id: `p_${biz}`, name: `Item of ${biz}`, price: 5, currency: "TTD", category: "PRODUCT", isActive: true }];
      return new Response(JSON.stringify({ data, total: 1, page: 1, pageSize: 100, totalPages: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if ([A, B].some((b) => url.pathname.endsWith(`/bookings/businesses/${b}/services`))) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ message: "not stubbed" }), { status: 404, headers: { "content-type": "application/json" } });
  }));
  const bAccess = new Promise<void>((resolve) => { releaseBAccess = resolve; });
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/${A}/my-access`) return { data: { modules: { storefront: "write", revenue: "none" } }, error: null };
    if (path === `/identity/businesses/${B}/my-access`) {
      await bAccess;
      return { data: { modules: { storefront: "admin", revenue: "admin" } }, error: null };
    }
    if (path.endsWith("/inventory")) return { data: [{ productId: "p_x", quantity: 1, reserved: 0, product: { price: 99, compareAtPrice: 120 } }], error: null };
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

async function loadOnAThenSelectB(how: "event" | "storage") {
  const hook = renderHook(() => useStoreData());
  await waitFor(() => expect(hook.result.current.commerceProducts.map((p) => p.id)).toEqual([`p_${A}`]));
  await waitFor(() => expect(api.apiGet.mock.calls.some((c) => c[0] === `/identity/businesses/${A}/my-access`)).toBe(true));
  await new Promise((r) => setTimeout(r, 30));
  expect(inventoryReads(A), "no stock read on A (revenue none)").toBe(0);
  act(() => {
    ws.businessId = B;
    if (how === "event") window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
    else window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: B }));
  });
  return hook;
}

describe.each(["event", "storage"] as const)("Your page follows a business switch (%s)", (how) => {
  it("the reviewer's probe: once B's level (admin) is known, no stock read is made for A", async () => {
    await loadOnAThenSelectB(how);
    await act(async () => { releaseBAccess(); await new Promise((r) => setTimeout(r, 20)); });
    await new Promise((r) => setTimeout(r, 100));
    expect(inventoryReads(A), "GET /marketplace/businesses/biz_A/inventory under B's level").toBe(0);
  });

  it("after the switch to B: never a stock read for A; B's only once B's level is known; B's data replaces A's", async () => {
    const { result } = await loadOnAThenSelectB(how);
    await waitFor(() => expect(result.current.businessId).toBe(B));
    await waitFor(() => expect(result.current.commerceProducts.map((p) => p.id)).toEqual([`p_${B}`]));
    await new Promise((r) => setTimeout(r, 30));
    expect(inventoryReads(A), "a stock read for A after the switch").toBe(0);
    expect(inventoryReads(B), "B's stock before B's level is known").toBe(0);
    await act(async () => { releaseBAccess(); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(inventoryReads(B)).toBe(1));
    expect(inventoryReads(A)).toBe(0);
  });
});

describe("a reload of A still in flight when B is selected", () => {
  it("A's answer, arriving after the switch, does not replace B's products (a bulk add/remove reloads this way)", async () => {
    const hook = renderHook(() => useStoreData());
    await waitFor(() => expect(hook.result.current.commerceProducts.map((p) => p.id)).toEqual([`p_${A}`]));
    // The next read of A's products waits until released.
    let releaseA: () => void = () => {};
    const aHeld = new Promise<void>((r) => { releaseA = r; });
    const plain = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).getMockImplementation()!;
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes(`/commerce/businesses/${A}/products`)) await aHeld;
      return plain(input);
    });
    act(() => { void hook.result.current.loadData(); });
    act(() => {
      ws.businessId = B;
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
    });
    await waitFor(() => expect(hook.result.current.commerceProducts.map((p) => p.id)).toEqual([`p_${B}`]));
    await act(async () => { releaseA(); await new Promise((r) => setTimeout(r, 50)); });
    expect(hook.result.current.commerceProducts.map((p) => p.id)).toEqual([`p_${B}`]);
  });
});
