/**
 * W11-WEB-OWNER-MEMBERSHIP-REFUSAL (D-104; reviews SEC-W10OM-3, OMV-2): the OAuth callback names the refusal of a
 * recorded owner who holds no membership.
 *
 * POST /identity/bootstrap answers 403 {code:'OWNER_MEMBERSHIP_REQUIRED', message:'Your access to this workspace has
 * to be restored by an administrator ...'} (identity.service.ts ensureBootstrapWorkspace; the global filter keeps
 * the code flat beside the message). The callback showed that text under a generic "Authentication Error" with only
 * "Back to Sign In"; the account_email_conflict view has a Contact support link, this refusal had none, and
 * bootstrapIdentity mapped no code for it.
 *
 *   CB-OMR-1  RED-BEFORE  the page shows "Your workspace access needs restoring" with the server's message, a Contact
 *                         support link and Back to Sign In, not "Authentication Error"; it never opens /app or
 *                         /app/onboarding
 *   CB-OMR-2  RED-BEFORE  bootstrapIdentity maps OWNER_MEMBERSHIP_REQUIRED, flat or nested under message, to
 *                         errorCode 'owner_membership_required'
 *   CB-OMR-3  control     account_email_conflict still opens its own view
 *
 * The page and client.ts run for real; fetch (Supabase's /auth/v1/user and the API's bootstrap) and the router are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://omr-project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "omr-anon-key-not-real";
  return {
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/auth/callback",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import AuthCallback from "../page";
import { bootstrapIdentity } from "@/lib/client";

const REFUSAL_TEXT =
  "Your access to this workspace has to be restored by an administrator before you can sign in to it. Contact support.";
/** The production answer: GlobalHttpExceptionFilter keeps `code` flat beside `message`. */
const FLAT = { statusCode: 403, code: "OWNER_MEMBERSHIP_REQUIRED", message: REFUSAL_TEXT, error: "Forbidden" };
/** Nest's own shape when no filter flattens it: the object under `message`. */
const NESTED = { statusCode: 403, message: { code: "OWNER_MEMBERSHIP_REQUIRED", message: REFUSAL_TEXT }, error: "Forbidden" };

function serve(bootstrapStatus: number, bootstrapBody: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/user") {
      return json(200, { email: "owner@omr.test", user_metadata: { full_name: "Removed Owner" }, identities: [] });
    }
    if (url.pathname.endsWith("/identity/bootstrap")) return json(bootstrapStatus, bootstrapBody);
    return json(404, { message: `not served: ${url.pathname}` });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/auth/callback#access_token=omr-access&refresh_token=omr-refresh&expires_in=3600");
  nav.router.push.mockClear();
  nav.router.replace.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("W11-WEB-OWNER-MEMBERSHIP-REFUSAL: the OAuth callback names the owner-membership refusal", () => {
  it("CB-OMR-1 RED-BEFORE: the refusal has its own view with the server's message and Contact support", async () => {
    serve(403, FLAT);
    render(<AuthCallback />);

    expect(await screen.findByRole("heading", { name: "Your workspace access needs restoring" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(REFUSAL_TEXT)).toBeInTheDocument();
    const support = screen.getByRole("link", { name: /contact support/i });
    expect(support.getAttribute("href")).toMatch(/^mailto:support@keyflow\.app/);
    expect(screen.getByRole("button", { name: /back to sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Authentication Error" })).not.toBeInTheDocument();
    const opened = nav.router.push.mock.calls.map(([to]) => String(to));
    expect(opened.filter((to) => to === "/app" || to.startsWith("/app/")), "the app is never opened").toEqual([]);
  });

  it("CB-OMR-2 RED-BEFORE: bootstrapIdentity maps the code, flat or nested, to owner_membership_required", async () => {
    window.localStorage.setItem("kf_token", "omr-access");
    for (const body of [FLAT, NESTED]) {
      serve(403, body);
      const result = await bootstrapIdentity({});
      expect(result).toMatchObject({ data: null, error: REFUSAL_TEXT, errorCode: "owner_membership_required", status: 403 });
      vi.restoreAllMocks();
    }
  });

  it("CB-OMR-3 control: account_email_conflict still opens its own view", async () => {
    serve(409, { statusCode: 409, code: "account_email_conflict", message: "An account with this email already exists." });
    render(<AuthCallback />);

    expect(await screen.findByRole("heading", { name: "This email is already in use" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your workspace access needs restoring" })).not.toBeInTheDocument();
  });
});
