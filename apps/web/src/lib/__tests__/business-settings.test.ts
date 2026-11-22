/**
 * BIZ-SETTINGS-WEB (re-cut v1 plan, step 3, lane web; owner rulings D-150 'hubs', D-218 'sellsowner', D-11).
 *
 * WHY this test exists: the server keeps three per-business v1 settings (BIZ-SETTINGS-SERVER:
 * Business.metaData sells / advancedCrm / depth, answered top-level by GET /identity/businesses/:id), and the
 * web had no reader of them: the nav (NAV-A1) and the hubs could not know what the business sells. This pins
 * the one web reader and its two write doors, through the real api client (lib/api.ts; fetch stubbed per route
 * and recording every request):
 *
 *   - the values the web names are the server's own (read from core/prisma/business-meta.ts, not a copy that
 *     could drift), and an answer is read exactly as the server reads a stored value: each absent or invalid
 *     key at its default ('both', false, every hub 'standard');
 *   - what the business sells is written through the owner-only profile PATCH and nothing else; the Advanced
 *     CRM switch and hub depth through the owner-or-admin door (BIZ-SETTINGS-ADMIN-DOOR) and never through the
 *     profile PATCH; the door is never sent sells;
 *   - useBusinessSettings() exposes sells / advancedCrm / depth for the business this browser is using, says
 *     when it is still loading or could not load (defaults are then not presented as loaded), never shows one
 *     business's settings under another, and a refused write changes nothing it shows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as settingsModule from "../business-settings";

/** The module's exports by name: a missing export is a failing expectation, not a compile error. */
const lib = settingsModule as unknown as Record<string, any>;

const BIZ_A = "biz_bsw_a";
const BIZ_B = "biz_bsw_b";
const BUSINESS_ID_KEY = "kf_business_id";

