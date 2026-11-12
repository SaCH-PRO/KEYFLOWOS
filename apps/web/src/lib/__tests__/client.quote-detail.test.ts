import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

/**
 * R0-PC-01-QUOTE-DETAIL-TENANT-ROUTE — the operator quote reader.
 *
 * WHY this test exists: `getQuote` called the bare-id route
 * (GET /commerce/quotes/:id), which was unguarded and unthrottled and served
 * any quote — DRAFT included, with the customer's email — to anyone holding
 * the id. The server now answers 404 there for every id and serves the
 * operator read from the tenant-bound route behind AuthGuard + BusinessGuard +
 * ModuleScopeGuard(revenue:read). The customer quote page reads the
 * signed-token route (/commerce/public/quotes/:token), which is unchanged.
 *
 * The properties asserted: the client builds the tenant URL from both ids,
 * encodes them, never issues the bare-id URL, and nothing in the web app
 * builds the bare-id GET URL by hand.
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

describe("getQuote reads the tenant-bound detail route", () => {
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

  it("takes (businessId, quoteId)", async () => {
    const { getQuote } = await import("@/lib/client");
    expect(getQuote.length).toBe(2);
  });

  it("builds GET /commerce/businesses/:businessId/quotes/:quoteId and never the bare-id URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: "q_1", status: "DRAFT", total: 50, currency: "TTD", items: [], contact: { email: "c@x.test" } }),
    );

    const { getQuote } = await import("@/lib/client");
    const res = await getQuote("biz_1", "q_1");

    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ id: "q_1", status: "DRAFT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const paths = requestedPaths(fetchMock);
    expect(paths).toEqual(["/commerce/businesses/biz_1/quotes/q_1"]);
    expect(paths).not.toContain("/commerce/quotes/q_1");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET" });
  });

  it("encodes both ids so a hostile id cannot escape the tenant path", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "x", status: "DRAFT", total: 1, currency: "TTD", items: [] }));

    const { getQuote } = await import("@/lib/client");
    await getQuote("biz/1", "../other");

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/commerce/businesses/${encodeURIComponent("biz/1")}/quotes/${encodeURIComponent("../other")}`);
    expect(requestedPaths(fetchMock)[0]).not.toMatch(/^\/commerce\/quotes\//);
  });

  it("surfaces the tenant route's 404 as an error, not as data", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { statusCode: 404, message: "Quote not found" }));

    const { getQuote } = await import("@/lib/client");
    const res = await getQuote("biz_1", "q_missing");

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/Quote not found/);
    expect(requestedPaths(fetchMock)).toEqual(["/commerce/businesses/biz_1/quotes/q_missing"]);
  });
});

describe("no web caller builds the bare-id quote GET URL", () => {
  const srcRoot = path.resolve(__dirname, "../..");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        out.push(...sourceFiles(p));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
        out.push(p);
      }
    }
    return out;
  }

  it("is not vacuous: the scan reads client.ts and finds the tenant route there", () => {
    const files = sourceFiles(srcRoot);
    const client = files.find((f) => f.endsWith(path.join("lib", "client.ts")));
    expect(client).toBeDefined();
    expect(fs.readFileSync(client!, "utf8")).toMatch(/\/commerce\/businesses\/\$\{[^}]+\}\/quotes\/\$\{[^}]+\}`/);
  });

  it("no API template literal ends at /commerce/quotes/${id} (the status route /commerce/quotes/${id}/status/... is a different route)", () => {
    // `/commerce/quotes/${...}` immediately closed (backtick) or followed by a
    // query string is the bare-id GET; anything followed by `/` is a sub-route.
    // The app's own page path (`/app/commerce/quotes/...`) is not the API path,
    // so the match is anchored on the template literal's opening backtick.
    const bareTemplate = /`\/commerce\/quotes\/\$\{[^}]+\}(?:`|\?)/;
    const bareConcat = /["'`]\/commerce\/quotes\/["'`]\s*\+/;
    const offenders = sourceFiles(srcRoot).filter((f) => {
      const source = fs.readFileSync(f, "utf8");
      return bareTemplate.test(source) || bareConcat.test(source);
    });
    expect(offenders.map((f) => path.relative(srcRoot, f))).toEqual([]);
  });
});
