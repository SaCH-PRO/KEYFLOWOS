import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end coverage for the all-day editing behavior of `EventDrawer`,
 * the side-sheet that powers Google Calendar event create/edit from the
 * unified calendar (`apps/web/src/app/app/keyflow-command/components/event-drawer.tsx`).
 *
 * Why a dedicated fixture page? The drawer normally mounts inside
 * `/app/keyflow-command`, which depends on the entire control-tower data
 * graph (priorities, graph snapshot, action queue, AI hub, …). Driving
 * the real page in Playwright would require mocking ~10 unrelated
 * endpoints just to surface a single drawer. The
 * `/e2e-fixtures/event-drawer` harness mounts the real component
 * directly with controllable initial state via the `?initial=` query
 * param, keeping the test focused on what actually matters here:
 *
 *   1. The date/datetime input toggle works in both directions.
 *   2. All-day events display the END as INCLUSIVE in the UI, but the
 *      payload sent on save is the EXCLUSIVE end Google Calendar
 *      requires (inclusive end + 1 day).
 *   3. Round-tripping an all-day event with no edits does not produce
 *      a phantom PATCH.
 *
 * The save logic lives in `bookings.controller.ts`'s
 * `createExternal` / `updateExternal`, so a regression in the
 * inclusive→exclusive conversion would silently corrupt every all-day
 * event saved from the drawer.
 */

const BUSINESS_ID = "biz_e2e";
const EVENT_ID = "evt_allday_1";

function fixtureUrl(initial: Record<string, unknown>): string {
  const params = new URLSearchParams({
    businessId: BUSINESS_ID,
    initial: JSON.stringify(initial),
  });
  return `/e2e-fixtures/event-drawer?${params.toString()}`;
}

interface CapturedRequest {
  method: string;
  body: Record<string, unknown> | null;
}

async function captureCalendarRequests(page: import("@playwright/test").Page) {
  const requests: CapturedRequest[] = [];

  // Specific event endpoint (PATCH for edits, DELETE for deletes).
  await page.route(
    `**/bookings/businesses/${BUSINESS_ID}/calendar/events/${EVENT_ID}`,
    async (route: Route) => {
      const req = route.request();
      let body: Record<string, unknown> | null = null;
      const raw = req.postData();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
      }
      requests.push({ method: req.method(), body });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: EVENT_ID, ok: true }),
      });
    },
  );

  // Collection endpoint (POST for new events).
  await page.route(
    `**/bookings/businesses/${BUSINESS_ID}/calendar/events`,
    async (route: Route) => {
      const req = route.request();
      let body: Record<string, unknown> | null = null;
      const raw = req.postData();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
      }
      requests.push({ method: req.method(), body });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "evt_new", ok: true }),
      });
    },
  );

  return requests;
}

