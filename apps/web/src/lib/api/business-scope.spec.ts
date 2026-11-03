/**
 * R0-15d-WEB-BUSINESS-SCOPE-MOUNTS: every web caller of a business-scoped route
 * names the member's selected business, and no demo-tenant fallback reaches the
 * API.
 *
 * WHY this spec exists (M09; the R0-15c review residuals SEC-R015c-1 and
 * SEC-R015c-2, CR-R025-4): lib/api/_defaults.ts exported
 *   DEFAULT_BUSINESS_ID = NEXT_PUBLIC_DEMO_BUSINESS_ID ?? "biz_demo"
 * and lib/client.ts defaulted 131 parameters and 201 fallbacks to it, as did
 * lib/api/approvals.ts and lib/api/product-cost.ts. A caller that forgot its
 * businessId called /.../businesses/biz_demo/..., which BusinessGuard refuses
 * (403) for a real member, so the screen silently showed nothing. A
 * SUPER_ADMIN, whom BusinessGuard lets into any business, read and WROTE the
 * demo tenant instead of the selected one. The settings/custom-fields page
 * called every custom-field-definition function without a business, the
 * contact detail did not hand its business to the panel that reads the custom
 * fields, and the pipeline mounted the contact form without the business its
 * submit writes to.
 *
 * Four parts, each failing on the unfixed code:
 *   1. A static census of every web source line that names a
 *      /businesses/:businessId route: no site can resolve to the demo tenant
 *      (no source of it is left, no literal tenant segment, no fallback to a
 *      literal or an empty id), and the business-scoped helper layer sends
 *      nothing except through its guard.
 *   2. A runtime census of the helpers: EVERY exported lib/client.ts function
 *      that names a business route, or carries its business in the request
 *      query or body, is called for real, with only the network stubbed. With
 *      a business selected, every request it sends names that business (in
 *      its path, its businessId query or its body); with none selected (and
 *      with an empty, null or undefined id), it sends nothing and answers "No
 *      business selected" instead: a helper that answers an ApiResult
 *      resolves that answer, it never rejects (R0-15d review SEC-R015d-2,
 *      CR-R015d-1).
 *   3. The mounts: contact detail (its custom fields, its consent writes and
 *      its momentum reads), the pipeline tab and settings/custom-fields,
 *      rendered for real, read and write the business they are bound to.
 *   4. The e2e workflows serve the web build the way next.config.ts builds it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement, useEffect } from "react";
import { render, screen, waitFor, cleanup, fireEvent, act, within } from "@testing-library/react";
import * as client from "@/lib/client";
import * as approvals from "@/lib/api/approvals";
import * as productCost from "@/lib/api/product-cost";
import * as transport from "@/lib/api";
import * as finance from "@/lib/api/finance";
import * as structure from "@/lib/api/structure";
import * as businessGenome from "@/lib/api/business-genome";
import { ContactDetail, type ContactDetailData } from "@/components/contacts/contact-detail";
import CustomFieldsSettingsPage from "@/app/app/settings/custom-fields/page";
import { PipelineTabContent } from "@/app/app/crm/pipeline/pipeline-tab-content";
import { useContactsPipeline } from "@/app/app/crm/pipeline/use-contacts-pipeline";
import { selectBusiness } from "@/lib/workspace";
import { toast } from "sonner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/crm/pipeline",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

// The contact panel's quick actions open the email composer; nothing here composes.
vi.mock("@/components/email/compose-context", () => ({
  useCompose: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }),
}));

const WEB_SRC = path.join(__dirname, "..", "..");
const REPO_ROOT = path.join(WEB_SRC, "..", "..", "..");
const rel = (file: string) => path.relative(WEB_SRC, file).split(path.sep).join("/");
const readText = (file: string) => fs.readFileSync(file, "utf8");

/** The business the member selected (kf_business_id). */
const SELECTED = "biz_selected";
/** A second business the member belongs to (the business a screen was bound to, or switched to). */
const HANDED = "biz_handed";
const DEMO = "biz_demo";
const NO_BUSINESS = "No business selected";

// ---------------------------------------------------------------------------
// 1. Static census
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Comment-only lines blanked (line numbers kept), so a census reads code, not prose. */
function codeOf(text: string): string {
  return text
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(line) ? "" : line))
    .join("\n");
}

/** The expression of a `${...}` opening at `start` (the index of `$`), braces balanced. */
function interpolation(code: string, start: number): string {
  let depth = 0;
  for (let i = start + 1; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start + 2, i);
    }
  }
  return code.slice(start + 2);
}

interface Site {
  file: string;
  line: number;
  /** The interpolated business expression, or null for a literal segment. */
  expression: string | null;
  /** The literal segment after /businesses/ when not interpolated. */
  literal: string | null;
}

const FILES = sourceFiles(WEB_SRC);
const CODE = new Map(FILES.map((file) => [file, codeOf(readText(file))]));

