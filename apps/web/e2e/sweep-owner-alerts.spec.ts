import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, settle, memberOf, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * OWNER-ALERTS-WEB, the browser half (D-154; the alert setup steps of journeys E and F). The jsdom half is
 * src/app/app/settings/notifications/__tests__/notifications-owner-alerts.test.tsx (NOA-01..06) and
 * src/components/__tests__/install-app-step.test.tsx (ISA-01..08); the server half is
 * apps/server/src/modules/notifications/owner-alert-prefs.spec.ts (OAP-01..03).
 *
 * For a fresh owner on a real API and database (live only: E2E_LIVE=1, a production build; the journey harness's
 * fixtures, README in e2e/journeys; without E2E_LIVE every case is skipped), at 375x812, 768x1024, 1024x900 and
 * 1440x900, on /app/settings/notifications:
 *   OAB-01 an "Owner alerts" tab shows "Install KEYFLOWOS on your phone" and the three alert switches, all on for a
 *          fresh business; the tab strip and the page do not scroll sideways
 *   OAB-02 turning an alert off is saved on the server (GET customer-preferences answers owner_alert_<x>: false, which
 *          OwnerAlertsListener reads), stays off after a reload, and turns back on. At 375 all three are turned off
 *          and on (journey E: payments and "I've paid" claims; journey F: bookings); at the wider widths, bookings.
 *   OAB-03 (375, iPhone Safari) the install step says Share, then Add to Home Screen
 *   OAB-04 (repair round 1, SEC-OAW-1) an ADMIN of the business (settings admin) sees the three alerts read-only, with
 *          "Only the business owner can change these."; the API refuses their PATCH of an owner alert (403
 *          OWNER_ALERTS_OWNER_ONLY) and the stored value does not move
 *
 * No push or provider traffic: the page reads and writes preferences only; push on this device is My account's
 * (sweep-push-optin.spec.ts). Real delivery is the @staging legs E8c and F5 (GATE-STAGING-RUN).
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... E2E_WEB_COMMAND=standalone \
 *     E2E_PORT=... E2E_BASE_URL=... npx playwright test e2e/sweep-owner-alerts.spec.ts --project=chromium
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const SWITCHES = [
  { key: "owner_alert_bookings", name: /alerts for new bookings/i },
  { key: "owner_alert_payments", name: /alerts for payments received/i },
  { key: "owner_alert_claims", name: /alerts for "i've paid" claims/i },
] as const;

async function serverPrefs(request: APIRequestContext, owner: Tenant): Promise<Record<string, unknown>> {
  const res = await request.get(`${API_URL}/notifications/businesses/${owner.businessId}/customer-preferences`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function openAlerts(page: Page) {
  await page.goto("/app/settings/notifications");
  await expect(page.getByRole("heading", { name: /customer notifications/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^owner alerts$/i }).click();
  const region = page.getByRole("region", { name: /owner alerts/i });
  await expect(region).toBeVisible();
  await expect(region.getByRole("switch", { name: SWITCHES[0].name })).toBeVisible({ timeout: 20_000 });
  return region;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

for (const [width, height] of [[375, 812], [768, 1024], [1024, 900], [1440, 900]] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test(`OAB-01 Owner alerts: the install step and three switches, on by default (${width})`, async ({ page }) => {
      const region = await openAlerts(page);
      await expect(region.getByRole("heading", { name: /install keyflowos on your phone/i })).toBeVisible();
      for (const s of SWITCHES) {
        const sw = region.getByRole("switch", { name: s.name });
        await expect(sw).toBeVisible();
        await expect(sw).toHaveAttribute("aria-checked", "true");
      }
      await expect(region.getByRole("switch")).toHaveCount(3);
      const tab = page.getByRole("button", { name: /^owner alerts$/i });
      const box = await tab.boundingBox();
      expect(box && box.x + box.width <= width, "the Owner alerts tab is inside the viewport").toBe(true);
      await noSidewaysScroll(page);
    });

    test(`OAB-02 an alert turned off is saved on the server, survives a reload, and turns back on (${width})`, async ({ page, request, owner }) => {
      const which = width === 375 ? SWITCHES : SWITCHES.slice(0, 1);
      let region = await openAlerts(page);
      for (const s of which) {
        const sw = region.getByRole("switch", { name: s.name });
        const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/customer-preferences"));
        await sw.click();
        expect((await saved).status()).toBe(200);
        await expect(sw).toHaveAttribute("aria-checked", "false");
        await expect(sw).toBeEnabled();
        expect((await serverPrefs(request, owner))[s.key], `${s.key} saved off`).toBe(false);
      }
      await expect(region.getByRole("alert")).toHaveCount(0);

      await page.reload();
      region = await openAlerts(page);
      for (const s of which) await expect(region.getByRole("switch", { name: s.name })).toHaveAttribute("aria-checked", "false");
      await noSidewaysScroll(page);

      for (const s of which) {
        const sw = region.getByRole("switch", { name: s.name });
        const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/customer-preferences"));
        await sw.click();
        expect((await saved).status()).toBe(200);
        await expect(sw).toHaveAttribute("aria-checked", "true");
        await expect(sw).toBeEnabled();
      }
      const prefs = await serverPrefs(request, owner);
      for (const s of which) expect(prefs[s.key], `${s.key} saved on`).toBe(true);
      await settle(page, 500);
    });

    test(`OAB-04 an ADMIN sees the owner's alerts read-only and the API refuses their change (${width})`, async ({ browser, request, owner }) => {
      const admin = await memberOf(request, owner, `admin ${width}`, { role: "ADMIN" });
      const context = await signedInContext(browser, admin, { viewport: { width, height } });
      const page = await context.newPage();
      const region = await openAlerts(page);
      await expect(region.getByText("Only the business owner can change these.")).toBeVisible();
      for (const s of SWITCHES) {
        const sw = region.getByRole("switch", { name: s.name });
        await expect(sw).toBeVisible();
        await expect(sw).toBeDisabled();
        await expect(sw).toHaveAttribute("aria-checked", "true");
      }
      await noSidewaysScroll(page);

      const refused = await request.patch(`${API_URL}/notifications/businesses/${owner.businessId}/customer-preferences`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { owner_alert_claims: false },
      });
      expect(refused.status(), await refused.text()).toBe(403);
      expect(await refused.text()).toContain("OWNER_ALERTS_OWNER_ONLY");
      expect((await serverPrefs(request, owner)).owner_alert_claims).not.toBe(false);
    });
  });
}

test.describe("at 375px on an iPhone", () => {
  test.use({ viewport: { width: 375, height: 812 }, userAgent: IPHONE });

  test("OAB-03 the install step says Share, then Add to Home Screen", async ({ page }) => {
    const region = await openAlerts(page);
    await expect(region.getByText("Add to Home Screen", { exact: true })).toBeVisible();
    await expect(region.getByText("Share", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: /install app/i })).toHaveCount(0);
    await noSidewaysScroll(page);
  });
});
