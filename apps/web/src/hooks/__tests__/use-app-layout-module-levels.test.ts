import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * WEDGE-WA-INBOUND-CAPTURE review repair COR-4: the New menu's From WhatsApp door follows the shell's answer.
 *
 * NewEntityMenu read the member's levels itself (useMemberModuleLevels), once per open: each open sent another
 * GET my-access and started unknown, so a member with crm read saw "From WhatsApp" appear and then vanish. The shell
 * already holds the answer (useAppLayout reads it for the nav); it now hands it down: useAppLayout's moduleLevels,
 * through AppHeader, to NewEntityMenu (new-entity-menu-whatsapp.test.tsx NEM-07, NEM-08).
 *
 *   NML-01 useAppLayout exposes the member's levels as my-access answered them (unknown, null, until then).
 *   NML-02 a failed my-access read is unknown (null): the door shows, the server still refuses.
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

const BIZ = "biz-levels";
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

const accessAsked = () =>
  expect(apiGet).toHaveBeenCalledWith(`/identity/businesses/${BIZ}/my-access`, ...([] as unknown[]));

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "access-token-1");
  window.localStorage.setItem("kf_business_id", BIZ);
  apiGet.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).endsWith("/identity/businesses") ? jsonResponse(200, [{ id: BIZ, name: "Levels Co" }]) : jsonResponse(404, {}),
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("COR-4: the shell hands the member's levels down", () => {
  it("NML-01 useAppLayout exposes the levels my-access answered (null until then)", async () => {
    serveAccess({ data: { modules: modules({ crm: "read", revenue: "write" }) }, error: null, status: 200 });
    const { result, unmount } = await renderShell();
    const shell = () => result.current as unknown as { moduleLevels?: Record<string, string> | null };
    expect(shell().moduleLevels ?? null).toBeNull();
    await waitFor(() => expect(shell().moduleLevels?.crm).toBe("read"));
    expect(shell().moduleLevels?.revenue).toBe("write");
    unmount();
  });

  it("NML-02 a failed read is unknown (null)", async () => {
    serveAccess({ data: null, error: "Internal Server Error", status: 500 });
    const { result, unmount } = await renderShell();
    await waitFor(accessAsked);
    await new Promise((r) => setTimeout(r, 20));
    const shell = result.current as unknown as Record<string, unknown>;
    expect("moduleLevels" in shell).toBe(true);
    expect(shell.moduleLevels).toBeNull();
    unmount();
  });
});
