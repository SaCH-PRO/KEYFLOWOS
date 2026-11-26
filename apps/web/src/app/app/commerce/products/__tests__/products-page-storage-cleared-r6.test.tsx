/**
 * CATALOG-1 web, round 6 (COR-CAT-R4-3): Sales > Products follows a storage event whose key is null, which is what
 * another tab's localStorage.clear() sends: the page then shows the business now stored. No test held that branch.
 * The harness is products-page-review-r4.test.tsx's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within, act } from "@testing-library/react";

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


describe("COR-CAT-R4-3: localStorage cleared in another tab (storage event, key null)", () => {
  it("the page follows the business now stored (mutant: the key-null branch dropped)", async () => {
    mount();
    await rowEl("Pepper sauce");
    act(() => {
      ws.businessId = TTD_BIZ;
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    await rowEl("Doubles");
    expect(screen.queryByText("Pepper sauce")).toBeNull();
  });
});
