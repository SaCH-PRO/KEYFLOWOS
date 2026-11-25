/**
 * FU-REQUIRE-AUTH-REMOUNT (v1 step 6, launch track by owner ruling D-281; journeys C, D, F): the app shell is
 * verified once per session or token change, never torn down on a page change.
 *
 * WHY. components/require-auth.tsx wraps every /app page (app/app/layout.tsx mounts it around the whole shell). Its
 * `verify` depended on `redirectToLogin`, which depended on `pathname`, so the effect that runs `verify` ran again on
 * every client navigation: RequireAuth went back to "checking", replaced the shell with its spinner, called
 * GET /identity/me again, and mounted the destination page a second time. A page that reads and strips a one-shot
 * URL parameter on mount (/app/bookings?contactId=, /app/commerce?tab=quotes&contactId=) lost it on the second mount,
 * so the contacts screens' "Book appointment" door opened an empty bookings page (found by
 * WEDGE-WA-INBOUND-CAPTURE's web half, 2026-11-25; a reviewer's jsdom probe printed "MOUNTS after one pathname
 * change: 2, identity/me calls 2").
 *
 * WHAT THIS PINS, with the real RequireAuth, lib/api and lib/workspace (only `fetch` and the Next router stubbed):
 *
 *   RED (the defect)
 *     N1  a client navigation between /app pages does not show the spinner or remount the shell, and does not call
 *         /identity/me again;
 *     N2  several navigations: one /identity/me call and one shell mount in all;
 *     N3  a one-shot ?contactId survives a router.push to /app/bookings (the page reads and strips it once);
 *     T1  a sign-in in another tab (the storage event for kf_token) is verified at once, and the shell is not shown
 *         for the new token before that verification answers;
 *     T2  a sign-out in another tab sends this tab to sign-in at once, with `from` the page it is on;
 *     T3  a change of the admin bearer in another tab (getAuthHeaders sends kf_admin_token first) is verified too.
 *   Controls (the auth boundary as it was; each passes before and after the fix)
 *     C1  no token: sent to /auth/login?from=<path>, no /identity/me call, the page never rendered;
 *     C2  a definitive 401 (no refresh possible): the session is cleared (clearStoredBusinessId, with the
 *         removed-member notice and the business id) and the visitor is sent to sign-in with `from`;
 *     C3  the page is never rendered before /identity/me answers;
 *     C4  a global 401 (kf:unauthorized) after a navigation sends to sign-in with `from` the CURRENT page;
 *     C5  a token rotated in this tab (refreshAccessToken writes kf_token, no storage event) is verified again by the
 *         next navigation, with the new bearer;
 *     C6  a token change in another tab is verified by the next navigation at the latest;
 *     C7  the admin bearer is what /identity/me is called with when one is stored;
 *     C8  an unreachable API shows the error state, and Retry verifies again and shows the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState, type ReactNode } from "react";
import { render, screen, waitFor, act, cleanup, fireEvent } from "@testing-library/react";

// Stable across renders, as Next's own are.
const nav = vi.hoisted(() => ({
  pathname: "/app/crm/contacts",
  searchParams: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { RequireAuth } from "../require-auth";

// ── the API: GET /identity/me answers per bearer ──────────────────────────

type MeAnswer = "ok" | "401" | "500" | "hang";
let meAnswerFor: (bearer: string | null, nth: number) => MeAnswer = () => "ok";
const hanging: Array<(r: Response) => void> = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/identity/me")) {
    const auth = new Headers(init?.headers).get("Authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
    // This call is already recorded: the first /identity/me call is nth 0.
    const answer = meAnswerFor(bearer, meCalls().length - 1);
    if (answer === "hang") return new Promise<Response>((resolve) => hanging.push(resolve));
    if (answer === "401") return jsonResponse(401, { message: "Unauthorized" });
    if (answer === "500") return jsonResponse(500, { message: "boom" });
    return jsonResponse(200, { id: `user-of-${bearer}`, email: "owner@example.test" });
  }
  // refreshAccessToken is never reached with a refresh token in these tests; anything else is not under test.
  return jsonResponse(404, {});
});

/** The /identity/me calls so far, with the bearer each was sent with. */
function meCalls(): Array<string | null> {
  return fetchMock.mock.calls
    .filter(([input]) => String(input instanceof Request ? input.url : input).includes("/identity/me"))
    .map(([, init]) => {
      const auth = new Headers((init as RequestInit | undefined)?.headers).get("Authorization");
      return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
    });
}

// ── the shell and its pages ───────────────────────────────────────────────

let shellMounts = 0;
const pageMounts: Record<string, number> = {};

function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    shellMounts += 1;
  }, []);
  return <div data-testid="shell">{children}</div>;
}

function Page({ name }: { name: string }) {
  useEffect(() => {
    pageMounts[name] = (pageMounts[name] ?? 0) + 1;
  }, [name]);
  return <h1>{`Page ${name}`}</h1>;
}