function censusOf(file: string): Site[] {
  const code = CODE.get(file) ?? "";
  const sites: Site[] = [];
  const marker = "/businesses/";
  for (let at = code.indexOf(marker); at !== -1; at = code.indexOf(marker, at + 1)) {
    const after = at + marker.length;
    const line = code.slice(0, at).split("\n").length;
    if (code.startsWith("${", after)) {
      sites.push({ file: rel(file), line, expression: interpolation(code, after).trim(), literal: null });
    } else {
      const literal = /^[^/?#"'`$\s)]*/.exec(code.slice(after))?.[0] ?? "";
      sites.push({ file: rel(file), line, expression: null, literal });
    }
  }
  return sites;
}

const SITES = FILES.flatMap(censusOf);
const SITE_FILES = [...new Set(SITES.map((s) => s.file))];

/**
 * Literal segments after /businesses/ that are route words, not tenants: the
 * public lookups by slug (/site/businesses/slug/...), the platform-wide reads
 * (/businesses/system/..., /businesses/me/...), the community directory, and an
 * empty segment followed by a quote (a string test such as
 * `authUrl.includes("/drive/businesses/")`, not a request).
 */
const ROUTE_WORDS = new Set(["", "public", "slug", "slug-check", "system", "me", "community-profile"]);

/** A business id resolving to a literal: a fallback to "", "biz_..." or any other string. */
const LITERAL_FALLBACK = /(\?\?|\|\|)\s*(["'`])/;
/** The names a business id travels under in the helper layer. */
const BUSINESS_VAR = String.raw`(?:businessId|bid|bId|biz|tenant)`;

/** The modules that resolve a business for a caller that names none (the helper layer). */
const HELPER_MODULES = ["lib/client.ts", "lib/api/approvals.ts", "lib/api/product-cost.ts"];
const CLIENT_FILE = path.join(WEB_SRC, "lib", "client.ts");
const CLIENT_CODE = CODE.get(CLIENT_FILE) ?? "";

describe(`census: ${SITES.length} web call sites of a /businesses/:businessId route in ${SITE_FILES.length} files`, () => {
  it("the census reads the whole web source (sanity: the scanner sees the codebase)", () => {
    expect(SITES.length).toBeGreaterThan(1000);
    expect(SITE_FILES.length).toBeGreaterThan(100);
    expect(SITE_FILES).toContain("lib/client.ts");
    expect(SITE_FILES).toContain("lib/api/approvals.ts");
  });

  it("no source of the demo tenant is left: no web source names biz_demo, reads NEXT_PUBLIC_DEMO_BUSINESS_ID or names DEFAULT_BUSINESS_ID", () => {
    const offenders: string[] = [];
    for (const [file, code] of CODE) {
      code.split("\n").forEach((text, i) => {
        if (/biz_demo|NEXT_PUBLIC_DEMO_BUSINESS_ID|DEFAULT_BUSINESS_ID/.test(text)) {
          offenders.push(`${rel(file)}:${i + 1}: ${text.trim().slice(0, 120)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no call site names a literal tenant: every segment after /businesses/ is an interpolated id or a route word", () => {
    const literalTenants = SITES.filter((s) => s.literal !== null && !ROUTE_WORDS.has(s.literal) && !s.literal.startsWith(":"));
    expect(literalTenants.map((s) => `${s.file}:${s.line} /businesses/${s.literal}`)).toEqual([]);
  });

  it("no call site's id falls back to a literal or an empty string where it is interpolated", () => {
    const bad = SITES.filter((s) => s.expression !== null && (LITERAL_FALLBACK.test(s.expression) || /^["'`]/.test(s.expression)));
    expect(bad.map((s) => `${s.file}:${s.line} \${${s.expression}}`)).toEqual([]);
  });

  it("in the helper layer a missing business resolves to the selection, never to a literal: no business-id default or fallback is a string", () => {
    const offenders: string[] = [];
    const defaultParam = new RegExp(String.raw`\b${BUSINESS_VAR}\??\s*:\s*string\s*=\s*`, "g");
    const fallback = new RegExp(String.raw`\b${BUSINESS_VAR}\b[^;\n]{0,40}(\?\?|\|\|)\s*([^;\n]+)`, "g");
    for (const helperModule of HELPER_MODULES) {
      const code = CODE.get(path.join(WEB_SRC, helperModule)) ?? "";
      for (const m of code.matchAll(defaultParam)) {
        const value = code.slice(m.index + m[0].length, m.index + m[0].length + 40);
        if (!value.startsWith("selectedBusinessId()")) offenders.push(`${helperModule}: default ${m[0]}${value.split(/[,\n]/)[0]}`);
      }
      for (const m of code.matchAll(fallback)) {
        if (/^\s*["'`]/.test(m[2])) offenders.push(`${helperModule}: fallback ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lib/client.ts sends no business route except through its guard: the shared helpers are imported under other names, and no bare fetch or EventSource is aimed at a business route", () => {
    const importFromApi = /import\s*\{([^}]*)\}\s*from\s*"\.\/api";/.exec(CLIENT_CODE)?.[1] ?? "";
    const importedAsIs = importFromApi
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^(apiPost|apiPostSimple|apiPatch|apiPut|apiDelete|apiGet|fetchWithAuthRetry)$/.test(s));
    expect(importedAsIs).toEqual([]);

    const bareSinks: string[] = [];
    for (const m of CLIENT_CODE.matchAll(/(?<![\w.])(fetch|new EventSource)\(/g)) {
      const call = CLIENT_CODE.slice(m.index, CLIENT_CODE.indexOf("\n", CLIENT_CODE.indexOf("\n", m.index) + 1));
      if (call.includes("/businesses/")) bareSinks.push(call.split("\n")[0].trim());
    }
    expect(bareSinks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Runtime census of the business-scoped helpers
// ---------------------------------------------------------------------------

/** A function that resolves a business for a caller that names none. */
const RESOLVES_A_BUSINESS = /DEFAULT_BUSINESS_ID|selectedBusinessId\(|getStoredBusinessId\(/;
/**
 * A function that names a business route, carries the business in its query
 * (`?businessId=`) or in an object literal it sends (`{ businessId ... }`, the
 * routes BusinessGuard resolves from the body), or resolves a business.
 */
const NAMES_OR_RESOLVES_A_BUSINESS = /\/businesses\/|[?&]businessId=|\{\s*businessId\b|DEFAULT_BUSINESS_ID|selectedBusinessId\(|getStoredBusinessId\(/;

/**
 * A helper that answers an ApiResult ({ data, error }) instead of handing back a
 * Response or throwing: it declares one, builds one, or returns a transport
 * that answers one. With no business it must RESOLVE "No business selected"
 * (lib/api/_defaults.ts), never reject (CR-R015d-1).
 */
const ANSWERS_AN_API_RESULT = /ApiResult<|return \{ data[,:]|return api(?:Get|GetSimple|Post|PostSimple|Patch|Put|Delete)\b/;

/** Every exported function of a module's source, with its source text. */
function exportedFunctions(source: string): Array<{ name: string; body: string }> {
  const found: Array<{ name: string; body: string }> = [];
  let current: { name: string; body: string } | null = null;
  const flush = () => {
    if (current) found.push(current);
  };
  for (const line of source.split("\n")) {
    const fn = /^export (?:async )?function (\w+)/.exec(line);
    if (fn || /^(export |async function |function |const |let |type |interface |\/\*\*)/.test(line)) {
      flush();
      current = fn ? { name: fn[1], body: "" } : null;
    }
    if (current) current.body += `${line}\n`;
  }
  flush();
  return found;
}

/** Every exported function of a module's source whose body matches `selects`. */
function businessScopedFunctions(source: string, selects: RegExp = NAMES_OR_RESOLVES_A_BUSINESS): string[] {
  return exportedFunctions(source).filter((f) => selects.test(f.body)).map((f) => f.name);
}

type AnyFn = (...args: unknown[]) => unknown;

interface Recorded { url: string; via: "fetch" | "EventSource"; body?: unknown }

/** A request body as the server reads it: a JSON body parsed, anything else (FormData, none) undefined. */
function bodyOf(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The network stubbed as a permissive API: every request answers 200 `{}`. */
function stubNetwork() {
  const requests: Recorded[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, via: "fetch", body: bodyOf(init?.body) });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  class RecordingEventSource {
    onmessage: unknown = null;
    onerror: unknown = null;
    constructor(url: string) { requests.push({ url, via: "EventSource" }); }
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal("EventSource", RecordingEventSource);
  return requests;
}

/** How a call ended: it resolved, it threw or rejected, or it was still pending at the bound. */
type Settled =
  | { outcome: "resolved"; value: unknown }
  | { outcome: "rejected"; error: unknown }
  | { outcome: "pending" };

/** Settle a call (sync throw, rejection, or a promise that never settles) within a bound. */
async function settle(call: () => unknown): Promise<Settled> {
  let result: unknown;
  try {
    result = call();
  } catch (error) {
    return { outcome: "rejected", error };
  }
  if (typeof result === "function") {
    // A subscription: unsubscribe so nothing lingers.
    try { (result as () => void)(); } catch { /* ignore */ }
    return { outcome: "resolved", value: undefined };
  }
  return Promise.race<Settled>([
    Promise.resolve(result).then(
      (value: unknown): Settled => ({ outcome: "resolved", value }),
      (error: unknown): Settled => ({ outcome: "rejected", error }),
    ),
    new Promise<Settled>((resolve) => setTimeout(() => resolve({ outcome: "pending" }), 150)),
  ]);
}

/**
 * The business named by a request: its /businesses/ segment (a route word such
 * as /businesses/system/ names none), else its businessId query, else the
 * businessId of its JSON body (the routes BusinessGuard resolves from the body).
 * A body that names its business as null names "null": it is still a request
 * that names a business, and none it can be served for.
 */
function businessOf(request: Pick<Recorded, "url" | "body">): string | null {
  const u = new URL(request.url, "http://localhost");
  const segment = /\/businesses\/([^/?#]*)/.exec(u.pathname)?.[1];
  if (segment !== undefined) return segment !== "" && ROUTE_WORDS.has(segment) ? null : decodeURIComponent(segment);
  const query = u.searchParams.get("businessId");
  if (query !== null) return query;
  const body = request.body;
  if (body && typeof body === "object" && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, "businessId")) {
    return String((body as { businessId: unknown }).businessId);
  }
  return null;
}

/**
 * The helper layer: every business-route function of lib/client.ts (all of
 * them go through its guarded transports), and the functions of
 * lib/api/approvals.ts and lib/api/product-cost.ts that resolve a business for
 * their caller (they defaulted to the demo tenant too). The other functions of
 * lib/api/* take a required businessId and send through lib/api.ts directly;
 * see the follow-up below.
 */
const CLIENT_SOURCE = readText(CLIENT_FILE);
function helpersOf(module: string, source: string, exports: unknown, selects?: RegExp) {
  const bodies = new Map(exportedFunctions(source).map((f) => [f.name, f.body]));
  return businessScopedFunctions(source, selects).map((name) => ({
    module,
    name,
    fn: (exports as Record<string, AnyFn>)[name],
    answersApiResult: ANSWERS_AN_API_RESULT.test(bodies.get(name) ?? ""),
    params: parametersOf(name, bodies.get(name) ?? ""),
  }));
}

/**
 * The declared parameters of an exported function, from its source: the text
 * between the parentheses after its name, split at top-level commas, each
 * reduced to its name (or its destructuring pattern).
 */
function parametersOf(name: string, body: string): string[] {
  const open = body.indexOf("(", body.indexOf(`function ${name}`) + `function ${name}`.length);
  if (open === -1) return [];
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = open + 1; i < body.length; i += 1) {
    const ch = body[i];
    if (depth === 0 && ch === ")") {
      if (current.trim()) params.push(current);
      break;
    }
    if (depth === 0 && ch === ",") {
      params.push(current);
      current = "";
      continue;
    }
    if ("([{".includes(ch) || ch === "<") depth += 1;
    else if (")]}".includes(ch) || (ch === ">" && body[i - 1] !== "=")) depth -= 1;
    current += ch;
  }
  return params.map((p) => p.trim().replace(/^\.\.\./, "").split(/\??\s*[:=]/)[0].trim()).filter((p) => p !== "");
}

const HELPERS: Array<{ module: string; name: string; fn: AnyFn; answersApiResult: boolean; params: string[] }> = [
  ...helpersOf("lib/client.ts", CLIENT_SOURCE, client),
  ...helpersOf("lib/api/approvals.ts", readText(path.join(WEB_SRC, "lib", "api", "approvals.ts")), approvals, RESOLVES_A_BUSINESS),
  ...helpersOf("lib/api/product-cost.ts", readText(path.join(WEB_SRC, "lib", "api", "product-cost.ts")), productCost, RESOLVES_A_BUSINESS),
].filter((h) => typeof h.fn === "function");

/**
 * An input object for the helpers that take one (`input.businessId ?? ...`).
 * Used as an id instead it spells nothing (an empty id), so it can never name a
 * business by accident ("[object Object]").
 */
const EMPTY_INPUT = { toString: () => "" };

/** A parameter or input field that carries the business, which the census always leaves out. */
const BUSINESS_PARAM = /business|^bid$|^biz$|tenant/i;

/**
 * A non-empty stand-in for an id the caller must name that is not the business
 * (a contact, an invoice, a trigger, ...). Since FOLLOW3-D11 the lib/api.ts
 * transports refuse a request with a missing id ("Missing id") before anything
 * is sent, so a helper whose required id is left out no longer shows which
 * business it resolves; this shape names those ids and still leaves the
 * business out. Used as an id it spells "id_v84"; used as an input object
 * (`input.contactId`, `input.quoteId`) every id field but the business reads
 * "id_v84" and every other field, businessId included, is undefined.
 */
const ID = "id_v84";
const ID_INPUT: unknown = new Proxy({ toString: () => ID }, {
  get: (target, key) => {
    if (key === "toString") return target.toString;
    return typeof key === "string" && /(?:^id|Id)$/.test(key) && !BUSINESS_PARAM.test(key) ? ID : undefined;
  },
});

/**
 * The argument shapes a helper is tried with: nothing at all, then an empty
 * input object, then every parameter but the business named (FOLLOW3-D11).
 */
function argShapesOf(helper: { params: string[] }): unknown[][] {
  const shapes: unknown[][] = [[], [EMPTY_INPUT]];
  if (helper.params.length > 0) shapes.push(helper.params.map((p) => (BUSINESS_PARAM.test(p) ? undefined : ID_INPUT)));
  return shapes;
}

describe(`runtime census: the ${HELPERS.length} exported helpers that name a business route`, () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("the census finds the helper layer (sanity)", () => {
    expect(HELPERS.length).toBeGreaterThan(400);
    expect(HELPERS.map((h) => h.name)).toEqual(expect.arrayContaining([
      "fetchContacts", "fetchCustomFieldDefinitions", "createCustomFieldDefinition", "fetchDealStages",
      "fetchInvoices", "subscribeContactConversationStream", "approveApprovalRequest", "fetchProductCostProfile",
      // The business in the body or the query (SEC-R015d-2).
      "markInvoicePaid", "updateInvoiceStatus", "updateQuoteStatus", "fetchAutonomyProfile", "updateAutonomyProfile",
    ]));
    // The ApiResult helpers that send through the Response transport (CR-R015d-1).
    const answering = new Set(HELPERS.filter((h) => h.answersApiResult).map((h) => h.name));
    for (const name of ["updateStorefrontConfig", "fetchAiConversionAdvice", "updateAgentTrigger", "updateQualificationConfig", "savePresenceDraft", "unpublishPresence", "fetchContacts"]) {
      expect(answering, name).toContain(name);
    }
    expect(answering).not.toContain("importContactsFromFile");
  });

  it("with a business selected, every request any of them sends for a missing business names the selected business (never biz_demo); with none selected, or an empty, null or undefined id, they send nothing", { timeout: 120_000 }, async () => {
    const requests = stubNetwork();
    const exercised: string[] = [];
    const wrongBusiness: string[] = [];
    const shapeOf = new Map<string, unknown[]>();

    // A business is selected: whatever a helper sends for a caller that named
    // none must name that business.
    for (const helper of HELPERS) {
      for (const args of argShapesOf(helper)) {
        window.localStorage.clear();
        window.localStorage.setItem("kf_business_id", SELECTED);
        const before = requests.length;
        await settle(() => helper.fn(...args));
        const sent = requests.slice(before);
        if (sent.length === 0) continue;
        shapeOf.set(helper.name, args);
        exercised.push(helper.name);
        for (const r of sent) {
          const business = businessOf(r);
          if (business !== null && business !== SELECTED) wrongBusiness.push(`${helper.module} ${helper.name}(${JSON.stringify(args).slice(1, -1)}) -> ${r.via} ${new URL(r.url, "http://localhost").pathname}${new URL(r.url, "http://localhost").search} business=${business}`);
        }
        break;
      }
    }
    expect(wrongBusiness).toEqual([]);
    // Most of the layer resolves a missing business itself; the rest takes it as
    // a required argument (and is covered by the run below).
    expect(exercised.length).toBeGreaterThan(250);

    // No business selected: nothing is sent, for every helper and every shape,
    // and a missing (undefined) required id is refused the same way. A helper
    // that answers an ApiResult answers the refusal; it does not reject.
    const sentWithout: string[] = [];
    const rejectedInstead: string[] = [];
    for (const helper of HELPERS) {
      for (const args of shapeOf.has(helper.name) ? [shapeOf.get(helper.name) as unknown[]] : argShapesOf(helper)) {
        window.localStorage.clear();
        const before = requests.length;
        const settled = await settle(() => helper.fn(...args));
        const call = `${helper.module} ${helper.name}(${JSON.stringify(args).slice(1, -1)})`;
        for (const r of requests.slice(before)) {
          // Any request naming a business, in its path, query or body (a route
          // word such as /businesses/system/ names none).
          const business = businessOf(r);
          if (business !== null) {
            sentWithout.push(`${call} -> ${r.via} ${new URL(r.url, "http://localhost").pathname}${new URL(r.url, "http://localhost").search} business=${business}`);
          }
        }
        // The refusal itself must not reject. (A TypeError from an argument
        // the census leaves out, say a required status or input object, is
        // the caller's type error, not the refusal.)
        if (helper.answersApiResult && settled.outcome === "rejected" && (settled.error as Error)?.message === NO_BUSINESS) {
          rejectedInstead.push(`${call} rejected: ${(settled.error as Error).name}: ${NO_BUSINESS}`);
        }
      }
    }
    expect(sentWithout).toEqual([]);
    expect(rejectedInstead).toEqual([]);
  });

  it("a business-scoped read with no business selected answers the typed 'No business selected' state without a request", async () => {
    const requests = stubNetwork();
    const answers = await Promise.all([
      client.fetchContacts(),
      client.fetchDealStages(),
      client.fetchInvoices(),
      productCost.fetchProductCostProfile("prod_1"),
      approvals.approveApprovalRequest("apr_1", "usr_1"),
    ]);
    expect(requests).toEqual([]);
    for (const answer of answers) expect(answer).toMatchObject({ error: NO_BUSINESS });
  });

  it("an explicit empty, null or undefined business id is refused without a request even when a business is selected", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const requests = stubNetwork();
    const answers = await Promise.all([
      client.fetchContacts(""),
      client.fetchDealStages(null as unknown as string),
      client.fetchCustomFieldDefinitions("undefined"),
      client.createCustomFieldDefinition({ name: "tier", label: "Tier", type: "TEXT", description: null, placeholder: null, options: null, defaultValue: null, required: false, order: 0 }, ""),
    ]);
    expect(requests).toEqual([]);
    for (const answer of answers) expect(answer).toMatchObject({ error: NO_BUSINESS });
  });

  it("a helper that carries the business in the request body or query sends nothing with no business selected, or an empty one (SEC-R015d-2)", async () => {
    const requests = stubNetwork();
    const unselected = await Promise.all([
      client.markInvoicePaid("inv_1"),
      client.updateInvoiceStatus("inv_1", "SENT"),
      client.updateQuoteStatus("q_1", "SENT"),
      client.updateAutonomyProfile(undefined as unknown as string, {}),
      client.fetchAutonomyProfile(undefined as unknown as string),
    ]);
    window.localStorage.setItem("kf_business_id", SELECTED);
    const empty = await Promise.all([
      client.markInvoicePaid("inv_1", ""),
      client.updateInvoiceStatus("inv_1", "VOID", { businessId: "" }),
      client.updateQuoteStatus("q_1", "ACCEPTED", ""),
      client.updateAutonomyProfile("", {}),
      client.updateAutonomyProfile(null as unknown as string, {}),
      client.fetchAutonomyProfile(""),
      client.fetchAutonomyProfile("null"),
    ]);
    expect(requests.map((r) => `${new URL(r.url, "http://localhost").pathname}${new URL(r.url, "http://localhost").search} ${JSON.stringify(r.body)}`)).toEqual([]);
    for (const answer of [...unselected, ...empty]) expect(answer).toMatchObject({ error: NO_BUSINESS });
  });

  it("an ApiResult helper that sends through the Response transport answers 'No business selected' for an empty id instead of rejecting (CR-R015d-1)", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const requests = stubNetwork();
    const settled = await Promise.all([
      settle(() => client.updateStorefrontConfig("", {})),
      settle(() => client.fetchAiConversionAdvice("")),
      settle(() => client.updateAgentTrigger("", "trg_1", { enabled: true })),
      settle(() => client.updateQualificationConfig("", {} as Parameters<typeof client.updateQualificationConfig>[1])),
      settle(() => client.savePresenceDraft("", {} as Parameters<typeof client.savePresenceDraft>[1])),
      settle(() => client.unpublishPresence("")),
    ]);
    expect(requests).toEqual([]);
    for (const s of settled) expect(s).toEqual({ outcome: "resolved", value: { data: null, error: NO_BUSINESS } });
  });

  it("control: a business the caller names is the business called", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const requests = stubNetwork();
    await client.fetchContacts(HANDED);
    await client.fetchCustomFieldDefinitions(HANDED);
    await productCost.fetchProductCostProfile("prod_1", HANDED);
    await client.markInvoicePaid("inv_1", HANDED);
    await client.fetchAutonomyProfile(HANDED);
    await client.updateStorefrontConfig(HANDED, {});
    expect(requests.map((r) => businessOf(r))).toEqual([HANDED, HANDED, HANDED, HANDED, HANDED, HANDED]);
  });

  it("control: a body-scoped helper whose caller names no business sends the selected business in the body", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const requests = stubNetwork();
    await client.markInvoicePaid("inv_1");
    await client.updateInvoiceStatus("inv_1", "SENT");
    await client.updateQuoteStatus("q_1", "SENT");
    expect(requests.map((r) => (r.body as { businessId?: unknown }).businessId)).toEqual([SELECTED, SELECTED, SELECTED]);
  });
});

// ---------------------------------------------------------------------------
// 3. The mounts
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const fieldOf = (businessId: string) => `Tier of ${businessId}`;

function definitionOf(businessId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `cfd_${businessId}`,
    businessId,
    name: `tier_${businessId}`,
    label: fieldOf(businessId),
    type: "TEXT",
    description: null,
    placeholder: null,
    options: null,
    defaultValue: null,
    required: false,
    order: 1,
    archivedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    ...extra,
  };
}

/**
 * Stub the API as the guards answer it for a member of `memberOf`: a business
 * the member does not belong to gets 403 before any handler runs. Returns every
 * request as "METHOD /path".
 */
function stubApi(memberOf: string[] = [SELECTED, HANDED]) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    requested.push(`${method} ${pathname}`);
    const tenant = /\/businesses\/([^/]+)/.exec(pathname)?.[1];
    if (tenant && !memberOf.includes(decodeURIComponent(tenant))) {
      return jsonResponse(403, { statusCode: 403, message: "No access to this business", error: "Forbidden" }, "Forbidden");
    }
    const business = tenant ? decodeURIComponent(tenant) : "";
    if (/\/custom-field-definitions$/.test(pathname)) {
      if (method === "POST") return jsonResponse(201, definitionOf(business, { id: "cfd_new", label: "Birthday" }));
      return jsonResponse(200, [definitionOf(business)]);
    }
    if (/\/custom-field-definitions\/[^/]+\/(archive|restore)$/.test(pathname)) return jsonResponse(200, definitionOf(business));
    if (/\/custom-field-definitions\/[^/]+$/.test(pathname) && method === "DELETE") return jsonResponse(200, {});
    if (/\/crm\/businesses\/[^/]+\/contacts$/.test(pathname)) return jsonResponse(200, { contacts: [], nextCursor: null, hasMore: false });
    if (/\/crm\/businesses\/[^/]+\/contacts\/[^/]+$/.test(pathname) && method === "PATCH") return jsonResponse(200, { id: pathname.split("/").pop() });
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return {
    requested,
    definitionReads: () => requested.filter((r) => /^GET .*\/custom-field-definitions$/.test(r)),
    definitionCalls: () => requested.filter((r) => r.includes("/custom-field-definitions")),
    namingDemo: () => requested.filter((r) => r.includes(`/businesses/${DEMO}`)),
  };
}

const definitionsPath = (businessId: string) => `GET /crm/businesses/${businessId}/custom-field-definitions`;

/** Another tab signs in elsewhere: kf_business_id moves and a `storage` event says so. */
function switchInAnotherTab(businessId: string) {
  act(() => {
    window.localStorage.setItem("kf_business_id", businessId);
    window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: businessId }));
  });
}

const contact = {
  id: "c_1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  status: "LEAD",
  department: "Research",
  tags: [],
} as unknown as ContactDetailData;

/** The contact's stored typed values, one per business's definition, so whichever business is read shows a value. */
const storedValues = [SELECTED, HANDED].map((businessId) => ({
  id: `cfv_${businessId}`,
  definitionId: `cfd_${businessId}`,
  value: `Gold at ${businessId}`,
  definition: { name: `tier_${businessId}`, label: fieldOf(businessId), type: "TEXT", description: null, placeholder: null },
}));

describe("the mounts read and write the business they are bound to", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("contact detail: ContactDetail hands its business to the panel, so the custom fields read that business, not kf_business_id (SEC-R015c-1)", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(createElement(ContactDetail, { contact, customFieldValues: storedValues, businessId: HANDED }));
    fireEvent.click(screen.getByRole("button", { name: /More details/ }));

    await waitFor(() => expect(api.definitionReads().length).toBeGreaterThan(0));
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.getByText(`Gold at ${HANDED}`)).toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(HANDED)]);
    expect(api.namingDemo()).toEqual([]);
  });

  it("contact detail: the consent write (Do Not Contact) and the momentum reads go to the business ContactDetail is bound to, not kf_business_id (SEC-R015d-1)", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    const api = stubApi();
    render(createElement(ContactDetail, { contact: { ...contact, doNotContact: false } as ContactDetailData, customFieldValues: storedValues, businessId: HANDED }));

    // The momentum card and badge read the bound business.
    await waitFor(() => expect(api.requested).toEqual(expect.arrayContaining([
      `GET /momentum/businesses/${HANDED}/contacts/c_1`,
      `GET /momentum/businesses/${HANDED}/contacts/c_1/history`,
    ])));

    fireEvent.click(screen.getByRole("button", { name: /More details/ }));
    fireEvent.click(await screen.findByText("Contactable"));
    fireEvent.click(await screen.findByRole("button", { name: "Mark Do Not Contact" }));
    await waitFor(() => expect(api.requested.filter((r) => !r.startsWith("GET "))).toEqual([`PATCH /crm/businesses/${HANDED}/contacts/c_1`]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Marked as Do Not Contact"));
    expect(toast.error).not.toHaveBeenCalled();

    // Nothing this contact detail sent named the business kf_business_id says.
    expect(api.requested.filter((r) => r.includes(`/businesses/${SELECTED}/`))).toEqual([]);
    expect(api.namingDemo()).toEqual([]);
  });

  it("contact detail: with the selected business it reads the selected business", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(createElement(ContactDetail, { contact, customFieldValues: storedValues, businessId: SELECTED }));
    fireEvent.click(screen.getByRole("button", { name: /More details/ }));

    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]);
    expect(api.namingDemo()).toEqual([]);
  });

  it("pipeline tab: the contact form reads the custom fields of the business the pipeline submits to, even after kf_business_id moves in another tab (SEC-R015c-1)", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    function PipelineScreen() {
      const state = useContactsPipeline();
      const { businessId, setShowAddForm } = state;
      useEffect(() => {
        if (businessId) setShowAddForm(true);
      }, [businessId, setShowAddForm]);
      return createElement(PipelineTabContent, { state });
    }
    render(createElement(PipelineScreen));

    // The pipeline is bound to the selected business (its contacts read names it).
    await waitFor(() => expect(api.requested.some((r) => r.startsWith(`GET /crm/businesses/${SELECTED}/contacts`))).toBe(true));
    switchInAnotherTab(HANDED);

    fireEvent.click(await screen.findByText("Structured Custom Fields"));
    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]);
    expect(screen.queryByText(fieldOf(HANDED))).not.toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });

  it("settings/custom-fields: reads, creates, archives and deletes the selected business's definitions, never biz_demo (SEC-R015c-2)", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(createElement(CustomFieldsSettingsPage));

    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]);

    fireEvent.change(screen.getByPlaceholderText("e.g. Birthday"), { target: { value: "Birthday" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Field/ }));
    await waitFor(() => expect(api.requested).toContain(`POST /crm/businesses/${SELECTED}/custom-field-definitions`));

    fireEvent.click(screen.getAllByTitle("Archive")[0]);
    await waitFor(() => expect(api.requested).toContain(`POST /crm/businesses/${SELECTED}/custom-field-definitions/cfd_${SELECTED}/archive`));

    fireEvent.click(screen.getAllByTitle("Delete")[0]);
    const confirm = (await screen.findByText("Delete Permanently?")).closest("div.space-y-4") as HTMLElement;
    fireEvent.click(within(confirm).getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(api.requested).toContain(`DELETE /crm/businesses/${SELECTED}/custom-field-definitions/cfd_${SELECTED}`));

    expect(api.definitionCalls().every((r) => r.includes(`/crm/businesses/${SELECTED}/`))).toBe(true);
    expect(api.namingDemo()).toEqual([]);
  });

  it("settings/custom-fields: a switch of the selected business re-reads the new business", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(createElement(CustomFieldsSettingsPage));
    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();

    act(() => { selectBusiness(HANDED); });
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]);
    expect(api.namingDemo()).toEqual([]);
  });

  it("settings/custom-fields: with no business selected it sends nothing and says so", async () => {
    const api = stubApi();
    render(createElement(CustomFieldsSettingsPage));
    expect(await screen.findByText(/No business selected/i)).toBeInTheDocument();
    // Give any read a chance to go out.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(api.requested).toEqual([]);
  });
});

