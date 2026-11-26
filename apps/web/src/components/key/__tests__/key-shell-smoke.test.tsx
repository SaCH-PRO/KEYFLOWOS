/**
 * SWP-KEY-SHELL-SMOKE, web half (V1-63; P1 launch, journeys A and K; D-17, D-163). The server half (P89, on main since
 * wave M25) gave GET /identity/me `keyDisabled: boolean` from the server's KEY_DISABLED. This file pins the web:
 *
 *   useKeyEnabled (hooks/use-key-enabled.ts) reads that field through apiGet. KEY is offered only once the server has
 *   answered keyDisabled: false. While the read is in flight, and when it fails, nothing of KEY renders (fail-safe: a
 *   KEY-disabled business never sees a door flash; a KEY-enabled one sees its doors a moment later). A 200 without
 *   the field, or with a value that is not a boolean, leaves KEY off (fail closed; repair round 1, SEC-M1 / COR-5).
 *
 *   KSS-W01  RED-BEFORE  the hook: keyDisabled true -> off; false -> on; field absent -> off
 *   KSS-W02  RED-BEFORE  the hook: off while /identity/me is in flight (no flash), and off when the read fails
 *   KSS-W03  RED-BEFORE  under keyDisabled the header has no "Ask KEY" button (app-header.tsx)
 *   KSS-W04  control     with KEY on the header still has its "Ask KEY" button
 *   KSS-W05  RED-BEFORE  under keyDisabled no door opens the drawer: kf:open-key (chat, onboarding, no mode) and the
 *                        legacy kf:open-copilot (the doors outside the header all send one of these)
 *   KSS-W06  control     under keyDisabled Cmd/Ctrl+K still opens the command palette (not a KEY door)
 *   KSS-W07  RED-BEFORE  under keyDisabled Ctrl+J and Cmd+J do not open the drawer (KeyAgent's own handler)
 *   KSS-W08  control     with KEY on, Ctrl+J opens the drawer
 *   KSS-W09  RED-BEFORE  under keyDisabled holding Space does not start KEY's push-to-talk ("Hold Space to speak")
 *   KSS-W10  RED-BEFORE  kept scope: for a new owner whose Genome still needs work, the drawer does not open by itself
 *                        on Today (it used to open 2 s after load); KEY on
 *   KSS-W11  RED-BEFORE  under keyDisabled the Settings index does not offer KEY (settings/page.tsx; journey K1
 *                        "Settings > KEY is not offered"); control: with KEY on it does
 *   KSS-W12  RED-BEFORE  under keyDisabled Settings > KEY (settings/ai) renders none of KEY's settings, reads none of
 *                        them, and sends the member back to the Settings index; control: with KEY on it renders
 *   KSS-W13  RED-BEFORE  kept scope: the Command Center awareness panel's read carries the session's bearer token, so
 *                        it is not refused 401 on every load (it sent no Authorization header at all)
 *   KSS-W14  RED-BEFORE  under keyDisabled the awareness panel ("From KEY's background scans") renders nothing and
 *                        reads nothing
 *   KSS-W16  RED-BEFORE  under keyDisabled no door (kf:open-key, kf:open-copilot, Ctrl/Cmd+J) even sets KEY's chat
 *                        store open or fills its input: the guards hold below the drawer, not only by hiding it
 *   KSS-W15  RED-BEFORE  under keyDisabled the drawer does not render even when KEY's chat store is opened directly
 *                        (as the Genome chip and the chat history do through openGenomeConversation, not an event)
 *   KSS-W17  guard       COR-CJ-2 (carried from FU-KEY-CTRLJ-OWNERS's review): in the app shell, with the Genome gate
 *                        deferred, Ctrl+J and Cmd+J pressed once the shell has drawn leave KEY's drawer and the
 *                        shell's chat store shut under keyDisabled, not even for a moment. It kills the mutant that
 *                        drops KeyAgent's Ctrl+J guard, with main's shortcut hook and with FU-KEY-CTRLJ-OWNERS's
 *                        (KSS-W16 kills it too). The one mutant it cannot see on main's hook is the double one, both
 *                        the Ctrl+J guard and the kf:open-key guard removed: the hook's kf:open-key and KeyAgent's
 *                        toggle then cancel out in the shell; KSS-W16, which mounts KeyAgent without the hook, kills it.
 *                        The presses made while the gate still checks cannot open anything (the layout draws only its
 *                        spinner then, app/app/layout.tsx, so KeyAgent is not mounted); they prove that nothing
 *                        pressed then is kept and acted on once the shell draws (repair round 1, COR-2 / COR-3)
 *
 * Each case uses its own session token: useKeyEnabled keeps one answer per session token, so a case never reads the
 * answer an earlier case was given.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
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
import { KeyAwarenessPanel } from "@/components/key/KeyAwarenessPanel";

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
async function resetSwitch() {
  const mod = (await import(/* @vite-ignore */ HOOK_PATH)) as { resetKeySwitchForTests?: () => void };
  mod.resetKeySwitchForTests?.();
}
function serveMe(me: MeAnswer) {
  server.me = me;
}
const keyOff = () => serveMe({ status: 200, body: { id: "usr_kss", email: "owner@kss.test", keyDisabled: true } });
const keyOn = () => serveMe({ status: 200, body: { id: "usr_kss", email: "owner@kss.test", keyDisabled: false } });