/**
 * As app/app/bookings/page.tsx: on mount it reads ?contactId once, opens the New booking sheet for that contact, and
 * strips the parameter from the URL (window.history.replaceState there, which Next reflects in useSearchParams).
 */
function BookingsPage() {
  const [prefill, setPrefill] = useState<string | null>(null);
  useEffect(() => {
    pageMounts["/app/bookings"] = (pageMounts["/app/bookings"] ?? 0) + 1;
    const contactId = nav.searchParams.get("contactId");
    if (contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the page under imitation reads a one-shot URL parameter on mount
      setPrefill(contactId);
      nav.searchParams = new URLSearchParams();
    }
  }, []);
  return <div data-testid="bookings">{prefill ? `New booking for ${prefill}` : "No booking sheet"}</div>;
}

function App() {
  return (
    <RequireAuth>
      <Shell>{nav.pathname === "/app/bookings" ? <BookingsPage /> : <Page name={nav.pathname} />}</Shell>
    </RequireAuth>
  );
}

/** A client navigation (router.push): Next re-renders the layout with the new pathname and search params. */
function go(rerender: (ui: ReactNode) => void, url: string) {
  const u = new URL(url, "http://localhost");
  nav.pathname = u.pathname;
  nav.searchParams = new URLSearchParams(u.search);
  rerender(<App />);
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function renderVerified() {
  const utils = render(<App />);
  await screen.findByTestId("shell");
  await settle();
  return utils;
}

const spinner = () => screen.queryByText(/Verifying session/);

function storageChange(key: string | null, oldValue: string | null, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: window.localStorage }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "token-a");
  window.localStorage.setItem("kf_business_id", "biz-a");
  nav.pathname = "/app/crm/contacts";
  nav.searchParams = new URLSearchParams();
  nav.router.replace.mockReset();
  nav.router.push.mockReset();
  meAnswerFor = () => "ok";
  hanging.length = 0;
  shellMounts = 0;
  for (const k of Object.keys(pageMounts)) delete pageMounts[k];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── RED: the defect ───────────────────────────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT: a page change does not tear down or re-verify the shell", () => {
  it("N1 a client navigation does not show the spinner, remount the shell or call /identity/me again", async () => {
    // Any /identity/me call after the first never answers: if the navigation re-verified, the spinner would stay.
    meAnswerFor = (_bearer, nth) => (nth === 0 ? "ok" : "hang");
    const { rerender } = await renderVerified();
    expect(meCalls(), "one verification on the first load").toEqual(["token-a"]);

    go(rerender, "/app/commerce");
    await settle();

    expect(spinner(), "RequireAuth's spinner after a client navigation").toBeNull();
    expect(screen.queryByRole("heading", { name: "Page /app/commerce" }), "the destination page shows").not.toBeNull();
    expect(shellMounts, "the shell mounted once, not again on the navigation").toBe(1);
    expect(pageMounts["/app/commerce"], "the destination page mounted once").toBe(1);
    expect(meCalls().length, "/identity/me calls after one navigation").toBe(1);
  });

  it("N2 several navigations: one /identity/me call and one shell mount in all", async () => {
    const { rerender } = await renderVerified();
    for (const url of ["/app/commerce", "/app/bookings", "/app/finance", "/app/crm/contacts"]) {
      go(rerender, url);
      await settle();
    }
    expect(meCalls().length, "/identity/me calls after four navigations").toBe(1);
    expect(shellMounts, "shell mounts after four navigations").toBe(1);
    expect(pageMounts["/app/bookings"], "the bookings page mounted once").toBe(1);
  });

  it("N3 a one-shot ?contactId survives a router.push to /app/bookings", async () => {
    const { rerender } = await renderVerified();
    go(rerender, "/app/bookings?contactId=contact-7");
    await settle();
    await settle();
    expect(screen.getByTestId("bookings"), "the New booking sheet opened for the contact").toHaveTextContent(
      "New booking for contact-7",
    );
    expect(pageMounts["/app/bookings"], "the bookings page mounted once").toBe(1);
  });
});

