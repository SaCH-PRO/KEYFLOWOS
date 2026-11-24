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

const { bootstrapIdentity, apiGet, apiPatch, nav } = vi.hoisted(() => ({
  bootstrapIdentity: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  nav: { pathname: "/app", router: { push: () => {}, replace: () => {} } },
}));

vi.mock("@/lib/client", () => ({
  bootstrapIdentity: (...args: unknown[]) => bootstrapIdentity(...args),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
  // The shell's rail reads the search params (W9-WEB-COMMERCE-NAV); none here.
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
  apiPatch: (...args: unknown[]) => apiPatch(...args),
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

/** A promise the test releases by hand, to hold a request in flight. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function serve(opts: {
  businesses?: unknown | (() => unknown);
  businessesStatus?: number;
  held?: Promise<void>;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/identity/businesses")) {
      await opts.held;
      const listed = typeof opts.businesses === "function" ? opts.businesses() : opts.businesses;
      return jsonResponse(opts.businessesStatus ?? 200, listed ?? []);
    }
    if (url.endsWith("/identity/me")) {
      await opts.held;
      return jsonResponse(200, USER);
    }
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
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({ data: null, error: null });
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

describe("selectBusiness against a resolution already in flight", () => {
  it("nobody is told the old business after a switch, and the old business is not written back to the cache", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    const held = gate();
    serve({ businesses: [OLDEST_OWNED, SECOND], held: held.promise });
    const ws = await import("../workspace");

    const before = ws.refreshWorkspace(); // e.g. a page's mount, still waiting on the lists
    ws.selectBusiness(OLDEST_OWNED.id);
    const after = ws.refreshWorkspace(); // e.g. the shell's kf:business-changed handler
    held.release();

    await expect(after).resolves.toBe(OLDEST_OWNED.id);
    await expect(before).resolves.toBe(OLDEST_OWNED.id);
    expect(window.localStorage.getItem("kf_business_id")).toBe(OLDEST_OWNED.id);
    expect(cookie("kf_business_id")).toBe(OLDEST_OWNED.id);
    expect(ws.getCachedBusiness()?.id).toBe(OLDEST_OWNED.id);
    expect(JSON.parse(window.localStorage.getItem("kf_business_cache") ?? "null")?.id).toBe(
      OLDEST_OWNED.id,
    );
    expect(bootstrapIdentity).not.toHaveBeenCalled();
  });

  it("a switch made while a stale stored id resolves is kept, not replaced by the first listed membership", async () => {
    window.localStorage.setItem("kf_business_id", "biz-no-longer-a-member");
    const held = gate();
    serve({ businesses: [OLDEST_OWNED, SECOND], held: held.promise });
    const ws = await import("../workspace");

    const inFlight = ws.refreshWorkspace();
    ws.selectBusiness(SECOND.id);
    held.release();

    await expect(inFlight).resolves.toBe(SECOND.id);
    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(cookie("kf_business_id")).toBe(SECOND.id);
    expect(ws.getCachedBusiness()?.id).toBe(SECOND.id);
  });

  it("a switch made while bootstrap runs is put back after bootstrap writes its own pick", async () => {
    let listed: unknown[] = [];
    serve({ businesses: () => listed });
    const bootstrapHeld = gate();
    bootstrapIdentity.mockImplementation(async () => {
      await bootstrapHeld.promise;
      window.localStorage.setItem("kf_business_id", OLDEST_OWNED.id);
      return { data: { user: USER, business: OLDEST_OWNED, isNewBusiness: true }, error: null };
    });
    const ws = await import("../workspace");

    const inFlight = ws.refreshWorkspace();
    await vi.waitFor(() => expect(bootstrapIdentity).toHaveBeenCalledTimes(1));
    listed = [OLDEST_OWNED, SECOND];
    ws.selectBusiness(SECOND.id);
    bootstrapHeld.release();

    await expect(inFlight).resolves.toBe(SECOND.id);
    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(ws.getCachedBusiness()?.id).toBe(SECOND.id);
    expect(bootstrapIdentity).toHaveBeenCalledTimes(1);
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

  it("a profile edit reaches the header on the next navigation, without another resolution", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const ws = await import("../workspace");
    const { useAppLayout } = await import("@/hooks/use-app-layout");

    const { result, rerender, unmount } = renderHook(() => useAppLayout());
    await waitFor(() => expect(result.current.displayName).toBe(USER.name));

    // what personal-info-section does after PATCH /identity/me
    ws.setCachedUser({ ...USER, name: "Renamed Owner", avatarUrl: "/objects/avatar-2.png" });
    await act(async () => {
      nav.pathname = "/app/crm";
      rerender();
    });

    expect(result.current.displayName).toBe("Renamed Owner");
    expect(result.current.initials).toBe("RO");
    expect(result.current.avatarUrl).toBe("/objects/avatar-2.png");
    expect(resolutions()).toBe(1);
    unmount();
  });
});

describe("app shell notifications across a business switch", () => {
  const N_SECOND = { id: "n-second", title: "Bravo order", read: false };
  const N_OLDEST = { id: "n-oldest", title: "Alpha order", read: false };

  function serveNotifications(held?: { businessId: string; promise: Promise<void> }) {
    const rows: Record<string, unknown[]> = { [SECOND.id]: [N_SECOND], [OLDEST_OWNED.id]: [N_OLDEST] };
    apiGet.mockImplementation(async (path: string) => {
      const m = path.match(/^\/notifications\/businesses\/([^/?]+)(\/unread-count)?/);
      if (!m) return { data: null, error: null };
      if (held && m[1] === held.businessId) await held.promise;
      const list = rows[m[1]] ?? [];
      return { data: m[2] ? { count: list.length } : list, error: null };
    });
  }

  const ids = (list: { id: string }[]) => list.map((n) => n.id);

  it("drops the previous business's notifications at once, loads the new one's, and marks read only the one on screen", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    serveNotifications();
    const ws = await import("../workspace");
    const { useAppLayout } = await import("@/hooks/use-app-layout");

    const { result, unmount } = renderHook(() => useAppLayout());
    await waitFor(() => expect(ids(result.current.notifications)).toEqual([N_SECOND.id]));

    act(() => ws.selectBusiness(OLDEST_OWNED.id));

    // Nothing of the previous business is left to act on.
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    await act(async () => {
      await result.current.markAllRead();
    });
    expect(apiPatch).not.toHaveBeenCalled();

    await waitFor(() => expect(ids(result.current.notifications)).toEqual([N_OLDEST.id]));
    await act(async () => {
      await result.current.markAllRead();
    });

    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(apiPatch).toHaveBeenCalledWith(`/notifications/businesses/${OLDEST_OWNED.id}/read-all`, {});
    expect(result.current.notifications).toEqual([{ ...N_OLDEST, read: true }]);
    unmount();
  });

  it("a notifications answer for the previous business that lands after the switch is discarded", async () => {
    window.localStorage.setItem("kf_business_id", SECOND.id);
    serve({ businesses: [OLDEST_OWNED, SECOND] });
    const held = gate();
    serveNotifications({ businessId: SECOND.id, promise: held.promise });
    const ws = await import("../workspace");
    const { useAppLayout } = await import("@/hooks/use-app-layout");

    const { result, unmount } = renderHook(() => useAppLayout());
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(`/notifications/businesses/${SECOND.id}?unreadOnly=false`),
    );

    act(() => ws.selectBusiness(OLDEST_OWNED.id));
    await waitFor(() => expect(ids(result.current.notifications)).toEqual([N_OLDEST.id]));
    await act(async () => {
      held.release();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(ids(result.current.notifications)).toEqual([N_OLDEST.id]);
    unmount();
  });
});

/**
 * W11-WEB-OWNER-MEMBERSHIP-REFUSAL: POST /identity/bootstrap refuses a recorded owner who holds no membership (403
 * OWNER_MEMBERSHIP_REQUIRED, D-104). The membership list was authoritative and empty, so the stored business is not
 * theirs: the app forgets it (id, cookie, business cache) and keeps the session (tokens, user cache), instead of
 * addressing a business BusinessGuard refuses on every screen.
 *
 *   WS-OMR-1  RED-BEFORE  the refusal forgets the stored business and keeps the session
 *   WS-OMR-2  pin         concurrent callers still bootstrap exactly once on that path
 *   WS-OMR-3  pin         a non-empty membership list never bootstraps and never clears
 * Review round (security review M2):
 *   WS-OMR-4  RED-AT-38160278  a business written by another tab while the refused bootstrap was in flight is not
 *                       wiped: the resolution hands over and resolves that choice
 */
describe("W11-WEB-OWNER-MEMBERSHIP-REFUSAL: bootstrap refuses an owner with no membership", () => {
  const REFUSAL = {
    data: null,
    error: "Your access to this workspace has to be restored by an administrator before you can sign in to it. Contact support.",
    errorCode: "owner_membership_required",
    status: 403,
  };
  const STALE = "biz-membership-removed";

  function storeSession() {
    window.localStorage.setItem("kf_business_id", STALE);
    document.cookie = `kf_business_id=${STALE}; Path=/`;
    window.localStorage.setItem("kf_business_cache", JSON.stringify({ id: STALE, name: "Removed Co" }));
    window.localStorage.setItem("kf_refresh_token", "refresh-token-1");
    window.localStorage.setItem("kf_user_cache", JSON.stringify(USER));
  }

  it("WS-OMR-1 RED-BEFORE: the refusal forgets the stored business and keeps the session", async () => {
    storeSession();
    bootstrapIdentity.mockImplementation(async () => REFUSAL);
    serve({ businesses: [] });
    const { refreshWorkspace, getCachedBusiness, getStoredBusinessId } = await import("../workspace");

    await expect(refreshWorkspace()).resolves.toBeNull();

    expect(bootstrapIdentity).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("kf_business_id"), "the stored business id is forgotten").toBeNull();
    expect(getStoredBusinessId()).toBeNull();
    expect(cookie("kf_business_id"), "its cookie is cleared").toBeNull();
    expect(window.localStorage.getItem("kf_business_cache"), "the business cache is dropped").toBeNull();
    expect(getCachedBusiness()).toBeNull();
    expect(window.localStorage.getItem("kf_token"), "the session stays").toBe(TOKEN);
    expect(window.localStorage.getItem("kf_refresh_token")).toBe("refresh-token-1");
    expect(window.localStorage.getItem("kf_user_cache")).not.toBeNull();
  });

  it("WS-OMR-2 pin: concurrent callers still bootstrap exactly once on that path", async () => {
    storeSession();
    bootstrapIdentity.mockImplementation(async () => REFUSAL);
    serve({ businesses: [] });
    const { refreshWorkspace } = await import("../workspace");

    // (ensureWorkspace answers the stored id without a round trip while one is stored; refreshWorkspace re-validates.)
    const ids = await Promise.all([refreshWorkspace(), refreshWorkspace(), refreshWorkspace()]);

    expect(ids).toEqual([null, null, null]);
    expect(bootstrapIdentity).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("kf_token")).toBe(TOKEN);
  });

  it("WS-OMR-3 pin: a non-empty membership list never bootstraps and never clears", async () => {
    storeSession();
    bootstrapIdentity.mockImplementation(async () => REFUSAL);
    serve({ businesses: [SECOND] });
    const { refreshWorkspace } = await import("../workspace");

    await expect(refreshWorkspace()).resolves.toBe(SECOND.id);

    expect(bootstrapIdentity).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kf_business_id")).toBe(SECOND.id);
    expect(window.localStorage.getItem("kf_token")).toBe(TOKEN);
    expect(window.localStorage.getItem("kf_refresh_token")).toBe("refresh-token-1");
  });

  it("WS-OMR-4 RED-AT-38160278: a choice written by another tab during the refused bootstrap is kept", async () => {
    storeSession();
    let listed = 0;
    // The first list is empty; by the second the other tab's business is a membership again.
    serve({ businesses: () => (listed++ === 0 ? [] : [SECOND]) });
    bootstrapIdentity.mockImplementation(async () => {
      // Another tab (same localStorage) picks a business while this bootstrap is in flight.
      window.localStorage.setItem("kf_business_id", SECOND.id);
      return REFUSAL;
    });
    const { refreshWorkspace } = await import("../workspace");

    await expect(refreshWorkspace()).resolves.toBe(SECOND.id);

    expect(window.localStorage.getItem("kf_business_id"), "the other tab's choice is not wiped").toBe(SECOND.id);
    expect(bootstrapIdentity).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("kf_token")).toBe(TOKEN);
  });
});
