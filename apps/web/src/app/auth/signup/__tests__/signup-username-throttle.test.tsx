/**
 * V1-56-AUTH-USERNAME-THROTTLE — the server throttles GET
 * /identity/check-username, and that throttle must never fire on a person
 * using the signup form.
 *
 * Why it could: the form checks the username once per keystroke after the
 * hook's debounce (use-username-availability.ts) and once more on submit
 * (signup/page.tsx onSubmit). The client turns any non-2xx answer, a 429
 * included, into 'unknown', and 'unknown' blocks signup: step 1 cannot
 * continue, and on submit the form stops with "Unable to verify username"
 * before it ever calls POST /identity/signup. A limit the form can reach is a
 * signup outage, not a throttle.
 *
 * So the server's rule is read here from identity.controller.ts (this file does
 * not import server code: the controller pulls in Nest), and the REAL page, hook
 * and client run in jsdom against a fetch double that refuses with 429 exactly
 * the way AuthSecurityService.enforce does — count this address's accepted hits
 * at or after now - windowMs, refuse when that count has reached the limit,
 * record a hit only when accepted. The server half (200 up to the limit, 429
 * above it, per IP, sliding) is apps/server/test/identity-signup.e2e.test.ts.
 *
 *   1. A 30-character username typed at human speed, then submit: no 429 and
 *      signup proceeds. "Human speed" is the worst a human does to this limit:
 *      350 ms a keystroke, slower than the debounce, so every keystroke checks.
 *   2. The form's ceiling: typing without pause at one millisecond over the
 *      debounce for longer than a whole window, then submit. That is the most
 *      checks the form can send per window, and it stays under the limit.
 *   3. Control: the same journey as (1) against a limit sized to the keystrokes
 *      alone is refused at submit with "Unable to verify username" and never
 *      reaches POST /identity/signup. It shows what this harness detects, and
 *      why the limit has to sit above the submit check as well.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import fs from "node:fs";
import { join } from "node:path";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/auth/signup",
  useSearchParams: () => nav.searchParams,
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import AuthSignup from "../page";

// ---------------------------------------------------------------------------
// The two numbers this test is about, read from the code that owns them
// ---------------------------------------------------------------------------

/** apps/web/src, from this directory (src/app/auth/signup/__tests__). */
const WEB_SRC = join(__dirname, "..", "..", "..", "..");
const CONTROLLER = join(WEB_SRC, "..", "..", "server", "src", "modules", "identity", "identity.controller.ts");
const HOOK = join(WEB_SRC, "hooks", "use-username-availability.ts");

interface Rule {
  limit: number;
  windowMs: number;
}

/** USERNAME_CHECK_RULE as identity.controller.ts declares it. */
function serverRule(): Rule {
  const src = fs.readFileSync(CONTROLLER, "utf8");
  const block = src.match(/export const USERNAME_CHECK_RULE\s*=\s*\{([^}]*)\}/);
  if (!block) {
    throw new Error("identity.controller.ts declares no USERNAME_CHECK_RULE: GET /identity/check-username has no throttle");
  }
  const num = (key: string) => {
    const m = block[1].match(new RegExp(`${key}:\\s*([\\d_]+)`));
    if (!m) throw new Error(`USERNAME_CHECK_RULE has no numeric ${key}`);
    return Number(m[1].replace(/_/g, ""));
  };
  return { limit: num("limit"), windowMs: num("windowMs") };
}

