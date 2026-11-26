/**
 * CATALOG-1, the web half (SWP-PRODUCT-CREATE, BUG-005; journey B1). The browser half is
 * e2e/sweep-product-create.spec.ts.
 *
 * WHY this test exists: Sales > Products did not exist. products-panel.tsx (presentational) lost its host in
 * 6ad9b1c8 and nothing mounted it again, so /app/commerce/products was a 404 and an owner could not create, edit or
 * archive a product, while 'Manage products' (Settings > Catalog) and the command palette's 'Add product' pointed
 * there. A product made anywhere else was priced in TTD whatever the business's currency (createProduct's default),
 * and a photo was kept in this browser's IndexedDB only (lib/image-store.ts), so no other device ever saw it.
 *
 * The page is mounted with the real client.ts product calls, the real useProducts hook, the real products panel and
 * the real product form; only the HTTP edge is stubbed (lib/api's apiGet/apiPost/apiPatch/apiDelete, and fetch for
 * client.ts's own list read, fetchProducts) with the workspace lookup. Each case imports the page itself, so before
 * the page exists each case fails on that import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
const nav = vi.hoisted(() => ({ search: "" }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost, apiPatch: api.apiPatch, apiDelete: api.apiDelete };
});

vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    refreshWorkspace: vi.fn(async () => BUSINESS),
    getStoredBusinessId: vi.fn(() => BUSINESS),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/products",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const BUSINESS = "biz_catalog_web_1";
const PRODUCTS_PATH = `/commerce/businesses/${BUSINESS}/products`;

type Row = { id: string; name: string; price: number; currency: string; category: string; isActive: boolean; createdAt: string; sku?: string | null; imageUrl?: string | null; description?: string | null; duration?: number | null };

const PEPPER: Row = { id: "prod_pepper", name: "Pepper sauce", price: 45, currency: "USD", category: "PRODUCT", isActive: true, createdAt: "2026-11-20T10:00:00.000Z" };
const SORREL: Row = { id: "prod_sorrel", name: "Sorrel drink", price: 20, currency: "USD", category: "PRODUCT", isActive: true, createdAt: "2026-11-19T10:00:00.000Z" };

let rows: Row[] = [];

function envelope(data: Row[]) {
  return { data, total: data.length, page: 1, pageSize: 50, totalPages: 1 };
}

/** The page module, imported by each case (a path in a variable, so a missing page fails the case, not the file). */
const PAGE_MODULE = "../page";

async function mountPage() {
  const { default: ProductsPage } = (await import(/* @vite-ignore */ PAGE_MODULE)) as { default: React.ComponentType };
  render(<ProductsPage />);
  await screen.findByRole("heading", { name: /^products$/i });
  return ProductsPage;
}

/** The product's row on the page: the article that names it. */
function rowOf(name: string): HTMLElement {
  const rowEl = screen.getAllByRole("article").find((a) => within(a).queryByText(name));
  if (!rowEl) throw new Error(`no row names '${name}'`);
  return rowEl;
}

/** A row action: on the row, or in its More actions menu. */
async function rowAction(name: string, action: RegExp) {
  const row = rowOf(name);
  const direct = within(row).queryAllByRole("button", { name: action });
  if (direct.length) return direct[0];
  fireEvent.click(within(row).getByRole("button", { name: /more actions/i }));
  return screen.findByRole("menuitem", { name: action });
}

