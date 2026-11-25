/**
 * FU-REQUIRE-AUTH-REMOUNT, review repair round 1 (correctness MAJOR-1, security MINOR-2, the minor test gaps).
 *
 * WHY. The first fix keyed the verified session on the raw token string, so every rotation of the SAME user's token
 * (refreshAccessToken on a 401, about hourly at access-token expiry) tore the shell down and verified it again: in
 * this tab, the next navigation after a rotation mounted the destination page twice again (a one-shot ?contactId
 * lost, the packet's own defect back); from another tab, the storage event tore this tab's shell down and its unsaved
 * draft was lost, which the base did not do.
 *
 * THE DESIGN (orchestrator decision, the security reviewer's conditions for a background re-verify):
 *   - no user token (a sign-out here or in another tab, another tab's localStorage.clear()): sign-in at once;
 *   - the admin bearer (kf_admin_token, which getAuthHeaders sends first) appears, changes or disappears: the acting
 *     principal changed, the shell is torn down and verified again;
 *   - the user token changes: its `sub` (decoded locally, unsigned; the server verifies every request) is compared
 *     with the verified token's `sub`. Different, or either not decodable: torn down and verified again. The same:
 *     the shell stays and /identity/me is asked in the background; its answer must name the same user id as the
 *     first verification (else torn down), a 401 signs out, a network or server error leaves the verified shell;
 *   - no commit renders the pages for a session that is missing or names another `sub` (or another admin bearer)
 *     than the one verified: the spinner shows instead.
 *
 * `sub` and the /identity/me id: the API resolves a user token to `{ id: payload.sub }` (supabase-auth.service.ts
 * buildUserFromPayload; with a provider client, Supabase getUser's id, which is the JWT `sub`), and GET /identity/me
 * answers the local User row with that id (identity.service.ts getUser). They are the same value today; the shell
 * still compares `sub` with `sub` and the /identity/me id with the /identity/me id, never one with the other.
 *
 *   S1  a different-user token from another tab tears the shell down until it is verified
 *   S2  a same-user rotation from another tab keeps the shell and its unsaved draft; verified in the background
 *   S3  a same-user rotation in this tab, then router.push('/app/bookings?contactId=…'): one shell mount, one page
 *       mount, the page sees contactId; verified in the background with the rotated bearer
 *   S4  an admin bearer that appears, changes or disappears always tears the shell down, even for the same `sub`
 *   S5  a background answer naming another user id tears the shell down and verifies again
 *   S6  a background 401 clears the session and sends to sign-in with `from`
 *   S7  a background server error leaves the verified same-user shell (no spinner, no error state, no redirect)
 *   S8  a rotation to a token that cannot be decoded tears the shell down
 *   S9  a navigation after the token was removed in this tab (no storage event) never mounts the destination page
 *   S10 a navigation after this tab stored another user's token never mounts the destination page before it is
 *       verified
 *   S11 another tab's localStorage.clear() (a storage event with key null) sends to sign-in at once
 *   S12 an unmount while /identity/me is on its way: a late 401 neither redirects nor updates state
 *   S13 a 401 with a refresh token: the token is refreshed and the refreshed one verified (no sign-out)
 *   S14 a stored token is mirrored into the kf_token cookie the middleware reads
 *   S15 a global 401 during the first verification: one redirect, and the late answer shows nothing
 *   S16 from the error state, a navigation verifies again
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState, type ReactNode } from "react";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";

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

// ── tokens shaped like Supabase's (header.payload.signature, base64url) ───

let tokenSeq = 0;
function jwt(sub: string): string {
  tokenSeq += 1;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, aud: "authenticated", n: tokenSeq })}.c2lnbmF0dXJl`;
}

function subOf(token: string | null): string | null {
  try {
    const p = JSON.parse(Buffer.from(String(token).split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string };
    return p.sub ?? null;
  } catch {
    return null;
  }
}

// ── the API ───────────────────────────────────────────────────────────────

type MeAnswer = { status: number; body?: unknown } | "hang";
/** GET /identity/me's answer for a bearer; `nth` counts that bearer's calls from 0. Default: 200, the token's user. */
let meAnswerFor: (bearer: string | null, nth: number) => MeAnswer = (bearer) => ({ status: 200, body: { id: subOf(bearer) } });
let refreshAnswer: { status: number; body?: unknown } = { status: 401, body: {} };
const hanging: Array<(r: Response) => void> = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function urlOf(input: RequestInfo | URL): string {
  return String(input instanceof Request ? input.url : input);
}

