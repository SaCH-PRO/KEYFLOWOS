/**
 * FOLLOW3-D11-WEB-API-EMPTY-SEGMENT (V1-84): the lib/api.ts transports refuse a
 * request whose path names no business or a missing id, instead of sending it.
 *
 * WHY this test exists: apiGet, apiPost, apiPostSimple, apiPatch, apiPut and
 * apiDelete built `${API_BASE}${path}` and sent it, whatever the path held.
 * Only lib/client.ts's own wrappers asked lib/api/_defaults.ts namesNoBusiness
 * first. Every other lib/api/* module (business-genome, finance, structure,
 * approvals, ...) sends through these transports directly, and about 60
 * screens hand them `getStoredBusinessId() ?? ""`, so with no business
 * selected they sent /businesses//... An empty trailing id
 * (`contacts/${""}`) sent .../contacts/, which the server's non-strict routing
 * serves from the LIST route: a detail read answered with somebody's list.
 * lib/api/product-cost.ts resolved its business as `businessId ||
 * getStoredBusinessId()`, so an explicit "" silently became the selected
 * business instead of being refused the way lib/client.ts refuses it.
 *
 * What is proved here, with only `fetch` stubbed (the real transports, the real
 * guard, the real retry layer):
 *   - WE-01..WE-04, the four cases that sent on the unfixed code;
 *   - every transport answers { data: null, error: "No business selected" } for
 *     an unbound /businesses/ segment or businessId (namesNoBusiness /
 *     requestNamesNoBusiness), and { data: null, error: "Missing id" } for any
 *     other empty, "undefined" or "null" path segment or a trailing "/" before
 *     the query, and in both cases sends nothing;
 *   - control: a bound path is sent, exactly as given, once; the query and
 *     fragment are the caller's data and are not judged;
 *   - product-cost refuses "" the way lib/client.ts does;
 *   - census: no legitimate request path template anywhere in lib/** ends in
 *     "/" or holds "//" (or an "undefined"/"null" segment), so the guard cannot
 *     refuse a request the app means to send.
 *   - review SEC-D11-1: the guard judges the path fetch will send (the
 *     WHATWG-normalised URL), not only the string it is handed, so a dot
 *     segment, "\", tab/CR/LF or trailing space cannot turn a refused shape into
 *     a sent one; proved with the stub and on the real wire (real fetch, local
 *     node:http server), with controls that percent-encoding is not a rewrite,
 *     and a census that no lib/** path template is rewritten on the wire.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import ts from "typescript";
import * as api from "@/lib/api";
import { namesNoBusiness, rewrittenOnTheWire } from "@/lib/api/_defaults";
import { updateProductCostProfile, fetchProductCostProfile } from "@/lib/api/product-cost";
import { fetchReserveBuckets, updateReserveBucket } from "@/lib/api/finance";
import { fetchOrgUnits, deleteOrgUnit } from "@/lib/api/structure";
import { fetchContactDetail } from "@/lib/client";

const NO_BUSINESS = "No business selected";
const MISSING_ID = "Missing id";
const STORED = "biz_stored_v84";
const NAMED = "biz_named_v84";

interface Sent { url: string; method: string; body: unknown }

/** The network as a permissive API: every request answers 200 `{}` and is recorded. */
function stubNetwork(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    try {
      body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    } catch {
      body = undefined;
    }
    sent.push({ url, method: (init?.method ?? "GET").toUpperCase(), body });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return sent;
}

type Transport = { name: string; method: string; call: (path: string, body?: unknown) => Promise<{ data: unknown; error: string | null }> };

/** Every JSON transport lib/api.ts exports. */
const TRANSPORTS: Transport[] = [
  { name: "apiGet", method: "GET", call: (p) => api.apiGet(p) },
  { name: "apiPost", method: "POST", call: (p, body) => api.apiPost({ path: p, body: body ?? { note: "x" } }) },
  { name: "apiPostSimple", method: "POST", call: (p, body) => api.apiPostSimple(p, body ?? { note: "x" }) },
  { name: "apiPatch", method: "PATCH", call: (p, body) => api.apiPatch(p, body ?? { note: "x" }) },
  { name: "apiPut", method: "PUT", call: (p, body) => api.apiPut(p, body ?? { note: "x" }) },
  { name: "apiDelete", method: "DELETE", call: (p, body) => api.apiDelete(p, body) },
];

