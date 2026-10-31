import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * R0-18 — membership-first business selection (M03 / CF-23).
 *
 * Before this packet the web app had no notion of "which business am I in"
 * beyond whatever POST /identity/bootstrap answered last. The app shell called
 * refreshWorkspace() on every pathname change, and refreshWorkspace() always
 * bootstrapped, so an owner who had picked their second business was put back
 * on the oldest owned one on the next click. GET /identity/businesses (the
 * membership list) had no web caller at all.
 *
 * The contract proven here, which holds under any ruling of D-10:
 *   - a stored id that is one of the caller's memberships is kept;
 *   - a stored id that is not is replaced by the first listed membership;
 *   - bootstrap runs only when the membership list is empty, and only once;
 *   - an unavailable list never triggers a blind bootstrap;
 *   - selectBusiness() is the one place a choice is written;
 *   - the app shell resolves once per mount, and again on kf:business-changed.
 */

const { bootstrapIdentity, apiGet, nav } = vi.hoisted(() => ({
  bootstrapIdentity: vi.fn(),
  apiGet: vi.fn(),
  nav: { pathname: "/app", router: { push: () => {}, replace: () => {} } },
}));

vi.mock("@/lib/client", () => ({
  bootstrapIdentity: (...args: unknown[]) => bootstrapIdentity(...args),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
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

// Server-shaped fixtures: GET /identity/businesses returns sanitized Business
// rows; POST /identity/bootstrap answers with the OLDEST owned business.
const OLDEST_OWNED = { id: "biz-a-oldest-owned", name: "Alpha Bakery", currency: "TTD" };
const SECOND = { id: "biz-b-second", name: "Bravo Studio", currency: "USD" };
const USER = { id: "user-1", email: "owner@example.test", name: "Owner One", role: "SUPER_ADMIN" };
const TOKEN = "access-token-1";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function serve(opts: { businesses?: unknown; businessesStatus?: number }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/identity/businesses")) {
      return jsonResponse(opts.businessesStatus ?? 200, opts.businesses ?? []);
    }
    if (url.endsWith("/identity/me")) return jsonResponse(200, USER);
    if (url.endsWith("/identity/refresh")) return jsonResponse(401, {});
    return jsonResponse(404, {});
  });
}

const listCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/identity/businesses"));

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function clearCookies() {
  for (const name of ["kf_business_id", "kf_token"]) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  clearCookies();
  window.localStorage.setItem("kf_token", TOKEN);
  nav.pathname = "/app";
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: null, error: null });
  bootstrapIdentity.mockReset();
  // Like the real client.ts bootstrapIdentity: it answers with the oldest
  // owned business AND writes kf_business_id itself.
  bootstrapIdentity.mockImplementation(async () => {
    window.localStorage.setItem("kf_business_id", OLDEST_OWNED.id);
    return { data: { user: USER, business: OLDEST_OWNED, isNewBusiness: false }, error: null };
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  clearCookies();
});

