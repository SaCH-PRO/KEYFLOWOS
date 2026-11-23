import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * FU-NAV-A1-CODEX-224 review round 1 (correctness nit 1, nit 3): with sells unknown until the settings are ready,
 * the shell must notice a business stored without an announcement (refreshWorkspace's membership resolution writes
 * the stored id silently) and read its settings, or it would stay on the reduced nav until a remount. And a read
 * that fails with a 5xx, with nothing held, shows no sells-dependent hub, as a refusal does.
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

const BIZ = "biz-products-silent";
const USER = { id: "user-1", email: "owner@example.test", name: "Owner One" };

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "access-token-1");
  apiGet.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/identity/businesses")) return jsonResponse(200, [{ id: BIZ, name: "Products Co" }]);
    if (String(url).endsWith("/identity/me")) return jsonResponse(200, USER);
    return jsonResponse(404, {});
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("app shell: the business's settings follow a silently stored business", () => {
  it("no business stored at mount: once refreshWorkspace stores one, its settings are read and its bar shown", async () => {
    apiGet.mockImplementation(async (path: string) =>
      path === `/identity/businesses/${BIZ}`
        ? { data: { id: BIZ, sells: "products", advancedCrm: false }, error: null }
        : { data: null, error: null },
    );
    const { useAppLayout } = await import("@/hooks/use-app-layout");
    const { result, unmount } = renderHook(() => useAppLayout());

    await waitFor(() => expect(window.localStorage.getItem("kf_business_id")).toBe(BIZ));
    await waitFor(() => expect(result.current.bottomBarHubs.map((h) => h.id)).toEqual(["sales", "customers"]));
    expect(result.current.visibleHubs.map((h) => h.id)).not.toContain("schedule");
    unmount();
  });

  it("a first read that fails with a 5xx shows no sells-dependent hub", async () => {
    window.localStorage.setItem("kf_business_id", BIZ);
    apiGet.mockImplementation(async (path: string) =>
      path === `/identity/businesses/${BIZ}`
        ? { data: null, error: "Bad gateway", status: 502 }
        : { data: null, error: null },
    );
    const { useAppLayout } = await import("@/hooks/use-app-layout");
    const { result, unmount } = renderHook(() => useAppLayout());
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/identity/businesses/${BIZ}`, expect.anything()));
    await new Promise((r) => setTimeout(r, 20));

    expect(result.current.visibleHubs.map((h) => h.id)).not.toContain("schedule");
    expect(result.current.bottomBarHubs).toEqual([]);
    unmount();
  });
});
