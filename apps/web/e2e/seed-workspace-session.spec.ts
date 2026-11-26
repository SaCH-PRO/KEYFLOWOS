import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * FU-E2E-MOCKED-SESSION-TOKEN (owner ruling D-283).
 *
 * seedWorkspace stored kf_token = "test-token-e2e". apps/web/src/middleware.ts (isTokenExpiredOrInvalid) lets /app/*
 * through only with a JWT-shaped kf_token cookie (three parts, not expired), so every mocked spec that relied on
 * seedWorkspace alone was sent to /auth/login before the page loaded.
 *
 *   SWS-01 seedWorkspace alone (with the mocked layout and catch-all) reaches /app/crm/contacts and renders it, and the
 *          onboarding gate's read answers onboarded (RED at the base: lands on /auth/login).
 *   SWS-02 the seeded cookie and localStorage hold the same token: three base64url parts, a payload whose exp is in
 *          the future, unsigned (RED at the base: one part).
 *   SWS-03 guard, green at base and head: the middleware is not loosened. Over a seeded workspace, a kf_token cookie
 *          that is malformed, or JWT-shaped but expired, is still sent to /auth/login by the middleware itself: a 307
 *          from /app/crm/contacts, with ?from= and the cookie cleared.
 *
 * Mocked: every API call is answered by page.route on api.test.local; skipped under E2E_LIVE.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5300 pnpm exec playwright test e2e/seed-workspace-session.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked spec: runs without a live API");

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

async function signIn(page: Page): Promise<void> {
  await seedWorkspace(page.context());
  await mockCatchAll(page);
  await mockBaseLayout(page);
}

async function seededCookie(context: BrowserContext): Promise<string | undefined> {
  const cookies = await context.cookies(e2eBaseURL());
  const c = cookies.find((x) => x.name === "kf_token");
  return c ? decodeURIComponent(c.value) : undefined;
}

test("SWS-01 seedWorkspace alone reaches /app/crm/contacts", async ({ page }) => {
  await signIn(page);
  // The onboarding gate (hooks/use-genome-gate.ts) reads this on every /app navigation; an unfinished answer sends the
  // page to /app/onboarding. Waiting on it and reading its body pins mockBaseLayout's answer deterministically.
  const onboardingState = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/onboarding-state"));
  const response = await page.goto("/app/crm/contacts");
  expect(new URL(response!.url()).pathname, "the middleware redirected the seeded session").toBe("/app/crm/contacts");
  expect(response!.request().redirectedFrom(), "no redirect on the way in").toBeNull();

  const state = (await (await onboardingState).json()) as Record<string, unknown>;
  expect(state.onboardingComplete, "the seeded business reads as onboarded").toBe(true);

  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL((u) => u.pathname === "/app/crm/contacts");
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
});

test("SWS-02 the seeded token is JWT-shaped, unexpired and unsigned, in the cookie and in localStorage", async ({ page }) => {
  await signIn(page);
  // Any page of the app's origin runs the init script; a public page keeps the middleware out of it.
  await page.goto("/auth/login");
  const stored = await page.evaluate(() => window.localStorage.getItem("kf_token"));
  const cookie = await seededCookie(page.context());
  expect(cookie, "kf_token cookie").toBeTruthy();
  expect(stored, "localStorage kf_token").toBe(cookie);

  const parts = cookie!.split(".");
  expect(parts, "three dot-separated parts").toHaveLength(3);
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  expect(header.alg, "unsigned test token").toBe("none");
  expect(typeof payload.exp).toBe("number");
  expect(payload.exp as number).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60);
});

for (const [name, token] of [
  ["malformed", "test-token-e2e"],
  [
    "JWT-shaped but expired",
    `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) - 3600 })}.e2e`,
  ],
] as const) {
  test(`SWS-03 guard: a ${name} kf_token cookie is still sent to /auth/login`, async ({ page }) => {
    await signIn(page);
    await page.context().addCookies([{ name: "kf_token", value: token, url: e2eBaseURL(), sameSite: "Lax" }]);
    const response = await page.goto("/app/crm/contacts?tab=all");
    // The middleware's own redirect: the login document was reached from /app/crm/contacts, carries it in ?from=, and
    // the stale cookie was cleared (src/middleware.ts). A client-side bounce would have none of these.
    const landed = new URL(response!.url());
    expect(landed.pathname).toBe("/auth/login");
    expect(landed.searchParams.get("from")).toBe("/app/crm/contacts?tab=all");
    const from = response!.request().redirectedFrom();
    expect(from, "a server redirect led here").not.toBeNull();
    expect(new URL(from!.url()).pathname).toBe("/app/crm/contacts");
    expect((await from!.response())?.status()).toBe(307);
    expect(await seededCookie(page.context()), "the middleware cleared the kf_token cookie").toBeUndefined();
  });
}
