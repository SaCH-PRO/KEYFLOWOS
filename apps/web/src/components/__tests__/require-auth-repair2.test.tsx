/**
 * FU-REQUIRE-AUTH-REMOUNT, review repair round 2.
 *
 * MINOR-A (security): the background re-verify of a same-user rotation kept the shell on ANY answer but 200 and 401,
 * so a 403, or the 404 GET /identity/me answers once the user row is gone (identity.service.ts getUser), left a
 * verified shell up, and the pages' own 403/404 never sign the member out. The rule now: the shell stays only for a
 * transient failure, a fetch that throws (network), a 5xx, a 408 or a 429; any other answer tears the shell down and
 * verifies again, which then ends as a first verification on that answer would (the error state, or sign-in on 401).
 *   A1  a background 404 tears the shell down; the re-verification ends in the error state, as a first load does
 *   A2  the same for a background 403
 *   A3  a background 429 keeps the shell; A4 a background network failure keeps the shell
 *
 * Pins (the code was right; these kill mutants the reviews named):
 *   Q1  after one background accept the verified key advances: a rotation then three navigations make two
 *       /identity/me calls in all (R7)
 *   C1  an admin bearer changed in this tab (no storage event), then a navigation: the destination page never mounts
 *       (the render guard compares the admin bearer; R8 / C)
 *   E1  a background answer with no user id tears the shell down (E)
 *   L1  an undecodable token written in this tab, then a navigation: the destination never mounts, whether the
 *       verified token was a JWT (another sub) or itself undecodable (compared exactly) (L)
 *   R6  a token for another sub written in this tab while a background re-verify is on its way: when that answer
 *       arrives, the shell is torn down before the other user's token is asked about
 *
 * Observation 3 (security): a token change in this tab followed by a navigation that changes only the search
 * parameters re-rendered the guard (spinner) without a re-check, so the spinner stayed until the next pathname change.
 *   X1  a search-params-only navigation after an in-tab token change re-checks: the new token is verified and the
 *       shell comes back
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

type MeAnswer = { status: number; body?: unknown } | "hang" | "throw";
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
    if (answer === "throw") throw new TypeError("Failed to fetch");
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


const rotatedAnswers = (rotated: string, answers: MeAnswer[]) => (bearer: string | null, nth: number): MeAnswer =>
  bearer === rotated ? answers[Math.min(nth, answers.length - 1)] : { status: 200, body: { id: subOf(bearer) } };

// ── MINOR-A: which background answers keep the shell ──────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT repair 2: a background answer other than a transient failure tears the shell down", () => {
  for (const [id, status] of [["A1", 404], ["A2", 403]] as const) {
    it(`${id} a background ${status} tears the shell down; re-verifying ends in the error state, as a first load does`, { timeout: 15_000 }, async () => {
      const rotated = jwt("user-1");
      meAnswerFor = rotatedAnswers(rotated, [{ status, body: { message: "gone" } }]);
      await renderVerified();
      otherTabWrites("kf_token", rotated);
      await settle(2_000); // the background attempts (three, 0.5 s and 1 s apart)
      expect(screen.queryByTestId("shell"), `the shell is torn down on a background ${status}`).toBeNull();
      await screen.findByRole("button", { name: "Retry" }, { timeout: 5_000 });
      expect(screen.getByText(new RegExp(`Server returned ${status}`)), "the error state a first load shows").not.toBeNull();
      expect(nav.router.replace).not.toHaveBeenCalled();
    });
  }

  it("A3 a background 429 keeps the shell", { timeout: 15_000 }, async () => {
    const rotated = jwt("user-1");
    meAnswerFor = rotatedAnswers(rotated, [{ status: 429, body: {} }]);
    await renderVerified();
    fireEvent.change(draft(), { target: { value: "half-written quote" } });
    otherTabWrites("kf_token", rotated);
    await settle(2_000);
    expect(meCalls().filter((b) => b === rotated).length).toBe(3);
    expect(spinner()).toBeNull();
    expect(draft().value).toBe("half-written quote");
  });

  it("A4 a background network failure keeps the shell", { timeout: 15_000 }, async () => {
    const rotated = jwt("user-1");
    meAnswerFor = rotatedAnswers(rotated, ["throw"]);
    await renderVerified();
    fireEvent.change(draft(), { target: { value: "half-written quote" } });
    otherTabWrites("kf_token", rotated);
    await settle(2_000);
    expect(meCalls().filter((b) => b === rotated).length).toBe(3);
    expect(spinner()).toBeNull();
    expect(draft().value).toBe("half-written quote");
  });
});

// ── pins ──────────────────────────────────────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT repair 2: pins", () => {
  it("Q1 after one background accept the verified key advances: a rotation then three navigations make two /identity/me calls", async () => {
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", jwt("user-1"));
    for (const url of ["/app/commerce", "/app/finance", "/app/bookings"]) {
      go(rerender, url);
      await settle();
    }
    expect(meCalls().length, "the first verification and one background re-verify").toBe(2);
    expect(shellMounts).toBe(1);
  });

  it("C1 an admin bearer changed in this tab, then a navigation: the destination page never mounts", async () => {
    meAnswerFor = (bearer) => (bearer === TOKEN_A ? { status: 200, body: { id: "user-1" } } : "hang");
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_admin_token", jwt("user-1"));
    go(rerender, "/app/commerce");
    await settle();
    expect(pageMounts["/app/commerce"], "the destination page never mounted").toBeUndefined();
    expect(spinner()).not.toBeNull();
  });

  it("E1 a background answer with no user id tears the shell down", async () => {
    const rotated = jwt("user-1");
    meAnswerFor = rotatedAnswers(rotated, [{ status: 200, body: {} }, "hang"]);
    await renderVerified();
    otherTabWrites("kf_token", rotated);
    await settle();
    await settle();
    expect(meCalls(), "asked again after an answer with no id").toEqual([TOKEN_A, rotated, rotated]);
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("L1 an undecodable token written in this tab after a JWT session, then a navigation: the destination never mounts", async () => {
    meAnswerFor = (bearer) => (bearer === "opaque-x" ? "hang" : { status: 200, body: { id: subOf(bearer) } });
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", "opaque-x");
    go(rerender, "/app/commerce");
    await settle();
    expect(pageMounts["/app/commerce"]).toBeUndefined();
    expect(spinner()).not.toBeNull();
  });

  it("L2 an undecodable session, another undecodable token written in this tab, then a navigation: the destination never mounts", async () => {
    window.localStorage.setItem("kf_token", "opaque-1");
    meAnswerFor = (bearer) => (bearer === "opaque-2" ? "hang" : { status: 200, body: { id: "user-1" } });
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", "opaque-2");
    go(rerender, "/app/commerce");
    await settle();
    expect(pageMounts["/app/commerce"]).toBeUndefined();
    expect(spinner()).not.toBeNull();
  });

  it("R6 another user's token written in this tab while a background re-verify is on its way: torn down before it is asked about", async () => {
    const rotated = jwt("user-1");
    const other = jwt("user-2");
    meAnswerFor = (bearer) =>
      bearer === rotated || bearer === other ? "hang" : { status: 200, body: { id: subOf(bearer) } };
    await renderVerified();
    otherTabWrites("kf_token", rotated); // background re-verify, on its way
    await settle();
    expect(screen.queryByTestId("shell"), "the shell stays during a same-user re-verify").not.toBeNull();
    window.localStorage.setItem("kf_token", other); // this tab, no storage event
    await releaseHanging(200, { id: "user-1" });
    await settle();
    expect(meCalls(), "the other user's token is asked about next").toEqual([TOKEN_A, rotated, other]);
    expect(screen.queryByTestId("shell"), "the shell is torn down while the other user's token is verified").toBeNull();
  });
});

// ── observation 3 ─────────────────────────────────────────────────────────

describe("FU-REQUIRE-AUTH-REMOUNT repair 2: a search-params-only navigation re-checks", () => {
  it("X1 after an in-tab token change, a navigation that changes only the search parameters verifies the new token", async () => {
    const { rerender } = await renderVerified();
    window.localStorage.setItem("kf_token", "opaque-x");
    go(rerender, "/app/crm/contacts?segment=vip");
    await settle();
    await settle();
    expect(meCalls(), "the new token is verified").toEqual([TOKEN_A, "opaque-x"]);
    expect(screen.queryByTestId("shell"), "the shell comes back once it is").not.toBeNull();
    expect(spinner()).toBeNull();
  });
});
