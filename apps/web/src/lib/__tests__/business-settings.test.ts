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
import * as settings from "../business-settings";
import { apiGet } from "../api";
import { clearStoredBusinessId, setStoredBusinessId, setStoredToken } from "../workspace";
import type { BusinessAdvancedSettingsWrite, BusinessSells } from "../business-settings";

/**
 * The library, with its two doors also callable with what the types forbid: what a caller that got past the types
 * (a stale build, a cast) would hand them.
 */
const lib = {
  ...settings,
  saveBusinessSells: (businessId: string, sells: unknown) => settings.saveBusinessSells(businessId, sells as BusinessSells),
  saveAdvancedSettings: (businessId: string, write: unknown) => settings.saveAdvancedSettings(businessId, write as BusinessAdvancedSettingsWrite),
};

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
type Answer = { status: number; body: unknown; bare?: boolean };
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
        // HTTP/2 carries no reason phrase: `bare` answers as a browser sees one there.
        statusText: answer.bare ? "" : answer.status === 403 ? "Forbidden" : answer.status === 400 ? "Bad Request" : "OK",
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
  lib.resetBusinessSettings();
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

  it("settings already shown are kept through a reload that fails for no reason of access, and dropped on a refusal", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    let answer: Answer = { status: 200, body: business(BIZ_A, { sells: "products" }) };
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: () => answer });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    answer = { status: 502, body: { message: "Bad gateway" } };
    await act(async () => void (await result.current.reload()));
    expect(result.current).toMatchObject({ status: "ready", sells: "products" });

    answer = { status: 403, body: forbidden("No access to this business") };
    await act(async () => void (await result.current.reload()));
    expect(result.current).toMatchObject({ status: "failed", sells: "both", error: "No access to this business" });
  });

  it("selecting a business (sign-in, signup, a switch) drops everything read before and reads again", async () => {
    let answer: Answer = { status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true }) };
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: () => answer });
    const { result } = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const readsBefore = sent.length;

    // The next member of this browser is refused the business: nothing the last one read is shown.
    answer = { status: 403, body: forbidden("No access to this business") };
    act(() => {
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: BIZ_A } }));
    });
    expect(result.current).toMatchObject({ status: "loading", sells: "both", advancedCrm: false });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current).toMatchObject({ sells: "both", advancedCrm: false });
    expect(sent.length).toBeGreaterThan(readsBefore);
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

/** A session token as the browser stores one: only its subject matters here. */
const tokenFor = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;

describe("review SEC-1: what one member read is never shown to the next", () => {
  it("after a sign-out and another member's sign-in (the app's own helpers, no reload), the next reader starts from nothing", async () => {
    setStoredToken(tokenFor("user_bsw_one"));
    setStoredBusinessId(BIZ_A);
    let answer: Answer = { status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true }) };
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: () => answer });
    const first = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    expect(first.result.current).toMatchObject({ sells: "products", advancedCrm: true });
    first.unmount();

    // Sign-out, then member two signs in to the same business; the API is failing.
    clearStoredBusinessId();
    setStoredToken(tokenFor("user_bsw_two"));
    setStoredBusinessId(BIZ_A);
    // A failure that says nothing about access (not a 502/503/504: the api client retries those for seconds).
    answer = { status: 500, body: { statusCode: 500, message: "Internal server error" } };

    const seen: Array<{ status: string; sells: string; advancedCrm: boolean }> = [];
    const second = renderHook(() => {
      const state = lib.useBusinessSettings();
      seen.push({ status: state.status, sells: state.sells, advancedCrm: state.advancedCrm });
      return state;
    });
    await waitFor(() => expect(second.result.current.status).toBe("failed"));
    // Not on any render: member one's 'products' and Advanced CRM.
    expect(seen.filter((s) => s.sells !== "both" || s.advancedCrm || s.status === "ready")).toEqual([]);
  });

  it("the same holds for a reader given the business id, and for a member who changes while a hook stays mounted", async () => {
    setStoredToken(tokenFor("user_bsw_one"));
    let answer: Answer = { status: 200, body: business(BIZ_A, { sells: "services", advancedCrm: true }) };
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: () => answer });
    const { result, rerender } = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    setStoredToken(tokenFor("user_bsw_two"));
    answer = { status: 403, body: forbidden("No access to this business") };
    rerender();
    expect(result.current).toMatchObject({ sells: "both", advancedCrm: false });
    expect(result.current.status).not.toBe("ready");
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });

  it("a read answered after the member changed is not recorded for the new member", async () => {
    setStoredToken(tokenFor("user_bsw_one"));
    let release: (a: Answer) => void = () => {};
    let reads = 0;
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => {
        reads += 1;
        if (reads === 1) return new Promise<Answer>((resolve) => (release = resolve));
        return { status: 403, body: forbidden("No access to this business") };
      },
    });
    const first = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(reads).toBe(1));
    first.unmount();
    setStoredToken(tokenFor("user_bsw_two"));
    await act(async () => {
      release({ status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true }) });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
    expect(second.result.current).toMatchObject({ sells: "both", advancedCrm: false });
    await waitFor(() => expect(second.result.current.status).toBe("failed"));
    expect(second.result.current).toMatchObject({ sells: "both", advancedCrm: false });
  });

  it("the same member reading again keeps what they read", async () => {
    setStoredToken(tokenFor("user_bsw_one"));
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products" }) } });
    const first = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    // A refreshed token for the same member is the same member.
    setStoredToken(`h.${btoa(JSON.stringify({ sub: "user_bsw_one", exp: 2 }))}.s2`);
    const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
    expect(second.result.current).toMatchObject({ status: "ready", sells: "products" });
  });
});