beforeEach(async () => {
  // The switch is the deployment's, kept once per tab (repair round 1, COR-1): each case starts from a tab that has
  // not read it yet.
  await resetSwitch();
  tokenSeq += 1;
  window.localStorage.setItem("kf_token", `kss-token-${tokenSeq}-${Math.random().toString(36).slice(2)}`);
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
const palette = () => screen.queryByRole("dialog", { name: "Command palette" });

async function loadHook(): Promise<() => { enabled: boolean; known: boolean }> {
  // Imported here, not at the top, so the other cases of this file still run where the hook does not exist yet.
  const mod = (await import(/* @vite-ignore */ HOOK_PATH)) as { useKeyEnabled: () => { enabled: boolean; known: boolean } };
  return mod.useKeyEnabled;
}

async function renderShell(page: ReactNode = <p>Today</p>) {
  render(
    <Providers>
      <AppLayout>{page}</AppLayout>
    </Providers>,
  );
  await waitFor(() => expect(document.querySelector("header"), "the app header renders").not.toBeNull(), { timeout: 4000 });
  // /identity/me has answered for the shell; give the KEY switch's own read the same moment.
  await settle(150);
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

async function renderAgent() {
  render(
    <Providers>
      <TtsProvider>
        <KeyChatProvider>
          <KeyAgent />
          <OpenStoreButton />
        </KeyChatProvider>
      </TtsProvider>
    </Providers>,
  );
  await settle(150);
  expect(drawer(), "KEY's drawer is shut before anything is pressed").toBeNull();
}

describe("SWP-KEY-SHELL-SMOKE: useKeyEnabled reads keyDisabled from /identity/me", () => {
  it("KSS-W01 RED-BEFORE: keyDisabled true turns KEY off; false turns it on; a 200 without the field leaves it off", async () => {
    const useKeyEnabled = await loadHook();

    keyOff();
    const off = renderHook(() => useKeyEnabled());
    await waitFor(() => expect(off.result.current.known).toBe(true));
    expect(off.result.current.enabled).toBe(false);
    off.unmount();

    await resetSwitch();
    window.localStorage.setItem("kf_token", `kss-token-on-${Math.random()}`);
    keyOn();
    const on = renderHook(() => useKeyEnabled());
    await waitFor(() => expect(on.result.current.known).toBe(true));
    expect(on.result.current.enabled).toBe(true);
    on.unmount();

    await resetSwitch();
    window.localStorage.setItem("kf_token", `kss-token-absent-${Math.random()}`);
    serveMe({ status: 200, body: { id: "usr_kss", email: "owner@kss.test" } });
    const absent = renderHook(() => useKeyEnabled());
    await waitFor(() => expect(absent.result.current.known).toBe(true));
    expect(absent.result.current.enabled, "a 200 without keyDisabled (fail closed)").toBe(false);
  });

  it("KSS-W02 RED-BEFORE: KEY is off while /identity/me is in flight, and off when the read fails", async () => {
    const useKeyEnabled = await loadHook();

    serveMe("pending");
    const pending = renderHook(() => useKeyEnabled());
    await settle(50);
    expect(pending.result.current).toEqual({ enabled: false, known: false });
    await act(async () => {
      server.releaseMe?.();
    });
    await waitFor(() => expect(pending.result.current).toEqual({ enabled: true, known: true }));
    pending.unmount();

    await resetSwitch();
    window.localStorage.setItem("kf_token", `kss-token-403-${Math.random()}`);
    serveMe({ status: 403, body: { message: "Forbidden" } });
    const refused = renderHook(() => useKeyEnabled());
    await settle(200);
    expect(refused.result.current.enabled).toBe(false);
    refused.unmount();

    await resetSwitch();
    window.localStorage.setItem("kf_token", `kss-token-net-${Math.random()}`);
    serveMe("network-error");
    const offline = renderHook(() => useKeyEnabled());
    await settle(200);
    expect(offline.result.current.enabled).toBe(false);
  });
});

describe("SWP-KEY-SHELL-SMOKE: no KEY door in the shell under keyDisabled", { timeout: 15_000 }, () => {
  it("KSS-W03 RED-BEFORE: under keyDisabled the header has no Ask KEY button", async () => {
    keyOff();
    await renderShell();
    expect(askKey(), "the header's Ask KEY button under keyDisabled").toBeNull();
  });

  it("KSS-W04 control: with KEY on the header has its Ask KEY button", async () => {
    keyOn();
    await renderShell();
    await waitFor(() => expect(askKey(), "the header's Ask KEY button").not.toBeNull());
  });

  it("KSS-W05 RED-BEFORE: under keyDisabled kf:open-key (chat, onboarding, no mode) and kf:open-copilot open nothing", async () => {
    keyOff();
    await renderShell();
    const doors: Array<[string, Event]> = [
      ["kf:open-key chat", new CustomEvent("kf:open-key", { detail: { mode: "chat" } })],
      ["kf:open-key onboarding", new CustomEvent("kf:open-key", { detail: { mode: "onboarding" } })],
      ["kf:open-key without a mode", new CustomEvent("kf:open-key", { detail: { prompt: "hello" } })],
      ["kf:open-copilot", new CustomEvent("kf:open-copilot", { detail: { prompt: "hello" } })],
    ];
    const opened: string[] = [];
    for (const [name, event] of doors) {
      act(() => {
        window.dispatchEvent(event);
      });
      await settle(150);
      if (drawer()) {
        opened.push(name);
        fireEvent.keyDown(window, { key: "Escape" });
        await settle(50);
      }
    }
    expect(opened, "doors that opened KEY's drawer under keyDisabled").toEqual([]);
  });

  it("KSS-W06 control: under keyDisabled Cmd/Ctrl+K still opens the command palette", async () => {
    keyOff();
    await renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(palette(), "the command palette").not.toBeNull(), { timeout: 2000 });
    expect(drawer()).toBeNull();
  });
});

describe("SWP-KEY-SHELL-SMOKE: Ctrl+J in the app shell under keyDisabled (COR-CJ-2)", { timeout: 15_000 }, () => {
  it("KSS-W17 guard: with the Genome gate deferred, Ctrl+J and Cmd+J never open KEY's drawer in the app shell", async () => {
    keyOff();
    genomeGate.answerAfterMs = 600;
    // Any moment the drawer is in the page counts, not only where it is after the keypress has settled.
    const seen: string[] = [];
    let phase = "first render";
    const look = () => {
      if (drawer()) seen.push(`${phase}: drawer`);
      const store = screen.queryByTestId("chat-store")?.textContent;
      if (store && store !== "open=false input=") seen.push(`${phase}: chat store ${store}`);
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      render(
        <Providers>
          <AppLayout>
            {/* The page sits inside the shell's KeyChatProvider, so the probe reads the shell's own chat store. */}
            <OpenStoreButton />
          </AppLayout>
        </Providers>,
      );
      await screen.findByText(/checking your business genome/i, {}, { timeout: 4000 });
      expect(document.querySelector("header"), "the shell waits on the Genome gate").toBeNull();
      phase = "Ctrl+J while the Genome gate checks";
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      phase = "Cmd+J while the Genome gate checks";
      fireEvent.keyDown(window, { key: "j", metaKey: true });
      phase = "the gate answers";
      await waitFor(() => expect(document.querySelector("header"), "the app header renders").not.toBeNull(), { timeout: 4000 });
      await settle(150);
      for (const [name, mods] of [["Ctrl+J", { ctrlKey: true }], ["Cmd+J", { metaKey: true }]] as const) {
        for (const press of [1, 2]) {
          phase = `${name} in the shell (press ${press})`;
          fireEvent.keyDown(window, { key: "j", ...mods });
          await settle(150);
          look();
        }
      }
    } finally {
      observer.disconnect();
    }
    expect(screen.getByTestId("chat-store").textContent, "the shell's chat store is read").toBe("open=false input=");
    expect([...new Set(seen)], "moments KEY's drawer or chat store opened in the app shell under keyDisabled").toEqual([]);
    expect(askKey(), "the header's Ask KEY button under keyDisabled").toBeNull();
  });
});

describe("SWP-KEY-SHELL-SMOKE: KeyAgent's own keys under keyDisabled", { timeout: 15_000 }, () => {
  it("KSS-W07 RED-BEFORE: under keyDisabled Ctrl+J and Cmd+J do not open KEY's drawer", async () => {
    keyOff();
    await renderAgent();
    const opened: string[] = [];
    for (const [name, mods] of [["Ctrl+J", { ctrlKey: true }], ["Cmd+J", { metaKey: true }]] as const) {
      fireEvent.keyDown(window, { key: "j", ...mods });
      await settle(150);
      if (drawer()) {
        opened.push(name);
        fireEvent.keyDown(window, { key: "Escape" });
        await settle(50);
      }
    }
    expect(opened, "shortcuts that opened KEY's drawer under keyDisabled").toEqual([]);
  });

  it("KSS-W08 control: with KEY on, Ctrl+J opens KEY's drawer", async () => {
    keyOn();
    await renderAgent();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(drawer(), "KEY's drawer").not.toBeNull(), { timeout: 2000 });
  });

  it("KSS-W09 RED-BEFORE: under keyDisabled holding Space does not start KEY's push-to-talk", async () => {
    keyOff();
    await renderAgent();
    fireEvent.keyDown(window, { key: " " });
    await settle(100);
    const overlay = screen.queryByText(/hold space to speak|listening\.\.\./i);
    fireEvent.keyUp(window, { key: " " });
    expect(overlay, "KEY's push-to-talk overlay under keyDisabled").toBeNull();
  });

  it("KSS-W15 RED-BEFORE: under keyDisabled the drawer does not render when the chat store is opened directly", async () => {
    keyOff();
    await renderAgent();
    fireEvent.click(screen.getByRole("button", { name: "open the chat store" }));
    await settle(200);
    expect(drawer(), "KEY's drawer under keyDisabled").toBeNull();
  });

  it("KSS-W16 RED-BEFORE: under keyDisabled no door sets KEY's chat store open or fills its input", async () => {
    keyOff();
    await renderAgent();
    const store = () => screen.getByTestId("chat-store").textContent;
    expect(store()).toBe("open=false input=");
    const doors: Array<[string, () => void]> = [
      ["kf:open-key chat", () => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat", prompt: "p1" } }))],
      ["kf:open-key onboarding", () => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "onboarding" } }))],
      ["kf:open-copilot", () => window.dispatchEvent(new CustomEvent("kf:open-copilot", { detail: { prompt: "p2" } }))],
      ["Ctrl+J", () => fireEvent.keyDown(window, { key: "j", ctrlKey: true })],
      ["Cmd+J", () => fireEvent.keyDown(window, { key: "j", metaKey: true })],
    ];
    const moved: string[] = [];
    for (const [name, press] of doors) {
      act(() => press());
      await settle(100);
      if (store() !== "open=false input=") moved.push(`${name}: ${store()}`);
    }
    expect(moved, "doors that moved KEY's chat store under keyDisabled").toEqual([]);
  });

  it("KSS-W10 RED-BEFORE: for a new owner whose Genome needs work, the drawer does not open by itself on Today", async () => {
    keyOn();
    server.onboardingNeedsGenome = true;
    nav.pathname = "/app/command-center";
    window.history.pushState({}, "", "/app/command-center");
    await renderAgent();
    // It used to open 2 s after load (the once-per-session Genome nudge).
    await settle(2600);
    expect(drawer(), "KEY's drawer opened by itself").toBeNull();
    expect(window.sessionStorage.getItem("kf:genome-auto-prompt")).toBeNull();
  });
});

