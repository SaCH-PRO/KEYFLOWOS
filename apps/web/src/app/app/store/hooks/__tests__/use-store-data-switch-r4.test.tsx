/**
 * CATALOG-1 web, round 4: the independent confirmations of 36068fb0 (SEC-CAT-R3-1, SEC-CAT-R3-2, COR-R3-1, COR-R3-2).
 *
 * The reviewers' scenario: business A has hours (mon 07:00) and a storefront with a hero image; business B has no
 * hours (Business.businessHours is null) and its storefront read fails. Your page loads on A, then B is selected
 * (kf:business-changed, or the storage event from another tab). At 36068fb0 follow() dropped only part of A's state
 * and B's load overwrote a field only when B's answer had it, so:
 *   - B's page showed A's hours, A's hero, A's slug and A's delivery count;
 *   - Save on the storefront sent PUT /site/businesses/biz_B/storefront with A's hero, Save hours sent
 *     PATCH /identity/businesses/biz_B with A's hours, and a reorder wrote the same stale storefront;
 *   - a slug save or a publish toggle asked for A and answered after the switch set B's slug / B's status;
 *   - A's load failing after the switch put "Failed to load store data" on B's page.
 * Now: everything of A's is dropped on the switch; saving, reordering and the store toggles wait until B's own read
 * of what they write has landed (and stay off when it failed); an answer for A after the switch is not applied.
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
  return { ...actual, refreshWorkspace: vi.fn(async () => ws.businessId), getStoredBusinessId: vi.fn(() => ws.businessId) };
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

const carriesA = (call: unknown[]) => /07:00|a\.example|A's hero|shop-a/.test(JSON.stringify(call));

describe.each(["event", "storage"] as const)("SEC-CAT-R3-1 / COR-R3-1: after a switch to B (%s)", (how) => {
  it("nothing of A's is shown for B, while B loads and once it has loaded", async () => {
    const hook = await loadA();
    act(() => { hook.result.current.setConfirmRemove(`p_${A}_1`); });
    const createHeld = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => createHeld.promise);
    act(() => { void hook.result.current.handleToggleStoreItem(product(A, 1) as never); });
    await waitFor(() => expect(hook.result.current.processingItems.has(`p_${A}_1`)).toBe(true));

    // B's business read waits, so what the page holds between the switch and B's answer is visible.
    const bBiz = held<Res<unknown>>();
    bizReadOf[B] = () => bBiz.promise;
    selectB(how);
    await waitFor(() => expect(hook.result.current.businessId).toBe(B));
    const during = hook.result.current;
    expect(during.businessHours, "A's hours while B loads").toEqual(DEFAULT_HOURS);
    expect(during.storefrontConfig.hero, "A's hero while B loads").toEqual({});
    expect(during.storeSlug, "A's slug while B loads").toBe("");
    expect(during.activeDeliveryMethodsCount, "A's delivery count while B loads").toBe(0);
    expect(during.confirmRemove, "A's pending remove confirmation").toBeNull();
    expect(during.processingItems.size, "A's item in progress").toBe(0);
    expect(during.storeEnabled, "A's store status (A is unpublished) while B loads").toBe(true);

    await act(async () => { bBiz.release(ok(bizOf[B])); });
    await bLanded(hook);
    const after = hook.result.current;
    expect(after.businessHours, "B has no hours: DEFAULT_HOURS, not A's").toEqual(DEFAULT_HOURS);
    expect(after.storefrontConfig.hero, "B's storefront read failed: A's hero must not stand in").toEqual({});
    expect(after.storeSlug).toBe("shop-b");
    expect(after.storeEnabled).toBe(true);
    expect(after.activeDeliveryMethodsCount, "B's delivery read answered nothing: not A's 2").toBe(0);
    expect(after.loadError).toBeNull();
    expect(after.processingItems.size).toBe(0);
    await act(async () => { createHeld.release(ok({ id: "svc_late" })); });
  });

  it("the reviewer's writes: nothing of A's is written to B (storefront, hours, reorder)", async () => {
    const hook = await loadA();
    selectB(how);
    await bLanded(hook);
    await act(async () => { await hook.result.current.handleSaveConfig(); });
    await act(async () => { await hook.result.current.handleSaveHours(); });
    act(() => { hook.result.current.handleReorderProducts([`p_${B}_1`]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    const toB = [...writesTo(client.updateStorefrontConfig, B), ...writesTo(client.updateBusiness, B)];
    expect(toB.filter(carriesA), "a write to B carrying A's data").toEqual([]);
    // B's storefront read failed: the storefront is not saved over (the page has nothing of B's to save).
    expect(writesTo(client.updateStorefrontConfig, B), "PUT /site/businesses/biz_B/storefront after B's read failed").toEqual([]);
    // B's business read landed: B's hours (DEFAULT_HOURS, B has none) may be saved, and only those.
    expect(writesTo(client.updateBusiness, B)).toHaveLength(1);
    expect(client.updateBusiness.mock.calls[0][0]).toMatchObject({ businessId: B, businessHours: DEFAULT_HOURS });
  });

  it("before B's reads land, no save, reorder, publish toggle, slug save or store item change is sent for B", async () => {
    const hook = await loadA();
    const bBiz = held<Res<unknown>>();
    const bGraph = held<Res<unknown>>();
    bizReadOf[B] = () => bBiz.promise;
    graphReadOf[B] = () => bGraph.promise;
    selectB(how);
    await waitFor(() => expect(hook.result.current.businessId).toBe(B));
    // Each is started, not awaited: before the fix a store item change then reloads B and waits on B's held read.
    const s = hook.result.current;
    act(() => {
      void s.handleSaveConfig();
      void s.handleSaveHours();
      s.handleReorderProducts([`p_${B}_1`]);
      void s.toggleStoreEnabled();
      s.setStoreSlug("typed-early");
    });
    act(() => {
      void hook.result.current.handleSaveSlug();
      void hook.result.current.handleToggleStoreItem(product(B, 1) as never);
      void hook.result.current.handleSelectAll();
      void hook.result.current.handleDeselectAll();
      void hook.result.current.syncDriftedItems();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    for (const fn of [client.updateStorefrontConfig, client.updateBusiness, client.createService, client.deleteService, client.updateService]) {
      expect(writesTo(fn, B), `${fn.getMockName()} for B before B's reads landed`).toEqual([]);
    }
    await act(async () => { bBiz.release(ok(bizOf[B])); bGraph.release(ok(graphOf(B))); });
  });

  it("control: on B with every read answered, B's own storefront is saved (only B's)", async () => {
    configOf[B] = async () => ok({ hero: { headline: "B's hero" }, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {} });
    const hook = await loadA();
    selectB(how);
    await bLanded(hook);
    await waitFor(() => expect(hook.result.current.storefrontConfig.hero).toEqual({ headline: "B's hero" }));
    await act(async () => { await hook.result.current.handleSaveConfig(); });
    act(() => { hook.result.current.handleReorderProducts([`p_${B}_1`]); });
    await act(async () => { await hook.result.current.toggleStoreEnabled(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(writesTo(client.updateStorefrontConfig, B)).toHaveLength(2);
    expect(writesTo(client.updateStorefrontConfig, B).filter(carriesA)).toEqual([]);
    expect(client.updateBusiness).toHaveBeenCalledWith(expect.objectContaining({ businessId: B, storeEnabled: false }));
  });
});

describe.each(["event", "storage"] as const)("a read of B that failed keeps what it would write off (%s)", (how) => {
  it("B's business read failed: no hours, slug or publish write is sent for B", async () => {
    bizReadOf[B] = async () => failed();
    const hook = await loadA();
    selectB(how);
    await waitFor(() => expect(hook.result.current.businessId).toBe(B));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await waitFor(() => expect(hook.result.current.commerceProducts.map((p) => p.id)).toEqual([`p_${B}_1`]));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    act(() => { hook.result.current.setStoreSlug("b-slug"); });
    await act(async () => {
      await hook.result.current.handleSaveHours();
      await hook.result.current.handleSaveSlug();
      await hook.result.current.toggleStoreEnabled();
    });
    expect(writesTo(client.updateBusiness, B)).toEqual([]);
    expect(hook.result.current.canSaveBusiness).toBe(false);
  });

  it("B's store listing read failed: no item is added to or removed from B's store", async () => {
    graphReadOf[B] = async () => failed();
    const hook = await loadA();
    selectB(how);
    await bLanded(hook);
    await act(async () => {
      await hook.result.current.handleToggleStoreItem(product(B, 1) as never);
      await hook.result.current.handleSelectAll();
      await hook.result.current.handleDeleteServiceFromStore(`svc_p_${B}_1`);
      await hook.result.current.handleDeleteServiceFromStore(`svc_p_${B}_1`);
    });
    expect(writesTo(client.createService, B)).toEqual([]);
    expect(writesTo(client.deleteService, B)).toEqual([]);
    expect(hook.result.current.canChangeListing).toBe(false);
  });
});

describe("COR-R3-1: hours are B's own answer, every time", () => {
  it("a reload where the business no longer has hours shows DEFAULT_HOURS, not the hours read before", async () => {
    const hook = await loadA();
    bizOf[A] = { ...(bizOf[A] as object), businessHours: null };
    bizReadOf[A] = async () => ok(bizOf[A]);
    await act(async () => { await hook.result.current.loadData(); });
    expect(hook.result.current.businessHours).toEqual(DEFAULT_HOURS);
  });
});

describe("SEC-CAT-R3-2: a write asked for A and answered after the switch is not applied to B", () => {
  it("A's slug save answered after the switch does not set B's slug", async () => {
    const hook = await loadA();
    const save = held<Res<unknown>>();
    client.updateBusiness.mockImplementationOnce(() => save.promise);
    act(() => { hook.result.current.setStoreSlug("a-new-slug"); });
    act(() => { void hook.result.current.handleSaveSlug(); });
    await waitFor(() => expect(client.updateBusiness).toHaveBeenCalledTimes(1));
    selectB("event");
    await bLanded(hook);
    await act(async () => { save.release(ok({ id: A })); await new Promise((r) => setTimeout(r, 20)); });
    expect(hook.result.current.slugSaving, "A's slug save in progress on B's page").toBe(false);
    expect(hook.result.current.storeSlug).toBe("shop-b");
    expect(hook.result.current.businessData?.slug).toBe("shop-b");
    expect(toast.success).not.toHaveBeenCalledWith("Public booking URL saved!");
  });

  it("A's publish toggle answered after the switch does not change B's status", async () => {
    const hook = await loadA();
    const save = held<Res<unknown>>();
    client.updateBusiness.mockImplementationOnce(() => save.promise);
    act(() => { void hook.result.current.toggleStoreEnabled(); });
    await waitFor(() => expect(client.updateBusiness).toHaveBeenCalledWith(expect.objectContaining({ businessId: A, storeEnabled: true })));
    bizOf[B] = { ...(bizOf[B] as object), storeEnabled: false };
    bizReadOf[B] = async () => ok(bizOf[B]);
    selectB("storage");
    await bLanded(hook);
    expect(hook.result.current.storeEnabled).toBe(false);
    await act(async () => { save.release(ok({ id: A })); await new Promise((r) => setTimeout(r, 20)); });
    expect(hook.result.current.storeEnabled, "B's status after A's answer").toBe(false);
    expect(hook.result.current.businessData?.storeEnabled).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("store:status_changed", "store", expect.anything());
  });

  it("A's hours and storefront saves answered after the switch say nothing on B's page", async () => {
    const hook = await loadA();
    const hours = held<Res<unknown>>();
    const config = held<Res<unknown>>();
    client.updateBusiness.mockImplementationOnce(() => hours.promise);
    client.updateStorefrontConfig.mockImplementationOnce(() => config.promise);
    act(() => { void hook.result.current.handleSaveHours(); void hook.result.current.handleSaveConfig(); });
    selectB("event");
    await bLanded(hook);
    expect(hook.result.current.hoursSaving, "A's hours save in progress on B's page").toBe(false);
    expect(hook.result.current.configSaving, "A's storefront save in progress on B's page").toBe(false);
    await act(async () => { hours.release(ok({ id: A })); config.release(ok({})); await new Promise((r) => setTimeout(r, 20)); });
    expect(toast.success).not.toHaveBeenCalledWith("Business hours saved!");
    expect(toast.success).not.toHaveBeenCalledWith("Storefront saved!");
    expect(emit).not.toHaveBeenCalledWith("store:hours_updated", "store", expect.anything());
    expect(emit).not.toHaveBeenCalledWith("store:config_updated", "store", expect.anything());
  });

  it("Add all on A stops at the switch: no further item of A is added after B is selected", async () => {
    const hook = await loadA();
    const first = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise);
    act(() => { void hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(1));
    selectB("event");
    await bLanded(hook);
    await act(async () => { first.release(ok({ id: "svc_1" })); await new Promise((r) => setTimeout(r, 30)); });
    expect(client.createService, "the second of A's items added after the switch").toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/added to store/));
  });
});

describe("COR-R3-2: A's load failing after the switch", () => {
  it("does not put 'Failed to load store data' on B's page", async () => {
    const hook = await loadA();
    const aServices = held<Res<unknown>>();
    servicesReadOf[A] = () => aServices.promise;
    act(() => { void hook.result.current.loadData(); });
    await waitFor(() => expect(client.fetchServices.mock.calls.filter((c) => c[0] === A)).toHaveLength(2));
    selectB("event");
    await bLanded(hook);
    await act(async () => { aServices.reject(new Error("network down")); await new Promise((r) => setTimeout(r, 20)); });
    expect(hook.result.current.loadError).toBeNull();
    expect(toast.error).not.toHaveBeenCalledWith("Failed to load store data");
  });

  it("control: B's own load failing still says so", async () => {
    const hook = await loadA();
    servicesReadOf[B] = async () => { throw new Error("network down"); };
    selectB("event");
    await waitFor(() => expect(hook.result.current.loadError).toBe("Failed to load store data. Please refresh the page."));
  });
});
