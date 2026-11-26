/**
 * CATALOG-1 web, round 6: the independent confirmations of 28b150a3 on Your page's store data (useStoreData).
 *
 *   SEC-R5-M1    the round 4 effect `currentBusiness.current = businessId` wrote the business an answer is checked
 *                against from committed state. A switch to B arriving after A's render commits and before its
 *                effects run (here: a child's effect, which runs before the hook's) had the effect move it back to
 *                A, so A's load answer was applied on B's page. Only switchTo writes it now.
 *   COR-R5-1     Remove all: the reload at the end, the one summary toast and the confirmation cleared at the start.
 *   COR-R5-2     the single remove reads the listing again after it succeeds.
 *   COR-R5-3     a second Remove all (or Add all) while one is running is ignored.
 *   COR-CAT-R4-1 a switch A -> B -> A inside one batch reset the page (skeleton, nothing landed) and nets back to
 *                A, so the load keyed on businessId never ran again: the page stayed on the skeleton.
 *   COR-CAT-R4-3 the "landed stays landed" carry-over is held by use-store-data-r5.test.tsx (the mutant is named
 *                there and in the round 6 report).
 * The harness is use-store-data-r5.test.tsx's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

const A = "biz_A";
const B = "biz_B";
const A_HOURS = { mon: { open: "07:00", close: "15:00", closed: false } };
const A_HERO = { imageUrl: "https://a.example/hero.jpg", headline: "A's hero" };

type Res<T> = { data: T | null; error: string | null };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });
const failed = <T,>(): Res<T> => ({ data: null, error: "Internal server error" });

/** A read or write that waits until the test releases it. */
function held<T>() {
  let release!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { release = res; reject = rej; });
  return { promise, release, reject };
}

const ws = vi.hoisted(() => ({ businessId: "biz_A", refresh: null as null | (() => Promise<string | null>) }));
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
  return { ...actual, refreshWorkspace: vi.fn(() => (ws.refresh ? ws.refresh() : Promise.resolve(ws.businessId))), getStoredBusinessId: vi.fn(() => ws.businessId) };
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

/** What each business answers; a test may hold or fail a read. */
let bizOf: Record<string, unknown>;
let configOf: Record<string, () => Promise<Res<unknown>>>;
let deliveryOf: Record<string, unknown>;
let productsOf: Record<string, unknown[]>;
let graphReadOf: Record<string, () => Promise<Res<unknown>>>;
let bizReadOf: Record<string, () => Promise<Res<unknown>>>;
let servicesReadOf: Record<string, () => Promise<Res<unknown>>>;

