/**
 * SWP-SERVICE-DEPOSIT, the web half: the deposit tip's door (BUG-048).
 *
 * WHY this test exists: Presence's "<service> is popular — add a deposit" tip
 * (PresenceOverviewService, POPULAR_SERVICE_ADD_DEPOSIT) links to
 * /app/bookings?tab=catalog&serviceId=<id> since M17. The bookings page's shell
 * reads ?tab= (WorkspaceShell), but nothing read serviceId: the link landed on
 * Bookings > Setup with every service closed, and the param stayed in the URL.
 * The business's currency never reached the Setup cards either, so their money
 * was always written in TTD.
 *
 *   DOOR-01  the tip's link opens Setup with that service's deposit editor open, and serviceId leaves the URL
 *            (tab stays, so a reload stays on Setup)
 *   DOOR-02  a plain ?tab=catalog opens Setup with no editor open (control)
 *   DOOR-03  the Setup cards' money is in the business's currency (GET /identity/businesses/:id)
 *
 * Mounted on the real BookingsPage, WorkspaceShell, CatalogCapacityTab and the
 * real getBusinessById. The list reads are stubbed at the client module; heavy
 * panels the door does not touch (calendar, AI hub, graph insights, notes,
 * resume prompt) are stubbed out; `fetch` answers the business read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const { BUSINESS, SERVICES } = vi.hoisted(() => ({
  BUSINESS: "biz_door_1",
  SERVICES: [
    { id: "svc_1", name: "Gel manicure", duration: 60, price: 120, depositRequired: false, depositType: null, depositValue: null },
    { id: "svc_2", name: "Pedicure", duration: 45, price: 80, depositRequired: false, depositType: null, depositValue: null },
  ],
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/bookings",
  useSearchParams: () => new URLSearchParams(window.location.search),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshWorkspace: async () => BUSINESS,
  getStoredBusinessId: () => BUSINESS,
  getCachedBusiness: () => null,
}));

vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  const ok = <T,>(data: T) => async () => ({ data, error: null });
  return {
    ...actual,
    fetchBookings: ok([]),
    fetchServices: ok(SERVICES),
    fetchStaff: ok([]),
    getCalendarStatus: ok({ connected: false, email: null }),
    fetchContacts: ok({ contacts: [] }),
    fetchBookingStats: ok(null),
    fetchScheduleHealth: ok(null),
    fetchOrgUnits: ok([]),
  };
});

const aiHub = vi.hoisted(() => ({ aiHook: {}, updateContext: () => {} }));
vi.mock("../hooks/use-bookings-ai-hub", () => ({ useBookingsAiHub: () => aiHub }));
const graph = vi.hoisted(() => ({ moduleCoverage: null, recommendations: [], loading: false, dismiss: () => {} }));
vi.mock("@/hooks/use-graph-intelligence", () => ({ useGraphIntelligence: () => graph }));
const plan = vi.hoisted(() => ({
  checkLimit: () => ({ current: 0, limit: 100, isUnlimited: true, nearLimit: false, atLimit: false, upgradeTo: null }),
}));
vi.mock("@/hooks/use-plan", () => ({ usePlan: () => plan }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }));
vi.mock("@/hooks/use-open-composer", () => ({ useOpenComposer: () => () => {} }));
vi.mock("../../calendar/master-calendar", () => ({ MasterCalendar: () => null }));
vi.mock("@/components/ai/graph-insights-panel", () => ({ GraphInsightsPanel: () => null }));
vi.mock("@/components/ai/automation-coverage-indicator", () => ({ AutomationCoverageIndicator: () => null }));
vi.mock("@/components/keyflow/notes-trigger", () => ({ NotesTrigger: () => null }));
vi.mock("@/components/ui/resume-task-system", () => ({ ResumePrompt: () => null }));
vi.mock("@/components/ui/upgrade-prompt", () => ({ PlanLimitBanner: () => null }));

import BookingsPage from "../page";

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return this; },
  } as unknown as Response;
}

describe("the deposit tip's door into Bookings > Setup (SWP-SERVICE-DEPOSIT)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/identity/businesses/${BUSINESS}`)) {
        return jsonResponse(200, { id: BUSINESS, name: "Door Salon", slug: "door-salon", currency: "USD", businessHours: null });
      }
      return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("DOOR-01 the tip's link opens Setup with that service's deposit editor, and serviceId leaves the URL", async () => {
    window.history.replaceState(null, "", "/app/bookings?tab=catalog&serviceId=svc_2");
    render(<BookingsPage />);

    expect(await screen.findByRole("group", { name: "Deposit settings for Pedicure" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Deposit settings for Gel manicure" })).not.toBeInTheDocument();
    expect(screen.getByText("Setup Readiness")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe("?tab=catalog"));
    expect(window.location.pathname).toBe("/app/bookings");
  });

  it("DOOR-02 control: a plain ?tab=catalog opens Setup with no deposit editor open", async () => {
    window.history.replaceState(null, "", "/app/bookings?tab=catalog");
    render(<BookingsPage />);

    expect(await screen.findByText("Setup Readiness")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Deposit for Pedicure" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Deposit settings for/ })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?tab=catalog");
  });

  it("DOOR-03 the Setup cards write money in the business's currency", async () => {
    window.history.replaceState(null, "", "/app/bookings?tab=catalog");
    render(<BookingsPage />);

    const button = await screen.findByRole("button", { name: "Deposit for Gel manicure" });
    const card = button.closest(".kf-card") as HTMLElement;
    await waitFor(() => expect(card).toHaveTextContent("USD 120.00"));
    expect(card).not.toHaveTextContent("TTD");
  });
});