function bearerOf(init?: RequestInit): string | null {
  const auth = new Headers(init?.headers).get("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input);
  if (url.includes("/identity/me")) {
    const bearer = bearerOf(init);
    const nth = meCalls().filter((b) => b === bearer).length - 1; // this call is already recorded
    const answer = meAnswerFor(bearer, nth);
    if (answer === "hang") return new Promise<Response>((resolve) => hanging.push(resolve));
    return jsonResponse(answer.status, answer.body ?? {});
  }
  if (url.includes("/identity/refresh")) return jsonResponse(refreshAnswer.status, refreshAnswer.body ?? {});
  return jsonResponse(404, {});
});

function meCalls(): Array<string | null> {
  return fetchMock.mock.calls
    .filter(([input]) => urlOf(input).includes("/identity/me"))
    .map(([, init]) => bearerOf(init as RequestInit | undefined));
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

/** As app/app/bookings/page.tsx: reads ?contactId once on mount, opens the New booking sheet, strips the parameter. */
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

/** An unsaved form in the shell (a half-written quote). */
function Draft() {
  const [text, setText] = useState("");
  return <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />;
}

function App() {
  return (
    <RequireAuth>
      <Shell>
        <Draft />
        {nav.pathname === "/app/bookings" ? <BookingsPage /> : <Page name={nav.pathname} />}
      </Shell>
    </RequireAuth>
  );
}

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
const draft = () => screen.getByLabelText("draft") as HTMLInputElement;

/** Another tab wrote `key` (the storage event this tab receives). */
function otherTabWrites(key: string, value: string | null) {
  const oldValue = window.localStorage.getItem(key);
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: value, storageArea: window.localStorage }));
  });
}

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

let TOKEN_A = "";

