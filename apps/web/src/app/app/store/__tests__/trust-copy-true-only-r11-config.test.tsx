/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 11 (R11-1), under D-303: the store data hook says whether the storefront
 * config was read, so the store page can tell "nothing hidden" from "not known" (an unread config is emptyStorefront).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const A = "biz_r11";
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

const GRAPH = { mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 2 };

describe("R11-1: storefrontConfigRead", () => {
  it("false while the config read fails", async () => {
    client.fetchStoreGraph.mockImplementation(async () => ok(GRAPH));
    client.fetchStorefrontConfig.mockImplementation(async () => ({ data: null, error: "Internal server error", status: 500 }));
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(result.current.storeGraph).not.toBeNull(), { timeout: 4000 });
    await waitFor(() => expect(client.fetchStorefrontConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.storefrontConfigRead).toBe(false);
  });

  it("true once it is read", async () => {
    client.fetchStoreGraph.mockImplementation(async () => ok(GRAPH));
    client.fetchStorefrontConfig.mockImplementation(async () => ok({ catalog: { itemOverrides: {} } }));
    const { result } = renderHook(() => useStoreData());
    await waitFor(() => expect(result.current.storefrontConfigRead).toBe(true), { timeout: 4000 });
  });
});
