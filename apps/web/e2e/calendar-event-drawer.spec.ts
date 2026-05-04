import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  mockCatchAll,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

const TIMED_EVENT_ID = "g_evt_timed_1";
const ALL_DAY_EVENT_ID = "g_evt_allday_1";

const minimalControlTowerData = {
  snapshot: {
    business: {
      name: "E2E Test Business",
      industry: null,
      archetype: null,
      currency: "TTD",
    },
    momentumScore: 72,
    healthIndicators: [],
  },
  dashboard: {
    momentumScore: 72,
    monthlyRevenue: 12000,
    outstandingRevenue: 0,
    overdueInvoices: 0,
    overdueAmount: 0,
    activeProjects: 2,
    overdueTaskCount: 0,
    upcomingBookings: 3,
    staleLeads: 0,
    pendingQuotes: 0,
    pendingQuoteValue: 0,
    expensesThisMonth: 0,
    utilizationRate: 0.65,
  },
  priorities: [],
  risks: [],
  pendingApprovals: 0,
  modules: {
    contacts: { total: 14, byStatus: {}, recentCount: 0, staleLeadCount: 0 },
    revenue: { totalCollected: 0, outstandingAmount: 0, outstandingCount: 0, overdueCount: 0, overdueAmount: 0, monthlyRevenue: 12000, averageInvoiceValue: 0 },
    bookings: { upcomingCount: 3, completedThisMonth: 0, cancelledThisMonth: 0, utilizationRate: 65 },
    expenses: { totalThisMonth: 0, topCategories: [], budgetUtilization: 0 },
    projects: { activeCount: 2, overdueTaskCount: 0, completionRate: 100 },
    content: { draftPostCount: 0, scheduledPostCount: 0, draftCampaignCount: 0 },
    automations: { activeCount: 1, disabledCount: 0, totalRuns: 0 },
    storefront: { activeProductCount: 0, averagePrice: 0 },
  },
};

function buildEvents(now: Date) {
  const todayStart = new Date(now);
  todayStart.setHours(14, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(15, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const allDayStart = new Date(tomorrow);
  allDayStart.setHours(0, 0, 0, 0);
  const allDayEnd = new Date(allDayStart);
  allDayEnd.setDate(allDayEnd.getDate() + 1);

  return [
    {
      id: `google-${TIMED_EVENT_ID}`,
      kind: "google_event",
      title: "Strategy sync",
      description: "Weekly review",
      start: todayStart.toISOString(),
      end: todayEnd.toISOString(),
      allDay: false,
      href: "https://calendar.google.com/event?eid=timed",
      refType: "google_event",
      refId: TIMED_EVENT_ID,
      color: "#34a853",
      source: "google",
      meta: {
        location: "HQ",
        organizer: "owner@acme.com",
        attendees: [{ email: "alex@acme.com", displayName: "Alex" }],
        allDay: false,
      },
    },
    {
      id: `google-${ALL_DAY_EVENT_ID}`,
      kind: "google_event",
      title: "Public holiday",
      description: undefined,
      start: allDayStart.toISOString().slice(0, 10),
      end: allDayEnd.toISOString().slice(0, 10),
      allDay: true,
      href: "https://calendar.google.com/event?eid=allday",
      refType: "google_event",
      refId: ALL_DAY_EVENT_ID,
      color: "#34a853",
      source: "google",
      meta: {
        attendees: [],
        allDay: true,
      },
    },
  ];
}

interface RecordedRequests {
  patch: Array<{ url: string; body: any }>;
  post: Array<{ url: string; body: any }>;
  delete: Array<{ url: string }>;
}

async function setupKeyflowMocks(page: Parameters<typeof mockBaseLayout>[0]) {
  const recorded: RecordedRequests = { patch: [], post: [], delete: [] };

  // Single dispatcher route covering every endpoint the page hits. Matching one
  // pattern at a time was racing with the dev server (some requests slipped
  // through before specific patterns took effect), so we intercept all `/__api/*`
  // traffic up front and dispatch by path.
  await page.route((url) => url.pathname.startsWith("/__api/"), async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const path = new URL(url).pathname;

    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path.endsWith(`/bookings/businesses/${TEST_BUSINESS_ID}/calendar/status`)) {
      return json(200, {
        connected: true,
        email: "owner@acme.com",
        syncDirection: "two_way",
        syncEnabled: true,
      });
    }
    if (path.endsWith(`/keyflow/businesses/${TEST_BUSINESS_ID}/events`)) {
      return json(200, {
        events: buildEvents(new Date()),
        range: { timeMin: "", timeMax: "" },
      });
    }
    if (path.endsWith(`/ai/businesses/${TEST_BUSINESS_ID}/ai/control-tower`)) {
      return json(200, minimalControlTowerData);
    }
    if (path.endsWith(`/graph/business/${TEST_BUSINESS_ID}`)) {
      return json(200, { snapshot: null, links: [], linkCount: 0 });
    }
    if (path.endsWith(`/actions/businesses/${TEST_BUSINESS_ID}/queue`)) {
      return json(200, { items: [] });
    }
    if (path.endsWith(`/growth-intelligence/businesses/${TEST_BUSINESS_ID}/dashboard`)) {
      return json(200, {
        kpis: {
          totalContacts: 0,
          activeJourneys: 0,
          conversions30d: 0,
          conversionRate: 0,
          attributedRevenue: 0,
          attributedRevenueLabel: "TT$0",
          touchpoints30d: 0,
          avgDaysToConversion: 0,
          avgJourneyHealth: 0,
        },
        funnel: [],
        channelMix: [],
        attribution: { dimension: "channel", byModel: {} },
        atRiskContacts: [],
        topContacts: [],
        insights: [],
      });
    }
    if (path.endsWith(`/ai/businesses/${TEST_BUSINESS_ID}/ai/monitoring/insights`)) {
      return json(200, { insights: [] });
    }
    if (path.endsWith(`/ai/businesses/${TEST_BUSINESS_ID}/ai/strategic/weekly-plan`)) {
      return json(200, { plan: null, generatedAt: null, items: [] });
    }
    if (path.endsWith(`/identity/businesses/${TEST_BUSINESS_ID}`)) {
      return json(200, {
        id: TEST_BUSINESS_ID,
        name: "E2E Test Business",
        onboardingComplete: true,
        primaryColor: "#F97316",
        secondaryColor: "#14B8A6",
        currency: "TTD",
        timezone: "America/Port_of_Spain",
      });
    }
    if (path.includes(`/bookings/businesses/${TEST_BUSINESS_ID}/calendar/events`)) {
      if (method === "POST") {
        recorded.post.push({ url, body: req.postDataJSON() });
        return json(201, { id: "evt_created_123" });
      }
      if (method === "PATCH") {
        recorded.patch.push({ url, body: req.postDataJSON() });
        return json(200, { id: "evt_patched", success: true });
      }
      if (method === "DELETE") {
        recorded.delete.push({ url });
        return json(200, { success: true });
      }
    }
    // Default: empty payload so the page never sees a network failure.
    return json(200, method === "GET" ? [] : {});
  });

  return recorded;
}

