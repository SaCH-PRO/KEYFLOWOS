import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * RR-ADMIN-SHELL-SERVER-GATE repair round 1, owner ruling D-290: the Owner Console is reached only through the
 * separate admin sign-in (/admin/login, the ADMIN_EMAIL account). The edge gate now sends a browser with no admin
 * session to /admin/login, so the "Owner Console" link (desktop-sidebar, app-header, mobile-drawer, all driven by
 * useAppLayout's isAdminUser) must not be offered to a normally signed-in SUPER_ADMIN who holds no admin session:
 * that is a dead end.
 *
 *   OCL-01 a SUPER_ADMIN user with no admin session: isAdminUser is false (RED at 1c4ff81d: true).
 *   OCL-02 a SUPER_ADMIN user with an unexpired admin token in storage: true.
 *   OCL-03 a SUPER_ADMIN user with an expired admin token: false (RED at 1c4ff81d: true).
 *   OCL-04 a SUPER_ADMIN user with a token that is not admin-shaped: false (RED at 1c4ff81d: true).
 *   OCL-05 a plain USER holding an unexpired admin token: false (the admin layout would refuse them; no dead end).
 */

const { apiGet, nav } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  nav: { pathname: "/app", router: { push: () => {}, replace: () => {} } },
}));

vi.mock("@/lib/client", () => ({ bootstrapIdentity: async () => ({ data: null, error: "unused" }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({}) }));
vi.mock("@/lib/theme-context", () => ({
  useThemeColors: () => ({ setAccent1: () => {}, setAccent2: () => {} }),
}));
vi.mock("@/hooks/use-plan", () => ({
  usePlanLimitHandler: () => ({ planLimitHit: null, clearPlanLimit: () => {} }),
}));
vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPatch: async () => ({ data: null, error: null }),
  apiPost: async () => ({ data: null, error: null }),
}));

const BIZ = "biz-ocl";
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const adminToken = (exp: number, type = "admin") =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "a", type, role: "SUPER_ADMIN", exp })}.sig`;
const HOUR = 3_600_000;

async function isAdminUserAfterLoad(): Promise<boolean> {
  const { useAppLayout } = await import("@/hooks/use-app-layout");
  const { result, unmount } = renderHook(() => useAppLayout());
  // applyCachedUser sets the display name in the same pass; wait for it so the answer is the settled one.
  await waitFor(() => expect((result.current as unknown as { displayName: string }).displayName).not.toBe(""));
  const answer = (result.current as unknown as { isAdminUser: boolean }).isAdminUser;
  unmount();
  return answer;
}

function signIn(role: "SUPER_ADMIN" | "USER") {
  window.localStorage.setItem("kf_token", "access-token-1");
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_user_cache", JSON.stringify({ id: "u1", email: "owner@ocl.test", name: "Ocl Owner", role }));
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: null, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-290: the Owner Console link needs a local admin session", () => {
  it("OCL-01 a SUPER_ADMIN with no admin session is not offered the link", async () => {
    signIn("SUPER_ADMIN");
    expect(await isAdminUserAfterLoad()).toBe(false);
  });

  it("OCL-02 a SUPER_ADMIN with an unexpired admin token is offered the link", async () => {
    signIn("SUPER_ADMIN");
    window.localStorage.setItem("kf_admin_token", adminToken(Date.now() + HOUR));
    // Repair round 3 (COR-1): the admin session as the admin sign-in writes it, token AND its own user.
    window.localStorage.setItem("kf_admin_user_cache", JSON.stringify({ id: "a", email: "admin@ocl.test", role: "SUPER_ADMIN" }));
    expect(await isAdminUserAfterLoad()).toBe(true);
  });

  it("OCL-03 an expired admin token does not count", async () => {
    signIn("SUPER_ADMIN");
    window.localStorage.setItem("kf_admin_token", adminToken(Date.now() - 60_000));
    expect(await isAdminUserAfterLoad()).toBe(false);
  });

  it("OCL-04 a token that is not admin-shaped does not count", async () => {
    signIn("SUPER_ADMIN");
    window.localStorage.setItem("kf_admin_token", adminToken(Date.now() + HOUR, "user"));
    expect(await isAdminUserAfterLoad()).toBe(false);
  });

  it("OCL-05 a plain USER holding an admin token is not offered the link", async () => {
    signIn("USER");
    window.localStorage.setItem("kf_admin_token", adminToken(Date.now() + HOUR));
    expect(await isAdminUserAfterLoad()).toBe(false);
  });
});
