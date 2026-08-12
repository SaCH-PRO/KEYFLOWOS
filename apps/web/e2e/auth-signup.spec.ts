import { test, expect, type Route } from "@playwright/test";

/**
 * Sign-up, which had no e2e spec at all until a real signup broke in
 * production and the owner found it by hand.
 *
 * WHAT SHIPPED, AND WHY EVERY GATE STAYED GREEN
 *
 * The server's middleware began rejecting any request whose Supabase token had
 * no local `User` row. But the order of operations is:
 *
 *   POST /identity/signup     creates the SUPABASE user. No local row yet.
 *   POST /identity/bootstrap  creates the local row.
 *
 * Bootstrap needs an attached user to clear AuthGuard, and bootstrap is the
 * only thing that creates the row the middleware demanded. So bootstrap
 * answered 401, this page surfaced the raw message and `return`ed, and every
 * new account was stranded on the form — with a working account it never
 * learned it had.
 *
 * The server-side suite passed because its middleware helper always resolved a
 * user row, so the no-row state was never exercised. The web suite passed
 * because there was no signup spec. CI was green on both.
 *
 * These tests cover the shape of that failure rather than the specific bug:
 * signup is not finished until the browser is somewhere useful, and a
 * post-signup failure must never leave the user looking at a raw API error with
 * no way forward.
 */

const FIRST = 'input[placeholder="John"]';
const LAST = 'input[placeholder="Doe"]';
const USERNAME = 'input[placeholder="johndoe"]';
const EMAIL = 'input[type="email"]';
const PASSWORD = 'input[placeholder="Create a strong password"]';

/**
 * Signup is TWO steps: name/username, then Continue, then email/password.
 * Worth stating because it is not obvious from the page and it is the reason
 * the first version of these tests timed out looking for an email field that
 * had not been rendered yet.
 */
async function fillSignupForm(page: import("@playwright/test").Page) {
  await page.fill(FIRST, "Ada");
  await page.fill(LAST, "Lovelace");
  await page.fill(USERNAME, `ada${Date.now().toString(36)}`);
  await page.getByRole("button", { name: /continue/i }).first().click();

  await page.waitForSelector(EMAIL, { timeout: 10_000 });
  await page.fill(EMAIL, `ada+${Date.now()}@example.com`);
  await page.fill(PASSWORD, "Correct-Horse-Battery-9!");
}

/** The step-2 submit. Step 1's button is also `type=submit`, hence the name. */
function submitSignup(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /create account/i }).click();
}

/** Username availability + any incidental reads the form makes. */
async function stubAmbient(context: import("@playwright/test").BrowserContext) {
  await context.route(/\/identity\/check-username/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, status: "available" }) }),
  );
  await context.route(/\/(connect|crm|commerce|ai|cortex)\//, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

const AUTHENTICATED_SIGNUP = {
  status: "authenticated",
  email: "ada@example.com",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
};

test.describe("Auth — sign-up pathway", () => {
  test("a successful signup ends up inside the app, not on the form", async ({ page, context }) => {
    // The whole point. Signup is not "done" when the API returns 201 — it is
    // done when the person is somewhere they can work.
    await stubAmbient(context);
    await context.route(/\/identity\/signup$/, (route: Route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(AUTHENTICATED_SIGNUP) }),
    );
    await context.route(/\/identity\/bootstrap$/, (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "u-1", email: "ada@example.com" }, business: { id: "biz-1", name: "Acme" } }),
      }),
    );

    await page.goto("/auth/signup");
    await fillSignupForm(page);
    await submitSignup(page);

    await page.waitForURL(/\/app/, { timeout: 15_000 });
    expect(page.url()).toContain("/app");
  });

  test("bootstrap failing does not strand the user on a raw API error", async ({ page, context }) => {
    // THE REGRESSION TEST. When the middleware rejected new users, bootstrap
    // returned 401 "Authentication required" and this page printed it verbatim
    // and stopped — a message that is both meaningless to a person and untrue,
    // since they had just been authenticated.
    //
    // The assertion is deliberately about what the USER is left with, not about
    // any particular status code: whatever goes wrong after the account exists,
    // the page must not present a bare auth error as the outcome of signing up.
    await stubAmbient(context);
    await context.route(/\/identity\/signup$/, (route: Route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(AUTHENTICATED_SIGNUP) }),
    );
    await context.route(/\/identity\/bootstrap$/, (route: Route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 401, message: "Authentication required" }),
      }),
    );

    await page.goto("/auth/signup");
    await fillSignupForm(page);
    await submitSignup(page);

    // Either it recovers into the app, or it says something a person can act
    // on. "Authentication required" immediately after authenticating is
    // neither.
    await page.waitForTimeout(2500);
    const body = (await page.textContent("body")) ?? "";
    const strandedOnAuthError = !page.url().includes("/app") && /authentication required/i.test(body);

    expect(
      strandedOnAuthError,
      'signup succeeded, then showed "Authentication required" and went nowhere — ' +
        "the account exists and the user has no way to know it",
    ).toBe(false);
  });

  test("a duplicate email is reported as a duplicate, not as a generic failure", async ({ page, context }) => {
    // The second half of what the owner hit: after the first attempt appeared
    // to fail, they clicked again and got "email already registered" — correct,
    // but read as a second bug on top of the first.
    await stubAmbient(context);
    await context.route(/\/identity\/signup$/, (route: Route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 400, message: { code: "email_taken", message: "That email is already registered." } }),
      }),
    );

    await page.goto("/auth/signup");
    await fillSignupForm(page);
    await submitSignup(page);

    await expect(page.getByText(/already registered|already in use|sign in instead/i)).toBeVisible({ timeout: 10_000 });
  });

  test("the Google button goes to Supabase with PKCE, not to a dead end", async ({ page, context }) => {
    // Google cannot be driven end to end in CI, but the hand-off can: the
    // authorize URL must carry a code challenge, or the callback has nothing to
    // exchange and the user lands back on the login screen with no explanation.
    await stubAmbient(context);
    await page.goto("/auth/signup");

    const googleButton = page.getByRole("button", { name: /google/i }).first();
    if ((await googleButton.count()) === 0) test.skip(true, "no Google button rendered in this build");

    let authorizeUrl: string | null = null;
    await context.route(/supabase\.co\/auth\/v1\/authorize/, (route: Route) => {
      authorizeUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>stub</body></html>" });
    });

    await googleButton.click();
    await page.waitForTimeout(1500);

    if (!authorizeUrl) test.skip(true, "Supabase is not configured in this build");
    expect(authorizeUrl!).toContain("provider=google");
    expect(authorizeUrl!, "no PKCE challenge — the callback will have nothing to exchange").toContain("code_challenge=");
    expect(authorizeUrl!).toContain("code_challenge_method=S256");
    expect(authorizeUrl!, "redirect_to must come back to our callback").toContain("%2Fauth%2Fcallback");
  });
});
