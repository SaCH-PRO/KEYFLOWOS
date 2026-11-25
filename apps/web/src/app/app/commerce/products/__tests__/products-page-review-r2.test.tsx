/**
 * CATALOG-1 web, review round 2: Sales > Products.
 *   4. A new product is created with the inventory settings the form shows ("Tracked", out of stock "Hide from
 *      storefront"); it was stored with neither (null), which the server reads as untracked. An edit of a product
 *      whose stored mode is null, saved without touching those fields, still sends no inventory mode.
 *   5. A product whose stored image link is a legacy http:// address can be edited (the link kept as it is) without
 *      clearing it; the link is checked only when changed, and a non-https link is never previewed.
 *   6. SEC-CAT-5 leftover: a create still in flight when the business is switched does not land in the other
 *      business's list.
 * The harness is products-page-review-r1.test.tsx's.
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

describe("4. a new product is created with the inventory settings the form shows", () => {
  // Re-pinned in round 3 (orchestrator ruling COR-CAT-R2-1): the form's default is Untracked, shown and sent.
  it("defaults untouched: what the form shows (Untracked) is sent, with no out-of-stock behaviour", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    expect(within(form).getByLabelText(/^inventory mode/i)).toHaveValue("untracked");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const body = (api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body.inventoryMode).toBe("untracked");
    expect(body.outOfStockBehavior).toBeUndefined();
  });

  it("untracked chosen: no out-of-stock behaviour is sent with it", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Gift card" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "untracked" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const body = (api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body.inventoryMode).toBe("untracked");
    expect(body.outOfStockBehavior).toBeUndefined();
  });

  it("control: an edit of a product stored with no mode, saved without touching inventory, sends no inventory mode", async () => {
    rowsByBiz[USD_BIZ] = [row("p_null", "Legacy jar", { inventoryMode: null, outOfStockBehavior: null })];
    mount();
    await openRowAction("Legacy jar", /^edit/i);
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "11" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    const body = api.apiPatch.mock.calls[0][1] as Record<string, unknown>;
    expect(body.inventoryMode).toBeUndefined();
    expect(body.outOfStockBehavior).toBeUndefined();
  });
});

describe("5. a legacy http:// image link does not block an edit", () => {
  it("unchanged http:// link: the edit saves, keeps the link, and does not preview it", async () => {
    rowsByBiz[USD_BIZ] = [row("p_http", "Old photo", { imageUrl: "http://old.example.com/p.png" })];
    mount();
    await openRowAction("Old photo", /^edit/i);
    const form = await screen.findByRole("dialog");
    expect(form.querySelector('img[src^="http:"]')).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "12" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch.mock.calls[0][1]).toMatchObject({ price: 12, imageUrl: "http://old.example.com/p.png" });
  });

  it("control: changing it to another http:// link is refused", async () => {
    rowsByBiz[USD_BIZ] = [row("p_http", "Old photo", { imageUrl: "http://old.example.com/p.png" })];
    mount();
    await openRowAction("Old photo", /^edit/i);
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^image link/i), { target: { value: "http://new.example.com/q.png" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/https:\/\//i);
    expect(api.apiPatch).not.toHaveBeenCalled();
  });
});

describe("6. a create in flight across a business switch", () => {
  it("business A's new product does not appear in business B's list", async () => {
    let settle: (v: unknown) => void = () => {};
    api.apiPost.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "A only" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "5" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    act(() => {
      ws.businessId = TTD_BIZ;
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: TTD_BIZ } }));
    });
    await rowEl("Doubles");
    await act(async () => {
      settle({ data: row("p_a_only", "A only"), error: null, status: 201 });
      await new Promise((r) => setTimeout(r, 20));
    });
    // The switch closed the form (its exit animation runs first); then nothing names A's product.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getAllByRole("article").filter((a) => within(a).queryByText("A only"))).toHaveLength(0);
    expect(screen.queryByText("A only")).toBeNull();
    expect(await rowEl("Doubles")).toBeInTheDocument();
  });
});
