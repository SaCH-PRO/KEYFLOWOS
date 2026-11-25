/**
 * WEDGE-WA-INBOUND-CAPTURE review round 2 (NEW-2), the page's own wiring: app/app/bookings/page.tsx hands its loading
 * flag to the New booking sheet (contactsLoading={loading}), so the customer field reads a chosen customer by id only
 * once the page's contact list has arrived.
 *
 * The page shows its skeleton during a first load with no bookings, so the sheet can only be open while a list is
 * loading on a reload with bookings on screen: the test loads once (one booking, a list without the customer), starts a
 * reload whose contacts read is held, then opens the door (?contactId=<id>) as a client navigation would.
 *
 *   BKL-01 while the reload's contacts read is held, the sheet's customer field sends no by-id read; once the list
 *          arrives holding the customer, their name shows from the list and no by-id read was ever sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, act } from "@testing-library/react";

const BIZ = "biz_bkl";
const DOOR_ID = "c_bkl_door";

const h = vi.hoisted(() => ({
  shortcuts: [] as Array<{ groupName: string; shortcuts: Array<{ key: string; action: () => void }> }>,
  contactsReads: 0,
  heldContacts: null as null | ((v: unknown) => void),
  holdNext: false,
  ai: { aiHook: undefined, updateContext: () => {} },
  intelligence: { moduleCoverage: null, recommendations: [], loading: false, dismiss: () => {} },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/lib/workspace", async (orig) => ({
  ...(await orig<typeof import("@/lib/workspace")>()),
  refreshWorkspace: async () => BIZ,
  getStoredBusinessId: () => BIZ,
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: (groups: typeof h.shortcuts) => {
    h.shortcuts = groups ?? [];
  },
}));
vi.mock("@/hooks/use-open-composer", () => ({ useOpenComposer: () => vi.fn() }));
vi.mock("@/hooks/use-plan", () => ({ usePlan: () => ({ checkLimit: () => ({ allowed: true }) }) }));
vi.mock("@/hooks/use-graph-intelligence", () => ({ useGraphIntelligence: () => h.intelligence }));
vi.mock("../hooks/use-bookings-ai-hub", () => ({ useBookingsAiHub: () => h.ai }));
vi.mock("@/components/ui/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../../calendar/master-calendar", () => ({ MasterCalendar: () => null }));
vi.mock("../components/booking-detail-drawer", () => ({ default: () => null }));
vi.mock("../components/today-strip", () => ({ default: () => null }));
vi.mock("../components/schedule-hints", () => ({ ScheduleHints: () => null }));
vi.mock("../components/schedule-filters", () => ({ default: () => null }));
vi.mock("../components/catalog-capacity-tab", () => ({ default: () => null }));
vi.mock("../components/performance-view", () => ({ default: () => null }));
vi.mock("../components/waitlist-panel", () => ({ default: () => null }));
vi.mock("@/components/keyflow/notes-trigger", () => ({ NotesTrigger: () => null }));
vi.mock("@/components/ui/share-link-modal", () => ({ ShareLinkModal: () => null }));
vi.mock("@/components/ui/setup-mode-banner", () => ({ SetupModeBanner: () => null }));
vi.mock("@/components/ui/rich-tooltip", () => ({ RichTooltip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/upgrade-prompt", () => ({ PlanLimitBanner: () => null }));
vi.mock("@/components/ai/graph-insights-panel", () => ({ GraphInsightsPanel: () => null }));
vi.mock("@/components/ai/automation-coverage-indicator", () => ({ AutomationCoverageIndicator: () => null }));
vi.mock("@/components/ui/resume-task-system", () => ({ ResumePrompt: () => null }));
vi.mock("@/lib/client", async (orig) => {
  const real = await orig<typeof import("@/lib/client")>();
  const ok = <T,>(data: T) => Promise.resolve({ data, error: null });
  const firstList = { contacts: [{ id: "c_bkl_other", firstName: "Other", lastName: "Customer", status: "LEAD" }], nextCursor: null, hasMore: false };
  return {
    ...real,
    fetchBookings: () => ok([{ id: "bk_1", status: "CONFIRMED", startTime: "2026-12-01T14:00:00.000Z", endTime: "2026-12-01T15:00:00.000Z", serviceId: "svc_1", staffId: "stf_1", contactId: "c_bkl_other" }]),
    fetchServices: () => ok([{ id: "svc_1", name: "Fitting", durationMins: 60, price: 50, currency: "TTD" }]),
    fetchStaff: () => ok([{ id: "stf_1", name: "Ana" }]),
    getCalendarStatus: () => ok({ connected: false }),
    fetchBookingStats: () => ok(null),
    fetchScheduleHealth: () => ok(null),
    fetchOrgUnits: () => ok([]),
    getBusinessById: () => ok({ slug: "bkl", businessHours: null }),
    fetchContacts: () => {
      h.contactsReads += 1;
      if (!h.holdNext) return ok(firstList);
      return new Promise((resolve) => {
        h.heldContacts = resolve;
      });
    },
  };
});

import BookingsPage from "../page";

const fetchMock = vi.fn();
const byIdReads = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url), "http://localhost").pathname.startsWith(`/crm/businesses/${BIZ}/contacts/`));

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-bkl");
  window.localStorage.setItem("kf_business_id", BIZ);
  window.history.replaceState({}, "", "/app/bookings");
  h.contactsReads = 0;
  h.heldContacts = null;
  h.holdNext = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ contact: { id: DOOR_ID, firstName: "Door", lastName: "Customer" }, events: [], notes: [], tasks: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

describe("NEW-2: the bookings page hands its loading flag to the New booking sheet", () => {
  it("BKL-01 no by-id read while the page's contacts load; the customer shows from the list once it arrives", async () => {
    const { rerender } = render(<BookingsPage />);
    await settle();
    await settle();
    expect(h.contactsReads).toBe(1);

    // A reload (the page's own Refresh shortcut) whose contacts read is held.
    h.holdNext = true;
    const refresh = h.shortcuts.flatMap((g) => g.shortcuts).find((s) => s.key === "r");
    expect(refresh, "the page registers its Refresh shortcut").toBeDefined();
    await act(async () => { refresh!.action(); });
    await settle();
    expect(h.contactsReads).toBe(2);
    expect(h.heldContacts).not.toBeNull();

    // The door, as a client navigation to /app/bookings?contactId=<id> while the page is mounted.
    await act(async () => {
      window.history.pushState({}, "", `/app/bookings?contactId=${DOOR_ID}`);
      rerender(<BookingsPage />);
    });
    await settle();
    expect(screen.getAllByText(/^New Booking/).length).toBeGreaterThan(0);
    expect(byIdReads(), "no by-id read while the list loads").toEqual([]);

    // The list arrives holding the customer.
    await act(async () => {
      h.heldContacts!({
        data: { contacts: [{ id: DOOR_ID, firstName: "Kezia", lastName: "Listed", status: "LEAD" }], nextCursor: null, hasMore: false },
        error: null,
      });
    });
    await settle();
    expect((await screen.findAllByText(/Kezia Listed/)).length).toBeGreaterThan(0);
    await settle();
    expect(byIdReads(), "no by-id read at all").toEqual([]);
  });
});
