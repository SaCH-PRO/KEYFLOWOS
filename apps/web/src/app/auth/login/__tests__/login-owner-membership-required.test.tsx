/**
 * W11-WEB-OWNER-MEMBERSHIP-REFUSAL (D-104): the password sign-in shows the owner-membership refusal and opens nothing.
 *
 * POST /identity/login succeeds; POST /identity/bootstrap answers 403 OWNER_MEMBERSHIP_REQUIRED (a recorded owner
 * with no membership on any live business). login-form.tsx throws bootstrap.error, so the server's own words are shown
 * and no route opens. The packet changes no logic here; this pins it.
 *
 *   LG-OMR-1  pin  the server's text is shown and router.push is never called
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://omr-project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "omr-anon-key-not-real";
  return {
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/auth/login",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import LoginForm from "../login-form";

const EMAIL = "omr_owner@test.local";
const REFUSAL_TEXT =
  "Your access to this workspace has to be restored by an administrator before you can sign in to it. Contact support.";

let paths: string[] = [];

beforeEach(() => {
  paths = [];
  window.localStorage.clear();
  nav.router.push.mockClear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    paths.push(url.pathname);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/identity/login") {
      return json(201, { status: "authenticated", accessToken: "omr-access", refreshToken: "omr-refresh", expiresIn: 3600 });
    }
    if (url.pathname === "/identity/bootstrap") {
      return json(403, { statusCode: 403, code: "OWNER_MEMBERSHIP_REQUIRED", message: REFUSAL_TEXT, error: "Forbidden" });
    }
    return json(404, { message: `not served: ${url.pathname}` });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("W11-WEB-OWNER-MEMBERSHIP-REFUSAL: the sign-in form shows the owner-membership refusal", () => {
  it("LG-OMR-1 pin: the server's text is shown and nothing opens", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "omr-some-passphrase-not-real" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in/i }));

    expect(await screen.findByText(REFUSAL_TEXT, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(paths).toEqual(expect.arrayContaining(["/identity/login", "/identity/bootstrap"]));
    expect(nav.router.push).not.toHaveBeenCalled();
  });
});
