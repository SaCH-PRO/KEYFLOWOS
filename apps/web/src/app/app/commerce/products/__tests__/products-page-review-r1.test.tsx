/**
 * CATALOG-1 web, review round 1 (b3e6567d): Sales > Products, the findings closed here.
 *
 *   SEC-CAT-1  a member with revenue "read" is offered no write (New product, Edit, Archive, bulk); unknown still
 *              is; a 403 on a write says the module refusal.
 *   SEC-CAT-6  no New product while the page could not load.
 *   SEC-CAT-2  bulk removal is "Archive", asked first, like a single archive.
 *   SEC-CAT-3  an image link is https:// only.
 *   SEC-CAT-5  a business switch (kf:business-changed) clears and reloads the list and the currency.
 *   COR-CAT-7  a failed currency read keeps the list; only New product is off, with a currency message.
 *   COR-CAT-3  New product here is a product (category PRODUCT); the Service card is not offered for a new one
 *              (services are made in Schedule > Services); an existing SERVICE-category product keeps its card.
 *   COR-CAT-4  Edit shows the price in the product's own currency.
 *   COR-CAT-5  every product is listed (the list read is paged).
 *   COR-CAT-6  inventory mode and out-of-stock behaviour are sent; clearing description or SKU sends null.
 *   COR-CAT-12 an archive refusal says the server's reason; a 404 (already archived) drops the row.
 *   COR-CAT-9  clearing the image link sends null; New product only once the currency is known.
 *   SEC-CAT-4  a one-time, dismissible notice when this browser kept product photos (IndexedDB
 *              "keyflow-product-images" exists), found without opening the database.
 *
 * Mounted on the real page, hook, panel and form; only the HTTP edge (lib/api and fetch), the workspace lookup and
 * the router are stubbed.
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

const READ_ONLY_REFUSAL = "Insufficient permissions: revenue requires write access (you have read)";

describe("SEC-CAT-1 a revenue 'read' member is offered no write", () => {
  it("revenue read: the list shows, with no New product, no More actions, no Bulk select and no Add product", async () => {
    myAccess = { modules: { revenue: "read" } };
    mount();
    await rowEl("Pepper sauce");
    await waitFor(() => expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull());
    expect(screen.queryByRole("button", { name: /^new product$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /bulk select/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^add product$/i })).toBeNull();
    expect(screen.getByText(/changing products needs revenue write access/i)).toBeInTheDocument();
  });

  it("revenue read: opening a product opens nothing to edit", async () => {
    myAccess = { modules: { revenue: "read" } };
    mount();
    const r = await rowEl("Pepper sauce");
    await waitFor(() => expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull());
    fireEvent.click(within(r).getByRole("button", { name: /^open pepper sauce/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("control: an unknown level (the access read failed) still offers New product and the row actions", async () => {
    myAccess = null;
    mount();
    await rowEl("Pepper sauce");
    expect(await screen.findByRole("button", { name: /^new product$/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /more actions/i }).length).toBeGreaterThan(0);
  });

  it("a 403 on create says the module refusal (needs revenue write access)", async () => {
    api.apiPost.mockResolvedValueOnce({ data: null, error: READ_ONLY_REFUSAL, status: 403 });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Hot sauce" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "9" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    expect(await within(form).findByText(/you can't add products in this business: it needs revenue write access/i)).toBeInTheDocument();
  });

  it("a 403 on update says the module refusal", async () => {
    api.apiPatch.mockResolvedValueOnce({ data: null, error: READ_ONLY_REFUSAL, status: 403 });
    mount();
    await openRowAction("Pepper sauce", /^edit/i);
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "50" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    expect(await within(form).findByText(/you can't change products in this business: it needs revenue write access/i)).toBeInTheDocument();
  });
});

describe("SEC-CAT-6 / COR-CAT-7 / COR-CAT-9 New product needs a loaded page and a known currency", () => {
  it("SEC-CAT-6: the list failed to load: no New product, and ?action=add opens nothing", async () => {
    listFails = true;
    nav.search = "action=add";
    mount();
    expect(await screen.findByText(/your products could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new product$/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("COR-CAT-7: the currency read failed but the list loaded: the list shows, New product is off with a currency message", async () => {
    businessRead = "fail";
    nav.search = "action=add";
    mount();
    await rowEl("Pepper sauce");
    expect(await screen.findByText(/currency could not be read/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new product$/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("COR-CAT-9: while the currency is not known yet, there is no New product", async () => {
    businessRead = "pending";
    mount();
    await rowEl("Pepper sauce");
    expect(screen.queryByRole("button", { name: /^new product$/i })).toBeNull();
  });
});

describe("SEC-CAT-2 bulk removal is Archive, asked first", () => {
  it("Bulk select > Archive asks, names how many, and archives only on confirm", async () => {
    mount();
    await rowEl("Pepper sauce");
    fireEvent.click(screen.getByRole("button", { name: /bulk select/i }));
    fireEvent.click(screen.getByRole("button", { name: /^select$/i }));
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/archive 1 product\?/i);
    expect(dialog).toHaveTextContent(/restore .* from trash/i);
    expect(api.apiPatch).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledWith(`${productsPath(USD_BIZ)}/bulk`, { ids: ["p_pepper"], action: "delete" }));
  });
});

describe("SEC-CAT-3 an image link is https:// only", () => {
  it.each(["javascript:alert(1)", "//evil.example/x.png", "http://example.com/x.png", "not a link", "data:image/png;base64,AAAA"])(
    "%j is refused with a message saying what is accepted, and nothing is created",
    async (value) => {
      mount();
      fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
      const form = await screen.findByRole("dialog");
      expect(within(form).getByText(/https:\/\//i)).toBeInTheDocument();
      fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
      fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
      fireEvent.change(within(form).getByLabelText(/^image link/i), { target: { value: value } });
      fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
      expect(await within(form).findByRole("alert")).toHaveTextContent(/https:\/\//i);
      expect(api.apiPost).not.toHaveBeenCalled();
    },
  );

  it("control: an https link is saved", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.change(within(form).getByLabelText(/^image link/i), { target: { value: "  https://cdn.example.com/jelly.png  " } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect((api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body.imageUrl).toBe("https://cdn.example.com/jelly.png");
  });
});

describe("SEC-CAT-5 a business switch reloads the list and the currency", () => {
  it("kf:business-changed: the other business's products, in its currency; the first business's are gone", async () => {
    mount();
    await rowEl("Pepper sauce");
    act(() => {
      ws.businessId = TTD_BIZ;
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: TTD_BIZ } }));
    });
    await rowEl("Doubles");
    expect(screen.queryByText("Pepper sauce")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    expect(within(form).getByText(/price \(TTD\)/i)).toBeInTheDocument();
    expect(within(form).queryByText(/\bUSD\b/)).toBeNull();
  });
});

describe("COR-CAT-3 New product here is a product", () => {
  it("New product starts as a Product, offers no Service card, and is created with category PRODUCT", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    expect(within(form).getByRole("button", { name: /^product\b/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(form).queryByRole("button", { name: /^service\b/i })).toBeNull();
    expect(within(form).getByText(/schedule > services/i)).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect((api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body.category).toBe("PRODUCT");
  });

  it("an existing SERVICE-category product keeps its Service card on Edit (nothing is silently recategorised)", async () => {
    rowsByBiz[USD_BIZ] = [row("p_consult", "Consultation", { category: "SERVICE", duration: 60 })];
    mount();
    await openRowAction("Consultation", /^edit/i);
    const form = await screen.findByRole("dialog");
    expect(within(form).getByRole("button", { name: /^service\b/i })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("COR-CAT-4 Edit shows the product's own currency", () => {
  it("a TTD product on a USD business: Edit says Price (TTD)", async () => {
    rowsByBiz[USD_BIZ] = [row("p_old", "Old stock", { currency: "TTD" })];
    mount();
    await openRowAction("Old stock", /^edit/i);
    const form = await screen.findByRole("dialog");
    expect(within(form).getByText(/price \(TTD\)/i)).toBeInTheDocument();
    expect(within(form).queryByText(/price \(USD\)/i)).toBeNull();
  });
});

describe("COR-CAT-5 every product is listed", () => {
  it("120 products: all 120 rows, read page by page", async () => {
    rowsByBiz[USD_BIZ] = Array.from({ length: 120 }, (_, i) => row(`p_${i}`, `Item ${String(i).padStart(3, "0")}`, {
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
    mount();
    await rowEl("Item 119");
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(120));
    expect(productRequests.some((r) => /[?&]page=2\b/.test(r))).toBe(true);
  });
});

describe("COR-CAT-6 what the form sends", () => {
  it("create sends inventory mode and out-of-stock behaviour", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "tracked" } });
    fireEvent.change(within(form).getByLabelText(/^when out of stock/i), { target: { value: "show_oos" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    expect((api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> }).body).toMatchObject({ inventoryMode: "tracked", outOfStockBehavior: "show_oos" });
  });

  it("update sends inventory mode, and clearing description and SKU sends null", async () => {
    rowsByBiz[USD_BIZ] = [row("p_kit", "Gift kit", { description: "A kit", sku: "KIT-1", inventoryMode: "tracked", outOfStockBehavior: "hide" })];
    mount();
    await openRowAction("Gift kit", /^edit/i);
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^description/i), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText(/^sku/i), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText(/^inventory mode/i), { target: { value: "untracked" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch.mock.calls[0][1]).toMatchObject({ description: null, sku: null, inventoryMode: "untracked" });
  });

  it("COR-CAT-9: clearing the image link sends imageUrl null", async () => {
    rowsByBiz[USD_BIZ] = [row("p_pic", "Pictured", { imageUrl: "https://cdn.example.com/p.png" })];
    mount();
    await openRowAction("Pictured", /^edit/i);
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^image link/i), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch.mock.calls[0][1]).toMatchObject({ imageUrl: null });
  });
});

describe("COR-CAT-12 an archive that fails says why", () => {
  it("a refusal: the dialog says the server's reason and the row stays", async () => {
    api.apiDelete.mockResolvedValueOnce({ data: null, error: READ_ONLY_REFUSAL, status: 403 });
    mount();
    await openRowAction("Pepper sauce", /^archive/i);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/you can't archive products in this business: it needs revenue write access/i);
    expect(await rowEl("Pepper sauce")).toBeInTheDocument();
  });

  it("a 404 (already archived elsewhere): the row goes and the dialog closes", async () => {
    api.apiDelete.mockResolvedValueOnce({ data: null, error: "Product not found", status: 404 });
    mount();
    await openRowAction("Pepper sauce", /^archive/i);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByText("Pepper sauce")).toBeNull();
  });
});

describe("SEC-CAT-4 a one-time notice when this browser kept product photos", () => {
  function stubIndexedDb(names: string[]) {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { databases: vi.fn(async () => names.map((name) => ({ name, version: 1 }))), open });
    return open;
  }

  it("the old photo database exists: a notice says so, is dismissed, and stays dismissed; the database is never opened", async () => {
    const open = stubIndexedDb(["keyflow-product-images"]);
    mount();
    const notice = await screen.findByRole("status", { name: /photos kept in this browser/i });
    expect(notice).toHaveTextContent(/only in this browser/i);
    fireEvent.click(within(notice).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status", { name: /photos kept in this browser/i })).toBeNull();
    cleanup();
    mount();
    await rowEl("Pepper sauce");
    expect(screen.queryByRole("status", { name: /photos kept in this browser/i })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("control: no old photo database, no notice", async () => {
    stubIndexedDb(["some-other-db"]);
    mount();
    await rowEl("Pepper sauce");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("status", { name: /photos kept in this browser/i })).toBeNull();
  });
});
