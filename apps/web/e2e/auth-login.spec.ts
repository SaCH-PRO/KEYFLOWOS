import { test, expect, type Route } from "@playwright/test";

test.describe("Auth — sign-in pathway", () => {
  test("`?reset=1` lights the password-updated banner", async ({ page }) => {
    await page.goto("/auth/login?reset=1");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(
      page.getByText(/password updated\. sign in with your new password\./i),
    ).toBeVisible();
  });

  test("`?verified=1` lights the email-verified banner", async ({ page }) => {
    await page.goto("/auth/login?verified=1");
    await expect(page.getByText(/email verified! sign in to continue\./i)).toBeVisible();
  });

  test("`email_not_confirmed` failure surfaces the Resend affordance", async ({ page, context }) => {
    await context.route(/\/identity\/login$/, (route: Route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "email_not_confirmed",
          message: "Please verify your email before signing in.",
        }),
      }),
    );

    await page.goto("/auth/login");
    await page.getByPlaceholder(/you@example\.com/i).fill("unconfirmed@example.com");
    await page.getByPlaceholder(/enter your password/i).fill("StrongPass123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/please verify your email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /resend verification email/i })).toBeVisible();
  });

  test("`invalid_credentials` failure shows a friendly mapped error", async ({ page, context }) => {
    await context.route(/\/identity\/login$/, (route: Route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "invalid_credentials",
          message: "Invalid email or password.",
        }),
      }),
    );

    await page.goto("/auth/login");
    await page.getByPlaceholder(/you@example\.com/i).fill("wrong@example.com");
    await page.getByPlaceholder(/enter your password/i).fill("WrongPass123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/that email and password don't match/i)).toBeVisible();
  });

  test("happy-path login stores the token, bootstraps a workspace, and lands on /app", async ({ page, context }) => {
    await context.route(/\/(connect|crm|commerce|ai)\//, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
    await context.route(/\/identity\/login$/, (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "authenticated",
          email: "owner@example.com",
          accessToken: "test-access-token",
          refreshToken: "test-refresh-token",
        }),
      }),
    );
    await context.route(/\/identity\/bootstrap$/, (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "u-1", email: "owner@example.com" },
          business: { id: "biz-1", name: "Acme" },
        }),
      }),
    );
    await context.route(/\/identity\/(me|businesses)/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await page.goto("/auth/login");
    await page.getByPlaceholder(/you@example\.com/i).fill("owner@example.com");
    await page.getByPlaceholder(/enter your password/i).fill("StrongPass123");
    await Promise.all([
      page.waitForURL(/\/app(\/.*)?$/, { timeout: 10_000 }),
      page.getByRole("button", { name: /sign in/i }).click(),
    ]);

    const stored = await page.evaluate(() => ({
      token: window.localStorage.getItem("kf_token"),
      bizId: window.localStorage.getItem("kf_business_id"),
    }));
    expect(stored.token).toBe("test-access-token");
    expect(stored.bizId).toBe("biz-1");
  });

  test("`rate_limited` (429) surfaces the throttle message", async ({ page, context }) => {
    await context.route(/\/identity\/login$/, (route: Route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          code: "rate_limited",
          message: "Too many attempts. Try again later.",
        }),
      }),
    );

    await page.goto("/auth/login");
    await page.getByPlaceholder(/you@example\.com/i).fill("rate@example.com");
    await page.getByPlaceholder(/enter your password/i).fill("StrongPass123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/too many attempts/i)).toBeVisible();
  });
});
