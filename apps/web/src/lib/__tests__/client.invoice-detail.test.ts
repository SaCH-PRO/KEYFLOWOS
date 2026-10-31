import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

/**
 * R0-QI-01-TENANT-INVOICE-DETAIL-ROUTE — the operator invoice reader.
 *
 * WHY this test exists: `getInvoice` used to call the PUBLIC bare-id route
 * (GET /commerce/invoices/:id). The operator detail and edit pages read it with
 * the operator's token, which KF-REVENUE-AUTH-PROJECTION-001 made work through
 * a viewer-aware shape, but the route's shareable gate still answered 404 for
 * DRAFT and VOID, so the edit page could not open a draft, and the operator UI
 * depended on a public surface. The client now reads the tenant-bound detail
 * route behind AuthGuard + BusinessGuard + ModuleScopeGuard(revenue:read).
 *
 * The properties asserted: the client builds the tenant URL from both ids,
 * encodes them, never issues the bare-id URL, and both operator pages call it
 * with the business id.
 */

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

function requestedPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    return new URL(url).pathname;
  });
}

describe("getInvoice reads the tenant-bound detail route", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("builds GET /commerce/businesses/:businessId/invoices/:invoiceId and never the bare-id URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "inv_1", status: "DRAFT", total: 50, currency: "TTD", payments: [] }));

    const { getInvoice } = await import("@/lib/client");
    const res = await getInvoice("biz_1", "inv_1");

    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ id: "inv_1", status: "DRAFT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const paths = requestedPaths(fetchMock);
    expect(paths).toEqual(["/commerce/businesses/biz_1/invoices/inv_1"]);
    expect(paths).not.toContain("/commerce/invoices/inv_1");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET" });
  });

  it("encodes both ids so a hostile id cannot escape the tenant path", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "x", status: "DRAFT", total: 1, currency: "TTD" }));

    const { getInvoice } = await import("@/lib/client");
    await getInvoice("biz/1", "../other");

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/commerce/businesses/${encodeURIComponent("biz/1")}/invoices/${encodeURIComponent("../other")}`);
    expect(requestedPaths(fetchMock)[0]).not.toMatch(/\/commerce\/invoices\//);
  });

  it("surfaces the tenant route's 404 as an error, not as data", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { statusCode: 404, message: "Invoice not found" }));

    const { getInvoice } = await import("@/lib/client");
    const res = await getInvoice("biz_1", "inv_missing");

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/Invoice not found/);
    expect(requestedPaths(fetchMock)).toEqual(["/commerce/businesses/biz_1/invoices/inv_missing"]);
  });
});

describe("the operator pages read the invoice through the tenant-bound client call", () => {
  const pagesDir = path.resolve(__dirname, "../../app/app/commerce/invoices/[id]");
  const pages = {
    detail: path.join(pagesDir, "page.tsx"),
    edit: path.join(pagesDir, "edit", "page.tsx"),
  };

  it.each(Object.entries(pages))("%s page calls getInvoice(<businessId>, <invoiceId>) and never the one-argument form", (_name, file) => {
    const source = fs.readFileSync(file, "utf8");
    expect(source).toMatch(/\bgetInvoice\(\s*[\w.]+\s*,\s*[\w.]+\s*\)/);
    expect(source).not.toMatch(/\bgetInvoice\(\s*[\w.]+\s*\)/);
    // No hand-built bare-id API URL either. The app's own route
    // (`/app/commerce/invoices/${id}`) is a page path, not the API path, so
    // the match is anchored on the template literal's opening backtick.
    expect(source).not.toMatch(/`\/commerce\/invoices\//);
  });
});
