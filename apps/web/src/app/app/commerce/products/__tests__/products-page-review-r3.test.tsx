/**
 * CATALOG-1 web, review round 3 (COR-CAT-R2-1, reverses round 2's item 4).
 *
 * Round 2 created a new product as tracked + "hide" when the owner left the defaults. With no stock rows it has
 * nothing available, so the public store (CatalogService.projectAvailability) hides it: the owner adds it to the store
 * and customers never see it, with nothing on screen saying why. Now:
 *   - a new PRODUCT defaults to Untracked, shown and sent; it is listed and counted with no stock;
 *   - choosing Tracked says "Starts with 0 in stock: hidden from your store until you add stock", with a link to
 *     Inventory (/app/inventory);
 *   - editing a product whose stored mode is null shows "Not set" (not "Tracked / Hide"), and saving it untouched
 *     sends no mode, so it stays as the server reads it.
 * The harness is products-page-review-r1.test.tsx's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

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
import { countStoreItems } from "../../../store/components/launch-mode";

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

async function openRowAction(name: string, action: RegExp) {
  fireEvent.click(within(await rowEl(name)).getByRole("button", { name: /more actions/i }));
  fireEvent.click(await screen.findByRole("menuitem", { name: action }));
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

describe("COR-CAT-R2-1 a new product defaults to Untracked", () => {
  it("the form shows Untracked and no out-of-stock choice; Create sends untracked and no behaviour", async () => {
    const form = await openNew();
    expect(within(form).getByLabelText(/^inventory mode/i)).toHaveValue("untracked");
    expect(within(form).queryByLabelText(/^when out of stock/i)).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const body = (api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body.inventoryMode).toBe("untracked");
    expect(body.outOfStockBehavior).toBeUndefined();
  });

  it("created with the defaults, then added to the store: Launch counts it with no stock rows (the store shows it)", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const body = (api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    const created = { id: "p_created", isActive: true, ...body } as never;
    const listing = { id: "svc_listing", name: "Pepper jelly", price: 25, sourceProductId: "p_created" } as never;
    expect(countStoreItems([listing], [created], new Map())).toBe(1);
  });

  it("choosing Tracked says the product starts with 0 in stock and is hidden until stock is added, with a link to Inventory", async () => {
    const form = await openNew();
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "tracked" } });
    expect(within(form).getByText(/starts with 0 in stock: hidden from your store until you add stock/i)).toBeInTheDocument();
    expect(within(form).getByRole("link", { name: /inventory/i })).toHaveAttribute("href", "/app/inventory");
  });

  it("control: Untracked shows no such hint", async () => {
    const form = await openNew();
    expect(within(form).queryByText(/starts with 0 in stock/i)).toBeNull();
  });
});

describe("a product stored with no inventory mode", () => {
  it("Edit shows 'Not set' (not Tracked / Hide); saving untouched sends no mode", async () => {
    rowsByBiz[USD_BIZ] = [row("p_null", "Legacy jar", { inventoryMode: null, outOfStockBehavior: null })];
    mount();
    await openRowAction("Legacy jar", /^edit/i);
    const form = await screen.findByRole("dialog");
    const select = within(form).getByLabelText(/^inventory mode/i) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toMatch(/not set/i);
    expect(within(form).queryByLabelText(/^when out of stock/i)).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "11" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect((api.apiPatch.mock.calls[0][1] as Record<string, unknown>).inventoryMode).toBeUndefined();
  });

  it("control: a product stored as tracked shows Tracked and its behaviour", async () => {
    rowsByBiz[USD_BIZ] = [row("p_tr", "Counted jar", { inventoryMode: "tracked", outOfStockBehavior: "show_oos" })];
    mount();
    await openRowAction("Counted jar", /^edit/i);
    const form = await screen.findByRole("dialog");
    expect(within(form).getByLabelText(/^inventory mode/i)).toHaveValue("tracked");
    expect(within(form).getByLabelText(/^when out of stock/i)).toHaveValue("show_oos");
  });
});
