import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

test.describe("Connect → Business Profile", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    await mockBaseLayout(page);
  });

  test("publishes a local post for the active location", async ({ page }) => {
    let publishedPostBody: string | null = null;
    let postsPolled = 0;

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/accounts`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            accounts: [
              {
                name: "accounts/1234",
                accountName: "Acme HQ",
                type: "PERSONAL",
              },
            ],
          }),
        }),
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/locations**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            locations: [
              {
                name: "locations/abc",
                title: "Acme — Port of Spain",
                storefrontAddress: {
                  addressLines: ["1 Independence Sq."],
                  locality: "Port of Spain",
                  administrativeArea: "POS",
                },
                websiteUri: "https://acme.example",
                phoneNumbers: { primaryPhone: "+1-868-555-0100" },
              },
            ],
          }),
        }),
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/reviews**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ reviews: [] }),
        }),
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/posts**`,
      async (route: Route) => {
        const method = route.request().method();
        if (method === "GET") {
          postsPolled += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              localPosts: publishedPostBody
                ? [
                    {
                      name: "posts/new",
                      summary: publishedPostBody,
                      state: "LIVE",
                      createTime: new Date().toISOString(),
                      searchUrl:
                        "https://www.google.com/search?q=acme+port+of+spain",
                    },
                  ]
                : [],
            }),
          });
          return;
        }
        if (method === "POST") {
          const body = JSON.parse(route.request().postData() ?? "{}") as {
            summary?: string;
          };
          publishedPostBody = body.summary ?? "";
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ name: "posts/new" }),
          });
          return;
        }
        await route.fallback();
      },
    );

    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/active-location`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        }),
    );

    await page.goto("/app/connect/business-profile");

    await expect(
      page.getByRole("heading", { name: "Google Business Profile" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Acme — Port of Spain" }),
    ).toBeVisible();

    // Active location is auto-selected → composer should be visible
    await page.getByRole("button", { name: /^New post$/ }).click();
    await page
      .getByPlaceholder("What's new for your customers?")
      .fill("Open late this Friday for Carnival prep!");
    await page.getByRole("button", { name: /^Publish$/ }).click();

    await expect(page.getByText("Post published")).toBeVisible();
    await expect(
      page.getByText("Open late this Friday for Carnival prep!"),
    ).toBeVisible();
    expect(publishedPostBody).toBe(
      "Open late this Friday for Carnival prep!",
    );
    expect(postsPolled).toBeGreaterThanOrEqual(1);
  });

  test("renders the empty state when no locations exist", async ({ page }) => {
    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/accounts`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ accounts: [] }),
        }),
    );
    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/business-profile/locations**`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ locations: [] }),
        }),
    );

    await page.goto("/app/connect/business-profile");
    await expect(page.getByText("No locations yet")).toBeVisible();
  });
});
