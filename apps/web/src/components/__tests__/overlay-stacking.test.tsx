/**
 * SWP-LAYERS (v1 step 3, web shell; sweep BUG-004 and BUG-041; journeys A, F,
 * I and K; product audit: "Nothing covers the primary button, and nothing opens
 * by itself. One z-index layer contract covers drawers, sheets, banners and
 * KEY.").
 *
 * WHY. The browser sweep (2026-11-13) found two overlays covering the primary
 * control of a screen:
 *
 *   BUG-004  The floating KEY bubble (components/key/chat/key-chat-bubble-v2.tsx,
 *            fixed bottom right at z 90) sat over the bottom-right button of
 *            every side sheet (z 50): calendar Create, Add Expense, Send email,
 *            Mark Paid. elementFromPoint at the button's centre was the bubble,
 *            and a click opened KEY instead. On a phone the bottom bar
 *            (z 50, painted after the page) covered the sheet's footer the same
 *            way (GATE-HARNESS smoke, 375x812).
 *   BUG-041  The Business Genome banner (components/genome-integrity-banner.tsx,
 *            relative z 40, painted after the header) covered the first item of
 *            the header's New menu: the menu's z 50 was trapped in the header's
 *            own z 40 stacking context, so New > Contact could not be clicked.
 *
 * The v1 ruling (product audit key_assistant: "Stop KEY doing these in v1 ...
 * The floating KeyChatBubbleV2 ... Remove it from app/layout.tsx") takes both
 * off the app shell, and the layers become one table in app/globals.css that
 * side sheets, menus, drawers and toasts take their z-index from. KEY opens
 * only from the header's "Ask KEY" button, which shows on a phone too, or from
 * Cmd/Ctrl+J (journey K).
 *
 * WHAT THIS PROVES, in jsdom (which has no layout, so no elementFromPoint):
 * which of two overlays paints over the other, read the way the browser reads
 * it. An element's layer is the z-index of the outermost element around it
 * that sets one (the one that takes part in the page's root stacking context),
 * a token resolved through the table in app/globals.css; at equal layers the
 * one later in the document paints on top. The browser half, elementFromPoint
 * at the real buttons, is e2e/sweep-overlays.spec.ts.
 *
 * The real app shell is mounted (app/app/layout.tsx inside the root Providers,
 * with RequireAuth, the header, the bottom bar, the menus, KeyAgent and its
 * chat drawer, and sonner's Toaster); only `fetch`, the Next router and the
 * genome redirect gate (not what is under test) are stubbed.
 *
 * Premise note (packet return, CONTRADICTION): the plan's case "closing the
 * sheet restores the bubble" was written for the earlier cut, where the bubble
 * hid while a sheet was open. The re-cut scope unmounts the bubble, so closing
 * a sheet restores KEY's door, the header's Ask KEY, and no bubble comes back.
 *
 * Review repair (LAY-CR-1, LAY-CR-2). The table sits among page-level z-index
 * literals it does not own yet (page dialogs' backdrops and dropdown
 * click-catchers at z-40, page modals at z-[70] and z-[90]); the shell's layers
 * keep the order they had against them before the table: a page's own
 * full-screen overlay still covers the header (and now the bottom bar), and
 * KEY's drawer, opened on request, still paints over a page's modal. And the
 * header's left group may shrink, so on a phone its content never pushes the
 * right-hand controls (Search, New, Notifications) off the screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { render, screen, waitFor, within, fireEvent, cleanup, act } from "@testing-library/react";

// Stable across renders, as Next's own are: a new URLSearchParams on every
// render re-runs NavigationContextProvider's effect forever.
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

// The onboarding redirect gate reads the onboarding state and may send the
// page to /app/onboarding; it is not what this file tests, so it lets the shell
// through (as it does for an onboarded owner).
vi.mock("@/hooks/use-genome-gate", () => ({ useGenomeGate: () => ({ checking: false }) }));

import AppLayout from "@/app/app/layout";
import { Providers } from "@/components/providers";
import { SideSheet } from "@/components/ui/side-sheet";
import { SideSheet as CommerceSideSheet, QuickSheet } from "@/app/app/commerce/components/side-sheet";
import { toast } from "sonner";

const BIZ = "biz_swp_layers";

// ── the layer table, read from app/globals.css ────────────────────────────

const GLOBALS_CSS = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

/** Every `--kf-z-*: <n>;` the stylesheet defines, in the order it lists them. */
function layerTable(css: string): Array<[string, number]> {
  return [...css.matchAll(/(--kf-z-[a-z0-9-]+)\s*:\s*(-?\d+)\s*;/g)].map((m) => [m[1], Number(m[2])]);
}