const serverMeta = readFileSync(
  path.resolve(__dirname, "../../../../server/src/core/prisma/business-meta.ts"),
  "utf8",
);
/** A `export const NAME = [...] as const` list of the server's business-meta.ts. */
function serverList(name: string): string[] {
  const found = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(serverMeta);
  if (!found) throw new Error(`${name} not found in business-meta.ts`);
  return [...found[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
const SERVER_HUBS = serverList("BUSINESS_HUBS");

type Sent = { method: string; path: string; body: Record<string, unknown> | null };
type Answer = { status: number; body: unknown };
type Routes = Record<string, Answer | (() => Answer | Promise<Answer>)>;

/** fetch answering by "METHOD /path"; an unlisted route is a 500 so nothing passes by accident. */
function stubRoutes(routes: Routes): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const pathname = new URL(url, "http://localhost").pathname;
      sent.push({ method, path: pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const route = routes[`${method} ${pathname}`];
      const answer = route ? (typeof route === "function" ? await route() : route) : { status: 500, body: { message: `no route ${method} ${pathname}` } };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        statusText: answer.status === 403 ? "Forbidden" : answer.status === 400 ? "Bad Request" : "OK",
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return sent;
}

const allHubs = (depth: string) => Object.fromEntries(SERVER_HUBS.map((h) => [h, depth]));

function business(id: string, settings: Record<string, unknown> = {}) {
  return { id, name: `Business ${id}`, sells: "both", advancedCrm: false, depth: allHubs("standard"), ...settings };
}

const forbidden = (message: string, code?: string) => ({ statusCode: 403, ...(code ? { code } : {}), message, error: "Forbidden" });

beforeEach(() => {
  window.localStorage.clear();
  lib.resetBusinessSettings?.();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the settings the web names are the server's", () => {
  it("names the server's sells values, hubs and depths", () => {
    expect([...lib.BUSINESS_SELLS]).toEqual(serverList("BUSINESS_SELLS"));
    expect([...lib.BUSINESS_HUBS]).toEqual(SERVER_HUBS);
    expect([...lib.HUB_DEPTHS]).toEqual(serverList("HUB_DEPTHS"));
  });

  it("reads a business answer's three keys", () => {
    const read = lib.businessSettingsOf(business(BIZ_A, { sells: "products", advancedCrm: true, depth: { ...allHubs("standard"), money: "advanced" } }));
    expect(read).toEqual({ sells: "products", advancedCrm: true, depth: { ...allHubs("standard"), money: "advanced" } });
  });

  it("reads each absent or invalid key at the server's default: both, off, every hub standard", () => {
    const defaults = { sells: "both", advancedCrm: false, depth: allHubs("standard") };
    expect(lib.businessSettingsOf({ id: BIZ_A })).toEqual(defaults);
    expect(lib.businessSettingsOf(null)).toEqual(defaults);
    expect(lib.businessSettingsOf("products")).toEqual(defaults);
    expect(lib.businessSettingsOf({ sells: "everything", advancedCrm: "true", depth: ["advanced"] })).toEqual(defaults);
    // A depth names hubs only, and each hub a depth only; anything else is ignored, never passed on.
    expect(lib.businessSettingsOf({ depth: { money: "advanced", sales: "deep", warehouse: "advanced", __proto__: "advanced" } })).toEqual({
      ...defaults,
      depth: { ...allHubs("standard"), money: "advanced" },
    });
  });

  it("tells a sells value from anything else", () => {
    for (const value of serverList("BUSINESS_SELLS")) expect(lib.isBusinessSells(value)).toBe(true);
    for (const value of ["", "Both", "everything", null, undefined, 1, {}]) expect(lib.isBusinessSells(value)).toBe(false);
  });
});

describe("the two write doors", () => {
  it("what the business sells goes through the owner-only profile PATCH, alone", async () => {
    const sent = stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) } });
    const res = await lib.saveBusinessSells(BIZ_A, "services");
    expect(res.error).toBeNull();
    expect(sent).toEqual([{ method: "PATCH", path: `/identity/businesses/${BIZ_A}`, body: { sells: "services" } }]);
  });

  it("a value that is not one is not sent", async () => {
    const sent = stubRoutes({});
    const res = await lib.saveBusinessSells(BIZ_A, "everything");
    expect(typeof res.error).toBe("string");
    expect(res.error).not.toBe("");
    expect(sent).toEqual([]);
  });

  it("the Advanced CRM switch goes through the owner-or-admin door, never the profile PATCH", async () => {
    const sent = stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: business(BIZ_A, { advancedCrm: true }) } });
    const res = await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true });
    expect(res.error).toBeNull();
    expect(sent).toEqual([{ method: "PATCH", path: `/identity/businesses/${BIZ_A}/advanced-settings`, body: { advancedCrm: true } }]);
  });

  it("hub depth goes through the same door", async () => {
    const sent = stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: business(BIZ_A, { depth: { ...allHubs("standard"), money: "advanced" } }) } });
    const res = await lib.saveAdvancedSettings(BIZ_A, { depth: { money: "advanced" } });
    expect(res.error).toBeNull();
    expect(sent).toEqual([{ method: "PATCH", path: `/identity/businesses/${BIZ_A}/advanced-settings`, body: { depth: { money: "advanced" } } }]);
  });

  it("the door is sent advancedCrm and depth only: sells and any other key never leave through it", async () => {
    const sent = stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: business(BIZ_A, { advancedCrm: true }) } });
    await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true, sells: "products", name: "Renamed" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ advancedCrm: true });
  });

  it("a write naming neither setting, or a value that is not one, is not sent", async () => {
    const sent = stubRoutes({});
    for (const write of [{}, { sells: "products" }, { advancedCrm: "yes" }, { depth: { warehouse: "advanced" } }, { depth: { money: "deep" } }, { depth: [] }]) {
      const res = await lib.saveAdvancedSettings(BIZ_A, write);
      expect(typeof res.error).toBe("string");
      expect(res.error).not.toBe("");
    }
    expect(sent).toEqual([]);
  });

  it("a refusal is answered as the server said it, with its status", async () => {
    const words = "Only the business owner, or an admin with settings admin access, can change the Advanced CRM switch and hub depth.";
    stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 403, body: forbidden(words, "BUSINESS_ADVANCED_SETTINGS_FORBIDDEN") } });
    const res = await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true });
    expect(res.error).toBe(words);
    expect(res.status).toBe(403);
  });
});

