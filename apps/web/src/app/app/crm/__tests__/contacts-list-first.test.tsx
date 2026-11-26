/**
 * CONTACTS-LIST-FIRST (owner ruling D-289, journey C8): on /app/crm/contacts the customer list comes first. At
 * 375x812 the order is the header, the search, then the list; Relationship Pulse, the Action Center, the Priority
 * Queue, the smart chips and the focus view's leading sections (Next actions, Contacts requiring action) move below
 * the list or into a collapsible panel, and on desktop those cards start collapsed so that the first row is in view
 * at 1440x900. Nothing is removed: every card stays reachable and still works.
 *
 * At main the page drew, above the first row: the Pulse (6 tiles), the Action Center, the Priority Queue, the
 * toolbar's four rows, the smart chips and, in the default focus view, Next actions and Contacts requiring action
 * before All contacts. SWP-CRM-WEB-POLISH's worker measured the first row at y about 1660 at 375x812.
 *
 * jsdom has no layout, so these cases pin the document order and the collapsed state; the pixels are measured by
 * journey C8 (e2e/journeys/c-customer.spec.ts) and the packet's live sweep at 375/768/1024/1440.
 *
 *   CLF-01  RED-BEFORE  focus view (the default): no moved card (Pulse, Action Center, Priority Queue, smart chips,
 *                       the focus view's Next actions and Contacts requiring action) comes before the first row
 *   CLF-02  RED-BEFORE  list view: no moved card comes before the first list row
 *   CLF-03  RED-BEFORE  the Pulse, the Action Center, the Priority Queue and the smart chips start collapsed, behind
 *                       one toggle in the search row ("Insights and filters", aria-expanded false)
 *   CLF-04  RED-BEFORE  opened, the panel shows every moved card, below the toolbar and above the list, and each
 *                       still works: a Pulse tile sets its segment, a smart chip toggles, the Action Center's
 *                       next action opens the customer, the Priority Queue expands; closing hides them again
 *   CLF-05  RED-BEFORE  focus view: All contacts first, then Contacts requiring action, then Next actions; a card
 *                       and an action row in the moved sections still open the customer
 *   CLF-06  RED-BEFORE  the toolbar's segment chips fold into the panel at every width, and its All/Pinned/Recent
 *                       row on phones (hidden below the sm breakpoint) while it is closed; both show when it is open;
 *                       the search row and the select/sort/view row stay visible at every width. (Live at e7aa6385
 *                       the segment row alone kept the first row at y 465.75 at 1440x900, over C8's 450.)
 *   CLF-07  RED-BEFORE  a filter set inside the closed panel is announced on its toggle ("1 on"), so a filtered list
 *                       is never mistaken for the whole list
 *
 * ContactsPage renders for real inside the app's providers (as focus-view-open.test.tsx mounts it); only fetch, the
 * Next router and the email composer are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  searchParams: new URLSearchParams(),
  params: {} as Record<string, string>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => nav.searchParams,
  useParams: () => nav.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: () => {} }) }));

import ContactsPage from "../contacts/page";
import { NavigationContextProvider } from "@/lib/navigation-context";
import { AiContextProvider } from "@/contexts/ai-context";
import { NotesProvider } from "@/components/keyflow/notes-context";
import { GuideProvider } from "@/contexts/guide-context";
import { TtsProvider } from "@/components/tts";
import { KeyChatProvider } from "@/components/key/chat";
import { GenomeProvider } from "@/contexts/genome-context";

const BIZ = "biz_clf";
/** Ada has a next action (Contacts requiring action); Ben has none (All contacts). */
const ADA = { id: "c_clf_ada", firstName: "Ada", lastName: "Byron", status: "CLIENT" };
const BEN = { id: "c_clf_ben", firstName: "Ben", lastName: "Baker", status: "LEAD" };
const CALL_ADA = {
  id: "na_clf", type: "call", contactId: ADA.id, contactName: "Ada Byron", description: "Call Ada about her order",
  estimatedTime: 5, priority: "urgent",
};

function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NavigationContextProvider>
      <AiContextProvider>
        <NotesProvider>
          <GuideProvider>
            <TtsProvider>
              <KeyChatProvider>
                <GenomeProvider>{children}</GenomeProvider>
              </KeyChatProvider>
            </TtsProvider>
          </GuideProvider>
        </NotesProvider>
      </AiContextProvider>
    </NavigationContextProvider>
  );
}

