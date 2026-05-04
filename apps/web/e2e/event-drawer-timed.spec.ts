import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end coverage for the timed (non all-day) editing behavior of
 * `EventDrawer`, the side-sheet that powers Google Calendar event
 * create/edit from the unified calendar
 * (`apps/web/src/app/app/keyflow-command/components/event-drawer.tsx`).
 *
 * The all-day paths are covered separately in `event-drawer-allday.spec.ts`.
 * This file focuses on the timed paths:
 *
 *   1. A timed event opens with `datetime-local` inputs (not date inputs)
 *      and the start/end values round-trip through Date back to the same
 *      wall time.
 *   2. Editing title / attendees / notes / start / end and saving sends a
 *      PATCH whose body contains only the fields that actually changed —
 *      the diffing logic in `handleSave` is the contract under test.
 *   3. The delete flow surfaces a `confirm()` prompt and, on accept,
 *      issues a DELETE to the per-event endpoint.
 *   4. Client-side validation guards (empty title, end ≤ start) surface
 *      a toast and crucially do NOT issue a network request.
 *
 * The drawer is mounted via the shared `/e2e-fixtures/event-drawer`
 * harness so the test stays focused on drawer behavior instead of the
 * entire control-tower data graph.
 */

const BUSINESS_ID = "biz_e2e";
const EVENT_ID = "evt_timed_1";

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

  // Collection endpoint (POST for new events) — included for symmetry
  // with the all-day spec; timed-create coverage lives in the all-day
  // spec's pattern and is not duplicated here.
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

