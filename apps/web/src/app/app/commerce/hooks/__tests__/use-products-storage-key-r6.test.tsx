/**
 * CATALOG-1 web, round 6 (SEC-R5-M2): useProducts' follow() ran on every storage event, whatever its key. With the
 * page still on A and the stored business another one (B), a storage event for an unrelated key (here the products
 * view) moved the business a write is checked against to B, so A's own answer was dropped on A's page. Only
 * kf_business_id (or null: localStorage cleared) is the selection, as Sales > Products' page filters it.
 * The harness is use-products-switch-r5.test.tsx's.
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

describe("SEC-R5-M2: a storage event for another key", () => {
  it("does not move the business a write is checked against (page on A, stored B)", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    const w = held();
    client.updateProduct.mockImplementationOnce(() => w.promise);
    let run!: Promise<unknown>;
    act(() => { run = hook.result.current.handleToggleProductActive(productOfA); });
    // The stored business differs from the page's (a selection not yet announced); the event is for another key.
    ws.businessId = B;
    window.dispatchEvent(new StorageEvent("storage", { key: "kf-products-view", newValue: "grid" }));
    await act(async () => { w.release({ data: { ...productOfA, isActive: true }, error: null }); await run; });
    expect(toast.success).toHaveBeenCalledWith("Product activated");
    expect(setProducts).toHaveBeenCalledTimes(1);
  });

  it("control: the storage event on kf_business_id does move it (the answer is dropped)", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    const w = held();
    client.updateProduct.mockImplementationOnce(() => w.promise);
    let run!: Promise<unknown>;
    act(() => { run = hook.result.current.handleToggleProductActive(productOfA); });
    ws.businessId = B;
    window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: B }));
    await act(async () => { w.release({ data: { ...productOfA, isActive: true }, error: null }); await run; });
    expect(toast.success).not.toHaveBeenCalled();
    expect(setProducts).not.toHaveBeenCalled();
  });

  it("control: localStorage cleared in another tab (key null) moves it too", async () => {
    const hook = renderHook(({ biz }) => useProducts(biz, setProducts as never), { initialProps: { biz: A as string | null } });
    const w = held();
    client.updateProduct.mockImplementationOnce(() => w.promise);
    let run!: Promise<unknown>;
    act(() => { run = hook.result.current.handleToggleProductActive(productOfA); });
    ws.businessId = B;
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    await act(async () => { w.release({ data: { ...productOfA, isActive: true }, error: null }); await run; });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