describe("review SEC-2: a write whose answer is not this business's is not a success", () => {
  const doors: Array<[string, string, () => Promise<{ error: string | null }>]> = [
    ["what you sell", `PATCH /identity/businesses/${BIZ_A}`, () => lib.saveBusinessSells(BIZ_A, "products")],
    ["the Advanced CRM switch", `PATCH /identity/businesses/${BIZ_A}/advanced-settings`, () => lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true })],
  ];
  const strays: Array<[string, unknown]> = [
    ["another business's", business(BIZ_B, { sells: "products", advancedCrm: true })],
    ["no body", null],
    ["a list", [business(BIZ_A, { sells: "products", advancedCrm: true })]],
  ];
  for (const [door, route, send] of doors) {
    for (const [what, body] of strays) {
      it(`${door}: a 200 carrying ${what} is answered as an error, nothing of it is shown, and the business is read again`, async () => {
        window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
        const sent = stubRoutes({
          [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) },
          [route]: { status: 200, body },
        });
        const { result } = renderHook(() => lib.useBusinessSettings());
        await waitFor(() => expect(result.current.status).toBe("ready"));
        const readsBefore = sent.filter((s) => s.method === "GET").length;

        let res: { error: string | null } = { error: null };
        await act(async () => {
          res = await send();
        });
        expect(typeof res.error).toBe("string");
        expect((res.error ?? "").trim()).not.toBe("");
        await waitFor(() => expect(sent.filter((s) => s.method === "GET").length).toBeGreaterThan(readsBefore));
        await waitFor(() => expect(result.current.status).toBe("ready"));
        expect(result.current).toMatchObject({ sells: "services", advancedCrm: false });
      });
    }
  }

  it("noteBusinessSettings says whether the answer was this business's", () => {
    expect(lib.noteBusinessSettings(BIZ_A, business(BIZ_A, { sells: "products" }))).toBe(true);
    expect(lib.noteBusinessSettings(BIZ_A, business(BIZ_B, { sells: "products" }))).toBe(false);
    expect(lib.noteBusinessSettings(BIZ_A, null)).toBe(false);
  });
});

