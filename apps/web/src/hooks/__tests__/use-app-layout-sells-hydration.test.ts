import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * FU-NAV-A1-CODEX-224 review round 2 (nit 1): the original finding's idle render is the hydration render, where the
 * stored business is not yet read (the server snapshot is null) and the settings hold the defaults (sells "both").
 * A products-only business must not see Schedule on it, nor on any render after.
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

const BIZ = "biz-products-hydrated";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "access-token-1");
  window.localStorage.setItem("kf_business_id", BIZ);
  apiGet.mockReset();
  apiGet.mockImplementation(async (path: string) =>
    path === `/identity/businesses/${BIZ}`
      ? { data: { id: BIZ, sells: "products", advancedCrm: false }, error: null }
      : { data: null, error: null },
  );
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).endsWith("/identity/businesses") ? jsonResponse(200, [{ id: BIZ, name: "Products Co" }]) : jsonResponse(404, {}),
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("app shell, hydrated: a products-only business never sees Schedule", () => {
  it("not on the hydration render (settings idle), nor after its settings are ready", async () => {
    const { useAppLayout } = await import("@/hooks/use-app-layout");
    const settingsStatus = (await import("@/lib/business-settings")).useBusinessSettings;
    const renders: { status: string; hubs: string[]; bar: string[] }[] = [];
    const consoleError = vi.spyOn(console, "error");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { result, unmount } = renderHook(
      () => {
        const layout = useAppLayout();
        const { status } = settingsStatus();
        renders.push({ status, hubs: layout.visibleHubs.map((h) => h.id), bar: layout.bottomBarHubs.map((h) => h.id) });
        return layout;
      },
      { hydrate: true, container },
    );
    await waitFor(() => expect(result.current.bottomBarHubs.map((h) => h.id)).toEqual(["sales", "customers"]));

    expect(renders.length).toBeGreaterThan(1);
    // The render this pins: the hydration render, where the settings are idle (the stored business not yet read).
    expect(renders[0].status).toBe("idle");
    // A real hydration, with nothing mismatched.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    expect(renders.filter((r) => r.hubs.includes("schedule") || r.bar.includes("schedule"))).toEqual([]);
    unmount();
  });
});
