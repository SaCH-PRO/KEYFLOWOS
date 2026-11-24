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
 *   FVO-02  control     in the list view, clicking a row still selects it in place (the side panel Release 0 edits
 *                       through), with no navigation
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
      if (pathname === `/crm/businesses/${BIZ}/contacts`) return json(200, { contacts: [ADA] });
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
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/crm/contacts/${ADA.id}`));
  });

  it("FVO-02 control: in the list view, clicking a row selects it in place, with no navigation", async () => {
    window.localStorage.setItem("kf_pipeline_view", "list");
    render(<AppProviders><ContactsPage /></AppProviders>);
    const row = await screen.findByRole("option", { name: /byron/i }, { timeout: 4000 }).catch(() => null);
    const target = row ?? (await screen.findByText(/byron/i, {}, { timeout: 4000 }));
    fireEvent.click(target);
    await new Promise((r) => setTimeout(r, 50));
    expect(nav.router.push.mock.calls.filter(([to]) => String(to).startsWith("/app/crm/contacts/"))).toEqual([]);
  });
});
