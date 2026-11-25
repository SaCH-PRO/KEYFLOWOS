/**
 * FU-C4-CMDK-SEARCH (journey C4, "every link to a customer opens /app/crm/contacts/<id>": the Cmd/Ctrl+K door;
 * found once FU-C4-FOCUS-OPEN made the step before it pass): Cmd/Ctrl+K opens the command palette, and a customer it
 * finds is an option named for them that opens their page.
 *
 * Two causes, both on main 10e3c97e:
 *  1. Cmd/Ctrl+K had two owners. The app layout's useKeyboardShortcuts dispatched kf:open-key {mode:"palette"}, which
 *     KeyAgent answered by opening the palette; KeyAgent's own keydown listener toggled it. In the app the layout's
 *     listener is added first (KeyAgent mounts only once the Business Genome check is done), so one keypress opened
 *     the palette and toggled it shut again. A page that calls useKeyboardShortcuts itself (Customers, Revenue,
 *     Bookings, ...) adds a third listener.
 *  2. The palette's results were plain buttons in a dialog: no listbox, no options, so nothing named a result as the
 *     thing the search found.
 *
 *   CPO-01  RED-BEFORE  in the app (KeyAgent mounted after the Genome check, as in the browser), Ctrl+K opens the
 *                       palette and it stays open
 *   CPO-02  RED-BEFORE  the same on a page that calls useKeyboardShortcuts itself
 *   CPO-03  control     Ctrl+K pressed again closes the palette; Escape closes it too
 *   CPO-04  RED-BEFORE  a customer the search finds is an option, in a listbox, named for the customer; choosing it
 *                       opens /app/crm/contacts/<id>
 *   CPO-05  RED-BEFORE  ArrowDown and Enter choose a result as before (that part passes at the base); the option under
 *                       the cursor is the selected one (aria-selected)
 * Review round (confirmation MINOR-1; acceptance MINOR-1 pins CPO-05's aria-activedescendant and aria-controls):
 *   CPO-06  RED-AT-daa64373  where KeyAgent is not mounted (onboarding, the Genome check), Ctrl+K is still kept from
 *                       the browser, as before this packet: the hook leaves the key to KeyAgent but prevents its default
 *
 * Cmd/Ctrl+J (KEY's drawer) has the same two owners. It is not in this packet: the KEY_DISABLED smoke check
 * (keyUiFindings, e2e/journeys) counts a Ctrl+J that opens KEY's drawer, and nothing in the web app hides KEY under
 * KEY_DISABLED, so its fix needs its own packet (FU-KEY-CTRLJ-OWNERS).
 *
 * The shell renders for real (as overlay-stacking.test.tsx mounts it); only fetch, the Next router and the Genome
 * gate's timing are stubbed: the gate answers after the first render, as its real read does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, renderHook, screen, waitFor, fireEvent, cleanup, act, within } from "@testing-library/react";

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

const BIZ = "biz_cpo";
const GINA = { id: "c_cpo_gina", firstName: "Gina", lastName: "Links42", email: "gina@cpo.test", status: "CLIENT" };
const BEN = { id: "c_cpo_ben", firstName: "Ben", lastName: "Links42b", email: "ben@cpo.test", status: "LEAD" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function answer(url: string): Response {
  const { pathname: p, searchParams } = new URL(url, "http://api.test.local");
  if (p === "/identity/me") return json(200, { id: "usr_cpo", email: "owner@cpo.test", businesses: [{ id: BIZ, role: "OWNER" }] });
  if (p === `/api/flows/businesses/${BIZ}/search`) {
    const q = (searchParams.get("q") ?? "").toLowerCase();
    const contacts = [GINA, BEN].filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q));
    return json(200, { contacts, invoices: [], bookings: [], products: [], projects: [] });
  }
  if (/\/(sessions|notifications|needs-attention|items|list)(\/|$)/.test(p) || p.endsWith("/flow/sessions")) return json(200, []);
  return json(200, {});
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "cpo-token");
  window.localStorage.setItem("kf_business_id", BIZ);
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
}

const palette = () => screen.queryByRole("dialog", { name: "Command palette" });

/** Still there after the keypress's work has settled (a toggle that shuts it again does so within this). */
async function staysOpen(get: () => HTMLElement | null, what: string) {
  await waitFor(() => expect(get(), `${what} opens`).not.toBeNull(), { timeout: 2000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(get(), `${what} is still open`).not.toBeNull();
}

// The whole app shell renders in each case: its own waits (up to 4 s for the header, 2 s for a palette to stay open)
// leave little of vitest's 5 s default under a loaded CI runner (confirmation review MINOR).
describe("FU-C4-CMDK-SEARCH: Cmd/Ctrl+K opens the palette, and the customer it finds opens their page", { timeout: 15_000 }, () => {
  it("CPO-01 RED-BEFORE: in the app, Ctrl+K opens the palette and it stays open", async () => {
    await renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await staysOpen(palette, "the command palette");
  });

  it("CPO-02 RED-BEFORE: on a page with its own shortcuts, Ctrl+K opens the palette and it stays open", async () => {
    nav.pathname = "/app/crm/contacts";
    await renderShell(<PageWithShortcuts />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await staysOpen(palette, "the command palette");
  });

  it("CPO-03 control: Ctrl+K pressed again closes the palette, and so does Escape", async () => {
    await renderShell();
    // Opened by the event the shortcut sends (the way the header's search opens it), so this case does not depend on
    // CPO-01.
    act(() => { window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } })); });
    await waitFor(() => expect(palette()).not.toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(palette(), "Ctrl+K closes the open palette").toBeNull());
    act(() => { window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } })); });
    await waitFor(() => expect(palette()).not.toBeNull());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(palette(), "Escape closes the palette").toBeNull());
  });

  it("CPO-04 RED-BEFORE: a customer the search finds is an option named for them; choosing it opens their page", async () => {
    await renderShell();
    act(() => { window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } })); });
    const dialog = await waitFor(() => { const d = palette(); expect(d).not.toBeNull(); return d!; });
    fireEvent.change(within(dialog).getByPlaceholderText(/search/i), { target: { value: "Links42" } });
    const listbox = await within(dialog).findByRole("listbox", {}, { timeout: 3000 });
    const option = await within(listbox).findByRole("option", { name: /Gina Links42\b/ }, { timeout: 3000 });
    fireEvent.click(option);
    expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${GINA.id}`);
    await waitFor(() => expect(palette(), "choosing a result closes the palette").toBeNull());
  });

  it("CPO-05 RED-BEFORE: ArrowDown and Enter choose a result; the option under the cursor is the selected one", async () => {
    await renderShell();
    act(() => { window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } })); });
    const dialog = await waitFor(() => { const d = palette(); expect(d).not.toBeNull(); return d!; });
    const input = within(dialog).getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "Links42" } });
    // Both customers are found; the second one is chosen with the keyboard.
    await within(dialog).findByText("Ben Links42b", {}, { timeout: 3000 });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const selected = within(dialog).queryAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected.map((o) => o.textContent ?? ""), "one option is selected: the one under the cursor").toEqual([expect.stringContaining("Ben Links42b")]);
    // The search box names that option to assistive technology, and the list it controls (acceptance MINOR-1).
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-activedescendant"), "aria-activedescendant names the selected option").toBe(selected[0].id);
    expect(document.getElementById(input.getAttribute("aria-controls") ?? "")?.getAttribute("role")).toBe("listbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${BEN.id}`);
  });

  it("CPO-06 RED-AT-daa64373: without KeyAgent mounted, Ctrl+K is still kept from the browser", () => {
    nav.pathname = "/app/onboarding";
    renderHook(() => useKeyboardShortcuts());
    const opened: unknown[] = [];
    const listen = (e: Event) => opened.push(e);
    window.addEventListener("kf:open-key", listen);
    try {
      // fireEvent returns false when a listener called preventDefault.
      expect(fireEvent.keyDown(window, { key: "k", ctrlKey: true }), "Ctrl+K's default is prevented").toBe(false);
      expect(fireEvent.keyDown(window, { key: "k", metaKey: true }), "Cmd+K's default is prevented").toBe(false);
      expect(opened, "the hook still sends nothing for Ctrl+K: KeyAgent owns it").toEqual([]);
    } finally {
      window.removeEventListener("kf:open-key", listen);
    }
  });
});