describe("review SEC-3: properties relied on, now pinned", () => {
  it("a read refused with no words at all (HTTP/2, empty message) is failed, with words of its own", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 403, body: { statusCode: 403, message: "" }, bare: true } });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect((result.current.error ?? "").trim()).not.toBe("");
    expect(result.current).toMatchObject({ sells: "both", advancedCrm: false });
  });

  it("a write refused with no words at all is still a refusal: nothing shown changes", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products" }) },
      [`PATCH /identity/businesses/${BIZ_A}`]: { status: 403, body: { statusCode: 403, message: "" }, bare: true },
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 403, body: { statusCode: 403, message: "" }, bare: true },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let sells: { error: string | null } = { error: null };
    let crm: { error: string | null } = { error: null };
    await act(async () => {
      sells = await lib.saveBusinessSells(BIZ_A, "services");
      crm = await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true });
    });
    expect(sells.error).not.toBeNull();
    expect(crm.error).not.toBeNull();
    expect(result.current).toMatchObject({ status: "ready", sells: "products", advancedCrm: false });
  });

  it("a depth carrying __proto__ or constructor: ignored in an answer, and never sent in a write", async () => {
    const hostile = JSON.parse('{"__proto__":"advanced","constructor":"advanced","money":"advanced"}');
    const read = lib.businessSettingsOf({ id: BIZ_A, depth: hostile });
    expect(read.depth).toEqual({ ...allHubs("standard"), money: "advanced" });
    expect(Object.keys(read.depth).sort()).toEqual([...SERVER_HUBS].sort());
    expect(({} as Record<string, unknown>).advanced).toBeUndefined();

    const sent = stubRoutes({});
    for (const depth of [JSON.parse('{"__proto__":"advanced"}'), JSON.parse('{"constructor":"advanced"}'), hostile]) {
      const res = await lib.saveAdvancedSettings(BIZ_A, { depth });
      expect(res.error).not.toBeNull();
    }
    expect(sent).toEqual([]);
  });
});

describe("review COR-3 / COR-4: one read for many readers, and a long-lived reader does not go stale", () => {
  const gets = (sent: Sent[]) => sent.filter((s) => s.method === "GET").length;

  it("readers mounted together share one read, and a reader mounted just after asks nothing more", async () => {
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products" }) } });
    const nav = renderHook(() => lib.useBusinessSettings(BIZ_A));
    const hub = renderHook(() => lib.useBusinessSettings(BIZ_A));
    const page = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(page.result.current.status).toBe("ready"));
    expect(nav.result.current.sells).toBe("products");
    expect(hub.result.current.sells).toBe("products");
    expect(gets(sent)).toBe(1);

    const later = renderHook(() => lib.useBusinessSettings(BIZ_A));
    expect(later.result.current).toMatchObject({ status: "ready", sells: "products" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gets(sent)).toBe(1);
  });

  it("reload() always asks again", async () => {
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A) } });
    const { result } = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => void (await result.current.reload()));
    expect(gets(sent)).toBe(2);
  });

  it("a reader that stays mounted reads again when the tab is looked at after a while (a change made elsewhere shows)", async () => {
    let answer: Answer = { status: 200, body: business(BIZ_A) };
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: () => answer });
    const { result } = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Looked at again at once: nothing is asked.
    act(() => void window.dispatchEvent(new Event("focus")));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gets(sent)).toBe(1);

    // An admin turned Advanced CRM on from another device; the owner comes back to this tab later.
    answer = { status: 200, body: business(BIZ_A, { advancedCrm: true }) };
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + lib.BUSINESS_SETTINGS_FRESH_MS + 1);
    try {
      act(() => void window.dispatchEvent(new Event("focus")));
      await waitFor(() => expect(result.current.advancedCrm).toBe(true));
      expect(gets(sent)).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("a mount after a while reads again; a business nobody reads is not asked for", async () => {
    const sent = stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A) } });
    const first = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + lib.BUSINESS_SETTINGS_FRESH_MS + 1);
    try {
      act(() => void window.dispatchEvent(new Event("focus")));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(gets(sent)).toBe(1);
      const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
      await waitFor(() => expect(gets(sent)).toBe(2));
      expect(second.result.current.status).toBe("ready");
    } finally {
      clock.mockRestore();
    }
  });
});

