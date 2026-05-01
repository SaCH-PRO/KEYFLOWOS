import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

test.describe("Connect → Forms", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    await mockBaseLayout(page);
  });

  test("lists forms, creates a new form, then deletes one", async ({
    page,
  }) => {
    const forms = [
      {
        id: "form_1",
        name: "Customer feedback",
        createdTime: "2025-01-10T10:00:00Z",
        modifiedTime: "2025-02-20T10:00:00Z",
        webViewLink: "https://docs.google.com/forms/d/form_1",
      },
      {
        id: "form_2",
        name: "Lead intake",
        createdTime: "2025-03-01T12:00:00Z",
        modifiedTime: "2025-03-05T12:00:00Z",
        webViewLink: "https://docs.google.com/forms/d/form_2",
      },
    ];

    let listCalls = 0;
    let createCalled = false;
    let deletedId: string | null = null;

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/forms`,
      async (route: Route) => {
        const method = route.request().method();
        if (method === "GET") {
          listCalls += 1;
          const remaining = deletedId
            ? forms.filter((f) => f.id !== deletedId)
            : forms;
          const withCreated = createCalled
            ? [
                ...remaining,
                {
                  id: "form_new",
                  name: "Booking intake",
                  createdTime: "2025-04-15T09:00:00Z",
                  modifiedTime: "2025-04-15T09:00:00Z",
                  webViewLink: "https://docs.google.com/forms/d/form_new",
                },
              ]
            : remaining;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ files: withCreated }),
          });
          return;
        }
        if (method === "POST") {
          createCalled = true;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ formId: "form_new" }),
          });
          return;
        }
        await route.fallback();
      },
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/forms/*`,
      async (route: Route) => {
        if (route.request().method() === "DELETE") {
          const url = new URL(route.request().url());
          deletedId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
          });
          return;
        }
        await route.fallback();
      },
    );

    await page.goto("/app/connect/forms");
    await expect(
      page.getByRole("heading", { name: "Google Forms" }),
    ).toBeVisible();
    await expect(page.getByText("Customer feedback")).toBeVisible();
    await expect(page.getByText("Lead intake")).toBeVisible();
    expect(listCalls).toBeGreaterThanOrEqual(1);

    // Open the create panel and submit a new form
    await page.getByRole("button", { name: /^New form$/ }).click();
    await page.getByPlaceholder("Customer feedback").fill("Booking intake");
    await page.getByRole("button", { name: /^Create$/ }).click();

    await expect(page.getByText("Form created")).toBeVisible();
    await expect(page.getByText("Booking intake")).toBeVisible();
    expect(createCalled).toBe(true);

    // Delete the original form and confirm via dialog
    const leadCard = page
      .locator("div", { has: page.getByRole("heading", { name: "Lead intake" }) })
      .first();
    await leadCard.getByRole("button", { name: /^Delete$/ }).click();

    const confirmDelete = page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete$/ });
    await expect(confirmDelete).toBeVisible();
    await confirmDelete.click();

    await expect(page.getByText("Form deleted")).toBeVisible();
    await expect(page.getByText("Lead intake")).toHaveCount(0);
    expect(deletedId).toBe("form_2");
  });

  test("shows the empty state when no forms come back", async ({ page }) => {
    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/forms`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ files: [] }),
        }),
    );

    await page.goto("/app/connect/forms");
    await expect(page.getByText("No forms yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Create form$/ }),
    ).toBeVisible();
  });
});
