import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

test.describe("Connect → Maps", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    await mockBaseLayout(page);
  });

  test("saves an API key and runs the autocomplete test", async ({ page }) => {
    let savedKey: string | null = null;

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/maps/api-key`,
      async (route: Route) => {
        const method = route.request().method();
        if (method === "POST") {
          const body = JSON.parse(route.request().postData() ?? "{}") as {
            apiKey?: string;
          };
          savedKey = body.apiKey ?? null;
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

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/maps/autocomplete**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "OK",
            predictions: [
              {
                place_id: "pl_pos_1",
                description: "123 Main Street, Port of Spain, Trinidad",
                structured_formatting: {
                  main_text: "123 Main Street",
                  secondary_text: "Port of Spain, Trinidad",
                },
              },
              {
                place_id: "pl_pos_2",
                description: "123 Main Street, San Fernando, Trinidad",
                structured_formatting: {
                  main_text: "123 Main Street",
                  secondary_text: "San Fernando, Trinidad",
                },
              },
            ],
          }),
        }),
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/maps/place/**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "OK",
            result: {
              place_id: "pl_pos_1",
              name: "Acme HQ",
              formatted_address:
                "123 Main Street, Port of Spain, Trinidad and Tobago",
              geometry: { location: { lat: 10.6549, lng: -61.5019 } },
              address_components: [
                { long_name: "Trinidad", short_name: "TT", types: ["country"] },
              ],
            },
          }),
        }),
    );

    await page.goto("/app/connect/maps");

    await expect(
      page.getByRole("heading", { name: "Google Maps" }),
    ).toBeVisible();

    await page.getByPlaceholder("AIza…").fill("AIzaSyDUMMY-key-1234567890");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Maps API key saved")).toBeVisible();
    await expect(page.getByText(/Saved — try the test below/)).toBeVisible();
    expect(savedKey).toBe("AIzaSyDUMMY-key-1234567890");

    // Run the autocomplete test box and select a prediction
    const testInput = page.getByPlaceholder(/Try: 123 Main Street/);
    await testInput.fill("123 Main");

    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(
      page.getByText(/Selected: 123 Main Street, Port of Spain/),
    ).toBeVisible();
  });

  test("clears the saved API key after confirming", async ({ page }) => {
    let cleared = false;
    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/maps/api-key`,
      async (route: Route) => {
        if (route.request().method() === "DELETE") {
          cleared = true;
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

    await page.goto("/app/connect/maps");
    await page.getByRole("button", { name: /^Clear$/ }).click();

    const confirm = page
      .getByRole("dialog")
      .getByRole("button", { name: /^Clear key$/ });
    await expect(confirm).toBeVisible();
    await confirm.click();

    await expect(page.getByText("Maps API key cleared")).toBeVisible();
    expect(cleared).toBe(true);
  });
});
