/**
 * RR-ADMIN-SHELL-SERVER-GATE repair round 1, OBS-1 (needed by owner ruling D-290).
 *
 * app/admin/layout.tsx wraps every /admin route, /admin/login included, in its isSuperAdmin guard. A logged-out
 * browser that opens /admin/login gets "Access denied", a router.replace to /admin/login and a blank page, so the
 * admin can never sign in; and the edge gate now sends every browser without an admin session there.
 *
 *   ALX-01 /admin/login, logged out: the real login form renders, with no "Access denied" and no redirect
 *          (RED at 1c4ff81d: the layout renders nothing).
 *   ALX-02 /admin/login/ (trailing slash): the same.
 *   ALX-03 the login page is rendered bare: no admin shell (no nav, no "Sign out") around it.
 *   ALX-04 guard: /admin/users, logged out, is still refused by the layout (toast, replace to /admin/login, nothing
 *          rendered).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/admin/login",
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import AdminLayout from "@/app/admin/layout";
import AdminLoginPage from "@/app/admin/login/page";

beforeEach(() => {
  window.localStorage.clear();
  toastError.mockReset();
  nav.router.replace.mockReset();
  // Logged out: any network read (refreshWorkspace) fails.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderAt(pathname: string, child: React.ReactNode) {
  nav.pathname = pathname;
  return render(<AdminLayout>{child}</AdminLayout>);
}

describe("OBS-1: the admin layout does not guard its own login page", () => {
  for (const path of ["/admin/login", "/admin/login/"]) {
    it(`${path === "/admin/login" ? "ALX-01" : "ALX-02"} ${path}, logged out, renders the sign-in form`, async () => {
      renderAt(path, <AdminLoginPage />);
      expect(await screen.findByPlaceholderText("admin@example.com")).toBeTruthy();
      expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
      await new Promise((r) => setTimeout(r, 20));
      expect(toastError).not.toHaveBeenCalled();
      expect(nav.router.replace).not.toHaveBeenCalled();
    });
  }

  it("ALX-03 the login page is not wrapped in the admin shell", async () => {
    renderAt("/admin/login", <AdminLoginPage />);
    await screen.findByPlaceholderText("admin@example.com");
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.queryByText("Feature Flags")).toBeNull();
  });

  it("ALX-04 guard: /admin/users, logged out, is still refused", async () => {
    renderAt("/admin/users", <div>admin users page</div>);
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/admin/login"));
    expect(toastError).toHaveBeenCalled();
    expect(screen.queryByText("admin users page")).toBeNull();
  });
});
