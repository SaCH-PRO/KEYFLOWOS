// @vitest-environment-options {"url":"https://admin.test/"}
/**
 * RR-ADMIN-SHELL-SERVER-GATE repair round 2 (census security review note on admin/login/page.tsx:48): the admin
 * sign-in mirrors kf_admin_token, kf_admin_user_cache and kf_auth_mode into cookies for the edge gate. They carry
 * SameSite=Lax always and Secure on https, as writeTokenCookie (lib/workspace.ts) writes kf_token. Over plain http
 * (local dev) Secure is left off: a browser drops a Secure cookie set from http, and the edge gate would then refuse
 * every admin page. This file runs at https://admin.test/ (the docblock above); its twin
 * admin-login-cookies-http.test.tsx runs the same cases at the default http URL.
 *
 * At c764cb0f the three cookies are written "name=value; path=/; max-age=86400", with neither attribute.
 *
 *   ALC-01 each of the three admin cookies is written with SameSite=Lax (RED at c764cb0f).
 *   ALC-02 Secure is set exactly when the page is on https (RED at c764cb0f on https; a pin on http).
 *   ALC-03 path=/ and the 24h max-age are kept (a pin).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/admin/login",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", () => ({
  apiPostSimple: async () => ({
    data: { accessToken: "h.p.s", user: { id: "adm", email: "admin@alc.test", role: "SUPER_ADMIN" } },
    error: null,
  }),
}));

import AdminLoginPage from "@/app/admin/login/page";

const NAMES = ["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"] as const;
let writes: string[] = [];

beforeEach(() => {
  writes = [];
  window.localStorage.clear();
  nav.router.replace.mockReset();
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => desc.get!.call(document),
    set: (v: string) => {
      writes.push(v);
      desc.set!.call(document, v);
    },
  });
});

afterEach(() => {
  cleanup();
  delete (document as unknown as { cookie?: string }).cookie;
  window.localStorage.clear();
});

/** Sign in through the real form; returns each admin cookie's attributes (lower-cased) as last written. */
async function signIn(): Promise<Map<string, string[]>> {
  render(<AdminLoginPage />);
  fireEvent.change(screen.getByPlaceholderText("admin@example.com"), { target: { value: "admin@alc.test" } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/admin"));
  const byName = new Map<string, string[]>();
  for (const w of writes) {
    const name = w.split("=")[0].trim();
    byName.set(
      name,
      w
        .split(";")
        .slice(1)
        .map((a) => a.trim().toLowerCase()),
    );
  }
  for (const n of NAMES) expect(byName.has(n), `${n} is written`).toBe(true);
  return byName;
}

const onHttps = window.location.protocol === "https:";

describe(`the admin sign-in's cookies (${window.location.protocol})`, () => {
  it("ALC-01 each admin cookie is SameSite=Lax", async () => {
    const byName = await signIn();
    for (const n of NAMES) expect(byName.get(n), n).toContain("samesite=lax");
  });

  it(`ALC-02 Secure is ${onHttps ? "set" : "left off"}`, async () => {
    const byName = await signIn();
    for (const n of NAMES) expect(byName.get(n)!.includes("secure"), n).toBe(onHttps);
  });

  it("ALC-03 path=/ and max-age=86400 are kept", async () => {
    const byName = await signIn();
    for (const n of NAMES) {
      expect(byName.get(n), n).toContain("path=/");
      expect(byName.get(n), n).toContain("max-age=86400");
    }
  });
});
