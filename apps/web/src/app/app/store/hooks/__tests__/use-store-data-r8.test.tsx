/**
 * CATALOG-1 web, round 8: SEC-R7-m1 / MIN-B (both round-7 reviews) on Your page's store data.
 *
 *   The early `if (stale()) return;` at the top of loadData had no test: keying backfillRan by business already blocked
 *   A's backfill in the order round 7 tested (A's stale load ran before B's). Here B's load has already set
 *   backfillRan to B when a load closure for A starts (a caller holding A's loadData, such as a handler of A's render):
 *   it sends no backfill POST for A and leaves B's loading and loadError alone.
 * The harness is use-store-data-r7.test.tsx's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

const A = "biz_A";
const B = "biz_B";
const A_HERO = { imageUrl: "https://a.example/hero.jpg", headline: "A's hero" };

type Res<T> = { data: T | null; error: string | null };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });
const failed = <T,>(): Res<T> => ({ data: null, error: "Internal server error" });

const ws = vi.hoisted(() => ({ businessId: "biz_A" }));
const client = vi.hoisted(() => ({
  getBusinessById: vi.fn().mockName("getBusinessById"),
  updateBusiness: vi.fn().mockName("updateBusiness"),
  fetchStorefrontConfig: vi.fn().mockName("fetchStorefrontConfig"),
  updateStorefrontConfig: vi.fn().mockName("updateStorefrontConfig"),
  fetchServices: vi.fn().mockName("fetchServices"),
  fetchStaff: vi.fn().mockName("fetchStaff"),
  fetchAllProducts: vi.fn().mockName("fetchAllProducts"),
  fetchStoreGraph: vi.fn().mockName("fetchStoreGraph"),
  fetchStoreReadiness: vi.fn().mockName("fetchStoreReadiness"),
  fetchStoreAnalytics: vi.fn().mockName("fetchStoreAnalytics"),
  backfillStoreLinks: vi.fn().mockName("backfillStoreLinks"),
  createService: vi.fn().mockName("createService"),
  deleteService: vi.fn().mockName("deleteService"),
  updateService: vi.fn().mockName("updateService"),
}));
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
const emit = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, ...client };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, refreshWorkspace: vi.fn(() => Promise.resolve(ws.businessId)), getStoredBusinessId: vi.fn(() => ws.businessId) };
});
vi.mock("@/hooks/use-app-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-app-layout")>();
  return { ...actual, useMemberModuleLevels: () => null };
});
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => emit }));
vi.mock("sonner", () => ({ toast }));

import { useStoreData } from "../use-store-data";

const product = (biz: string, n = 1) => ({ id: `p_${biz}_${n}`, name: `Item ${n} of ${biz}`, price: 5, currency: "TTD", category: "PRODUCT", isActive: true });
const graphOf = (biz: string, live: string[] = []) => ({
  mappings: live.map((pid) => ({ productId: pid, productName: pid, serviceId: `svc_${pid}`, isLive: true, priceDrift: false, durationDrift: false })),
  liveCount: live.length, draftCount: 0, driftCount: 0, totalProducts: live.length,
});

let graphReadOf: Record<string, () => Promise<Res<unknown>>>;

beforeEach(() => {
  ws.businessId = A;
  window.localStorage.clear();
  const bizOf: Record<string, unknown> = {
    [A]: { id: A, name: "Shop A", slug: "shop-a", businessHours: null },
    [B]: { id: B, name: "Shop B", slug: "shop-b", businessHours: null },
  };
  const productsOf: Record<string, unknown[]> = { [A]: [product(A, 1), product(A, 2)], [B]: [product(B, 1)] };
  graphReadOf = { [A]: async () => ok(graphOf(A)), [B]: async () => ok(graphOf(B)) };

  client.getBusinessById.mockImplementation(async (biz: string) => ok(bizOf[biz]));
  client.fetchStorefrontConfig.mockImplementation(async (biz: string) =>
    biz === A ? ok({ hero: A_HERO, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {} }) : failed());
  client.fetchServices.mockImplementation(async () => ok([]));
  client.fetchStaff.mockImplementation(async () => ok([]));
  client.fetchAllProducts.mockImplementation(async (biz: string) => ok(productsOf[biz]));
  client.fetchStoreGraph.mockImplementation((biz: string) => graphReadOf[biz]());
  client.fetchStoreReadiness.mockImplementation(async () => failed());
  client.fetchStoreAnalytics.mockImplementation(async () => failed());
  client.backfillStoreLinks.mockImplementation(async () => {});
  client.createService.mockImplementation(async () => ok({ id: "svc_new" }));
  client.deleteService.mockImplementation(async () => ok({}));
  api.apiGet.mockImplementation(async () => ({ data: null, error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useStoreData>, unknown>>;

async function loadA(): Promise<Hook> {
  const hook = renderHook(() => useStoreData());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
  expect(hook.result.current.businessId).toBe(A);
  return hook;
}

function select(biz: string) {
  act(() => {
    ws.businessId = biz;
    window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: biz } }));
  });
}

/** The selected business's reads have landed: a listing change is allowed again. */
async function landed(hook: Hook, biz: string) {
  await waitFor(() => expect(hook.result.current.businessId).toBe(biz));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const backfillsFor = (biz: string) => client.backfillStoreLinks.mock.calls.filter((c) => c[0] === biz).length;

describe("SEC-R7-m1 / MIN-B: a load closure for A starting after B's load has run", () => {
  /** A is loaded, A's loadData is kept, then B is selected and its load (and backfill) has run. */
  async function heldLoadOfAThenB() {
    const hook = await loadA();
    await settle();
    expect(backfillsFor(A)).toBe(1);
    const loadOfA = hook.result.current.loadData;
    select(B);
    await landed(hook, B);
    await settle();
    expect(backfillsFor(B)).toBe(1);
    return { hook, loadOfA };
  }

  it("sends no backfill POST for A", async () => {
    const { loadOfA } = await heldLoadOfAThenB();
    await act(async () => { await loadOfA(true); });
    await settle();
    expect(backfillsFor(A), "a backfill POST for the business no longer selected").toBe(1);
    expect(client.backfillStoreLinks.mock.calls.map((c) => c[0])).toEqual([A, B]);
  });

  it("reads nothing for A", async () => {
    const { loadOfA } = await heldLoadOfAThenB();
    const readsOfA = () => client.fetchServices.mock.calls.filter((c) => c[0] === A).length;
    const before = readsOfA();
    await act(async () => { await loadOfA(true); });
    await settle();
    expect(readsOfA(), "a load started for the business no longer selected").toBe(before);
  });

  it("leaves B's loading alone", async () => {
    const { hook, loadOfA } = await heldLoadOfAThenB();
    await act(async () => { await loadOfA(true); });
    await settle();
    expect(hook.result.current.businessId).toBe(B);
    expect(hook.result.current.loading, "B's page put back on its loader by A's load").toBe(false);
  });

  it("leaves B's loadError alone", async () => {
    client.fetchServices.mockImplementation(async (biz: string) => {
      if (biz === B) throw new Error("services read failed");
      return ok([]);
    });
    const hook = await loadA();
    await settle();
    const loadOfA = hook.result.current.loadData;
    select(B);
    // B's load failed, so its listing never opens: wait on the error instead of landed().
    await waitFor(() => expect(hook.result.current.businessId).toBe(B));
    await waitFor(() => expect(hook.result.current.loadError).toBe("Failed to load store data. Please refresh the page."));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await settle();
    expect(backfillsFor(B)).toBe(1);
    await act(async () => { await loadOfA(true); });
    await settle();
    expect(hook.result.current.businessId).toBe(B);
    expect(hook.result.current.loadError, "B's load error cleared by A's load").toBe("Failed to load store data. Please refresh the page.");
  });

  it("control: B's own loadData still runs a load for B", async () => {
    const { hook } = await heldLoadOfAThenB();
    const readsOfB = () => client.fetchServices.mock.calls.filter((c) => c[0] === B).length;
    const before = readsOfB();
    await act(async () => { await hook.result.current.loadData(); });
    await settle();
    expect(readsOfB()).toBe(before + 1);
    expect(backfillsFor(B)).toBe(1);
  });
});