describe("workspace business selection (membership-first)", () => {
  it("keeps a stored second-business id that is one of the caller's memberships", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const { refreshWorkspace } = await import("../workspace");
    const { getApiBase } = await import("../api-base");

    await expect(refreshWorkspace()).resolves.toBe(SECOND.id);

    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(bootstrapIdentity).not.toHaveBeenCalled();
    expect(listCalls()).toHaveLength(1);
    const [url, init] = listCalls()[0];
    expect(url).toBe(`${getApiBase()}/identity/businesses`);
    expect(new Headers((init as RequestInit | undefined)?.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("replaces a stored id that is not a membership with the first listed business", async () => {
    window.localStorage.setItem("kf_business_id", "biz-no-longer-a-member");
    serve({ businesses: [SECOND, OLDEST_OWNED] });
    const { refreshWorkspace, getCachedBusiness } = await import("../workspace");

    await expect(refreshWorkspace()).resolves.toBe(SECOND.id);

    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(cookie("kf_business_id")).toBe(SECOND.id);
    expect(getCachedBusiness()?.id).toBe(SECOND.id);
    expect(bootstrapIdentity).not.toHaveBeenCalled();
  });

  it("with nothing stored, an invited member lands on their only membership without a bootstrap", async () => {
    serve({ businesses: [SECOND] });
    const { ensureWorkspace } = await import("../workspace");

    await expect(ensureWorkspace()).resolves.toBe(SECOND.id);

    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(bootstrapIdentity).not.toHaveBeenCalled();
  });

  it("an empty membership list bootstraps exactly once, even for concurrent callers", async () => {
    serve({ businesses: [] });
    const { refreshWorkspace, ensureWorkspace } = await import("../workspace");

    const ids = await Promise.all([refreshWorkspace(), refreshWorkspace(), ensureWorkspace()]);

    expect(ids).toEqual([OLDEST_OWNED.id, OLDEST_OWNED.id, OLDEST_OWNED.id]);
    expect(bootstrapIdentity).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("kf_business_id")).toBe(OLDEST_OWNED.id);
  });

  it("an unavailable membership list keeps the stored choice and never bootstraps blind", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businessesStatus: 503 });
    const { refreshWorkspace } = await import("../workspace");

    await expect(refreshWorkspace()).resolves.toBe(SECOND.id);

    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(bootstrapIdentity).not.toHaveBeenCalled();
  });

  it("still refreshes the cached user, so the admin gate and header name keep working", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const { refreshWorkspace, getCachedUser, isSuperAdmin } = await import("../workspace");

    await refreshWorkspace();

    expect(getCachedUser()?.email).toBe(USER.email);
    expect(isSuperAdmin()).toBe(true);
  });

  it("selectBusiness writes storage and the cookie, clears both caches, and announces the change", async () => {
    const ws = await import("../workspace");
    ws.setCachedBusiness({ id: OLDEST_OWNED.id, name: OLDEST_OWNED.name });
    ws.setCachedUser({ id: USER.id, email: USER.email });
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("kf:business-changed", listener);

    try {
      ws.selectBusiness(SECOND.id);
    } finally {
      window.removeEventListener("kf:business-changed", listener);
    }

    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(cookie("kf_business_id")).toBe(SECOND.id);
    expect(window.localStorage.getItem("kf_business_cache")).toBeNull();
    expect(window.localStorage.getItem("kf_user_cache")).toBeNull();
    expect(ws.getCachedBusiness()).toBeNull();
    expect(ws.getCachedUser()).toBeNull();
    expect(seen).toEqual([{ businessId: SECOND.id }]);
  });

  it("sign-in puts back the choice held before bootstrap overwrote it, but only if it is a membership", async () => {
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const { restoreBusinessChoice } = await import("../workspace");

    // bootstrap (login form / OAuth callback) has just written the oldest owned id
    window.localStorage.setItem("kf_business_id", OLDEST_OWNED.id);
    await expect(restoreBusinessChoice(SECOND.id)).resolves.toBe(SECOND.id);
    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);

    // a leftover id from another account is not a membership: bootstrap's pick stands
    window.localStorage.setItem("kf_business_id", OLDEST_OWNED.id);
    await expect(restoreBusinessChoice("biz-someone-else")).resolves.toBe(OLDEST_OWNED.id);
    expect(window.localStorage.getItem("kf_business_id")).toBe(OLDEST_OWNED.id);
    expect(bootstrapIdentity).not.toHaveBeenCalled();
  });
});

describe("app shell (useAppLayout) business resolution", () => {
  const resolutions = () => listCalls().length + bootstrapIdentity.mock.calls.length;

  it("resolves once per mount, not on every pathname change, and keeps the stored business", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const { useAppLayout } = await import("@/hooks/use-app-layout");

    const { rerender, unmount } = renderHook(() => useAppLayout());
    await waitFor(() => expect(resolutions()).toBe(1));

    for (const path of ["/app/crm", "/app/money", "/app/crm/contacts"]) {
      await act(async () => {
        nav.pathname = path;
        rerender();
        await new Promise((r) => setTimeout(r, 10));
      });
    }

    expect(resolutions()).toBe(1);
    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    unmount();
  });

  it("re-resolves when the business changes", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const { useAppLayout } = await import("@/hooks/use-app-layout");

    const { unmount } = renderHook(() => useAppLayout());
    await waitFor(() => expect(resolutions()).toBe(1));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("kf:business-changed", { detail: { businessId: OLDEST_OWNED.id } }),
      );
    });

    await waitFor(() => expect(resolutions()).toBe(2));
    unmount();
  });
});
