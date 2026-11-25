import { test, expect, type Page, type Route } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * FU-STUDIO-PAGE-SCOPE (owner ruling D-283), the browser half. The jsdom half is
 * src/__tests__/studio-page-scope.test.tsx (SPS-01..06).
 *
 * /studio ("Business Setup") listed Notifications, Webhooks & API and Payment Gateways, with Business Profile and
 * Compliance & Tax, to anyone who typed the URL: no module filter, and outside the /app shell. The page is removed and
 * next.config.ts answers /studio with a 307 to /app/settings, whose index offers each entry only when the member's
 * modules open it.
 *
 *   SPB-01 a member whose settings access is none, at /studio: no settings entry anywhere on the page, and the page is
 *          /app/settings, offering only My account (RED at the base: /studio lists the settings entries).
 *   SPB-02 a settings reader, at /studio: /app/settings, offering Getting paid and Notifications.
 *   SPB-03 an owner, at /studio: /app/settings, offering all eight entries.
 *   SPB-04 a signed-out visitor, at /studio: the sign-in page, no settings entry.
 *   SPB-05 the /studio request itself answers 307 with Location /app/settings (RED at 8b05aa1b and 7ded133c, where the
 *          page redirected in itself: a 200 with a meta refresh).
 *
 * Run at 375, 768, 1024 and 1440. Mocked: every API call is answered by page.route on api.test.local; skipped under
 * E2E_LIVE. CI's e2e-mocked step runs a fixed list of specs that does not include this one: it is the packet's browser
 * proof, and the standing guards are SPS-01..06 in Vitest.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5300 pnpm exec playwright test e2e/sweep-studio-scope.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];
const modules = (granted: Record<string, string>) => Object.fromEntries(ALL.map((m) => [m, granted[m] ?? "none"]));

/**
 * The edge middleware lets /app/* through only with a JWT-shaped kf_token (three parts, not expired); the helpers'
 * TEST_TOKEN is not one, so this spec stores an unsigned JWT-shaped token over it (the mocked API never checks it).
 */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT_SHAPED = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

async function signIn(page: Page, mods: Record<string, string>): Promise<void> {
  await seedWorkspace(page.context());
  await page.context().addCookies([{ name: "kf_token", value: JWT_SHAPED, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.context().addInitScript((token) => window.localStorage.setItem("kf_token", token), JWT_SHAPED);
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "services", advancedCrm: false } });
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]) }),
  );
  // Registered last, so it wins over mockBaseLayout's identity/businesses/:id** route.
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "STAFF", modules: mods }) }),
  );
}

/** The pages /studio listed whose reads need settings, or which the Settings index hides. */
const SETTINGS_HREF = /^\/app\/settings\/(notifications|developers|webhooks|business|compliance)(\?|$)/;
const SETTINGS_NAME = /notifications|webhooks|payment gateways|developers|compliance/i;
/**
 * "My account" is every member's own page, never a settings entry, whatever its description says: since
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282) it reads "… and push notifications", which the name pattern would match.
 */
const MY_ACCOUNT_HREF = /^\/app\/settings\/profile(\?|$)/;

/** Waits for /studio's own page, the Settings index or the sign-in page, then lets the my-access answer land. */
async function settle(page: Page): Promise<void> {
  const landed = page
    .getByRole("heading", { name: "Business Setup" })
    .or(page.getByRole("navigation", { name: "Settings", exact: true }))
    .or(page.locator('input[type="email"]'));
  await expect(landed.first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

/** Every visible link on the page that offers a settings entry. */
async function settingsLinksShown(page: Page): Promise<{ name: string; href: string }[]> {
  const links = await page.locator("a").filter({ visible: true }).evaluateAll((as) =>
    as.map((a) => ({ name: (a.textContent ?? "").replace(/\s+/g, " ").trim(), href: a.getAttribute("href") ?? "" })),
  );
  return links.filter((l) => !MY_ACCOUNT_HREF.test(l.href) && (SETTINGS_HREF.test(l.href) || SETTINGS_NAME.test(l.name)));
}

/** The names the Settings index offers, once the member's access has landed. */
async function indexEntries(page: Page): Promise<string[]> {
  return page
    .getByRole("navigation", { name: "Settings", exact: true })
    .locator("[data-entry-name]")
    .allTextContents()
    .then((t) => t.map((s) => s.trim()));
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 812 : 900 } });

    test(`SPB-01 settings none: no settings entry at /studio; it is the Settings index with My account (${width})`, async ({ page }) => {
      await signIn(page, modules({ crm: "read", bookings: "read" }));
      await page.goto("/studio");
      await settle(page);
      const shown = await settingsLinksShown(page);
      expect(shown, `settings entries at ${page.url()}`).toEqual([]);
      expect(new URL(page.url()).pathname).toBe("/app/settings");
      await expect.poll(() => indexEntries(page), { timeout: 10_000 }).toEqual(["My account"]);
    });

    test(`SPB-02 settings read: the Settings index with Getting paid and Notifications (${width})`, async ({ page }) => {
      await signIn(page, modules({ crm: "read", settings: "read" }));
      await page.goto("/studio");
      await settle(page);
      expect(new URL(page.url()).pathname).toBe("/app/settings");
      await expect
        .poll(() => indexEntries(page), { timeout: 10_000 })
        .toEqual(["Business profile", "Getting paid", "Documents & messages", "Notifications", "Plan & billing", "My account"]);
    });

    test(`SPB-03 owner: the Settings index with all eight entries (${width})`, async ({ page }) => {
      await signIn(page, modules(Object.fromEntries(ALL.map((m) => [m, "manage"]))));
      await page.goto("/studio");
      await settle(page);
      expect(new URL(page.url()).pathname).toBe("/app/settings");
      await expect
        .poll(() => indexEntries(page), { timeout: 10_000 })
        .toEqual(["Business profile", "Getting paid", "Team", "Documents & messages", "Notifications", "Plan & billing", "KEY", "My account"]);
    });

    test(`SPB-04 signed out: the sign-in page, no settings entry (${width})`, async ({ page }) => {
      await mockCatchAll(page);
      await page.goto("/studio");
      await settle(page);
      const shown = await settingsLinksShown(page);
      expect(shown, `settings entries at ${page.url()}`).toEqual([]);
      const url = new URL(page.url());
      expect(url.pathname).toBe("/auth/login");
      expect(url.searchParams.get("from")).toBe("/app/settings");
    });
  });
}

test("SPB-05 /studio answers with an HTTP 307 to /app/settings, not a prerendered page", async ({ request }) => {
  const res = await request.get("/studio", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toBe("/app/settings");
});
