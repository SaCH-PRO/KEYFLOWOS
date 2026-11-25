import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * FU-ME-NOTIFICATIONS-SCOPE (owner ruling D-276): the Me menu offers "Notifications" (the business's customer emails
 * and their log, /app/settings/notifications) only to members whose settings access is read or higher, as the
 * Settings index and the settings tab strip already do. Unknown access (no answer yet, a failed read) hides nothing:
 * the server decides (P30, FU-NOTIFICATIONS-PREFS-GUARD: customer-preferences and customer-log need settings read).
 * "My account" is every member's own. A member's own alerts stay in the header bell.
 *
 *   MNS-01 a member whose settings access is none is offered My account and no Notifications.
 *   MNS-02 a member with settings read (and write, and admin) is offered both.
 *   MNS-03 my-access failing (unknown) offers both: unknown hides nothing.
 *   MNS-04 a member whose answer names no settings entry at all is offered both (only a known 'none' hides).
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

const BIZ = "biz-me-menu";
const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** my-access answers `answer`; the business's settings are ready (a services business); every other read is empty. */
function serveAccess(answer: { data: unknown; error: string | null; status?: number }) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/${BIZ}/my-access`) return answer;
    if (path === `/identity/businesses/${BIZ}`) return { data: { id: BIZ, sells: "services", advancedCrm: false }, error: null, status: 200 };
    return { data: null, error: null };
  });
}

/** Every module none, except the ones given. */
function modules(granted: Record<string, "read" | "write" | "admin">) {
  return Object.fromEntries(ALL.map((m) => [m, granted[m] ?? "none"]));
}

async function renderShell() {
  const { useAppLayout } = await import("@/hooks/use-app-layout");
  return renderHook(() => useAppLayout());
}

const meLabels = (layout: { meNav: { label: string }[] }) => layout.meNav.map((i) => i.label);
const accessAsked = () =>
  expect(apiGet).toHaveBeenCalledWith(`/identity/businesses/${BIZ}/my-access`, ...([] as unknown[]));

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "access-token-1");
  window.localStorage.setItem("kf_business_id", BIZ);
  apiGet.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).endsWith("/identity/businesses") ? jsonResponse(200, [{ id: BIZ, name: "Me Menu Co" }]) : jsonResponse(404, {}),
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("FU-ME-NOTIFICATIONS-SCOPE (D-276): the Me menu's Notifications is for settings readers", () => {
  it("MNS-01 settings none: My account, and no Notifications", async () => {
    serveAccess({ data: { modules: modules({ bookings: "read", crm: "read" }) }, error: null, status: 200 });
    const { result, unmount } = await renderShell();
    // The levels have landed once the front-desk member's hubs narrow to what they may open.
    await waitFor(() => expect(result.current.visibleHubs.map((h) => h.id)).not.toContain("settings"));
    expect(meLabels(result.current)).toEqual(["My account"]);
    expect(result.current.meNav.map((i) => i.href)).not.toContain("/app/settings/notifications");
    unmount();
  });

  it("MNS-02 settings read, write or admin: My account and Notifications", async () => {
    for (const level of ["read", "write", "admin"] as const) {
      vi.resetModules();
      serveAccess({ data: { modules: modules({ crm: "read", settings: level }) }, error: null, status: 200 });
      const { result, unmount } = await renderShell();
      await waitFor(() => expect(result.current.visibleHubs.map((h) => h.id)).not.toContain("sales"));
      expect(meLabels(result.current), level).toEqual(["My account", "Notifications"]);
      unmount();
    }
  });

  it("MNS-03 my-access failing is unknown: both are offered (the server decides)", async () => {
    serveAccess({ data: null, error: "Internal Server Error", status: 500 });
    const { result, unmount } = await renderShell();
    await waitFor(accessAsked);
    await new Promise((r) => setTimeout(r, 20));
    expect(meLabels(result.current)).toEqual(["My account", "Notifications"]);
    unmount();
  });

  it("MNS-04 an answer naming no settings entry hides nothing (only a known none hides)", async () => {
    serveAccess({ data: { modules: { crm: "read", revenue: "none" } }, error: null, status: 200 });
    const { result, unmount } = await renderShell();
    await waitFor(() => expect(result.current.visibleHubs.map((h) => h.id)).not.toContain("sales"));
    expect(meLabels(result.current)).toEqual(["My account", "Notifications"]);
    unmount();
  });
});
