import { test, expect, type Page, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

const PREDICTIONS = [
  {
    place_id: "pl_a",
    description: "11 Ariapita Avenue, Port of Spain, Trinidad",
    structured_formatting: {
      main_text: "11 Ariapita Avenue",
      secondary_text: "Port of Spain, Trinidad",
    },
  },
  {
    place_id: "pl_b",
    description: "22 Frederick Street, Port of Spain, Trinidad",
    structured_formatting: {
      main_text: "22 Frederick Street",
      secondary_text: "Port of Spain, Trinidad",
    },
  },
  {
    place_id: "pl_c",
    description: "33 Independence Square, Port of Spain, Trinidad",
    structured_formatting: {
      main_text: "33 Independence Square",
      secondary_text: "Port of Spain, Trinidad",
    },
  },
];

const PLACE_DETAILS_BY_ID: Record<
  string,
  { formatted_address: string; place_id: string }
> = {
  pl_a: {
    place_id: "pl_a",
    formatted_address: "11 Ariapita Avenue, Port of Spain, Trinidad and Tobago",
  },
  pl_b: {
    place_id: "pl_b",
    formatted_address:
      "22 Frederick Street, Port of Spain, Trinidad and Tobago",
  },
  pl_c: {
    place_id: "pl_c",
    formatted_address:
      "33 Independence Square, Port of Spain, Trinidad and Tobago",
  },
};

async function mockMaps(page: Page) {
  await page.route(
    `**/connect/businesses/${TEST_BUSINESS_ID}/maps/autocomplete**`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "OK", predictions: PREDICTIONS }),
      }),
  );
  await page.route(
    `**/connect/businesses/${TEST_BUSINESS_ID}/maps/place/**`,
    (route: Route) => {
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/");
      const id = decodeURIComponent(segments[segments.length - 1] ?? "");
      const result = PLACE_DETAILS_BY_ID[id] ?? PLACE_DETAILS_BY_ID.pl_a;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "OK", result }),
      });
    },
  );
}

test.describe("Address autocomplete component", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    await mockBaseLayout(page);
    await mockMaps(page);
  });

  test("opens, keyboard-navigates, selects, and fires onSelect (Maps page)", async ({
    page,
  }) => {
    // Stub the Maps API key endpoints so the page renders cleanly
    await page.route(
      `**/connect/businesses/${TEST_BUSINESS_ID}/maps/api-key`,
      (route: Route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await page.goto("/app/connect/maps");

    const input = page.getByPlaceholder(/Try: 123 Main Street/);
    await input.click();
    await input.fill("Port of Spain");

    // Dropdown should open with all 3 predictions
    const options = page.getByRole("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("11 Ariapita Avenue");

    // ArrowDown twice → highlight third option, then Enter selects it
    await input.press("ArrowDown");
    await input.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

    await input.press("ArrowDown");
    await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");

    // ArrowUp wraps backwards
    await input.press("ArrowUp");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

    await input.press("Enter");

    // Input is filled with the chosen description (the autocomplete writes
    // back via onChange) and the downstream handler fires the toast with the
    // resolved formattedAddress from the place-details mock.
    await expect(input).toHaveValue(
      "22 Frederick Street, Port of Spain, Trinidad",
    );
    await expect(
      page.getByText(
        /Selected: 22 Frederick Street, Port of Spain, Trinidad and Tobago/,
      ),
    ).toBeVisible();
  });

  test("populates the location field on the Booking form", async ({ page }) => {
    // Mock the bookings page data dependencies
    await page.route(
      `**/bookings/businesses/${TEST_BUSINESS_ID}`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        }),
    );
    await page.route(
      `**/bookings/businesses/${TEST_BUSINESS_ID}/services`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "svc_1",
              name: "Consultation",
              durationMins: 30,
              price: 100,
            },
          ]),
        }),
    );
    await page.route(
      `**/bookings/businesses/${TEST_BUSINESS_ID}/staff`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: "staff_1", name: "Avery Operator", email: "avery@example.com" },
          ]),
        }),
    );
    await page.route(`**/crm/businesses/${TEST_BUSINESS_ID}/contacts**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    // Soft fallback for any other booking-page endpoint we didn't pin down
    await page.route("**/api.test.local/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
    });

    await page.goto("/app/bookings");
    // Open the create booking side sheet
    await page
      .getByRole("button", { name: /^New Booking$/ })
      .first()
      .click();

    const locationInput = page.getByPlaceholder(
      /Where will this booking happen\?/,
    );
    await expect(locationInput).toBeVisible();
    await locationInput.fill("Port of Spain");

    // Dropdown shows our mocked predictions
    const option = page.getByRole("option", {
      name: /11 Ariapita Avenue/,
    });
    await expect(option).toBeVisible();
    await option.click();

    // Downstream field gets the resolved formattedAddress (place details)
    await expect(locationInput).toHaveValue(
      "11 Ariapita Avenue, Port of Spain, Trinidad and Tobago",
    );
  });

  test("populates the address field in Brand Identity (business settings)", async ({
    page,
  }) => {
    // Stub the business detail used by useBusinessSettings
    await page.route(
      `**/identity/businesses/${TEST_BUSINESS_ID}`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: TEST_BUSINESS_ID,
            name: "E2E Test Business",
            slug: "e2e-test-business",
            timezone: "America/Port_of_Spain",
            currency: "TTD",
            onboardingComplete: true,
            address: "",
            city: "",
            country: "Trinidad and Tobago",
            primaryColor: "#F97316",
            secondaryColor: "#14B8A6",
          }),
        }),
    );

    // Profile page uses many side endpoints — fallthrough to empty payloads
    await page.route("**/api.test.local/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
    });

    await page.goto("/app/profile?tab=brand-identity");

    // Expand "Business Information" if it isn't already
    const businessInfoToggle = page.getByRole("button", {
      name: /Business Information/i,
    });
    if (await businessInfoToggle.isVisible()) {
      // Section may be defaultOpen, but click is a no-op-safe toggle if needed.
      const expanded = await businessInfoToggle.getAttribute("aria-expanded");
      if (expanded === "false") await businessInfoToggle.click();
    }

    const addressInput = page.getByPlaceholder(
      "123 Main Street, Port of Spain, Trinidad",
    );
    await expect(addressInput).toBeVisible();
    await addressInput.fill("Port of Spain");

    const option = page.getByRole("option", {
      name: /33 Independence Square/,
    });
    await expect(option).toBeVisible();
    await option.click();

    await expect(addressInput).toHaveValue(
      "33 Independence Square, Port of Spain, Trinidad and Tobago",
    );
  });
});
