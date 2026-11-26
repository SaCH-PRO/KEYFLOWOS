/**
 * RR-ADMIN-LOGOUT (D-261): a sign-in as a normal user clears any admin session
 * first, and the admin area has a sign-out control.
 *
 * On main the password sign-in stored the user's tokens beside a surviving
 * kf_admin_token, so getAuthHeaders kept sending the SUPER_ADMIN bearer for the
 * new user; and the admin layout had no sign-out at all. The rule: every user
 * sign-in (password form, signup, OAuth callback) calls clearAdminSession()
 * before it stores the user's token; the admin layout's "Sign out" control
 * calls adminSignOut() (POST /api/admin/auth/logout, then the clearing) and
 * routes to /admin/login.
 *
 *   LCA-01  RED-BEFORE  a password sign-in with kf_admin_token present leaves no admin key in localStorage
 *                       or the cookies, and the user token is stored
 *   LCA-02  RED-BEFORE  the admin layout renders a "Sign out" control; clicking it posts to
 *                       /api/admin/auth/logout once, clears the admin session and routes to /admin/login
 *   LCA-03  control     a refused sign-in (invalid credentials) does not touch the admin session either way
 *                       (nothing is stored, the admin keys stay until a successful sign-in or a sign-out)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import LoginForm from "../login-form";
import AdminLayout from "@/app/admin/layout";

const ADMIN_KEYS = ["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"] as const;
const adminKeysLeft = () => ADMIN_KEYS.filter((k) => window.localStorage.getItem(k) !== null || document.cookie.includes(`${k}=`));

// RR-ADMIN-SHELL-SERVER-GATE (D-290): the admin layout and the edge gate open the shell only on an unexpired
// admin-shaped kf_admin_token (header.payload.sig, payload.type "admin", exp in ms, as buildAdminToken issues it), so
// the seeded admin session carries one. Every assertion below is unchanged.
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ADMIN_BEARER = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "v1rr_admin", type: "admin", role: "SUPER_ADMIN", exp: Date.now() + 3_600_000 })}.v1rr_admin_sig`;

function seedAdminSession() {
  window.localStorage.setItem("kf_admin_token", ADMIN_BEARER);
  window.localStorage.setItem("kf_admin_user_cache", JSON.stringify({ id: "v1rr_admin", email: "v1rr_admin@test.local", role: "SUPER_ADMIN" }));
  window.localStorage.setItem("kf_auth_mode", "admin");
  document.cookie = `kf_admin_token=${ADMIN_BEARER}; path=/; max-age=86400`;
  document.cookie = "kf_admin_user_cache=x; path=/; max-age=86400";
  document.cookie = "kf_auth_mode=admin; path=/; max-age=86400";
}

type Call = { method: string; path: string; authorization: string | null };
let calls: Call[] = [];
function serve(loginStatus: number, loginBody: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname, authorization: headers.get("authorization") });
    if (url.pathname === "/identity/login") {
      return new Response(JSON.stringify(loginBody), { status: loginStatus, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/admin/auth/logout") {
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    // bootstrap and everything after the token is stored: not under test here
    return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

function signIn() {
  render(<LoginForm />);
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "v1rr_member@test.local" } });
  fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "v1rr-some-passphrase-not-real" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in/i }));
}

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  for (const k of [...ADMIN_KEYS, "kf_token", "kf_refresh_token"]) document.cookie = `${k}=; path=/; max-age=0`;
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RR-ADMIN-LOGOUT: a user sign-in clears the admin session; the admin area can sign out", () => {
  it("LCA-01 RED-BEFORE: a password sign-in with an admin session present leaves no admin key behind and stores the user token", async () => {
    seedAdminSession();
    serve(200, { accessToken: "v1rr_user_token", refreshToken: "v1rr_refresh" });
    expect(adminKeysLeft()).toEqual([...ADMIN_KEYS]);

    signIn();

    await waitFor(() => expect(window.localStorage.getItem("kf_token")).toBe("v1rr_user_token"));
    expect(adminKeysLeft()).toEqual([]);
    expect(calls.some((c) => c.path === "/api/admin/auth/logout")).toBe(false);
  });

  it("LCA-02 RED-BEFORE: the admin layout's Sign out control posts to /api/admin/auth/logout once, clears the admin session and routes to /admin/login", async () => {
    seedAdminSession();
    serve(200, {});

    render(<AdminLayout><div>v1rr-admin-child</div></AdminLayout>);
    expect(await screen.findByText("v1rr-admin-child")).toBeInTheDocument();
    // review round 1: the layout admitted the admin without routing away
    expect(nav.router.replace).not.toHaveBeenCalled();
    const signOut = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(signOut);
    fireEvent.click(signOut); // a double click posts once

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/admin/login"));
    const logouts = calls.filter((c) => c.path === "/api/admin/auth/logout");
    expect(logouts).toHaveLength(1);
    expect(logouts[0]).toMatchObject({ method: "POST", authorization: `Bearer ${ADMIN_BEARER}` });
    expect(adminKeysLeft()).toEqual([]);
  });

  it("LCA-03 control: a refused sign-in stores nothing and leaves the admin session as it was", async () => {
    seedAdminSession();
    serve(400, { statusCode: 400, code: "invalid_credentials", message: "Invalid email or password." });
    signIn();
    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("kf_token")).toBeNull();
    expect(adminKeysLeft()).toEqual([...ADMIN_KEYS]);
  });
});
