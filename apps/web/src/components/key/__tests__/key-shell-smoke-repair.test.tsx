/**
 * SWP-KEY-SHELL-SMOKE, repair round 1 (the orchestrator's two reviews of 86eebc29). Same harness as
 * key-shell-smoke.test.tsx (a real shell, fetch answered in the test, the Genome gate deferred).
 *
 *   KSR-01  RED-BEFORE  COR-1 MAJOR: KEY stays on across an access-token refresh. With KEY on and the drawer open,
 *                       refreshAccessToken() writes a new kf_token; one re-render later the drawer is still open,
 *                       Ctrl+J still toggles it and the header still has Ask KEY (they all vanished: the answer was
 *                       kept per token and only a mount read it again)
 *   KSR-02  RED-BEFORE  SEC-M2: a sign-in that changes the token without a remount reads the switch again: KEY,
 *                       off after the signed-out read was refused, comes on once the server says so
 *   KSR-03  RED-BEFORE  SEC-M1 / COR-5: fail closed. KEY is on only for an explicit `keyDisabled: false`; a 200
 *                       without the field, or with a value that is not a boolean, leaves KEY off (the server always
 *                       sends a boolean: identity.controller.ts getMe, keyDisabled(): boolean)
 *   KSR-04  RED-BEFORE  COR-4: when the /identity/me read fails, Settings > KEY says so and offers Try again (it sat
 *                       on its skeleton for ever); KEY's settings are not read meanwhile; Try again reads the switch
 *                       and, once the server answers KEY on, Settings > KEY renders
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { render, renderHook, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/app/command-center",
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

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// The Genome gate answers a moment after the first render, as its real read does (as key-ctrlj-owner.test.tsx).
// KSS-W17 holds it longer so keys can be pressed while it is still checking.
const genomeGate = vi.hoisted(() => ({ answerAfterMs: 20 }));
vi.mock("@/hooks/use-genome-gate", async () => {
  const React = await import("react");
  return {
    useGenomeGate: () => {
      const [checking, setChecking] = React.useState(true);
      React.useEffect(() => {
        const t = setTimeout(() => setChecking(false), genomeGate.answerAfterMs);
        return () => clearTimeout(t);
      }, []);
      return { checking, gateActive: false, threePillarMet: true, genomeIntegrity: 100, genesisCompleted: true };
    },
  };
});

import AppLayout from "@/app/app/layout";
import { Providers } from "@/components/providers";
import { TtsProvider } from "@/components/tts";
import { KeyChatProvider, useKeyChat } from "@/components/key/chat";
import { KeyAgent } from "@/components/key/key-agent";

const BIZ = "biz_kss";
const HOOK_PATH = "@/hooks/use-key-enabled";

type MeAnswer = { status: number; body?: unknown } | "pending" | "network-error";

const server = {
  me: { status: 200, body: { id: "usr_kss", email: "owner@kss.test", keyDisabled: false } } as MeAnswer,
  /** The awareness read refuses a request without a bearer token, as the API's AuthGuard does. */
  awarenessCalls: [] as Array<{ url: string; authorization: string | null }>,
  aiSettingsCalls: 0,
  onboardingNeedsGenome: false,
  releaseMe: null as null | (() => void),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function headerOf(init: RequestInit | undefined, input: RequestInfo | URL, name: string): string | null {
  const fromInit = init?.headers ? new Headers(init.headers).get(name) : null;
  if (fromInit) return fromInit;
  return input instanceof Request ? input.headers.get(name) : null;
}

async function answer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const { pathname: p } = new URL(url, "http://api.test.local");
  if (p === "/identity/me") {
    const me = server.me;
    if (me === "network-error") throw new TypeError("Failed to fetch");
    if (me === "pending") {
      await new Promise<void>((resolve) => {
        server.releaseMe = resolve;
      });
      return json(200, { id: "usr_kss", email: "owner@kss.test", keyDisabled: false });
    }
    return json(me.status, me.body ?? {});
  }
  if (p.endsWith("/cortex/awareness")) {
    const authorization = headerOf(init, input, "Authorization");
    server.awarenessCalls.push({ url, authorization });
    if (!authorization) return json(401, { message: "Unauthorized" });
    return json(200, { items: [], counts: {}, latestAt: null });
  }
  if (p.includes("/onboarding-state")) {
    return json(200, server.onboardingNeedsGenome
      ? { onboardingComplete: false, threePillarMet: false }
      : { onboardingComplete: true, threePillarMet: true });
  }
  if (p.includes("/ai/settings/")) {
    server.aiSettingsCalls += 1;
    if (p.endsWith("/workload-config")) return json(200, { capacityHours: 40, skills: [], authorityGrants: [] });
    return json(200, []);
  }
  if (p.endsWith("/my-access")) return json(200, { role: "OWNER", modules: {} });
  if (/\/(sessions|notifications|needs-attention|items|list)(\/|$)/.test(p) || p.endsWith("/flow/sessions")) return json(200, []);
  return json(200, {});
}

