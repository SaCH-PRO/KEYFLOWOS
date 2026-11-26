/**
 * CATALOG-1 web, round 5 (SEC-CAT-R4-1): useProducts' create, update and archive drop an answer that arrives after
 * the business changed (round 2). The other three writes did not: toggling a product active, duplicating it and the
 * inline save asked for business A and, answered after B was selected, said "Product activated" / "Product
 * duplicated" / "Product updated" on B's page, put A's row into B's list and announced the change for B.
 * Also: the business a write is checked against followed the page's businessId in an effect, i.e. only once the page
 * had rendered with the new business. It now follows the selection itself (kf:business-changed, and the storage
 * event from another tab), so an answer landing between the switch and that render is dropped too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const A = "biz_A";
const B = "biz_B";

type Res = { data: unknown; error: string | null; status?: number };
function held() {
  let release!: (v: Res) => void;
  const promise = new Promise<Res>((res) => { release = res; });
  return { promise, release };
}

const ws = vi.hoisted(() => ({ businessId: "biz_A" }));
const client = vi.hoisted(() => ({ createProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn() }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const sync = vi.hoisted(() => ({ notifyProductsChanged: vi.fn() }));
const events = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, ...client };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, getStoredBusinessId: vi.fn(() => ws.businessId) };
});
vi.mock("@/lib/product-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/product-sync")>();
  return { ...actual, notifyProductsChanged: sync.notifyProductsChanged };
});
vi.mock("@/lib/module-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/module-events")>();
  return { ...actual, moduleEvents: { emit: events.emit } };
});
vi.mock("sonner", () => ({ toast }));

import { useProducts } from "../use-products";
import type { Product } from "@/lib/client";

const productOfA = { id: "p_A_1", name: "Pepper sauce", price: 45, currency: "TTD", category: "PRODUCT", isActive: false } as unknown as Product;
const formOf = { name: "Pepper sauce", description: "", price: "50", category: "PRODUCT" as const, duration: "", imageUrl: "", sku: "", isActive: true };

let setProducts: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ws.businessId = A;
  setProducts = vi.fn();
  client.updateProduct.mockImplementation(async () => ({ data: { ...productOfA, isActive: true }, error: null }));
  client.createProduct.mockImplementation(async () => ({ data: { ...productOfA, id: "p_copy" }, error: null }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Write = "toggle" | "duplicate" | "inline";
function start(hook: { result: { current: ReturnType<typeof useProducts> } }, write: Write): Promise<unknown> {
  const h = hook.result.current;
  if (write === "toggle") return h.handleToggleProductActive(productOfA);
  if (write === "duplicate") return h.handleDuplicateProduct(productOfA);
  return h.handleInlineSave(productOfA.id, formOf);
}
function hold(write: Write) {
  const w = held();
  (write === "duplicate" ? client.createProduct : client.updateProduct).mockImplementationOnce(() => w.promise);
  return w;
}
const answerFor = (write: Write): Res => ({ data: write === "duplicate" ? { ...productOfA, id: "p_copy" } : { ...productOfA, isActive: true }, error: null });

function nothingSaidOrApplied() {
  expect(toast.success, "a success toast on B's page for A's write").not.toHaveBeenCalled();
  expect(setProducts, "A's row applied to B's list").not.toHaveBeenCalled();
  expect(sync.notifyProductsChanged, "a product change announced for B").not.toHaveBeenCalled();
  expect(events.emit, "a commerce event for B").not.toHaveBeenCalled();
}

describe.each(["toggle", "duplicate", "inline"] as const)("SEC-CAT-R4-1: %s asked for A, answered after B is selected", (write) => {
  it("the page re-rendered with B: nothing is said or applied", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    const w = hold(write);
    let run!: Promise<unknown>;
    act(() => { run = start(hook, write); });
    ws.businessId = B;
    hook.rerender({ biz: B });
    await act(async () => { w.release(answerFor(write)); await run.catch(() => {}); });
    nothingSaidOrApplied();
  });

  it.each(["event", "storage"] as const)("before the page re-renders (%s): nothing is said or applied", async (how) => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    const w = hold(write);
    let run!: Promise<unknown>;
    act(() => { run = start(hook, write); });
    // The selection changes; the page has not rendered with B yet (its businessId prop is still A).
    ws.businessId = B;
    if (how === "event") window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
    else window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: B }));
    await act(async () => { w.release(answerFor(write)); await run.catch(() => {}); });
    nothingSaidOrApplied();
  });

  it("control: no switch, the write is applied and said", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    await act(async () => { await start(hook, write); });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(setProducts).toHaveBeenCalledTimes(1);
    expect(sync.notifyProductsChanged).toHaveBeenCalledTimes(1);
  });
});

describe("the selection check also covers update (round 2's guard), before the page re-renders", () => {
  it("Save on an edit asked for A, answered after kf:business-changed: nothing applied", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    act(() => { hook.result.current.openEditProduct(productOfA); });
    const w = hold("toggle");
    let run!: Promise<unknown>;
    act(() => { run = hook.result.current.handleSaveProduct(); });
    ws.businessId = B;
    window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: B } }));
    await act(async () => { w.release(answerFor("toggle")); await run; });
    nothingSaidOrApplied();
  });

  it("control: a storage event for another key changes nothing", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    const w = hold("toggle");
    let run!: Promise<unknown>;
    act(() => { run = start(hook, "toggle"); });
    window.dispatchEvent(new StorageEvent("storage", { key: "kf-products-view", newValue: "grid" }));
    await act(async () => { w.release(answerFor("toggle")); await run; });
    expect(toast.success).toHaveBeenCalledWith("Product activated");
  });
});