describe("review round 2 (SEC2-1, SEC2-2): a write is saved only when the server confirmed it, to the member who sent it", () => {
  const unconfirmed: Array<[string, string, () => Promise<{ error: string | null }>, unknown]> = [
    ["what you sell, answered without the settings", `PATCH /identity/businesses/${BIZ_A}`, () => lib.saveBusinessSells(BIZ_A, "products"), { id: BIZ_A, name: "x" }],
    ["what you sell, answered with another value", `PATCH /identity/businesses/${BIZ_A}`, () => lib.saveBusinessSells(BIZ_A, "products"), business(BIZ_A, { sells: "services" })],
    ["the switch, answered with it unchanged", `PATCH /identity/businesses/${BIZ_A}/advanced-settings`, () => lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true }), business(BIZ_A, { sells: "services", advancedCrm: false })],
    ["a hub depth, answered with it unchanged", `PATCH /identity/businesses/${BIZ_A}/advanced-settings`, () => lib.saveAdvancedSettings(BIZ_A, { depth: { money: "advanced" } }), business(BIZ_A, { sells: "services" })],
  ];
  it.each(unconfirmed)("%s: an error, and what is shown is what the server holds", async (_name, route, send, body) => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) },
      [route]: { status: 200, body },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let res: { error: string | null } = { error: null };
    await act(async () => {
      res = await send();
    });
    expect((res.error ?? "").trim()).not.toBe("");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ sells: "services", advancedCrm: false, depth: allHubs("standard") });
  });

  it("a confirmed write of every kind is still a success", async () => {
    stubRoutes({
      [`PATCH /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "products" }) },
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true, depth: { ...allHubs("standard"), money: "advanced" } }) },
    });
    expect((await lib.saveBusinessSells(BIZ_A, "products")).error).toBeNull();
    expect((await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true, depth: { money: "advanced" } })).error).toBeNull();
  });

  it("confirmedBusinessSettings reads what an answer confirms for this business, or nothing", () => {
    expect(lib.confirmedBusinessSettings(BIZ_A, business(BIZ_A, { sells: "products" }))).toMatchObject({ sells: "products", advancedCrm: false });
    expect(lib.confirmedBusinessSettings(BIZ_A, business(BIZ_B, { sells: "products" }))).toBeNull();
    expect(lib.confirmedBusinessSettings(BIZ_A, { id: BIZ_A, name: "x" })).toBeNull();
    expect(lib.confirmedBusinessSettings(BIZ_A, null)).toBeNull();
  });

  it.each([
    ["what you sell", `PATCH /identity/businesses/${BIZ_A}`, () => lib.saveBusinessSells(BIZ_A, "products")],
    ["the switch", `PATCH /identity/businesses/${BIZ_A}/advanced-settings`, () => lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true })],
  ] as Array<[string, string, () => Promise<unknown>]>)("%s: an answer that lands after the member changed is not recorded for the new member", async (_name, route, send) => {
    setStoredToken(tokenFor("user_bsw_one"));
    let release: (a: Answer) => void = () => {};
    let gets = 0;
    stubRoutes({
      [route]: () => new Promise<Answer>((resolve) => (release = resolve)),
      [`GET /identity/businesses/${BIZ_A}`]: () => {
        gets += 1;
        return { status: 403, body: forbidden("No access to this business") };
      },
    });
    const sending = send();
    await new Promise((resolve) => setTimeout(resolve, 10));
    setStoredToken(tokenFor("user_bsw_two"));
    release({ status: 200, body: business(BIZ_A, { sells: "products", advancedCrm: true }) });
    await sending;

    const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
    expect(second.result.current).toMatchObject({ sells: "both", advancedCrm: false });
    expect(second.result.current.status).not.toBe("ready");
    await waitFor(() => expect(second.result.current.status).toBe("failed"));
    expect(gets).toBeGreaterThan(0);
  });
});

describe("review round 3 (SEC3-1/COR3-1, SEC3-2, SEC3-3)", () => {
  it("the next member's own read is not lost when the last member's write answers while it is in flight", async () => {
    setStoredToken(tokenFor("user_bsw_one"));
    let releaseWrite: (a: Answer) => void = () => {};
    let releaseRead: (a: Answer) => void = () => {};
    stubRoutes({
      [`PATCH /identity/businesses/${BIZ_A}`]: () => new Promise<Answer>((resolve) => (releaseWrite = resolve)),
      [`GET /identity/businesses/${BIZ_A}`]: () => new Promise<Answer>((resolve) => (releaseRead = resolve)),
    });
    const sending = lib.saveBusinessSells(BIZ_A, "products");
    await new Promise((resolve) => setTimeout(resolve, 10));
    setStoredToken(tokenFor("user_bsw_two"));
    const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await new Promise((resolve) => setTimeout(resolve, 10));

    let res: { error: string | null } = { error: null };
    await act(async () => {
      releaseWrite({ status: 200, body: business(BIZ_A, { sells: "products" }) });
      res = await sending;
    });
    // SEC3-2: not said as a success on what is now another member's screen.
    expect((res.error ?? "").trim()).not.toBe("");
    await act(async () => {
      releaseRead({ status: 200, body: business(BIZ_A, { sells: "products" }) });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    // Member two's own read (or the one started for them) lands: not stuck on loading.
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.sells).toBe("products");
  });

  it("a hub depth write answered without any depth is not confirmed", async () => {
    stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: { id: BIZ_A, sells: "both", advancedCrm: false } } });
    const res = await lib.saveAdvancedSettings(BIZ_A, { depth: { money: "standard" } });
    expect((res.error ?? "").trim()).not.toBe("");
  });
});

describe("review round 4 (SEC4-1, SEC4-2/COR4-2, SEC4-3): a read after a write is a new request, and no reader is stranded", () => {
  const wire = (sent: Sent[]) => sent.filter((s) => s.method === "GET").length;

  it("the re-read forced by a write does not join a request sent before the write: the post-write answer wins", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    const releases: Array<(a: Answer) => void> = [];
    let reads = 0;
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => {
        reads += 1;
        if (reads === 1) return { status: 200, body: business(BIZ_A, { sells: "services" }) };
        return new Promise<Answer>((resolve) => releases.push(resolve));
      },
      // An answer for this business that carries no settings: what it holds must be read again.
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: { id: BIZ_A } },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let reloaded: Promise<unknown> = Promise.resolve();
    act(() => {
      reloaded = result.current.reload();
    });
    await waitFor(() => expect(wire(sent)).toBe(2));
    await act(async () => void (await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true })));
    // A new request, on the wire, after the write answered.
    await waitFor(() => expect(wire(sent)).toBe(3));
    await act(async () => {
      releases[1]({ status: 200, body: business(BIZ_A, { sells: "services", advancedCrm: true }) });
      releases[0]({ status: 200, body: business(BIZ_A, { sells: "services", advancedCrm: false }) });
      await reloaded;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current).toMatchObject({ status: "ready", advancedCrm: true });
  });

  it("a read never joins another caller's identical request already on the wire", async () => {
    let release: (a: Answer) => void = () => {};
    let reads = 0;
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => {
        reads += 1;
        if (reads === 1) return new Promise<Answer>((resolve) => (release = resolve));
        return { status: 200, body: business(BIZ_A, { sells: "products" }) };
      },
    });
    const elsewhere = apiGet(`/identity/businesses/${BIZ_A}`);
    await waitFor(() => expect(wire(sent)).toBe(1));
    const { result } = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(wire(sent)).toBe(2);
    expect(result.current.sells).toBe("products");
    release({ status: 200, body: business(BIZ_A) });
    await elsewhere;
  });

  it("a reader that mounts while an overtaken read is still out is not left on loading", async () => {
    const releases: Array<(a: Answer) => void> = [];
    stubRoutes({ [`GET /identity/businesses/${BIZ_A}`]: () => new Promise<Answer>((resolve) => releases.push(resolve)) });
    const first = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(releases).toHaveLength(1));
    first.unmount();
    // A write's answer for this business that carries no settings, while nobody reads it.
    act(() => void lib.noteBusinessSettings(BIZ_A, { id: BIZ_A }));
    const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => {
      releases[0]({ status: 200, body: business(BIZ_A, { sells: "services" }) });
      releases[1]({ status: 200, body: business(BIZ_A, { sells: "products" }) });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(second.result.current).toMatchObject({ status: "ready", sells: "products" });
  });

  it.each([
    ["no hub at all", {}],
    ["another hub only", { sales: "standard" }],
    ["a value that is not a depth", { money: "bogus" }],
  ])("a depth write is confirmed only by the answer holding that hub at that depth: %s", async (_name, depth) => {
    stubRoutes({ [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status: 200, body: { id: BIZ_A, sells: "both", advancedCrm: false, depth } } });
    const res = await lib.saveAdvancedSettings(BIZ_A, { depth: { money: "standard" } });
    expect((res.error ?? "").trim()).not.toBe("");
  });
});

describe("review round 5 (SEC5-1): a write whose answer never arrived may have been applied", () => {
  it.each([
    ["what you sell", `PATCH /identity/businesses/${BIZ_A}`, () => lib.saveBusinessSells(BIZ_A, "products")],
    ["the switch", `PATCH /identity/businesses/${BIZ_A}/advanced-settings`, () => lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true })],
  ] as Array<[string, string, () => Promise<{ error: string | null }>]>)("%s: it is answered as a failure, and the business is read again so what is shown is what it holds", async (_name, route, send) => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    let held = business(BIZ_A, { sells: "services" });
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => ({ status: 200, body: held }),
      [route]: () => {
        // The server applied it; the connection dropped before the answer.
        held = business(BIZ_A, { sells: "products", advancedCrm: true });
        throw new TypeError("Failed to fetch");
      },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const readsBefore = sent.filter((s) => s.method === "GET").length;

    let res: { error: string | null } = { error: null };
    await act(async () => {
      res = await send();
    });
    expect((res.error ?? "").trim()).not.toBe("");
    await waitFor(() => expect(sent.filter((s) => s.method === "GET").length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(result.current).toMatchObject({ status: "ready", sells: "products", advancedCrm: true }));
  });

  it("a refusal the server did answer (a 403) asks nothing more", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A) },
      [`PATCH /identity/businesses/${BIZ_A}`]: { status: 403, body: forbidden("Only the business owner can edit the business profile") },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const readsBefore = sent.filter((s) => s.method === "GET").length;
    await act(async () => void (await lib.saveBusinessSells(BIZ_A, "products")));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent.filter((s) => s.method === "GET").length).toBe(readsBefore);
  });
});

describe("review round 6 (SEC6-1/COR6-1, SEC6-2): an outcome nobody knows is never held as fresh", () => {
  const wire = (sent: Sent[]) => sent.filter((s) => s.method === "GET").length;

  it("lost answer, and the re-read fails too: what was shown stays, but the next look reads again", async () => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    let held = business(BIZ_A, { sells: "services" });
    let down = false;
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => {
        if (down) throw new TypeError("Failed to fetch");
        return { status: 200, body: held };
      },
      [`PATCH /identity/businesses/${BIZ_A}`]: () => {
        held = business(BIZ_A, { sells: "products" });
        down = true;
        throw new TypeError("Failed to fetch");
      },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let res: { error: string | null } = { error: null };
    await act(async () => {
      res = await lib.saveBusinessSells(BIZ_A, "products");
    });
    expect((res.error ?? "").trim()).not.toBe("");
    // The forced re-read runs out its retries against the dead connection: wait until the wire has been quiet.
    await act(async () => {
      for (let quietSince = Date.now(), seen = wire(sent); Date.now() - quietSince < 2_500; ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (wire(sent) !== seen) {
          seen = wire(sent);
          quietSince = Date.now();
        }
      }
    });
    expect(wire(sent)).toBeGreaterThan(1);
    expect(result.current).toMatchObject({ status: "ready", sells: "services" });

    // The connection is back, well inside the freshness window of the first read: the tab is looked at.
    down = false;
    const readsBefore = wire(sent);
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(wire(sent)).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(result.current.sells).toBe("products"));
  }, 20_000);

  it.each([500, 502, 504])("a %i after the write was applied is an unknown outcome too: the business is read again", async (status) => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    let held = business(BIZ_A);
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => ({ status: 200, body: held }),
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: () => {
        held = business(BIZ_A, { advancedCrm: true });
        return { status, body: { statusCode: status, message: "Internal server error" } };
      },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const readsBefore = wire(sent);
    let res: { error: string | null } = { error: null };
    await act(async () => {
      res = await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true });
    });
    expect((res.error ?? "").trim()).not.toBe("");
    await waitFor(() => expect(wire(sent)).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(result.current.advancedCrm).toBe(true));
  });

  it.each([400, 401, 403, 404, 409])("a %i is the server's answer: nothing is asked again", async (status) => {
    window.localStorage.setItem(BUSINESS_ID_KEY, BIZ_A);
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A) },
      [`PATCH /identity/businesses/${BIZ_A}/advanced-settings`]: { status, body: { statusCode: status, message: "Refused" } },
    });
    const { result } = renderHook(() => lib.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const readsBefore = wire(sent);
    await act(async () => void (await lib.saveAdvancedSettings(BIZ_A, { advancedCrm: true })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(wire(sent)).toBe(readsBefore);
    expect(result.current).toMatchObject({ status: "ready", advancedCrm: false });
  });

  it("with nobody reading the business, an unknown outcome drops what was held: the next reader starts from a read", async () => {
    let held = business(BIZ_A, { sells: "services" });
    const sent = stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: () => ({ status: 200, body: held }),
      [`PATCH /identity/businesses/${BIZ_A}`]: () => {
        held = business(BIZ_A, { sells: "products" });
        throw new TypeError("Failed to fetch");
      },
    });
    const first = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    await lib.saveBusinessSells(BIZ_A, "products");
    const readsBefore = wire(sent);
    const second = renderHook(() => lib.useBusinessSettings(BIZ_A));
    expect(second.result.current.status).toBe("loading");
    await waitFor(() => expect(second.result.current).toMatchObject({ status: "ready", sells: "products" }));
    expect(wire(sent)).toBeGreaterThan(readsBefore);
  });
});


describe("FU-SETTINGS-MANUAL-STEP-FENCE: a write a caller sends itself joins the newest-write fence", () => {
  it("an answer numbered older than one already recorded records nothing; a newer one is recorded and fences older store writes", async () => {
    let releaseOlder: (() => void) | null = null;
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) },
      [`PATCH /identity/businesses/${BIZ_A}`]: () =>
        new Promise<Answer>((resolve) => {
          releaseOlder = () => resolve({ status: 200, body: business(BIZ_A, { sells: "products" }) });
        }),
    });
    const reader = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    // A store write (number 1) is sent and waits; a caller's own write (number 2) is sent after it and answers first.
    const older = lib.saveBusinessSells(BIZ_A, "products");
    await waitFor(() => expect(releaseOlder).not.toBeNull());
    const mine = lib.beginBusinessWrite(BIZ_A);
    act(() => {
      expect(lib.noteBusinessSettings(BIZ_A, business(BIZ_A, { sells: "services" }), lib.actingMemberNow(), mine)).toBe(true);
    });
    await waitFor(() => expect(reader.result.current.sells).toBe("services"));
    // The older store write's answer lands last: fenced, so nothing older replaces the newer save.
    releaseOlder!();
    await older;
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    expect(reader.result.current.sells).toBe("services");
    // And a caller's answer numbered older than the newest recorded records nothing either.
    const stale = mine - 1;
    act(() => {
      lib.noteBusinessSettings(BIZ_A, business(BIZ_A, { sells: "both" }), lib.actingMemberNow(), stale);
    });
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    expect(reader.result.current.sells).toBe("services");
  });
});

describe("FU-SETTINGS-MANUAL-STEP-FENCE review round 1: a numbered answer fences as the store's own writes do", () => {
  it("RED-AT-df0b5d0c (MINOR-2): a numbered 2xx answer that cannot be read still raises the mark, so an older write's late answer is not recorded", async () => {
    let releaseOlder: (() => void) | null = null;
    stubRoutes({
      [`GET /identity/businesses/${BIZ_A}`]: { status: 200, body: business(BIZ_A, { sells: "services" }) },
      [`PATCH /identity/businesses/${BIZ_A}`]: () =>
        new Promise<Answer>((resolve) => {
          releaseOlder = () => resolve({ status: 200, body: business(BIZ_A, { sells: "products" }) });
        }),
    });
    const reader = renderHook(() => lib.useBusinessSettings(BIZ_A));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    const older = lib.saveBusinessSells(BIZ_A, "products");
    await waitFor(() => expect(releaseOlder).not.toBeNull());
    const mine = lib.beginBusinessWrite(BIZ_A);
    // The caller's own write answered a 2xx with a body that cannot be read (as `recorded` meets one).
    act(() => {
      expect(lib.noteBusinessSettings(BIZ_A, null, lib.actingMemberNow(), mine)).toBe(false);
    });
    releaseOlder!();
    await older;
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    // The older answer is fenced: the store shows what the server holds (the read), not the older snapshot.
    expect(reader.result.current.sells).toBe("services");
  });
});