test.describe("EventDrawer — timed Google Calendar events", () => {
  test("opens a timed event with datetime-local inputs preserving wall time", async ({
    page,
  }) => {
    await captureCalendarRequests(page);

    // Choose times in the middle of the day so timezone offsets cannot
    // push them across a date boundary in the test environment.
    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        description: "Quarterly review",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        attendees: ["alex@acme.com"],
        allDay: false,
      }),
    );

    await expect(page.getByTestId("fixture-title")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    // Timed events render datetime-local inputs, not date inputs.
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(2);
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    const allDayCheckbox = page.getByRole("checkbox", { name: /All-day event/ });
    await expect(allDayCheckbox).not.toBeChecked();

    // The "(inclusive)" hint is reserved for the all-day mode.
    await expect(page.getByText("End (inclusive)")).toHaveCount(0);

    // Existing fields are populated.
    await expect(page.getByPlaceholder("Event title")).toHaveValue(
      "Strategy sync",
    );
    await expect(
      page.getByPlaceholder("alex@acme.com, sam@acme.com"),
    ).toHaveValue("alex@acme.com");
  });

  test("editing only the title sends a PATCH with summary alone", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        description: "Quarterly review",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        attendees: ["alex@acme.com"],
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    const titleInput = page.getByPlaceholder("Event title");
    await titleInput.fill("Strategy sync (rev 2)");

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    // Only summary is in the patch — diffing must skip everything else.
    expect(req.body).toEqual({ summary: "Strategy sync (rev 2)" });

    await expect(page.getByTestId("saved-count")).toHaveText("1");
    await expect(page.getByTestId("closed-count")).toHaveText("1");
  });

  test("editing title, attendees, notes, start and end sends only those fields", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        description: "Quarterly review",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        attendees: ["alex@acme.com"],
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    // Capture the original input strings so we can edit deterministically
    // without depending on the test runner's timezone.
    const startDt = page.locator('input[type="datetime-local"]').nth(0);
    const endDt = page.locator('input[type="datetime-local"]').nth(1);
    await expect(startDt).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    await expect(endDt).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const originalStart = await startDt.inputValue();
    const originalEnd = await endDt.inputValue();

    // Bump start +1h and end +1h (still end > start).
    function shiftHour(value: string, delta: number): string {
      const d = new Date(value);
      d.setHours(d.getHours() + delta);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const newStart = shiftHour(originalStart, 1);
    const newEnd = shiftHour(originalEnd, 1);

    await page.getByPlaceholder("Event title").fill("Strategy sync v2");
    await page
      .getByPlaceholder("alex@acme.com, sam@acme.com")
      .fill("alex@acme.com, sam@acme.com");
    await page.getByPlaceholder("Agenda, links, context…").fill("New agenda");
    await startDt.fill(newStart);
    await endDt.fill(newEnd);

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");

    // All edited fields are present.
    expect(req.body).toMatchObject({
      summary: "Strategy sync v2",
      description: "New agenda",
      attendees: ["alex@acme.com", "sam@acme.com"],
    });
    // allDay was not toggled → must not be in the patch.
    expect(req.body).not.toHaveProperty("allDay");
    // Timed payloads are full ISO timestamps.
    expect(typeof req.body?.start).toBe("string");
    expect(typeof req.body?.end).toBe("string");
    expect(req.body?.start as string).toMatch(/T\d{2}:\d{2}/);
    expect(req.body?.end as string).toMatch(/T\d{2}:\d{2}/);

    // The wire timestamps round-trip back to the +1h shifted local times.
    const sentStart = new Date(req.body?.start as string);
    const sentEnd = new Date(req.body?.end as string);
    const expectedStart = new Date(newStart);
    const expectedEnd = new Date(newEnd);
    expect(sentStart.getTime()).toBe(expectedStart.getTime());
    expect(sentEnd.getTime()).toBe(expectedEnd.getTime());

    await expect(page.getByTestId("saved-count")).toHaveText("1");
    await expect(page.getByTestId("closed-count")).toHaveText("1");
  });

  test("editing only attendees sends a PATCH with attendees alone", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        description: "Quarterly review",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        attendees: ["alex@acme.com"],
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    // Replace the attendee list. Bare strings without a valid email are
    // filtered out by handleSave's regex, so "not-an-email" must not
    // appear in the payload.
    await page
      .getByPlaceholder("alex@acme.com, sam@acme.com")
      .fill("sam@acme.com, jordan@acme.com, not-an-email");

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.body).toEqual({
      attendees: ["sam@acme.com", "jordan@acme.com"],
    });
  });

  test("delete flow prompts for confirm and issues a DELETE", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    // Accept the native confirm() dialog the drawer pops before deleting.
    let dialogMessage = "";
    page.once("dialog", async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    await page.getByRole("button", { name: /Delete/ }).click();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(dialogMessage).toMatch(/Delete this Google Calendar event/);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("DELETE");
    expect(req.body).toBeNull();

    // onSaved fires on successful delete (so the parent can refresh) and
    // the drawer closes.
    await expect(page.getByTestId("saved-count")).toHaveText("1");
    await expect(page.getByTestId("closed-count")).toHaveText("1");
  });

  test("dismissing the delete confirm does not issue a request", async ({
    page,
  }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
    });

    await page.getByRole("button", { name: /Delete/ }).click();

    // Give any (unwanted) request a moment to fire.
    await page.waitForTimeout(200);
    expect(requests).toEqual([]);
    await expect(page.getByTestId("saved-count")).toHaveText("0");
    await expect(page.getByTestId("closed-count")).toHaveText("0");
  });

  test("empty title blocks save and surfaces a toast", async ({ page }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    await page.getByPlaceholder("Event title").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Title is required")).toBeVisible();

    // No network request and the drawer stays open.
    await page.waitForTimeout(200);
    expect(requests).toEqual([]);
    await expect(page.getByTestId("saved-count")).toHaveText("0");
    await expect(page.getByTestId("closed-count")).toHaveText("0");
  });

  test("end ≤ start blocks save and surfaces a toast", async ({ page }) => {
    const requests = await captureCalendarRequests(page);

    await page.goto(
      fixtureUrl({
        eventId: EVENT_ID,
        summary: "Strategy sync",
        start: "2026-06-10T14:00:00.000Z",
        end: "2026-06-10T15:00:00.000Z",
        allDay: false,
      }),
    );

    await expect(
      page.getByRole("heading", { name: "Edit Google event" }),
    ).toBeVisible();

    const startDt = page.locator('input[type="datetime-local"]').nth(0);
    const endDt = page.locator('input[type="datetime-local"]').nth(1);
    await expect(startDt).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const originalStart = await startDt.inputValue();

    // Set end one hour BEFORE start.
    const d = new Date(originalStart);
    d.setHours(d.getHours() - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    const earlierEnd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    await endDt.fill(earlierEnd);

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("End must be after start")).toBeVisible();

    // No network request and the drawer stays open.
    await page.waitForTimeout(200);
    expect(requests).toEqual([]);
    await expect(page.getByTestId("saved-count")).toHaveText("0");
    await expect(page.getByTestId("closed-count")).toHaveText("0");
  });
});