/** The hook's default debounce, which is the one signup/page.tsx uses. */
function formDebounceMs(): number {
  const m = fs.readFileSync(HOOK, "utf8").match(/debounceMs\s*=\s*(\d+)/);
  if (!m) throw new Error("use-username-availability.ts has no default debounceMs");
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// The server, at the network edge
// ---------------------------------------------------------------------------

interface Check {
  at: number;
  username: string;
  status: number;
}

let fetchSpy: MockInstance<typeof fetch>;

/**
 * Answers the two routes the form calls. check-username is throttled as
 * AuthSecurityService.enforce throttles it (one client address: the test).
 */
function serve(rule: Rule) {
  const accepted: number[] = [];
  const checks: Check[] = [];
  const signups: unknown[] = [];
  fetchSpy.mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/identity/check-username" && (init?.method ?? "GET") === "GET") {
      const now = Date.now();
      const inWindow = accepted.filter((t) => t >= now - rule.windowMs).length;
      const username = url.searchParams.get("username") ?? "";
      if (inWindow >= rule.limit) {
        checks.push({ at: now, username, status: 429 });
        return new Response(
          JSON.stringify({ code: "rate_limited", message: "Too many attempts. Please wait a few minutes and try again." }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        );
      }
      accepted.push(now);
      checks.push({ at: now, username, status: 200 });
      return new Response(JSON.stringify({ available: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/identity/signup" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      signups.push(body);
      return new Response(
        JSON.stringify({ status: "verification_sent", userId: "u-v1-56", email: body.email, verificationRequired: true }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected request in the signup journey: ${init?.method ?? "GET"} ${url.pathname}`);
  });
  return { checks, signups };
}

/**
 * The most checks any window holds, counted as the server counts: at time t,
 * every hit at or after t - windowMs (both ends included).
 */
function maxInAnyWindow(checks: Check[], windowMs: number): number {
  let max = 0;
  for (const c of checks) {
    const n = checks.filter((o) => o.at >= c.at && o.at <= c.at + windowMs).length;
    if (n > max) max = n;
  }
  return max;
}

// ---------------------------------------------------------------------------
// A person at the form
// ---------------------------------------------------------------------------

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function setValue(el: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
}

/** Step 1 names, then `keystrokes` into the username field `msPerKey` apart. */
async function fillStepOne(keystrokes: string[], msPerKey: number) {
  await setValue(screen.getByPlaceholderText("John"), "Ada");
  await setValue(screen.getByPlaceholderText("Doe"), "Lovelace");
  const field = screen.getByPlaceholderText("johndoe");
  for (const value of keystrokes) {
    await setValue(field, value);
    await elapse(msPerKey);
  }
  // Let the last keystroke's debounced check fire and answer.
  await elapse(1_000);
}

/** Continue to step 2, credentials, Create account; lets the submit settle. */
async function continueAndSubmit() {
  const proceed = screen.getByRole("button", { name: /continue/i });
  expect(proceed).not.toBeDisabled();
  await act(async () => {
    fireEvent.click(proceed);
  });
  await setValue(screen.getByPlaceholderText("you@example.com"), "ada@example.com");
  await setValue(screen.getByPlaceholderText("Create a strong password"), "AnalyticalEngine1843");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
  });
  await elapse(1_000);
}

/** Every prefix of `name` — what the field holds after each keystroke. */
function prefixes(name: string): string[] {
  return Array.from({ length: name.length }, (_, i) => name.slice(0, i + 1));
}

const THIRTY = "ada.lovelace_analytical-engine";

/**
 * Every keystroke is a render under act(); the ceiling case types some 230 of
 * them and takes about four seconds alone, past vitest's 5 s default on a busy
 * machine. A case that times out keeps running after its afterEach, so the
 * budget is set well clear of it.
 */
const JOURNEY_TIMEOUT_MS = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T09:00:00.000Z"));
  fetchSpy = vi.spyOn(globalThis, "fetch");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("signup under the check-username throttle (V1-56)", () => {
  it("the form's assumptions hold: 300 ms debounce, a 30-character username", () => {
    expect(formDebounceMs()).toBe(300);
    expect(THIRTY).toHaveLength(30);
  });

  it("a 30-character username typed at human speed, then submit: no 429, signup proceeds", async () => {
    const rule = serverRule();
    const server = serve(rule);
    render(<AuthSignup />);

    await fillStepOne(prefixes(THIRTY), 350);
    // One check per keystroke from the second (one character is below the
    // format minimum and is never sent): 29, none refused.
    expect(server.checks).toHaveLength(29);
    expect(server.checks.filter((c) => c.status !== 200)).toEqual([]);

    await continueAndSubmit();

    // Plus one on submit, all answered.
    expect(server.checks).toHaveLength(30);
    expect(server.checks.filter((c) => c.status !== 200)).toEqual([]);
    expect(server.checks.at(-1)?.username).toBe(THIRTY);
    expect(maxInAnyWindow(server.checks, rule.windowMs)).toBeLessThanOrEqual(rule.limit);

    // Signup proceeded: one POST /identity/signup, and the verification screen.
    expect(server.signups).toHaveLength(1);
    expect(server.signups[0]).toMatchObject({ username: THIRTY, email: "ada@example.com" });
    expect(screen.getByText("Check your inbox")).toBeInTheDocument();
    expect(screen.queryByText(/unable to verify username/i)).not.toBeInTheDocument();
  }, JOURNEY_TIMEOUT_MS);

  it("typing without pause at the debounce for longer than a whole window never reaches the limit", async () => {
    const rule = serverRule();
    const debounce = formDebounceMs();
    const server = serve(rule);
    render(<AuthSignup />);

    // Every keystroke one millisecond after the previous one's debounce fires,
    // so each one is checked: the most the field can send. Grow to 30
    // characters, cut back to 2, repeat, for a window and a further ten seconds.
    const ramp = prefixes(THIRTY).slice(1);
    const cycle = [...ramp, ...ramp.slice(1, -1).reverse()];
    const keystrokes: string[] = [];
    const total = Math.ceil((rule.windowMs + 10_000) / (debounce + 1));
    for (let i = 0; i < total; i++) keystrokes.push(cycle[i % cycle.length]);
    await fillStepOne(keystrokes, debounce + 1);

    expect(server.checks).toHaveLength(keystrokes.length);
    expect(server.checks.filter((c) => c.status !== 200)).toEqual([]);
    await continueAndSubmit();

    const busiest = maxInAnyWindow(server.checks, rule.windowMs);
    // The case did reach the form's ceiling: a full window of debounced checks.
    expect(busiest).toBeGreaterThanOrEqual(Math.floor(rule.windowMs / (debounce + 1)));
    expect(busiest).toBeLessThanOrEqual(rule.limit);
    expect(server.checks.filter((c) => c.status !== 200)).toEqual([]);
    expect(server.signups).toHaveLength(1);
    expect(screen.getByText("Check your inbox")).toBeInTheDocument();
  }, JOURNEY_TIMEOUT_MS);

  it("control: a limit sized to the keystrokes alone refuses the submit check and blocks signup", async () => {
    const server = serve({ limit: 29, windowMs: 60_000 });
    render(<AuthSignup />);

    await fillStepOne(prefixes(THIRTY), 350);
    expect(server.checks.filter((c) => c.status === 200)).toHaveLength(29);

    await continueAndSubmit();

    expect(server.checks.at(-1)?.status).toBe(429);
    expect(screen.getByText(/unable to verify username/i)).toBeInTheDocument();
    expect(server.signups).toHaveLength(0);
    expect(screen.queryByText("Check your inbox")).not.toBeInTheDocument();
  }, JOURNEY_TIMEOUT_MS);
});