let tokenSeq = 0;
function serveMe(me: MeAnswer) {
  server.me = me;
}
const keyOn = () => serveMe({ status: 200, body: { id: "usr_kss", email: "owner@kss.test", keyDisabled: false } });

beforeEach(async () => {
  // The switch is the deployment's, kept once per tab: each case starts from a tab that has not read it yet.
  ((await import(/* @vite-ignore */ HOOK_PATH)) as { resetKeySwitchForTests?: () => void }).resetKeySwitchForTests?.();
  tokenSeq += 1;
  window.localStorage.setItem("kf_token", `kssr-token-${tokenSeq}-${Math.random().toString(36).slice(2)}`);
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  nav.pathname = "/app/command-center";
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
  server.awarenessCalls = [];
  server.aiSettingsCalls = 0;
  server.onboardingNeedsGenome = false;
  server.releaseMe = null;
  genomeGate.answerAfterMs = 20;
  keyOn();
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => answer(input, init));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  server.releaseMe?.();
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const settle = (ms = 100) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** KEY's chat drawer (KeyChatPanel), found as journey K's keyUiFindings finds it: by its heading. */
const drawer = () => screen.queryByRole("heading", { name: /^KEY$/ });
const askKey = () => screen.queryByRole("button", { name: /ask key/i });

async function loadHook(): Promise<() => { enabled: boolean; known: boolean }> {
  // Imported here, not at the top, so the other cases of this file still run where the hook does not exist yet.
  const mod = (await import(/* @vite-ignore */ HOOK_PATH)) as { useKeyEnabled: () => { enabled: boolean; known: boolean } };
  return mod.useKeyEnabled;
}

/** Opens KEY's chat store directly, as openGenomeConversation does (no kf:open-key event). */
function OpenStoreButton() {
  const { setOpen, open, input } = useKeyChat();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open the chat store
      </button>
      <output data-testid="chat-store">{`open=${String(open)} input=${String(input ?? "")}`}</output>
    </>
  );
}