test.describe("KEYFLOW unified calendar — Google event drawer", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    // Register catch-all BEFORE specific routes — Playwright matches routes in
    // reverse-registration order, so the more specific ones win.
    await mockCatchAll(page);
    await mockBaseLayout(page);
  });

  test("creates a new event from the toolbar with a POST to /calendar/events", async ({
    page,
  }) => {
    const recorded = await setupKeyflowMocks(page);

    await page.goto("/app/keyflow-command");

    await expect(page.getByRole("heading", { name: "Unified Calendar" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /new event/i }).click();

    await expect(page.getByRole("heading", { name: /new google event/i })).toBeVisible();

    await page.getByPlaceholder("Event title").fill("Quarterly review");
    await page.getByPlaceholder(/alex@acme\.com/).fill("alex@acme.com, sam@acme.com");
    await page.getByPlaceholder(/agenda, links, context/i).fill("Slides + revenue");

    await page.getByRole("button", { name: /create event/i }).click();

    await expect.poll(() => recorded.post.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(recorded.post[0].body).toMatchObject({
      summary: "Quarterly review",
      description: "Slides + revenue",
      attendees: ["alex@acme.com", "sam@acme.com"],
    });
    expect(typeof recorded.post[0].body.start).toBe("string");
    expect(typeof recorded.post[0].body.end).toBe("string");
  });

  test("editing a timed event sends a PATCH containing only the changed fields", async ({
    page,
  }) => {
    const recorded = await setupKeyflowMocks(page);

    await page.goto("/app/keyflow-command");
    await expect(page.getByRole("heading", { name: "Unified Calendar" })).toBeVisible({
      timeout: 15_000,
    });

    const timedRow = page.getByRole("button", { name: /strategy sync/i });
    await expect(timedRow).toBeVisible();
    await timedRow.click();

    await expect(page.getByRole("heading", { name: /edit google event/i })).toBeVisible();

    const titleInput = page.getByPlaceholder("Event title");
    await expect(titleInput).toHaveValue("Strategy sync");
    await titleInput.fill("Strategy sync — updated");

    await page.getByRole("button", { name: /save changes/i }).click();

    await expect.poll(() => recorded.patch.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const patch = recorded.patch[0];
    expect(patch.url).toContain(`/calendar/events/${TIMED_EVENT_ID}`);
    expect(patch.body).toEqual({ summary: "Strategy sync — updated" });
    expect(patch.body).not.toHaveProperty("start");
    expect(patch.body).not.toHaveProperty("end");
    expect(patch.body).not.toHaveProperty("attendees");
    expect(patch.body).not.toHaveProperty("description");
  });

  test("deleting a timed event sends a DELETE to /calendar/events/:id", async ({
    page,
  }) => {
    const recorded = await setupKeyflowMocks(page);

    await page.addInitScript(() => {
      window.confirm = () => true;
    });

    await page.goto("/app/keyflow-command");
    await expect(page.getByRole("heading", { name: "Unified Calendar" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /strategy sync/i }).click();
    await expect(page.getByRole("heading", { name: /edit google event/i })).toBeVisible();

    await page.getByRole("button", { name: /^delete$/i }).click();

    await expect.poll(() => recorded.delete.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(recorded.delete[0].url).toContain(`/calendar/events/${TIMED_EVENT_ID}`);
  });

  test("all-day Google events are rendered but not clickable", async ({ page }) => {
    await setupKeyflowMocks(page);

    await page.goto("/app/keyflow-command");
    await expect(page.getByRole("heading", { name: "Unified Calendar" })).toBeVisible({
      timeout: 15_000,
    });

    // The all-day event is visible somewhere in the agenda.
    await expect(page.getByText(/public holiday/i).first()).toBeVisible();

    // It must NOT be exposed as a button (timed events are; all-day events aren't).
    await expect(
      page.getByRole("button", { name: /public holiday/i }),
    ).toHaveCount(0);

    // For sanity: the timed event IS exposed as a button.
    await expect(
      page.getByRole("button", { name: /strategy sync/i }).first(),
    ).toBeVisible();

    // Clicking the all-day text doesn't open the drawer.
    await page.getByText(/public holiday/i).first().click({ force: true });
    await expect(
      page.getByRole("heading", { name: /edit google event/i }),
    ).toHaveCount(0);
  });
});