describe("the lib/api.ts transports refuse an unbound business for every lib/api/* module and screen (FOLLOW3-D11)", () => {
  // The census above proves every site of the helper layer (lib/client.ts, and
  // the resolving functions of lib/api/approvals.ts and product-cost.ts) refuses
  // an empty, null or undefined id, and that no site anywhere resolves to the
  // demo tenant or another literal. The other lib/api/* modules
  // (business-genome, finance, structure, approvals' required-id functions,
  // ...) take a required businessId and send through the lib/api.ts transports
  // directly, and about 60 screens pass `getStoredBusinessId() ?? ""` into
  // them, so with no business selected they sent /businesses//... FOLLOW3-D11
  // puts the guard in lib/api.ts itself: apiGet, apiPost, apiPostSimple,
  // apiPatch, apiPut and apiDelete refuse a request for which _defaults.ts
  // requestNamesNoBusiness is true (and one with any other missing id segment,
  // lib/__tests__/api-empty-id-segment.test.ts). Still outside: the
  // Response-returning fetchWithAuthRetry (lib/client.ts guards its own use of
  // it) and the screens' raw fetch() sites.
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lib/api.ts refuses a request whose /businesses/ segment is empty, undefined or null, so no lib/api/* module or screen can send an empty business id", async () => {
    const requests = stubNetwork();
    const unbound = ["", "undefined", "null"];
    const transports = await Promise.all(unbound.flatMap((id) => [
      transport.apiGet(`/finance/businesses/${id}/accounts`),
      transport.apiPost({ path: `/finance/businesses/${id}/accounts`, body: { name: "x" } }),
      transport.apiPostSimple(`/finance/businesses/${id}/accounts`, { name: "x" }),
      transport.apiPatch(`/finance/businesses/${id}/accounts/acc_1`, { name: "x" }),
      transport.apiPut(`/finance/businesses/${id}/accounts/acc_1`, { name: "x" }),
      transport.apiDelete(`/finance/businesses/${id}/accounts/acc_1`),
    ]));
    // The lib/api/* modules a screen hands `getStoredBusinessId() ?? ""`, with
    // no business selected; and the same modules handed undefined or null.
    const modules = await Promise.all(["", undefined, null].flatMap((id) => {
      const bid = id as unknown as string;
      return [
        finance.fetchReserveBuckets(bid),
        finance.createReserveBucket(bid, { name: "x", purpose: "y" }),
        structure.fetchOrgUnits(bid),
        structure.deleteOrgUnit(bid, "ou_1"),
        businessGenome.getGenome(bid),
        approvals.fetchApprovalRequest(bid, "apr_1"),
        approvals.escalateApproval(bid, "apr_1"),
      ];
    }));
    expect(requests.map((r) => new URL(r.url, "http://localhost").pathname)).toEqual([]);
    for (const answer of [...transports, ...modules]) expect(answer).toEqual({ data: null, error: NO_BUSINESS });

    // Control: the same modules, handed the selected business, call it.
    await finance.fetchReserveBuckets(SELECTED);
    await structure.fetchOrgUnits(SELECTED);
    await businessGenome.getGenome(SELECTED);
    await approvals.fetchApprovalRequest(SELECTED, "apr_1");
    expect(requests.map((r) => businessOf(r))).toEqual([SELECTED, SELECTED, SELECTED, SELECTED]);
  });
});

// ---------------------------------------------------------------------------
// 4. The e2e workflows serve the build the way it is built
// ---------------------------------------------------------------------------

describe("the e2e workflows' web server matches the Next output mode", () => {
  const nextConfig = readText(path.join(WEB_SRC, "..", "next.config.ts"));
  const workflowsDir = path.join(REPO_ROOT, ".github", "workflows");
  const commands = fs
    .readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) =>
      readText(path.join(workflowsDir, f))
        .split("\n")
        .map((line, i) => ({ where: `${f}:${i + 1}`, value: /^\s*E2E_WEB_COMMAND:\s*(.+?)\s*$/.exec(line)?.[1] }))
        .filter((c): c is { where: string; value: string } => c.value !== undefined),
    );

  it("next.config.ts builds the standalone output, and the workflows name an e2e web server command (sanity)", () => {
    expect(nextConfig).toMatch(/output:\s*["']standalone["']/);
    expect(commands.length).toBeGreaterThanOrEqual(2);
  });

  it("every E2E_WEB_COMMAND serves the standalone build, none runs `next start` (which does not serve output: standalone)", () => {
    const mismatched = commands.filter((c) => !/^["']?standalone["']?$/.test(c.value));
    expect(mismatched.map((c) => `${c.where}: ${c.value}`)).toEqual([]);
  });
});