describe("useBusinessSettings()", () => {
  it("exposes sells, advancedCrm and depth of the business this browser is using", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true }) } });
    const { result } = renderHook(() => lib.useBusinessSettings());
    // Until the answer lands the hook says so, and holds the defaults (every hub), not a guess.
    expect(result.current.status).toBe("loading");
    expect(result.current.sells).toBe("both");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.businessId).toBe(BIZ_A);
    expect(result.current.sells).toBe("products");
    expect(result.current.advancedCrm).toBe(true);
    expect(result.current.depth).toEqual(allHubs("standard"));
    expect(sent.every((s) => s.method === "GET" && s.path === `/identity/businesses/${BIZ_A}`)).toBe(true);
  });

  it("given a business id it reads that business, whatever the browser has selected", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_B);
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) } });
    const { result } = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ businessId: BIZ_A, sells: "services" });
    expect(sent.some((s) => s.path.includes(BIZ_B))).toBe(false);
  });

  it("with no business selected it asks nothing and holds the defaults", async () => {
    const sent = stubRoutes({});
    const { result } = renderHook(() => lib.useBusinessSettings());
    expect(result.current.status).toBe("idle");
    expect(result.current.businessId).toBeNull();
    expect(result.current).toMatchObject({ sells: "both", advancedCrm: false, depth: allHubs("standard") });
    expect(sent).toEqual([]);
  });

  it("a read that fails is said as failed, with the reason; the defaults are not presented as loaded", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 403, body: forbidden("No access to this business") } });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("No access to this business");
    expect(result.current).toMatchObject({ sells: "both", advancedCrm: false });
  });

  it("an answer for another business than the one asked for is not taken", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_B, { sells: "products" }) } });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.sells).toBe("both");
  });

  it("a switch of business never shows the previous business's settings", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    let releaseB: (a: Answer) => void = () => {};
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true }) },
      [`GET /identity/businesses/${BIZ_B}`]: () => new Promise<Answer>((resolve) => (releaseB = resolve)),
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sells).toBe("products");

    act(() => {
      window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_B);
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: BIZ_B } }));
    });
    await waitFor(() => expect(result.current.businessId).toBe(BIZ_B));
    // B's answer has not landed: A's 'products' and Advanced CRM are not shown under B.
    expect(result.current.status).toBe("loading");
    expect(result.current).toMatchObject({ sells: "both", advancedCrm: false });

    await act(async () => releaseB({ status: 200, body: business(BIZ_B, { sells: "services" }) }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ businessId: BIZ_B, sells: "services", advancedCrm: false });
  });

  it("a write that goes through is seen by every reader, with no reload", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A) },
      [`PATCH /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) },
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: business(BIZ_A, { sells: "services", advancedCrm: true }) },
    });
    const nav = renderHook(() => lib.useBusinessSettings());
    const profile = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(nav.result.current.status).toBe("ready"));
    await waitFor(() => expect(profile.result.current.status).toBe("ready"));

    await act(async () => void (await lib.saveBusinessSells(BIZ_A, "services")));
    expect(nav.result.current.sells).toBe("services");
    expect(profile.result.current.sells).toBe("services");

    await act(async () => void (await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true })));
    expect(nav.result.current).toMatchObject({ sells: "services", advancedCrm: true });
    expect(profile.result.current).toMatchObject({ sells: "services", advancedCrm: true });
  });

  it("a refused write changes nothing the hook shows", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products" }) },
      [`PATCH /identity/businesses/${BIZ_A}`]: { status: 403, body: forbidden("Only the business owner can edit the business profile") },
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 403, body: forbidden("Only the business owner, or an admin with settings admin access, can change the Advanced CRM switch and hub depth.") },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let sells: { error: string | null } = { error: null };
    let crm: { error: string | null } = { error: null };
    await act(async () => {
      sells = await lib.saveBusinessSells(BIZ_A, "services");
      crm = await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true });
    });
    expect(sells.error).toBe("Only the business owner can edit the business profile");
    expect(crm.error).toMatch(/owner, or an admin/);
    expect(result.current).toMatchObject({ status: "ready", sells: "products", advancedCrm: false });
  });

  it("a read that started before a write does not put the old value back", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    let releaseRead: (a: Answer) => void = () => {};
    let reads = 0;
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => {
        reads += 1;
        if (reads === 1) return { status: 200, body: business(BIZ_A) };
        return new Promise<Answer>((resolve) => (releaseRead = resolve));
      },
      [`PATCH /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products" }) },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // A reload asks again; its answer (read before the write) lands after the write's.
    let reloaded: Promise<unknown> = Promise.resolve();
    act(() => {
      reloaded = result.current.reload();
    });
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => void (await lib.saveBusinessSells(BIZ_A, "products")));
    expect(result.current.sells).toBe("products");
    await act(async () => {
      releaseRead({ status: 200, body: business(BIZ_A, { sells: "both" }) });
      await reloaded;
    });
    expect(result.current.sells).toBe("products");
  });

  it("what a profile write answered can be recorded for the readers (onboarding's one PATCH)", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A) } });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => lib.noteBusinessSettings(BIZ_A, business(BIZ_A, { sells: "products" })));
    expect(result.current.sells).toBe("products");
    // An answer for another business is recorded under that business, never this one.
    act(() => lib.noteBusinessSettings(BIZ_B, business(BIZ_B, { sells: "services" })));
    expect(result.current.sells).toBe("products");
  });
});