test.describe("EventDrawer — all-day Google Calendar events", () => {
  test("opens an all-day event with date inputs and inclusive end", async ({
    page,
  }) => {
    await captureCalendarRequests(page);

    // Google sends all-day events with EXCLUSIVE end: a 3-day event
    // (Jun 1 – Jun 3 inclusive) arrives as start=2026-06-01,
    // end=2026-06-04. The drawer must display end=2026-06-03 to the user.
    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Conference",
        description: "Annual offsite",
        start: "2026-06-01",
        end: "2026-06-04",
        allDay: true,
      }),
    );

    await expect(page.getByTestId("fixture-title")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    const allDayCheckbox = page.getByRole("checkbox", { name: /All-day event/ });
    await expect(allDayCheckbox).toBeChecked();

    // Both date inputs must be type="date" (not "datetime-local") in all-day mode.
    const startInput = page.locator('input[type="date"]').nth(0);
    const endInput = page.locator('input[type="date"]').nth(1);
    await expect(startInput).toHaveValue("2026-06-01");
    // Inclusive end: shown as Jun 3, not Jun 4.
    await expect(endInput).toHaveValue("2026-06-03");

    // The label should advertise the inclusive convention to the user.
    await expect(page.getByText("End (inclusive)")).toBeVisible();

    // No timed inputs while all-day is on.
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  });

  test("save with no changes does not issue a PATCH", async ({ page }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Conference",
        start: "2026-06-01",
        end: "2026-06-04",
        allDay: true,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Save changes" }).click();

    // Drawer auto-closes on a no-op save (toast: "No changes").
    await expect(page.getByTestId("closed-count")).toHaveText("1");
    // Crucially — no network request leaves the page.
    expect(requests).toEqual([]);
    // onSaved is also intentionally NOT fired on a no-op save.
    await expect(page.getByTestId("saved-count")).toHaveText("0");
  });

  test("editing the inclusive end date sends an exclusive end on save", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Conference",
        start: "2026-06-01",
        end: "2026-06-04", // exclusive — UI shows Jun 3
        allDay: true,
      }),
    );

    const endInput = page.locator('input[type="date"]').nth(1);
    await expect(endInput).toHaveValue("2026-06-03");

    // Extend the event by two days (now Jun 1 – Jun 5 inclusive).
    await endInput.fill("2026-06-05");

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.body).toMatchObject({
      // allDay was unchanged → not sent. Start was unchanged → not sent.
      end: "2026-06-06", // inclusive Jun 5 → exclusive Jun 6
    });
    // Confirm the diffing logic only sent the end change.
    expect(req.body).not.toHaveProperty("start");
    expect(req.body).not.toHaveProperty("allDay");
    expect(req.body).not.toHaveProperty("summary");

    await expect(page.getByTestId("saved-count")).toHaveText("1");
    await expect(page.getByTestId("closed-count")).toHaveText("1");
  });

  test("toggle all-day → timed swaps inputs and sends ISO datetimes", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Conference",
        start: "2026-06-01",
        end: "2026-06-04",
        allDay: true,
      }),
    );

    const allDayCheckbox = page.getByRole("checkbox", { name: /All-day event/ });
    await expect(allDayCheckbox).toBeChecked();
    await allDayCheckbox.uncheck();

    // Inputs swap to datetime-local; the date portion is preserved and
    // a default 09:00–10:00 window is chosen.
    const startDt = page.locator('input[type="datetime-local"]').nth(0);
    const endDt = page.locator('input[type="datetime-local"]').nth(1);
    await expect(startDt).toHaveValue("2026-06-01T09:00");
    await expect(endDt).toHaveValue("2026-06-03T10:00");
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.body).toMatchObject({ allDay: false });
    expect(typeof req.body?.start).toBe("string");
    expect(typeof req.body?.end).toBe("string");
    // Timed payloads are full ISO timestamps, not bare dates.
    expect(req.body?.start as string).toMatch(/T\d{2}:\d{2}/);
    expect(req.body?.end as string).toMatch(/T\d{2}:\d{2}/);
    // And they round-trip through Date back to the same wall time.
    const startIso = req.body?.start as string;
    const endIso = req.body?.end as string;
    const startLocal = new Date(startIso);
    const endLocal = new Date(endIso);
    expect(startLocal.getFullYear()).toBe(2026);
    expect(startLocal.getMonth()).toBe(5); // June (0-indexed)
    expect(startLocal.getDate()).toBe(1);
    expect(startLocal.getHours()).toBe(9);
    expect(startLocal.getMinutes()).toBe(0);
    expect(endLocal.getDate()).toBe(3);
    expect(endLocal.getHours()).toBe(10);
  });

  test("toggle timed → all-day sends date-only payload with exclusive end", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    // Start from a timed event (Jun 10 14:00 – Jun 10 15:00 local).
    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        allDay: false,
      }),
    );

    // Initial render is timed.
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(2);
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    const allDayCheckbox = page.getByRole("checkbox", { name: /All-day event/ });
    await expect(allDayCheckbox).not.toBeChecked();
    await allDayCheckbox.check();

    // Inputs swap to date pickers and the inclusive-end label appears.
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
    await expect(page.locator('input[type="date"]')).toHaveCount(2);
    await expect(page.getByText("End (inclusive)")).toBeVisible();

    // Both default to the same calendar day (a 1-day all-day event).
    const startInput = page.locator('input[type="date"]').nth(0);
    const endInput = page.locator('input[type="date"]').nth(1);
    const startVal = await startInput.inputValue();
    const endVal = await endInput.inputValue();
    expect(startVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endVal).toBe(startVal);

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.body).toMatchObject({ allDay: true, start: startVal });
    // Inclusive end displayed in UI → exclusive end on the wire = next day.
    const endDate = new Date(`${endVal}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const expectedExclusive = endDate.toISOString().slice(0, 10);
    expect(req.body?.end).toBe(expectedExclusive);
  });

  test("creating a new all-day event posts an exclusive end", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    // No `eventId` → drawer is in create mode.
    await page.goto(
      fixtureUrl({
        summary: "",
        start: "2026-07-04",
        end: "2026-07-04",
        allDay: true,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "New Google event" }),
    ).toBeVisible();

    await page.getByPlaceholder("Event title").fill("Holiday");

    const startInput = page.locator('input[type="date"]').nth(0);
    const endInput = page.locator('input[type="date"]').nth(1);
    await expect(startInput).toHaveValue("2026-07-04");
    await expect(endInput).toHaveValue("2026-07-04");
    // Extend to a 3-day event (Jul 4 – Jul 6 inclusive).
    await endInput.fill("2026-07-06");

    await page.getByRole("button", { name: "Create event" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("POST");
    expect(req.body).toMatchObject({
      summary: "Holiday",
      allDay: true,
      start: "2026-07-04",
      end: "2026-07-07", // inclusive Jul 6 → exclusive Jul 7
    });
    // Bare date strings only — no time component leaked through.
    expect(req.body?.start).not.toMatch(/T/);
    expect(req.body?.end).not.toMatch(/T/);
  });
});