describe("SWP-KEY-SHELL-SMOKE: Settings > KEY under keyDisabled", { timeout: 15_000 }, () => {
  async function renderSettingsIndex() {
    nav.pathname = "/app/settings";
    const { default: Page } = await import("@/app/app/settings/page");
    render(<Page />);
    await settle(200);
  }
  const keyEntry = () => screen.queryByRole("link", { name: /^KEY\b/ });

  it("KSS-W11 RED-BEFORE: under keyDisabled the Settings index does not offer KEY", async () => {
    keyOff();
    await renderSettingsIndex();
    expect(screen.getByRole("link", { name: /my account/i }), "the index renders").toBeTruthy();
    expect(keyEntry(), "Settings offers KEY under keyDisabled").toBeNull();
  });

  it("KSS-W11 control: with KEY on the Settings index offers KEY", async () => {
    keyOn();
    await renderSettingsIndex();
    await waitFor(() => expect(keyEntry(), "Settings offers KEY").not.toBeNull());
    expect(keyEntry()?.getAttribute("href")).toBe("/app/settings/ai");
  });

  async function renderAiSettings() {
    nav.pathname = "/app/settings/ai";
    const { default: Page } = await import("@/app/app/settings/ai/page");
    render(<Page />);
    await settle(250);
  }

  it("KSS-W12 RED-BEFORE: under keyDisabled Settings > KEY renders and reads none of KEY's settings, and goes back to Settings", async () => {
    keyOff();
    await renderAiSettings();
    expect(screen.queryByRole("heading", { name: /ai settings/i }), "KEY's settings render under keyDisabled").toBeNull();
    expect(server.aiSettingsCalls, "KEY's settings are read under keyDisabled").toBe(0);
    expect(nav.router.replace).toHaveBeenCalledWith("/app/settings");
  });

  it("KSS-W12 control: with KEY on Settings > KEY renders", async () => {
    keyOn();
    await renderAiSettings();
    await waitFor(() => expect(screen.queryByRole("heading", { name: /ai settings/i })).not.toBeNull());
    expect(nav.router.replace).not.toHaveBeenCalledWith("/app/settings");
  });
});

describe("SWP-KEY-SHELL-SMOKE: the Command Center awareness panel", { timeout: 15_000 }, () => {
  it("KSS-W13 RED-BEFORE: its read carries the session's bearer token and is not refused 401", async () => {
    keyOn();
    const token = window.localStorage.getItem("kf_token");
    render(<KeyAwarenessPanel businessId={BIZ} />);
    await waitFor(() => expect(server.awarenessCalls.length).toBeGreaterThan(0), { timeout: 3000 });
    await settle(100);
    expect(server.awarenessCalls[0].authorization, "the awareness read's Authorization header").toBe(`Bearer ${token}`);
    expect(screen.queryByText(/HTTP 401/), "the panel shows a 401").toBeNull();
  });

  it("KSS-W14 RED-BEFORE: under keyDisabled it renders nothing and reads nothing", async () => {
    keyOff();
    const { container } = render(<KeyAwarenessPanel businessId={BIZ} />);
    await settle(300);
    expect(server.awarenessCalls, "awareness reads under keyDisabled").toEqual([]);
    expect(container.textContent ?? "", "the panel under keyDisabled").not.toMatch(/background scans|signals/i);
  });
});
