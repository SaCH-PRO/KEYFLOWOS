import type { BrowserContext, Page, Route } from "@playwright/test";

export const TEST_BUSINESS_ID = "biz_e2e";
export const TEST_USER_ID = "user_e2e";
export const TEST_TOKEN = "test-token-e2e";

const businessCache = {
  id: TEST_BUSINESS_ID,
  name: "E2E Test Business",
  businessIntent: "test",
  archetype: "service",
  industry: "test",
  revenueModel: "subscription",
  autopilotEnabled: false,
  autopilotStage: null,
  onboardingComplete: true,
  primaryColor: "#F97316",
  secondaryColor: "#14B8A6",
  currency: "TTD",
};

const userCache = {
  id: TEST_USER_ID,
  email: "e2e@example.com",
  name: "E2E Tester",
  firstName: "E2E",
  lastName: "Tester",
  avatarUrl: null,
  role: "OWNER",
};

/**
 * Seed localStorage so the `/app/*` layout treats the visitor as a signed-in,
 * onboarded user with an active workspace. Must be called before navigation.
 */
export async function seedWorkspace(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ token, businessId, business, user }) => {
      try {
        window.localStorage.setItem("kf_token", token);
        window.localStorage.setItem("kf_business_id", businessId);
        window.localStorage.setItem("kf_business_cache", JSON.stringify(business));
        window.localStorage.setItem("kf_user_cache", JSON.stringify(user));
      } catch {
        /* noop — storage may be unavailable in sandboxed contexts */
      }
    },
    {
      token: TEST_TOKEN,
      businessId: TEST_BUSINESS_ID,
      business: businessCache,
      user: userCache,
    },
  );
}

interface IdentityMockOptions {
  /** Override the business returned from `/identity/businesses/:id`. */
  business?: Record<string, unknown>;
}

/**
 * Mock the identity & notifications endpoints the `/app` layout calls on every
 * page load so it doesn't redirect to onboarding or hammer a real backend.
 */
export async function mockBaseLayout(
  page: Page,
  options: IdentityMockOptions = {},
): Promise<void> {
  const businessPayload = {
    id: TEST_BUSINESS_ID,
    name: "E2E Test Business",
    onboardingComplete: true,
    primaryColor: "#F97316",
    secondaryColor: "#14B8A6",
    currency: "TTD",
    timezone: "America/Port_of_Spain",
    ...options.business,
  };

  await page.route("**/identity/bootstrap", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: userCache, business: businessPayload }),
    }),
  );

  await page.route("**/identity/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(userCache),
    }),
  );

  await page.route(
    `**/identity/businesses/${TEST_BUSINESS_ID}`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(businessPayload),
      }),
  );

  // Notifications + various sidebar/health probes the layout makes — return
  // empty payloads so the layout settles.
  await page.route("**/notifications**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );

  await page.route(
    `**/connectors/businesses/${TEST_BUSINESS_ID}/needs-attention**`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0, connectors: [] }),
      }),
  );
}

/**
 * Generic catch-all so anything we forgot to mock returns 200 + empty array
 * rather than a network failure that surfaces a toast.
 */
export async function mockCatchAll(page: Page): Promise<void> {
  await page.route("**/api.test.local/**", async (route: Route) => {
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
}