const TABLE = new Map(layerTable(GLOBALS_CSS));

/** A z-index as an element sets it, through a Tailwind class or an inline style; null when it sets none. */
function zIndexOf(el: Element): number | null {
  const resolve = (value: string): number => {
    const v = value.trim();
    const token = /^var\((--kf-z-[a-z0-9-]+)\)$/.exec(v);
    if (token) return TABLE.get(token[1]) ?? Number.NaN; // a token the table lacks never compares true
    return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
  };
  const inline = (el as HTMLElement).style?.zIndex;
  if (inline) return resolve(inline);
  for (const c of Array.from(el.classList)) {
    const m = /^z-(\d+)$/.exec(c) ?? /^z-\[(.+)\]$/.exec(c);
    if (m) return resolve(m[1]);
  }
  return null;
}

/** The element that takes part in the root stacking context for `el`, and its layer (0 when nothing around it sets one). */
function rootLayer(el: Element): { node: Element; z: number } {
  let found: { node: Element; z: number } | null = null;
  for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
    const z = zIndexOf(cur);
    if (z !== null) found = { node: cur, z };
  }
  return found ?? { node: el, z: 0 };
}

/** Whether `top` paints over `under` where they overlap: a higher layer, or the same layer later in the document. */
function paintsOver(top: Element, under: Element): boolean {
  const a = rootLayer(top);
  const b = rootLayer(under);
  if (a.node === b.node) return true;
  if (a.z !== b.z) return a.z > b.z;
  return !!(b.node.compareDocumentPosition(a.node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function describeLayer(el: Element): string {
  const r = rootLayer(el);
  const cls = (r.node.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith("z-")).join(" ");
  return `<${r.node.tagName.toLowerCase()} ${cls || "(no z-index)"}> = ${r.z}`;
}

/** Whether the element, or anything around it up to `scope`, carries a bare `hidden` (display: none below every breakpoint). */
function hiddenOnAPhone(el: Element, scope: Element): boolean {
  for (let cur: Element | null = el; cur && cur !== scope.parentElement; cur = cur.parentElement) {
    if (cur.classList.contains("hidden")) return true;
  }
  return false;
}

// ── the network edge ──────────────────────────────────────────────────────

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Every API call the shell makes, answered as an empty but valid server would:
 * the signed-in owner, an empty list or object for the rest, and a Business
 * Genome at 40% (so the Genome banner, while it is mounted, shows: it hides at
 * 100%).
 */
function answer(url: string): Response {
  const p = new URL(url, "http://api.test.local").pathname;
  if (p === "/identity/me") return json(200, { id: "usr_swp_layers", email: "owner@swp-layers.test", keyDisabled: false, businesses: [{ id: BIZ, role: "OWNER" }] });
  if (p.endsWith("/genome/integrity")) return json(200, { genomeIntegrity: 40, sections: [] });
  if (/\/(sessions|notifications|needs-attention|items|list)(\/|$)/.test(p) || p.endsWith("/flow/sessions")) return json(200, []);
  return json(200, {});
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "swp-layers-token");
  window.localStorage.setItem("kf_business_id", BIZ);
  window.sessionStorage.setItem("kf:genome-auto-prompt", "1"); // the KEY nudge is SWP-KEY-SHELL-SMOKE's, not this file's
  nav.pathname = "/app/command-center";
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

// ── the screens ───────────────────────────────────────────────────────────

/** A page with a side sheet whose footer holds the primary button, as the calendar's New event sheet has. */
function PageWithSheet({ kind }: { kind: "ui" | "commerce" | "quick" }) {
  const [open, setOpen] = useState(false);
  const footer = <button type="button">Create</button>;
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open the sheet</button>
      {kind === "ui" && (
        <SideSheet open={open} onClose={() => setOpen(false)} title="New event" footer={footer}>
          <p>Event details</p>
        </SideSheet>
      )}
      {kind === "commerce" && (
        <CommerceSideSheet open={open} onClose={() => setOpen(false)} title="Send quote" footer={footer}>
          <p>Compose email</p>
        </CommerceSideSheet>
      )}
      {kind === "quick" && (
        <QuickSheet open={open} onClose={() => setOpen(false)} title="Quick add">
          <p>Quick add</p>
          {footer}
        </QuickSheet>
      )}
    </div>
  );
}

async function renderShell(page: ReactNode) {
  const utils = render(
    <Providers>
      <AppLayout>{page}</AppLayout>
    </Providers>,
  );
  // RequireAuth confirms the session with GET /identity/me before the shell renders.
  const header = await waitFor(() => {
    const h = document.querySelector("header");
    expect(h, "the app header renders once the session is confirmed").not.toBeNull();
    return h as HTMLElement;
  });
  // Let the shell's own first reads (the Genome integrity among them) answer.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { ...utils, header };
}

const bottomBar = () => screen.getByRole("navigation", { name: "Mobile navigation" });
const keyBubble = () => screen.queryByRole("button", { name: "Talk to KEY" });
const genomeBanner = () => screen.queryByText("Build your Business Genome");
const keyDrawerHeading = () => screen.queryByRole("heading", { name: /^KEY$/ });

// ── the table ─────────────────────────────────────────────────────────────

describe("SWP-LAYERS: one z-index layer table in app/globals.css", () => {
  it("lists the layers bottom to top: the bottom bar, the header and its menus, sheets and drawers, dialogs, KEY's drawer, toasts", () => {
    const order = ["--kf-z-chrome", "--kf-z-header", "--kf-z-drawer", "--kf-z-modal", "--kf-z-key-panel", "--kf-z-toast"];
    for (const name of order) expect(TABLE.has(name), `${name} is in the table`).toBe(true);
    const values = order.map((n) => TABLE.get(n) as number);
    expect([...values].sort((a, b) => a - b), `the layers rise in this order: ${order.join(" < ")}`).toEqual(values);
    expect(new Set(values).size, "no two layers share a value").toBe(values.length);
    // Page-level floating buttons sit under the app's chrome.
    expect(TABLE.get("--kf-z-fab")! < TABLE.get("--kf-z-chrome")!).toBe(true);
    // Each layer is defined once.
    const names = layerTable(GLOBALS_CSS).map(([n]) => n);
    expect(names.length, "a layer token defined twice").toBe(new Set(names).size);
  });

  it("has no floating KEY layer: KEY has no bubble", () => {
    expect(TABLE.has("--kf-z-key-presence"), "the floating bubble's layer").toBe(false);
  });
});

// ── the app shell ─────────────────────────────────────────────────────────

// The real shell mounts in about two seconds in jsdom, and a sheet's exit
// animation runs before it unmounts.
describe("SWP-LAYERS: the app shell (app/app/layout.tsx)", { timeout: 30_000 }, () => {
  it("mounts no floating KEY bubble and no Business Genome banner", async () => {
    await renderShell(<PageWithSheet kind="ui" />);
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u instanceof Request ? u.url : u).includes("/identity/me"))).toBe(true),
    );
    expect(keyBubble(), "the floating KEY bubble (BUG-004)").toBeNull();
    expect(genomeBanner(), "the Business Genome banner (BUG-041)").toBeNull();
  });

  for (const kind of ["ui", "commerce", "quick"] as const) {
    it(`with a ${kind === "ui" ? "side sheet (components/ui/side-sheet.tsx)" : kind === "commerce" ? "commerce side sheet" : "commerce quick sheet"} open, nothing of the shell paints over it; closing it leaves the header's Ask KEY door, which opens KEY`, async () => {
      const { header } = await renderShell(<PageWithSheet kind={kind} />);
      fireEvent.click(screen.getByRole("button", { name: "Open the sheet" }));
      const create = await screen.findByRole("button", { name: "Create" });

      const over: string[] = [];
      const check = (what: string, el: Element | null) => {
        if (el && !paintsOver(create, el)) over.push(`${what} ${describeLayer(el)} paints over the sheet's Create ${describeLayer(create)}`);
      };
      check("the floating KEY bubble", keyBubble());
      check("the phone's bottom bar", bottomBar());
      check("the app header", header);
      check("the Business Genome banner", genomeBanner());
      expect(over, "shell layers over an open sheet's primary button").toEqual([]);

      // Closing the sheet: no bubble comes back; the header's Ask KEY is KEY's door, and it opens KEY.
      fireEvent.keyDown(document, { key: "Escape" });
      // The sheet slides out (framer-motion's exit) before it unmounts.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Create" })).toBeNull(), { timeout: 8000 });
      expect(keyBubble(), "a floating KEY bubble after the sheet closed").toBeNull();
      const askKey = within(header).getByRole("button", { name: "Ask KEY" });
      fireEvent.click(askKey);
      await waitFor(() => expect(keyDrawerHeading(), "KEY's chat drawer opens from Ask KEY").not.toBeNull());
    });
  }

  it("the header's New menu sits over the page, the bottom bar and any banner: New > Contact is the topmost control where it sits", async () => {
    const { header } = await renderShell(<div>Today</div>);
    fireEvent.click(within(header).getByRole("button", { name: /^new\b/i }));
    const contact = await within(header).findByRole("menuitem", { name: /contact/i });
    expect(contact.getAttribute("href")).toBe("/app/crm/contacts?action=new");

    const over: string[] = [];
    const check = (what: string, el: Element | null) => {
      if (el && !paintsOver(contact, el)) over.push(`${what} ${describeLayer(el)} paints over New > Contact ${describeLayer(contact)}`);
    };
    check("the Business Genome banner", genomeBanner());
    check("the phone's bottom bar", bottomBar());
    check("the floating KEY bubble", keyBubble());
    expect(over, "layers over the header's New menu").toEqual([]);
    // The header (and so every menu it opens) takes its layer from the table, above the bottom bar.
    expect(rootLayer(contact).z).toBe(TABLE.get("--kf-z-header"));
  });

  // The bottom bar's own "AI" entry (nav-config.ts mobileBottomNav "#key") leaves with NAV-A1's bar.
  it("the header's Ask KEY door shows at phone width and opens KEY's drawer, as Cmd/Ctrl+J does; no floating bubble is a second door", async () => {
    const { header } = await renderShell(<div>Today</div>);
    const askKey = within(header).getByRole("button", { name: "Ask KEY" });
    expect(hiddenOnAPhone(askKey, header), "Ask KEY is display:none below the md breakpoint").toBe(false);
    expect(keyDrawerHeading(), "KEY's drawer is closed until asked for").toBeNull();
    expect(keyBubble(), "a second KEY door: the floating bubble").toBeNull();

    fireEvent.click(askKey);
    await waitFor(() => expect(keyDrawerHeading()).not.toBeNull());
    expect(rootLayer(keyDrawerHeading()!).z, "KEY's drawer is in its layer").toBe(TABLE.get("--kf-z-key-panel"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(keyDrawerHeading()).toBeNull());

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(keyDrawerHeading(), "Ctrl+J opens KEY's drawer").not.toBeNull());
  });

  it("the phone's navigation drawer, KEY's drawer and toasts take their layers from the table", async () => {
    const { header } = await renderShell(<div>Today</div>);
    fireEvent.click(within(header).getByRole("button", { name: "Open navigation menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation menu" });
    expect(rootLayer(drawer).z, "the navigation drawer").toBe(TABLE.get("--kf-z-modal"));
    expect(paintsOver(drawer, bottomBar()), "the navigation drawer over the bottom bar").toBe(true);
    expect(paintsOver(drawer, header), "the navigation drawer over the header").toBe(true);

    act(() => {
      toast("Saved");
    });
    const toaster = await waitFor(() => {
      const t = document.querySelector("[data-sonner-toaster]");
      expect(t, "sonner's toaster renders a toast").not.toBeNull();
      return t as HTMLElement;
    });
    expect(rootLayer(toaster).z, "toasts").toBe(TABLE.get("--kf-z-toast"));
  });
  // LAY-CR-1. The header is a flex row inside the shell's overflow-hidden root:
  // a left group that cannot shrink below its content (hamburger, logo and the
  // whole KEYFLOWOS wordmark, Ask KEY) made the header wider than a phone, and
  // the root clipped Notifications (and at 320px New) off the screen, where
  // nobody can tap or scroll to them. jsdom has no layout; the browser measure,
  // every header control on screen and topmost at 375, 360 and 320, is
  // e2e/sweep-overlays.spec.ts.
  it("the header's left group may shrink, and a phone shows the logo mark without the wordmark, so Search, New and Notifications stay on screen", async () => {
    const { header } = await renderShell(<div>Today</div>);
    const hamburger = within(header).getByRole("button", { name: "Open navigation menu" });
    let leftGroup: HTMLElement = hamburger;
    while (leftGroup.parentElement && leftGroup.parentElement !== header) leftGroup = leftGroup.parentElement;
    expect(leftGroup.parentElement, "the hamburger sits in a group of the header").toBe(header);
    expect(within(leftGroup).getByRole("button", { name: "Ask KEY" }), "Ask KEY is in the left group").toBeTruthy();
    expect(leftGroup.classList.contains("flex-1"), "the left group takes the header's free width").toBe(true);
    expect(
      leftGroup.classList.contains("min-w-0"),
      "the left group (flex-1) may shrink below its content (min-w-0); without it its min-content width (the whole wordmark and Ask KEY) pushes the right-hand controls off a phone's screen",
    ).toBe(true);
    const wordmark = within(header).getByText("KEYFLOWOS");
    expect(hiddenOnAPhone(wordmark, header), "the KEYFLOWOS wordmark is display:none on a phone (below sm)").toBe(true);
    // The right-hand controls are all still there.
    for (const name of ["Search", "Notifications"]) expect(within(header).getByRole("button", { name }), name).toBeTruthy();
    expect(within(header).getByRole("button", { name: /^new\b/i }), "New").toBeTruthy();
  });

  // LAY-CR-2. Page dialogs' backdrops (crm/data-quality's settings dialog,
  // the product import, the contacts export, the bulk-action menus) and page
  // dropdowns' click-catchers still use the z-40 literal. They covered the
  // header before the table and must still: a click on the header lands on the
  // backdrop and closes what is open, never opens the header's New menu over an
  // open dialog.
  it("a page's own full-screen overlay at the z-40 literal covers the header and the phone's bottom bar; the header's menus still sit over the bottom bar", async () => {
    const { header } = await renderShell(
      <div>
        <p>Data quality</p>
        <div data-testid="page-overlay" className="fixed inset-0 z-40 bg-black/40" />
      </div>,
    );
    const overlay = screen.getByTestId("page-overlay");
    expect(paintsOver(overlay, header), `the page's overlay ${describeLayer(overlay)} over the header ${describeLayer(header)}`).toBe(true);
    expect(paintsOver(overlay, bottomBar()), `the page's overlay ${describeLayer(overlay)} over the bottom bar ${describeLayer(bottomBar())}`).toBe(true);
    expect(paintsOver(header, bottomBar()), `the header ${describeLayer(header)} (and so its menus) over the bottom bar ${describeLayer(bottomBar())}`).toBe(true);
  });

  // LAY-CR-2. KEY opens on request only (Ask KEY, Cmd/Ctrl+J), so when it is
  // asked for it shows over whatever is open, as it did before the table: over
  // a page modal at the z-[90] literal (KeyFlowStudio's) and over one at the
  // z-[70] literal that a page portals to the end of the document (later than
  // KEY's drawer, so a tie would go to the page).
  function PageModals() {
    return (
      <div>
        <div data-testid="page-modal-90" className="fixed inset-0 z-[90] bg-black/60" />
        {createPortal(<div data-testid="page-modal-70" className="fixed inset-0 z-[70]" />, document.body)}
      </div>
    );
  }

  it("KEY's drawer, opened with Ctrl+J over a page's modal at the z-[90] or z-[70] literal, paints over it", async () => {
    await renderShell(<PageModals />);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(keyDrawerHeading(), "Ctrl+J opens KEY's drawer").not.toBeNull());
    const key = keyDrawerHeading()!;
    const under: string[] = [];
    for (const id of ["page-modal-90", "page-modal-70"]) {
      const modal = screen.getByTestId(id);
      if (!paintsOver(key, modal)) under.push(`${id} ${describeLayer(modal)} paints over KEY's drawer ${describeLayer(key)}`);
    }
    expect(under, "page modals over KEY's drawer").toEqual([]);
  });
});
