/**
 * FU-UNDO-TOAST-SIGNOUT (owner ruling D-283): the header's sign-out (useAppLayout().handleLogout) ends the session's
 * toasts. The member has chosen to leave, so a pending bulk-delete Undo toast ("Deleted 3 contacts") is dismissed at
 * once, before POST /identity/logout answers (it can hang on a bad network), and again with the local wipe, so a toast
 * raised while the server was asked is not left either. Sign-out still navigates to sign-in in place.
 *
 *   LOT-01 the Undo toast is gone while POST /identity/logout has not answered
 *   LOT-02 a toast raised while the logout was on its way is gone once sign-out finishes; the session is wiped and
 *          sign-in is opened
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, waitFor, cleanup, act } from "@testing-library/react";
import { Toaster, toast } from "sonner";

const { apiPost, nav, logoutGate } = vi.hoisted(() => {
  const gate: { release: () => void; promise: Promise<void> } = { release: () => {}, promise: Promise.resolve() };
  return {
    apiPost: vi.fn(),
    nav: { pathname: "/app/crm/contacts", router: { push: vi.fn(), replace: vi.fn() } },
    logoutGate: gate,
  };
});

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
  apiGet: async () => ({ data: null, error: null }),
  apiPatch: async () => ({ data: null, error: null }),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

import { useAppLayout } from "@/hooks/use-app-layout";

const BIZ = "biz-logout-toast";

function raiseUndoToast(title = "Deleted 3 contacts") {
  act(() => {
    toast.success(title, { duration: 10_000, action: { label: "Undo", onClick: () => {} } });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "access-token-1");
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  logoutGate.promise = new Promise<void>((resolve) => {
    logoutGate.release = resolve;
  });
  apiPost.mockImplementation(async (opts: { path?: string }) => {
    if (opts?.path === "/identity/logout") await logoutGate.promise;
    return { data: null, error: null };
  });
  render(<Toaster />);
});

afterEach(() => {
  logoutGate.release();
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("FU-UNDO-TOAST-SIGNOUT: the header's sign-out ends the session's toasts", () => {
  it("LOT-01 the Undo toast is gone while POST /identity/logout has not answered", async () => {
    const { result } = renderHook(() => useAppLayout());
    raiseUndoToast();
    await screen.findByText("Deleted 3 contacts");

    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.handleLogout() as unknown as Promise<void>;
    });
    expect(apiPost).toHaveBeenCalledWith({ path: "/identity/logout", body: {} });

    await waitFor(() => {
      expect(screen.queryByText("Deleted 3 contacts")).toBeNull();
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
    // The server has still not answered: nothing was wiped or navigated yet.
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kf_token")).toBe("access-token-1");

    logoutGate.release();
    await act(async () => {
      await done;
    });
  });

  it("LOT-02 a toast raised while the logout was on its way is gone once sign-out finishes", async () => {
    const { result } = renderHook(() => useAppLayout());

    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.handleLogout() as unknown as Promise<void>;
    });
    // A restore answered meanwhile (FU-BULK-DELETE-UNDO's restoreFromTrash toasts its outcome).
    raiseUndoToast("Restored 3 contacts");
    await screen.findByText("Restored 3 contacts");

    logoutGate.release();
    await act(async () => {
      await done;
    });

    await waitFor(() => expect(screen.queryByText("Restored 3 contacts")).toBeNull());
    expect(window.localStorage.getItem("kf_token")).toBeNull();
    expect(nav.router.push).toHaveBeenCalledWith("/auth/login");
  });
});
