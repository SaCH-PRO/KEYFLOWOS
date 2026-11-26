/**
 * CATALOG-1 web, round 5: the independent confirmations of 98fd98eb on Your page's store data (useStoreData).
 *
 *   COR-R4-1    "Remove all" called the single-item remove from the render closure, so its confirmation state was
 *               always the one read at render (none): each item only armed its own confirmation and nothing was
 *               deleted. After the one confirmation (catalog-manager), every live item of the business is removed,
 *               and a switch to another business stops the run.
 *   COR-R4-2    the store listing read refused with 403 (a member with the storefront module but no revenue read:
 *               the server's guard on GET store/graph) is a permission refusal, not a failed load: changes to the
 *               listing stay off and the member is told it is a permission matter, not to refresh.
 *   COR-R4-3    tests for the round 4 guards that no test held (each mutant named where it is killed).
 *   SEC-CAT-R4-2 the workspace answering a business other than the stored one switched the page without dropping
 *               the stored business's state (follow()'s reset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { DEFAULT_HOURS } from "../../components/hours-editor";

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

const writesTo = (fn: ReturnType<typeof vi.fn>, biz: string) => fn.mock.calls.filter((c) => JSON.stringify(c).includes(biz));

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

function selectB(how: "event" | "storage") {
  act(() => {
    ws.businessId = B;
    if (how === "event") window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
    else window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: B }));
  });
}

async function bLanded(hook: Hook) {
  await waitFor(() => expect(hook.result.current.businessData?.name).toBe("Shop B"));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}


const graphWithDrift = (biz: string, pid: string) => ({
  mappings: [{ productId: pid, productName: pid, serviceName: pid, serviceId: `svc_${pid}`, isLive: true, priceDrift: true, durationDrift: false, commercePrice: 9, commerceDuration: null }],
  liveCount: 1, draftCount: 0, driftCount: 1, totalProducts: 1,
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("COR-R4-1: Remove all removes every live item after the one confirmation", () => {
  it("two live items: one Remove all deletes both, for the current business", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeselectAll(); });
    await settle();
    expect(client.deleteService.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [`svc_p_${A}_1`, A],
      [`svc_p_${A}_2`, A],
    ]);
    expect(hook.result.current.confirmRemove, "an item left armed after Remove all").toBeNull();
  });

  it("a switch to B mid-run: no further delete, none for B, nothing said on B's page", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    graphReadOf[B] = async () => ok(graphOf(B, [`p_${B}_1`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    const first = held<Res<unknown>>();
    client.deleteService.mockImplementationOnce(() => first.promise);
    act(() => { void hook.result.current.handleDeselectAll(); });
    await waitFor(() => expect(client.deleteService).toHaveBeenCalledTimes(1));
    expect(client.deleteService.mock.calls[0].slice(0, 2)).toEqual([`svc_p_${A}_1`, A]);
    selectB("event");
    await bLanded(hook);
    await act(async () => { first.release(ok({})); });
    await settle();
    expect(client.deleteService, "a delete after the switch").toHaveBeenCalledTimes(1);
    expect(writesTo(client.deleteService, B)).toEqual([]);
    expect(toast.info).not.toHaveBeenCalledWith(expect.stringMatching(/removed/i));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/removed/i));
  });

  it("control: the single-item remove still asks first (arm, then delete)", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_1`); });
    expect(client.deleteService).not.toHaveBeenCalled();
    expect(hook.result.current.confirmRemove).toBe(`p_${A}_1`);
    await act(async () => { await hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_1`); });
    expect(client.deleteService).toHaveBeenCalledWith(`svc_p_${A}_1`, A);
  });
});

describe("COR-R4-2: the store listing read refused with 403 is a permission refusal", () => {
  it("listing changes stay off and the member is told it is a permission matter, not to refresh", async () => {
    graphReadOf[A] = async () => ({ data: null, error: "Forbidden", status: 403 } as Res<unknown>);
    const hook = await loadA();
    await settle();
    expect(hook.result.current.canChangeListing).toBe(false);
    expect(hook.result.current.listingRefused).toBe(true);
    await act(async () => { await hook.result.current.handleToggleStoreItem(product(A, 1) as never); });
    expect(client.createService).not.toHaveBeenCalled();
    const said = toast.error.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(said).toMatch(/permission/i);
    expect(said).not.toMatch(/refresh/i);
  });

  it("control: a listing read that failed otherwise (500) is not a permission refusal", async () => {
    graphReadOf[A] = async () => failed();
    const hook = await loadA();
    await settle();
    expect(hook.result.current.canChangeListing).toBe(false);
    expect(hook.result.current.listingRefused).toBe(false);
  });
});

describe("COR-R4-3: a write asked for A and answered after the switch says nothing on B's page", () => {
  it("A's single remove answered after the switch: no 'Removed from store.' on B (mutant: no post-await check)", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`]));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    await act(async () => { await hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_1`); });
    const del = held<Res<unknown>>();
    client.deleteService.mockImplementationOnce(() => del.promise);
    act(() => { void hook.result.current.handleDeleteServiceFromStore(`svc_p_${A}_1`); });
    await waitFor(() => expect(client.deleteService).toHaveBeenCalledTimes(1));
    selectB("event");
    await bLanded(hook);
    const aReloads = client.fetchServices.mock.calls.filter((c) => c[0] === A).length;
    await act(async () => { del.release(ok({})); });
    await settle();
    expect(toast.info).not.toHaveBeenCalledWith("Removed from store.");
    expect(client.fetchServices.mock.calls.filter((c) => c[0] === A).length, "A reloaded after the switch").toBe(aReloads);
  });

  it("A's sync answered after the switch: no 'Synced' toast on B, and B's sync button is not stuck (mutants: no post-loop check; no syncing reset)", async () => {
    graphReadOf[A] = async () => ok(graphWithDrift(A, `p_${A}_1`));
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.driftedItems).toHaveLength(1));
    const upd = held<Res<unknown>>();
    client.updateService.mockImplementationOnce(() => upd.promise);
    act(() => { void hook.result.current.syncDriftedItems(); });
    await waitFor(() => expect(hook.result.current.syncing).toBe(true));
    selectB("event");
    await bLanded(hook);
    expect(hook.result.current.syncing, "A's sync in progress shown on B").toBe(false);
    await act(async () => { upd.release(ok({})); });
    await settle();
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/^Synced/));
    expect(hook.result.current.syncing).toBe(false);
  });

  it("A's reorder answered after the switch: no 'Display order saved' on B (mutant: no toast check)", async () => {
    const hook = await loadA();
    const put = held<Res<unknown>>();
    client.updateStorefrontConfig.mockImplementationOnce(() => put.promise);
    act(() => { hook.result.current.handleReorderProducts([`p_${A}_2`, `p_${A}_1`]); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1));
    selectB("event");
    await bLanded(hook);
    await act(async () => { put.release(ok({})); });
    await settle();
    expect(toast.success).not.toHaveBeenCalledWith("Display order saved");
  });

  it("control: the reorder on A answered on A says 'Display order saved'", async () => {
    const hook = await loadA();
    act(() => { hook.result.current.handleReorderProducts([`p_${A}_2`, `p_${A}_1`]); });
    await settle();
    expect(toast.success).toHaveBeenCalledWith("Display order saved");
  });
});

describe("COR-R4-3: a read that landed once for this business stays landed", () => {
  it("a background reload whose reads fail does not turn this business's saves off (mutant: no carry-over)", async () => {
    const hook = await loadA();
    await waitFor(() => expect(hook.result.current.canChangeListing).toBe(true));
    expect(hook.result.current.canSaveBusiness).toBe(true);
    expect(hook.result.current.canSaveStorefront).toBe(true);
    bizReadOf[A] = async () => failed();
    configOf[A] = async () => failed();
    graphReadOf[A] = async () => failed();
    await act(async () => { await hook.result.current.loadData(); });
    await settle();
    expect(hook.result.current.canSaveBusiness).toBe(true);
    expect(hook.result.current.canSaveStorefront).toBe(true);
    expect(hook.result.current.canChangeListing).toBe(true);
  });
});

describe("SEC-CAT-R4-2: the workspace answers another business than the stored one", () => {
  it("the stored business's state is dropped, as on a switch", async () => {
    const refresh = held<string | null>();
    ws.refresh = () => refresh.promise;
    const hook = await loadA();
    await act(async () => {
      ws.businessId = B;
      refresh.release(B);
    });
    await bLanded(hook);
    expect(hook.result.current.businessId).toBe(B);
    const after = hook.result.current;
    expect(after.storefrontConfig.hero, "A's hero on B (B's storefront read failed)").toEqual({});
    expect(after.activeDeliveryMethodsCount, "A's delivery count on B").toBe(0);
    expect(after.businessHours).toEqual(DEFAULT_HOURS);
    expect(after.canSaveStorefront).toBe(false);
  });

  it("A's write answered after that switch says nothing on B's page", async () => {
    const refresh = held<string | null>();
    ws.refresh = () => refresh.promise;
    const hook = await loadA();
    const put = held<Res<unknown>>();
    client.updateStorefrontConfig.mockImplementationOnce(() => put.promise);
    act(() => { void hook.result.current.handleSaveConfig(); });
    await waitFor(() => expect(hook.result.current.configSaving).toBe(true));
    await act(async () => {
      ws.businessId = B;
      refresh.release(B);
    });
    await bLanded(hook);
    expect(hook.result.current.configSaving, "A's save in progress shown on B").toBe(false);
    await act(async () => { put.release(ok({})); });
    await settle();
    expect(toast.success).not.toHaveBeenCalledWith("Storefront saved!");
  });

  it("control: the workspace answering the stored business does not reload it", async () => {
    const hook = await loadA();
    await settle();
    expect(client.fetchServices.mock.calls.filter((c) => c[0] === A)).toHaveLength(1);
    expect(hook.result.current.storefrontConfig.hero).toEqual(A_HERO);
  });
});