/** Paths whose /businesses/ segment or businessId query names no business. */
const UNBOUND_BUSINESS = [
  "/finance/businesses//accounts",
  "/finance/businesses/undefined/accounts",
  "/finance/businesses/null/accounts",
  "/finance/businesses/",
  "/finance/businesses/?limit=5",
  "/finance/businesses/__kf_no_business_selected__/accounts",
  "/api/v1/cortex/awareness?businessId=",
  "/api/v1/cortex/awareness?businessId=undefined",
];

/** Paths whose business is bound but which name another id that is missing. */
const MISSING_ID_PATHS = [
  "/crm/businesses/b1/contacts/",
  "/crm/businesses/b1/contacts/?include=notes",
  "/crm/businesses/b1/contacts/#top",
  "/crm/businesses/b1/contacts//notes",
  "/crm/businesses/b1/contacts/undefined",
  "/crm/businesses/b1/contacts/null/notes",
  "/crm/contacts//merge",
  "/identity/me/",
];

/** Bound paths that must be sent exactly as given. */
const BOUND_PATHS = [
  "/crm/businesses/b1/contacts",
  "/crm/businesses/b1/contacts/c_1/notes",
  // The query and fragment are data: an empty, slashed or spelled-out value there is not a path segment.
  "/crm/businesses/b1/contacts?q=undefined&next=/a//b/&tag=null",
  "/crm/businesses/b1/contacts/c_1#section/",
  // A route word after /businesses/ and segments that merely contain the words.
  "/site/businesses/slug/acme",
  "/crm/businesses/b1/contacts/nullable/undefined-ish",
  "/health",
];

/*
 * Review SEC-D11-1: fetch does not send the path it is handed but the
 * WHATWG-normalised URL (".", "..", "%2e" segments resolved, "\" read as "/",
 * tab/CR/LF dropped, trailing spaces stripped). The guard used to read only the
 * written path, so each written path below passed it while the path after "->"
 * (what the wire carries) is a shape the packet refuses. encodeURIComponent
 * keeps "." and "..", so encoded helpers were open too.
 */

/** Written paths whose business segment the wire empties, drops or changes: refused as "No business selected". */
const WIRE_UNBOUND_BUSINESS: Array<[written: string, wire: string]> = [
  ["/finance/businesses/\t/accounts", "/finance/businesses//accounts"],
  ["/finance/businesses/\\/accounts/acc_1", "/finance/businesses///accounts/acc_1"],
  ["/finance/businesses/ ", "/finance/businesses/"],
  ["/finance/businesses/./accounts", "/finance/businesses/accounts"],
  ["/finance/businesses/%2e/accounts", "/finance/businesses/accounts"],
  ["/commerce/businesses/../products/p1/cost-profile", "/commerce/products/p1/cost-profile"],
  ["/finance/businesses/b1/reserves/../../b2/reserves/rb_9", "/finance/businesses/b2/reserves/rb_9"],
  ["/finance/businesses/b1/%2E%2e/b2/accounts", "/finance/businesses/b2/accounts"],
];

/** Written paths with a bound business that the wire rewrites: refused as "Missing id". */
const WIRE_MISSING_ID: Array<[written: string, wire: string]> = [
  ["/crm/businesses/b1/contacts/.", "/crm/businesses/b1/contacts/"],
  ["/crm/businesses/b1/contacts/%2e", "/crm/businesses/b1/contacts/"],
  ["/crm/businesses/b1/contacts/%2E?include=notes", "/crm/businesses/b1/contacts/"],
  ["/crm/businesses/b1/contacts/ ", "/crm/businesses/b1/contacts/"],
  ["/crm/businesses/b1/contacts/\t", "/crm/businesses/b1/contacts/"],
  ["/crm/businesses/b1/contacts/c_1/..", "/crm/businesses/b1/contacts/"],
  ["/crm/businesses/b1/contacts/c_1/%2e%2e/c_2", "/crm/businesses/b1/contacts/c_2"],
  ["/crm/businesses/b1/contacts\\c_1", "/crm/businesses/b1/contacts/c_1"],
  ["/crm/businesses/b1/contacts/c\r\n_1", "/crm/businesses/b1/contacts/c_1"],
  ["/identity/me/.", "/identity/me/"],
];

