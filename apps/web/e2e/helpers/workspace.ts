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
 * Seed localStorage AND the `kf_token` cookie so both the Next.js edge
 * proxy (`apps/web/src/proxy.ts`, which gates `/app/*` on cookie presence)
 * AND the in-page `<RequireAuth>` provider (which reads the token out of
 * localStorage to call `/identity/me`) treat the visitor as a signed-in,
 * onboarded user with an active workspace. Must be called before navigation.
 *
 * Without the cookie the edge proxy redirects every `/app/*` request to
 * `/auth/login` before the page hydrates, so localStorage alone is not
 * enough — that was the cause of the e2e suite flaking out wholesale.
 */
export async function seedWorkspace(context: BrowserContext): Promise<void> {
  // The Playwright base URL may be http://localhost:<port> or a Replit
  // preview domain; addCookies needs an explicit URL list rather than a
  // bare domain so the cookie is scoped correctly for whatever host the
  // tests are running against.
  const baseURL =
    process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5000}`;
  await context.addCookies([
    {
      name: "kf_token",
      value: TEST_TOKEN,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);

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

  // The fetch wrapper appends a `?_t=…` cache-buster to every GET, so the
  // pattern needs the trailing `**` to match the full URL.
  await page.route(
    `**/identity/businesses/${TEST_BUSINESS_ID}**`,
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
 * Generic catch-all so anything we forgot to mock returns 200 + an empty
 * payload rather than a network failure (which would surface a toast or, worse,
 * cause `<RequireAuth>` to bounce the user back to /auth/login on a 401).
 *
 * Covers BOTH the historical `api.test.local` host AND the dev-time
 * same-origin `/__api/*` proxy path.
 */
export async function mockCatchAll(page: Page): Promise<void> {
  const handler = async (route: Route) => {
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
  };
  await page.route("**/api.test.local/**", handler);
  await page.route("**/__api/**", handler);
}
