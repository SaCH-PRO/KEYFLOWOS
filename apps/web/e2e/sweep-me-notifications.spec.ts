import { test, expect, type Page, type Route } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * FU-ME-NOTIFICATIONS-SCOPE (owner ruling D-276), the browser half. The jsdom half is
 * src/hooks/__tests__/use-app-layout-me-notifications.test.ts (MNS-01..04).
 *
 * The desktop rail's Me drawer offered "Notifications" (the business's customer emails and their log,
 * /app/settings/notifications, whose reads need settings since P30) to every member. Now it is offered only when the
 * member's settings access is read or higher; unknown access hides nothing; "My account" is every member's.
 *
 *   MNB-01 a member whose settings access is none: the Me drawer lists My account and no Notifications (RED at the
 *          base: Notifications is listed).
 *   MNB-02 a member with settings read: My account and Notifications.
 *   MNB-03 my-access failing (unknown): My account and Notifications.
 *
 * The rail (with its Me drawer) shows from 768px: 768, 1024 and 1440 are run. At 375 the shell has no rail: MNB-04
 * checks that the closed phone shell shows no Me button and no visible Notifications link. It does not open the phone
 * drawer, which never renders the Me entries (base and head alike), so it is a guard, not a RED case.
 *
 * Mocked: every API call is answered by page.route on api.test.local; skipped under E2E_LIVE. CI's e2e-mocked step
 * runs a fixed list of specs that does not include this one: it is the packet's browser proof, and the standing
 * guards are MNS-01..04 and NMS-18 in Vitest.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5100 pnpm exec playwright test e2e/sweep-me-notifications.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];
const modules = (granted: Record<string, string>) => Object.fromEntries(ALL.map((m) => [m, granted[m] ?? "none"]));

type Access = { status: number; body: unknown };

/**
 * The edge middleware lets /app/* through only with a JWT-shaped kf_token (three parts, not expired); the helpers'
 * TEST_TOKEN is not one, so this spec stores an unsigned JWT-shaped token over it (the mocked API never checks it).
 */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT_SHAPED = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

async function signIn(page: Page, access: Access): Promise<void> {
  await seedWorkspace(page.context());
  await page.context().addCookies([{ name: "kf_token", value: JWT_SHAPED, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.context().addInitScript((token) => window.localStorage.setItem("kf_token", token), JWT_SHAPED);
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "services", advancedCrm: false } });
  // The membership list the shell re-reads: still a member of this business.
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]) }),
  );
  // Registered last, so it wins over mockBaseLayout's identity/businesses/:id** route.
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    route.fulfill({ status: access.status, contentType: "application/json", body: JSON.stringify(access.body) }),
  );
}

/** Opens the rail's Me drawer and returns the labels of its links. */
async function meDrawerLinks(page: Page): Promise<string[]> {
  const me = page.getByRole("button", { name: "Me", exact: true }).filter({ visible: true });
  await expect(me).toHaveCount(1, { timeout: 20_000 });
  // Let the my-access answer land before reading the drawer (the shell re-renders on it).
  await page.waitForTimeout(1_500);
  await me.click();
  const drawerHeading = page.getByRole("heading", { name: "Me", exact: true });
  await expect(drawerHeading).toBeVisible();
  const drawer = drawerHeading.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
  return (await drawer.getByRole("link").allTextContents()).map((t) => t.trim()).filter(Boolean);
}

const FRONT_DESK: Access = { status: 200, body: { modules: modules({ bookings: "read", crm: "read" }) } };
const SETTINGS_READER: Access = { status: 200, body: { modules: modules({ crm: "read", settings: "read" }) } };
const UNKNOWN: Access = { status: 500, body: { message: "Internal Server Error" } };

for (const width of [768, 1024, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`MNB-01 settings none: My account, no Notifications (${width})`, async ({ page }) => {
      await signIn(page, FRONT_DESK);
      await page.goto("/app/crm/contacts");
      const links = await meDrawerLinks(page);
      expect(links.some((l) => /my account/i.test(l)), JSON.stringify(links)).toBe(true);
      expect(links.filter((l) => /notifications/i.test(l)), JSON.stringify(links)).toEqual([]);
    });

    test(`MNB-02 settings read: My account and Notifications (${width})`, async ({ page }) => {
      await signIn(page, SETTINGS_READER);
      await page.goto("/app/crm/contacts");
      const links = await meDrawerLinks(page);
      expect(links.some((l) => /my account/i.test(l)), JSON.stringify(links)).toBe(true);
      expect(links.some((l) => /notifications/i.test(l)), JSON.stringify(links)).toBe(true);
    });

    test(`MNB-03 my-access failing (unknown): both offered (${width})`, async ({ page }) => {
      await signIn(page, UNKNOWN);
      await page.goto("/app/crm/contacts");
      const links = await meDrawerLinks(page);
      expect(links.some((l) => /notifications/i.test(l)), JSON.stringify(links)).toBe(true);
    });
  });
}

for (const width of [375]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } });

    test(`MNB-04 no Me drawer and no Notifications link for a settings-none member (${width})`, async ({ page }) => {
      await signIn(page, FRONT_DESK);
      await page.goto("/app/crm/contacts");
      await page.waitForTimeout(2_000);
      await expect(page.getByRole("button", { name: "Me", exact: true }).filter({ visible: true })).toHaveCount(0);
      await expect(page.locator('a[href="/app/settings/notifications"]').filter({ visible: true })).toHaveCount(0);
    });
  });
}
