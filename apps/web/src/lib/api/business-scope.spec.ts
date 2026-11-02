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
 *      that names a business route is called for real, with only the network
 *      stubbed. With a business selected, every request it sends names that
 *      business; with none selected (and with an empty, null or undefined id),
 *      it sends nothing and answers "No business selected" instead.
 *   3. The mounts: contact detail, the pipeline tab and settings/custom-fields,
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
import { ContactDetail, type ContactDetailData } from "@/components/contacts/contact-detail";
import CustomFieldsSettingsPage from "@/app/app/settings/custom-fields/page";
import { PipelineTabContent } from "@/app/app/crm/pipeline/pipeline-tab-content";
import { useContactsPipeline } from "@/app/app/crm/pipeline/use-contacts-pipeline";
import { selectBusiness } from "@/lib/workspace";

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
/** A function that names a business route, or resolves a business. */
const NAMES_OR_RESOLVES_A_BUSINESS = /\/businesses\/|DEFAULT_BUSINESS_ID|selectedBusinessId\(|getStoredBusinessId\(/;

/** Every exported function of a module's source whose body matches `selects`. */
function businessScopedFunctions(source: string, selects: RegExp = NAMES_OR_RESOLVES_A_BUSINESS): string[] {
  const names: string[] = [];
  let current: { name: string; body: string } | null = null;
  const flush = () => {
    if (current && selects.test(current.body)) names.push(current.name);
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
  return names;
}

type AnyFn = (...args: unknown[]) => unknown;

interface Recorded { url: string; via: "fetch" | "EventSource" }

/** The network stubbed as a permissive API: every request answers 200 `{}`. */
function stubNetwork() {
  const requests: Recorded[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, via: "fetch" });
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

/** Settle a call (sync throw, rejection, or a promise that never settles) within a bound. */
async function settle(call: () => unknown): Promise<unknown> {
  let result: unknown;
  try {
    result = call();
  } catch (error) {
    return error;
  }
  if (typeof result === "function") {
    // A subscription: unsubscribe so nothing lingers.
    try { (result as () => void)(); } catch { /* ignore */ }
    return undefined;
  }
  return Promise.race([
    Promise.resolve(result).catch((error: unknown) => error),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 150)),
  ]);
}

/**
 * The business named by a request: its /businesses/ segment (a route word such
 * as /businesses/system/ names none), else its businessId query.
 */
function businessOf(url: string): string | null {
  const u = new URL(url, "http://localhost");
  const segment = /\/businesses\/([^/?#]*)/.exec(u.pathname)?.[1];
  if (segment !== undefined) return segment !== "" && ROUTE_WORDS.has(segment) ? null : decodeURIComponent(segment);
  return u.searchParams.get("businessId");
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
const HELPERS: Array<{ module: string; name: string; fn: AnyFn }> = [
  ...businessScopedFunctions(CLIENT_SOURCE).map((name) => ({ module: "lib/client.ts", name, fn: (client as unknown as Record<string, AnyFn>)[name] })),
  ...businessScopedFunctions(readText(path.join(WEB_SRC, "lib", "api", "approvals.ts")), RESOLVES_A_BUSINESS).map((name) => ({ module: "lib/api/approvals.ts", name, fn: (approvals as unknown as Record<string, AnyFn>)[name] })),
  ...businessScopedFunctions(readText(path.join(WEB_SRC, "lib", "api", "product-cost.ts")), RESOLVES_A_BUSINESS).map((name) => ({ module: "lib/api/product-cost.ts", name, fn: (productCost as unknown as Record<string, AnyFn>)[name] })),
].filter((h) => typeof h.fn === "function");

/**
 * An input object for the helpers that take one (`input.businessId ?? ...`).
 * Used as an id instead it spells nothing (an empty id), so it can never name a
 * business by accident ("[object Object]").
 */
const EMPTY_INPUT = { toString: () => "" };

/** The argument shapes a helper is tried with: nothing at all, then an empty input object. */
const ARG_SHAPES: unknown[][] = [[], [EMPTY_INPUT]];

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
    ]));
  });

  it("with a business selected, every request any of them sends for a missing business names the selected business (never biz_demo); with none selected, or an empty, null or undefined id, they send nothing", { timeout: 120_000 }, async () => {
    const requests = stubNetwork();
    const exercised: string[] = [];
    const wrongBusiness: string[] = [];
    const shapeOf = new Map<string, unknown[]>();

    // A business is selected: whatever a helper sends for a caller that named
    // none must name that business.
    for (const helper of HELPERS) {
      for (const args of ARG_SHAPES) {
        window.localStorage.clear();
        window.localStorage.setItem("kf_business_id", SELECTED);
        const before = requests.length;
        await settle(() => helper.fn(...args));
        const sent = requests.slice(before);
        if (sent.length === 0) continue;
        shapeOf.set(helper.name, args);
        exercised.push(helper.name);
        for (const r of sent) {
          const business = businessOf(r.url);
          if (business !== null && business !== SELECTED) wrongBusiness.push(`${helper.module} ${helper.name}(${JSON.stringify(args).slice(1, -1)}) -> ${r.via} ${new URL(r.url, "http://localhost").pathname}`);
        }
        break;
      }
    }
    expect(wrongBusiness).toEqual([]);
    // Most of the layer resolves a missing business itself; the rest takes it as
    // a required argument (and is covered by the run below).
    expect(exercised.length).toBeGreaterThan(250);

    // No business selected: nothing is sent, for every helper and every shape,
    // and a missing (undefined) required id is refused the same way.
    const sentWithout: string[] = [];
    for (const helper of HELPERS) {
      for (const args of shapeOf.has(helper.name) ? [shapeOf.get(helper.name) as unknown[]] : ARG_SHAPES) {
        window.localStorage.clear();
        const before = requests.length;
        await settle(() => helper.fn(...args));
        for (const r of requests.slice(before)) {
          // Any request naming a business (a route word such as /businesses/system/ names none).
          if (businessOf(r.url) !== null) {
            sentWithout.push(`${helper.module} ${helper.name}(${JSON.stringify(args).slice(1, -1)}) -> ${r.via} ${new URL(r.url, "http://localhost").pathname}`);
          }
        }
      }
    }
    expect(sentWithout).toEqual([]);
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

  it("control: a business the caller names is the business called", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const requests = stubNetwork();
    await client.fetchContacts(HANDED);
    await client.fetchCustomFieldDefinitions(HANDED);
    await productCost.fetchProductCostProfile("prod_1", HANDED);
    expect(requests.map((r) => businessOf(r.url))).toEqual([HANDED, HANDED, HANDED]);
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

describe("follow-ups outside this write set", () => {
  // The census above proves every site of the helper layer (lib/client.ts, and
  // the resolving functions of lib/api/approvals.ts and product-cost.ts) refuses
  // an empty, null or undefined id, and that no site anywhere resolves to the
  // demo tenant or another literal. It does not prove the rest: the other
  // lib/api/* modules (business-genome, finance, structure, approvals'
  // required-id functions, ...) take a required businessId and send through the
  // lib/api.ts helpers directly, and about 60 screens pass
  // `getStoredBusinessId() ?? ""` into them, so with no business selected they
  // send /businesses//... (the server answers 403/404; nothing resolves to
  // another tenant). The fix is one guard in lib/api.ts (apiGet, apiPost,
  // apiPatch, apiPut, apiDelete, fetchWithAuthRetry refuse a URL for which
  // _defaults.ts namesNoBusiness is true), plus the screens' raw fetch() sites:
  // lib/api.ts is outside this packet's write set.
  it.todo("lib/api.ts refuses a request whose /businesses/ segment is empty, undefined or null, so no lib/api/* module or screen can send an empty business id");
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
