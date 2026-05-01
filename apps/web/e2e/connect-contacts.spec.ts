import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

test.describe("Connect → Contacts", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    await mockBaseLayout(page);
  });

  test("shows the connector status and runs a sync", async ({ page }) => {
    let syncCount = 0;
    let syncCalled = false;

    await page.route(
      `**/connectors/businesses/${TEST_BUSINESS_ID}/dashboard`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              meta: { type: "google_contacts", name: "Google Contacts" },
              health: {
                status: "connected",
                lastSyncAt: new Date(Date.now() - 3_600_000).toISOString(),
                lastErrorAt: null,
                lastError: null,
                errorCount: 0,
                syncCount,
                connectedAt: new Date(Date.now() - 86_400_000).toISOString(),
                connectedAccount: "owner@example.com",
              },
            },
          ]),
        }),
    );

    await page.route(
      `**/connectors/businesses/${TEST_BUSINESS_ID}/activity**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            syncCalled
              ? [
                  {
                    id: "act_1",
                    action: "sync",
                    status: "success",
                    message: "Synced contacts from Google",
                    itemsAffected: 7,
                    durationMs: 432,
                    createdAt: new Date().toISOString(),
                  },
                ]
              : [],
          ),
        }),
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/contacts/sync`,
      async (route: Route) => {
        if (route.request().method() === "POST") {
          syncCalled = true;
          syncCount += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ imported: 5, updated: 2 }),
          });
          return;
        }
        await route.fallback();
      },
    );

    await page.goto("/app/connect/contacts");

    await expect(
      page.getByRole("heading", { name: "Google Contacts sync" }),
    ).toBeVisible();
    await expect(page.getByText("Connected")).toBeVisible();
    await expect(page.getByText("owner@example.com")).toBeVisible();

    const syncBtn = page.getByRole("button", { name: /Sync now/ });
    await expect(syncBtn).toBeEnabled();
    await syncBtn.click();

    await expect(
      page.getByText(/Synced — 5 imported, 2 updated/),
    ).toBeVisible();
    await expect(page.getByText(/Imported/).first()).toContainText("5");
    await expect(page.getByText("Recent syncs")).toBeVisible();
    await expect(page.getByText("Synced contacts from Google")).toBeVisible();
    expect(syncCalled).toBe(true);
  });

  test("disables sync when the connector is not connected", async ({
    page,
  }) => {
    await page.route(
      `**/connectors/businesses/${TEST_BUSINESS_ID}/dashboard`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              meta: { type: "google_contacts", name: "Google Contacts" },
              health: {
                status: "disconnected",
                lastSyncAt: null,
                lastErrorAt: null,
                lastError: null,
                errorCount: 0,
                syncCount: 0,
                connectedAt: null,
                connectedAccount: null,
              },
            },
          ]),
        }),
    );
    await page.route(
      `**/connectors/businesses/${TEST_BUSINESS_ID}/activity**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        }),
    );

    await page.goto("/app/connect/contacts");
    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sync now/ })).toBeDisabled();
  });
});
