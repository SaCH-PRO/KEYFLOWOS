import type { BrowserContext, Page, Route } from "@playwright/test";

export const TEST_BUSINESS_ID = "biz_e2e";
export const TEST_USER_ID = "user_e2e";
export const TEST_TOKEN = jwtShapedTestToken(TEST_USER_ID);

/**
 * An unsigned, JWT-shaped session token for the mocked specs (FU-E2E-MOCKED-SESSION-TOKEN, D-283).
 *
 * The edge middleware (apps/web/src/middleware.ts isTokenExpiredOrInvalid) lets /app/* through only when the
 * kf_token cookie has three dot-separated parts and a payload that is not expired; it cannot check a signature at
 * the edge and does not try. The old "test-token-e2e" was one part, so every /app/* request of a spec that relied on
 * seedWorkspace alone was sent to /auth/login. This token passes that shape check and nothing more: alg "none",
 * a placeholder signature, no secret. The mocked API (page.route) never verifies it; a real API would refuse it.
 * exp is a day after the module loads, well past any run.
 */
function jwtShapedTestToken(sub: string): string {
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub, iat: now, exp: now + 24 * 3600 })}.e2e`;
}

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

/** The web origin the specs drive (playwright.config.ts BASE_URL). */
export function e2eBaseURL(): string {
  return process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5000}`;
}

/**
 * GATE-HARNESS: the live counterpart of seedWorkspace, for specs that drive a
 * real API (e2e/journeys/). A signed-in session stored the way the web app
 * stores one (lib/workspace.ts setStoredToken / setStoredBusinessId:
 * localStorage kf_token and kf_business_id, plus the cookies of the same names
 * the edge middleware, src/middleware.ts, gates /app/* on), as a Playwright storageState. A context
 * starts from it once, so the app is free to change or clear the session
 * afterwards: sign-out really signs out, which an init script would undo.
 */
export function liveSessionState(
  token: string,
  businessId: string,
  baseURL: string = e2eBaseURL(),
): {
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Lax" }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
} {
  const url = new URL(baseURL);
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  // The app writes these cookies with encodeURIComponent (release0-live.spec.ts storeSession).
  const cookie = (name: string, value: string) => ({
    name,
    value: encodeURIComponent(value),
    domain: url.hostname,
    path: "/",
    expires,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  });
  return {
    cookies: [cookie("kf_token", token), cookie("kf_business_id", businessId)],
    origins: [
      {
        origin: url.origin,
        localStorage: [
          { name: "kf_token", value: token },
          { name: "kf_business_id", value: businessId },
        ],
      },
    ],
  };
}

/**
 * Seed localStorage AND the `kf_token` cookie so both the Next.js edge
 * middleware (`apps/web/src/middleware.ts`, which gates `/app/*` on a
 * JWT-shaped, unexpired cookie: see TEST_TOKEN)
 * AND the in-page `<RequireAuth>` provider (which reads the token out of
 * localStorage to call `/identity/me`) treat the visitor as a signed-in,
 * onboarded user with an active workspace. Must be called before navigation.
 *
 * Without the cookie the edge middleware redirects every `/app/*` request to
 * `/auth/login` before the page hydrates, so localStorage alone is not
 * enough — that was the cause of the e2e suite flaking out wholesale.
 */
export async function seedWorkspace(context: BrowserContext): Promise<void> {
  // The Playwright base URL may be http://localhost:<port> or any deployed
  // preview domain; addCookies needs an explicit URL list rather than a
  // bare domain so the cookie is scoped correctly for whatever host the
  // tests are running against.
  const baseURL = e2eBaseURL();
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
 * Mock the identity, onboarding-state & notifications endpoints the `/app`
 * layout calls on every page load so it doesn't redirect to onboarding or
 * hammer a real backend.
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

  // The onboarding gate (hooks/use-genome-gate.ts) reads this on every /app
  // navigation. An onboarded business, matching the caches seedWorkspace
  // stores: without it, mockCatchAll's empty [] reads as "not finished" and the
  // gate sends the page to /app/onboarding (FU-E2E-MOCKED-SESSION-TOKEN).
  await page.route(
    `**/onboarding-concierge/businesses/${TEST_BUSINESS_ID}/onboarding-state**`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          step: "complete",
          onboardingComplete: true,
          onboardingStartedAt: "2026-01-01T00:00:00.000Z",
          onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
          threePillarMet: true,
          setupStatus: null,
        }),
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
