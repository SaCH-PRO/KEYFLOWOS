/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 10 (MAJOR), under D-303: what a failed or refused store-graph read leaves.
 *
 *   R10-M  the store data hook, when GET store/graph fails (500) or is refused (403: a member without the revenue read,
 *          use-store-data.ts COR-R4-2), leaves storeGraph null and liveProductIds empty: the store page reads that as
 *          "not known" (trust-copy-true-only-r10-page.test.tsx), not as "nothing is live"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const A = "biz_r10";
type Res<T> = { data: T | null; error: string | null; status?: number };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });

const client = vi.hoisted(() => ({
  getBusinessById: vi.fn(),
  fetchStorefrontConfig: vi.fn(),
  fetchServices: vi.fn(),
  fetchStaff: vi.fn(),
  fetchAllProducts: vi.fn(),
  fetchStoreGraph: vi.fn(),
  fetchStoreReadiness: vi.fn(),
  fetchStoreAnalytics: vi.fn(),
  backfillStoreLinks: vi.fn(),
}));
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/client")>()), ...client }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), apiGet: api.apiGet }));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  refreshWorkspace: vi.fn(async () => A),
  getStoredBusinessId: vi.fn(() => A),
}));
vi.mock("@/hooks/use-app-layout", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/hooks/use-app-layout")>()), useMemberModuleLevels: () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

import { useStoreData } from "../hooks/use-store-data";

const products = [
  { id: "p1", name: "Sauce", price: 5, currency: "TTD", category: "PRODUCT", isActive: true },
  { id: "p2", name: "Rub", price: 5, currency: "TTD", category: "PRODUCT", isActive: true },
];

beforeEach(() => {
  window.localStorage.clear();
  client.getBusinessById.mockImplementation(async () => ok({ id: A, name: "Pepper Co", slug: "pepper-co", storeEnabled: true }));
  client.fetchStorefrontConfig.mockImplementation(async () => ok({}));
  client.fetchServices.mockImplementation(async () => ok([{ id: "s_l1", name: "Sauce", price: 5, sourceProductId: "p1" }, { id: "s_l2", name: "Rub", price: 5, sourceProductId: "p2" }]));
  client.fetchStaff.mockImplementation(async () => ok([]));
  client.fetchAllProducts.mockImplementation(async () => ok(products));
  client.fetchStoreReadiness.mockImplementation(async () => ({ data: null, error: "x" }));
  client.fetchStoreAnalytics.mockImplementation(async () => ({ data: null, error: "x" }));
  client.backfillStoreLinks.mockImplementation(async () => {});
  api.apiGet.mockImplementation(async () => ({ data: null, error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("R10-M: a store graph not read leaves the graph null and no live ids", () => {
  for (const [name, res] of [
    ["failed (500)", { data: null, error: "Internal server error", status: 500 }],
    ["refused (403)", { data: null, error: "Forbidden", status: 403 }],
  ] as const) {
    it(name, async () => {
      client.fetchStoreGraph.mockImplementation(async () => res);
      const { result } = renderHook(() => useStoreData());
      await waitFor(() => expect(result.current.commerceProducts).toHaveLength(2), { timeout: 4000 });
      await waitFor(() => expect(client.fetchStoreGraph).toHaveBeenCalled());
      expect(result.current.storeGraph).toBeNull();
      expect(result.current.liveProductIds.size).toBe(0);
    });
  }

  it("read: the graph and its live ids", async () => {
    client.fetchStoreGraph.mockImplementation(async () => ok({ mappings: [{ productId: "p1", productName: "Sauce", serviceId: "s_l1", isLive: true, priceDrift: false, durationDrift: false }], liveCount: 1, draftCount: 0, driftCount: 0, totalProducts: 2 }));
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(result.current.storeGraph).not.toBeNull(), { timeout: 4000 });
    expect([...result.current.liveProductIds]).toEqual(["p1"]);
  });
});
