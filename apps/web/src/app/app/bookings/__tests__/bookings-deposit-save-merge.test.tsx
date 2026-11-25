/**
 * SWP-SERVICE-DEPOSIT, the web half, repair round 1: a saved deposit reaches the page's list (M-3).
 *
 * WHY this test exists: the Setup tab is unmounted when another Bookings tab is shown, and remounted from the page's
 * services list. The page merges the service Setup saved into that list (handleServiceUpdated); no test held that,
 * so a mutant removing the merge survived, and with it, after a save, a tab switch showed the old deposit.
 *
 *   MERGE-01  a deposit saved in Setup is still shown after switching to Schedule and back to Setup
 *
 * Mounted on the real BookingsPage, WorkspaceShell, CatalogCapacityTab and client.ts updateService; the write is
 * stubbed at the api module; the list reads are stubbed at the client module, as in bookings-service-door.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within, act } from "@testing-library/react";

const { BUSINESS, SERVICES } = vi.hoisted(() => ({
  BUSINESS: "biz_merge_1",
  SERVICES: [
    { id: "svc_1", name: "Gel manicure", duration: 60, price: 120, depositRequired: false, depositType: null, depositValue: null },
    { id: "svc_2", name: "Pedicure", duration: 45, price: 80, depositRequired: false, depositType: null, depositValue: null },
  ],
}));

const api = vi.hoisted(() => ({ apiPatch: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPatch: api.apiPatch };
});

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

describe("a saved deposit reaches the Bookings page's list (SWP-SERVICE-DEPOSIT repair round 1)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/identity/businesses/${BUSINESS}`)) {
        return jsonResponse(200, { id: BUSINESS, name: "Merge Salon", slug: "merge-salon", currency: "USD", businessHours: null });
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

  it("MERGE-01 a deposit saved in Setup is still shown after switching to Schedule and back", async () => {
    api.apiPatch.mockResolvedValue({
      data: { ...SERVICES[0], depositRequired: true, depositType: "PERCENT", depositValue: 25 },
      error: null,
      status: 200,
    });
    window.history.replaceState(null, "", "/app/bookings?tab=catalog");
    render(<BookingsPage />);

    const button = await screen.findByRole("button", { name: "Deposit for Gel manicure" });
    await waitFor(() => expect(button).toHaveTextContent("No deposit"));
    fireEvent.click(button);
    const editor = screen.getByRole("group", { name: "Deposit settings for Gel manicure" });
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    fireEvent.change(within(editor).getByLabelText("Deposit percent"), { target: { value: "25" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save deposit" }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Deposit for Gel manicure" })).toHaveTextContent("Deposit 25% · USD 30.00");

    fireEvent.click(screen.getByRole("tab", { name: /Schedule/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Deposit for Gel manicure" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Setup/ }));

    const again = await screen.findByRole("button", { name: "Deposit for Gel manicure" });
    expect(again, "the Setup card after a tab switch").toHaveTextContent("Deposit 25% · USD 30.00");
  });
});
