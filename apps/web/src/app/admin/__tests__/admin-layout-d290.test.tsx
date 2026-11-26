/**
 * RR-ADMIN-SHELL-SERVER-GATE repair round 2, owner ruling D-290 (#80 7178888690): the Owner Console (/admin) is
 * reached ONLY through the separate admin sign-in (the ADMIN_EMAIL account). A Supabase-session SUPER_ADMIN does not
 * get in through the app session.
 *
 * At c764cb0f the layout's guard still falls back to the app session: when kf_auth_mode is not "admin" it calls
 * refreshWorkspace() and then admits anyone isSuperAdmin() says yes to, and isSuperAdmin() reads the APP user's cache
 * first. The edge gate only looks at the kf_admin_token COOKIE, so a browser whose cookie survives while its
 * localStorage admin session is gone (cleared, expired, or another account's) is admitted on the app session alone.
 *
 *   ALD-01 an app-session SUPER_ADMIN with no admin session is refused (RED at c764cb0f: admitted).
 *   ALD-02 an expired admin token, with the admin user cache still SUPER_ADMIN, is refused (RED at c764cb0f).
 *   ALD-03 an unexpired admin token whose admin user is not SUPER_ADMIN is refused even when the app user is
 *          SUPER_ADMIN (RED at c764cb0f: isSuperAdmin() answers from the app user).
 *   ALD-04 control: the separate admin sign-in (unexpired admin token, admin user SUPER_ADMIN, no app session) is
 *          admitted.
 *   ALD-05 the guard does not consult the app session at all: no refreshWorkspace network read (RED at c764cb0f).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/admin/users",
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const adminToken = (exp: number) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "adm", type: "admin", role: "SUPER_ADMIN", exp })}.sig`;
const HOUR = 3_600_000;
const SUPER = { id: "u-app", email: "owner@ald.test", name: "App Owner", role: "SUPER_ADMIN" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  toastError.mockReset();
  nav.router.replace.mockReset();
  // The app session's identity read answers SUPER_ADMIN, as it would for a Supabase-session platform admin.
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: SUPER, businesses: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function appSession() {
  window.localStorage.setItem("kf_token", "supabase-access-token");
  window.localStorage.setItem("kf_user_cache", JSON.stringify(SUPER));
}

function adminSession(exp: number, role = "SUPER_ADMIN") {
  window.localStorage.setItem("kf_admin_token", adminToken(exp));
  window.localStorage.setItem("kf_admin_user_cache", JSON.stringify({ id: "adm", email: "admin@ald.test", role }));
  window.localStorage.setItem("kf_auth_mode", "admin");
}

async function mount() {
  const { default: AdminLayout } = await import("@/app/admin/layout");
  return render(<AdminLayout><div>admin users page</div></AdminLayout>);
}

async function expectRefused() {
  await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/admin/login"));
  expect(toastError).toHaveBeenCalled();
  expect(screen.queryByText("admin users page")).toBeNull();
}

describe("D-290: the admin shell opens only on the separate admin sign-in", () => {
  it("ALD-01 an app-session SUPER_ADMIN with no admin session is refused", async () => {
    appSession();
    await mount();
    await expectRefused();
  });

  it("ALD-02 an expired admin token is refused even with a SUPER_ADMIN admin user cache", async () => {
    adminSession(Date.now() - 60_000);
    await mount();
    await expectRefused();
  });

  it("ALD-03 the admin session's own user decides, not the app user", async () => {
    appSession();
    adminSession(Date.now() + HOUR, "USER");
    await mount();
    await expectRefused();
  });

  it("ALD-04 control: the separate admin sign-in is admitted", async () => {
    adminSession(Date.now() + HOUR);
    await mount();
    expect(await screen.findByText("admin users page")).toBeTruthy();
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ALD-05 the guard never reads the app session from the network", async () => {
    appSession();
    await mount();
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