beforeEach(() => {
  window.localStorage.clear();
  clearCookies();
  TOKEN_A = jwt("user-1");
  window.localStorage.setItem("kf_token", TOKEN_A);
  window.localStorage.setItem("kf_business_id", "biz-a");
  nav.pathname = "/app/crm/contacts";
  nav.searchParams = new URLSearchParams();
  nav.router.replace.mockReset();
  nav.router.push.mockReset();
  meAnswerFor = (bearer) => ({ status: 200, body: { id: subOf(bearer) } });
  refreshAnswer = { status: 401, body: {} };
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

const releaseHanging = (status: number, body: unknown) =>
  act(async () => {
    hanging.splice(0).forEach((resolve) => resolve(jsonResponse(status, body)));
  });

// ── a change of the user token ────────────────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT repair: a change of the user token", () => {
  it("S1 a different-user token from another tab tears the shell down until it is verified", async () => {
    const other = jwt("user-2");
    meAnswerFor = (bearer) => (bearer === other ? "hang" : { status: 200, body: { id: subOf(bearer) } });
    await renderVerified();
    otherTabWrites("kf_token", other);
    await settle();
    expect(meCalls(), "verified with the other user's token").toEqual([TOKEN_A, other]);
    expect(screen.queryByTestId("shell"), "the shell is not shown for an unverified other user").toBeNull();
    expect(spinner()).not.toBeNull();
    await releaseHanging(200, { id: "user-2" });
    await settle();
    expect(screen.queryByTestId("shell")).not.toBeNull();
    expect(shellMounts, "a fresh shell for the other user").toBe(2);
  });

  it("S2 a same-user rotation from another tab keeps the shell and its unsaved draft, verified in the background", async () => {
    await renderVerified();
    fireEvent.change(draft(), { target: { value: "half-written quote" } });
    const rotated = jwt("user-1");
    otherTabWrites("kf_token", rotated);
    await settle();
    await settle();
    expect(spinner(), "no spinner for a same-user rotation").toBeNull();
    expect(draft().value, "the unsaved draft survives").toBe("half-written quote");
    expect(shellMounts, "the shell mounted once").toBe(1);
    expect(meCalls(), "verified in the background, with the rotated bearer").toEqual([TOKEN_A, rotated]);
  });

  it("S3 a same-user rotation in this tab, then router.push to /app/bookings?contactId: one mount, contactId seen", async () => {
    const { rerender } = await renderVerified();
    const rotated = jwt("user-1");
    window.localStorage.setItem("kf_token", rotated); // refreshAccessToken: no storage event in this tab
    go(rerender, "/app/bookings?contactId=contact-7");
    await settle();
    await settle();
    expect(screen.getByTestId("bookings"), "the New booking sheet opened for the contact").toHaveTextContent(
      "New booking for contact-7",
    );
    expect(pageMounts["/app/bookings"], "the bookings page mounted once").toBe(1);
    expect(shellMounts, "the shell mounted once").toBe(1);
    expect(meCalls(), "verified in the background, with the rotated bearer").toEqual([TOKEN_A, rotated]);
  });

  it("S5 a background answer naming another user id tears the shell down and verifies again", async () => {
    const rotated = jwt("user-1");
    meAnswerFor = (bearer, nth) =>
      bearer === rotated ? (nth === 0 ? { status: 200, body: { id: "user-9" } } : "hang") : { status: 200, body: { id: subOf(bearer) } };
    await renderVerified();
    otherTabWrites("kf_token", rotated);
    await settle();
    await settle();
    expect(meCalls(), "asked again after the answer named another user").toEqual([TOKEN_A, rotated, rotated]);
    expect(screen.queryByTestId("shell"), "the shell is torn down").toBeNull();
    expect(spinner()).not.toBeNull();
  });

  it("S6 a background 401 clears the session and sends to sign-in with `from`", async () => {
    const rotated = jwt("user-1");
    meAnswerFor = (bearer) => (bearer === rotated ? { status: 401, body: {} } : { status: 200, body: { id: subOf(bearer) } });
    await renderVerified();
    otherTabWrites("kf_token", rotated);
    await settle();
    await settle();
    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/crm/contacts")}`);
    expect(window.localStorage.getItem("kf_token"), "the session is cleared").toBeNull();
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("S7 a background server error leaves the verified same-user shell", { timeout: 15_000 }, async () => {
    const rotated = jwt("user-1");
    meAnswerFor = (bearer) => (bearer === rotated ? { status: 500, body: {} } : { status: 200, body: { id: subOf(bearer) } });
    await renderVerified();
    fireEvent.change(draft(), { target: { value: "half-written quote" } });
    otherTabWrites("kf_token", rotated);
    await settle(2_000); // three attempts, 0.5 s and 1 s apart
    expect(meCalls().filter((b) => b === rotated).length, "three attempts in the background").toBe(3);
    expect(screen.queryByRole("button", { name: "Retry" }), "no error state").toBeNull();
    expect(spinner()).toBeNull();
    expect(draft().value).toBe("half-written quote");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("S8 a rotation to a token that cannot be decoded tears the shell down", async () => {
    meAnswerFor = (bearer) => (bearer === "opaque-token" ? "hang" : { status: 200, body: { id: subOf(bearer) } });
    await renderVerified();
    otherTabWrites("kf_token", "opaque-token");
    await settle();
    expect(screen.queryByTestId("shell")).toBeNull();
    expect(meCalls()).toEqual([TOKEN_A, "opaque-token"]);
  });
});

// ── the admin bearer ──────────────────────────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT repair: an admin bearer change always tears the shell down", () => {
  it("S4 the admin bearer appears, changes and disappears: each time torn down and verified, even for the same sub", async () => {
    const admin1 = jwt("user-1");
    const admin2 = jwt("user-1");
    await renderVerified();
    for (const [value, expectBearer] of [
      [admin1, admin1],
      [admin2, admin2],
      [null, TOKEN_A],
    ] as const) {
      const before = meCalls().length;
      meAnswerFor = () => "hang";
      otherTabWrites("kf_admin_token", value);
      await settle();
      expect(screen.queryByTestId("shell"), `torn down when the admin bearer becomes ${value ? "a token" : "absent"}`).toBeNull();
      expect(meCalls().slice(before), "verified with the bearer now sent").toEqual([expectBearer]);
      await releaseHanging(200, { id: "user-1" });
      await settle();
      expect(screen.queryByTestId("shell")).not.toBeNull();
    }
  });
});

// ── no commit renders the pages for a session that is not the verified one ─

describe("FU-REQUIRE-AUTH-REMOUNT repair: no page renders for a missing or different session", () => {
  it("S9 a navigation after the token was removed in this tab never mounts the destination page", async () => {
    const { rerender } = await renderVerified();
    window.localStorage.removeItem("kf_token");
    go(rerender, "/app/commerce");
    await settle();
    expect(pageMounts["/app/commerce"], "the destination page never mounted").toBeUndefined();
    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/commerce")}`);
  });

  it("S10 a navigation after this tab stored another user's token never mounts the destination page before it is verified", async () => {
    const other = jwt("user-2");
    meAnswerFor = (bearer) => (bearer === other ? "hang" : { status: 200, body: { id: subOf(bearer) } });
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", other);
    go(rerender, "/app/commerce");
    await settle();
    expect(pageMounts["/app/commerce"], "the destination page never mounted").toBeUndefined();
    expect(spinner()).not.toBeNull();
  });
});

// ── the minor test gaps ───────────────────────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT repair: the boundary's other paths", () => {
  it("S11 another tab's localStorage.clear() (key null) sends to sign-in at once", async () => {
    await renderVerified();
    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null, oldValue: null, newValue: null, storageArea: window.localStorage }));
    });
    await settle();
    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/crm/contacts")}`);
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("S12 an unmount while /identity/me is on its way: a late 401 neither redirects nor updates state", async () => {
    meAnswerFor = () => "hang";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<App />);
    await settle();
    unmount();
    await releaseHanging(401, {});
    await settle();
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kf_token"), "the session is not cleared by a stale answer").toBe(TOKEN_A);
    expect(err).not.toHaveBeenCalled();
  });

  it("S13 a 401 with a refresh token: the refreshed token is verified and stored, no sign-out", async () => {
    const refreshed = jwt("user-1");
    window.localStorage.setItem("kf_refresh_token", "refresh-1");
    refreshAnswer = { status: 200, body: { accessToken: refreshed, refreshToken: "refresh-2" } };
    meAnswerFor = (bearer) => (bearer === TOKEN_A ? { status: 401, body: {} } : { status: 200, body: { id: subOf(bearer) } });
    render(<App />);
    await screen.findByTestId("shell");
    expect(meCalls()).toEqual([TOKEN_A, refreshed]);
    expect(window.localStorage.getItem("kf_token")).toBe(refreshed);
    expect(window.localStorage.getItem("kf_refresh_token")).toBe("refresh-2");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("S14 a stored token is mirrored into the kf_token cookie the middleware reads", async () => {
    expect(document.cookie).not.toContain("kf_token=");
    await renderVerified();
    expect(document.cookie).toContain(`kf_token=${encodeURIComponent(TOKEN_A)}`);
  });

  it("S15 a global 401 during the first verification: one redirect, and the late answer shows nothing", async () => {
    meAnswerFor = () => "hang";
    render(<App />);
    await settle();
    act(() => {
      window.dispatchEvent(new CustomEvent("kf:unauthorized", { detail: { path: "/x" } }));
    });
    await releaseHanging(200, { id: "user-1" });
    await settle();
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("S16 from the error state, a navigation verifies again", { timeout: 15_000 }, async () => {
    meAnswerFor = () => ({ status: 500, body: {} });
    const { rerender } = render(<App />);
    await screen.findByRole("button", { name: "Retry" }, { timeout: 5_000 });
    meAnswerFor = (bearer) => ({ status: 200, body: { id: subOf(bearer) } });
    go(rerender, "/app/finance");
    await screen.findByTestId("shell", undefined, { timeout: 5_000 });
  });
});