beforeEach(() => {
  nav.router.push.mockClear();
  nav.router.replace.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "clf-token");
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (pathname === "/identity/businesses") return json(200, [{ id: BIZ }]);
      if (pathname === "/identity/me") return json(200, { id: "u_clf", email: "owner@clf.test" });
      if (pathname === `/crm/businesses/${BIZ}/contacts`) return json(200, { contacts: [ADA, BEN] });
      if (pathname === `/crm/businesses/${BIZ}/next-actions`) return json(200, [CALL_ADA]);
      return json(404, { statusCode: 404, message: `not stubbed: ${pathname}` });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const T = { timeout: 4000 };

function renderPage(view: "focus" | "list") {
  window.localStorage.setItem("kf_pipeline_view", view);
  return render(<AppProviders><ContactsPage /></AppProviders>);
}

/** Whether `a` comes before `b` in the document. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * Every element that marks a moved card, as drawn at main: the Pulse and Action Center headings, the Priority Queue
 * toggle, a smart chip, and the focus view's two leading section headings (its h2s; the queue's own "Next Actions"
 * is an h3).
 */
function movedMarkers(): Array<{ name: string; el: HTMLElement }> {
  const found: Array<{ name: string; el: HTMLElement }> = [];
  const add = (name: string, el: HTMLElement | null | undefined) => { if (el) found.push({ name, el }); };
  add("Relationship Pulse", screen.queryByRole("heading", { name: /^relationship pulse$/i }));
  add("Action Center", screen.queryByRole("heading", { name: /^action center$/i }));
  add("Priority Queue", screen.queryByText(/^priority queue$/i));
  add("smart chip Unpaid Invoices", screen.queryByRole("button", { name: /unpaid invoices/i }));
  add("focus Next actions", screen.queryAllByRole("heading", { level: 2, name: /^next actions$/i })[0]);
  add("focus Contacts requiring action", screen.queryAllByRole("heading", { level: 2, name: /^contacts requiring action$/i })[0]);
  return found;
}

function insightsToggle(): HTMLElement {
  return screen.getByRole("button", { name: /^insights and filters/i });
}

/** The panel's moved cards, by the same markers (all four must be present when it is open). */
function panelCards() {
  return {
    pulse: screen.queryByRole("heading", { name: /^relationship pulse$/i }),
    actionCenter: screen.queryByRole("heading", { name: /^action center$/i }),
    priorityQueue: screen.queryByText(/^priority queue$/i),
    smartChip: screen.queryByRole("button", { name: /unpaid invoices/i }),
  };
}

describe("CONTACTS-LIST-FIRST (D-289, C8): the customer list comes first", () => {
  it("CLF-01 RED-BEFORE: focus view, no moved card comes before the first row", async () => {
    renderPage("focus");
    // Wait for the rows and the next action, so every card that main would draw is drawn.
    const ben = await screen.findByText(/^ben baker$/i, {}, T);
    await screen.findAllByText("Call Ada about her order", {}, T);
    const firstRowHeading = screen.getAllByRole("heading", { level: 2 })
      .find((h) => /^(all contacts|contacts requiring action)$/i.test(h.textContent ?? ""));
    expect(firstRowHeading, "the focus view draws its list").toBeTruthy();
    const before = movedMarkers().filter(({ el }) => precedes(el, ben)).map(({ name }) => name);
    expect(before, "moved cards drawn before the first customer row").toEqual([]);
  });

  it("CLF-02 RED-BEFORE: list view, no moved card comes before the first list row", async () => {
    renderPage("list");
    const rows = await screen.findAllByRole("option", { name: /byron|baker/i }, T);
    // Wait until the next actions have been read, so every card that main would draw is drawn.
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes("/next-actions"))).toBe(true), T);
    await new Promise((r) => setTimeout(r, 50));
    const before = movedMarkers().filter(({ el }) => precedes(el, rows[0])).map(({ name }) => name);
    expect(before, "moved cards drawn before the first list row").toEqual([]);
  });

  it("CLF-03 RED-BEFORE: the Pulse, Action Center, Priority Queue and smart chips start collapsed behind one toggle", async () => {
    renderPage("focus");
    await screen.findByText(/^ben baker$/i, {}, T);
    await screen.findAllByText("Call Ada about her order", {}, T);
    const toggle = insightsToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The toggle sits in the search row, beside the search box (the search box's wrapper's row).
    const searchRow = screen.getByRole("textbox", { name: "Search contacts" }).parentElement!.parentElement!;
    expect(searchRow.contains(toggle), "the toggle is in the search row").toBe(true);
    const cards = panelCards();
    expect(cards.pulse, "Relationship Pulse collapsed").toBeNull();
    expect(cards.actionCenter, "Action Center collapsed").toBeNull();
    expect(cards.priorityQueue, "Priority Queue collapsed").toBeNull();
    expect(cards.smartChip, "smart chips collapsed").toBeNull();
  });

  it("CLF-04 RED-BEFORE: opened, the panel shows every moved card between the toolbar and the list, and each works", async () => {
    renderPage("list");
    const rows = await screen.findAllByRole("option", { name: /byron|baker/i }, T);
    await waitFor(() => expect(insightsToggle()).toBeInTheDocument(), T);
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(insightsToggle().getAttribute("aria-controls") ?? "");
    expect(panel, "the toggle controls the panel").toBeTruthy();

    // The Action Center shows once next actions arrive.
    await waitFor(() => expect(panelCards().actionCenter).toBeTruthy(), T);
    const cards = panelCards();
    for (const [name, el] of Object.entries(cards)) {
      expect(el, `${name} is in the open panel`).toBeTruthy();
      expect(panel!.contains(el!), `${name} is inside the panel`).toBe(true);
    }
    // Below the toolbar (the search box), above the list.
    const search = screen.getByRole("textbox", { name: "Search contacts" });
    expect(precedes(search, panel!)).toBe(true);
    expect(precedes(panel!, screen.getAllByRole("option", { name: /byron|baker/i })[0])).toBe(true);
    void rows;

    // A Pulse tile still sets its segment (the toolbar's "At Risk" chip turns on).
    fireEvent.click(within(panel!).getByRole("button", { name: /^\d+\s*at risk$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^at risk/i, pressed: true })).toBeInTheDocument(), T);
    // Clear it again (the segment filters the list, and the list is read below).
    fireEvent.click(screen.getByRole("button", { name: /^at risk/i, pressed: true }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^at risk/i, pressed: true })).toBeNull(), T);

    // A smart chip still toggles.
    const chip = within(panel!).getByRole("button", { name: /unpaid invoices/i });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    await waitFor(() => expect(within(panel!).getByRole("button", { name: /unpaid invoices/i })).toHaveAttribute("aria-pressed", "true"), T);
    fireEvent.click(within(panel!).getByRole("button", { name: /unpaid invoices/i }));

    // The Priority Queue still expands and lists the action.
    const pq = within(panel!).getByText(/^priority queue$/i).closest("button")!;
    fireEvent.click(pq);
    await waitFor(() => expect(within(panel!).getAllByText("Call Ada about her order").length).toBeGreaterThanOrEqual(2), T);

    // The Action Center's next action still opens the customer.
    fireEvent.click(within(panel!).getAllByRole("button", { name: /^ada byron$/i })[0]);
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), T);

    // Closing hides them again; the list stays.
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(panelCards().pulse).toBeNull(), T);
    expect(panelCards().actionCenter).toBeNull();
    expect(screen.getAllByRole("option", { name: /byron|baker/i }).length).toBeGreaterThan(0);
  });

  it("CLF-05 RED-BEFORE: focus view, All contacts first, then Contacts requiring action, then Next actions; each opens", async () => {
    renderPage("focus");
    await screen.findByText(/^ben baker$/i, {}, T);
    await screen.findAllByText("Call Ada about her order", {}, T);
    const h2 = (re: RegExp) => screen.getAllByRole("heading", { level: 2 }).find((h) => re.test(h.textContent ?? ""));
    const all = h2(/^all contacts$/i);
    const requiring = h2(/^contacts requiring action$/i);
    const next = h2(/^next actions$/i);
    expect(all && requiring && next, "the three focus sections are drawn").toBeTruthy();
    expect(precedes(all!, requiring!), "All contacts before Contacts requiring action").toBe(true);
    expect(precedes(requiring!, next!), "Contacts requiring action before Next actions").toBe(true);

    // A card in Contacts requiring action still opens the customer.
    const requiringSection = requiring!.closest("div")!.parentElement!;
    fireEvent.click(within(requiringSection).getByText(/byron/i));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), T);
    nav.router.push.mockClear();
    // An action row in Next actions still opens the customer (a call opens their page).
    const nextSection = next!.closest("div")!.parentElement!;
    fireEvent.click(within(nextSection).getByText("Call Ada about her order"));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), T);
  });

  it("CLF-06 RED-BEFORE: the segment chips (every width) and All/Pinned/Recent (phones) fold into the panel; the other rows stay", async () => {
    renderPage("list");
    await screen.findAllByRole("option", { name: /byron|baker/i }, T);
    const segments = document.querySelector<HTMLElement>('[data-walkthrough="crm-segments"]')!;
    const tabs = screen.getByRole("tablist", { name: "Contact list views" });
    expect(segments).toBeTruthy();
    // Closed: the segment chips are hidden at every width; All/Pinned/Recent below sm only.
    expect(segments.className.split(/\s+/)).toContain("hidden");
    expect(segments.className, "segment chips hidden at every width while closed").not.toMatch(/(^|\s)(sm|md|lg|xl):(flex|block)\b/);
    expect(tabs.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "sm:flex"]));
    // The search row and the select/sort/view row are never hidden.
    const search = screen.getByRole("textbox", { name: "Search contacts" });
    const selectButton = screen.getByRole("button", { name: "Select contacts" });
    const tableView = screen.getByRole("button", { name: "Table view" });
    for (const el of [search, selectButton, tableView]) {
      for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
        expect(node.className.split(/\s+/), "no ancestor of the always-visible controls is hidden").not.toContain("hidden");
      }
    }
    // Open: shown at every width.
    fireEvent.click(insightsToggle());
    for (const row of [segments, tabs]) {
      expect(row.className.split(/\s+/)).not.toContain("hidden");
    }
  });

  it("CLF-07 RED-BEFORE: a filter set inside the closed panel is announced on its toggle", async () => {
    renderPage("list");
    await screen.findAllByRole("option", { name: /byron|baker/i }, T);
    expect(insightsToggle()).toHaveAccessibleName(/^insights and filters$/i);
    fireEvent.click(insightsToggle());
    fireEvent.click(screen.getByRole("button", { name: /unpaid invoices/i }));
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(insightsToggle()).toHaveAccessibleName(/^insights and filters \(1 on\)$/i);
  });
});

