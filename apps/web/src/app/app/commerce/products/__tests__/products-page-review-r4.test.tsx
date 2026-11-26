/**
 * CATALOG-1 web, round 4 (independent confirmations of 36068fb0).
 *
 *   Note (security)  Sales > Products followed only kf:business-changed. A business selected in another tab
 *                    reaches this tab as a storage event on kf_business_id (as Your page and useMemberModuleLevels
 *                    follow it): the list then still showed, and wrote to, the business selected before.
 *   Test gap         choosing Tracked and leaving "When out of stock" untouched sends outOfStockBehavior "hide".
 *   COR-R3-3         the new-product form starts with inventoryMode "untracked" (round 3). Switched to Package, or
 *                    saved-and-added-another as a Package, the mode was still sent, so the PACKAGE was stored with an
 *                    explicit untracked mode and stock added later no longer made it tracked (resolveInventoryMode).
 *                    The inventory fields belong to PRODUCT: a new product of another category sends neither.
 * The harness is products-page-review-r3.test.tsx's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
const nav = vi.hoisted(() => ({ search: "" }));
const ws = vi.hoisted(() => ({ businessId: "biz_r1_usd" }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost, apiPatch: api.apiPatch, apiDelete: api.apiDelete };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, refreshWorkspace: vi.fn(async () => ws.businessId), getStoredBusinessId: vi.fn(() => ws.businessId) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/products",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import ProductsPage from "../page";

const USD_BIZ = "biz_r1_usd";
const TTD_BIZ = "biz_r1_ttd";
const productsPath = (biz: string) => `/commerce/businesses/${biz}/products`;

type Row = Record<string, unknown> & { id: string; name: string; price: number; currency: string; category: string; isActive: boolean; createdAt: string };
const row = (id: string, name: string, extra: Partial<Row> = {}): Row => ({
  id, name, price: 10, currency: "USD", category: "PRODUCT", isActive: true, createdAt: "2026-11-20T10:00:00.000Z", ...extra,
});

let rowsByBiz: Record<string, Row[]> = {};
let currencyByBiz: Record<string, string | null> = {};
let myAccess: unknown = null;
let businessRead: "ok" | "fail" | "pending" = "ok";
let listFails = false;
let productRequests: string[] = [];

function mount() {
  return render(<ProductsPage />);
}

async function rowEl(name: string): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = screen.getAllByRole("article").find((a) => within(a).queryByText(name)) as HTMLElement | undefined;
    expect(found, `a row for ${name}`).toBeTruthy();
  });
  return found!;
}

beforeEach(() => {
  ws.businessId = USD_BIZ;
  nav.search = "";
  rowsByBiz = { [USD_BIZ]: [row("p_pepper", "Pepper sauce", { price: 45 })], [TTD_BIZ]: [row("p_doubles", "Doubles", { currency: "TTD" })] };
  currencyByBiz = { [USD_BIZ]: "USD", [TTD_BIZ]: "TTD" };
  myAccess = null;
  businessRead = "ok";
  listFails = false;
  productRequests = [];
  window.localStorage.clear();
  window.localStorage.setItem("kf-products-view", "list");

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://api.test.local");
    const biz = Object.keys(rowsByBiz).find((b) => url.pathname.endsWith(productsPath(b)));
    if (biz) {
      productRequests.push(url.pathname + url.search);
      if (listFails) return new Response(JSON.stringify({ message: "Database unavailable" }), { status: 500, headers: { "content-type": "application/json" } });
      const all = rowsByBiz[biz];
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Math.min(Number(url.searchParams.get("pageSize") ?? "50"), 100);
      const data = all.slice((page - 1) * pageSize, page * pageSize);
      return new Response(JSON.stringify({ data, total: all.length, page, pageSize, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "not stubbed" }), { status: 404, headers: { "content-type": "application/json" } });
  }));

  api.apiGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/my-access")) return myAccess ? { data: myAccess, error: null } : { data: null, error: "unavailable", status: 503 };
    const biz = Object.keys(currencyByBiz).find((b) => path === `/identity/businesses/${b}`);
    if (biz) {
      if (businessRead === "fail") return { data: null, error: "Business read failed", status: 500 };
      if (businessRead === "pending") return new Promise(() => {});
      return { data: { id: biz, currency: currencyByBiz[biz] }, error: null };
    }
    return { data: null, error: null };
  });
  api.apiPost.mockImplementation(async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
    const biz = Object.keys(rowsByBiz).find((b) => path === productsPath(b));
    if (!biz) return { data: null, error: "unexpected POST " + path };
    const created = row(`p_new_${rowsByBiz[biz].length}`, String(body.name), body as Partial<Row>);
    rowsByBiz[biz] = [created, ...rowsByBiz[biz]];
    return { data: created, error: null, status: 201 };
  });
  api.apiPatch.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith("/products/bulk")) return { data: { updated: (body.ids as string[]).length, action: body.action }, error: null };
    const id = path.split("/").pop();
    for (const b of Object.keys(rowsByBiz)) {
      const prev = rowsByBiz[b].find((r) => r.id === id);
      if (prev) {
        const next = { ...prev, ...body } as Row;
        rowsByBiz[b] = rowsByBiz[b].map((r) => (r.id === id ? next : r));
        return { data: next, error: null };
      }
    }
    return { data: null, error: "Not found", status: 404 };
  });
  api.apiDelete.mockImplementation(async () => ({ data: { ok: true }, error: null }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openNew() {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
  return screen.findByRole("dialog");
}

const bodyOf = (n: number) => (api.apiPost.mock.calls[n][0] as { body: Record<string, unknown> }).body;

function fillNameAndPrice(form: HTMLElement, name: string) {
  fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: name } });
  fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
}

describe("Sales > Products follows a business selected in another tab (storage on kf_business_id)", () => {
  it("the other business's products, in its currency; the first business's are gone", async () => {
    mount();
    await rowEl("Pepper sauce");
    act(() => {
      ws.businessId = TTD_BIZ;
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", oldValue: USD_BIZ, newValue: TTD_BIZ }));
    });
    await rowEl("Doubles");
    expect(screen.queryByText("Pepper sauce")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    expect(within(form).getByText(/price \(TTD\)/i)).toBeInTheDocument();
    fillNameAndPrice(form, "Aloo pie");
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect((api.apiPost.mock.calls[0][0] as { path: string }).path).toBe(productsPath(TTD_BIZ));
  });

  it("an open form for the first business is closed by the switch", async () => {
    await openNew();
    act(() => {
      ws.businessId = TTD_BIZ;
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", oldValue: USD_BIZ, newValue: TTD_BIZ }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await rowEl("Doubles");
  });

  it("control: a storage event for another key, or with the same business, does not reload the list", async () => {
    mount();
    await rowEl("Pepper sauce");
    const reads = productRequests.length;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "kf-products-view", newValue: "grid" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: USD_BIZ }));
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(productRequests.length).toBe(reads);
    expect(screen.getByText("Pepper sauce")).toBeInTheDocument();
  });
});

describe("Tracked, with 'When out of stock' left as shown", () => {
  it("Create sends inventoryMode tracked and outOfStockBehavior hide", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "tracked" } });
    expect(within(form).getByLabelText(/^when out of stock/i)).toHaveValue("hide");
    fillNameAndPrice(form, "Counted jar");
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).inventoryMode).toBe("tracked");
    expect(bodyOf(0).outOfStockBehavior).toBe("hide");
  });
});

describe("COR-R3-3 the inventory fields go with a new PRODUCT only", () => {
  it("switched to Package before Create: no inventoryMode and no outOfStockBehavior are sent", async () => {
    const form = await openNew();
    fireEvent.click(within(form).getByRole("button", { name: /package/i }));
    fillNameAndPrice(form, "Party tray");
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).category).toBe("PACKAGE");
    expect(bodyOf(0)).not.toHaveProperty("inventoryMode", "untracked");
    expect(bodyOf(0).inventoryMode).toBeUndefined();
    expect(bodyOf(0).outOfStockBehavior).toBeUndefined();
  });

  it("Tracked chosen, then switched to Package: neither is sent", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "tracked" } });
    fireEvent.click(within(form).getByRole("button", { name: /package/i }));
    fillNameAndPrice(form, "Party tray");
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).inventoryMode).toBeUndefined();
    expect(bodyOf(0).outOfStockBehavior).toBeUndefined();
  });

  it("Tracked with 'Show as sold out' chosen, then switched to Package: no behaviour is sent", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "tracked" } });
    fireEvent.change(within(form).getByLabelText(/^when out of stock/i), { target: { value: "show_oos" } });
    fireEvent.click(within(form).getByRole("button", { name: /package/i }));
    fillNameAndPrice(form, "Party tray");
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).inventoryMode).toBeUndefined();
    expect(bodyOf(0).outOfStockBehavior).toBeUndefined();
  });

  it("Save & Add Another as a Package: neither the first nor the next package sends an inventory mode", async () => {
    const form = await openNew();
    fireEvent.click(within(form).getByRole("button", { name: /package/i }));
    fillNameAndPrice(form, "Party tray");
    fireEvent.click(within(form).getByRole("button", { name: /save & add another/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const again = await screen.findByRole("dialog");
    await waitFor(() => expect(within(again).getByLabelText(/^name/i)).toHaveValue(""));
    fillNameAndPrice(again, "Lunch box");
    fireEvent.click(within(again).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(2));
    for (const n of [0, 1]) {
      expect(bodyOf(n).category).toBe("PACKAGE");
      expect(bodyOf(n).inventoryMode, `package ${n + 1}`).toBeUndefined();
      expect(bodyOf(n).outOfStockBehavior).toBeUndefined();
    }
  });

  it("control: switched to Package and back to Product, the product is created Untracked", async () => {
    const form = await openNew();
    fireEvent.click(within(form).getByRole("button", { name: /package/i }));
    fireEvent.click(within(form).getByRole("button", { name: /^product/i }));
    expect(within(form).getByLabelText(/^inventory mode/i)).toHaveValue("untracked");
    fillNameAndPrice(form, "Pepper jelly");
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).inventoryMode).toBe("untracked");
  });
});
