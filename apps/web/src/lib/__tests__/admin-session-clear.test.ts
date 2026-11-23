/**
 * RR-ADMIN-LOGOUT (D-261): no sign-out leaves the platform admin bearer behind.
 *
 * Premise at main 9a7b5011: the admin login stores the admin bearer in
 * localStorage kf_admin_token (mirrored into a non-HttpOnly 24h cookie, with
 * kf_admin_user_cache and kf_auth_mode); getAuthHeaders sends kf_admin_token in
 * preference to the user's kf_token on EVERY API call; nothing in apps/web ever
 * removed those keys (the user sign-out, clearStoredBusinessId, removed kf_token,
 * kf_refresh_token and kf_auth_mode only) and the admin area had no sign-out
 * control, although the server has POST api/admin/auth/logout. On a shared
 * browser the next person to sign in sent the SUPER_ADMIN bearer on every
 * request until it expired, and their actions were attributed to the admin.
 *
 * THE RULE: one helper, clearAdminSession(), holds the key list and removes the
 * three admin keys from localStorage and expires their cookies; every user
 * sign-out (clearStoredBusinessId) calls it; the admin sign-out (adminSignOut)
 * posts to /api/admin/auth/logout once with the admin bearer and clears even
 * when the call fails; a token refresh leaves an admin session in place.
 *
 *   ASC-01  RED-BEFORE  clearStoredBusinessId() removes kf_admin_token, kf_admin_user_cache and kf_auth_mode
 *                       from localStorage and the cookies, and the next API call carries no admin bearer
 *   ASC-02  RED-BEFORE  adminSignOut() posts to /api/admin/auth/logout once with the admin bearer and clears
 *                       the three keys; it still clears when the server answers 500 or the request throws
 *   ASC-03  control     clearStoredBusinessId() leaves unrelated keys (theme) intact
 *   ASC-04  control     a token refresh (refreshAccessToken) leaves an admin session in place
 *
 * The workspace module is read through a namespace import so this file loads on
 * main and names what is missing instead of failing to link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as ws from "@/lib/workspace";
import { apiGet } from "@/lib/api";

const ADMIN_KEYS = ["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"] as const;
const clearAdminSession = (ws as unknown as { clearAdminSession?: () => void }).clearAdminSession;
const adminSignOut = (ws as unknown as { adminSignOut?: () => Promise<void> }).adminSignOut;

function seedAdminSession() {
  window.localStorage.setItem("kf_admin_token", "v1rr_admin_bearer");
  window.localStorage.setItem("kf_admin_user_cache", JSON.stringify({ id: "v1rr_admin", role: "SUPER_ADMIN" }));
  window.localStorage.setItem("kf_auth_mode", "admin");
  document.cookie = "kf_admin_token=v1rr_admin_bearer; path=/; max-age=86400";
  document.cookie = `kf_admin_user_cache=${encodeURIComponent(JSON.stringify({ id: "v1rr_admin" }))}; path=/; max-age=86400`;
  document.cookie = "kf_auth_mode=admin; path=/; max-age=86400";
}

const adminKeysLeft = () => ADMIN_KEYS.filter((k) => window.localStorage.getItem(k) !== null || document.cookie.includes(`${k}=`));

type Call = { url: string; method: string; authorization: string | null };
let calls: Call[] = [];
function serve(logoutStatus: number | "throw") {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), authorization: headers.get("authorization") });
    if (url.endsWith("/api/admin/auth/logout")) {
      if (logoutStatus === "throw") throw new TypeError("network down");
      return new Response(JSON.stringify({ ok: logoutStatus < 400 }), { status: logoutStatus, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/identity/refresh")) {
      return new Response(JSON.stringify({ accessToken: "v1rr_refreshed_user_token" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  for (const k of [...ADMIN_KEYS, "kf_token", "kf_business_id"]) document.cookie = `${k}=; path=/; max-age=0`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RR-ADMIN-LOGOUT: no sign-out leaves the admin bearer behind", () => {
  it("ASC-01 RED-BEFORE: the user sign-out clears the admin session, and the next API call carries no admin bearer", async () => {
    seedAdminSession();
    window.localStorage.setItem("kf_token", "v1rr_user_token");
    serve(200);
    expect(adminKeysLeft()).toEqual([...ADMIN_KEYS]);

    ws.clearStoredBusinessId();

    expect(adminKeysLeft()).toEqual([]);
    expect(window.localStorage.getItem("kf_token")).toBeNull();
    await apiGet("/v1rr/probe");
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBeNull();
    // review round 1: the user bearer is what the next sign-in sends, not a surviving admin bearer
    window.localStorage.setItem("kf_token", "v1rr_user_token_2");
    await apiGet("/v1rr/probe-2");
    expect(calls[1].authorization).toBe("Bearer v1rr_user_token_2");
  });

  it("ASC-05 (review round 1): adminSignOut clears the local session before the server answers, so a stalled network never keeps the bearer on the device", async () => {
    expect(typeof adminSignOut, "adminSignOut is exported from @/lib/workspace").toBe("function");
    seedAdminSession();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), method: (init?.method ?? "GET").toUpperCase(), authorization: headers.get("authorization") });
      await gate; // the server never answers until the test lets it
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    const signingOut = adminSignOut!();
    await Promise.resolve();
    await Promise.resolve();
    expect(adminKeysLeft()).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", authorization: "Bearer v1rr_admin_bearer" });
    release();
    await expect(signingOut).resolves.toBeUndefined();
  });

  it("ASC-02 RED-BEFORE: adminSignOut posts to /api/admin/auth/logout once with the admin bearer and clears the three keys; a 500 and a thrown request still clear", async () => {
    expect(typeof adminSignOut, "adminSignOut is exported from @/lib/workspace").toBe("function");
    expect(typeof clearAdminSession, "clearAdminSession is exported from @/lib/workspace").toBe("function");

    seedAdminSession();
    serve(200);
    await adminSignOut!();
    expect(calls.filter((c) => c.url.endsWith("/api/admin/auth/logout"))).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", authorization: "Bearer v1rr_admin_bearer" });
    expect(adminKeysLeft()).toEqual([]);

    for (const outcome of [500, "throw"] as const) {
      vi.restoreAllMocks();
      calls = [];
      seedAdminSession();
      serve(outcome);
      await expect(adminSignOut!()).resolves.toBeUndefined();
      expect(calls.filter((c) => c.url.endsWith("/api/admin/auth/logout")), String(outcome)).toHaveLength(1);
      expect(adminKeysLeft(), String(outcome)).toEqual([]);
    }
  });

  it("ASC-03 control: clearStoredBusinessId leaves unrelated keys intact", () => {
    seedAdminSession();
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("kf_referral_code", "V1RR");
    ws.clearStoredBusinessId();
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(window.localStorage.getItem("kf_referral_code")).toBe("V1RR");
    expect(adminKeysLeft()).toEqual([]);
  });

  it("ASC-04 control: a token refresh leaves an admin session in place", async () => {
    seedAdminSession();
    window.localStorage.setItem("kf_token", "v1rr_user_token");
    window.localStorage.setItem("kf_refresh_token", "v1rr_refresh");
    serve(200);
    expect(await ws.refreshAccessToken()).toBe(true);
    expect(window.localStorage.getItem("kf_token")).toBe("v1rr_refreshed_user_token");
    expect(adminKeysLeft()).toEqual([...ADMIN_KEYS]);
  });
});
