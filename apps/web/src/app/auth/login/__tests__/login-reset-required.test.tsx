/**
 * W10-RISC-RESET (owner ruling D-113; review CR-W9RPC-2) — the web sign-in
 * shows why a password sign-in is refused after a security event.
 *
 * After a Google RISC sign-in cutoff, a password session stays refused until
 * the user completes a password reset through KEYFLOW after the cutoff
 * (D-113). POST /identity/login used to answer 'authenticated' for such a
 * session; the web stored the token, its bootstrap got a 401 and it showed a
 * generic error. The server now answers 401 with the code
 * `password_reset_required` (identity.controller.ts), and the REAL login form
 * shows "Password reset required after a security event" with a link into the
 * existing reset flow (the form's own "Reset password" mode, which mails the
 * recovery link through POST /identity/forgot-password), the email kept. No
 * token is stored and no bootstrap is attempted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => {
  // The form reads these at module load: the reset mode needs a configured provider.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://v96q-project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "v96q-anon-key-not-real";
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

const EMAIL = "v96q_owner@test.local";

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];

function serve(loginStatus: number, loginBody: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/identity/login") {
      return new Response(JSON.stringify(loginBody), { status: loginStatus, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/identity/forgot-password") {
      return new Response(JSON.stringify({ status: "sent" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not served in this test", { status: 599 });
  });
}

function signIn() {
  render(<LoginForm />);
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: EMAIL } });
  fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "v96q-some-passphrase-not-real" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in/i }));
}

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("W10-RISC-RESET (D-113) — the sign-in form names the password-reset refusal", () => {
  it("D-113 (W10-RISC-RESET): a 401 password_reset_required login shows 'Password reset required after a security event' with a reset link into the existing reset flow; no token is stored and no bootstrap runs", async () => {
    serve(401, {
      statusCode: 401,
      code: "password_reset_required",
      message: "Password reset required after a security event.",
    });
    signIn();

    expect(await screen.findByText(/password reset required after a security event/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("kf_token")).toBeNull();
    expect(window.localStorage.getItem("kf_refresh_token")).toBeNull();
    expect(calls.map((c) => c.path)).toEqual(["/identity/login"]);
    expect(nav.router.push).not.toHaveBeenCalled();

    // The reset link opens the existing reset flow with the email kept, and sends the recovery mail.
    fireEvent.click(screen.getByRole("button", { name: /reset your password/i }));
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue(EMAIL);
    expect(screen.queryByText(/password reset required after a security event/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(["/identity/login", "/identity/forgot-password"]));
    expect(calls[1]).toEqual({ method: "POST", path: "/identity/forgot-password", body: { email: EMAIL } });
    expect(await screen.findByRole("heading", { name: "Check your inbox" })).toBeInTheDocument();
  });

  it("D-113 (W10-RISC-RESET) negative control: an invalid_credentials login shows its own message and no reset-required link", async () => {
    serve(400, { statusCode: 400, code: "invalid_credentials", message: "Invalid email or password." });
    signIn();

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
    expect(screen.queryByText(/password reset required after a security event/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /reset your password/i })).toBeNull();
  });
});