/**
 * Controls: paths the wire does not rewrite are sent. Dots inside a segment are
 * not dot segments, an escaped "/" stays one segment, percent-encoding (a space
 * sent as %20) changes no segment, and the query and fragment are not judged.
 */
const WIRE_BOUND_PATHS: Array<[written: string, wire: string]> = [
  ["/crm/businesses/b1/files/report.v2.pdf", "/crm/businesses/b1/files/report.v2.pdf"],
  ["/crm/businesses/b1/contacts/c.1/notes", "/crm/businesses/b1/contacts/c.1/notes"],
  ["/crm/businesses/b1/tags/a%2Fb", "/crm/businesses/b1/tags/a%2Fb"],
  ["/crm/businesses/b1/tags/caf%C3%A9", "/crm/businesses/b1/tags/caf%C3%A9"],
  ["/crm/businesses/b1/tags/a b", "/crm/businesses/b1/tags/a%20b"],
  ["/crm/businesses/b1/contacts?next=/a/../b/./c", "/crm/businesses/b1/contacts"],
  ["/crm/businesses/b1/contacts/c_1#x/../..", "/crm/businesses/b1/contacts/c_1"],
];

describe("FOLLOW3-D11 the lib/api.ts transports refuse an empty or unbound id segment", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WE-01: apiGet('/finance/businesses//accounts') sends nothing and answers 'No business selected'", async () => {
    const sent = stubNetwork();
    const res = await api.apiGet("/finance/businesses//accounts");
    expect(sent).toEqual([]);
    expect(res).toEqual({ data: null, error: NO_BUSINESS });
  });

  it("WE-02: apiGet('/crm/businesses/b1/contacts/') sends nothing and answers 'Missing id' (it used to reach the list route)", async () => {
    const sent = stubNetwork();
    const res = await api.apiGet("/crm/businesses/b1/contacts/");
    expect(sent).toEqual([]);
    expect(res).toEqual({ data: null, error: MISSING_ID });
  });

  it("WE-03: apiPatch('/x/businesses/undefined/y', {}) sends nothing and answers 'No business selected'", async () => {
    const sent = stubNetwork();
    const res = await api.apiPatch("/x/businesses/undefined/y", {});
    expect(sent).toEqual([]);
    expect(res).toEqual({ data: null, error: NO_BUSINESS });
  });

  it("WE-04: updateProductCostProfile(p, body, '') does not send to the stored business; it refuses '' as lib/client.ts does", async () => {
    window.localStorage.setItem("kf_business_id", STORED);
    const sent = stubNetwork();
    const res = await updateProductCostProfile("prod_1", { sourceCost: 10 }, "");
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([]);
    expect(res).toEqual({ data: null, error: NO_BUSINESS });
  });

  for (const transport of TRANSPORTS) {
    describe(transport.name, () => {
      it("refuses every unbound /businesses/ segment or businessId with 'No business selected', sending nothing", async () => {
        const sent = stubNetwork();
        const answers = await Promise.all(UNBOUND_BUSINESS.map((p) => transport.call(p)));
        expect(sent.map((s) => s.url)).toEqual([]);
        expect(answers).toEqual(UNBOUND_BUSINESS.map(() => ({ data: null, error: NO_BUSINESS })));
      });

      it("refuses every other empty, 'undefined' or 'null' segment and a trailing '/' before the query with 'Missing id', sending nothing", async () => {
        const sent = stubNetwork();
        const answers = await Promise.all(MISSING_ID_PATHS.map((p) => transport.call(p)));
        expect(sent.map((s) => s.url)).toEqual([]);
        expect(answers).toEqual(MISSING_ID_PATHS.map(() => ({ data: null, error: MISSING_ID })));
      });

      it("control: sends a bound path exactly as given, once", async () => {
        const sent = stubNetwork();
        for (const p of BOUND_PATHS) {
          const res = await transport.call(p);
          expect(res.error, p).toBeNull();
        }
        expect(sent.map((s) => s.url)).toEqual(BOUND_PATHS.map((p) => `${api.API_BASE}${p}`));
        expect(sent.every((s) => s.method === transport.method)).toBe(true);
      });

      it("SEC-D11-1: refuses a path whose business segment the wire empties, drops or changes with 'No business selected', sending nothing", async () => {
        const sent = stubNetwork();
        const answers = await Promise.all(WIRE_UNBOUND_BUSINESS.map(([p]) => transport.call(p)));
        expect(sent.map((s) => s.url)).toEqual([]);
        expect(answers).toEqual(WIRE_UNBOUND_BUSINESS.map(() => ({ data: null, error: NO_BUSINESS })));
      });

      it("SEC-D11-1: refuses a path the wire rewrites (dot segment, '\\', tab/CR/LF, trailing space) with 'Missing id', sending nothing", async () => {
        const sent = stubNetwork();
        const answers = await Promise.all(WIRE_MISSING_ID.map(([p]) => transport.call(p)));
        expect(sent.map((s) => s.url)).toEqual([]);
        expect(answers).toEqual(WIRE_MISSING_ID.map(() => ({ data: null, error: MISSING_ID })));
      });

      it("SEC-D11-1 control: sends a path the wire does not rewrite, exactly as given", async () => {
        const sent = stubNetwork();
        for (const [p] of WIRE_BOUND_PATHS) {
          const res = await transport.call(p);
          expect(res.error, p).toBeNull();
        }
        expect(sent.map((s) => s.url)).toEqual(WIRE_BOUND_PATHS.map(([p]) => `${api.API_BASE}${p}`));
      });
    });
  }

  it("SEC-D11-1 sanity: every negative control really is rewritten by the URL parser fetch uses, and every control is not", () => {
    const wireOf = (p: string) => new URL(`${api.API_BASE}${p}`).pathname;
    for (const [written, wire] of [...WIRE_UNBOUND_BUSINESS, ...WIRE_MISSING_ID, ...WIRE_BOUND_PATHS]) {
      expect(wireOf(written), JSON.stringify(written)).toBe(wire);
    }
    expect(WIRE_UNBOUND_BUSINESS.every(([p]) => namesNoBusiness(p))).toBe(true);
    expect(WIRE_MISSING_ID.filter(([p]) => namesNoBusiness(p) || !rewrittenOnTheWire(p))).toEqual([]);
    expect(WIRE_BOUND_PATHS.filter(([p]) => namesNoBusiness(p) || rewrittenOnTheWire(p))).toEqual([]);
    // The judges read the path only: a written path without one, or an absolute URL, is judged the same way.
    expect(rewrittenOnTheWire("?q=/a/../b")).toBe(false);
    expect(rewrittenOnTheWire(`${api.API_BASE}/crm/businesses/b1/contacts/.`)).toBe(true);
    expect(namesNoBusiness(`${api.API_BASE}/commerce/businesses/../products/p1`)).toBe(true);
  });

  it("a write to a route that takes its business from the body refuses an unbound body businessId (requestNamesNoBusiness), and sends a bound one", async () => {
    const sent = stubNetwork();
    const writes = TRANSPORTS.filter((t) => t.method !== "GET");
    const refused = await Promise.all(writes.flatMap((t) => [
      t.call("/commerce/invoices/inv_1/mark-paid", { businessId: "" }),
      t.call("/commerce/invoices/inv_1/mark-paid", { businessId: null }),
      t.call("/commerce/invoices/inv_1/mark-paid", { businessId: "undefined" }),
    ]));
    expect(sent).toEqual([]);
    for (const res of refused) expect(res).toEqual({ data: null, error: NO_BUSINESS });

    for (const t of writes) await t.call("/commerce/invoices/inv_1/mark-paid", { businessId: NAMED });
    expect(sent.map((s) => (s.body as { businessId?: unknown }).businessId)).toEqual(writes.map(() => NAMED));
  });

  it("a lib/api/* module handed `getStoredBusinessId() ?? \"\"` with no business selected sends nothing (the ~60 screens of the R0-15d follow-up)", async () => {
    const sent = stubNetwork();
    const empty = "";
    const answers = await Promise.all([
      fetchReserveBuckets(empty),
      updateReserveBucket(empty, "rb_1", { name: "x" }),
      fetchOrgUnits(empty),
      deleteOrgUnit(empty, "ou_1"),
      // A required non-business id that is missing is refused too.
      updateReserveBucket(NAMED, "", { name: "x" }),
      deleteOrgUnit(NAMED, undefined as unknown as string),
    ]);
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([]);
    expect(answers).toEqual([
      { data: null, error: NO_BUSINESS },
      { data: null, error: NO_BUSINESS },
      { data: null, error: NO_BUSINESS },
      { data: null, error: NO_BUSINESS },
      { data: null, error: MISSING_ID },
      { data: null, error: MISSING_ID },
    ]);
  });

  describe("lib/api/product-cost.ts resolves its business the way lib/client.ts does", () => {
    it("an explicit '' is refused even when a business is selected (read and write)", async () => {
      window.localStorage.setItem("kf_business_id", STORED);
      const sent = stubNetwork();
      const answers = await Promise.all([
        fetchProductCostProfile("prod_1", ""),
        updateProductCostProfile("prod_1", { sourceCost: 10 }, ""),
      ]);
      expect(sent).toEqual([]);
      expect(answers).toEqual([{ data: null, error: NO_BUSINESS }, { data: null, error: NO_BUSINESS }]);
    });

    it("an explicit 'undefined' or 'null' is refused even when a business is selected", async () => {
      window.localStorage.setItem("kf_business_id", STORED);
      const sent = stubNetwork();
      const answers = await Promise.all([
        fetchProductCostProfile("prod_1", "undefined"),
        updateProductCostProfile("prod_1", { sourceCost: 10 }, "null"),
      ]);
      expect(sent).toEqual([]);
      expect(answers).toEqual([{ data: null, error: NO_BUSINESS }, { data: null, error: NO_BUSINESS }]);
    });

    it("no business named and none selected: refused", async () => {
      const sent = stubNetwork();
      const answers = await Promise.all([
        fetchProductCostProfile("prod_1"),
        updateProductCostProfile("prod_1", { sourceCost: 10 }),
      ]);
      expect(sent).toEqual([]);
      expect(answers).toEqual([{ data: null, error: NO_BUSINESS }, { data: null, error: NO_BUSINESS }]);
    });

    it("control: no business named resolves the selected one; a named business is the one called", async () => {
      window.localStorage.setItem("kf_business_id", STORED);
      const sent = stubNetwork();
      await fetchProductCostProfile("prod_1");
      await updateProductCostProfile("prod_1", { sourceCost: 10 });
      await fetchProductCostProfile("prod_1", NAMED);
      await updateProductCostProfile("prod_1", { sourceCost: 10 }, NAMED);
      expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
        `GET /commerce/businesses/${STORED}/products/prod_1/cost-profile`,
        `POST /commerce/businesses/${STORED}/products/prod_1/cost-profile`,
        `GET /commerce/businesses/${NAMED}/products/prod_1/cost-profile`,
        `POST /commerce/businesses/${NAMED}/products/prod_1/cost-profile`,
      ]);
    });

    it("an empty product id is refused as a missing id", async () => {
      window.localStorage.setItem("kf_business_id", STORED);
      const sent = stubNetwork();
      const res = await updateProductCostProfile("", { sourceCost: 10 });
      expect(sent).toEqual([]);
      expect(res).toEqual({ data: null, error: MISSING_ID });
    });
  });
});