describe("FU-REQUIRE-AUTH-REMOUNT: the stored token changing in another tab is verified at once", () => {
  it("T1 another tab's sign-in: verified with the new bearer, and the shell is not shown for it until that answers", async () => {
    meAnswerFor = (bearer) => (bearer === "token-b" ? "hang" : "ok");
    await renderVerified();
    window.localStorage.setItem("kf_token", "token-b");
    storageChange("kf_token", "token-a", "token-b");
    await settle();

    expect(meCalls(), "verified again, with the other tab's token").toEqual(["token-a", "token-b"]);
    expect(screen.queryByTestId("shell"), "the shell is not shown for an unverified token").toBeNull();
    expect(spinner(), "the spinner shows while the new token is verified").not.toBeNull();

    await act(async () => {
      hanging.forEach((resolve) => resolve(jsonResponse(200, { id: "user-b" })));
    });
    await settle();
    expect(screen.queryByTestId("shell"), "the shell is back once the new token is verified").not.toBeNull();
  });

  it("T2 another tab's sign-out: sent to sign-in at once, with `from` the page this tab is on", async () => {
    await renderVerified();
    window.localStorage.removeItem("kf_token");
    storageChange("kf_token", "token-a", null);
    await settle();

    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/crm/contacts")}`);
    expect(screen.queryByTestId("shell"), "no protected content once signed out").toBeNull();
  });

  it("T3 another tab's admin sign-in (kf_admin_token, which getAuthHeaders sends first) is verified with that bearer", async () => {
    await renderVerified();
    window.localStorage.setItem("kf_admin_token", "admin-1");
    storageChange("kf_admin_token", null, "admin-1");
    await settle();
    expect(meCalls(), "verified again, with the admin bearer").toEqual(["token-a", "admin-1"]);
    expect(screen.queryByTestId("shell")).not.toBeNull();
  });
});

// ── controls: the auth boundary as it was ─────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT controls: the auth boundary still holds", () => {
  it("C1 a signed-out visitor (no token) is sent to sign-in with `from`, and nothing is rendered or called", async () => {
    window.localStorage.removeItem("kf_token");
    nav.pathname = "/app/bookings";
    render(<App />);
    await settle();
    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/bookings")}`);
    expect(meCalls(), "no /identity/me call without a token").toEqual([]);
    expect(screen.queryByTestId("shell")).toBeNull();
    expect(shellMounts).toBe(0);
  });

  it("C2 a definitive 401 clears the session (the removed-member notice too) and sends to sign-in with `from`", async () => {
    meAnswerFor = () => "401";
    window.localStorage.setItem("kf_removed_business", JSON.stringify({ id: "biz-x", name: "Gone Ltd", userId: "u1" }));
    nav.pathname = "/app/commerce";
    render(<App />);
    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/commerce")}`),
    );
    expect(window.localStorage.getItem("kf_token"), "the token is cleared").toBeNull();
    expect(window.localStorage.getItem("kf_business_id"), "the business id is cleared").toBeNull();
    expect(window.localStorage.getItem("kf_removed_business"), "the removed-member notice is cleared").toBeNull();
    expect(shellMounts, "the page was never rendered").toBe(0);
  });

  it("C3 the page is never rendered before /identity/me answers", async () => {
    meAnswerFor = () => "hang";
    render(<App />);
    await settle();
    expect(screen.queryByTestId("shell"), "no protected content while the session is unverified").toBeNull();
    expect(spinner()).not.toBeNull();
    await act(async () => {
      hanging.forEach((resolve) => resolve(jsonResponse(200, { id: "user-a" })));
    });
    await screen.findByTestId("shell");
  });

  it("C4 a global 401 after a navigation sends to sign-in with `from` the current page", async () => {
    const { rerender } = await renderVerified();
    go(rerender, "/app/finance");
    await settle();
    act(() => {
      window.dispatchEvent(new CustomEvent("kf:unauthorized", { detail: { path: "/commerce/x" } }));
    });
    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/finance")}`);
    expect(window.localStorage.getItem("kf_token")).toBeNull();
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("C5 a token rotated in this tab (no storage event) is verified again by the next navigation", async () => {
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", "token-rotated");
    go(rerender, "/app/commerce");
    await settle();
    expect(meCalls(), "verified again with the rotated token").toEqual(["token-a", "token-rotated"]);
    expect(screen.queryByRole("heading", { name: "Page /app/commerce" })).not.toBeNull();
  });

  it("C6 a token change in another tab is verified by the next navigation at the latest", async () => {
    meAnswerFor = (bearer) => (bearer === "token-b" ? "401" : "ok");
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", "token-b");
    storageChange("kf_token", "token-a", "token-b");
    go(rerender, "/app/commerce");
    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/login\?from=%2Fapp%2F/)),
    );
    expect(meCalls()).toContain("token-b");
    expect(screen.queryByTestId("shell"), "a rejected token never shows the shell").toBeNull();
  });

  it("C7 the admin bearer is what /identity/me is called with when one is stored", async () => {
    window.localStorage.setItem("kf_admin_token", "admin-1");
    await renderVerified();
    expect(meCalls()).toEqual(["admin-1"]);
    expect(screen.queryByTestId("shell")).not.toBeNull();
  });

  it("C8 an unreachable API shows the error state; Retry verifies again and shows the page", { timeout: 15_000 }, async () => {
    let failing = true;
    meAnswerFor = () => (failing ? "500" : "ok");
    render(<App />);
    const retry = await screen.findByRole("button", { name: "Retry" }, { timeout: 5_000 });
    expect(screen.queryByTestId("shell")).toBeNull();
    expect(meCalls().length, "three attempts before the error state").toBe(3);
    failing = false;
    fireEvent.click(retry);
    await screen.findByTestId("shell");
  });
});