beforeEach(() => {
  ws.businessId = A;
  ws.refresh = null;
  window.localStorage.clear();
  bizOf = {
    [A]: { id: A, name: "Shop A", slug: "shop-a", storeEnabled: false, businessHours: A_HOURS },
    [B]: { id: B, name: "Shop B", slug: "shop-b", businessHours: null },
  };
  configOf = {
    [A]: async () => ok({ hero: A_HERO, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, catalog: { productOrder: [`p_${A}_1`] } }),
    [B]: async () => failed(),
  };
  deliveryOf = { [A]: { pickup: { enabled: true }, local: { enabled: true } }, [B]: null };
  productsOf = { [A]: [product(A, 1), product(A, 2)], [B]: [product(B, 1)] };
  graphReadOf = { [A]: async () => ok(graphOf(A)), [B]: async () => ok(graphOf(B)) };
  bizReadOf = { [A]: async () => ok(bizOf[A]), [B]: async () => ok(bizOf[B]) };
  servicesReadOf = { [A]: async () => ok([]), [B]: async () => ok([]) };

  client.getBusinessById.mockImplementation((biz: string) => bizReadOf[biz]());
  client.fetchStorefrontConfig.mockImplementation((biz: string) => configOf[biz]());
  client.fetchServices.mockImplementation((biz: string) => servicesReadOf[biz]());
  client.fetchStaff.mockImplementation(async () => ok([]));
  client.fetchAllProducts.mockImplementation(async (biz: string) => ok(productsOf[biz]));
  client.fetchStoreGraph.mockImplementation((biz: string) => graphReadOf[biz]());
  client.fetchStoreReadiness.mockImplementation(async () => failed());
  client.fetchStoreAnalytics.mockImplementation(async () => failed());
  client.backfillStoreLinks.mockImplementation(async () => {});
  client.updateBusiness.mockImplementation(async () => ok({ id: "x" }));
  client.updateStorefrontConfig.mockImplementation(async () => ok({}));
  client.createService.mockImplementation(async () => ok({ id: "svc_new" }));
  client.deleteService.mockImplementation(async () => ok({}));
  client.updateService.mockImplementation(async () => ok({}));
  api.apiGet.mockImplementation(async (path: string) => {
    const biz = [A, B].find((b) => path === `/marketplace/businesses/${b}/delivery-config`);
    if (biz) return { data: deliveryOf[biz] };
    return { data: null, error: null };
  });
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
  await waitFor(() => expect(hook.result.current.storefrontConfig.hero).toEqual(A_HERO));
  expect(hook.result.current.businessHours.mon.open).toBe("07:00");
  expect(hook.result.current.storeSlug).toBe("shop-a");
  expect(hook.result.current.activeDeliveryMethodsCount).toBe(2);
  return hook;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const graphReadsFor = (biz: string) => client.fetchStoreGraph.mock.calls.filter((c) => c[0] === biz).length;

describe("SEC-R5-M1: a switch landing between A's commit and A's effects", () => {
  it("A's load answer is not applied on B's page (mutant: the effect writing the ref from businessId)", async () => {
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevAct = g.IS_REACT_ACT_ENVIRONMENT;
    // React's own scheduling (no act()): effects and the next render run as separate tasks, as in a browser.
    g.IS_REACT_ACT_ENVIRONMENT = false;
    ws.refresh = () => new Promise(() => {});
    const seen: Array<{ biz: string | null; name?: string; slug: string }> = [];
    let fired = false;
    function Switcher({ biz }: { biz: string | null }) {
      // A child's effects run before its parent's: B is selected after A committed, before the hook's effects.
      useEffect(() => {
        if (biz === A && !fired) {
          fired = true;
          ws.businessId = B;
          window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
        }
      }, [biz]);
      return null;
    }
    function Harness() {
      const s = useStoreData();
      seen.push({ biz: s.businessId, name: s.businessData?.name, slug: s.storeSlug });
      return <Switcher biz={s.businessId} />;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    try {
      root.render(<Harness />);
      await vi.waitFor(() => expect(seen.some((x) => x.biz === B && x.name === "Shop B")).toBe(true), { timeout: 2000 });
      expect(fired).toBe(true);
      const aOnB = seen.filter((x) => x.biz === B && (x.name === "Shop A" || x.slug === "shop-a"));
      expect(aOnB, "A's business answer shown on B's page").toEqual([]);
    } finally {
      root.unmount();
      el.remove();
      g.IS_REACT_ACT_ENVIRONMENT = prevAct;
    }
  });
});

describe("COR-R5-1: Remove all", () => {
  it("reads the listing again for A at the end (mutant: no final loadData)", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    const before = graphReadsFor(A);
    await act(async () => { await hook.result.current.handleDeselectAll(); });
    await settle();
    expect(graphReadsFor(A)).toBe(before + 1);
  });

  it("says one summary for the run (mutant: a toast per item, or none)", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeselectAll(); });
    await settle();
    expect(toast.info.mock.calls.map((c) => c[0])).toEqual(["Removed 2 items from store."]);
  });

  it("an item armed for removal is disarmed when Remove all starts (mutant: no setConfirmRemove(null))", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_2`); });
    expect(hook.result.current.confirmRemove).toBe(`p_${A}_2`);
    const first = held<Res<unknown>>();
    client.deleteService.mockImplementationOnce(() => first.promise);
    act(() => { void hook.result.current.handleDeselectAll(); });
    await waitFor(() => expect(client.deleteService).toHaveBeenCalledTimes(1));
    expect(hook.result.current.confirmRemove, "an item still armed while Remove all runs").toBeNull();
    await act(async () => { first.release(ok({})); });
    await settle();
  });
});

describe("COR-R5-2: the single remove", () => {
  it("reads the listing again for A after it succeeds (mutant: no loadData after the remove)", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_1`); });
    const before = graphReadsFor(A);
    await act(async () => { await hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_1`); });
    await settle();
    expect(client.deleteService).toHaveBeenCalledWith(`svc_p_${A}_1`, A);
    expect(graphReadsFor(A)).toBe(before + 1);
  });
});

describe("COR-R5-3: a bulk run is not started twice", () => {
  it("a second Remove all while one runs is ignored", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    const first = held<Res<unknown>>();
    client.deleteService.mockImplementationOnce(() => first.promise);
    let one!: Promise<void>;
    let two!: Promise<void>;
    act(() => { one = hook.result.current.handleDeselectAll(); });
    await waitFor(() => expect(client.deleteService).toHaveBeenCalledTimes(1));
    act(() => { two = hook.result.current.handleDeselectAll(); });
    await settle();
    expect(client.deleteService, "a second run deleting the same item").toHaveBeenCalledTimes(1);
    await act(async () => { first.release(ok({})); await one; await two; });
    await settle();
    expect(client.deleteService.mock.calls.map((c) => c[0])).toEqual([`svc_p_${A}_1`, `svc_p_${A}_2`]);
  });

  it("a second Add all while one runs is ignored", async () => {
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    const first = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise);
    let one!: Promise<void>;
    let two!: Promise<void>;
    act(() => { one = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(1));
    act(() => { two = hook.result.current.handleSelectAll(); });
    await settle();
    expect(client.createService, "a second run adding the same item").toHaveBeenCalledTimes(1);
    await act(async () => { first.release(ok({ id: "svc_new" })); await one; await two; });
    await settle();
    expect(client.createService.mock.calls.map((c) => (c[0] as { sourceProductId: string }).sourceProductId)).toEqual([`p_${A}_1`, `p_${A}_2`]);
  });

  it("control: a Remove all after the first has finished runs", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeselectAll(); });
    await act(async () => { await hook.result.current.handleDeselectAll(); });
    expect(client.deleteService).toHaveBeenCalledTimes(2);
  });
});

describe("COR-CAT-R4-1: a switch A -> B -> A in one batch", () => {
  it("A is read again and the skeleton clears", async () => {
    const hook = await loadA();
    await settle();
    const before = graphReadsFor(A);
    act(() => {
      ws.businessId = B;
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
      ws.businessId = A;
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: A } }));
    });
    await waitFor(() => expect(graphReadsFor(A)).toBe(before + 1));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await waitFor(() => expect(hook.result.current.canSaveStorefront).toBe(true));
    expect(hook.result.current.storefrontConfig.hero).toEqual(A_HERO);
    expect(hook.result.current.storeSlug).toBe("shop-a");
  });
});
