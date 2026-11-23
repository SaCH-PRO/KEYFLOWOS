import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * FU-NAV-A1-CODEX-224 (a): the app shell shows a sells-dependent hub only for what the business is known to sell.
 * Until its settings are "ready" (idle on the first render, before the stored business id is read; loading; failed)
 * the shell holds the defaults (sells "both"), and a products-only business must not see Schedule from them.
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

const BIZ = "biz-products-only";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** The business's settings read answers `answer`; every other read answers nothing. */
function serveSettings(answer: () => Promise<{ data: unknown; error: string | null; status?: number }>) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/${BIZ}`) return answer();
    return { data: null, error: null };
  });
}

type Shown = { hubs: string[]; bar: string[]; sections: string[] };

/** Renders the shell and records what every render shows. */
async function renderShell() {
  const { useAppLayout } = await import("@/hooks/use-app-layout");
  const renders: Shown[] = [];
  const view = renderHook(() => {
    const layout = useAppLayout();
    renders.push({
      hubs: layout.visibleHubs.map((h) => h.id),
      bar: layout.bottomBarHubs.map((h) => h.id),
      sections: layout.visibleOperateSections.map((s) => s.id),
    });
    return layout;
  });
  return { ...view, renders };
}

const showsSchedule = (shown: Shown) =>
  shown.hubs.includes("schedule") || shown.bar.includes("schedule") || shown.sections.includes("schedule");

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "access-token-1");
  window.localStorage.setItem("kf_business_id", BIZ);
  apiGet.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).endsWith("/identity/businesses") ? jsonResponse(200, [{ id: BIZ, name: "Products Co" }]) : jsonResponse(404, {}),
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("app shell: sells is known only when the business's settings are ready", () => {
  it("a products-only business never sees Schedule, not on the first render nor while loading", async () => {
    serveSettings(async () => ({ data: { id: BIZ, sells: "products", advancedCrm: false }, error: null, status: 200 }));
    const { result, renders, unmount } = await renderShell();
    await waitFor(() => expect(result.current.visibleHubs.map((h) => h.id)).toContain("sales"));
    await waitFor(() => expect(result.current.bottomBarHubs.map((h) => h.id)).toEqual(["sales", "customers"]));

    expect(renders.length).toBeGreaterThan(1);
    expect(renders.filter(showsSchedule)).toEqual([]);
    unmount();
  });

  it("a read that fails shows no sells-dependent hub, rather than the defaults' Schedule", async () => {
    serveSettings(async () => ({ data: null, error: "Forbidden", status: 403 }));
    const { result, renders, unmount } = await renderShell();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/identity/businesses/${BIZ}`, expect.anything()));
    await waitFor(() => expect(renders.length).toBeGreaterThan(2));
    await new Promise((r) => setTimeout(r, 20));

    expect(result.current.visibleHubs.map((h) => h.id)).not.toContain("schedule");
    expect(result.current.bottomBarHubs).toEqual([]);
    expect(renders.filter(showsSchedule)).toEqual([]);
    unmount();
  });

  it("a services business sees Schedule once its settings are ready", async () => {
    serveSettings(async () => ({ data: { id: BIZ, sells: "services", advancedCrm: false }, error: null, status: 200 }));
    const { result, unmount } = await renderShell();
    await waitFor(() => expect(result.current.bottomBarHubs.map((h) => h.id)).toEqual(["schedule", "customers"]));
    expect(result.current.visibleHubs.map((h) => h.id)).toContain("schedule");
    unmount();
  });
});