/** A JWT-shaped access token for one user: RequireAuth keeps the shell across a refresh that keeps the user (sub). */
function userToken(sub = "usr_kss"): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, n: Math.random() })}.sig`;
}
const rotateToken = () => window.localStorage.setItem("kf_token", userToken());

/**
 * Draws the tree itself, so its "re-render" button re-renders every component in it (the shell's own state changes
 * do the same), without remounting anything.
 */
function Rerendering({ tree }: { tree: (button: ReactNode) => ReactNode }) {
  const [n, setN] = useState(0);
  return (
    <>
      {tree(
        <button type="button" onClick={() => setN((x) => x + 1)}>
          {`re-render ${n}`}
        </button>,
      )}
    </>
  );
}

async function rerenderEverything() {
  const before = screen.getByRole("button", { name: /^re-render/ }).textContent;
  fireEvent.click(screen.getByRole("button", { name: /^re-render/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: /^re-render/ }).textContent).not.toBe(before));
  await settle(150);
}

describe("SWP-KEY-SHELL-SMOKE repair: KEY stays on across a token refresh (COR-1)", { timeout: 15_000 }, () => {
  it("KSR-01 RED-BEFORE: with the drawer open, a refreshed kf_token and a re-render leave the drawer open and Ctrl+J working", async () => {
    keyOn();
    render(
      <Rerendering
        tree={(button) => (
          <Providers>
            <TtsProvider>
              <KeyChatProvider>
                <KeyAgent />
                <OpenStoreButton />
                {button}
              </KeyChatProvider>
            </TtsProvider>
          </Providers>
        )}
      />,
    );
    await settle(150);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(drawer(), "Ctrl+J opens KEY's drawer").not.toBeNull(), { timeout: 2000 });

    // refreshAccessToken() (lib/workspace.ts) stores the new token; any re-read it causes may take its time.
    rotateToken();
    serveMe("pending");
    await rerenderEverything();
    expect(drawer(), "KEY's drawer after a token refresh").not.toBeNull();

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(drawer(), "Ctrl+J closes the drawer after the refresh").toBeNull(), { timeout: 2000 });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(drawer(), "Ctrl+J opens the drawer after the refresh").not.toBeNull(), { timeout: 2000 });
  });

  it("KSR-01 RED-BEFORE: in the app shell, the header keeps Ask KEY after a refreshed kf_token and a re-render", async () => {
    window.localStorage.setItem("kf_token", userToken());
    keyOn();
    render(
      <Rerendering
        tree={(button) => (
          <Providers>
            <AppLayout>{button}</AppLayout>
          </Providers>
        )}
      />,
    );
    await waitFor(() => expect(askKey(), "the header's Ask KEY").not.toBeNull(), { timeout: 4000 });
    rotateToken();
    serveMe("pending");
    await rerenderEverything();
    expect(askKey(), "the header's Ask KEY after a token refresh").not.toBeNull();
  });
});

describe("SWP-KEY-SHELL-SMOKE repair: a sign-in without a remount reads the switch again (SEC-M2)", { timeout: 15_000 }, () => {
  it("KSR-02 RED-BEFORE: KEY, off after a refused read, comes on once a new token's read says KEY is on", async () => {
    const useKeyEnabled = await loadHook();
    window.localStorage.removeItem("kf_token");
    serveMe({ status: 401, body: { message: "Unauthorized" } });
    const hook = renderHook(() => useKeyEnabled());
    await settle(200);
    expect(hook.result.current.enabled, "KEY while signed out").toBe(false);

    window.localStorage.setItem("kf_token", `kssr-signed-in-${Math.random().toString(36).slice(2)}`);
    keyOn();
    hook.rerender();
    await waitFor(() => expect(hook.result.current.enabled, "KEY after signing in").toBe(true), { timeout: 2000 });
  });
});

describe("SWP-KEY-SHELL-SMOKE repair: the switch fails closed (SEC-M1, COR-5)", () => {
  it("KSR-03 RED-BEFORE: only keyDisabled: false turns KEY on; a missing or non-boolean field leaves it off", async () => {
    const useKeyEnabled = await loadHook();
    const mod = (await import(/* @vite-ignore */ HOOK_PATH)) as { resetKeySwitchForTests?: () => void };
    const answers: Array<[string, Record<string, unknown>, boolean]> = [
      ["keyDisabled: false", { id: "usr_kss", keyDisabled: false }, true],
      ["no keyDisabled field", { id: "usr_kss" }, false],
      ["keyDisabled: \"false\"", { id: "usr_kss", keyDisabled: "false" }, false],
      ["keyDisabled: null", { id: "usr_kss", keyDisabled: null }, false],
      ["keyDisabled: 0", { id: "usr_kss", keyDisabled: 0 }, false],
      ["keyDisabled: true", { id: "usr_kss", keyDisabled: true }, false],
    ];
    const wrong: string[] = [];
    for (const [name, body, expected] of answers) {
      mod.resetKeySwitchForTests?.();
      window.localStorage.setItem("kf_token", `kssr-shape-${Math.random().toString(36).slice(2)}`);
      serveMe({ status: 200, body });
      const hook = renderHook(() => useKeyEnabled());
      await waitFor(() => expect(hook.result.current.known, `${name}: the server answered`).toBe(true));
      if (hook.result.current.enabled !== expected) wrong.push(`${name}: KEY ${hook.result.current.enabled ? "on" : "off"}`);
      hook.unmount();
    }
    expect(wrong, "answers that set KEY the wrong way").toEqual([]);
  });
});

describe("SWP-KEY-SHELL-SMOKE repair: Settings > KEY when the switch cannot be read (COR-4)", { timeout: 15_000 }, () => {
  it("KSR-04 RED-BEFORE: a failed read shows an error with Try again, reads none of KEY's settings, and Try again recovers", async () => {
    // Refused (lib/fetch-with-retry retries a plain 503 for some seconds before it gives up; a 403 is final at once).
    serveMe({ status: 403, body: { message: "Forbidden" } });
    nav.pathname = "/app/settings/ai";
    const { default: Page } = await import("@/app/app/settings/ai/page");
    render(<Page />);
    const retry = await screen.findByRole("button", { name: /try again/i }, { timeout: 2000 });
    expect(screen.getByRole("alert").textContent ?? "", "the error names what failed").toMatch(/KEY/);
    expect(screen.queryByRole("heading", { name: /ai settings/i }), "KEY's settings while the switch is unknown").toBeNull();
    expect(server.aiSettingsCalls, "KEY's settings are read while the switch is unknown").toBe(0);
    expect(nav.router.replace, "an unknown switch is not KEY off").not.toHaveBeenCalled();

    keyOn();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("heading", { name: /ai settings/i }), "Settings > KEY after Try again").not.toBeNull(), { timeout: 3000 });
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

/**
 * Repair round 2 (tests only): /identity/me reads the test holds open and answers when it chooses, so a case can act
 * while a read is in flight.
 *   KSR-05  COR-R1: a signed-out tab's read is in flight when the member signs in; once it is refused, the switch is
 *           read again for the new token and KEY comes on (use-key-enabled.ts: the re-read in the read's finally)
 *   KSR-06  COR-R2: Settings > KEY's Try again takes the error and its button away while the retry is in flight
 *           (use-key-enabled.ts: the notify when a failed state is cleared)
 */
function holdIdentityMe() {
  const held: Array<(r: Response) => void> = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation();
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, "http://api.test.local").pathname === "/identity/me") {
      return new Promise<Response>((resolve) => held.push(resolve));
    }
    return original ? original(input, init) : Promise.resolve(json(200, {}));
  });
  return {
    get waiting() {
      return held.length;
    },
    /** Answers the oldest read still held. */
    answerNext(status: number, body: unknown) {
      const resolve = held.shift();
      if (!resolve) throw new Error("no /identity/me read is held");
      resolve(json(status, body));
    },
  };
}

describe("SWP-KEY-SHELL-SMOKE repair 2: reads in flight (COR-R1, COR-R2)", { timeout: 15_000 }, () => {
  it("KSR-05: a sign-in while the signed-out read is out turns KEY on once that read is refused", async () => {
    const useKeyEnabled = await loadHook();
    window.localStorage.removeItem("kf_token");
    const me = holdIdentityMe();
    const hook = renderHook(() => useKeyEnabled());
    await waitFor(() => expect(me.waiting, "the signed-out read is out").toBe(1));

    window.localStorage.setItem("kf_token", `kssr-signed-in-${Math.random().toString(36).slice(2)}`);
    hook.rerender();
    await settle(50);
    expect(me.waiting, "no second read while the first is out").toBe(1);

    await act(async () => {
      me.answerNext(401, { message: "Unauthorized" });
    });
    await waitFor(() => expect(me.waiting, "the switch is read again for the signed-in token").toBe(1), { timeout: 2000 });
    await act(async () => {
      me.answerNext(200, { id: "usr_kss", keyDisabled: false });
    });
    await waitFor(() => expect(hook.result.current.enabled, "KEY after signing in").toBe(true), { timeout: 2000 });
  });

  it("KSR-06: Try again takes Settings > KEY's error and its button away while the retry is in flight", async () => {
    serveMe({ status: 403, body: { message: "Forbidden" } });
    nav.pathname = "/app/settings/ai";
    const { default: Page } = await import("@/app/app/settings/ai/page");
    render(<Page />);
    const retry = await screen.findByRole("button", { name: /try again/i }, { timeout: 2000 });

    const me = holdIdentityMe();
    fireEvent.click(retry);
    await waitFor(() => expect(me.waiting, "Try again reads the switch").toBe(1));
    await settle(50);
    expect(screen.queryByRole("alert"), "the error while the retry is out").toBeNull();
    expect(screen.queryByRole("button", { name: /try again/i }), "Try again while the retry is out").toBeNull();

    await act(async () => {
      me.answerNext(200, { id: "usr_kss", keyDisabled: false });
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: /ai settings/i })).not.toBeNull(), { timeout: 3000 });
  });
});
