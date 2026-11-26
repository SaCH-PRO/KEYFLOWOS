/**
 * FU-KEY-CTRLJ-OWNERS (journey K, "Cmd/Ctrl+J opens KEY"; found by FU-C4-CMDK-SEARCH's acceptance review MINOR-4):
 * Cmd/Ctrl+J, KEY's drawer, has one owner.
 *
 * The cause, on main 6f67c91e: Cmd/Ctrl+J had the two owners Cmd/Ctrl+K had before FU-C4-CMDK-SEARCH. The app
 * layout's useKeyboardShortcuts (hooks/use-keyboard-shortcuts.ts, the "j" meta entry) dispatched kf:open-key
 * {mode:"chat"}, which KeyAgent answers by opening its drawer, and KeyAgent's own keydown listener toggled the drawer.
 * In the app the layout's listener is added first (KeyAgent mounts only once the Business Genome check is done), so
 * one keypress opened the drawer and toggled it shut again. A page that calls useKeyboardShortcuts itself adds a
 * third listener.
 *
 *   KCJ-01  RED-BEFORE  in the app (KeyAgent mounted after the Genome check, as in the browser), Ctrl+J opens KEY's
 *                       drawer and it stays open
 *   KCJ-02  RED-BEFORE  the same for Cmd+J
 *   KCJ-03  RED-BEFORE  the same on a page that calls useKeyboardShortcuts itself
 *   KCJ-04  control     Ctrl+J pressed again closes the drawer; Escape closes it too
 *   KCJ-05  RED-BEFORE  where KeyAgent is not mounted (onboarding, the Genome check), Ctrl+J and Cmd+J are still kept
 *                       from the browser, and the hook sends nothing for them: KeyAgent owns the key
 *   KCJ-06  control     Cmd/Ctrl+K is unchanged: it opens the palette and it stays open, and it does not open the
 *                       drawer; Ctrl+J does not open the palette
 *   KCJ-07  control     the shortcuts help still lists Cmd/Ctrl+J ("Talk to KEY") and Cmd/Ctrl+K
 *
 * Same harness as command-palette-open.test.tsx: the shell renders for real; only fetch, the Next router and the
 * Genome gate's timing are stubbed (the gate answers after the first render, as its real read does).
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

// The Genome gate: checking on the first render, done a moment later, as its real read is. The layout draws a spinner
// while it checks, so KeyAgent mounts after the layout's own hooks have run.
vi.mock("@/hooks/use-genome-gate", async () => {
  const React = await import("react");
  return {
    useGenomeGate: () => {
      const [checking, setChecking] = React.useState(true);
      React.useEffect(() => {
        const t = setTimeout(() => setChecking(false), 20);
        return () => clearTimeout(t);
      }, []);
      return { checking, gateActive: false, threePillarMet: true, genomeIntegrity: 100, genesisCompleted: true };
    },
  };
});

import AppLayout from "@/app/app/layout";
import { Providers } from "@/components/providers";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

const BIZ = "biz_kcj";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function answer(url: string): Response {
  const { pathname: p } = new URL(url, "http://api.test.local");
  if (p === "/identity/me") return json(200, { id: "usr_kcj", email: "owner@kcj.test", businesses: [{ id: BIZ, role: "OWNER" }] });
  if (/\/(sessions|notifications|needs-attention|items|list)(\/|$)/.test(p) || p.endsWith("/flow/sessions")) return json(200, []);
  return json(200, {});
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "kcj-token");
  window.localStorage.setItem("kf_business_id", BIZ);
  // The once-per-session Genome nudge would open the drawer by itself on Today; it has run.
  window.sessionStorage.setItem("kf:genome-auto-prompt", "1");
  nav.pathname = "/app/command-center";
  nav.router.push.mockClear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) =>
    answer(typeof input === "string" ? input : input instanceof URL ? input.href : input.url),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** A page that registers its own shortcuts, as the Customers page does (useKeyboardShortcuts(crmShortcuts)). */
function PageWithShortcuts() {
  useKeyboardShortcuts([{ groupName: "Customers", shortcuts: [{ key: "x", description: "a page shortcut", action: () => {} }] }]);
  return <p>Customers</p>;
}

