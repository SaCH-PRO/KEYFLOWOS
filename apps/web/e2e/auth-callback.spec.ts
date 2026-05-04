import { test, expect, type Route } from "@playwright/test";

// E2E coverage for the OAuth callback page (task #310).
// Stubs the Supabase user lookup and `/identity/bootstrap` so the test runs
// without a real backend; the server-side middleware path is covered by
// `apps/server/test/auth-callback-bootstrap.e2e.test.ts`.

const FAKE_ACCESS_TOKEN = "fake-supabase-jwt-for-e2e";
const SUPABASE_USER_PATH = /\/auth\/v1\/user/;
const BOOTSTRAP_PATH = /\/identity\/bootstrap$/;

const supabaseUserPayload = {
  id: "supabase-user-id",
  email: "owner@example.com",
  user_metadata: {
    given_name: "Ada",
    family_name: "Lovelace",
    full_name: "Ada Lovelace",
    avatar_url: "https://cdn.example.com/ada.png",
  },
};

test.describe("Auth — Google sign-in callback", () => {
  test("happy path: parses the access token, bootstraps, stores workspace, lands on /app", async ({
    page,
    context,
  }) => {
    await context.route(/\/(connect|crm|commerce|ai|notifications)\//, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await context.route(SUPABASE_USER_PATH, (route: Route) => {
      // Guard: the page must forward the fragment access_token as a Bearer.
      const auth = route.request().headers()["authorization"];
      if (auth !== `Bearer ${FAKE_ACCESS_TOKEN}`) {
        return route.fulfill({ status: 401, body: "{}" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(supabaseUserPayload),
      });
    });

    await context.route(BOOTSTRAP_PATH, (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "supabase-user-id",
            email: "owner@example.com",
            firstName: "Ada",
            lastName: "Lovelace",
            role: "OWNER",
          },
          business: { id: "biz-callback-1", name: "Ada's Workspace" },
        }),
      }),
    );

    await Promise.all([
      page.waitForURL(/\/app(\/.*)?$/, { timeout: 10_000 }),
      page.goto(`/auth/callback#access_token=${FAKE_ACCESS_TOKEN}&token_type=bearer&expires_in=3600`),
    ]);

    const stored = await page.evaluate(() => ({
      token: window.localStorage.getItem("kf_token"),
      bizId: window.localStorage.getItem("kf_business_id"),
      email: window.localStorage.getItem("kf_email"),
      profileDraft: window.localStorage.getItem("kf_profile_draft"),
    }));

    expect(stored.token).toBe(FAKE_ACCESS_TOKEN);
    expect(stored.bizId).toBe("biz-callback-1");
    expect(stored.email).toBe("owner@example.com");
    const draft = JSON.parse(stored.profileDraft as string);
    expect(draft).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
  });

  test("bootstrap 409 account_email_conflict renders the dedicated 'email already in use' screen", async ({
    page,
    context,
  }) => {
    await context.route(SUPABASE_USER_PATH, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(supabaseUserPayload),
      }),
    );

    await context.route(BOOTSTRAP_PATH, (route: Route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 409,
          code: "account_email_conflict",
          message: "An account already exists for this email.",
        }),
      }),
    );

    await page.goto(`/auth/callback#access_token=${FAKE_ACCESS_TOKEN}&token_type=bearer&expires_in=3600`);

    // The page must select the dedicated conflict branch, not the generic
    // "Authentication Error" fallback.
    await expect(page.getByRole("heading", { name: /this email is already in use/i })).toBeVisible();
    await expect(page.getByText(/an account already exists for/i)).toBeVisible();
    await expect(page.getByText(supabaseUserPayload.email)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with email & password/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /contact support/i })).toBeVisible();

    // Negative assertions: must NOT fall through to the generic error screen
    // or surface a raw "Internal Server Error" string.
    await expect(page.getByRole("heading", { name: /authentication error/i })).toHaveCount(0);
    await expect(page.getByText(/internal server error/i)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/auth/callback");
  });
});
