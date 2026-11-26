/**
 * RR-ADMIN-SHELL-SERVER-GATE repair round 3, COR-1 / MINOR-1 (correctness review #80 7182060236; owner ruling
 * D-290): the Owner Console decides on the admin session's OWN identity. At 458243a canOpenOwnerConsole falls back
 * to the app user's cached role when kf_admin_user_cache is missing, so an admin-shaped token plus a SUPER_ADMIN app
 * session opens the shell and shows the link without the admin sign-in's own user.
 *
 *   AOI-01 admin-shaped token, no admin user cache, app user SUPER_ADMIN: the layout refuses (RED at 458243a).
 *   AOI-02 the same browser: the Owner Console link is hidden (RED at 458243a).
 *   AOI-03 control: the same token WITH the admin sign-in's SUPER_ADMIN user cache opens the shell and shows the link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, waitFor } from "@testing-library/react";

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
vi.mock("@/lib/client", () => ({ bootstrapIdentity: async () => ({ data: null, error: "unused" }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({}) }));
vi.mock("@/lib/theme-context", () => ({ useThemeColors: () => ({ setAccent1: () => {}, setAccent2: () => {} }) }));
vi.mock("@/hooks/use-plan", () => ({ usePlanLimitHandler: () => ({ planLimitHit: null, clearPlanLimit: () => {} }) }));
vi.mock("@/lib/api", () => ({
  apiGet: async () => ({ data: null, error: null }),
  apiPatch: async () => ({ data: null, error: null }),
  apiPost: async () => ({ data: null, error: null }),
}));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const adminToken = () =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "adm", type: "admin", role: "SUPER_ADMIN", exp: Date.now() + 3_600_000 })}.sig`;

function appSuperAdminWithAdminToken() {
  window.localStorage.setItem("kf_token", "supabase-access-token");
  window.localStorage.setItem("kf_business_id", "biz-aoi");
  window.localStorage.setItem("kf_user_cache", JSON.stringify({ id: "u-app", email: "owner@aoi.test", name: "Aoi Owner", role: "SUPER_ADMIN" }));
  window.localStorage.setItem("kf_admin_token", adminToken());
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  toastError.mockReset();
  nav.router.replace.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function layoutAdmits(): Promise<boolean> {
  const { default: AdminLayout } = await import("@/app/admin/layout");
  render(<AdminLayout><div>admin users page</div></AdminLayout>);
  await waitFor(() => expect(screen.queryByText("admin users page") !== null || nav.router.replace.mock.calls.length > 0).toBe(true));
  return screen.queryByText("admin users page") !== null;
}

async function linkShown(): Promise<boolean> {
  const { useAppLayout } = await import("@/hooks/use-app-layout");
  const { result, unmount } = renderHook(() => useAppLayout());
  await waitFor(() => expect((result.current as unknown as { displayName: string }).displayName).not.toBe(""));
  const shown = (result.current as unknown as { isAdminUser: boolean }).isAdminUser;
  unmount();
  return shown;
}

describe("COR-1: the admin session's own user decides", () => {
  it("AOI-01 a token without the admin user cache does not open the shell on the app user's role", async () => {
    appSuperAdminWithAdminToken();
    expect(await layoutAdmits()).toBe(false);
    expect(nav.router.replace).toHaveBeenCalledWith("/admin/login");
  });

  it("AOI-02 nor does it show the Owner Console link", async () => {
    appSuperAdminWithAdminToken();
    expect(await linkShown()).toBe(false);
  });

  it("AOI-03 control: with the admin sign-in's SUPER_ADMIN user cache, both open", async () => {
    appSuperAdminWithAdminToken();
    window.localStorage.setItem("kf_admin_user_cache", JSON.stringify({ id: "adm", email: "admin@aoi.test", role: "SUPER_ADMIN" }));
    window.localStorage.setItem("kf_auth_mode", "admin");
    expect(await linkShown()).toBe(true);
    expect(await layoutAdmits()).toBe(true);
  });
});
