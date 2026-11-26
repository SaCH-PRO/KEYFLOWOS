/**
 * CATALOG-1 web, round 7: the verdicts on a2039053 (#80 7180449110, 7182060236) on Your page's store data.
 *
 *   SEC-R6-m2 / MIN-1  after A -> B -> A an Add all (or Remove all) still running on A saw isCurrent(A) true again
 *                      and carried on with the list it read before the switch, while switchTo had cleared the bulk
 *                      guard so a fresh run could start: two runs over the same products, duplicate Services (there
 *                      is no unique constraint on sourceProductId). A run now stops once it is no longer the current
 *                      run, even when its business is selected again.
 *   MIN-2              switchTo clears the bulk guard: B's own run is not refused because one was going on for A.
 *   MIN-4              the running flag is the hook's (bulkRunning), so it outlives a remount of the catalog.
 *   SEC-R6-m1          a load for a business no longer selected sends no backfill POST for it, and does not use up
 *                      the selected business's own backfill.
 * The harness is use-store-data-r6.test.tsx's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

const A = "biz_A";
const B = "biz_B";
const A_HERO = { imageUrl: "https://a.example/hero.jpg", headline: "A's hero" };

type Res<T> = { data: T | null; error: string | null };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });
const failed = <T,>(): Res<T> => ({ data: null, error: "Internal server error" });

/** A write that waits until the test releases it. */
function held<T>() {
  let release!: (v: T) => void;
  const promise = new Promise<T>((res) => { release = res; });
  return { promise, release };
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
const added = () => client.createService.mock.calls.map((c) => (c[0] as { sourceProductId: string }).sourceProductId);
const backfillsFor = (biz: string) => client.backfillStoreLinks.mock.calls.filter((c) => c[0] === biz).length;

describe("SEC-R6-m2 / MIN-1: a bulk run on A that is still going after A -> B -> A", () => {
  it("Add all: the old run makes no further createService once A is selected again", async () => {
    const hook = await loadA();
    const first = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(1));
    select(B);
    await landed(hook, B);
    select(A);
    await landed(hook, A);
    await act(async () => { first.release(ok({ id: "svc_new" })); await run; });
    await settle();
    expect(added(), "the run started before the switch carried on with its old list").toEqual([`p_${A}_1`]);
  });

  it("Add all: with a fresh run started on A, each product is created once by the fresh run", async () => {
    const hook = await loadA();
    const first = held<Res<unknown>>();
    const fresh = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => fresh.promise);
    let old!: Promise<void>;
    act(() => { old = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(1));
    select(B);
    await landed(hook, B);
    select(A);
    await landed(hook, A);
    let again!: Promise<void>;
    act(() => { again = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(2));
    await act(async () => { first.release(ok({ id: "svc_new" })); await old; });
    await settle();
    await act(async () => { fresh.release(ok({ id: "svc_new" })); await again; });
    await settle();
    // The first p_A_1 was already sent before the switch; after it, only the fresh run adds.
    expect(added(), "two runs adding the same products").toEqual([`p_${A}_1`, `p_${A}_1`, `p_${A}_2`]);
  });

  it("Remove all: the old run makes no further deleteService once A is selected again", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`, `p_${A}_2`]));
    const hook = await loadA();
    const first = held<Res<unknown>>();
    client.deleteService.mockImplementationOnce(() => first.promise);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.handleDeselectAll(); });
    await waitFor(() => expect(client.deleteService).toHaveBeenCalledTimes(1));
    select(B);
    await landed(hook, B);
    select(A);
    await landed(hook, A);
    await act(async () => { first.release(ok({})); await run; });
    await settle();
    expect(client.deleteService.mock.calls.map((c) => c[0]), "the run started before the switch carried on").toEqual([`svc_p_${A}_1`]);
  });

  it("control: an Add all with no switch adds every product once", async () => {
    const hook = await loadA();
    await act(async () => { await hook.result.current.handleSelectAll(); });
    await settle();
    expect(added()).toEqual([`p_${A}_1`, `p_${A}_2`]);
  });
});

describe("MIN-2: switchTo clears the bulk guard", () => {
  it("B's Add all runs while A's is still waiting on its answer (mutant M3: no bulkRun.current = null in switchTo)", async () => {
    const hook = await loadA();
    const first = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(1));
    select(B);
    await landed(hook, B);
    await act(async () => { await hook.result.current.handleSelectAll(); });
    expect(client.createService.mock.calls.map((c) => (c[0] as { businessId: string }).businessId), "B's run refused").toEqual([A, B]);
    expect(added()).toEqual([`p_${A}_1`, `p_${B}_1`]);
    await act(async () => { first.release(ok({ id: "svc_new" })); await run; });
    await settle();
  });
});

describe("MIN-4: the hook says whether a bulk run is going on", () => {
  it("bulkRunning is true during Add all and false once it ends", async () => {
    const hook = await loadA();
    expect(hook.result.current.bulkRunning).toBe(false);
    const first = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(hook.result.current.bulkRunning).toBe(true));
    await act(async () => { first.release(ok({ id: "svc_new" })); await run; });
    await settle();
    expect(hook.result.current.bulkRunning).toBe(false);
  });

  it("bulkRunning is true during Remove all and false once it ends", async () => {
    graphReadOf[A] = async () => ok(graphOf(A, [`p_${A}_1`]));
    const hook = await loadA();
    const first = held<Res<unknown>>();
    client.deleteService.mockImplementationOnce(() => first.promise);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.handleDeselectAll(); });
    await waitFor(() => expect(hook.result.current.bulkRunning).toBe(true));
    await act(async () => { first.release(ok({})); await run; });
    await settle();
    expect(hook.result.current.bulkRunning).toBe(false);
  });

  it("a switch to B ends A's run for the page: B's buttons are not held off by it", async () => {
    const hook = await loadA();
    const first = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(hook.result.current.bulkRunning).toBe(true));
    select(B);
    await landed(hook, B);
    expect(hook.result.current.bulkRunning).toBe(false);
    await act(async () => { first.release(ok({ id: "svc_new" })); await run; });
    await settle();
    expect(hook.result.current.bulkRunning).toBe(false);
  });

  it("an old run ending after A -> B -> A does not clear the flag of the fresh run on A", async () => {
    const hook = await loadA();
    const first = held<Res<unknown>>();
    const fresh = held<Res<unknown>>();
    client.createService.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => fresh.promise);
    let old!: Promise<void>;
    act(() => { old = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(1));
    select(B);
    await landed(hook, B);
    select(A);
    await landed(hook, A);
    let again!: Promise<void>;
    act(() => { again = hook.result.current.handleSelectAll(); });
    await waitFor(() => expect(client.createService).toHaveBeenCalledTimes(2));
    await act(async () => { first.release(ok({ id: "svc_new" })); await old; });
    await settle();
    expect(hook.result.current.bulkRunning, "the fresh run's buttons came back while it runs").toBe(true);
    await act(async () => { fresh.release(ok({ id: "svc_new" })); await again; });
    await settle();
    expect(hook.result.current.bulkRunning).toBe(false);
  });
});

describe("SEC-R6-m1: the backfill POST is made only for the business selected", () => {
  /** A reload of A's starting after B was selected: the products-changed listener of A's render, still subscribed. */
  async function staleReloadOfA() {
    const hook = await loadA();
    await settle();
    expect(backfillsFor(A)).toBe(1);
    act(() => {
      ws.businessId = B;
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
      window.dispatchEvent(new CustomEvent("kf-products-changed"));
    });
    await landed(hook, B);
    await settle();
    return hook;
  }

  it("a load for A that starts once B is selected sends no backfill for A", async () => {
    await staleReloadOfA();
    expect(backfillsFor(A), "a backfill POST for the business no longer selected").toBe(1);
  });

  it("B still runs its own backfill", async () => {
    await staleReloadOfA();
    expect(backfillsFor(B), "B's backfill used up by A's stale load").toBe(1);
  });

  it("a reload of A sends no second backfill for A (mutant: backfillRan never set)", async () => {
    const hook = await loadA();
    await settle();
    await act(async () => { await hook.result.current.loadData(); });
    await settle();
    expect(backfillsFor(A), "a backfill POST with every reload").toBe(1);
  });

  it("control: A -> B sends one backfill for each", async () => {
    const hook = await loadA();
    select(B);
    await landed(hook, B);
    await settle();
    expect(backfillsFor(A)).toBe(1);
    expect(backfillsFor(B)).toBe(1);
  });
});
