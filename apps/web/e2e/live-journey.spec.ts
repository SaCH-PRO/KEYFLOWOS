import { test, expect, type Page } from "@playwright/test";

/**
 * The whole path a real person walks, against a REAL stack. Nothing is mocked.
 *
 * Twelve of the eighteen specs beside this one call `page.route(...)` to stub
 * the network. That is the right choice for testing a component's behaviour,
 * and it is why they all stayed green while `POST /uploads/request-url`
 * returned 403 to every user in the product: the tests drove the real component
 * against a fixture of what the server was assumed to return.
 *
 * So this file mocks NOTHING. It needs a live API, a live web server and a real
 * Postgres, and it fails when any link in the chain is broken — which is
 * exactly the property the mocked specs cannot have.
 *
 *   RUN:  E2E_LIVE=1 npx playwright test e2e/live-journey.spec.ts
 *   with the stack already up (scripts/verify-up.sh should pass 4/4).
 *
 * It creates a real account and real rows. The account is deliberately left
 * behind rather than deleted in an `afterAll`: a cleanup step that runs after a
 * failure destroys the evidence you need to diagnose it. Probe accounts use the
 * `journey-` prefix and are removed by the caller.
 */

const LIVE = process.env.E2E_LIVE === "1";

// Skipped by default so CI, which has no stack, does not report failures that
// mean "nothing was running" — the outcome that trained people to ignore this
// suite in the first place.
test.describe(LIVE ? "Live journey" : "Live journey (skipped: set E2E_LIVE=1)", () => {
  test.skip(!LIVE, "requires a running API, web server and database");
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now();
  const EMAIL = `journey-${stamp}@keyflow.test`;
  const PASSWORD = "Correct-Horse-Battery-9!";

  const FIRST = 'input[placeholder="John"]';
  const LAST = 'input[placeholder="Doe"]';
  const USERNAME = 'input[placeholder="johndoe"]';
  const EMAIL_INPUT = 'input[type="email"]';
  const PASSWORD_INPUT = 'input[placeholder="Create a strong password"]';

  /** Anything the app logged that a user would experience as breakage. */
  function watchForFailures(page: Page, sink: string[]) {
    page.on("console", (m) => {
      if (m.type() === "error") sink.push(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => sink.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on("response", (r) => {
      // 401 on an unauthenticated read is normal; 5xx never is.
      if (r.status() >= 500) sink.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
  }

  /**
   * ONE test, not four.
   *
   * The first version split this into four `test()` blocks and the in-app step
   * failed with every screen redirecting to login. That was the test's fault:
   * Playwright gives each test a fresh browser context, and `describe.serial`
   * preserves ORDER, not storage. The session established by the login step
   * simply did not exist in the next one.
   *
   * Worth keeping as a comment because the failure looked exactly like a real
   * session bug — six screens bouncing to login is a convincing symptom — and
   * the evidence that it was not came from driving the same steps in a single
   * context, where /app stays on /app.
   */
  test("landing -> signup -> in-app, in one continuous session", async ({ page }) => {
    const failures: string[] = [];
    watchForFailures(page, failures);

    // ── landing ──────────────────────────────────────────────────────────
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    const entry = page.getByRole("link", { name: /sign in|log in|get started|start/i });
    expect(await entry.count(), "landing page offers no route into the product").toBeGreaterThan(0);

    // ── signup ───────────────────────────────────────────────────────────
    await page.goto("/auth/signup");
    await page.fill(FIRST, "Journey");
    await page.fill(LAST, "Probe");
    await page.fill(USERNAME, `journey${stamp.toString(36)}`);
    await page.getByRole("button", { name: /continue/i }).first().click();

    await page.waitForSelector(EMAIL_INPUT, { timeout: 15_000 });
    await page.fill(EMAIL_INPUT, EMAIL);
    await page.fill(PASSWORD_INPUT, PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    // Signup is not done when the API returns 201 — it is done when the person
    // is somewhere they can work. A previous regression left every new account
    // stranded on this form with a working account it never learned it had.
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/signup"), { timeout: 60_000 });
    expect(page.url(), "signup left the user on the form").not.toContain("/auth/signup");

    // The session must actually exist, not merely appear to.
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("kf_")));
    expect(keys, "signup did not establish a session").toContain("kf_token");

    // ── in-app ───────────────────────────────────────────────────────────
    const broken: string[] = [];
    for (const path of ["/app", "/app/people-flow", "/app/commerce", "/app/money", "/app/schedule/calendar", "/app/profile"]) {
      const before = failures.length;
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      const status = res?.status() ?? 0;
      if (page.url().includes("/auth/login")) broken.push(`${path}: redirected to login`);
      else if (status >= 400) broken.push(`${path}: HTTP ${status}`);
      else if (failures.length > before) broken.push(`${path}: ${failures[before]}`);
    }
    expect(broken, "these screens did not render for a signed-in user").toEqual([]);
  });
});
