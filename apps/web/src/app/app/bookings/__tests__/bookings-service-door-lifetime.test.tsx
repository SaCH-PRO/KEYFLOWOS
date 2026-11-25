/**
 * SWP-SERVICE-DEPOSIT, the web half, repair round 1: the deposit tip's door applies only to the remount it was kept
 * for (SEC-4 / M-1).
 *
 * WHY this test exists: the door's service is kept outside the page (a module-level slot) so that it survives the
 * remount the App Router makes when serviceId is stripped from the URL (bookings-service-door.test.tsx DOOR-04). The
 * acceptance reviews found the slot was cleared only when Setup handled the door, so it outlived the visit it was
 * for:
 *   - an abandoned load (the page left before its services loaded) kept it, and a later, unrelated visit to Setup
 *     opened that service's deposit editor uninvited;
 *   - a sign-out, or a switch to another business, kept it, and the next user's Setup said "That service was not
 *     found" for a service of the previous business.
 *
 *   LIFE-01  the remount took the door and was abandoned: a later visit to Setup opens nothing
 *   LIFE-02  the page that read the door was left and never remounted: a visit to Setup a minute later opens nothing
 *   LIFE-03  the door was kept for ?tab=catalog: a visit to /app/bookings that then clicks Setup opens nothing
 *   LIFE-04  a sign-out, then another user's business: no "not found" toast and nothing opens
 *   LIFE-05  a switch to another business: no "not found" toast and nothing opens
 *
 * Mounted on the real BookingsPage, WorkspaceShell and CatalogCapacityTab, as bookings-service-door.test.tsx is, with
 * the stored business made switchable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const { ws, SERVICES_BY_BUSINESS } = vi.hoisted(() => ({
  ws: { businessId: "biz_life_A" as string | null },
  SERVICES_BY_BUSINESS: {
    biz_life_A: [
      { id: "svc_1", name: "Gel manicure", duration: 60, price: 120, depositRequired: false, depositType: null, depositValue: null },
      { id: "svc_2", name: "Pedicure", duration: 45, price: 80, depositRequired: false, depositType: null, depositValue: null },
    ],
    biz_life_B: [
      { id: "svc_9", name: "Haircut", duration: 30, price: 50, depositRequired: false, depositType: null, depositValue: null },
    ],
  } as Record<string, unknown[]>,
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
  refreshWorkspace: async () => ws.businessId,
  getStoredBusinessId: () => ws.businessId,
  getCachedBusiness: () => null,
}));

vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  const ok = <T,>(data: T) => async () => ({ data, error: null });
  return {
    ...actual,
    fetchBookings: ok([]),
    fetchServices: async (businessId: string) => ({ data: SERVICES_BY_BUSINESS[businessId] ?? [], error: null }),
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

import { toast } from "sonner";
import BookingsPage from "../page";

const NOT_FOUND = "That service was not found. It may have been removed.";

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

/** Follows the tip's link and leaves the page before its services have loaded (the strip has happened). */
function followTheDoorAndLeave(serviceId = "svc_2") {
  window.history.replaceState(null, "", `/app/bookings?tab=catalog&serviceId=${serviceId}`);
  const page = render(<BookingsPage />);
  expect(window.location.search).toBe("?tab=catalog");
  expect(screen.queryByText("Setup Readiness")).not.toBeInTheDocument();
  page.unmount();
}

/** Waits until Setup has listed `serviceName`'s card and every pending effect has run. */
async function setupListed(serviceName: string) {
  expect(await screen.findByRole("button", { name: `Deposit for ${serviceName}` })).toBeInTheDocument();
  await act(async () => {});
}

function expectNothingOpened() {
  expect(screen.queryByRole("group", { name: /^Deposit settings for/ })).not.toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalledWith(NOT_FOUND);
}

describe("the deposit tip's door applies only to the remount it was kept for (SWP-SERVICE-DEPOSIT repair round 1)", () => {
  beforeEach(() => {
    ws.businessId = "biz_life_A";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      const match = /\/identity\/businesses\/([^/]+)$/.exec(pathname);
      if (match) return jsonResponse(200, { id: match[1], name: "Salon", slug: `salon-${match[1]}`, currency: "USD", businessHours: null });
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

  it("LIFE-01 the remount took the door and was abandoned: a later visit to Setup opens nothing", async () => {
    followTheDoorAndLeave();
    // The remount the door was kept for, also left before its services loaded.
    const remount = render(<BookingsPage />);
    expect(screen.queryByText("Setup Readiness")).not.toBeInTheDocument();
    remount.unmount();

    // Later, an unrelated visit to Setup.
    render(<BookingsPage />);
    await setupListed("Pedicure");
    expectNothingOpened();
  });

  it("LIFE-02 the page that read the door was left and never remounted: a visit a minute later opens nothing", async () => {
    followTheDoorAndLeave();
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60_000);

    render(<BookingsPage />);
    await setupListed("Pedicure");
    expectNothingOpened();
  });

  it("LIFE-03 the door was kept for ?tab=catalog: a visit to Bookings that then opens Setup opens nothing", async () => {
    followTheDoorAndLeave();

    window.history.replaceState(null, "", "/app/bookings");
    render(<BookingsPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Setup/ }));
    await setupListed("Pedicure");
    expectNothingOpened();
  });

  it("LIFE-04 a sign-out, then another user's business: no 'not found' toast and nothing opens", async () => {
    followTheDoorAndLeave();
    // Signed out: the stored business is removed. A visit meanwhile finds no business and loads nothing.
    ws.businessId = null;
    const signedOut = render(<BookingsPage />);
    await act(async () => {});
    expect(screen.queryByText("Setup Readiness")).not.toBeInTheDocument();
    signedOut.unmount();

    // Another user signs in to their own business and opens Setup.
    ws.businessId = "biz_life_B";
    window.history.replaceState(null, "", "/app/bookings?tab=catalog");
    render(<BookingsPage />);
    await setupListed("Haircut");
    expectNothingOpened();
  });

  it("LIFE-05 a switch to another business: no 'not found' toast and nothing opens", async () => {
    followTheDoorAndLeave();
    ws.businessId = "biz_life_B";

    render(<BookingsPage />);
    await setupListed("Haircut");
    expectNothingOpened();
  });
});