// ---------------------------------------------------------------------------
// SEC-D11-1 on the real wire: the real (undici) fetch, a local node:http server
// ---------------------------------------------------------------------------

describe("SEC-D11-1 on the real wire: what reaches the server is judged, not the string handed to fetch", () => {
  const wire: Array<{ method: string; url: string }> = [];
  const realFetch = globalThis.fetch;
  let server: http.Server;
  let origin = "";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      wire.push({ method: req.method ?? "", url: req.url ?? "" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Only the origin is swapped: the path reaches the real URL parser untouched.
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => realFetch(String(input).replace(api.API_BASE, origin), init));
  });
  afterEach(() => {
    wire.length = 0;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const pathnameOf = (url: string) => new URL(url, origin).pathname;

  it("no transport puts a rewritten negative control on the wire, and each answers as refused", async () => {
    for (const transport of TRANSPORTS) {
      for (const [p] of WIRE_UNBOUND_BUSINESS) expect(await transport.call(p), `${transport.name} ${JSON.stringify(p)}`).toEqual({ data: null, error: NO_BUSINESS });
      for (const [p] of WIRE_MISSING_ID) expect(await transport.call(p), `${transport.name} ${JSON.stringify(p)}`).toEqual({ data: null, error: MISSING_ID });
    }
    expect(wire).toEqual([]);
  });

  it("the review's helper repros send nothing: product-cost business '..', an unencoded id climbing into another business, a client.ts business '..'", async () => {
    window.localStorage.setItem("kf_business_id", STORED);
    const answers = [
      await fetchProductCostProfile("p1", ".."),
      await updateProductCostProfile("p1", { sourceCost: 1 }, "."),
      await updateReserveBucket("b1", "../../b2/reserves/rb_9", { name: "x" }),
      // client.ts's own wrappers ask namesNoBusiness, which now judges the wire too.
      await fetchContactDetail("c_1", ".."),
    ];
    expect(wire).toEqual([]);
    expect(answers.map((a) => a.error)).toEqual([NO_BUSINESS, NO_BUSINESS, NO_BUSINESS, NO_BUSINESS]);
  });

  it("control: paths the wire does not rewrite arrive, at the path the parser sends", async () => {
    for (const [p] of WIRE_BOUND_PATHS) expect((await api.apiGet(p)).error, p).toBeNull();
    await fetchContactDetail("c.1", "b1");
    await fetchProductCostProfile("p.1", "b1");
    expect(wire.map((w) => `${w.method} ${pathnameOf(w.url)}`)).toEqual([
      ...WIRE_BOUND_PATHS.map(([, wirePath]) => `GET ${wirePath}`),
      "GET /crm/businesses/b1/contacts/c.1",
      "GET /commerce/businesses/b1/products/p.1/cost-profile",
    ]);
  });

  it.todo(
    "fetchContactDetail('.', 'b1') (or '') is refused as a missing id: DEFERRED. It sends through lib/client.ts's private schema apiGet, " +
      "which calls fetch itself and asks only namesNoBusiness, never namesMissingId, so a missing contact id still reaches the list route " +
      "(as `''` always has). client.ts is outside this packet's write set (V1-45, V1-41b); the fix is one namesMissingId check there.",
  );
});

// ---------------------------------------------------------------------------
// CONTROL: census of every path template in apps/web/src/lib/**
// ---------------------------------------------------------------------------

const LIB = path.join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Stands in for an interpolated value: a non-empty segment, so only the template's own text is judged. */
const HOLE = "ID";

interface Template { where: string; shape: string }

/**
 * Every string and template literal of a source, as its static shape: the
 * template's text with each `${...}` replaced by a non-empty stand-in (and
 * `${API_BASE}` dropped, so `${API_BASE}/x` reads as the path `/x`).
 */
function templatesOf(file: string, text: string): Template[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Template[] = [];
  const visit = (node: ts.Node): void => {
    let shape: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      shape = node.text;
    } else if (ts.isTemplateExpression(node)) {
      shape = node.head.text;
      for (const span of node.templateSpans) {
        shape += (span.expression.getText(sf) === "API_BASE" ? "" : HOLE) + span.literal.text;
      }
    }
    if (shape !== null) {
      found.push({ where: `${path.relative(LIB, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`, shape });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** A literal shaped like a request path: it starts with "/" and a word. */
const PATH_SHAPED = /^\/[A-Za-z]/;

/** A path template that would be refused: its path (before the query) ends in "/", holds "//", or a spelled-out missing value. */
function wouldBeRefused(shape: string): boolean {
  const pathPart = shape.split(/[?#]/, 1)[0];
  return pathPart.endsWith("/") || pathPart.includes("//") || /\/(?:undefined|null)(?=\/|$)/.test(pathPart);
}

/**
 * The path-shaped literals in lib/** that are not request paths, each with why.
 * Pinned exactly: a new one fails the census until it is looked at.
 */
const NOT_REQUEST_PATHS: Record<string, string> = {
  // The marker namesNoBusiness matches, not a URL.
  "api/_defaults.ts \"/businesses/\"": "matcher constant",
  // A web breadcrumb href prefix ("/app/" + crumbs), never sent to the API.
  "semantic-routes.ts \"/app/\"": "web route prefix",
};

describe("CONTROL: census of the path templates in apps/web/src/lib/**", () => {
  const files = sourceFiles(LIB);
  const templates = files.flatMap((file) => templatesOf(file, fs.readFileSync(file, "utf8")));
  const paths = templates.filter((t) => PATH_SHAPED.test(t.shape));

  it("the census reads lib/** (sanity: it sees the request layer)", () => {
    expect(files.some((f) => f.endsWith(path.join("lib", "client.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("lib", "api", "business-genome.ts")))).toBe(true);
    expect(paths.length).toBeGreaterThan(1000);
    expect(paths.filter((t) => t.shape.includes(`/businesses/${HOLE}`)).length).toBeGreaterThan(500);
  });

  it("the census would catch a bad template (sanity: the judge is not blind)", () => {
    const probe = "const a = `/crm/businesses/${b}/contacts/${id ?? \"\"}/`; const c = \"/crm//x\"; const d = `${API_BASE}/x/null`;";
    const shapes = templatesOf("probe.ts", probe).map((t) => t.shape);
    expect(shapes).toEqual(["/crm/businesses/ID/contacts/ID/", "", "/crm//x", "/x/null"]);
    expect(shapes.filter(wouldBeRefused)).toEqual(["/crm/businesses/ID/contacts/ID/", "/crm//x", "/x/null"]);
    expect(wouldBeRefused("/crm/businesses/ID/contacts?next=/a//b/")).toBe(false);
  });

  it("no legitimate request path template ends in '/', holds '//' or an 'undefined'/'null' segment, so the guard refuses none the app means to send", () => {
    const flagged = paths.filter((t) => wouldBeRefused(t.shape));
    const unexplained = flagged.filter((t) => !NOT_REQUEST_PATHS[`${t.where.split(":")[0]} ${JSON.stringify(t.shape)}`]);
    expect(unexplained.map((t) => `${t.where} ${JSON.stringify(t.shape)}`)).toEqual([]);
    // The exceptions are exactly the ones pinned above, each still present.
    expect(new Set(flagged.map((t) => `${t.where.split(":")[0]} ${JSON.stringify(t.shape)}`))).toEqual(new Set(Object.keys(NOT_REQUEST_PATHS)));
  });

  it("SEC-D11-1: the wire judge would catch a bad template (sanity: it is not blind)", () => {
    const probe = "const a = `/crm/businesses/${b}/contacts/./${id}`; const c = \"/crm\\\\x\"; const d = `${API_BASE}/x/%2e%2e/y`; const e = \"/x/a\\tb\";";
    const shapes = templatesOf("probe.ts", probe).map((t) => t.shape);
    expect(shapes).toEqual(["/crm/businesses/ID/contacts/./ID", "/crm\\x", "/x/%2e%2e/y", "/x/a\tb"]);
    expect(shapes.filter(rewrittenOnTheWire)).toEqual(shapes);
  });

  it("SEC-D11-1: no request path template is rewritten on the wire (dot segment, '\\', tab/CR/LF, trailing space), so the wire judge refuses none the app means to send", () => {
    const rewritten = paths.filter((t) => rewrittenOnTheWire(t.shape));
    expect(rewritten.map((t) => `${t.where} ${JSON.stringify(t.shape)}`)).toEqual([]);
  });
});
