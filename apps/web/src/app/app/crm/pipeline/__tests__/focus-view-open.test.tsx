/**
 * FU-C4-FOCUS-OPEN (journey C4, "every link to a customer opens /app/crm/contacts/<id>"; pre-flight D-274 A3): a
 * customer clicked on the Customers page opens their page.
 *
 * /app/crm/contacts opens in the focus view (the default, pipeline-tab-content.tsx getStoredViewMode). Its cards (and
 * the NextActionQueue's "view") call the page's handleViewEngageContact, which selected the contact and switched a tab
 * but opened nothing: the side panel with its Open link renders only in the list view, so the URL stayed at
 * /app/crm/contacts and journey C4's "from the Customers list" step failed.
 *
 *   FVO-01  RED-BEFORE  clicking a customer's card in the focus view opens /app/crm/contacts/<id>
 *   FVO-02  control     in the list view, clicking another customer's row selects that row in place (the side
 *                       panel Release 0 edits through), with no navigation (reviews: two customers, so the click
 *                       selects rather than toggles the auto-selected first one off)
 * Review round:
 *   FVO-03  RED-BEFORE  the next-action queue's "view" (the customer's name) opens their page too
 *   FVO-04  RED-AT-4b40a2a7  a customer opened from the focus view is still recorded as recent (selectContact did it)
 *   FVO-05  RED-AT-4b40a2a7  a "call" next action in the focus view opens the customer's page (it toasted "Opening …"
 *                       and opened nothing; handleDoAction's call/task/default cases, D-274 A4)
 *   FVO-06  RED-AT-253766ae  a "task" next action opens the customer's Tasks page (its toast says "task details")
 *
 * ContactsPage renders for real inside the app's providers (as release0-journey.test.tsx mounts it); only fetch, the
 * Next router and the email composer are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Stable objects, as Next gives them: a new URLSearchParams per call re-runs every effect that depends on it.
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

import ContactsPage from "../../contacts/page";
import { NavigationContextProvider } from "@/lib/navigation-context";
import { AiContextProvider } from "@/contexts/ai-context";
import { NotesProvider } from "@/components/keyflow/notes-context";
import { GuideProvider } from "@/contexts/guide-context";
import { TtsProvider } from "@/components/tts";
import { KeyChatProvider } from "@/components/key/chat";
import { GenomeProvider } from "@/contexts/genome-context";

const BIZ = "biz_fvo";
const ADA = { id: "c_fvo_ada", firstName: "Ada", lastName: "Byron", status: "CLIENT" };
const BEN = { id: "c_fvo_ben", firstName: "Ben", lastName: "Baker", status: "LEAD" };
/** What GET next-actions answers (FVO-03/05); empty by default. */
let nextActions: unknown[] = [];

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
  nextActions = [];
  nav.router.replace.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "fvo-token");
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
      if (pathname === "/identity/me") return json(200, { id: "u_fvo", email: "owner@fvo.test" });
      if (pathname === `/crm/businesses/${BIZ}/contacts`) return json(200, { contacts: [ADA, BEN] });
      if (pathname === `/crm/businesses/${BIZ}/next-actions`) return json(200, nextActions);
      return json(404, { statusCode: 404, message: `not stubbed: ${pathname}` });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FU-C4-FOCUS-OPEN: a customer clicked on the Customers page opens their page", () => {
  it("FVO-01 RED-BEFORE: clicking a customer's card in the focus view opens /app/crm/contacts/<id>", async () => {
    window.localStorage.setItem("kf_pipeline_view", "focus");
    render(<AppProviders><ContactsPage /></AppProviders>);
    // The focus view is what is on screen (its sections), not the list.
    expect(await screen.findByText(/^(all contacts|contacts requiring action)$/i, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Contact details" })).not.toBeInTheDocument();
    const card = await screen.findByText(/byron/i, {}, { timeout: 4000 });
    fireEvent.click(card);
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), { timeout: 4000 });
  });

  it("FVO-02 control: in the list view, clicking another customer's row selects it in place, with no navigation", async () => {
    window.localStorage.setItem("kf_pipeline_view", "list");
    render(<AppProviders><ContactsPage /></AppProviders>);
    // The list selects its first customer by itself once loaded: wait for that, so the click below is not raced by it.
    await waitFor(() =>
      expect(screen.getAllByRole("option", { name: /byron/i }).some((o) => o.getAttribute("aria-selected") === "true")).toBe(true),
    { timeout: 4000 });
    fireEvent.click(await screen.findByText(/baker/i, {}, { timeout: 4000 }));
    await waitFor(() =>
      expect(screen.getAllByRole("option", { name: /baker/i }).some((o) => o.getAttribute("aria-selected") === "true")).toBe(true),
    { timeout: 4000 });
    expect(nav.router.push.mock.calls.filter(([to]) => String(to).startsWith("/app/crm/contacts/"))).toEqual([]);
  });

  const callAda = { id: "na_fvo", type: "call", contactId: ADA.id, contactName: "Ada Byron", description: "Call Ada about her order", estimatedTime: 5, priority: "urgent" };

  it("FVO-03 RED-BEFORE: the next-action queue's view (the customer's name) opens their page", async () => {
    nextActions = [callAda];
    window.localStorage.setItem("kf_pipeline_view", "list");
    render(<AppProviders><ContactsPage /></AppProviders>);
    // CONTACTS-LIST-FIRST (D-289): the queue sits in the toolbar's "Insights and filters" panel, which starts closed.
    fireEvent.click(await screen.findByRole("button", { name: /^insights and filters/i }, { timeout: 4000 }));
    const name = await screen.findAllByRole("button", { name: /^ada byron$/i }, { timeout: 4000 });
    fireEvent.click(name[0]);
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), { timeout: 4000 });
  });

  it("FVO-04 RED-AT-4b40a2a7: a customer opened from the focus view is recorded as recent", async () => {
    window.localStorage.setItem("kf_pipeline_view", "focus");
    render(<AppProviders><ContactsPage /></AppProviders>);
    fireEvent.click(await screen.findByText(/byron/i, {}, { timeout: 4000 }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), { timeout: 4000 });
    expect(JSON.parse(window.localStorage.getItem("kf_recent_contacts") ?? "[]")).toContain(ADA.id);
  });

  it("FVO-05 RED-AT-4b40a2a7: a call next action in the focus view opens the customer's page", async () => {
    nextActions = [callAda];
    window.localStorage.setItem("kf_pipeline_view", "focus");
    render(<AppProviders><ContactsPage /></AppProviders>);
    // The focus view's action row is the clickable card (cursor-pointer) holding the text; the queue card elsewhere on
    // the page shows the same text in a part that is not clickable.
    const matches = await screen.findAllByText("Call Ada about her order", {}, { timeout: 4000 });
    const row = matches.find((m) => m.closest(".cursor-pointer"));
    expect(row, "the focus view lists the call action").toBeTruthy();
    fireEvent.click(row!);
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`), { timeout: 4000 });
  });

  it("FVO-06 RED-AT-253766ae: a task next action in the focus view opens the customer's Tasks page", async () => {
    nextActions = [{ ...callAda, id: "na_fvo_task", type: "task", description: "Send Ada her proof" }];
    window.localStorage.setItem("kf_pipeline_view", "focus");
    render(<AppProviders><ContactsPage /></AppProviders>);
    const matches = await screen.findAllByText("Send Ada her proof", {}, { timeout: 4000 });
    const row = matches.find((m) => m.closest(".cursor-pointer"));
    expect(row, "the focus view lists the task action").toBeTruthy();
    fireEvent.click(row!);
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}/tasks`), { timeout: 4000 });
  });
});