/**
 * Review repair (correctness review MINOR-1): the closed toggle's "(N on)" count covers every filter that lives in
 * the panel, the segment chips and the All/Pinned/Recent tab as well as the smart chips, and only while it is closed.
 *
 *   CLF-08  an active segment chip, set and the panel closed, reads "(1 on)" (kills M5: activeSegment dropped)
 *   CLF-09  the Pinned tab, chosen and the panel closed, reads "(1 on)" (kills M6: activeListTab dropped)
 *   CLF-10  with filters on, the open toggle carries no count, and closed it sums them: a smart chip, a segment
 *           and the Pinned tab read "(3 on)" (kills M9: the count shown while open)
 */
describe("CONTACTS-LIST-FIRST review repair: the closed toggle counts every filter inside the panel", () => {
  async function openPanel() {
    renderPage("list");
    await screen.findAllByRole("option", { name: /byron|baker/i }, T);
    expect(insightsToggle()).toHaveAccessibleName(/^insights and filters$/i);
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "true");
  }
  const segmentChip = () =>
    within(document.querySelector<HTMLElement>('[data-walkthrough="crm-segments"]')!).getByRole("button", { name: /^at risk/i });
  const pinnedTab = () =>
    within(screen.getByRole("tablist", { name: "Contact list views" })).getByRole("tab", { name: /^pinned/i });

  it("CLF-08 an active segment chip is counted on the closed toggle", async () => {
    await openPanel();
    fireEvent.click(segmentChip());
    await waitFor(() => expect(screen.getByRole("button", { name: /^at risk/i, pressed: true })).toBeInTheDocument(), T);
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(insightsToggle()).toHaveAccessibleName(/^insights and filters \(1 on\)$/i);
  });

  it("CLF-09 the Pinned tab is counted on the closed toggle", async () => {
    await openPanel();
    fireEvent.click(pinnedTab());
    await waitFor(() => expect(pinnedTab()).toHaveAttribute("aria-selected", "true"), T);
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(insightsToggle()).toHaveAccessibleName(/^insights and filters \(1 on\)$/i);
  });

  it("CLF-10 the open toggle carries no count; closed, it sums a smart chip, a segment and the Pinned tab", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /unpaid invoices/i }));
    fireEvent.click(segmentChip());
    fireEvent.click(pinnedTab());
    await waitFor(() => expect(pinnedTab()).toHaveAttribute("aria-selected", "true"), T);
    await waitFor(() => expect(screen.getByRole("button", { name: /unpaid invoices/i })).toHaveAttribute("aria-pressed", "true"), T);
    expect(insightsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(insightsToggle(), "no count while the panel is open").toHaveAccessibleName(/^insights and filters$/i);
    fireEvent.click(insightsToggle());
    expect(insightsToggle()).toHaveAccessibleName(/^insights and filters \(3 on\)$/i);
  });
});