beforeEach(() => {
  rows = [PEPPER, SORREL];
  // fetchProducts reads through client.ts's own apiGet, which calls fetch itself (not lib/api).
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://api.test.local");
    if (url.pathname.endsWith(PRODUCTS_PATH)) {
      return new Response(JSON.stringify(envelope(rows)), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "not stubbed" }), { status: 404, headers: { "content-type": "application/json" } });
  }));
  nav.search = "";
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BUSINESS);
  window.localStorage.setItem("kf-products-view", "list");
  api.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith(PRODUCTS_PATH)) return { data: envelope(rows), error: null };
    if (path === `/identity/businesses/${BUSINESS}`) return { data: { id: BUSINESS, name: "Hot Pepper Co", currency: "USD" }, error: null };
    return { data: null, error: null };
  });
  api.apiPost.mockImplementation(async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
    if (path === PRODUCTS_PATH) {
      const created: Row = { id: "prod_new", createdAt: "2026-11-25T10:00:00.000Z", isActive: true, category: "PRODUCT", ...(body as object) } as Row;
      rows = [created, ...rows];
      return { data: created, error: null, status: 201 };
    }
    return { data: null, error: "unexpected POST " + path };
  });
  api.apiPatch.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    const id = path.split("/").pop();
    const prev = rows.find((r) => r.id === id);
    if (!prev) return { data: null, error: "Not found" };
    const next = { ...prev, ...body } as Row;
    rows = rows.map((r) => (r.id === id ? next : r));
    return { data: next, error: null };
  });
  api.apiDelete.mockImplementation(async (path: string) => {
    const id = path.split("/").pop();
    rows = rows.filter((r) => r.id !== id);
    return { data: { id }, error: null };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CATALOG-1 Sales > Products (/app/commerce/products)", () => {
  it("lists the business's products, each once, with its price in the business currency", async () => {
    await mountPage();
    await waitFor(() => expect(rowOf("Pepper sauce")).toBeInTheDocument());
    expect(screen.getAllByRole("article").filter((a) => within(a).queryByText("Pepper sauce"))).toHaveLength(1);
    expect(rowOf("Pepper sauce")).toHaveTextContent(/USD\s*45\.00/);
    expect(rowOf("Sorrel drink")).toHaveTextContent(/USD\s*20\.00/);
  });

  it("New product opens a form with labelled Name and Price in the business currency; Create Product posts it in that currency and lists it", async () => {
    await mountPage();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    expect(within(form).getAllByText(/\bUSD\b/).length).toBeGreaterThan(0);
    expect(within(form).queryByText(/\bTTD\b/)).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Curry powder" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "18" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const { path, body } = api.apiPost.mock.calls[0][0] as { path: string; body: Record<string, unknown> };
    expect(path).toBe(PRODUCTS_PATH);
    expect(body).toMatchObject({ name: "Curry powder", price: 18, currency: "USD" });
    await waitFor(() => expect(rowOf("Curry powder")).toHaveTextContent(/USD\s*18\.00/));
  });

  it("the form keeps no photo in this browser: it has no file input, and saving sends no browser-only image address", async () => {
    await mountPage();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    expect(form.querySelector('input[type="file"]')).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Hot sauce gift box" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "60" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const { body } = api.apiPost.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(String(body.imageUrl ?? "")).not.toMatch(/^(data|blob):|__local__/);
  });

  it("a photo given as a browser-only address (data:) is refused with a message, and nothing is created", async () => {
    await mountPage();
    fireEvent.click(await screen.findByRole("button", { name: /^new product$/i }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(/^name/i), { target: { value: "Pepper jelly" } });
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "25" } });
    fireEvent.change(within(form).getByLabelText(/^image link/i), { target: { value: "data:image/png;base64,iVBORw0KGgo=" } });
    fireEvent.click(within(form).getByRole("button", { name: /^create product$/i }));
    expect(await within(form).findByText(/only in this browser/i)).toBeInTheDocument();
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("a row's Edit opens the form with the product; Update Product patches the new price and the row shows it", async () => {
    await mountPage();
    await waitFor(() => expect(rowOf("Pepper sauce")).toBeInTheDocument());
    fireEvent.click(await rowAction("Pepper sauce", /^edit/i));
    const form = await screen.findByRole("dialog");
    expect(within(form).getByLabelText(/^name/i)).toHaveValue("Pepper sauce");
    fireEvent.change(within(form).getByLabelText(/^price/i), { target: { value: "50" } });
    fireEvent.click(within(form).getByRole("button", { name: /^update product$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    const [path, body] = api.apiPatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`${PRODUCTS_PATH}/prod_pepper`);
    expect(body).toMatchObject({ price: 50 });
    await waitFor(() => expect(rowOf("Pepper sauce")).toHaveTextContent(/USD\s*50\.00/));
  });

  it("a row's Archive asks first, then archives the product and takes it off the list", async () => {
    await mountPage();
    await waitFor(() => expect(rowOf("Pepper sauce")).toBeInTheDocument());
    fireEvent.click(await rowAction("Pepper sauce", /^archive/i));
    expect(api.apiDelete).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("button", { name: /^archive$/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledTimes(1));
    expect(api.apiDelete.mock.calls[0][0]).toBe(`${PRODUCTS_PATH}/prod_pepper`);
    await waitFor(() => expect(screen.queryAllByRole("article").filter((a) => within(a).queryByText("Pepper sauce"))).toHaveLength(0));
    expect(rowOf("Sorrel drink")).toBeInTheDocument();
  });

  // Journey B6 at 9c8097ff: a product named "Archived item" made the card itself (role=button, named after the
  // product) answer to "Archive", so the row's Archive opened the product instead. A row's open control is named
  // "Open <product>", never like a row action, in both views.
  it.each(["grid", "list"])("in the %s view, no control on a row is named like an action except the action (a product named 'Archived item' / 'Edit kit')", async (view) => {
    window.localStorage.setItem("kf-products-view", view);
    rows = [
      { ...PEPPER, id: "prod_arch", name: "Archived item" },
      { ...SORREL, id: "prod_edit", name: "Edit kit" },
    ];
    await mountPage();
    await waitFor(() => expect(rowOf("Archived item")).toBeInTheDocument());
    for (const name of ["Archived item", "Edit kit"]) {
      const row = rowOf(name);
      expect(within(row).queryAllByRole("button", { name: /^(archive|edit)/i }), `${name}: buttons named like an action`).toHaveLength(0);
      expect(within(row).getByRole("button", { name: new RegExp(`^open ${name}`, "i") })).toBeInTheDocument();
    }
  });

  // Live sweep at d2615173 (4 of 12 runs): Escape that closed the product form also reached the app's Escape
  // shortcut (use-keyboard-shortcuts: kf:escape -> the parent route) whenever focus was not in a field, so the owner
  // was sent from Sales > Products to the Sales overview. Escape that closes something on this page closes only it.
  describe("Escape closes what is open on Sales > Products and goes no further (not to the app's Escape shortcut)", () => {
    let appEscape: ReturnType<typeof vi.fn>;
    let onWindowKey: (e: KeyboardEvent) => void;
    beforeEach(() => {
      appEscape = vi.fn();
      onWindowKey = (e: KeyboardEvent) => { if (e.key === "Escape") appEscape(); };
      window.addEventListener("keydown", onWindowKey);
    });
    afterEach(() => window.removeEventListener("keydown", onWindowKey));

    it("the product form (focus on a button, not a field)", async () => {
      await mountPage();
      await waitFor(() => expect(rowOf("Pepper sauce")).toBeInTheDocument());
      fireEvent.click(await rowAction("Pepper sauce", /^edit/i));
      const form = await screen.findByRole("dialog");
      const cancel = within(form).getByRole("button", { name: /^cancel$/i });
      cancel.focus();
      fireEvent.keyDown(cancel, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(appEscape).not.toHaveBeenCalled();
    });

    it("the Archive confirmation (Escape cancels it; nothing is archived)", async () => {
      await mountPage();
      await waitFor(() => expect(rowOf("Pepper sauce")).toBeInTheDocument());
      fireEvent.click(await rowAction("Pepper sauce", /^archive/i));
      const confirm = await screen.findByRole("alertdialog");
      fireEvent.keyDown(within(confirm).getByRole("button", { name: /^cancel$/i }), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(appEscape).not.toHaveBeenCalled();
      expect(api.apiDelete).not.toHaveBeenCalled();
    });

    it("a row's More actions menu", async () => {
      await mountPage();
      await waitFor(() => expect(rowOf("Pepper sauce")).toBeInTheDocument());
      fireEvent.click(within(rowOf("Pepper sauce")).getByRole("button", { name: /more actions/i }));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(appEscape).not.toHaveBeenCalled();
    });
  });

  it("?action=add (the command palette's 'Add product') opens New product", async () => {
    nav.search = "action=add";
    await mountPage();
    const form = await screen.findByRole("dialog");
    expect(within(form).getByRole("button", { name: /^create product$/i })).toBeInTheDocument();
  });
});