async function renderShell(page: ReactNode = <p>Today</p>) {
  render(
    <Providers>
      <AppLayout>{page}</AppLayout>
    </Providers>,
  );
  // The header renders once the session is confirmed and the Genome check is done; KeyAgent mounts with it.
  await waitFor(() => expect(document.querySelector("header"), "the app header renders").not.toBeNull(), { timeout: 4000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(drawer(), "KEY's drawer is shut before the keypress").toBeNull();
}

/** KEY's chat drawer (KeyChatPanel), found as journey K's keyUiFindings finds it: by its heading. */
const drawer = () => screen.queryByRole("heading", { name: /^KEY$/ });
const palette = () => screen.queryByRole("dialog", { name: "Command palette" });

/** Still there after the keypress's work has settled (a toggle that shuts it again does so within this). */
async function staysOpen(get: () => HTMLElement | null, what: string) {
  await waitFor(() => expect(get(), `${what} opens`).not.toBeNull(), { timeout: 2000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(get(), `${what} is still open`).not.toBeNull();
}

/** Nothing opened by the keypress, once its work has settled. */
async function staysShut(get: () => HTMLElement | null, what: string) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
  expect(get(), `${what} does not open`).toBeNull();
}

// The whole app shell renders in each case (as in command-palette-open.test.tsx): a 15 s budget per case.
describe("FU-KEY-CTRLJ-OWNERS: Cmd/Ctrl+J opens KEY's drawer, with one owner", { timeout: 15_000 }, () => {
  it("KCJ-01 RED-BEFORE: in the app, Ctrl+J opens KEY's drawer and it stays open", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await staysOpen(drawer, "KEY's drawer");
  });

  it("KCJ-02 RED-BEFORE: in the app, Cmd+J opens KEY's drawer and it stays open", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    await staysOpen(drawer, "KEY's drawer");
  });

  it("KCJ-03 RED-BEFORE: on a page with its own shortcuts, Ctrl+J opens KEY's drawer and it stays open", async () => {
    nav.pathname = "/app/crm/contacts";
    await renderShell(<PageWithShortcuts />);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await staysOpen(drawer, "KEY's drawer");
  });

  it("KCJ-04 control: Ctrl+J pressed again closes the drawer, and so does Escape", async () => {
    await renderShell();
    // Opened by the event the header's Ask KEY button sends, so this case does not depend on KCJ-01.
    act(() => { window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } })); });
    await waitFor(() => expect(drawer()).not.toBeNull());
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(drawer(), "Ctrl+J closes the open drawer").toBeNull());
    act(() => { window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } })); });
    await waitFor(() => expect(drawer()).not.toBeNull());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(drawer(), "Escape closes the drawer").toBeNull());
  });

  it("KCJ-05 RED-BEFORE: without KeyAgent mounted, Ctrl+J is still kept from the browser and the hook sends nothing", () => {
    nav.pathname = "/app/onboarding";
    renderHook(() => useKeyboardShortcuts());
    const opened: unknown[] = [];
    const listen = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener("kf:open-key", listen);
    try {
      // fireEvent returns false when a listener called preventDefault.
      expect(fireEvent.keyDown(window, { key: "j", ctrlKey: true }), "Ctrl+J's default is prevented").toBe(false);
      expect(fireEvent.keyDown(window, { key: "j", metaKey: true }), "Cmd+J's default is prevented").toBe(false);
      expect(opened, "the hook sends nothing for Ctrl+J: KeyAgent owns it").toEqual([]);
    } finally {
      window.removeEventListener("kf:open-key", listen);
    }
  });

  it("KCJ-06 control: Cmd/Ctrl+K is unchanged, and the two keys open only their own surface", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await staysOpen(palette, "the command palette");
    expect(drawer(), "Ctrl+K does not open KEY's drawer").toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(palette(), "Ctrl+K closes the palette").toBeNull());
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await staysShut(palette, "the command palette, on Ctrl+J,");
  });

  it("KCJ-07 control: the shortcuts help still lists Cmd/Ctrl+J and Cmd/Ctrl+K", () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    const listed = result.current.shortcuts.map((s) => `${s.modifier ?? ""}+${s.key}: ${s.description}`);
    expect(listed).toContain("meta+j: Talk to KEY");
    expect(listed).toContain("meta+k: Open command palette");
  });
});
